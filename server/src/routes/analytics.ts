import { Router } from 'express'
import { getAnalyticsSummary } from '../services/analytics'
import { explainComparison, explainProduct, parseExplainInput } from '../services/aiExplanation'
import { validationError, notFound } from '../lib/errors'
import { buildCompetitiveResponse, getCompetitiveDataset, queryObservations } from '../services/competitive'
import { buildComparisonInput, parseComparisonRequest } from '../services/competitive/explain'
import { compareShopToMarket } from '../services/competitive/shopComparison'
import type { Provenance } from '../services/competitive/types'
import { prisma } from '../lib/prisma'
import { getDemandForecast, parseHorizon } from '../services/forecast'
import { getRestockingRecommendations } from '../services/restocking'
import { getProductInsights } from '../services/insights'
import { getValidatedForecast } from '../services/forecasting'
import { getInventoryIntelligence } from '../services/inventoryIntelligence'

const router = Router()

// Read-only: derives every metric from existing records and writes nothing.
router.get('/summary', async (_req, res) => {
  res.json(await getAnalyticsSummary())
})

// Read-only: sales velocity, stock coverage and fast/slow movement per product.
router.get('/product-insights', async (_req, res) => {
  res.json(await getProductInsights())
})

// Read-only: historical-average demand estimate. Optional ?days=<1..365> (default 7).
router.get('/forecast', async (req, res) => {
  res.json(await getDemandForecast({ horizonDays: parseHorizon(req.query.days) }))
})

// Read-only: temporally validated forecast (train / validation / test split, MAE, WAPE, baseline comparison).
// Optional ?days=<1..365> (default 7). The plain /forecast above is unchanged.
router.get('/forecast/validated', async (req, res) => {
  res.json(await getValidatedForecast({ horizonDays: parseHorizon(req.query.days) }))
})

// Read-only: suggested restock quantities (forecast + minimum level - current stock). Optional ?days=.
// Optional ?forecast=validated uses the validated forecast instead of the historical average.
router.get('/restocking', async (req, res) => {
  const forecastSource = req.query.forecast === 'validated' ? 'validated' : 'baseline'
  res.json(await getRestockingRecommendations({ horizonDays: parseHorizon(req.query.days), forecastSource }))
})

// Read-only: stock + validated forecast + restocking + rule-based priority + inventory value in one response.
router.get('/inventory-intelligence', async (req, res) => {
  res.json(await getInventoryIntelligence({ horizonDays: parseHorizon(req.query.days) }))
})

// Explains already-calculated values in plain language (Groq, with a deterministic fallback).
// Does not touch the database.
router.post('/explain', async (req, res) => {
  res.json(await explainProduct(parseExplainInput(req.body)))
})

// ---------- Competitive price intelligence (EXTERNAL market context) ----------
// Read-only, from CSV files in data_csv/. Separate from the shop's data: nothing here reads or writes
// the database, and nothing here feeds analytics, forecasts, restocking or inventory intelligence.

router.get('/competitive-prices', async (_req, res) => {
  res.json(buildCompetitiveResponse(await getCompetitiveDataset()))
})

// Shop price vs market price. Reads Product (name, sellingPrice) only; writes nothing. Compares confirmed
// matches with the provided Zepto dataset; uncertain matches are counted, never compared.
// ?platform=Zepto (default, the provided dataset) or ?platform=Blinkit. Blinkit exists in the project only as
// SAMPLE rows, so they are matched the same way but returned with basis "SAMPLE" and never presented as real.
router.get('/competitive-prices/shop', async (req, res) => {
  const platform = String(req.query.platform ?? 'Zepto').toLowerCase() === 'blinkit' ? 'Blinkit' : 'Zepto'
  const products = await prisma.product.findMany({ select: { id: true, name: true, sellingPrice: true }, orderBy: { name: 'asc' } })
  const ds = await getCompetitiveDataset()
  const basis = platform === 'Zepto' ? 'DATASET' : 'SAMPLE'
  const records = ds.observations
    .filter((o) => o.provenance === basis && o.platform === platform)
    // Reference rows keep brand and product separate; the matcher reads the full name.
    .map((o) => (o.brand && !o.productName.toLowerCase().startsWith(o.brand.toLowerCase()) ? { ...o, productName: `${o.brand} ${o.productName}` } : o))
  // Leftover automated-test rows ("ZZ ...") are not shop products and would only distort the coverage count.
  const result = compareShopToMarket(products.filter((p) => !p.name.startsWith('ZZ ')).map((p) => ({ id: p.id, name: p.name, sellingPrice: Number(p.sellingPrice) })), records)
  res.json({
    kind: 'external-competitive-prices-vs-shop',
    source: 'provided datasets',
    platform,
    basis,
    definition: 'difference = shop price - platform price; percent is of the shop price. Informational only; nothing here changes any shop figure.',
    note: 'Prices are from the provided dataset. No file records a date, so they are not live or current.',
    ...result,
  })
})

const PROVENANCES: Provenance[] = ['COLLECTED', 'DATASET', 'SAMPLE', 'UNVERIFIED', 'TEMPLATE']

// Paged normalised observations. Optional ?platform=, ?provenance=, ?q=, ?limit= (1..200, default 50), ?offset=.
router.get('/competitive-prices/observations', async (req, res) => {
  const errors: string[] = []
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 80) : undefined)
  const int = (v: unknown, name: string, min: number, max: number, fallback: number) => {
    if (v === undefined) return fallback
    if (typeof v !== 'string' || !/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
      errors.push(`${name} must be a whole number between ${min} and ${max}`)
      return fallback
    }
    return Number(v)
  }
  const provenance = str(req.query.provenance)
  if (provenance !== undefined && !PROVENANCES.includes(provenance as Provenance)) {
    errors.push(`provenance must be one of: ${PROVENANCES.join(', ')}`)
  }
  const limit = int(req.query.limit, 'limit', 1, 200, 50)
  const offset = int(req.query.offset, 'offset', 0, 1_000_000, 0)
  if (errors.length > 0) throw validationError(errors)
  res.json(
    queryObservations(await getCompetitiveDataset(), {
      platform: str(req.query.platform),
      provenance: provenance as Provenance | undefined,
      q: str(req.query.q),
      limit,
      offset,
    }),
  )
})

// Explains one comparison. The backend looks the numbers up itself; the client only names the comparison.
router.post('/competitive-prices/explain', async (req, res) => {
  const request = parseComparisonRequest(req.body)
  const input = buildComparisonInput(await getCompetitiveDataset(), request)
  if (!input) throw notFound('A valid comparison for that product')
  res.json({ ...(await explainComparison(input)), basis: input.basis })
})

export default router

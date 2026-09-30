import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseBasket } from './basket'
import {
  availabilityStatus,
  comparePlatforms,
  discountPercent,
  pairComparison,
  priceDifference,
  priceDifferencePercent,
  round2,
  type PairComparison,
  type PlatformComparison,
} from './calculations'
import { matchReferenceProducts } from './matching'
import { parsePlatformPrices } from './platformPrices'
import { parseZepto, type PriceUnitEvidence } from './zepto'
import type { FileSummary, MatchResult, PriceObservation, Provenance, ReferenceProduct } from './types'

/**
 * Competitive Price Intelligence: external market context from CSV files in `data_csv/`.
 *
 *   CSV -> read -> validate -> normalise -> match (only when reliable) -> calculate -> API
 *
 * Completely separate from the shop's own data: nothing here touches the database, and nothing
 * here is imported by analytics, forecasting, restocking or inventory intelligence.
 * The raw CSV files are never modified. Read-only.
 */

export const FILES = {
  basket: 'basket.csv',
  prices: 'prices.csv',
  template: 'prices_template.csv',
  zepto: 'zepto_dataset.csv',
} as const

export const BLINKIT_UNAVAILABLE = 'Verified Blinkit observations are not available in the provided dataset.'

export interface CompetitiveDataset {
  directory: string
  files: FileSummary[]
  reference: ReferenceProduct[]
  /** Valid observations from every file (template rows are not observations). */
  observations: PriceObservation[]
  priceUnit: PriceUnitEvidence | null
  zeptoRawRows: number
  matches: MatchResult[]
}

/** COMPETITIVE_DATA_DIR, else ../data_csv (server run from server/), else ./data_csv. */
export async function resolveDataDirectory(): Promise<string> {
  const candidates = [process.env.COMPETITIVE_DATA_DIR, path.resolve(process.cwd(), '..', 'data_csv'), path.resolve(process.cwd(), 'data_csv')]
    .filter((c): c is string => Boolean(c))
    .map((c) => path.resolve(c))
  for (const c of candidates) {
    try {
      if ((await fs.stat(c)).isDirectory()) return c
    } catch {
      /* try the next candidate */
    }
  }
  return candidates[0]
}

async function readIfPresent(dir: string, file: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(dir, file), 'utf8')
  } catch {
    return null
  }
}

const missingFile = (file: string, role: FileSummary['role'], description: string): FileSummary => ({
  file, role, error: 'File not found.', provenance: null, description, validation: null,
})

/** Reads, validates and normalises every file in `dir`. Missing or malformed files are reported, never fatal. */
export async function loadCompetitiveDataset(dir?: string): Promise<CompetitiveDataset> {
  const directory = dir ?? (await resolveDataDirectory())
  const files: FileSummary[] = []
  const observations: PriceObservation[] = []
  let reference: ReferenceProduct[] = []
  let priceUnit: PriceUnitEvidence | null = null
  let zeptoRawRows = 0

  const basketText = await readIfPresent(directory, FILES.basket)
  const basketDesc = 'Reference product basket (what to look for). Not a set of platform observations.'
  if (basketText === null) files.push(missingFile(FILES.basket, 'reference', basketDesc))
  else {
    const r = parseBasket(basketText, FILES.basket)
    if (r.ok) {
      reference = r.products
      files.push({ file: FILES.basket, role: 'reference', error: null, provenance: 'REFERENCE', description: basketDesc, validation: r.report })
    } else files.push({ file: FILES.basket, role: 'reference', error: r.reason, provenance: null, description: basketDesc, validation: null })
  }

  const platformFiles: { file: string; role: FileSummary['role']; description: string }[] = [
    { file: FILES.prices, role: 'observations', description: 'Per-platform price rows for the reference basket. Rows are labelled by their data_source column.' },
    { file: FILES.template, role: 'template', description: 'Collection template. Rows without a price and availability are empty and are not observations.' },
  ]
  for (const f of platformFiles) {
    const text = await readIfPresent(directory, f.file)
    if (text === null) {
      files.push(missingFile(f.file, f.role, f.description))
      continue
    }
    const r = parsePlatformPrices(text, f.file)
    if (!r.ok) {
      files.push({ file: f.file, role: f.role, error: r.reason, provenance: null, description: f.description, validation: null })
      continue
    }
    observations.push(...r.observations)
    const kinds = new Set(r.observations.map((o) => o.provenance))
    files.push({
      file: f.file,
      role: f.role,
      error: null,
      provenance: kinds.size === 1 ? [...kinds][0] : r.observations.length === 0 ? 'TEMPLATE' : 'UNVERIFIED',
      description: f.description,
      validation: r.report,
    })
  }

  const zeptoText = await readIfPresent(directory, FILES.zepto)
  const zeptoDesc = 'Provided Zepto product dataset (Zepto only). No date, location or brand column; collection method undocumented.'
  if (zeptoText === null) files.push(missingFile(FILES.zepto, 'observations', zeptoDesc))
  else {
    const z = parseZepto(zeptoText, FILES.zepto)
    if (z.ok) {
      observations.push(...z.observations)
      priceUnit = z.priceUnit
      zeptoRawRows = z.rawRows
      files.push({ file: FILES.zepto, role: 'observations', error: null, provenance: 'DATASET', description: zeptoDesc, validation: z.report })
    } else files.push({ file: FILES.zepto, role: 'observations', error: z.reason, provenance: null, description: zeptoDesc, validation: null })
  }

  // Product matching uses the Zepto dataset only: the per-platform price file already has product ids.
  const zeptoRecords = observations.filter((o) => o.provenance === 'DATASET' && o.platform === 'Zepto')
  const matches = matchReferenceProducts(reference, zeptoRecords)
  return { directory, files, reference, observations, priceUnit, zeptoRawRows, matches }
}

// ---------- cache (files are re-read only when they change) ----------

let cache: { key: string; data: CompetitiveDataset } | null = null

export async function getCompetitiveDataset(): Promise<CompetitiveDataset> {
  const dir = await resolveDataDirectory()
  const stamps = await Promise.all(
    Object.values(FILES).map(async (f) => {
      try {
        const s = await fs.stat(path.join(dir, f))
        return `${f}:${s.size}:${s.mtimeMs}`
      } catch {
        return `${f}:missing`
      }
    }),
  )
  const key = `${dir}|${stamps.join('|')}`
  if (cache?.key === key) return cache.data
  const data = await loadCompetitiveDataset(dir)
  cache = { key, data }
  return data
}

// ---------- response ----------

/** One row per platform, source file and provenance, so dataset records and sample rows are never blended. */
function platformCoverage(observations: PriceObservation[]) {
  const groups = new Map<string, PriceObservation[]>()
  for (const o of observations) {
    const key = `${o.platform}|${o.sourceFile}|${o.provenance}`
    groups.set(key, [...(groups.get(key) ?? []), o])
  }
  return [...groups.values()]
    .map((rows) => ({
      platform: rows[0].platform,
      sourceFile: rows[0].sourceFile,
      provenance: rows[0].provenance,
      observations: rows.length,
      withPrice: rows.filter((o) => o.sellingPriceInr !== null).length,
      inStock: rows.filter((o) => o.available === true).length,
      outOfStock: rows.filter((o) => o.available === false).length,
      unknownAvailability: rows.filter((o) => o.available === null).length,
      /** True only for observations labelled collected that carry real values. */
      verified: rows[0].provenance === 'COLLECTED',
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.sourceFile.localeCompare(b.sourceFile))
}

function zeptoSummary(ds: CompetitiveDataset) {
  const zepto = ds.observations.filter((o) => o.provenance === 'DATASET' && o.platform === 'Zepto')
  const zeptoFile = ds.files.find((f) => f.file === FILES.zepto)
  if (zepto.length === 0) return { available: false as const }
  const inStock = zepto.filter((o) => o.available === true).length
  const discounts = zepto.map((o) => o.discountPercent).filter((d): d is number => d !== null)
  const avg = discounts.length === 0 ? null : Math.round((discounts.reduce((a, b) => a + b, 0) / discounts.length) * 10) / 10
  const top = [...zepto]
    .filter((o) => o.discountPercent !== null && o.sellingPriceInr !== null && !o.conflicting)
    .sort((a, b) => b.discountPercent! - a.discountPercent! || a.productName.localeCompare(b.productName))
    .slice(0, 8)
  return {
    available: true as const,
    sourceFile: FILES.zepto,
    rawRows: ds.zeptoRawRows,
    rejectedRows: zeptoFile?.validation?.rejectedRows ?? 0,
    uniqueRecords: zepto.length,
    duplicatesMerged: zepto.reduce((s, o) => s + (o.duplicates - 1), 0),
    inStock,
    outOfStock: zepto.length - inStock,
    availabilityRate: Math.round((inStock / zepto.length) * 1000) / 10,
    averageDiscountPercent: avg,
    discountedShare: Math.round((discounts.filter((d) => d > 0).length / Math.max(discounts.length, 1)) * 1000) / 10,
    priceUnit: ds.priceUnit,
    topDiscounts: top,
    categoryNote:
      'Category labels in this file are inconsistent (the same product appears under several categories), so no category breakdown is shown.',
  }
}

function referenceComparisons(ds: CompetitiveDataset) {
  const byId = new Map(ds.reference.map((r) => [r.productId, r]))
  return ds.matches
    .filter((m) => m.status === 'confirmed' && m.observation)
    .map((m) => {
      const ref = byId.get(m.productId)!
      const o = m.observation!
      return {
        productId: ref.productId,
        productName: ref.productName,
        brand: ref.brand,
        packSizeValue: ref.packSizeValue,
        packSizeUnit: ref.packSizeUnit,
        platform: o.platform,
        matchedName: o.productName,
        referenceMrpInr: ref.referenceMrpInr,
        datasetMrpInr: o.mrpInr,
        /** dataset MRP - reference MRP */
        mrpDifferenceInr: priceDifference(ref.referenceMrpInr, o.mrpInr),
        mrpDifferencePercent: priceDifferencePercent(ref.referenceMrpInr, o.mrpInr),
        sellingPriceInr: o.sellingPriceInr,
        discountPercent: o.discountPercent ?? discountPercent(o.mrpInr, o.sellingPriceInr),
        availability: availabilityStatus(o.available),
        provenance: o.provenance,
        sourceFile: o.sourceFile,
      }
    })
}

function platformComparisons(ds: CompetitiveDataset, basis: 'COLLECTED' | 'SAMPLE') {
  const rows = ds.observations.filter((o) => o.provenance === basis && o.productId !== null)
  if (rows.length === 0) return null
  const byProduct = new Map<string, PriceObservation[]>()
  for (const o of rows) byProduct.set(o.productId!, [...(byProduct.get(o.productId!) ?? []), o])
  const comparisons: (PlatformComparison & { zeptoVsBlinkit: PairComparison | null })[] = []
  for (const group of byProduct.values()) {
    const c = comparePlatforms(group)
    if (c) comparisons.push({ ...c, productId: group[0].productId!, zeptoVsBlinkit: pairComparison(c, 'Zepto', 'Blinkit') })
  }
  comparisons.sort((a, b) => a.productId.localeCompare(b.productId))

  const platforms = [...new Set(rows.map((o) => o.platform))].sort()
  const perPlatform = platforms.map((platform) => {
    const p = rows.filter((o) => o.platform === platform)
    const discounts = p.map((o) => o.discountPercent).filter((d): d is number => d !== null)
    return {
      platform,
      observations: p.length,
      averageDiscountPercent: discounts.length ? Math.round((discounts.reduce((a, b) => a + b, 0) / discounts.length) * 10) / 10 : null,
      availabilityRate: p.length ? Math.round((p.filter((o) => o.available === true).length / p.length) * 1000) / 10 : null,
      timesCheapest: comparisons.filter((c) => c.cheapest?.platform === platform).length,
    }
  })
  const pairs = comparisons.map((c) => c.zeptoVsBlinkit).filter((p): p is PairComparison => p !== null)
  return {
    basis,
    label:
      basis === 'SAMPLE'
        ? 'Sample data (labelled SAMPLE in the file): illustrative only, not collected prices.'
        : 'Collected observations.',
    productsCompared: comparisons.filter((c) => c.cheapest !== null).length,
    perPlatform,
    zeptoVsBlinkit: {
      productsCompared: pairs.length,
      zeptoCheaper: pairs.filter((p) => p.differenceInr > 0).length,
      blinkitCheaper: pairs.filter((p) => p.differenceInr < 0).length,
      samePrice: pairs.filter((p) => p.differenceInr === 0).length,
      averageDifferenceInr: pairs.length ? round2(pairs.reduce((s, p) => s + p.differenceInr, 0) / pairs.length) : null,
      definition: 'difference = Blinkit price - Zepto price (positive: Zepto is cheaper), only for products in stock on both platforms with valid prices.',
    },
    comparisons,
  }
}

export function buildCompetitiveResponse(ds: CompetitiveDataset) {
  const coverage = platformCoverage(ds.observations)
  const blinkitRows = coverage.filter((c) => c.platform === 'Blinkit')
  const blinkitVerified = blinkitRows.filter((c) => c.provenance === 'COLLECTED').reduce((s, c) => s + c.observations, 0)
  const blinkitSample = blinkitRows.filter((c) => c.provenance === 'SAMPLE').reduce((s, c) => s + c.observations, 0)
  const counts = { confirmed: 0, possible: 0, ambiguous: 0, unmatched: 0 }
  for (const m of ds.matches) counts[m.status]++

  const collected = ds.observations.filter((o) => o.provenance === 'COLLECTED').length
  const templateRows = ds.files.reduce((s, f) => s + (f.validation?.templateRows ?? 0), 0)
  const sampleRows = ds.observations.filter((o) => o.provenance === 'SAMPLE').length

  const limitations = [
    'External market context only. It is not the shop\'s data and never affects its sales, stock, forecasts or restocking figures.',
    'No file records when or where prices were checked, so nothing here is live, real-time or current.',
    collected === 0 ? 'None of the price rows is a verified collected observation.' : null,
    sampleRows > 0 ? `${sampleRows} rows in prices.csv are labelled SAMPLE; they are shown as sample data, not as collected prices.` : null,
    templateRows > 0 ? `${templateRows} template rows contain no price or availability and are not observations, whatever their label says.` : null,
    blinkitVerified === 0 ? BLINKIT_UNAVAILABLE : null,
    ds.priceUnit ? `Zepto prices: ${ds.priceUnit.explanation}` : null,
    'The reference MRPs in basket.csv have no stated source or date: they are a rough reference, not verified prices.',
    'The Zepto file has no brand column, so products are matched to the reference basket by brand and name inside the product name, and only when the pack size can be verified.',
    'Only Zepto is present in the provided dataset; other platforms appear only in the SAMPLE rows.',
  ].filter((l): l is string => l !== null)

  return {
    kind: 'external-competitive-prices',
    notice: 'External market data from CSV files. Separate from the shop\'s own data.',
    dataDirectory: path.basename(ds.directory),
    files: ds.files,
    platformCoverage: coverage,
    verifiedPlatforms: [...new Set(coverage.filter((c) => c.verified).map((c) => c.platform))],
    blinkit: {
      verifiedObservations: blinkitVerified,
      sampleObservations: blinkitSample,
      message: blinkitVerified === 0 ? BLINKIT_UNAVAILABLE : null,
    },
    zepto: zeptoSummary(ds),
    reference: {
      products: ds.reference.length,
      statusCounts: counts,
      matches: ds.matches.map((m) => ({ ...m, observation: m.observation })),
    },
    referenceComparisons: referenceComparisons(ds),
    platformComparisons: (['COLLECTED', 'SAMPLE'] as const).map((b) => platformComparisons(ds, b)).filter((c) => c !== null),
    limitations,
  }
}

export interface ObservationQuery {
  platform?: string
  provenance?: Provenance
  q?: string
  limit: number
  offset: number
}

/** Paged normalised observations, so the full file never has to be sent at once. */
export function queryObservations(ds: CompetitiveDataset, query: ObservationQuery) {
  const needle = query.q?.trim().toLowerCase()
  const rows = ds.observations.filter(
    (o) =>
      (!query.platform || o.platform.toLowerCase() === query.platform.toLowerCase()) &&
      (!query.provenance || o.provenance === query.provenance) &&
      (!needle || o.productName.toLowerCase().includes(needle) || (o.brand ?? '').toLowerCase().includes(needle)),
  )
  return { total: rows.length, limit: query.limit, offset: query.offset, observations: rows.slice(query.offset, query.offset + query.limit) }
}

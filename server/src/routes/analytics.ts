import { Router } from 'express'
import { getAnalyticsSummary } from '../services/analytics'
import { explainProduct, parseExplainInput } from '../services/aiExplanation'
import { getDemandForecast, parseHorizon } from '../services/forecast'
import { getRestockingRecommendations } from '../services/restocking'
import { getProductInsights } from '../services/insights'

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

// Read-only: suggested restock quantities (forecast + minimum level - current stock). Optional ?days=.
router.get('/restocking', async (req, res) => {
  res.json(await getRestockingRecommendations({ horizonDays: parseHorizon(req.query.days) }))
})

// Explains already-calculated values in plain language (Groq, with a deterministic fallback).
// Does not touch the database.
router.post('/explain', async (req, res) => {
  res.json(await explainProduct(parseExplainInput(req.body)))
})

export default router

import { Router } from 'express'
import { indiaRetailPrices } from '../services/external/indiaRetailPrices'

const router = Router()

// Read-only. External Indian market data: kept separate from the shop's business data.
// Returns the source's provenance and status; figures appear only if an official export was imported.
router.get('/market-prices', async (_req, res) => {
  const [status, provenance, report, commodities] = await Promise.all([
    indiaRetailPrices.getStatus(),
    indiaRetailPrices.getProvenance(),
    indiaRetailPrices.getImportReport(),
    indiaRetailPrices.getSummary(),
  ])
  res.json({
    kind: 'external-market-data',
    sourceId: indiaRetailPrices.id,
    title: indiaRetailPrices.title,
    notice: 'External Indian market data. It is not this shop\'s data and does not affect its forecasts.',
    status,
    provenance,
    importReport: report,
    commodities,
  })
})

export default router

import { Router } from 'express'
import { getAnalyticsSummary } from '../services/analytics'

const router = Router()

// Read-only: derives every metric from existing records and writes nothing.
router.get('/summary', async (_req, res) => {
  res.json(await getAnalyticsSummary())
})

export default router

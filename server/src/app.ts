import cors from 'cors'
import express from 'express'
import { errorHandler, notFoundHandler } from './lib/errors'
import authRouter from './routes/auth'
import expensesRouter from './routes/expenses'
import externalRouter from './routes/external'
import analyticsRouter from './routes/analytics'
import healthRouter from './routes/health'
import productsRouter from './routes/products'
import purchasesRouter from './routes/purchases'
import salesRouter from './routes/sales'

export function createApp() {
  const app = express()

  app.use(cors({ origin: 'http://localhost:5173' }))
  app.use(express.json())

  app.use('/api', healthRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/products', productsRouter)
  app.use('/api/sales', salesRouter)
  app.use('/api/purchases', purchasesRouter)
  app.use('/api/expenses', expensesRouter)
  app.use('/api/analytics', analyticsRouter)
  app.use('/api/external', externalRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

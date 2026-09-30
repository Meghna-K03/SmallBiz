import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../lib/prisma'
import type { SaleLike } from './forecasting/series'

/**
 * Data-source adapters.
 *
 * Two kinds of data are kept strictly apart and never merged:
 *
 *   Business data           the shop's own products and sales (Sharma General Store).
 *   External market data    public Indian market information (e.g. Government of India open data).
 *
 * Analytics and forecasting read business data ONLY through `BusinessDataSource`.
 * External data is exposed only as separate, labelled market signals; it is never
 * added to the shop's sales history, and it never changes a forecast.
 *
 * Adding a new source later (another public feed, a retailer with a legal data
 * agreement, a CSV import) means writing one more adapter that implements one of
 * these interfaces. No analytics or forecasting code has to change.
 */

type Db = PrismaClient | Prisma.TransactionClient

// ---------- Business data ----------

export interface BusinessProduct {
  id: string
  name: string
  category: string
}

export interface BusinessDataSource {
  readonly kind: 'business'
  readonly name: string
  getProducts(): Promise<BusinessProduct[]>
  /** All recorded sales, one row per sale. Dates are YYYY-MM-DD. */
  getSales(): Promise<SaleLike[]>
}

/** The shop's own records, read from the application database. */
export function prismaBusinessSource(db: Db = defaultPrisma): BusinessDataSource {
  return {
    kind: 'business',
    name: 'Sharma General Store (application database)',
    getProducts: () =>
      db.product.findMany({ select: { id: true, name: true, category: true }, orderBy: { name: 'asc' } }),
    getSales: async () => {
      const rows = await db.sale.findMany({ select: { productId: true, quantity: true, date: true } })
      return rows.map((s) => ({ productId: s.productId, quantity: s.quantity, date: s.date.toISOString().slice(0, 10) }))
    },
  }
}

// ---------- External competitive price data ----------

/**
 * A source of competitor price/availability observations (today: CSV files in data_csv/, read by
 * services/competitive/). A future adapter (a legal public feed, a retailer with a data agreement)
 * implements this and returns the same canonical, provenance-labelled observations. It is external
 * context: it never enters the shop's sales, stock, forecasts or restocking figures.
 */
export interface CompetitiveDataSource {
  readonly kind: 'external-competitive'
  readonly id: string
  readonly title: string
  load(): Promise<import('./competitive').CompetitiveDataset>
}

// ---------- External market data ----------

/** Where a dataset came from and how it was processed. Shown to the user and documented. */
export interface Provenance {
  sourceName: string
  publisher: string
  officialUrl: string
  license: string | null
  /** When the file was downloaded from the publisher. Null until known. */
  retrievalDate: string | null
  /** Dates covered by the imported records. Null until data is imported. */
  dataPeriod: { from: string; to: string } | null
  /** Fields taken from the file (source column -> meaning). */
  fields: string[]
  /** What was done to the raw file before use. */
  transformations: string[]
  limitations: string[]
}

export interface MarketPriceObservation {
  commodity: string
  /** YYYY-MM-DD */
  date: string
  /** Retail price as published, in rupees. The unit (per kg / per litre) is as published. */
  price: number
  market: string | null
  state: string | null
}

export type ExternalSourceStatus =
  | { state: 'not-configured'; reason: string }
  | { state: 'invalid'; reason: string }
  | { state: 'ready'; observations: number }

export interface ExternalMarketSource {
  readonly kind: 'external-market'
  readonly id: string
  readonly title: string
  getStatus(): Promise<ExternalSourceStatus>
  getProvenance(): Promise<Provenance>
  getObservations(): Promise<MarketPriceObservation[]>
}

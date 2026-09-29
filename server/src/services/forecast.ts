import type { Prisma, PrismaClient } from '@prisma/client'
import { validationError } from '../lib/errors'
import { prisma as defaultPrisma } from '../lib/prisma'
import { getDefaultAnalysisPeriod, type AnalysisPeriod } from './insights'

/**
 * Baseline demand forecast (Phase 5). Deterministic; no ML, no AI.
 *
 *   Average Daily Demand = units sold in the history period / days in the history period
 *   Forecasted Demand    = Average Daily Demand x forecast horizon (days)
 *
 * History period: by default the earliest to the latest recorded sale date,
 * inclusive (same as product insights). The forecast is a plain extrapolation of
 * that average; it ignores trends, seasonality, promotions and stock-outs, and is
 * an estimate, not a guarantee. Forecasted demand is computed from the unrounded
 * average and rounded once (2 decimals), so it can differ by a hundredth from
 * rounded average x horizon.
 *
 * Data reliability (`dataStatus`)
 *   No Sales         : 0 units sold in the period. Demand is 0; nothing to base an estimate on.
 *   Limited History  : the period is shorter than MIN_HISTORY_DAYS days, or the product has
 *                      fewer than MIN_SALE_RECORDS sale records in it. Treat as low confidence.
 *   Sufficient       : otherwise.
 *
 * Scalability: sales are aggregated inside PostgreSQL (GROUP BY product, plus
 * MIN/MAX aggregates for the period); only one row per product reaches Node.
 * Read-only.
 */

type Db = PrismaClient | Prisma.TransactionClient

export const MIN_HISTORY_DAYS = 14
export const MIN_SALE_RECORDS = 3
export const DEFAULT_HORIZON_DAYS = 7
export const MAX_HORIZON_DAYS = 365

export type DataStatus = 'No Sales' | 'Limited History' | 'Sufficient'

export interface ProductForecast {
  productId: string
  productName: string
  category: string
  historicalUnitsSold: number
  saleRecords: number
  firstSaleDate: string | null
  lastSaleDate: string | null
  historyDays: number
  averageDailyDemand: number
  forecastHorizonDays: number
  forecastedDemand: number
  dataStatus: DataStatus
}

const round2 = (n: number) => Math.round(n * 100) / 100
const day = (d: Date) => d.toISOString().slice(0, 10)

// ---------- Pure calculations ----------

/** Validates a horizon given as a query-string value. Whole days, 1..MAX_HORIZON_DAYS; undefined -> default. */
export function parseHorizon(value: unknown): number {
  if (value === undefined) return DEFAULT_HORIZON_DAYS
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    throw validationError([`days must be a whole number between 1 and ${MAX_HORIZON_DAYS}`])
  }
  const n = Number(value)
  if (n < 1 || n > MAX_HORIZON_DAYS) {
    throw validationError([`days must be a whole number between 1 and ${MAX_HORIZON_DAYS}`])
  }
  return n
}

/** Units per day over the period; 0 when there are no sales or the period has no days. */
export function calcAverageDailyDemand(unitsSold: number, periodDays: number): number {
  if (periodDays <= 0 || unitsSold <= 0) return 0
  return unitsSold / periodDays
}

export function calcForecastedDemand(unitsSold: number, periodDays: number, horizonDays: number): number {
  return round2(calcAverageDailyDemand(unitsSold, periodDays) * horizonDays)
}

export function classifyDataStatus(unitsSold: number, saleRecords: number, periodDays: number): DataStatus {
  if (unitsSold <= 0) return 'No Sales'
  if (periodDays < MIN_HISTORY_DAYS || saleRecords < MIN_SALE_RECORDS) return 'Limited History'
  return 'Sufficient'
}

export interface SalesAggregate {
  units: number
  records: number
  firstSaleDate: string | null
  lastSaleDate: string | null
}

export function buildProductForecast(
  product: { id: string; name: string; category: string },
  sales: SalesAggregate | undefined,
  period: AnalysisPeriod,
  horizonDays: number,
): ProductForecast {
  const units = sales?.units ?? 0
  const records = sales?.records ?? 0
  return {
    productId: product.id,
    productName: product.name,
    category: product.category,
    historicalUnitsSold: units,
    saleRecords: records,
    firstSaleDate: sales?.firstSaleDate ?? null,
    lastSaleDate: sales?.lastSaleDate ?? null,
    historyDays: period.days,
    averageDailyDemand: round2(calcAverageDailyDemand(units, period.days)),
    forecastHorizonDays: horizonDays,
    forecastedDemand: calcForecastedDemand(units, period.days, horizonDays),
    dataStatus: classifyDataStatus(units, records, period.days),
  }
}

// ---------- Database-backed ----------

/** One aggregated row per product, computed in the database. */
async function aggregateSales(db: Db, period: AnalysisPeriod): Promise<Map<string, SalesAggregate>> {
  if (!period.startDate || !period.endDate) return new Map()
  const rows = await db.sale.groupBy({
    by: ['productId'],
    where: { date: { gte: new Date(`${period.startDate}T00:00:00Z`), lte: new Date(`${period.endDate}T00:00:00Z`) } },
    _sum: { quantity: true },
    _count: { _all: true },
    _min: { date: true },
    _max: { date: true },
  })
  return new Map(
    rows.map((r) => [
      r.productId,
      {
        units: r._sum.quantity ?? 0,
        records: r._count._all,
        firstSaleDate: r._min.date ? day(r._min.date) : null,
        lastSaleDate: r._max.date ? day(r._max.date) : null,
      },
    ]),
  )
}

export async function getDemandForecast(
  opts: { horizonDays?: number; period?: AnalysisPeriod } = {},
  db: Db = defaultPrisma,
) {
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS
  const period = opts.period ?? (await getDefaultAnalysisPeriod(db))
  const [products, sales] = await Promise.all([
    db.product.findMany({ select: { id: true, name: true, category: true }, orderBy: { name: 'asc' } }),
    aggregateSales(db, period),
  ])
  return {
    method: 'historical-average-daily-demand',
    note: 'Estimate based on past sales only; not a guarantee.',
    historyPeriod: period,
    forecastHorizonDays: horizonDays,
    reliability: { minHistoryDays: MIN_HISTORY_DAYS, minSaleRecords: MIN_SALE_RECORDS },
    products: products.map((p) => buildProductForecast(p, sales.get(p.id), period, horizonDays)),
  }
}

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../lib/prisma'
import { getAllProductStock, type ProductStock, type StockStatus } from './analytics'

/**
 * Deterministic product insights (Phase 4C). No forecasting, no AI.
 *
 * Analysis period
 *   Default: from the earliest recorded sale date to the latest recorded sale
 *   date, both inclusive. days = (endDate - startDate) in calendar days + 1,
 *   so a period with sales on a single date is 1 day long. With no sales at all
 *   there is no period (startDate/endDate null, days 0).
 *   A custom period can be passed to the functions below; only sales dated
 *   inside it are counted.
 *
 * Formulas
 *   Sales Velocity     = units sold in the period / days in the period   (units per day)
 *   Stock Coverage     = Current Stock / Sales Velocity                  (days)
 *   Current Stock      = Opening Stock + purchased - sold (all time, as in analytics.ts)
 *
 *   Velocity is null when days is 0. Coverage is null when velocity is 0 or
 *   null: "no sales in the period, so coverage cannot be estimated" (never
 *   Infinity/NaN). Velocity and coverage are rounded to 2 decimals.
 *
 * Movement classification (by sales velocity, thresholds are configurable)
 *   No Sales     : no units sold in the period
 *   Fast Moving  : velocity >= fastMinVelocity   (default 2 units/day)
 *   Slow Moving  : 0 < velocity < slowMaxVelocity (default 1 unit/day)
 *   Normal       : everything in between
 *
 * Everything here is read-only.
 */

type Db = PrismaClient | Prisma.TransactionClient

export type Movement = 'Fast Moving' | 'Normal' | 'Slow Moving' | 'No Sales'

export interface MovementThresholds {
  /** Units per day at or above which a product is Fast Moving. */
  fastMinVelocity: number
  /** Units per day below which (but above 0) a product is Slow Moving. */
  slowMaxVelocity: number
}

export const DEFAULT_THRESHOLDS: MovementThresholds = { fastMinVelocity: 2, slowMaxVelocity: 1 }

export interface AnalysisPeriod {
  startDate: string | null
  endDate: string | null
  days: number
}

export interface ProductInsight {
  productId: string
  productName: string
  category: string
  currentStock: number
  minimumStockLevel: number
  totalUnitsSold: number
  salesVelocity: number | null
  stockCoverageDays: number | null
  stockStatus: StockStatus
  movement: Movement
}

const DAY_MS = 86_400_000
const round2 = (n: number) => Math.round(n * 100) / 100
const day = (d: Date) => d.toISOString().slice(0, 10)

// ---------- Pure calculations ----------

/** Inclusive number of calendar days between two YYYY-MM-DD dates (0 if end is before start). */
export function daysBetweenInclusive(startDate: string, endDate: string): number {
  const diff = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS)
  return diff < 0 ? 0 : diff + 1
}

export function makePeriod(startDate: string | null, endDate: string | null): AnalysisPeriod {
  if (!startDate || !endDate) return { startDate: null, endDate: null, days: 0 }
  return { startDate, endDate, days: daysBetweenInclusive(startDate, endDate) }
}

/** Units per day, or null when the period has no days. */
export function calcSalesVelocity(unitsSold: number, periodDays: number): number | null {
  if (periodDays <= 0) return null
  return round2(unitsSold / periodDays)
}

/** Days the current stock will last at the current velocity; null when velocity is 0/unknown. */
export function calcStockCoverageDays(currentStock: number, velocity: number | null): number | null {
  if (velocity === null || velocity <= 0) return null
  return round2(Math.max(currentStock, 0) / velocity)
}

export function classifyMovement(
  unitsSold: number,
  velocity: number | null,
  t: MovementThresholds = DEFAULT_THRESHOLDS,
): Movement {
  if (unitsSold <= 0 || velocity === null || velocity <= 0) return 'No Sales'
  if (velocity >= t.fastMinVelocity) return 'Fast Moving'
  if (velocity < t.slowMaxVelocity) return 'Slow Moving'
  return 'Normal'
}

/** Combines stock levels with sales in the period into per-product insights, ordered by name. */
export function buildProductInsights(
  stock: ProductStock[],
  soldInPeriod: Map<string, number>,
  period: AnalysisPeriod,
  t: MovementThresholds = DEFAULT_THRESHOLDS,
): ProductInsight[] {
  return stock
    .map((s) => {
      const totalUnitsSold = soldInPeriod.get(s.productId) ?? 0
      const salesVelocity = calcSalesVelocity(totalUnitsSold, period.days)
      return {
        productId: s.productId,
        productName: s.name,
        category: s.category,
        currentStock: s.currentStock,
        minimumStockLevel: s.minStockLevel,
        totalUnitsSold,
        salesVelocity,
        stockCoverageDays: calcStockCoverageDays(s.currentStock, salesVelocity),
        stockStatus: s.stockStatus,
        movement: classifyMovement(totalUnitsSold, salesVelocity, t),
      }
    })
    .sort((a, b) => a.productName.localeCompare(b.productName))
}

/** Fast movers: highest velocity first. */
export const fastMoving = (insights: ProductInsight[]) =>
  insights
    .filter((p) => p.movement === 'Fast Moving')
    .sort((a, b) => (b.salesVelocity ?? 0) - (a.salesVelocity ?? 0) || a.productName.localeCompare(b.productName))

/** Slow movers (with some sales): lowest velocity first. */
export const slowMoving = (insights: ProductInsight[]) =>
  insights
    .filter((p) => p.movement === 'Slow Moving')
    .sort((a, b) => (a.salesVelocity ?? 0) - (b.salesVelocity ?? 0) || a.productName.localeCompare(b.productName))

/** Products with no sales in the period. */
export const noSales = (insights: ProductInsight[]) => insights.filter((p) => p.movement === 'No Sales')

// ---------- Database-backed ----------

/** Earliest-to-latest recorded sale date. */
export async function getDefaultAnalysisPeriod(db: Db = defaultPrisma): Promise<AnalysisPeriod> {
  const r = await db.sale.aggregate({ _min: { date: true }, _max: { date: true } })
  return makePeriod(r._min.date ? day(r._min.date) : null, r._max.date ? day(r._max.date) : null)
}

async function soldByProductInPeriod(db: Db, period: AnalysisPeriod): Promise<Map<string, number>> {
  if (!period.startDate || !period.endDate) return new Map()
  const rows = await db.sale.groupBy({
    by: ['productId'],
    where: { date: { gte: new Date(`${period.startDate}T00:00:00Z`), lte: new Date(`${period.endDate}T00:00:00Z`) } },
    _sum: { quantity: true },
  })
  return new Map(rows.map((r) => [r.productId, r._sum.quantity ?? 0]))
}

export async function getProductInsights(
  opts: { period?: AnalysisPeriod; thresholds?: MovementThresholds } = {},
  db: Db = defaultPrisma,
) {
  const period = opts.period ?? (await getDefaultAnalysisPeriod(db))
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS
  const [stock, sold] = await Promise.all([getAllProductStock(db), soldByProductInPeriod(db, period)])
  const products = buildProductInsights(stock, sold, period, thresholds)
  return {
    analysisPeriod: period,
    thresholds,
    products,
    fastMovingProducts: fastMoving(products),
    slowMovingProducts: slowMoving(products),
    noSalesProducts: noSales(products),
  }
}

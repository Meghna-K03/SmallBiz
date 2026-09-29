import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../lib/prisma'
import { getAllProductStock, type ProductStock, type StockStatus } from './analytics'
import { DEFAULT_HORIZON_DAYS, getDemandForecast, type DataStatus, type ProductForecast } from './forecast'
import type { AnalysisPeriod } from './insights'

/**
 * Restocking recommendations (Phase 6). Deterministic; no ML, no AI, and nothing
 * is ordered or written: this only reports a suggested quantity.
 *
 *   Current Stock        = Opening Stock + purchased - sold          (analytics.ts)
 *   Forecasted Demand    = average daily demand x horizon            (forecast.ts)
 *   Target Stock         = Forecasted Demand + Minimum Stock Level
 *   Recommended Quantity = max(0, ceil(Target Stock - Current Stock))
 *
 * Quantities are whole units, rounded up so the target is actually reached.
 * The difference is rounded to 2 decimals first so floating-point noise
 * (e.g. 14.000000001) cannot add a spurious extra unit.
 *
 * Status
 *   Needs Restocking      : recommended quantity > 0. The minimum-stock part of the target does
 *                           not depend on sales history, so this can apply even without history;
 *                           the reason and `dataStatus` say how reliable the demand part is.
 *   No Restocking Needed  : quantity is 0 and demand history is Sufficient.
 *   Insufficient History  : quantity is 0 but demand history is missing (No Sales) or thin
 *                           (Limited History), so "no need" cannot be confirmed from data.
 */

type Db = PrismaClient | Prisma.TransactionClient

export type RestockStatus = 'Needs Restocking' | 'No Restocking Needed' | 'Insufficient History'

export interface RestockRecommendation {
  productId: string
  productName: string
  category: string
  unit: string
  currentStock: number
  stockStatus: StockStatus
  minimumStockLevel: number
  forecastHorizonDays: number
  forecastedDemand: number
  targetStock: number
  recommendedQuantity: number
  status: RestockStatus
  dataStatus: DataStatus
  reason: string
}

const round2 = (n: number) => Math.round(n * 100) / 100
const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`

// ---------- Pure calculations ----------

export const calcTargetStock = (forecastedDemand: number, minStockLevel: number) =>
  round2(forecastedDemand + minStockLevel)

export const calcRecommendedQuantity = (targetStock: number, currentStock: number) =>
  Math.max(0, Math.ceil(round2(targetStock - currentStock)))

export function buildRecommendation(stock: ProductStock, forecast: ProductForecast): RestockRecommendation {
  const targetStock = calcTargetStock(forecast.forecastedDemand, stock.minStockLevel)
  const recommendedQuantity = calcRecommendedQuantity(targetStock, stock.currentStock)
  const { dataStatus, forecastHorizonDays: horizon } = forecast

  const demandNote =
    dataStatus === 'No Sales'
      ? 'no sales history, so expected demand is counted as 0'
      : dataStatus === 'Limited History'
        ? `demand estimate of ${forecast.forecastedDemand} over ${horizon} days is based on limited sales history`
        : `expected demand is ${forecast.forecastedDemand} over ${horizon} days`

  let status: RestockStatus
  let reason: string
  if (recommendedQuantity > 0) {
    status = 'Needs Restocking'
    reason =
      `Current stock ${stock.currentStock} is below the target of ${targetStock} ` +
      `(${demandNote}, plus minimum level ${stock.minStockLevel}). Restock ${units(recommendedQuantity)}.`
  } else if (dataStatus === 'Sufficient') {
    status = 'No Restocking Needed'
    reason = `Current stock ${stock.currentStock} covers the target of ${targetStock} (${demandNote}, plus minimum level ${stock.minStockLevel}).`
  } else {
    status = 'Insufficient History'
    reason =
      `Current stock ${stock.currentStock} meets the minimum level ${stock.minStockLevel}, but ${demandNote}; ` +
      'not enough data to confirm future needs.'
  }

  return {
    productId: stock.productId,
    productName: stock.name,
    category: stock.category,
    unit: stock.unit,
    currentStock: stock.currentStock,
    stockStatus: stock.stockStatus,
    minimumStockLevel: stock.minStockLevel,
    forecastHorizonDays: horizon,
    forecastedDemand: forecast.forecastedDemand,
    targetStock,
    recommendedQuantity,
    status,
    dataStatus,
    reason,
  }
}

// ---------- Database-backed ----------

export async function getRestockingRecommendations(
  opts: { horizonDays?: number; period?: AnalysisPeriod } = {},
  db: Db = defaultPrisma,
) {
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS
  const [stock, forecast] = await Promise.all([
    getAllProductStock(db),
    getDemandForecast({ horizonDays, period: opts.period }, db),
  ])
  const forecastById = new Map(forecast.products.map((f) => [f.productId, f]))
  const products = stock.map((s) => buildRecommendation(s, forecastById.get(s.productId)!))

  const needsRestocking = products
    .filter((p) => p.status === 'Needs Restocking')
    .sort((a, b) => b.recommendedQuantity - a.recommendedQuantity || a.productName.localeCompare(b.productName))

  return {
    method: 'target-stock = forecasted-demand + minimum-stock-level',
    note: 'Suggested quantities based on past sales; nothing is ordered automatically.',
    historyPeriod: forecast.historyPeriod,
    forecastHorizonDays: horizonDays,
    summary: {
      totalProducts: products.length,
      needsRestocking: needsRestocking.length,
      noRestockingNeeded: products.filter((p) => p.status === 'No Restocking Needed').length,
      insufficientHistory: products.filter((p) => p.status === 'Insufficient History').length,
    },
    needsRestocking,
    products,
  }
}

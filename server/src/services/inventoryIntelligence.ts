import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../lib/prisma'
import { getInventoryValue, type StockStatus } from './analytics'
import type { DataStatus } from './forecast'
import { getValidatedForecast, type ValidatedForecast } from './forecasting'
import type { ModelName } from './forecasting/models'
import { calcStockCoverageDays } from './insights'
import { assessPriority, priorityRank, type Priority } from './priority'
import { getRestockingRecommendations, type RestockStatus } from './restocking'

/**
 * Inventory intelligence (Phase 8): one read-only response that joins
 *
 *   verified stock  +  validated forecast  +  restocking calculation  +  rule-based priority
 *
 * Every number is calculated by the backend from the shop's own records. Nothing is
 * ordered and nothing is written. The AI layer only explains these values afterwards.
 */

type Db = PrismaClient | Prisma.TransactionClient

export interface ProductIntelligence {
  productId: string
  productName: string
  category: string
  unit: string
  currentStock: number
  minimumStockLevel: number
  stockStatus: StockStatus
  /** Units per day over the whole history. */
  averageDailyDemand: number
  /** Units per day expected by the selected model. */
  predictedDailyDemand: number
  /** Days current stock lasts at the expected daily demand; null when there is no expected demand. */
  stockCoverageDays: number | null
  forecastHorizonDays: number
  predictedDemand: number
  targetStock: number
  recommendedQuantity: number
  restockStatus: RestockStatus
  restockReason: string
  priority: Priority
  priorityReasons: string[]
  advice: string
  reliabilityNote: string | null
  dataStatus: DataStatus
  forecastModel: ModelName
  /** Error on held-out days (fraction, 0.25 = 25%) for the selected model and the baseline. Null if not validated. */
  testWape: number | null
  baselineTestWape: number | null
}

export async function getInventoryIntelligence(opts: { horizonDays?: number } = {}, db: Db = defaultPrisma) {
  const horizonDays = opts.horizonDays ?? 7
  const validated: ValidatedForecast = await getValidatedForecast({ horizonDays }, db)
  const [restocking, inventoryValue] = await Promise.all([
    getRestockingRecommendations({ horizonDays, validated }, db),
    getInventoryValue(db),
  ])
  const forecastById = new Map(validated.products.map((p) => [p.productId, p]))

  const products = restocking.products
    .map((r): ProductIntelligence => {
      const f = forecastById.get(r.productId)!
      const stockCoverageDays = calcStockCoverageDays(r.currentStock, f.predictedDailyDemand)
      const p = assessPriority({
        currentStock: r.currentStock,
        minStockLevel: r.minimumStockLevel,
        stockCoverageDays,
        horizonDays,
        recommendedQuantity: r.recommendedQuantity,
        dataStatus: r.dataStatus,
      })
      return {
        productId: r.productId,
        productName: r.productName,
        category: r.category,
        unit: r.unit,
        currentStock: r.currentStock,
        minimumStockLevel: r.minimumStockLevel,
        stockStatus: r.stockStatus,
        averageDailyDemand: f.averageDailyDemand,
        predictedDailyDemand: f.predictedDailyDemand,
        stockCoverageDays,
        forecastHorizonDays: horizonDays,
        predictedDemand: r.forecastedDemand,
        targetStock: r.targetStock,
        recommendedQuantity: r.recommendedQuantity,
        restockStatus: r.status,
        restockReason: r.reason,
        priority: p.priority,
        priorityReasons: p.reasons,
        advice: p.advice,
        reliabilityNote: p.reliabilityNote,
        dataStatus: r.dataStatus,
        forecastModel: f.model,
        testWape: f.test?.model.wape ?? null,
        baselineTestWape: f.test?.baseline.wape ?? null,
      }
    })
    .sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        b.recommendedQuantity - a.recommendedQuantity ||
        a.productName.localeCompare(b.productName),
    )

  const count = (p: Priority) => products.filter((x) => x.priority === p).length
  return {
    dataSource: 'Business data: the shop\'s own recorded sales, purchases and stock',
    note: 'Advisory only. Priorities and quantities are calculated by rules from past sales; nothing is ordered automatically.',
    forecastHorizonDays: horizonDays,
    forecast: {
      historyPeriod: validated.historyPeriod,
      split: validated.split,
      selectedModel: validated.selectedModel,
      baselineModel: validated.baselineModel,
      accuracy: validated.accuracy,
      dataQuality: validated.dataQuality,
      limitation: validated.limitation,
    },
    inventoryValue,
    summary: { high: count('High'), medium: count('Medium'), low: count('Low'), totalProducts: products.length },
    products,
  }
}

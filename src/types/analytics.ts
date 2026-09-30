import type { StockStatus } from './index'

/**
 * Shapes returned by the backend analytics endpoints. Every number here is
 * calculated by the backend; the frontend only displays it.
 */

export type HorizonDays = 7 | 14 | 30

export type Movement = 'Fast Moving' | 'Normal' | 'Slow Moving' | 'No Sales'
export type DataStatus = 'No Sales' | 'Limited History' | 'Sufficient'
export type RestockStatus = 'Needs Restocking' | 'No Restocking Needed' | 'Insufficient History'

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
  /** Units per day; null when the period has no days. */
  salesVelocity: number | null
  /** Days the current stock lasts; null when there are no sales. */
  stockCoverageDays: number | null
  stockStatus: StockStatus
  movement: Movement
}

export interface ProductInsightsResponse {
  analysisPeriod: AnalysisPeriod
  products: ProductInsight[]
  fastMovingProducts: ProductInsight[]
  slowMovingProducts: ProductInsight[]
  noSalesProducts: ProductInsight[]
}

export interface ProductForecast {
  productId: string
  productName: string
  category: string
  historicalUnitsSold: number
  averageDailyDemand: number
  forecastHorizonDays: number
  forecastedDemand: number
  dataStatus: DataStatus
}

export interface ForecastResponse {
  note: string
  historyPeriod: AnalysisPeriod
  forecastHorizonDays: number
  products: ProductForecast[]
}

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

export interface RestockingResponse {
  note: string
  forecastHorizonDays: number
  summary: {
    totalProducts: number
    needsRestocking: number
    noRestockingNeeded: number
    insufficientHistory: number
  }
  needsRestocking: RestockRecommendation[]
  products: RestockRecommendation[]
}

/** Request body for POST /analytics/explain: verified values only. */
export interface ExplainRequest {
  product: string
  currentStock: number
  minimumStock: number
  forecastedDemand: number
  recommendedPurchase: number
  status: RestockStatus
  averageDailyDemand: number | null
  stockCoverage: number | null
  forecastHorizonDays: number
}

export interface ExplainResponse {
  explanation: string
  /** 'groq' = AI-written; 'fallback' = plain text built from the same values. */
  source: 'groq' | 'fallback'
}

/** Headline totals from GET /analytics/summary. */
export interface AnalyticsSummary {
  totalRevenue: number
  totalExpenses: number
  estimatedProfit: number
  totalProducts: number
  lowStockProducts: { productId: string; name: string; currentStock: number; minStockLevel: number; stockStatus: StockStatus }[]
}

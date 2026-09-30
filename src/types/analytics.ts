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

export type ForecastModelName = 'historical-mean' | 'moving-average' | 'exponential-smoothing'

export interface Metrics {
  mae: number | null
  /** Fraction, 0.25 = 25%. Null when nothing was sold in the test days. */
  wape: number | null
}

export interface Period {
  startDate: string
  endDate: string
  days: number
}

export interface TestWindowPoint {
  date: string
  actual: number
  predicted: number
}

/** One product's validated forecast. `forecastedDemand` mirrors `predictedDemand` for the existing UI. */
export interface ValidatedProductForecast extends ProductForecast {
  predictedDemand: number
  predictedDailyDemand: number
  model: ForecastModelName
  test: { model: Metrics; baseline: Metrics } | null
  testWindow: TestWindowPoint[]
}

export interface DataQuality {
  historyDays: number
  daysWithSales: number
  daysWithoutAnySales: number
  longestGapDays: number
  warning: string | null
}

export interface ForecastResponse {
  note: string
  historyPeriod: AnalysisPeriod | null
  forecastHorizonDays: number
  products: ValidatedProductForecast[]
  split: { train: Period; validation: Period; test: Period } | null
  selectedModel: { name: ForecastModelName; label: string; description: string }
  baselineModel: ForecastModelName
  accuracy: { selected: Metrics; baseline: Metrics; maeImprovementVsBaseline: number | null } | null
  dataQuality: DataQuality | null
  limitation: string
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
  restockPriority?: Priority
  forecastModel?: 'Historical average' | 'Moving average' | 'Exponential smoothing'
  forecastReliability?: 'Sufficient' | 'Limited History' | 'No Sales'
  forecastErrorPercent?: number | null
}

export interface ExplainResponse {
  explanation: string
  /** 'groq' = AI-written; 'fallback' = plain text built from the same values. */
  source: 'groq' | 'fallback'
}

/** Headline totals from GET /analytics/summary. */
export type Priority = 'High' | 'Medium' | 'Low'

export interface ProductIntelligence {
  productId: string
  productName: string
  category: string
  unit: string
  currentStock: number
  minimumStockLevel: number
  stockStatus: StockStatus
  averageDailyDemand: number
  predictedDailyDemand: number
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
  forecastModel: ForecastModelName
  testWape: number | null
  baselineTestWape: number | null
}

/** GET /analytics/inventory-intelligence: business data only, all values calculated by the backend. */
export interface IntelligenceResponse {
  dataSource: string
  note: string
  forecastHorizonDays: number
  forecast: {
    historyPeriod: AnalysisPeriod | null
    split: ForecastResponse['split']
    selectedModel: ForecastResponse['selectedModel']
    baselineModel: ForecastModelName
    accuracy: ForecastResponse['accuracy']
    dataQuality: DataQuality | null
    limitation: string
  }
  inventoryValue: number
  summary: { high: number; medium: number; low: number; totalProducts: number }
  products: ProductIntelligence[]
}

export interface Provenance {
  sourceName: string
  publisher: string
  officialUrl: string
  license: string | null
  retrievalDate: string | null
  dataPeriod: { from: string; to: string } | null
  fields: string[]
  transformations: string[]
  limitations: string[]
}

export interface CommodityMarketSignal {
  commodity: string
  observations: number
  distinctDates: number
  from: string
  to: string
  earlyAveragePrice: number | null
  lateAveragePrice: number | null
  changePercent: number | null
}

/** GET /external/market-prices: external Indian market data, never mixed with the shop's data. */
export interface MarketPricesResponse {
  kind: 'external-market-data'
  title: string
  notice: string
  status: { state: 'not-configured' | 'invalid'; reason: string } | { state: 'ready'; observations: number }
  provenance: Provenance
  commodities: CommodityMarketSignal[]
}

export interface AnalyticsSummary {
  totalRevenue: number
  totalExpenses: number
  estimatedProfit: number
  inventoryValue: number
  totalProducts: number
  lowStockProducts: { productId: string; name: string; currentStock: number; minStockLevel: number; stockStatus: StockStatus }[]
}

// ---------- Competitive price intelligence (external CSV data; separate from the shop's data) ----------

export type CompetitiveProvenance = 'COLLECTED' | 'DATASET' | 'SAMPLE' | 'TEMPLATE' | 'UNVERIFIED'
export type Availability = 'Available' | 'Out of stock' | 'Unknown'

export interface ValidationReport {
  sourceFile: string
  totalRows: number
  validRows: number
  rejectedRows: number
  templateRows: number
  rejections: { reason: string; count: number; exampleRows: number[] }[]
  warnings: { message: string; count: number }[]
}

export interface CompetitiveFile {
  file: string
  role: 'reference' | 'template' | 'observations'
  error: string | null
  provenance: CompetitiveProvenance | 'REFERENCE' | null
  description: string
  validation: ValidationReport | null
}

export interface PriceObservation {
  productId: string | null
  category: string | null
  brand: string | null
  productName: string
  packSizeValue: number | null
  packSizeUnit: 'g' | 'ml' | 'unit' | null
  platform: string
  mrpInr: number | null
  sellingPriceInr: number | null
  discountPercent: number | null
  available: boolean | null
  provenance: CompetitiveProvenance
  sourceFile: string
}

export interface PlatformCoverageRow {
  platform: string
  sourceFile: string
  provenance: CompetitiveProvenance
  observations: number
  withPrice: number
  inStock: number
  outOfStock: number
  unknownAvailability: number
  verified: boolean
}

export interface PriceUnitEvidence {
  unit: 'paise' | 'unconfirmed'
  divisor: 100 | null
  mrpValuesChecked: number
  mrpDivisibleBy100: number
  medianMrpInrIfPaise: number | null
  explanation: string
}

export type ZeptoSummary =
  | { available: false }
  | {
      available: true
      sourceFile: string
      rawRows: number
      rejectedRows: number
      uniqueRecords: number
      duplicatesMerged: number
      inStock: number
      outOfStock: number
      availabilityRate: number
      averageDiscountPercent: number | null
      discountedShare: number
      priceUnit: PriceUnitEvidence | null
      topDiscounts: PriceObservation[]
      categoryNote: string
    }

export interface ReferenceMatch {
  productId: string
  status: 'confirmed' | 'possible' | 'ambiguous' | 'unmatched'
  reasons: string[]
  observation: PriceObservation | null
  candidates: { productName: string; packSizeValue: number | null; sellingPriceInr: number | null }[]
}

export interface ReferenceComparison {
  productId: string
  productName: string
  brand: string
  packSizeValue: number
  packSizeUnit: string
  platform: string
  matchedName: string
  referenceMrpInr: number
  datasetMrpInr: number | null
  mrpDifferenceInr: number | null
  mrpDifferencePercent: number | null
  sellingPriceInr: number | null
  discountPercent: number | null
  availability: Availability
  provenance: CompetitiveProvenance
}

export interface PairComparison {
  platformA: string
  platformB: string
  priceA: number
  priceB: number
  differenceInr: number
  differencePercent: number
}

export interface PlatformComparisonRow {
  productId: string
  productName: string
  brand: string | null
  packSizeValue: number | null
  packSizeUnit: string | null
  platforms: { platform: string; sellingPriceInr: number | null; mrpInr: number | null; discountPercent: number | null; available: boolean | null }[]
  cheapest: { platform: string; sellingPriceInr: number } | null
  highest: { platform: string; sellingPriceInr: number } | null
  spreadInr: number | null
  spreadPercent: number | null
  zeptoVsBlinkit: PairComparison | null
}

export interface PlatformComparisonSet {
  basis: 'COLLECTED' | 'SAMPLE'
  label: string
  productsCompared: number
  perPlatform: { platform: string; observations: number; averageDiscountPercent: number | null; availabilityRate: number | null; timesCheapest: number }[]
  zeptoVsBlinkit: {
    productsCompared: number
    zeptoCheaper: number
    blinkitCheaper: number
    samePrice: number
    averageDifferenceInr: number | null
    definition: string
  }
  comparisons: PlatformComparisonRow[]
}

/** GET /analytics/competitive-prices: everything is calculated and labelled by the backend. */
export interface ShopComparisonRow {
  shopProductId: string
  shopProductName: string
  shopPriceInr: number
  matchedName: string
  platform: string
  platformPriceInr: number
  differenceInr: number
  differencePercent: number
  verdict: 'shop-higher' | 'shop-lower' | 'similar'
}

export interface ShopComparisonResponse {
  platform?: string
  /** DATASET = provided Zepto dataset; SAMPLE = illustrative sample rows (Blinkit). */
  basis?: 'DATASET' | 'SAMPLE'
  source: string
  note: string
  productsChecked: number
  matchCounts: { confirmed: number; possible: number; unmatched: number }
  possibleProducts?: { name: string; reason: string }[]
  comparisons: ShopComparisonRow[]
}

export interface CompetitivePricesResponse {
  kind: 'external-competitive-prices'
  notice: string
  dataDirectory: string
  files: CompetitiveFile[]
  platformCoverage: PlatformCoverageRow[]
  verifiedPlatforms: string[]
  blinkit: { verifiedObservations: number; sampleObservations: number; message: string | null }
  zepto: ZeptoSummary
  reference: {
    products: number
    statusCounts: { confirmed: number; possible: number; ambiguous: number; unmatched: number }
    matches: ReferenceMatch[]
  }
  referenceComparisons: ReferenceComparison[]
  platformComparisons: PlatformComparisonSet[]
  limitations: string[]
}

export interface ComparisonExplainRequest {
  productId: string
  kind: 'platform-price' | 'reference-mrp'
  platformA?: string
  platformB?: string
}

export interface ComparisonExplainResponse extends ExplainResponse {
  basis: 'Sample data' | 'Provided dataset' | 'Collected'
}

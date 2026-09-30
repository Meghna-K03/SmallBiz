/**
 * Canonical types for Competitive Price Intelligence.
 *
 * This is EXTERNAL market context read from CSV files. It is never stored in the
 * database and never feeds sales, stock, forecasting, restocking or inventory
 * intelligence. Only fields the source really contains are populated; everything
 * else is null ("unknown"), never guessed.
 */

/**
 * How far a row can honestly be trusted as an observation:
 *   COLLECTED   labelled collected AND carries a price/availability value
 *   DATASET     a provided third-party dataset; collection date and method are not documented
 *   SAMPLE      labelled sample data: illustrative only, not a real observation
 *   TEMPLATE    an empty template row (no price, no availability): not an observation at all
 *   UNVERIFIED  the data_source label is missing or unrecognised
 */
export type Provenance = 'COLLECTED' | 'DATASET' | 'SAMPLE' | 'TEMPLATE' | 'UNVERIFIED'

export type PackUnit = 'g' | 'ml' | 'unit'

export interface PriceObservation {
  /** Reference product id (basket) when the source has one; null otherwise. */
  productId: string | null
  category: string | null
  brand: string | null
  productName: string
  packSizeValue: number | null
  packSizeUnit: PackUnit | null
  platform: string
  mrpInr: number | null
  sellingPriceInr: number | null
  /** As published by the source when present, otherwise computed from MRP and selling price. */
  discountPercent: number | null
  /** true = in stock, false = out of stock, null = unknown. */
  available: boolean | null
  availableQuantity: number | null
  /** The source's own `quantity` field. Meaning is not documented; never used for matching. */
  sourceQuantity: number | null
  /** No source file records a date or a location, so these are null for all current data. */
  dateChecked: string | null
  location: string | null
  /** The source's own label (for example SAMPLE), or the dataset name. */
  dataSource: string
  provenance: Provenance
  sourceFile: string
  /** 1-based CSV line numbers this record came from (more than one when duplicates were merged). */
  sourceRows: number[]
  /** How many identical rows were merged into this record (1 = none). */
  duplicates: number
  /** All category labels the source used for this record (the Zepto file repeats products under several). */
  sourceCategories: string[]
  /** True when the same product and pack appear with different prices/stock; such records are never compared. */
  conflicting: boolean
}

export interface ReferenceProduct {
  productId: string
  category: string
  brand: string
  productName: string
  packSizeValue: number
  packSizeUnit: PackUnit
  referenceMrpInr: number
}

export interface Rejection {
  reason: string
  count: number
  /** First few 1-based CSV lines, for finding the rows. */
  exampleRows: number[]
}

export interface ValidationReport {
  sourceFile: string
  totalRows: number
  validRows: number
  rejectedRows: number
  /** Rows that are empty templates (no price and no availability): counted, neither valid nor rejected. */
  templateRows: number
  rejections: Rejection[]
  /** Suspicious but accepted values. */
  warnings: { message: string; count: number }[]
}

export type FileRole = 'reference' | 'template' | 'observations'

export interface FileSummary {
  file: string
  role: FileRole
  /** Present when the file could not be read or has the wrong columns. */
  error: string | null
  provenance: Provenance | 'REFERENCE' | null
  description: string
  validation: ValidationReport | null
}

export type MatchStatus = 'confirmed' | 'possible' | 'ambiguous' | 'unmatched'

export interface MatchResult {
  productId: string
  status: MatchStatus
  reasons: string[]
  /** Set only when status is 'confirmed'. */
  observation: PriceObservation | null
  /** Near candidates for 'possible' matches: shown, never compared. */
  candidates: { productName: string; packSizeValue: number | null; sellingPriceInr: number | null }[]
}

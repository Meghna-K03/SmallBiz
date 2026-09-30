import { discountPercent } from './calculations'
import { readTable, ReportBuilder, toNumber } from './table'
import type { PackUnit, PriceObservation, Provenance, ValidationReport } from './types'

/**
 * prices.csv / prices_template.csv: one row per (product, platform).
 *
 * The `data_source` label is NOT trusted on its own:
 *   - a row with neither a price nor an availability value is an empty TEMPLATE row, whatever
 *     its label says (a file can be labelled COLLECTED and still contain nothing);
 *   - SAMPLE rows are kept but stay SAMPLE: illustrative, never presented as collected data;
 *   - COLLECTED is only granted to a row labelled COLLECTED that carries actual values.
 */

const REQUIRED = [
  'product_id', 'category', 'brand', 'product_name', 'pack_size_value', 'pack_size_unit',
  'platform', 'mrp_inr', 'selling_price_inr', 'available', 'data_source',
]
const UNITS: PackUnit[] = ['g', 'ml', 'unit']

export type PlatformPricesResult =
  | { ok: true; observations: PriceObservation[]; report: ValidationReport; labelConflicts: number }
  | { ok: false; reason: string }

function parseAvailable(text: string): boolean | null | 'invalid' {
  const v = text.toLowerCase()
  if (v === '') return null
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return 'invalid'
}

export function parsePlatformPrices(text: string, sourceFile: string): PlatformPricesResult {
  const t = readTable(text, REQUIRED)
  if (!t.ok) return t
  const report = new ReportBuilder(sourceFile)
  const observations: PriceObservation[] = []
  const seen = new Set<string>()
  let labelConflicts = 0

  for (const { line, cells } of t.table.rows) {
    report.totalRows++
    const label = cells.data_source.toUpperCase()
    const mrp = toNumber(cells.mrp_inr)
    const selling = toNumber(cells.selling_price_inr)
    const available = parseAvailable(cells.available)
    const size = toNumber(cells.pack_size_value)
    const unit = cells.pack_size_unit.toLowerCase() as PackUnit

    // Empty template row: no price and no availability. Not an observation, whatever the label says.
    if (selling === null && available === null) {
      report.templateRows++
      if (label === 'COLLECTED') labelConflicts++
      continue
    }

    if (!cells.platform) report.reject('missing platform', line)
    else if (!cells.product_name) report.reject('missing product name', line)
    else if (available === 'invalid') report.reject('invalid availability value', line)
    else if (Number.isNaN(mrp) || (mrp !== null && mrp <= 0)) report.reject('invalid MRP', line)
    else if (Number.isNaN(selling) || (selling !== null && selling <= 0)) report.reject('invalid or non-positive selling price', line)
    else if (selling !== null && mrp !== null && selling > mrp) report.reject('selling price above MRP', line)
    else if (selling === null && available === true) report.reject('marked available but has no price', line)
    else if (size !== null && (Number.isNaN(size) || size <= 0)) report.reject('invalid pack size', line)
    else if (cells.pack_size_unit && !UNITS.includes(unit)) report.reject('unknown pack size unit', line)
    else {
      const key = `${cells.product_id || cells.product_name.toLowerCase()}|${cells.platform.toLowerCase()}`
      if (seen.has(key)) {
        report.reject('duplicate observation (product + platform)', line)
        continue
      }
      seen.add(key)

      if (!cells.category) report.warn('missing category')
      let provenance: Provenance
      if (label === 'SAMPLE') provenance = 'SAMPLE'
      else if (label === 'COLLECTED') provenance = 'COLLECTED'
      else {
        provenance = 'UNVERIFIED'
        report.warn(`data_source label "${cells.data_source}" is not recognised (treated as unverified)`)
      }
      if (selling === null) report.warn('unavailable rows with no price (price unknown, not zero)')

      report.validRows++
      observations.push({
        productId: cells.product_id || null,
        category: cells.category || null,
        brand: cells.brand || null,
        productName: cells.product_name,
        packSizeValue: size,
        packSizeUnit: size === null ? null : unit,
        platform: cells.platform,
        mrpInr: mrp,
        sellingPriceInr: selling,
        discountPercent: discountPercent(mrp, selling),
        available,
        availableQuantity: null,
        sourceQuantity: null,
        dateChecked: null,
        location: null,
        dataSource: cells.data_source || 'unlabelled',
        provenance,
        sourceFile,
        sourceRows: [line],
        duplicates: 1,
        sourceCategories: cells.category ? [cells.category] : [],
        conflicting: false,
      })
    }
  }

  if (labelConflicts > 0) {
    report.warn(`rows labelled COLLECTED that contain no price and no availability (treated as empty template rows)`, labelConflicts)
  }
  return { ok: true, observations, report: report.build(), labelConflicts }
}

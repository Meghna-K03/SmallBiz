import { readTable, ReportBuilder, toNumber } from './table'
import type { PackUnit, ReferenceProduct, ValidationReport } from './types'

/**
 * basket.csv: the REFERENCE product basket (what to look for). It holds product identity,
 * pack size and a reference MRP. It is not a set of platform observations.
 */

const REQUIRED = ['product_id', 'category', 'brand', 'product_name', 'pack_size_value', 'pack_size_unit', 'reference_mrp_inr']
const UNITS: PackUnit[] = ['g', 'ml', 'unit']

export type BasketResult =
  | { ok: true; products: ReferenceProduct[]; report: ValidationReport }
  | { ok: false; reason: string }

export function parseBasket(text: string, sourceFile: string): BasketResult {
  const t = readTable(text, REQUIRED)
  if (!t.ok) return t
  const report = new ReportBuilder(sourceFile)
  const products: ReferenceProduct[] = []
  const seen = new Set<string>()

  for (const { line, cells } of t.table.rows) {
    report.totalRows++
    const id = cells.product_id
    const size = toNumber(cells.pack_size_value)
    const mrp = toNumber(cells.reference_mrp_inr)
    const unit = cells.pack_size_unit.toLowerCase() as PackUnit
    if (!id) report.reject('missing product_id', line)
    else if (seen.has(id)) report.reject('duplicate product_id', line)
    else if (!cells.product_name) report.reject('missing product name', line)
    else if (!cells.brand) report.reject('missing brand', line)
    else if (size === null || Number.isNaN(size) || size <= 0) report.reject('invalid pack size', line)
    else if (!UNITS.includes(unit)) report.reject('unknown pack size unit', line)
    else if (mrp === null || Number.isNaN(mrp) || mrp <= 0) report.reject('invalid reference MRP', line)
    else {
      if (!cells.category) report.warn('missing category')
      seen.add(id)
      report.validRows++
      products.push({
        productId: id,
        category: cells.category || 'Uncategorised',
        brand: cells.brand,
        productName: cells.product_name,
        packSizeValue: size,
        packSizeUnit: unit,
        referenceMrpInr: mrp,
      })
    }
  }
  return { ok: true, products, report: report.build() }
}

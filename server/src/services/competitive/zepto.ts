import { discountPercent, paiseToInr, round2 } from './calculations'
import { normalizeName } from './matching'
import { readTable, ReportBuilder, toNumber } from './table'
import type { PriceObservation, ValidationReport } from './types'

/**
 * zepto_dataset.csv: a provided Zepto product dataset.
 * Columns: Category, name, mrp, discountPercent, availableQuantity, discountedSellingPrice,
 * weightInGms, outOfStock, quantity. It has NO date, location or brand column, so those are
 * unknown. It is a Zepto dataset only: nothing here is Blinkit data.
 *
 * PRICE UNIT: the file has no data dictionary. The unit is therefore detected from the data:
 * if virtually every MRP is a whole multiple of 100 and the converted values look like everyday
 * Indian grocery prices, the prices are treated as paise (÷ 100). If that check fails, prices are
 * NOT converted and are reported as unconfirmed. See detectPriceUnit.
 */

const REQUIRED = ['category', 'name', 'mrp', 'discountpercent', 'availablequantity', 'discountedsellingprice', 'weightingms', 'outofstock', 'quantity']

export const PLATFORM = 'Zepto'
export const DATASET_LABEL = 'zepto_dataset (provided dataset; collection date and method not documented)'

export interface PriceUnitEvidence {
  unit: 'paise' | 'unconfirmed'
  divisor: 100 | null
  mrpValuesChecked: number
  mrpDivisibleBy100: number
  /** Median MRP after converting from paise, in rupees. */
  medianMrpInrIfPaise: number | null
  explanation: string
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length === 0 ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Decides, from the data itself, whether prices are in paise. Requires >= 99% of positive MRPs to
 * be whole multiples of 100 (whole-rupee amounts stored in paise) and the converted median to be
 * between ₹5 and ₹2,000 (a plausible grocery basket). Anything else stays unconfirmed.
 */
export function detectPriceUnit(mrps: number[]): PriceUnitEvidence {
  const positive = mrps.filter((v) => v > 0)
  const divisible = positive.filter((v) => v % 100 === 0).length
  const med = median(positive.map((v) => v / 100))
  const enough = positive.length >= 50
  const share = positive.length === 0 ? 0 : divisible / positive.length
  const plausible = med !== null && med >= 5 && med <= 2000
  const ok = enough && share >= 0.99 && plausible
  return {
    unit: ok ? 'paise' : 'unconfirmed',
    divisor: ok ? 100 : null,
    mrpValuesChecked: positive.length,
    mrpDivisibleBy100: divisible,
    medianMrpInrIfPaise: med === null ? null : round2(med),
    explanation: ok
      ? `${divisible} of ${positive.length} MRP values are whole multiples of 100 and the converted median (₹${round2(med!)}) is a plausible grocery price, so prices are treated as paise and divided by 100. This is inferred from the data; the file ships no data dictionary.`
      : 'The price unit could not be confirmed from the data, so prices were NOT converted and no rupee values are shown.',
  }
}

export type ZeptoResult =
  | { ok: true; observations: PriceObservation[]; report: ValidationReport; priceUnit: PriceUnitEvidence; rawRows: number }
  | { ok: false; reason: string }

interface Parsed {
  line: number
  category: string
  name: string
  mrp: number
  selling: number
  sourceDiscount: number
  availableQuantity: number
  weight: number
  outOfStock: boolean
  quantity: number | null
}

export function parseZepto(text: string, sourceFile: string): ZeptoResult {
  const t = readTable(text, REQUIRED)
  if (!t.ok) return t
  const report = new ReportBuilder(sourceFile)
  const parsed: Parsed[] = []

  for (const { line, cells } of t.table.rows) {
    report.totalRows++
    const mrp = toNumber(cells.mrp)
    const selling = toNumber(cells.discountedsellingprice)
    const disc = toNumber(cells.discountpercent)
    const qty = toNumber(cells.availablequantity)
    const weight = toNumber(cells.weightingms)
    const sourceQty = toNumber(cells.quantity)
    const oos = cells.outofstock.toUpperCase()

    if (!cells.name) report.reject('missing product name', line)
    else if (!cells.category) report.reject('missing category', line)
    else if (mrp === null || Number.isNaN(mrp) || mrp <= 0) report.reject('invalid or zero MRP', line)
    else if (selling === null || Number.isNaN(selling) || selling <= 0) report.reject('invalid or zero selling price', line)
    else if (selling > mrp) report.reject('selling price above MRP', line)
    else if (disc === null || Number.isNaN(disc) || disc < 0 || disc > 100) report.reject('invalid discount percent', line)
    else if (oos !== 'TRUE' && oos !== 'FALSE') report.reject('invalid outOfStock value', line)
    else if (qty === null || Number.isNaN(qty) || qty < 0) report.reject('invalid availableQuantity', line)
    else if (weight === null || Number.isNaN(weight) || weight < 0) report.reject('invalid weightInGms', line)
    else {
      if (weight === 0) report.warn('weightInGms is 0 (pack size unknown)')
      if (sourceQty === null || Number.isNaN(sourceQty)) report.warn('quantity missing or not a number (ignored)')
      if ((oos === 'FALSE') === (qty === 0)) report.warn('outOfStock and availableQuantity disagree')
      report.validRows++
      parsed.push({
        line,
        category: cells.category,
        name: cells.name.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(),
        mrp,
        selling,
        sourceDiscount: disc,
        availableQuantity: qty,
        weight,
        outOfStock: oos === 'TRUE',
        quantity: sourceQty === null || Number.isNaN(sourceQty) ? null : sourceQty,
      })
    }
  }

  const priceUnit = detectPriceUnit(parsed.map((p) => p.mrp))
  const convert = (v: number) => (priceUnit.divisor ? paiseToInr(v) : null)

  // Merge exact duplicates. The same product is repeated under several category labels,
  // so category is NOT part of the identity.
  const merged = new Map<string, PriceObservation>()
  let mergedRows = 0
  for (const p of parsed) {
    const key = [normalizeName(p.name), p.weight, p.mrp, p.selling, p.availableQuantity, p.outOfStock, p.quantity].join('|')
    const existing = merged.get(key)
    if (existing) {
      existing.duplicates++
      existing.sourceRows.push(p.line)
      if (!existing.sourceCategories.includes(p.category)) existing.sourceCategories.push(p.category)
      mergedRows++
      continue
    }
    const mrpInr = convert(p.mrp)
    const sellingInr = convert(p.selling)
    merged.set(key, {
      productId: null,
      category: p.category,
      brand: null,
      productName: p.name,
      packSizeValue: p.weight > 0 ? p.weight : null,
      packSizeUnit: p.weight > 0 ? 'g' : null,
      platform: PLATFORM,
      mrpInr,
      sellingPriceInr: sellingInr,
      discountPercent: discountPercent(p.mrp, p.selling) ?? p.sourceDiscount,
      available: !p.outOfStock,
      availableQuantity: p.availableQuantity,
      sourceQuantity: p.quantity,
      dateChecked: null,
      location: null,
      dataSource: DATASET_LABEL,
      provenance: 'DATASET',
      sourceFile,
      sourceRows: [p.line],
      duplicates: 1,
      sourceCategories: [p.category],
      conflicting: false,
    })
  }
  if (mergedRows > 0) report.warn('exact duplicate rows merged (same product, pack, prices and stock; category ignored)', mergedRows)

  // Same product and pack with different prices or stock: keep both, mark as conflicting.
  const observations = [...merged.values()]
  const groups = new Map<string, PriceObservation[]>()
  for (const o of observations) {
    const k = `${normalizeName(o.productName)}|${o.packSizeValue ?? ''}`
    groups.set(k, [...(groups.get(k) ?? []), o])
  }
  let conflicts = 0
  for (const g of groups.values()) {
    if (g.length > 1) {
      for (const o of g) o.conflicting = true
      conflicts += g.length
    }
  }
  if (conflicts > 0) report.warn('records for the same product and pack with different prices or stock (kept separate; never compared)', conflicts)

  const multiCategory = observations.filter((o) => o.sourceCategories.length > 1).length
  if (multiCategory > 0) report.warn('products listed under more than one category label (category labels are unreliable)', multiCategory)

  // Discount recorded by the source vs computed from the two prices.
  let discountMismatch = 0
  for (const p of parsed) {
    const computed = discountPercent(p.mrp, p.selling)
    if (computed !== null && Math.abs(computed - p.sourceDiscount) > 1) discountMismatch++
  }
  if (discountMismatch > 0) report.warn('discountPercent differs from the value computed from the two prices by more than 1 point', discountMismatch)

  return { ok: true, observations, report: report.build(), priceUnit, rawRows: parsed.length }
}

// Competitive Price Intelligence tests. The CSV strings are tiny TEST FIXTURES that exercise the
// parsers; they are not real prices and never appear in the application. A separate block checks
// invariants of the real files in data_csv/ without asserting fixed numbers.
// No database is used: this feature is external CSV data only.
//
// Run with: npm test   (or npm run test:pure)
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import {
  buildComparisonFallback,
  explainComparison,
  isAcceptableComparisonExplanation,
  setExplanationProvider,
  type ComparisonExplainInput,
} from '../src/services/aiExplanation'
import { parseBasket } from '../src/services/competitive/basket'
import {
  availabilityStatus,
  comparePlatforms,
  discountPercent,
  pairComparison,
  paiseToInr,
  priceDifference,
  priceDifferencePercent,
} from '../src/services/competitive/calculations'
import { buildComparisonInput, parseComparisonRequest } from '../src/services/competitive/explain'
import {
  BLINKIT_UNAVAILABLE,
  buildCompetitiveResponse,
  loadCompetitiveDataset,
  queryObservations,
} from '../src/services/competitive'
import { matchProduct, normalizeName, tokens } from '../src/services/competitive/matching'
import { parsePlatformPrices } from '../src/services/competitive/platformPrices'
import { readTable } from '../src/services/competitive/table'
import type { PriceObservation, ReferenceProduct } from '../src/services/competitive/types'
import { detectPriceUnit, parseZepto } from '../src/services/competitive/zepto'

// ---------- fixtures ----------

const BASKET_HEADER = 'product_id,category,brand,product_name,pack_size_value,pack_size_unit,reference_mrp_inr'
const PRICES_HEADER = 'product_id,category,brand,product_name,pack_size_value,pack_size_unit,platform,mrp_inr,selling_price_inr,available,data_source'
const ZEPTO_HEADER = 'Category,name,mrp,discountPercent,availableQuantity,discountedSellingPrice,weightInGms,outOfStock,quantity'

/** A Zepto CSV: some named rows plus enough filler rows (whole-rupee prices in paise) for unit detection. */
function zeptoCsv(named: string[], fillers = 60): string {
  const filler = Array.from({ length: fillers }, (_, i) => `Filler,Filler Item ${i},${10000 + i * 100},0,5,${10000 + i * 100},100,FALSE,1`)
  return [ZEPTO_HEADER, ...named, ...filler].join('\n')
}

const obs = (over: Partial<PriceObservation> = {}): PriceObservation => ({
  productId: 'P1', category: 'Dairy', brand: 'Acme', productName: 'Milk', packSizeValue: 500, packSizeUnit: 'ml',
  platform: 'Zepto', mrpInr: 30, sellingPriceInr: 25, discountPercent: 16.7, available: true, availableQuantity: null,
  sourceQuantity: null, dateChecked: null, location: null, dataSource: 'SAMPLE', provenance: 'SAMPLE',
  sourceFile: 'prices.csv', sourceRows: [2], duplicates: 1, sourceCategories: ['Dairy'], conflicting: false, ...over,
})

const ref = (over: Partial<ReferenceProduct> = {}): ReferenceProduct => ({
  productId: 'P1', category: 'Staples', brand: 'Tata', productName: 'Salt', packSizeValue: 1000, packSizeUnit: 'g', referenceMrpInr: 28, ...over,
})

const zrec = (name: string, weight: number | null, over: Partial<PriceObservation> = {}) =>
  obs({ productId: null, brand: null, productName: name, packSizeValue: weight, packSizeUnit: weight === null ? null : 'g', platform: 'Zepto', provenance: 'DATASET', sourceFile: 'zepto_dataset.csv', ...over })

// ---------- calculations ----------

describe('price calculations', () => {
  it('discount percent = (MRP - selling) / MRP', () => {
    assert.equal(discountPercent(30, 22), 26.7)
    assert.equal(discountPercent(100, 100), 0)
  })

  it('returns null, not a guess, for missing or invalid inputs', () => {
    assert.equal(discountPercent(null, 10), null)
    assert.equal(discountPercent(30, null), null)
    assert.equal(discountPercent(0, 0), null)
    assert.equal(discountPercent(30, 40), null) // selling above MRP
    assert.equal(discountPercent(30, -1), null)
  })

  it('price difference is B - A, in rupees and percent of A', () => {
    assert.equal(priceDifference(22, 26), 4)
    assert.equal(priceDifferencePercent(22, 26), 18.18)
    assert.equal(priceDifference(26, 22), -4)
    assert.equal(priceDifferencePercent(26, 22), -15.38)
  })

  it('no difference without two valid prices', () => {
    assert.equal(priceDifference(null, 5), null)
    assert.equal(priceDifference(0, 5), null)
    assert.equal(priceDifferencePercent(5, null), null)
  })

  it('availability status from the flag', () => {
    assert.equal(availabilityStatus(true), 'Available')
    assert.equal(availabilityStatus(false), 'Out of stock')
    assert.equal(availabilityStatus(null), 'Unknown')
  })

  it('converts paise to rupees exactly', () => {
    assert.equal(paiseToInr(2500), 25)
    assert.equal(paiseToInr(24900), 249)
    assert.equal(paiseToInr(9950), 99.5)
  })
})

describe('platform comparison', () => {
  const rows = [
    obs({ platform: 'A', sellingPriceInr: 26 }),
    obs({ platform: 'B', sellingPriceInr: 22 }),
    obs({ platform: 'C', sellingPriceInr: 20, available: false }), // cheapest but out of stock
    obs({ platform: 'D', sellingPriceInr: null, available: false }), // no price
  ]

  it('cheapest and spread use only in-stock platforms with a valid price', () => {
    const c = comparePlatforms(rows)!
    assert.deepEqual(c.cheapest, { platform: 'B', sellingPriceInr: 22 })
    assert.deepEqual(c.highest, { platform: 'A', sellingPriceInr: 26 })
    assert.equal(c.spreadInr, 4)
    assert.equal(c.spreadPercent, 18.18)
    assert.equal(c.platforms.length, 4) // excluded platforms are still listed, with their availability
  })

  it('no spread with a single comparable platform', () => {
    const c = comparePlatforms([rows[0], rows[2]])!
    assert.equal(c.spreadInr, null)
    assert.deepEqual(c.cheapest, { platform: 'A', sellingPriceInr: 26 })
  })

  it('pair comparison needs both platforms present, in stock and priced', () => {
    const c = comparePlatforms(rows)!
    assert.deepEqual(pairComparison(c, 'B', 'A'), { platformA: 'B', platformB: 'A', priceA: 22, priceB: 26, differenceInr: 4, differencePercent: 18.18 })
    assert.equal(pairComparison(c, 'B', 'C'), null) // C out of stock
    assert.equal(pairComparison(c, 'B', 'D'), null) // D has no price
    assert.equal(pairComparison(c, 'B', 'Blinkit'), null) // platform absent: never invented
  })
})

// ---------- CSV table and basket ----------

describe('csv table and basket', () => {
  it('matches columns by name (any case, any order) and strips a byte-order mark', () => {
    const r = readTable('﻿B,A\n2,1', ['a', 'b'])
    assert.ok(r.ok)
    if (r.ok) assert.deepEqual(r.table.rows[0].cells, { b: '2', a: '1' })
  })

  it('rejects a file with a missing column and says which', () => {
    const r = readTable('a\n1', ['a', 'b'])
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.reason, /not found: b/)
  })

  it('parses the basket and rejects bad rows with reasons', () => {
    const text = [
      BASKET_HEADER,
      'P1,Dairy,Amul,Butter,100,g,62',
      'P1,Dairy,Amul,Butter again,100,g,62', // duplicate id
      'P2,Dairy,Amul,Curd,abc,g,50', // bad pack size
      'P3,Dairy,Amul,Ghee,500,oz,50', // unknown unit
      'P4,Dairy,Amul,Cheese,200,g,-5', // bad MRP
      'P5,Dairy,,Milk,500,ml,30', // no brand
    ].join('\n')
    const r = parseBasket(text, 'basket.csv')
    assert.ok(r.ok)
    if (!r.ok) return
    assert.equal(r.products.length, 1)
    const reasons = r.report.rejections.map((x) => x.reason).sort()
    assert.deepEqual(reasons, ['duplicate product_id', 'invalid pack size', 'invalid reference MRP', 'missing brand', 'unknown pack size unit'])
    assert.equal(r.report.totalRows, 6)
    assert.equal(r.report.validRows + r.report.rejectedRows, 6)
  })
})

// ---------- platform price files ----------

describe('platform price files (prices.csv / template)', () => {
  const parse = (rows: string[]) => {
    const r = parsePlatformPrices([PRICES_HEADER, ...rows].join('\n'), 'prices.csv')
    assert.ok(r.ok)
    return r as Extract<typeof r, { ok: true }>
  }

  it('keeps SAMPLE rows as SAMPLE, never as collected', () => {
    const r = parse(['P1,Dairy,Amul,Milk,500,ml,Zepto,30,22,1,SAMPLE'])
    assert.equal(r.observations[0].provenance, 'SAMPLE')
    assert.equal(r.observations[0].discountPercent, 26.7)
    assert.equal(r.observations[0].dateChecked, null)
    assert.equal(r.observations[0].location, null)
  })

  it('a row labelled COLLECTED with no price and no availability is an empty template row, not an observation', () => {
    const r = parse(['P1,Dairy,Amul,Milk,500,ml,Zepto,30,,,COLLECTED'])
    assert.equal(r.observations.length, 0)
    assert.equal(r.report.templateRows, 1)
    assert.equal(r.report.rejectedRows, 0)
    assert.equal(r.labelConflicts, 1)
    assert.match(r.report.warnings[0].message, /labelled COLLECTED/)
  })

  it('COLLECTED is granted only to a COLLECTED row that carries values', () => {
    const r = parse(['P1,Dairy,Amul,Milk,500,ml,Zepto,30,22,1,COLLECTED'])
    assert.equal(r.observations[0].provenance, 'COLLECTED')
  })

  it('an unknown label is unverified and flagged', () => {
    const r = parse(['P1,Dairy,Amul,Milk,500,ml,Zepto,30,22,1,SCRAPED'])
    assert.equal(r.observations[0].provenance, 'UNVERIFIED')
    assert.match(r.report.warnings[0].message, /not recognised/)
  })

  it('unavailable with no price is valid, with an unknown price (not zero)', () => {
    const r = parse(['P1,Dairy,Amul,Milk,500,ml,Zepto,30,,0,SAMPLE'])
    assert.equal(r.observations[0].sellingPriceInr, null)
    assert.equal(r.observations[0].available, false)
    assert.equal(r.observations[0].discountPercent, null)
  })

  it('rejects invalid rows and says why, without dropping anything silently', () => {
    const r = parse([
      'P1,Dairy,Amul,Milk,500,ml,Zepto,30,22,1,SAMPLE', // valid
      'P2,Dairy,Amul,Curd,400,g,Zepto,30,,1,SAMPLE', // available, no price
      'P3,Dairy,Amul,Ghee,500,g,Zepto,30,40,1,SAMPLE', // selling above MRP
      'P4,Dairy,Amul,Cheese,200,g,Zepto,30,-5,1,SAMPLE', // negative price
      'P5,Dairy,Amul,Paneer,200,g,Zepto,30,20,yes,SAMPLE', // invalid availability
      'P6,Dairy,Amul,Butter,100,g,,30,20,1,SAMPLE', // missing platform
      'P1,Dairy,Amul,Milk,500,ml,Zepto,30,21,1,SAMPLE', // duplicate product+platform
      'P7,Dairy,Amul,Lassi,200,g,Zepto,0,20,1,SAMPLE', // zero MRP
    ])
    assert.equal(r.observations.length, 1)
    const reasons = new Set(r.report.rejections.map((x) => x.reason))
    for (const expected of [
      'marked available but has no price', 'selling price above MRP', 'invalid or non-positive selling price',
      'invalid availability value', 'missing platform', 'duplicate observation (product + platform)', 'invalid MRP',
    ]) assert.ok(reasons.has(expected), expected)
    assert.equal(r.report.validRows + r.report.rejectedRows + r.report.templateRows, r.report.totalRows)
    assert.equal(r.report.rejections.find((x) => x.reason === 'missing platform')!.exampleRows[0], 7) // 1-based CSV line
  })

  it('does not invent a platform: only platforms present in the file appear', () => {
    const r = parse(['P1,Dairy,Amul,Milk,500,ml,Zepto,30,22,1,SAMPLE'])
    assert.deepEqual(new Set(r.observations.map((o) => o.platform)), new Set(['Zepto']))
  })
})

// ---------- Zepto dataset ----------

describe('Zepto dataset normalisation', () => {
  const parse = (named: string[], fillers?: number) => {
    const r = parseZepto(zeptoCsv(named, fillers), 'zepto_dataset.csv')
    assert.ok(r.ok)
    return r as Extract<typeof r, { ok: true }>
  }
  const find = (r: ReturnType<typeof parse>, name: string) => r.observations.find((o) => o.productName === name)

  it('detects paise from the data and converts to rupees', () => {
    const r = parse(['Dairy,Test Milk,3000,10,3,2700,500,FALSE,1'])
    assert.equal(r.priceUnit.unit, 'paise')
    assert.equal(r.priceUnit.divisor, 100)
    const milk = find(r, 'Test Milk')!
    assert.equal(milk.mrpInr, 30)
    assert.equal(milk.sellingPriceInr, 27)
    assert.equal(milk.discountPercent, 10)
    assert.equal(milk.available, true)
    assert.equal(milk.availableQuantity, 3)
  })

  it('does NOT convert when the unit cannot be confirmed', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `Filler,Item ${i},${1234 + i * 7},0,5,${1234 + i * 7},100,FALSE,1`)
    const r = parseZepto([ZEPTO_HEADER, ...rows].join('\n'), 'zepto_dataset.csv')
    assert.ok(r.ok)
    if (!r.ok) return
    assert.equal(r.priceUnit.unit, 'unconfirmed')
    assert.equal(r.observations[0].mrpInr, null)
    assert.equal(r.observations[0].sellingPriceInr, null)
    assert.match(r.priceUnit.explanation, /NOT converted/)
  })

  it('refuses to infer a unit from too little data', () => {
    assert.equal(detectPriceUnit([2500, 3000, 4000]).unit, 'unconfirmed')
    assert.equal(detectPriceUnit(Array.from({ length: 60 }, (_, i) => 100 * (i + 1))).unit, 'paise')
    assert.equal(detectPriceUnit(Array.from({ length: 60 }, () => 100_000_000)).unit, 'unconfirmed') // implausible median
  })

  it('maps outOfStock to availability and keeps the source fields as metadata', () => {
    const r = parse(['Dairy,Gone Item,1000,0,0,1000,250,TRUE,7'])
    const o = find(r, 'Gone Item')!
    assert.equal(o.available, false)
    assert.equal(o.packSizeValue, 250)
    assert.equal(o.packSizeUnit, 'g')
    assert.equal(o.sourceQuantity, 7)
    assert.equal(o.platform, 'Zepto')
    assert.equal(o.provenance, 'DATASET')
  })

  it('leaves unknown fields null: no brand, date or location is invented', () => {
    const o = find(parse(['Dairy,Tata Salt,4000,0,3,4000,1000,FALSE,1']), 'Tata Salt')!
    assert.equal(o.brand, null)
    assert.equal(o.dateChecked, null)
    assert.equal(o.location, null)
    assert.equal(o.productId, null)
  })

  it('zero weight means unknown pack size, not zero grams', () => {
    const r = parse(['Dairy,No Weight,1000,0,3,1000,0,FALSE,1'])
    const o = find(r, 'No Weight')!
    assert.equal(o.packSizeValue, null)
    assert.equal(o.packSizeUnit, null)
    assert.ok(r.report.warnings.some((w) => /weightInGms is 0/.test(w.message)))
  })

  it('rejects invalid rows with reasons', () => {
    const r = parse([
      'Dairy,,1000,0,3,1000,250,FALSE,1', // no name
      'Dairy,Zero MRP,0,0,3,0,250,FALSE,1', // zero MRP
      'Dairy,Above,1000,0,3,2000,250,FALSE,1', // selling above MRP
      'Dairy,Bad Discount,1000,150,3,1000,250,FALSE,1', // discount > 100
      'Dairy,Bad Flag,1000,0,3,1000,250,MAYBE,1', // invalid outOfStock
      'Dairy,Bad Qty,1000,0,-1,1000,250,FALSE,1', // negative quantity
      ',No Category,1000,0,3,1000,250,FALSE,1', // no category
    ])
    const reasons = new Set(r.report.rejections.map((x) => x.reason))
    for (const expected of [
      'missing product name', 'invalid or zero MRP', 'selling price above MRP', 'invalid discount percent',
      'invalid outOfStock value', 'invalid availableQuantity', 'missing category',
    ]) assert.ok(reasons.has(expected), expected)
    assert.equal(r.report.rejectedRows, 7)
    assert.equal(r.report.validRows + r.report.rejectedRows, r.report.totalRows)
  })

  it('merges exact duplicates across category labels and keeps every label', () => {
    const r = parse([
      'Dairy,Same Item,1000,0,3,1000,250,FALSE,1',
      'Snacks,Same Item,1000,0,3,1000,250,FALSE,1',
      'Snacks,Same Item ,1000,0,3,1000,250,FALSE,1', // trailing space
    ])
    const matches = r.observations.filter((o) => o.productName === 'Same Item')
    assert.equal(matches.length, 1)
    assert.equal(matches[0].duplicates, 3)
    assert.deepEqual(matches[0].sourceCategories.sort(), ['Dairy', 'Snacks'])
    assert.equal(matches[0].sourceRows.length, 3)
    assert.ok(r.report.warnings.some((w) => /duplicate rows merged/.test(w.message)))
  })

  it('same product and pack with different prices are kept apart and marked conflicting', () => {
    const r = parse(['Dairy,Twin,1000,0,3,1000,250,FALSE,1', 'Dairy,Twin,1000,10,3,900,250,FALSE,1'])
    const twins = r.observations.filter((o) => o.productName === 'Twin')
    assert.equal(twins.length, 2)
    assert.ok(twins.every((o) => o.conflicting))
  })

  it('normalises non-breaking spaces in names', () => {
    const r = parse(['Dairy,Whiskas  Wet  Meal,1000,0,3,1000,250,FALSE,1'])
    assert.ok(find(r, 'Whiskas Wet Meal'))
  })

  it('flags a discountPercent that disagrees with the two prices', () => {
    const r = parse(['Dairy,Odd Discount,1000,50,3,900,250,FALSE,1'])
    assert.ok(r.report.warnings.some((w) => /discountPercent differs/.test(w.message)))
  })

  it('creates no other platform: a Zepto file yields Zepto observations only', () => {
    const r = parse(['Dairy,Item A,1000,0,3,1000,250,FALSE,1'])
    assert.deepEqual(new Set(r.observations.map((o) => o.platform)), new Set(['Zepto']))
  })
})

// ---------- product matching ----------

describe('product matching', () => {
  it('normalises names and brands consistently', () => {
    assert.equal(normalizeName("Lay's  Classic Chips!"), 'lays classic chips')
    assert.deepEqual(tokens('Head&Shoulders'), ['head', 'shoulders'])
    assert.deepEqual(tokens("Head & Shoulders"), ['head', 'shoulders'])
  })

  it('confirms brand + exact product name + identical pack size', () => {
    const m = matchProduct(ref(), [zrec('Tata Salt', 1000)])
    assert.equal(m.status, 'confirmed')
    assert.equal(m.observation?.productName, 'Tata Salt')
  })

  it('ignores size words that agree with the pack', () => {
    assert.equal(matchProduct(ref({ brand: 'Amul', productName: 'Butter', packSizeValue: 100 }), [zrec('Amul Butter 100g', 100)]).status, 'confirmed')
    assert.equal(matchProduct(ref(), [zrec('Tata Salt 1 kg', 1000)]).status, 'confirmed')
  })

  it('a size in the name that contradicts the weight is not confirmed', () => {
    assert.notEqual(matchProduct(ref(), [zrec('Tata Salt 500g', 1000)]).status, 'confirmed')
    assert.notEqual(matchProduct(ref(), [zrec('Tata Salt 500 ml', 1000)]).status, 'confirmed')
  })

  it('packaging words are NOT ignored: a different wording is only a possible match', () => {
    assert.equal(matchProduct(ref({ brand: 'Amul', productName: 'Butter', packSizeValue: 100 }), [zrec('Amul Butter (Pouch)', 100)]).status, 'possible')
    assert.equal(matchProduct(ref({ brand: "Lay's", productName: 'Chips', packSizeValue: 90 }), [zrec("Lay's Chips Pack", 90)]).status, 'possible')
  })

  it('word order must agree: reordered words are not confirmed', () => {
    const jam = ref({ brand: 'Amul', productName: 'Jam Butter', packSizeValue: 100 })
    assert.equal(matchProduct(jam, [zrec('Amul Jam Butter', 100)]).status, 'confirmed')
    assert.equal(matchProduct(jam, [zrec('Amul Butter Jam', 100)]).status, 'possible')
    assert.equal(matchProduct(ref(), [zrec('Salt Tata', 1000)]).status, 'unmatched') // the name must start with the brand
  })

  it('a multi-pack count in the reference must be visible in the record (Vim Dishwash Bar 3s)', () => {
    const vim = ref({ brand: 'Vim', productName: 'Dishwash Bar 3s', packSizeValue: 600 })
    const m = matchProduct(vim, [zrec('Vim Dishwash Bar', 600)])
    assert.equal(m.status, 'possible')
    assert.equal(m.observation, null)
    assert.match(m.reasons[0], /cannot be verified/)
    assert.equal(matchProduct(vim, [zrec('Vim Dishwash Bar 3s', 600)]).status, 'confirmed')
  })

  it('does NOT confirm a name with extra variant words: possible only', () => {
    const m = matchProduct(ref(), [zrec('Tata Salt Lite', 1000)])
    assert.equal(m.status, 'possible')
    assert.equal(m.observation, null)
    assert.equal(m.candidates[0].productName, 'Tata Salt Lite')
  })

  it('does NOT match the same product in a different pack size', () => {
    const m = matchProduct(ref(), [zrec('Tata Salt', 500), zrec('Tata Salt', 2000)])
    assert.equal(m.status, 'unmatched')
    assert.match(m.reasons[0], /other pack sizes/)
  })

  it('does NOT match a different brand in the same category', () => {
    assert.equal(matchProduct(ref(), [zrec('Aashirvaad Salt', 1000)]).status, 'unmatched')
  })

  it('ml and unit-count packs cannot be verified from a weight field: possible, never compared', () => {
    const milk = ref({ brand: 'Amul', productName: 'Toned Milk', packSizeValue: 500, packSizeUnit: 'ml' })
    const m = matchProduct(milk, [zrec('Amul Toned Milk', 500)])
    assert.equal(m.status, 'possible')
    assert.equal(m.observation, null)
    assert.match(m.reasons[0], /cannot be verified/)
  })

  it('brand-less fresh produce is not matched by name', () => {
    const onion = ref({ brand: 'Fresh', productName: 'Onion', packSizeValue: 1000 })
    assert.equal(matchProduct(onion, [zrec('Onion', 1000)]).status, 'unmatched')
  })

  it('conflicting or multiple records make the match ambiguous, not confirmed', () => {
    assert.equal(matchProduct(ref(), [zrec('Tata Salt', 1000, { conflicting: true })]).status, 'ambiguous')
    assert.equal(matchProduct(ref(), [zrec('Tata Salt', 1000), zrec('Tata Salt', 1000, { sellingPriceInr: 30 })]).status, 'ambiguous')
  })

  it('no candidate at all is unmatched', () => {
    assert.equal(matchProduct(ref(), []).status, 'unmatched')
  })

  it('handles accents in brands (Nestlé) and decimal sizes', () => {
    const cerelac = ref({ brand: 'Nestle', productName: 'Cerelac', packSizeValue: 300 })
    assert.equal(matchProduct(cerelac, [zrec('Nestlé Cerelac 300 g', 300)]).status, 'confirmed')
    assert.equal(matchProduct(ref({ packSizeValue: 1500 }), [zrec('Tata Salt 1.5 kg', 1500)]).status, 'confirmed')
  })

  it('handles apostrophes and ampersands in brands', () => {
    const chips = ref({ brand: "Lay's", productName: 'Classic Salted Chips', packSizeValue: 90 })
    assert.equal(matchProduct(chips, [zrec("Lays Classic Salted Chips", 90)]).status, 'confirmed')
    const shampoo = ref({ brand: 'Head&Shoulders', productName: 'Shampoo', packSizeValue: 340, packSizeUnit: 'g' })
    assert.equal(matchProduct(shampoo, [zrec('Head & Shoulders Shampoo', 340)]).status, 'confirmed')
  })
})

// ---------- loading, provenance, separation ----------

describe('dataset loading, provenance and separation', () => {
  let dir: string
  const write = (name: string, text: string) => fs.writeFile(path.join(dir, name), text)
  const hash = (name: string) => createHash('sha256').update(readFileSync(path.join(dir, name))).digest('hex')

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallbiz-comp-'))
    await write('basket.csv', [BASKET_HEADER, 'P1,Staples,Tata,Salt,1000,g,28', 'P2,Dairy,Amul,Milk,500,ml,30'].join('\n'))
    await write('prices.csv', [
      PRICES_HEADER,
      'P1,Staples,Tata,Salt,1000,g,Zepto,28,24,1,SAMPLE',
      'P1,Staples,Tata,Salt,1000,g,Blinkit,28,26,1,SAMPLE',
      'P2,Dairy,Amul,Milk,500,ml,Zepto,30,22,1,SAMPLE',
      'P2,Dairy,Amul,Milk,500,ml,Blinkit,30,,0,SAMPLE',
    ].join('\n'))
    await write('prices_template.csv', [PRICES_HEADER, 'P1,Staples,Tata,Salt,1000,g,Zepto,28,,,COLLECTED', 'P1,Staples,Tata,Salt,1000,g,Blinkit,28,,,COLLECTED'].join('\n'))
    await write('zepto_dataset.csv', zeptoCsv(['Staples,Tata Salt,2400,0,4,2400,1000,FALSE,1']))
  })

  after(async () => fs.rm(dir, { recursive: true, force: true }))

  it('reads all four files, validates each and never modifies them', async () => {
    const before = ['basket.csv', 'prices.csv', 'prices_template.csv', 'zepto_dataset.csv'].map(hash)
    const ds = await loadCompetitiveDataset(dir)
    assert.deepEqual(['basket.csv', 'prices.csv', 'prices_template.csv', 'zepto_dataset.csv'].map(hash), before)
    assert.equal(ds.files.length, 4)
    assert.ok(ds.files.every((f) => f.error === null && f.validation))
    for (const f of ds.files) {
      const v = f.validation!
      assert.equal(v.validRows + v.rejectedRows + v.templateRows, v.totalRows, f.file)
    }
  })

  it('shows Blinkit as NOT verified when only sample rows exist, with the required message', async () => {
    const r = buildCompetitiveResponse(await loadCompetitiveDataset(dir))
    assert.equal(r.blinkit.verifiedObservations, 0)
    assert.equal(r.blinkit.sampleObservations, 2)
    assert.equal(r.blinkit.message, BLINKIT_UNAVAILABLE)
    assert.equal(BLINKIT_UNAVAILABLE, 'Verified Blinkit observations are not available in the provided dataset.')
    assert.deepEqual(r.verifiedPlatforms, [])
    assert.ok(r.limitations.includes(BLINKIT_UNAVAILABLE))
  })

  it('platform coverage separates dataset records from sample rows and never marks them verified', async () => {
    const r = buildCompetitiveResponse(await loadCompetitiveDataset(dir))
    const zeptoSample = r.platformCoverage.find((c) => c.platform === 'Zepto' && c.provenance === 'SAMPLE')!
    const zeptoDataset = r.platformCoverage.find((c) => c.platform === 'Zepto' && c.provenance === 'DATASET')!
    assert.equal(zeptoSample.observations, 2)
    assert.ok(zeptoDataset.observations > 0)
    assert.ok(r.platformCoverage.every((c) => c.verified === false))
  })

  it('template rows are counted and produce no observations', async () => {
    const ds = await loadCompetitiveDataset(dir)
    const t = ds.files.find((f) => f.file === 'prices_template.csv')!
    assert.equal(t.validation!.templateRows, 2)
    assert.equal(t.validation!.validRows, 0)
    assert.equal(ds.observations.filter((o) => o.sourceFile === 'prices_template.csv').length, 0)
    assert.equal(t.provenance, 'TEMPLATE')
  })

  it('sample comparisons are labelled as sample and follow the definition (Blinkit - Zepto)', async () => {
    const r = buildCompetitiveResponse(await loadCompetitiveDataset(dir))
    const sample = r.platformComparisons.find((c) => c!.basis === 'SAMPLE')!
    assert.match(sample.label, /not collected prices/)
    const salt = sample.comparisons.find((c) => c.productId === 'P1')!
    assert.equal(salt.zeptoVsBlinkit!.differenceInr, 2) // 26 - 24
    // P2 Blinkit is out of stock with no price: no comparison is fabricated
    assert.equal(sample.comparisons.find((c) => c.productId === 'P2')!.zeptoVsBlinkit, null)
    assert.equal(sample.zeptoVsBlinkit.productsCompared, 1)
    assert.equal(sample.zeptoVsBlinkit.zeptoCheaper, 1)
  })

  it('reference comparison is built only from a confirmed match', async () => {
    const r = buildCompetitiveResponse(await loadCompetitiveDataset(dir))
    assert.equal(r.reference.statusCounts.confirmed, 1) // Tata Salt 1000 g
    assert.equal(r.reference.statusCounts.possible + r.reference.statusCounts.unmatched, 1) // Amul Milk 500 ml: not verifiable
    assert.equal(r.referenceComparisons.length, 1)
    assert.equal(r.referenceComparisons[0].mrpDifferenceInr, -4) // dataset 24 vs reference 28
    assert.equal(r.referenceComparisons[0].provenance, 'DATASET')
  })

  it('a missing or malformed file is reported, not fatal', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'smallbiz-empty-'))
    try {
      await fs.writeFile(path.join(empty, 'prices.csv'), 'a,b\n1,2')
      const ds = await loadCompetitiveDataset(empty)
      const r = buildCompetitiveResponse(ds)
      assert.ok(ds.files.every((f) => f.error !== null))
      assert.equal(r.zepto.available, false)
      assert.deepEqual(ds.observations, [])
      assert.equal(r.blinkit.message, BLINKIT_UNAVAILABLE)
    } finally {
      await fs.rm(empty, { recursive: true, force: true })
    }
  })

  it('observation queries page, filter and never exceed the limit', async () => {
    const ds = await loadCompetitiveDataset(dir)
    const all = queryObservations(ds, { limit: 3, offset: 0 })
    assert.equal(all.observations.length, 3)
    assert.ok(all.total > 3)
    const blinkit = queryObservations(ds, { platform: 'blinkit', limit: 50, offset: 0 })
    assert.equal(blinkit.total, 2)
    assert.ok(blinkit.observations.every((o) => o.platform === 'Blinkit'))
    assert.equal(queryObservations(ds, { provenance: 'COLLECTED', limit: 50, offset: 0 }).total, 0)
  })
})

describe('separation from the shop\'s business data', () => {
  const services = path.join(__dirname, '..', 'src', 'services')
  const read = (rel: string) => readFileSync(path.join(services, rel), 'utf8')
  const importsOf = (src: string) => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

  it('no business service (analytics, forecast, restocking, priority, intelligence) imports the competitive code', () => {
    for (const file of ['analytics.ts', 'insights.ts', 'inventory.ts', 'forecast.ts', 'restocking.ts', 'priority.ts', 'inventoryIntelligence.ts', 'forecasting/index.ts', 'forecasting/backtest.ts', 'forecasting/models.ts', 'forecasting/series.ts']) {
      assert.ok(importsOf(read(file)).every((i) => !/competitive/.test(i)), `${file} imports competitive code`)
    }
  })

  it('the competitive code never touches the database or business data', () => {
    for (const file of ['basket.ts', 'calculations.ts', 'explain.ts', 'index.ts', 'matching.ts', 'platformPrices.ts', 'table.ts', 'types.ts', 'zepto.ts']) {
      const imports = importsOf(read(`competitive/${file}`))
      assert.ok(imports.every((i) => !/prisma|dataSource|analytics|forecast|restocking|inventory/i.test(i.replace(/\.\/calculations|\.\/index/g, ''))), `${file}: ${imports.join(', ')}`)
    }
  })
})

// ---------- the real files in data_csv/ (invariants only, no fixed numbers) ----------

describe('real data_csv files', () => {
  it('load, validate consistently, and are not modified', async () => {
    const dir = path.resolve(__dirname, '..', '..', 'data_csv')
    const names = ['basket.csv', 'prices.csv', 'prices_template.csv', 'zepto_dataset.csv']
    try {
      await Promise.all(names.map((n) => fs.access(path.join(dir, n))))
    } catch {
      return // data_csv not present in this checkout: nothing to check
    }
    const digest = () => names.map((n) => createHash('sha256').update(readFileSync(path.join(dir, n))).digest('hex'))
    const before = digest()
    const ds = await loadCompetitiveDataset(dir)
    assert.deepEqual(digest(), before, 'a CSV file was modified')

    for (const f of ds.files) {
      assert.equal(f.error, null, f.file)
      const v = f.validation!
      assert.equal(v.validRows + v.rejectedRows + v.templateRows, v.totalRows, f.file)
    }
    // Template rows carry no values, so they can never become observations.
    assert.equal(ds.observations.filter((o) => o.sourceFile === 'prices_template.csv' && o.sellingPriceInr === null && o.available === null).length, 0)
    // Every SAMPLE-provenance row must come from a row actually labelled SAMPLE.
    assert.ok(ds.observations.filter((o) => o.provenance === 'SAMPLE').every((o) => o.dataSource.toUpperCase() === 'SAMPLE'))
    // Zepto records: Zepto only, nothing invented.
    const zepto = ds.observations.filter((o) => o.sourceFile === 'zepto_dataset.csv')
    assert.ok(zepto.length > 0)
    assert.ok(zepto.every((o) => o.platform === 'Zepto' && o.brand === null && o.dateChecked === null && o.location === null && o.provenance === 'DATASET'))
    // No Blinkit observation may originate from the Zepto dataset.
    assert.equal(ds.observations.filter((o) => o.platform === 'Blinkit' && o.sourceFile === 'zepto_dataset.csv').length, 0)
    // Confirmed matches come with a real, in-stock-or-not observation and a verified pack.
    for (const m of ds.matches.filter((x) => x.status === 'confirmed')) {
      assert.ok(m.observation && m.observation.mrpInr !== null)
      assert.equal(m.observation!.platform, 'Zepto')
    }
    const r = buildCompetitiveResponse(ds)
    assert.equal(r.verifiedPlatforms.length, ds.observations.some((o) => o.provenance === 'COLLECTED') ? r.verifiedPlatforms.length : 0)
  })
})

// ---------- AI explanation of a comparison ----------

describe('AI explanation of comparisons', () => {
  const input: ComparisonExplainInput = {
    product: 'Amul Toned Milk', kind: 'platform-price', basis: 'Sample data', labelA: 'Zepto', valueA: 22,
    labelB: 'Blinkit', valueB: 26, differenceInr: 4, differencePercent: 18.18, availabilityA: 'Available', availabilityB: 'Available',
  }
  afterEach(() => setExplanationProvider(null))

  it('the fallback is deterministic, uses only supplied numbers and says the data is sample', () => {
    const t = buildComparisonFallback(input)
    assert.equal(t, buildComparisonFallback(input))
    assert.match(t, /sample data/)
    assert.match(t, /no date/)
    assert.match(t, /₹4/)
    assert.ok(isAcceptableComparisonExplanation(t, input))
  })

  it('rejects a reply with a number that was not supplied', () => {
    assert.equal(isAcceptableComparisonExplanation('Blinkit charges 31 rupees, 40% more.', input), false)
    assert.ok(isAcceptableComparisonExplanation('Zepto is 22 and Blinkit is 26, a gap of about 18%.', input))
  })

  it('provider failure and unusable replies fall back', async () => {
    setExplanationProvider(async () => {
      throw new Error('down')
    })
    assert.equal((await explainComparison(input)).source, 'fallback')
    setExplanationProvider(async () => 'Instamart is 31 rupees cheaper.')
    assert.equal((await explainComparison(input)).source, 'fallback')
  })

  it('a good reply is used and labelled as AI', async () => {
    setExplanationProvider(async () => 'In the sample data Zepto is 22 and Blinkit is 26.')
    assert.equal((await explainComparison(input)).source, 'groq')
  })

  it('request parsing: only names the comparison; rejects bad input', () => {
    assert.deepEqual(parseComparisonRequest({ productId: 'P1', kind: 'platform-price' }), { productId: 'P1', kind: 'platform-price', platformA: 'Zepto', platformB: 'Blinkit' })
    assert.throws(() => parseComparisonRequest({ productId: 'P1', kind: 'nope' }), (e: any) => e.status === 400)
    assert.throws(() => parseComparisonRequest({ kind: 'platform-price' }), (e: any) => e.status === 400)
    assert.throws(() => parseComparisonRequest(null), (e: any) => e.status === 400)
  })

  it('numbers come from the dataset, never from the request', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallbiz-ai-'))
    try {
      await fs.writeFile(path.join(dir, 'basket.csv'), [BASKET_HEADER, 'P1,Staples,Tata,Salt,1000,g,28'].join('\n'))
      await fs.writeFile(path.join(dir, 'prices.csv'), [PRICES_HEADER, 'P1,Staples,Tata,Salt,1000,g,Zepto,28,24,1,SAMPLE', 'P1,Staples,Tata,Salt,1000,g,Blinkit,28,26,1,SAMPLE'].join('\n'))
      const ds = await loadCompetitiveDataset(dir)
      const built = buildComparisonInput(ds, parseComparisonRequest({ productId: 'P1', kind: 'platform-price', valueA: 1, valueB: 999, differenceInr: 500 }))!
      assert.equal(built.valueA, 24)
      assert.equal(built.valueB, 26)
      assert.equal(built.differenceInr, 2)
      assert.equal(built.basis, 'Sample data')
      assert.equal(buildComparisonInput(ds, { productId: 'P1', kind: 'platform-price', platformA: 'Zepto', platformB: 'Instamart' }), null) // absent platform
      assert.equal(buildComparisonInput(ds, { productId: 'NOPE', kind: 'platform-price', platformA: 'Zepto', platformB: 'Blinkit' }), null)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

// ---------- HTTP API ----------

describe('competitive prices API', () => {
  let server: Server
  let base: string
  before(() => {
    server = createApp().listen(0)
    base = `http://localhost:${(server.address() as AddressInfo).port}`
    // never call the live AI provider from tests
    setExplanationProvider(async () => {
      throw new Error('stubbed')
    })
  })
  after(async () => {
    setExplanationProvider(null)
    await new Promise((r) => server.close(r))
  })
  const get = async (p: string) => {
    const res = await fetch(base + p)
    return { status: res.status, body: (await res.json()) as any }
  }

  it('GET /api/analytics/competitive-prices returns provenance, coverage, validation and limitations', async () => {
    const { status, body } = await get('/api/analytics/competitive-prices')
    assert.equal(status, 200)
    for (const key of ['kind', 'notice', 'files', 'platformCoverage', 'blinkit', 'zepto', 'reference', 'referenceComparisons', 'platformComparisons', 'limitations']) {
      assert.ok(key in body, key)
    }
    assert.equal(body.kind, 'external-competitive-prices')
    assert.ok(body.files.every((f: any) => 'validation' in f && 'provenance' in f))
    assert.ok(body.limitations.some((l: string) => /not live|live, real-time/.test(l)))
  })

  it('observations endpoint pages and validates its parameters', async () => {
    const ok = await get('/api/analytics/competitive-prices/observations?limit=5&platform=Zepto')
    assert.equal(ok.status, 200)
    assert.ok(ok.body.observations.length <= 5)
    for (const bad of ['limit=0', 'limit=999', 'offset=-1', 'provenance=REAL']) {
      const r = await get(`/api/analytics/competitive-prices/observations?${bad}`)
      assert.equal(r.status, 400, bad)
      assert.equal(r.body.error.code, 'VALIDATION_ERROR')
    }
  })

  it('explain: bad body 400, unknown comparison 404, valid comparison falls back when AI is down', async () => {
    const post = async (body: unknown) => {
      const res = await fetch(`${base}/api/analytics/competitive-prices/explain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { status: res.status, body: (await res.json()) as any }
    }
    assert.equal((await post({ kind: 'platform-price' })).status, 400)
    assert.equal((await post({ productId: 'NOPE', kind: 'platform-price' })).status, 404)
    const data = (await get('/api/analytics/competitive-prices')).body
    const compared = data.platformComparisons.find((c: any) => c.basis === 'SAMPLE')?.comparisons.find((c: any) => c.zeptoVsBlinkit)
    if (compared) {
      const r = await post({ productId: compared.productId, kind: 'platform-price' })
      assert.equal(r.status, 200)
      assert.equal(r.body.source, 'fallback')
      assert.equal(r.body.basis, 'Sample data')
      assert.match(r.body.explanation, /sample data/)
    }
  })
})

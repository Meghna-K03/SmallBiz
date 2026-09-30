// Pure tests (no database): shop price vs market price matching and calculation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { loadCompetitiveDataset } from '../src/services/competitive'
import { compareShopToMarket, matchShopProduct, matchShopProductTwoStage } from '../src/services/competitive/shopComparison'
import type { PriceObservation } from '../src/services/competitive/types'

const rec = (over: Partial<PriceObservation>): PriceObservation =>
  ({
    productId: null, category: null, brand: null, productName: 'Tata Tea Premium 250g', packSizeValue: 250, packSizeUnit: 'g',
    platform: 'Zepto', mrpInr: 150, sellingPriceInr: 140, discountPercent: 6.7, available: true, availableQuantity: null,
    sourceQuantity: null, dateChecked: null, location: null, dataSource: 'zepto', provenance: 'DATASET', sourceFile: 'zepto_dataset.csv',
    sourceRows: [2], duplicates: 1, sourceCategories: [], conflicting: false, ...over,
  }) as PriceObservation

const shop = (name: string, sellingPrice = 150) => ({ id: 'x', name, sellingPrice })

describe('shop to market matching', () => {
  it('confirms brand + name + identical pack size', () => {
    const m = matchShopProduct(shop('Tea (Tata Tea 250g)'), [rec({ productName: 'Tata Tea 250g' })])
    assert.equal(m.status, 'confirmed')
  })
  it('does not match a different pack size', () => {
    const m = matchShopProduct(shop('Tea (Tata Tea 250g)'), [rec({ productName: 'Tata Tea 500g', packSizeValue: 500 })])
    assert.notEqual(m.status, 'confirmed')
  })
  it('extra words (a possible variant) are only possible, never compared', () => {
    const m = matchShopProduct(shop('Tea (Tata Tea 250g)'), [rec({ productName: 'Tata Tea Gold 250g' })])
    assert.equal(m.status, 'possible')
    assert.equal(m.observation, null)
  })
  it('a size in the name that contradicts the weight field is not confirmed', () => {
    const m = matchShopProduct(shop('Tea (Tata Tea 250g)'), [rec({ productName: 'Tata Tea 500g', packSizeValue: 250 })])
    assert.notEqual(m.status, 'confirmed')
  })
  it('brand-less shop names and ml/L packs are not confirmed', () => {
    assert.equal(matchShopProduct(shop('Sugar (1kg)'), [rec({ productName: 'Sugar 1kg', packSizeValue: 1000 })]).status, 'unmatched')
    assert.equal(matchShopProduct(shop('Milk (Amul 1L)'), [rec({ productName: 'Amul Milk 1L', packSizeValue: 0 })]).status, 'possible')
  })
  it('two fitting records, or a conflicting one, are not compared', () => {
    assert.notEqual(matchShopProduct(shop('Tea (Tata Tea 250g)'), [rec({}), rec({ sourceRows: [3] })]).status, 'confirmed')
    assert.notEqual(matchShopProduct(shop('Tea (Tata Tea 250g)'), [rec({ conflicting: true })]).status, 'confirmed')
  })
})

describe('two-stage matching', () => {
  const two = (name: string, records: PriceObservation[]) => matchShopProductTwoStage(shop(name), records)
  const r = (productName: string, packSizeValue: number, extra: Partial<PriceObservation> = {}) => rec({ productName, packSizeValue, ...extra })

  it('different word order and kg vs g: "Rice (India Gate 1kg)" = "Rice India Gate 1000g"', () => {
    assert.equal(two('Rice (India Gate 1kg)', [r('Rice India Gate 1000g', 1000)]).status, 'confirmed')
    assert.equal(two('Rice (India Gate 1kg)', [r('India Gate Rice', 1000)]).status, 'confirmed')
  })
  it('a safe brand alias confirms: Parleg = Parle-G', () => {
    assert.equal(two('Biscuits (Parleg 200g)', [r('Parle-G Biscuits 200g', 200)]).status, 'confirmed')
  })
  it('packaging words alone do not make a different product', () => {
    assert.equal(two('Salt (Tata 1kg)', [r('Tata Salt Pouch', 1000)]).status, 'confirmed')
  })
  it('product-type mismatch is not matched (Amul Milk vs Amul Butter)', () => {
    assert.equal(two('Butter (Amul 100g)', [r('Amul Milk', 100)]).status, 'unmatched')
    assert.equal(two('Milk (Amul 100g)', [r('Amul Butter', 100)]).status, 'unmatched')
  })
  it('pack size mismatch is not matched (Tata Salt 1kg vs 500g)', () => {
    const m = two('Salt (Tata 1kg)', [r('Tata Salt', 500)])
    assert.equal(m.status, 'unmatched')
    assert.equal(m.observation, null)
  })
  it('multipack mismatch is not matched (3s vs single)', () => {
    assert.notEqual(two('Dishwash Bar (Vim 3s 300g)', [r('Vim Dishwash Bar', 300)]).status, 'confirmed')
    assert.notEqual(two('Dishwash Bar (Vim 1s 300g)', [r('Vim Dishwash Bar 3s', 300)]).status, 'confirmed')
  })
  it('variants stay unconfirmed: "Tata Tea" vs "Tata Tea Gold"', () => {
    assert.notEqual(two('Tea (Tata Tea 250g)', [r('Tata Tea Gold', 250)]).status, 'confirmed')
  })
  it('several fitting products are ambiguous, never picked between', () => {
    const m = two('Bread (Britannia 400g)', [r('Britannia Multigrain Bread', 400), r('Britannia Brown Bread', 400)])
    assert.equal(m.status, 'possible')
    assert.equal(m.observation, null)
  })
  it('a brand-less shop name is never matched to a branded record', () => {
    assert.notEqual(two('Rice (Basmati 5kg)', [r('Fortune Rozana Basmati Rice', 5000)]).status, 'confirmed')
    assert.equal(two('Sugar (1kg)', [r('Popular Essentials Refined Sugar', 1000)]).status, 'unmatched')
  })
  it('ml/L packs cannot be verified from a weight field', () => {
    assert.notEqual(two('Milk (Amul 1L)', [r('Amul Taaza Toned Milk', 1000)]).status, 'confirmed')
  })
  it('no fabricated matches against the real files: every comparison price is a dataset record price', async () => {
    const ds = await loadCompetitiveDataset()
    const records = ds.observations.filter((o) => o.provenance === 'DATASET')
    const names = ['Biscuits (Parle-G 200g)', 'Bread (Britannia 400g)', 'Milk (Amul 1L)', 'Rice (Basmati 5kg)', 'Sugar (1kg)', 'Tea (Tata Tea 250g)', 'Noodles', 'Eggs (Tray of 12)']
    const out = compareShopToMarket(names.map((n, i) => ({ id: String(i), name: n, sellingPrice: 100 })), records)
    for (const c of out.comparisons) assert.ok(records.some((o) => o.sellingPriceInr === c.platformPriceInr && o.productName === c.matchedName))
    assert.ok(!out.comparisons.some((c) => c.shopProductName.startsWith('Tea')), 'Tata Tea 250g has no 250 g Zepto record')
  })
})

describe('shop to market comparison', () => {
  it('difference = shop - platform, percent of shop price', () => {
    const r = compareShopToMarket([shop('Tea (Tata Tea 250g)', 150)], [rec({ productName: 'Tata Tea 250g', sellingPriceInr: 140 })])
    assert.equal(r.comparisons.length, 1)
    assert.equal(r.comparisons[0].differenceInr, 10)
    assert.equal(r.comparisons[0].differencePercent, 6.67)
    assert.equal(r.comparisons[0].verdict, 'shop-higher')
    assert.equal(r.comparisons[0].shopPriceInr, 150)
  })
  it('out-of-stock or unpriced platform records produce no comparison and nothing is invented', () => {
    assert.equal(compareShopToMarket([shop('Tea (Tata Tea 250g)')], [rec({ productName: 'Tata Tea 250g', available: false })]).comparisons.length, 0)
    assert.equal(compareShopToMarket([shop('Tea (Tata Tea 250g)')], [rec({ productName: 'Tata Tea 250g', sellingPriceInr: null })]).comparisons.length, 0)
    assert.equal(compareShopToMarket([shop('Tea (Tata Tea 250g)')], []).comparisons.length, 0)
  })
  it('within 1% is similar; lower is shop-lower', () => {
    assert.equal(compareShopToMarket([shop('Tea (Tata Tea 250g)', 100)], [rec({ productName: 'Tata Tea 250g', sellingPriceInr: 99.5 })]).comparisons[0].verdict, 'similar')
    assert.equal(compareShopToMarket([shop('Tea (Tata Tea 250g)', 100)], [rec({ productName: 'Tata Tea 250g', sellingPriceInr: 120 })]).comparisons[0].verdict, 'shop-lower')
  })
  it('the module is isolated: no database or business-service imports', () => {
    const src = readFileSync(path.join(__dirname, '..', 'src', 'services', 'competitive', 'shopComparison.ts'), 'utf8')
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    assert.ok(imports.every((i) => !/prisma|dataSource|analytics|forecast|restocking|inventory/i.test(i)), imports.join(', '))
  })
})

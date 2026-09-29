// Phase 6 restocking-recommendation tests. Pure rules use plain numbers.
// Database tests use temporary "ZZ Restock ..." products with sales inside a
// custom history period and delete them afterwards; existing data is only read.
//
// Run with: npm test
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import type { ProductStock } from '../src/services/analytics'
import { buildProductForecast } from '../src/services/forecast'
import { makePeriod } from '../src/services/insights'
import {
  buildRecommendation,
  calcRecommendedQuantity,
  calcTargetStock,
  getRestockingRecommendations,
} from '../src/services/restocking'

let server: Server
let base: string
const tempIds: string[] = []

const snapshot = async () =>
  JSON.stringify({
    products: await prisma.product.findMany({ orderBy: { id: 'asc' } }),
    sales: await prisma.sale.findMany({ orderBy: { id: 'asc' } }),
    purchases: await prisma.purchase.findMany({ orderBy: { id: 'asc' } }),
    expenses: await prisma.expense.findMany({ orderBy: { id: 'asc' } }),
  })

async function tempProduct(openingStock: number, minStockLevel: number, sales: { quantity: number; date: string }[]) {
  const p = await prisma.product.create({
    data: { name: `ZZ Restock ${tempIds.length}`, category: 'Test', unit: 'packs', sellingPrice: 10, purchasePrice: 6, openingStock, minStockLevel },
  })
  tempIds.push(p.id)
  for (const s of sales) {
    await prisma.sale.create({ data: { productId: p.id, quantity: s.quantity, sellingPrice: 10, date: new Date(`${s.date}T00:00:00Z`) } })
  }
  return p.id
}

const stockRow = (currentStock: number, min: number): ProductStock => ({
  productId: 'p', name: 'Prod', category: 'T', unit: 'packs', openingStock: currentStock, purchased: 0, sold: 0,
  currentStock, minStockLevel: min,
  stockStatus: currentStock <= 0 ? 'Out of Stock' : currentStock <= min ? 'Low Stock' : 'Healthy',
})

// 29-day period. `units` sold over `records` sale records.
const period = makePeriod('2026-09-01', '2026-09-29')
const forecastFor = (units: number, records: number, horizon: number, p = period) =>
  buildProductForecast(
    { id: 'p', name: 'Prod', category: 'T' },
    units ? { units, records, firstSaleDate: '2026-09-01', lastSaleDate: '2026-09-29' } : undefined,
    p,
    horizon,
  )

before(() => {
  server = createApp().listen(0)
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await prisma.sale.deleteMany({ where: { productId: { in: tempIds } } })
  await prisma.product.deleteMany({ where: { id: { in: tempIds } } })
  await new Promise((r) => server.close(r))
  await prisma.$disconnect()
})

describe('target stock and recommended quantity (pure)', () => {
  it('target = forecasted demand + minimum stock level', () => {
    assert.equal(calcTargetStock(14, 5), 19)
    assert.equal(calcTargetStock(51.22, 6), 57.22)
  })

  it('quantity = max(0, target - current), rounded up to whole units', () => {
    assert.equal(calcRecommendedQuantity(19, 2), 17)
    assert.equal(calcRecommendedQuantity(57.22, 0), 58)
    assert.equal(calcRecommendedQuantity(41.34, 15), 27)
    assert.equal(calcRecommendedQuantity(19, 19), 0)
    assert.equal(calcRecommendedQuantity(19.0000000001, 19), 0) // float noise never adds a unit
  })

  it('is never negative when stock exceeds the target', () => {
    assert.equal(calcRecommendedQuantity(19, 500), 0)
  })
})

describe('recommendation rules (pure)', () => {
  it('low stock with sufficient history needs restocking (Milk-style example)', () => {
    // 58 units / 29 days = 2/day -> 7-day forecast 14; target 14 + 5 = 19; stock 2 -> 17.
    const r = buildRecommendation(stockRow(2, 5), forecastFor(58, 3, 7))
    assert.equal(r.forecastedDemand, 14)
    assert.equal(r.targetStock, 19)
    assert.equal(r.recommendedQuantity, 17)
    assert.equal(r.status, 'Needs Restocking')
    assert.equal(r.dataStatus, 'Sufficient')
    assert.equal(r.stockStatus, 'Low Stock')
    assert.match(r.reason, /Restock 17 units/)
  })

  it('out-of-stock product needs the full target', () => {
    const r = buildRecommendation(stockRow(0, 5), forecastFor(58, 3, 7))
    assert.equal(r.recommendedQuantity, 19)
    assert.equal(r.stockStatus, 'Out of Stock')
    assert.equal(r.status, 'Needs Restocking')
  })

  it('well-stocked product with sufficient history needs nothing', () => {
    const r = buildRecommendation(stockRow(40, 5), forecastFor(58, 3, 7))
    assert.equal(r.recommendedQuantity, 0)
    assert.equal(r.status, 'No Restocking Needed')
  })

  it('exactly at target needs nothing', () => {
    assert.equal(buildRecommendation(stockRow(19, 5), forecastFor(58, 3, 7)).recommendedQuantity, 0)
  })

  it('no sales: stock above minimum is Insufficient History with quantity 0', () => {
    const r = buildRecommendation(stockRow(9, 5), forecastFor(0, 0, 7))
    assert.equal(r.forecastedDemand, 0)
    assert.equal(r.recommendedQuantity, 0)
    assert.equal(r.status, 'Insufficient History')
    assert.equal(r.dataStatus, 'No Sales')
  })

  it('no sales but below minimum still needs restocking to the minimum, flagged as no history', () => {
    const r = buildRecommendation(stockRow(0, 5), forecastFor(0, 0, 7))
    assert.equal(r.recommendedQuantity, 5)
    assert.equal(r.status, 'Needs Restocking')
    assert.equal(r.dataStatus, 'No Sales')
    assert.match(r.reason, /no sales history/)
  })

  it('limited history is flagged and never reported as "No Restocking Needed"', () => {
    const ok = buildRecommendation(stockRow(50, 5), forecastFor(4, 1, 7))
    assert.equal(ok.dataStatus, 'Limited History')
    assert.equal(ok.status, 'Insufficient History')
    const low = buildRecommendation(stockRow(1, 5), forecastFor(4, 1, 7))
    assert.equal(low.status, 'Needs Restocking')
    assert.match(low.reason, /limited sales history/)
  })

  it('forecast horizon changes the target: 7, 14 and 30 days', () => {
    const q = (h: number) => buildRecommendation(stockRow(10, 5), forecastFor(58, 3, h)).recommendedQuantity
    assert.equal(q(7), 9) //  14 + 5 - 10
    assert.equal(q(14), 23) // 28 + 5 - 10
    assert.equal(q(30), 55) // 60 + 5 - 10
  })

  it('is deterministic', () => {
    const a = buildRecommendation(stockRow(3, 5), forecastFor(58, 3, 14))
    assert.deepEqual(buildRecommendation(stockRow(3, 5), forecastFor(58, 3, 14)), a)
  })
})

describe('database-backed recommendations (temporary products, custom period)', () => {
  it('combines real stock with the real forecast for each horizon', async () => {
    const sales = [{ quantity: 9, date: '2026-09-03' }, { quantity: 20, date: '2026-09-15' }, { quantity: 29, date: '2026-09-28' }] // 58 units, 3 records
    const healthy = await tempProduct(100, 5, sales) // stock 42
    const low = await tempProduct(60, 5, sales) // stock 2
    const out = await tempProduct(58, 5, sales) // stock 0
    const idle = await tempProduct(9, 5, []) // no sales, above minimum
    const idleEmpty = await tempProduct(0, 5, []) // no sales, out of stock
    const thin = await tempProduct(100, 5, [{ quantity: 4, date: '2026-09-10' }]) // limited history, stock 96

    const at = (r: Awaited<ReturnType<typeof getRestockingRecommendations>>, id: string) => r.products.find((p) => p.productId === id)!
    const r7 = await getRestockingRecommendations({ horizonDays: 7, period })
    const r14 = await getRestockingRecommendations({ horizonDays: 14, period })
    const r30 = await getRestockingRecommendations({ horizonDays: 30, period })

    assert.equal(at(r7, healthy).currentStock, 42)
    assert.equal(at(r7, healthy).recommendedQuantity, 0) // target 19
    assert.equal(at(r7, healthy).status, 'No Restocking Needed')
    assert.equal(at(r14, healthy).recommendedQuantity, 0) // target 33
    assert.equal(at(r30, healthy).recommendedQuantity, 23) // target 65 - 42

    assert.equal(at(r7, low).currentStock, 2)
    assert.equal(at(r7, low).stockStatus, 'Low Stock')
    assert.equal(at(r7, low).recommendedQuantity, 17)
    assert.equal(at(r14, low).recommendedQuantity, 31)
    assert.equal(at(r30, low).recommendedQuantity, 63)

    assert.equal(at(r7, out).currentStock, 0)
    assert.equal(at(r7, out).stockStatus, 'Out of Stock')
    assert.equal(at(r7, out).recommendedQuantity, 19)

    assert.equal(at(r7, idle).status, 'Insufficient History')
    assert.equal(at(r7, idle).recommendedQuantity, 0)
    assert.equal(at(r7, idleEmpty).status, 'Needs Restocking')
    assert.equal(at(r7, idleEmpty).recommendedQuantity, 5)
    assert.equal(at(r7, thin).dataStatus, 'Limited History')
    assert.equal(at(r7, thin).status, 'Insufficient History')

    assert.ok(r7.needsRestocking.some((p) => p.productId === low))
    assert.ok(!r7.needsRestocking.some((p) => p.productId === healthy))
    const q = r7.needsRestocking.map((p) => p.recommendedQuantity)
    assert.deepEqual(q, [...q].sort((a, b) => b - a))
    assert.equal(r7.summary.totalProducts, r7.products.length)
    assert.equal(r7.summary.needsRestocking + r7.summary.noRestockingNeeded + r7.summary.insufficientHistory, r7.products.length)

    assert.deepEqual(await getRestockingRecommendations({ horizonDays: 7, period }), r7) // deterministic
  })
})

describe('GET /api/analytics/restocking', () => {
  const get = async (q = '') => {
    const res = await fetch(`${base}/api/analytics/restocking${q}`)
    return { status: res.status, body: await res.json() }
  }

  it('returns recommendations consistent with live stock and forecast (default 7 days)', async () => {
    const { status, body: b } = await get()
    assert.equal(status, 200)
    assert.equal(b.forecastHorizonDays, 7)
    assert.equal(b.products.length, await prisma.product.count())

    const fc = await (await fetch(`${base}/api/analytics/forecast?days=7`)).json()
    for (const p of b.products) {
      const f = fc.products.find((x: any) => x.productId === p.productId)
      assert.equal(p.forecastedDemand, f.forecastedDemand, p.productName)
      assert.equal(p.dataStatus, f.dataStatus, p.productName)
      assert.equal(p.targetStock, Math.round((f.forecastedDemand + p.minimumStockLevel) * 100) / 100, p.productName)
      assert.equal(p.recommendedQuantity, Math.max(0, Math.ceil(Math.round((p.targetStock - p.currentStock) * 100) / 100)), p.productName)
      assert.ok(Number.isInteger(p.recommendedQuantity) && p.recommendedQuantity >= 0)
      assert.ok(['Needs Restocking', 'No Restocking Needed', 'Insufficient History'].includes(p.status))
      assert.equal(p.status === 'Needs Restocking', p.recommendedQuantity > 0, p.productName)
      assert.ok(p.reason.length > 0)
    }
    assert.deepEqual((await get()).body, b)
  })

  it('supports the 14 and 30 day horizons', async () => {
    for (const days of [14, 30]) {
      const { status, body } = await get(`?days=${days}`)
      assert.equal(status, 200)
      assert.equal(body.forecastHorizonDays, days)
      assert.ok(body.products.every((p: any) => p.forecastHorizonDays === days))
    }
  })

  it('rejects an invalid horizon with the standard error shape', async () => {
    for (const q of ['?days=0', '?days=-3', '?days=abc', '?days=2.5', '?days=999', '?days=']) {
      const { status, body } = await get(q)
      assert.equal(status, 400, q)
      assert.equal(body.error.code, 'VALIDATION_ERROR', q)
    }
  })

  it('is read-only', async () => {
    const before = await snapshot()
    for (const q of ['', '?days=14', '?days=30']) assert.equal((await get(q)).status, 200)
    assert.equal(await snapshot(), before)
    assert.equal((await fetch(`${base}/api/analytics/restocking`, { method: 'POST' })).status, 404)
  })
})

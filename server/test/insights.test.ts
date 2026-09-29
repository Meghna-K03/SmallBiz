// Phase 4C product-insight tests (sales velocity, stock coverage, movement).
// Pure calculations are tested with plain numbers. Database tests use temporary
// "ZZ Insights ..." products with sales inside a custom analysis period and
// delete them afterwards; existing business data is only read.
//
// Run with: npm test
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import type { ProductStock } from '../src/services/analytics'
import {
  buildProductInsights,
  calcSalesVelocity,
  calcStockCoverageDays,
  classifyMovement,
  daysBetweenInclusive,
  fastMoving,
  getDefaultAnalysisPeriod,
  getProductInsights,
  makePeriod,
  noSales,
  slowMoving,
} from '../src/services/insights'

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

const stockRow = (id: string, name: string, currentStock: number, min = 5): ProductStock => ({
  productId: id, name, category: 'T', unit: 'u', openingStock: currentStock, purchased: 0, sold: 0,
  currentStock, minStockLevel: min,
  stockStatus: currentStock <= 0 ? 'Out of Stock' : currentStock <= min ? 'Low Stock' : 'Healthy',
})

async function tempProduct(openingStock: number, purchased: number, sales: { quantity: number; date: string }[]) {
  const p = await prisma.product.create({
    data: { name: `ZZ Insights ${tempIds.length}`, category: 'Test', unit: 'packs', sellingPrice: 10, purchasePrice: 6, openingStock, minStockLevel: 5 },
  })
  tempIds.push(p.id)
  if (purchased) {
    await prisma.purchase.create({ data: { productId: p.id, quantity: purchased, purchasePrice: 6, date: new Date('2026-09-21T00:00:00Z') } })
  }
  for (const s of sales) {
    await prisma.sale.create({ data: { productId: p.id, quantity: s.quantity, sellingPrice: 10, date: new Date(`${s.date}T00:00:00Z`) } })
  }
  return p.id
}

before(() => {
  server = createApp().listen(0)
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await prisma.sale.deleteMany({ where: { productId: { in: tempIds } } })
  await prisma.purchase.deleteMany({ where: { productId: { in: tempIds } } })
  await prisma.product.deleteMany({ where: { id: { in: tempIds } } })
  await new Promise((r) => server.close(r))
  await prisma.$disconnect()
})

describe('analysis period', () => {
  it('counts calendar days inclusively', () => {
    assert.equal(daysBetweenInclusive('2026-09-01', '2026-09-01'), 1)
    assert.equal(daysBetweenInclusive('2026-09-01', '2026-09-30'), 30)
    assert.equal(daysBetweenInclusive('2026-02-27', '2026-03-02'), 4)
    assert.equal(daysBetweenInclusive('2026-09-10', '2026-09-01'), 0)
  })

  it('has no days when there are no dates', () => {
    assert.deepEqual(makePeriod(null, null), { startDate: null, endDate: null, days: 0 })
  })

  it('default period spans the earliest to latest recorded sale', async () => {
    const [min, max, period] = await Promise.all([
      prisma.sale.findFirst({ orderBy: { date: 'asc' } }),
      prisma.sale.findFirst({ orderBy: { date: 'desc' } }),
      getDefaultAnalysisPeriod(),
    ])
    assert.equal(period.startDate, min!.date.toISOString().slice(0, 10))
    assert.equal(period.endDate, max!.date.toISOString().slice(0, 10))
    assert.equal(period.days, daysBetweenInclusive(period.startDate!, period.endDate!))
  })
})

describe('sales velocity and stock coverage', () => {
  it('velocity = units sold / days', () => {
    assert.equal(calcSalesVelocity(150, 30), 5)
    assert.equal(calcSalesVelocity(10, 3), 3.33)
  })

  it('zero sales gives velocity 0; zero-day period gives null (no division by zero)', () => {
    assert.equal(calcSalesVelocity(0, 30), 0)
    assert.equal(calcSalesVelocity(0, 0), null)
    assert.equal(calcSalesVelocity(5, 0), null)
  })

  it('coverage = current stock / velocity (Milk: 15 in stock, 5/day = 3 days)', () => {
    assert.equal(calcStockCoverageDays(15, 5), 3)
    assert.equal(calcStockCoverageDays(10, 3), 3.33)
    assert.equal(calcStockCoverageDays(0, 5), 0)
  })

  it('coverage is null (not Infinity/NaN) when velocity is 0 or unknown', () => {
    assert.equal(calcStockCoverageDays(15, 0), null)
    assert.equal(calcStockCoverageDays(15, null), null)
  })
})

describe('movement classification', () => {
  it('uses the documented thresholds (fast >= 2/day, slow < 1/day, default)', () => {
    assert.equal(classifyMovement(0, 0), 'No Sales')
    assert.equal(classifyMovement(0, null), 'No Sales')
    assert.equal(classifyMovement(1, 0.1), 'Slow Moving')
    assert.equal(classifyMovement(9, 0.99), 'Slow Moving')
    assert.equal(classifyMovement(10, 1), 'Normal')
    assert.equal(classifyMovement(19, 1.99), 'Normal')
    assert.equal(classifyMovement(20, 2), 'Fast Moving')
    assert.equal(classifyMovement(100, 10), 'Fast Moving')
  })

  it('honours custom thresholds', () => {
    const t = { fastMinVelocity: 5, slowMaxVelocity: 3 }
    assert.equal(classifyMovement(40, 4, t), 'Normal')
    assert.equal(classifyMovement(50, 5, t), 'Fast Moving')
    assert.equal(classifyMovement(20, 2, t), 'Slow Moving')
  })
})

describe('product performance summary (pure)', () => {
  const period = makePeriod('2026-09-01', '2026-09-10') // 10 days
  const stock = [stockRow('a', 'Alpha', 15), stockRow('b', 'Bravo', 0), stockRow('c', 'Charlie', 40), stockRow('d', 'Delta', 3), stockRow('e', 'Echo', 30)]
  const sold = new Map([['a', 50], ['b', 30], ['c', 5], ['d', 15]]) // e has no sales
  const insights = buildProductInsights(stock, sold, period)
  const by = (id: string) => insights.find((p) => p.productId === id)!

  it('produces every field per product, ordered by name', () => {
    assert.deepEqual(insights.map((p) => p.productName), ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])
    assert.deepEqual(by('a'), {
      productId: 'a', productName: 'Alpha', category: 'T', currentStock: 15, minimumStockLevel: 5,
      totalUnitsSold: 50, salesVelocity: 5, stockCoverageDays: 3, stockStatus: 'Healthy', movement: 'Fast Moving',
    })
  })

  it('keeps existing stock statuses and derives coverage', () => {
    assert.equal(by('b').stockStatus, 'Out of Stock')
    assert.equal(by('b').stockCoverageDays, 0)
    assert.equal(by('d').stockStatus, 'Low Stock')
    assert.equal(by('d').stockCoverageDays, 2)
  })

  it('handles a product with no sales', () => {
    assert.equal(by('e').totalUnitsSold, 0)
    assert.equal(by('e').salesVelocity, 0)
    assert.equal(by('e').stockCoverageDays, null)
    assert.equal(by('e').movement, 'No Sales')
  })

  it('lists fast, slow and no-sales products separately', () => {
    // Velocities: Alpha 5, Bravo 3, Charlie 0.5, Delta 1.5 (Normal), Echo 0.
    assert.deepEqual(fastMoving(insights).map((p) => p.productName), ['Alpha', 'Bravo'])
    assert.deepEqual(slowMoving(insights).map((p) => p.productName), ['Charlie'])
    assert.deepEqual(noSales(insights).map((p) => p.productName), ['Echo'])
    assert.equal(by('d').movement, 'Normal')
  })

  it('is deterministic', () => {
    assert.deepEqual(buildProductInsights(stock, sold, period), insights)
  })

  it('a period with no days gives null velocity and coverage, and no crash', () => {
    const none = buildProductInsights(stock, new Map(), makePeriod(null, null))
    assert.ok(none.every((p) => p.salesVelocity === null && p.stockCoverageDays === null && p.movement === 'No Sales'))
  })
})

describe('database-backed insights (temporary products, custom period)', () => {
  const period = makePeriod('2026-09-20', '2026-09-29') // 10 days

  it('computes velocity, stock and coverage from real records and honours the period', async () => {
    // opening 100 + purchase 20 - sold (30 in period + 7 outside it) = 83 in stock
    const fast = await tempProduct(100, 20, [{ quantity: 10, date: '2026-09-22' }, { quantity: 20, date: '2026-09-25' }, { quantity: 7, date: '2026-09-10' }])
    const slow = await tempProduct(50, 0, [{ quantity: 5, date: '2026-09-25' }])
    const idle = await tempProduct(9, 0, [])
    const r = await getProductInsights({ period })
    const by = (id: string) => r.products.find((p) => p.productId === id)!

    assert.deepEqual(r.analysisPeriod, period)
    assert.equal(by(fast).totalUnitsSold, 30) // the sale on 09-10 is outside the period
    assert.equal(by(fast).salesVelocity, 3)
    assert.equal(by(fast).currentStock, 83) // stock counts all-time history
    assert.equal(by(fast).stockCoverageDays, 27.67)
    assert.equal(by(fast).movement, 'Fast Moving')

    assert.equal(by(slow).salesVelocity, 0.5)
    assert.equal(by(slow).stockCoverageDays, 90)
    assert.equal(by(slow).movement, 'Slow Moving')

    assert.equal(by(idle).salesVelocity, 0)
    assert.equal(by(idle).stockCoverageDays, null)
    assert.equal(by(idle).movement, 'No Sales')

    assert.ok(r.fastMovingProducts.some((p) => p.productId === fast))
    assert.ok(r.slowMovingProducts.some((p) => p.productId === slow))
    assert.ok(r.noSalesProducts.some((p) => p.productId === idle))
  })
})

describe('GET /api/analytics/product-insights', () => {
  it('returns consistent insights for every product from the live data', async () => {
    const res = await fetch(`${base}/api/analytics/product-insights`)
    assert.equal(res.status, 200)
    const b = await res.json()
    assert.equal(b.products.length, await prisma.product.count())
    assert.ok(b.analysisPeriod.days >= 1)
    assert.equal(b.analysisPeriod.days, daysBetweenInclusive(b.analysisPeriod.startDate, b.analysisPeriod.endDate))

    const [products, purchases, sales] = await Promise.all([prisma.product.findMany(), prisma.purchase.findMany(), prisma.sale.findMany()])
    for (const p of b.products) {
      const src = products.find((x) => x.id === p.productId)!
      const bought = purchases.filter((x) => x.productId === src.id).reduce((a, x) => a + x.quantity, 0)
      const sold = sales.filter((x) => x.productId === src.id).reduce((a, x) => a + x.quantity, 0)
      assert.equal(p.currentStock, src.openingStock + bought - sold, src.name)
      // All sales fall inside the default period, so units sold equals all-time sold.
      assert.equal(p.totalUnitsSold, sold, src.name)
      assert.equal(p.salesVelocity, Math.round((sold / b.analysisPeriod.days) * 100) / 100, src.name)
      if (sold === 0) assert.equal(p.stockCoverageDays, null)
      else assert.equal(p.stockCoverageDays, Math.round((Math.max(p.currentStock, 0) / p.salesVelocity) * 100) / 100, src.name)
      assert.ok(['Healthy', 'Low Stock', 'Out of Stock'].includes(p.stockStatus))
      assert.ok(['Fast Moving', 'Normal', 'Slow Moving', 'No Sales'].includes(p.movement))
    }
    assert.ok(b.fastMovingProducts.every((p: any) => p.movement === 'Fast Moving'))
    assert.ok(b.slowMovingProducts.every((p: any) => p.movement === 'Slow Moving'))
    const again = await (await fetch(`${base}/api/analytics/product-insights`)).json()
    assert.deepEqual(again, b)
  })

  it('is read-only', async () => {
    const before = await snapshot()
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/api/analytics/product-insights`)).status, 200)
    assert.equal(await snapshot(), before)
    assert.equal((await fetch(`${base}/api/analytics/product-insights`, { method: 'POST' })).status, 404)
  })
})

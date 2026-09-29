// Phase 5 demand-forecast tests (historical average daily demand x horizon).
// Pure calculations use plain numbers. Database tests use temporary
// "ZZ Forecast ..." products with sales inside a custom history period and
// delete them afterwards; existing business data is only read.
//
// Run with: npm test
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import {
  buildProductForecast,
  calcAverageDailyDemand,
  calcForecastedDemand,
  classifyDataStatus,
  getDemandForecast,
  parseHorizon,
} from '../src/services/forecast'
import { daysBetweenInclusive, makePeriod } from '../src/services/insights'

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

async function tempProduct(sales: { quantity: number; date: string }[]) {
  const p = await prisma.product.create({
    data: { name: `ZZ Forecast ${tempIds.length}`, category: 'Test', unit: 'packs', sellingPrice: 10, purchasePrice: 6, openingStock: 500, minStockLevel: 5 },
  })
  tempIds.push(p.id)
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
  await prisma.product.deleteMany({ where: { id: { in: tempIds } } })
  await new Promise((r) => server.close(r))
  await prisma.$disconnect()
})

describe('average daily demand and forecast (pure)', () => {
  it('average daily demand = units sold / days', () => {
    assert.equal(calcAverageDailyDemand(60, 30), 2)
    assert.equal(calcAverageDailyDemand(10, 4), 2.5)
  })

  it('forecast = average daily demand x horizon for 7, 14 and 30 days', () => {
    assert.equal(calcForecastedDemand(60, 30, 7), 14)
    assert.equal(calcForecastedDemand(60, 30, 14), 28)
    assert.equal(calcForecastedDemand(60, 30, 30), 60)
  })

  it('rounds once to 2 decimals from the unrounded average', () => {
    assert.equal(calcForecastedDemand(300, 41, 7), 51.22) // 300/41*7 = 51.2195...
    assert.equal(calcForecastedDemand(10, 3, 7), 23.33)
  })

  it('zero sales or a zero-day period yields 0 without NaN or Infinity', () => {
    assert.equal(calcAverageDailyDemand(0, 30), 0)
    assert.equal(calcAverageDailyDemand(5, 0), 0)
    assert.equal(calcForecastedDemand(0, 30, 30), 0)
    assert.equal(calcForecastedDemand(5, 0, 30), 0)
  })

  it('is deterministic', () => {
    assert.equal(calcForecastedDemand(123, 37, 14), calcForecastedDemand(123, 37, 14))
  })
})

describe('data reliability', () => {
  it('flags no sales, limited history and sufficient history explicitly', () => {
    assert.equal(classifyDataStatus(0, 0, 60), 'No Sales')
    assert.equal(classifyDataStatus(50, 10, 13), 'Limited History') // period too short
    assert.equal(classifyDataStatus(50, 2, 60), 'Limited History') // too few sale records
    assert.equal(classifyDataStatus(1, 1, 60), 'Limited History')
    assert.equal(classifyDataStatus(50, 3, 14), 'Sufficient')
    assert.equal(classifyDataStatus(50, 10, 60), 'Sufficient')
  })

  it('builds a product forecast for a product without any sales', () => {
    const f = buildProductForecast({ id: 'x', name: 'Idle', category: 'T' }, undefined, makePeriod('2026-09-01', '2026-09-30'), 14)
    assert.equal(f.historicalUnitsSold, 0)
    assert.equal(f.averageDailyDemand, 0)
    assert.equal(f.forecastedDemand, 0)
    assert.equal(f.dataStatus, 'No Sales')
    assert.equal(f.firstSaleDate, null)
    assert.equal(f.forecastHorizonDays, 14)
  })

  it('handles an empty period (no sales recorded anywhere)', () => {
    const f = buildProductForecast({ id: 'x', name: 'Idle', category: 'T' }, undefined, makePeriod(null, null), 7)
    assert.equal(f.historyDays, 0)
    assert.equal(f.forecastedDemand, 0)
    assert.equal(f.dataStatus, 'No Sales')
  })
})

describe('forecast horizon validation', () => {
  it('defaults to 7 and accepts valid whole-day horizons', () => {
    assert.equal(parseHorizon(undefined), 7)
    assert.equal(parseHorizon('7'), 7)
    assert.equal(parseHorizon('14'), 14)
    assert.equal(parseHorizon('30'), 30)
    assert.equal(parseHorizon('365'), 365)
  })

  it('rejects invalid horizons', () => {
    for (const bad of ['0', '-7', '1.5', 'abc', '', '366', '7days', ['7', '14'], { a: 1 }]) {
      assert.throws(() => parseHorizon(bad), (e: any) => e.status === 400 && e.code === 'VALIDATION_ERROR', String(bad))
    }
  })
})

describe('database-backed forecast (temporary products, custom 29-day period)', () => {
  const period = makePeriod('2026-09-01', '2026-09-29')

  it('aggregates sales in the database, honours the period and flags reliability', async () => {
    // 9 + 20 + 29 = 58 units in period over 29 days = 2 per day. A sale outside the period is ignored.
    const steady = await tempProduct([
      { quantity: 9, date: '2026-09-03' }, { quantity: 20, date: '2026-09-15' }, { quantity: 29, date: '2026-09-28' },
      { quantity: 100, date: '2026-08-25' },
    ])
    const thin = await tempProduct([{ quantity: 4, date: '2026-09-10' }])
    const idle = await tempProduct([])

    const r7 = await getDemandForecast({ horizonDays: 7, period })
    const r14 = await getDemandForecast({ horizonDays: 14, period })
    const r30 = await getDemandForecast({ horizonDays: 30, period })
    const at = (r: typeof r7, id: string) => r.products.find((p) => p.productId === id)!

    assert.deepEqual(r7.historyPeriod, period)
    assert.equal(at(r7, steady).historicalUnitsSold, 58)
    assert.equal(at(r7, steady).saleRecords, 3)
    assert.equal(at(r7, steady).firstSaleDate, '2026-09-03')
    assert.equal(at(r7, steady).lastSaleDate, '2026-09-28')
    assert.equal(at(r7, steady).averageDailyDemand, 2)
    assert.equal(at(r7, steady).forecastedDemand, 14)
    assert.equal(at(r14, steady).forecastedDemand, 28)
    assert.equal(at(r30, steady).forecastedDemand, 60)
    assert.equal(at(r30, steady).forecastHorizonDays, 30)
    assert.equal(at(r7, steady).dataStatus, 'Sufficient')

    assert.equal(at(r7, thin).historicalUnitsSold, 4)
    assert.equal(at(r7, thin).dataStatus, 'Limited History')

    assert.equal(at(r7, idle).historicalUnitsSold, 0)
    assert.equal(at(r7, idle).forecastedDemand, 0)
    assert.equal(at(r7, idle).dataStatus, 'No Sales')

    assert.deepEqual(await getDemandForecast({ horizonDays: 7, period }), r7) // deterministic
  })
})

describe('GET /api/analytics/forecast', () => {
  const get = async (q = '') => {
    const res = await fetch(`${base}/api/analytics/forecast${q}`)
    return { status: res.status, body: await res.json() }
  }

  it('returns a forecast for every product, consistent with the raw sales (default 7 days)', async () => {
    const { status, body: b } = await get()
    assert.equal(status, 200)
    assert.equal(b.forecastHorizonDays, 7)
    assert.equal(b.products.length, await prisma.product.count())
    assert.equal(b.historyPeriod.days, daysBetweenInclusive(b.historyPeriod.startDate, b.historyPeriod.endDate))

    const sales = await prisma.sale.findMany()
    for (const p of b.products) {
      const mine = sales.filter((s) => s.productId === p.productId)
      const units = mine.reduce((a, s) => a + s.quantity, 0)
      assert.equal(p.historicalUnitsSold, units, p.productName)
      assert.equal(p.saleRecords, mine.length, p.productName)
      assert.equal(p.averageDailyDemand, Math.round((units / b.historyPeriod.days) * 100) / 100, p.productName)
      assert.equal(p.forecastedDemand, Math.round(((units / b.historyPeriod.days) * 7) * 100) / 100, p.productName)
      assert.ok(['No Sales', 'Limited History', 'Sufficient'].includes(p.dataStatus))
      assert.ok(Number.isFinite(p.forecastedDemand) && p.forecastedDemand >= 0)
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
      assert.ok(Array.isArray(body.error.details), q)
    }
  })

  it('is read-only', async () => {
    const before = await snapshot()
    for (const q of ['', '?days=14', '?days=30']) assert.equal((await get(q)).status, 200)
    assert.equal(await snapshot(), before)
    assert.equal((await fetch(`${base}/api/analytics/forecast`, { method: 'POST' })).status, 404)
  })
})

// API tests for the new intelligence endpoints against the real (Supabase) database.
// Everything here is READ-ONLY: the tests create nothing and assert that no record changed.
//
// Run with: npm test
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { calcInventoryValue, getAllProductStock } from '../src/services/analytics'

let server: Server
let base: string

const get = async (path: string) => {
  const res = await fetch(base + path)
  return { status: res.status, body: (await res.json()) as any }
}

const snapshot = async () =>
  JSON.stringify({
    products: await prisma.product.findMany({ orderBy: { id: 'asc' } }),
    sales: await prisma.sale.findMany({ orderBy: { id: 'asc' } }),
    purchases: await prisma.purchase.findMany({ orderBy: { id: 'asc' } }),
    expenses: await prisma.expense.findMany({ orderBy: { id: 'asc' } }),
  })

before(() => {
  server = createApp().listen(0)
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await new Promise((r) => server.close(r))
  await prisma.$disconnect()
})

describe('existing endpoints stay compatible', () => {
  it('/forecast keeps its original shape', async () => {
    const { status, body } = await get('/api/analytics/forecast?days=7')
    assert.equal(status, 200)
    assert.equal(body.method, 'historical-average-daily-demand')
    assert.ok(Array.isArray(body.products))
    for (const key of ['productId', 'forecastedDemand', 'averageDailyDemand', 'dataStatus']) assert.ok(key in body.products[0], key)
  })

  it('/restocking defaults to the baseline forecast', async () => {
    const { body } = await get('/api/analytics/restocking?days=7')
    assert.equal(body.forecastSource, 'baseline')
    assert.ok(Array.isArray(body.needsRestocking) && Array.isArray(body.products))
  })

  it('/summary keeps its fields and adds inventoryValue', async () => {
    const { body } = await get('/api/analytics/summary')
    for (const key of ['totalRevenue', 'totalExpenses', 'estimatedProfit', 'totalProducts', 'lowStockProducts', 'topSellingProducts', 'salesTrend', 'recentActivity']) {
      assert.ok(key in body, key)
    }
    assert.equal(typeof body.inventoryValue, 'number')
  })

  it('/summary inventoryValue = sum(current stock x purchase price) recomputed independently', async () => {
    const [{ body }, products, stock] = await Promise.all([get('/api/analytics/summary'), prisma.product.findMany(), getAllProductStock()])
    const price = new Map(products.map((p) => [p.id, Number(p.purchasePrice)]))
    const expected = calcInventoryValue(stock.map((s) => ({ currentStock: s.currentStock, purchasePrice: price.get(s.productId)! })))
    assert.equal(body.inventoryValue, expected)
  })
})

describe('GET /api/analytics/forecast/validated', () => {
  it('returns split, selection, accuracy vs baseline and per-product forecasts', async () => {
    const { status, body } = await get('/api/analytics/forecast/validated?days=7')
    assert.equal(status, 200)
    assert.equal(body.baselineModel, 'historical-mean')
    assert.equal(body.forecastHorizonDays, 7)
    assert.ok(body.selectedModel.name)
    assert.match(body.limitation, /past sales/)
    const products = await prisma.product.count()
    assert.equal(body.products.length, products)
    if (body.split) {
      assert.ok(body.split.train.endDate < body.split.validation.startDate)
      assert.ok(body.split.validation.endDate < body.split.test.startDate)
      assert.equal(body.split.test.endDate, body.historyPeriod.endDate)
      assert.ok('mae' in body.accuracy.selected && 'wape' in body.accuracy.baseline)
    } else {
      assert.equal(body.accuracy, null)
    }
  })

  it('rejects an invalid horizon with the standard error shape', async () => {
    const { status, body } = await get('/api/analytics/forecast/validated?days=0')
    assert.equal(status, 400)
    assert.equal(body.error.code, 'VALIDATION_ERROR')
  })
})

describe('GET /api/analytics/inventory-intelligence', () => {
  it('joins stock, forecast, restocking and priority consistently', async () => {
    const [{ body }, restock, stock] = await Promise.all([
      get('/api/analytics/inventory-intelligence?days=7'),
      get('/api/analytics/restocking?days=7&forecast=validated'),
      getAllProductStock(),
    ])
    assert.equal(restock.body.forecastSource, 'validated')
    assert.equal(body.products.length, stock.length)
    assert.equal(body.summary.high + body.summary.medium + body.summary.low, stock.length)

    const stockById = new Map(stock.map((s) => [s.productId, s]))
    const recById = new Map<string, any>(restock.body.products.map((r: any) => [r.productId, r]))
    for (const p of body.products) {
      assert.equal(p.currentStock, stockById.get(p.productId)!.currentStock, p.productName)
      assert.equal(p.recommendedQuantity, recById.get(p.productId).recommendedQuantity, p.productName)
      assert.ok(['High', 'Medium', 'Low'].includes(p.priority))
      assert.ok(p.priorityReasons.length > 0)
      assert.doesNotMatch(p.advice, /\bmust\b/i)
      // stock rules always apply
      if (p.currentStock <= p.minimumStockLevel) assert.equal(p.priority, 'High', p.productName)
    }
  })

  it('is sorted High -> Medium -> Low', async () => {
    const { body } = await get('/api/analytics/inventory-intelligence')
    const rank = { High: 0, Medium: 1, Low: 2 } as const
    const ranks = body.products.map((p: any) => rank[p.priority as keyof typeof rank])
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
  })

  it('labels its data source as business data', async () => {
    const { body } = await get('/api/analytics/inventory-intelligence')
    assert.match(body.dataSource, /^Business data/)
  })
})

describe('GET /api/external/market-prices', () => {
  it('is labelled external, carries provenance and never fabricates figures', async () => {
    const { status, body } = await get('/api/external/market-prices')
    assert.equal(status, 200)
    assert.equal(body.kind, 'external-market-data')
    assert.match(body.provenance.publisher, /Department of Consumer Affairs/)
    assert.match(body.provenance.officialUrl, /data\.gov\.in/)
    if (body.status.state !== 'ready') {
      assert.deepEqual(body.commodities, [])
      assert.equal(body.provenance.dataPeriod, null)
    } else {
      assert.ok(body.commodities.length > 0)
    }
    // external data never carries product ids from the shop
    assert.ok(!JSON.stringify(body).includes('productId'))
  })
})

describe('read-only guarantee', () => {
  it('none of the new endpoints changes any stored record', async () => {
    const before = await snapshot()
    for (const path of [
      '/api/analytics/forecast/validated?days=14',
      '/api/analytics/inventory-intelligence?days=30',
      '/api/analytics/restocking?days=7&forecast=validated',
      '/api/analytics/summary',
      '/api/external/market-prices',
    ]) {
      assert.equal((await get(path)).status, 200, path)
    }
    assert.equal(await snapshot(), before)
  })
})

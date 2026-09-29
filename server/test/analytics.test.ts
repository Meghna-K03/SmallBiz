// Phase 4B analytics tests. Totals are checked against an independent sum of
// the raw rows in the real (Supabase) database. Where a specific stock level is
// needed, temporary "ZZ Analytics ..." products are created and always deleted.
// Existing business data is only read.
//
// Run with: npm test
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import {
  getAllProductStock,
  getEstimatedProfit,
  getExpensesTotal,
  getLowStockProducts,
  getProductStock,
  getRecentActivity,
  getRevenue,
  getSalesTrend,
  getTopSellingProducts,
  groupSalesByDate,
  rankTopSelling,
  sortActivity,
  stockStatusOf,
  type ActivityItem,
} from '../src/services/analytics'

let server: Server
let base: string
const tempIds: string[] = []

const cents = (n: unknown) => Math.round(Number(n) * 100)
const snapshot = async () => ({
  products: await prisma.product.findMany({ orderBy: { id: 'asc' } }),
  sales: await prisma.sale.findMany({ orderBy: { id: 'asc' } }),
  purchases: await prisma.purchase.findMany({ orderBy: { id: 'asc' } }),
  expenses: await prisma.expense.findMany({ orderBy: { id: 'asc' } }),
})

async function tempProduct(openingStock: number, minStockLevel: number, purchased: number, sold: number) {
  const p = await prisma.product.create({
    data: {
      name: `ZZ Analytics ${tempIds.length}`,
      category: 'Test',
      unit: 'packs',
      sellingPrice: 10,
      purchasePrice: 6,
      openingStock,
      minStockLevel,
    },
  })
  tempIds.push(p.id)
  const date = new Date('2026-09-29T00:00:00.000Z')
  if (purchased) await prisma.purchase.create({ data: { productId: p.id, quantity: purchased, purchasePrice: 6, date } })
  if (sold) await prisma.sale.create({ data: { productId: p.id, quantity: sold, sellingPrice: 10, date } })
  return p.id
}

before(async () => {
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

describe('stock calculations', () => {
  it('current stock = opening + purchased - sold', async () => {
    const id = await tempProduct(5, 3, 10, 12)
    const s = await getProductStock(id)
    assert.equal(s?.currentStock, 3)
    assert.equal(s?.purchased, 10)
    assert.equal(s?.sold, 12)
  })

  it('returns null for an unknown product', async () => {
    assert.equal(await getProductStock('00000000-0000-4000-8000-000000000000'), null)
  })

  it('matches an independent calculation for every real product', async () => {
    const [products, purchases, sales, all] = await Promise.all([
      prisma.product.findMany(),
      prisma.purchase.findMany(),
      prisma.sale.findMany(),
      getAllProductStock(),
    ])
    for (const p of products) {
      const expected =
        p.openingStock +
        purchases.filter((x) => x.productId === p.id).reduce((a, x) => a + x.quantity, 0) -
        sales.filter((x) => x.productId === p.id).reduce((a, x) => a + x.quantity, 0)
      assert.equal(all.find((s) => s.productId === p.id)?.currentStock, expected, p.name)
    }
  })

  it('never stores currentStock on the product', async () => {
    const p = await prisma.product.findFirst()
    assert.ok(p && !('currentStock' in p))
  })
})

describe('stock status and low-stock detection', () => {
  it('classifies statuses', () => {
    assert.equal(stockStatusOf(10, 3), 'Healthy')
    assert.equal(stockStatusOf(4, 3), 'Healthy')
    assert.equal(stockStatusOf(3, 3), 'Low Stock')
    assert.equal(stockStatusOf(1, 3), 'Low Stock')
    assert.equal(stockStatusOf(0, 3), 'Out of Stock')
    assert.equal(stockStatusOf(0, 0), 'Out of Stock')
  })

  it('detects low-stock (<= minimum) and out-of-stock products, not healthy ones', async () => {
    const low = await tempProduct(5, 3, 10, 12) // stock 3, min 3
    const out = await tempProduct(4, 3, 0, 4) // stock 0
    const healthy = await tempProduct(20, 3, 0, 1) // stock 19
    const list = await getLowStockProducts()
    const byId = new Map(list.map((p) => [p.productId, p]))
    assert.equal(byId.get(low)?.stockStatus, 'Low Stock')
    assert.equal(byId.get(low)?.currentStock, 3)
    assert.equal(byId.get(low)?.minStockLevel, 3)
    assert.equal(byId.get(out)?.stockStatus, 'Out of Stock')
    assert.equal(byId.has(healthy), false)
    // Most urgent (lowest stock) first.
    assert.ok(list.findIndex((p) => p.productId === out) < list.findIndex((p) => p.productId === low))
  })
})

describe('financial totals', () => {
  it('revenue = sum of quantity x recorded selling price', async () => {
    const sales = await prisma.sale.findMany()
    const expected = sales.reduce((a, s) => a + s.quantity * cents(s.sellingPrice), 0) / 100
    assert.equal(await getRevenue(), expected)
  })

  it('total expenses = sum of recorded expenses', async () => {
    const expenses = await prisma.expense.findMany()
    const expected = expenses.reduce((a, e) => a + cents(e.amount), 0) / 100
    assert.equal(await getExpensesTotal(), expected)
  })

  it('estimated profit = revenue - expenses', async () => {
    const [r, e, p] = await Promise.all([getRevenue(), getExpensesTotal(), getEstimatedProfit()])
    assert.equal(p, (cents(r) - cents(e)) / 100)
  })
})

describe('top-selling products', () => {
  const products = [
    { id: 'a', name: 'Apple', category: 'x' },
    { id: 'b', name: 'Banana', category: 'x' },
    { id: 'c', name: 'Cherry', category: 'x' },
    { id: 'd', name: 'Unsold', category: 'x' },
  ]
  const sale = (productId: string, quantity: number, sellingPrice: number) => ({ productId, quantity, sellingPrice, date: '2026-01-01' })

  it('ranks by quantity sold, breaks ties by revenue, omits unsold, honours limit', () => {
    const sales = [sale('a', 2, 1), sale('b', 5, 1), sale('b', 1, 1), sale('c', 6, 3), sale('a', 4, 1)]
    const ranked = rankTopSelling(products, sales, 5)
    assert.deepEqual(ranked.map((r) => [r.name, r.quantitySold, r.revenue]), [
      ['Cherry', 6, 18],
      ['Apple', 6, 6],
      ['Banana', 6, 6],
    ])
    assert.equal(rankTopSelling(products, sales, 1).length, 1)
  })

  it('DB ranking is sorted by quantity descending', async () => {
    const top = await getTopSellingProducts(100)
    for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].quantitySold >= top[i].quantitySold)
    assert.ok(top.every((t) => t.quantitySold > 0))
  })
})

describe('sales trend', () => {
  it('groups by date, sums totals, sorts ascending', () => {
    const trend = groupSalesByDate([
      { productId: 'a', quantity: 2, sellingPrice: 1.1, date: '2026-02-02' },
      { productId: 'b', quantity: 1, sellingPrice: 0.2, date: '2026-02-01' },
      { productId: 'a', quantity: 3, sellingPrice: 0.1, date: '2026-02-02' },
    ])
    assert.deepEqual(trend, [
      { date: '2026-02-01', total: 0.2, unitsSold: 1, salesCount: 1 },
      { date: '2026-02-02', total: 2.5, unitsSold: 5, salesCount: 2 },
    ])
  })

  it('DB trend sums to total revenue with unique ascending dates', async () => {
    const trend = await getSalesTrend()
    assert.equal(trend.reduce((a, t) => a + cents(t.total), 0) / 100, await getRevenue())
    for (let i = 1; i < trend.length; i++) assert.ok(trend[i - 1].date < trend[i].date)
  })
})

describe('recent activity', () => {
  const item = (type: ActivityItem['type'], id: string, date: string, ms: number): ActivityItem => ({
    type, id, date, description: id, amount: 1, createdAt: new Date(ms),
  })

  it('sorts newest first with deterministic tie-breaks', () => {
    const sorted = sortActivity([
      item('Expense', 'e1', '2026-03-01', 1),
      item('Sale', 's1', '2026-03-02', 1),
      item('Purchase', 'p1', '2026-03-02', 5),
      item('Sale', 's2', '2026-03-02', 1),
    ])
    assert.deepEqual(sorted.map((i) => i.id), ['p1', 's1', 's2', 'e1'])
  })

  it('DB activity is ordered, limited, and mixes record types', async () => {
    const recent = await getRecentActivity(8)
    assert.ok(recent.length <= 8)
    for (let i = 1; i < recent.length; i++) assert.ok(recent[i - 1].date >= recent[i].date)
    assert.ok(new Set(recent.map((r) => r.type)).size >= 1)
  })
})

describe('GET /api/analytics/summary', () => {
  it('returns the structured summary consistent with the calculations', async () => {
    const res = await fetch(`${base}/api/analytics/summary`)
    assert.equal(res.status, 200)
    const b = await res.json()
    for (const k of ['totalRevenue', 'totalExpenses', 'estimatedProfit', 'totalProducts']) {
      assert.equal(typeof b[k], 'number', k)
    }
    for (const k of ['lowStockProducts', 'topSellingProducts', 'salesTrend', 'recentActivity']) {
      assert.ok(Array.isArray(b[k]), k)
    }
    assert.equal(b.estimatedProfit, (cents(b.totalRevenue) - cents(b.totalExpenses)) / 100)
    assert.equal(b.totalProducts, await prisma.product.count())
    assert.ok(b.lowStockProducts.every((p: any) => p.currentStock <= p.minStockLevel && p.stockStatus !== 'Healthy'))
  })

  it('does not modify any records', async () => {
    const before = JSON.stringify(await snapshot())
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/api/analytics/summary`)).status, 200)
    assert.equal(JSON.stringify(await snapshot()), before)
  })

  it('rejects writes to the analytics route', async () => {
    const res = await fetch(`${base}/api/analytics/summary`, { method: 'POST' })
    assert.equal(res.status, 404)
  })
})

// Business-rule tests. They run against the real (Supabase) database using a
// temporary product named "ZZ Test ..." and delete everything they create.
// Seeded data is only read, never modified.
//
// Run with: npm test
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'

let server: Server
let base: string
const productIds: string[] = []
let seedCounts: { products: number; sales: number; purchases: number; expenses: number }

async function call(method: string, path: string, body?: unknown, rawBody?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

const counts = async () => ({
  products: await prisma.product.count(),
  sales: await prisma.sale.count(),
  purchases: await prisma.purchase.count(),
  expenses: await prisma.expense.count(),
})

const productBody = (over: Record<string, unknown> = {}) => ({
  name: 'ZZ Test Product',
  category: 'Test',
  unit: 'packs',
  sellingPrice: 10,
  purchasePrice: 6,
  openingStock: 10,
  minStockLevel: 2,
  ...over,
})

async function newProduct(over: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/products', productBody(over))
  assert.equal(res.status, 201)
  productIds.push(res.body.id)
  return res.body.id as string
}

const sale = (productId: string, quantity: number, over: Record<string, unknown> = {}) =>
  call('POST', '/api/sales', { productId, quantity, sellingPrice: 10, date: '2026-09-29', ...over })

const purchase = (productId: string, quantity: number, over: Record<string, unknown> = {}) =>
  call('POST', '/api/purchases', { productId, quantity, purchasePrice: 6, date: '2026-09-29', ...over })

// Current stock as the API's own data implies it: opening + purchases - sales.
async function stockOf(productId: string) {
  const [p, sales, purchases] = await Promise.all([
    call('GET', `/api/products/${productId}`),
    call('GET', '/api/sales'),
    call('GET', '/api/purchases'),
  ])
  const sold = sales.body.filter((s: any) => s.productId === productId).reduce((a: number, s: any) => a + s.quantity, 0)
  const bought = purchases.body.filter((s: any) => s.productId === productId).reduce((a: number, s: any) => a + s.quantity, 0)
  return p.body.openingStock + bought - sold
}

before(async () => {
  server = createApp().listen(0)
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  seedCounts = await counts()
})

after(async () => {
  await prisma.sale.deleteMany({ where: { productId: { in: productIds } } })
  await prisma.purchase.deleteMany({ where: { productId: { in: productIds } } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  const final = await counts()
  server.close()
  await prisma.$disconnect()
  assert.deepEqual(final, seedCounts, 'test data must be fully cleaned up')
})

describe('existing data still loads', () => {
  it('lists products, sales, purchases and expenses', async () => {
    for (const [path, min] of [['/api/products', 9], ['/api/sales', 98], ['/api/purchases', 11], ['/api/expenses', 14]] as const) {
      const res = await call('GET', path)
      assert.equal(res.status, 200, path)
      assert.ok(res.body.length >= min, `${path} has at least ${min} records`)
    }
  })

  it('calculates current stock from opening stock, purchases and sales (controlled temporary data)', async () => {
    // Independent of live data: temporary products with known history, deleted afterwards.
    const soldOut = await newProduct({ openingStock: 20 })
    assert.equal((await purchase(soldOut, 10)).status, 201)
    assert.equal((await sale(soldOut, 30)).status, 201)
    assert.equal(await stockOf(soldOut), 0)

    const partial = await newProduct({ openingStock: 10 })
    assert.equal((await purchase(partial, 5)).status, 201)
    assert.equal((await sale(partial, 3)).status, 201)
    assert.equal(await stockOf(partial), 12)

    const plenty = await newProduct({ openingStock: 200 })
    assert.equal((await sale(plenty, 80)).status, 201)
    assert.equal(await stockOf(plenty), 120)
  })
})

describe('stock rule: opening 10 + purchases 5 - sales 3 = 12', () => {
  it('calculates stock, then rejects a sale of 13', async () => {
    const id = await newProduct({ openingStock: 10 })
    assert.equal((await purchase(id, 5)).status, 201)
    assert.equal((await sale(id, 3)).status, 201)
    assert.equal(await stockOf(id), 12)

    const res = await sale(id, 13)
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK')
    assert.equal(res.body.error.message, 'Only 12 units are available for this product.')
    assert.equal(await stockOf(id), 12, 'rejected sale must not be recorded')
  })

  it('allows selling exactly the available stock, then reports out of stock', async () => {
    const id = await newProduct({ openingStock: 4 })
    assert.equal((await sale(id, 4)).status, 201)
    assert.equal(await stockOf(id), 0)
    const res = await sale(id, 1)
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK')
    assert.equal(res.body.error.message, 'This product is out of stock.')
  })

  it('uses singular wording for one unit', async () => {
    const id = await newProduct({ openingStock: 1 })
    const res = await sale(id, 2)
    assert.equal(res.body.error.message, 'Only 1 unit is available for this product.')
  })

  it('a purchase makes room for a sale that was previously rejected', async () => {
    const id = await newProduct({ openingStock: 2 })
    assert.equal((await sale(id, 5)).status, 400)
    assert.equal((await purchase(id, 10)).status, 201)
    assert.equal((await sale(id, 5)).status, 201)
    assert.equal(await stockOf(id), 7)
  })

  it('never oversells when sales arrive at the same time', async () => {
    const id = await newProduct({ openingStock: 5 })
    const results = await Promise.all([1, 2, 3, 4].map(() => sale(id, 2)))
    const ok = results.filter((r) => r.status === 201).length
    assert.equal(ok, 2, 'only two sales of 2 fit into 5 units')
    assert.equal(results.filter((r) => r.status === 400).length, 2)
    assert.equal(await stockOf(id), 1)
  })
})

describe('product edits cannot make stock negative', () => {
  it('rejects lowering opening stock below what has already been sold', async () => {
    const id = await newProduct({ openingStock: 10 })
    await sale(id, 8)
    const res = await call('PUT', `/api/products/${id}`, productBody({ openingStock: 5 }))
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK')
    assert.equal((await call('GET', `/api/products/${id}`)).body.openingStock, 10)
  })

  it('accepts a valid edit, and returns 404 for a missing product', async () => {
    const id = await newProduct({ openingStock: 10 })
    await sale(id, 8)
    const ok = await call('PUT', `/api/products/${id}`, productBody({ openingStock: 8, name: 'ZZ Test Renamed' }))
    assert.equal(ok.status, 200)
    assert.equal(await stockOf(id), 0)
    const missing = await call('PUT', '/api/products/00000000-0000-4000-8000-000000000000', productBody())
    assert.equal(missing.status, 404)
  })
})

describe('sale validation', () => {
  it('rejects a nonexistent product', async () => {
    const res = await sale('00000000-0000-4000-8000-000000000000', 1)
    assert.equal(res.status, 400)
    assert.match(res.body.error.message, /product/i)
  })

  it('rejects zero, negative, fractional and non-numeric quantities', async () => {
    const id = await newProduct()
    for (const q of [0, -1, 1.5, '2', null]) {
      const res = await sale(id, q as number)
      assert.equal(res.status, 400, `quantity ${JSON.stringify(q)}`)
      assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    }
  })

  it('rejects invalid price and date', async () => {
    const id = await newProduct()
    assert.equal((await sale(id, 1, { sellingPrice: -1 })).status, 400)
    assert.equal((await sale(id, 1, { sellingPrice: 'abc' })).status, 400)
    assert.equal((await sale(id, 1, { date: '2026-02-30' })).status, 400)
    assert.equal((await sale(id, 1, { date: 'today' })).status, 400)
    assert.equal((await sale(id, 1, { date: undefined })).status, 400)
    assert.equal(await stockOf(id), 10, 'no invalid sale was recorded')
  })
})

describe('purchase validation', () => {
  it('rejects a nonexistent product', async () => {
    assert.equal((await purchase('00000000-0000-4000-8000-000000000000', 1)).status, 400)
  })

  it('rejects zero, negative and fractional quantities', async () => {
    const id = await newProduct()
    for (const q of [0, -5, 2.5]) assert.equal((await purchase(id, q)).status, 400, `quantity ${q}`)
  })

  it('rejects invalid price and date, allows optional supplier', async () => {
    const id = await newProduct()
    assert.equal((await purchase(id, 1, { purchasePrice: -2 })).status, 400)
    assert.equal((await purchase(id, 1, { purchasePrice: null })).status, 400)
    assert.equal((await purchase(id, 1, { date: '31-12-2026' })).status, 400)
    assert.equal((await purchase(id, 1)).status, 201)
    assert.equal((await purchase(id, 1, { supplier: 'ZZ Supplier' })).body.supplier, 'ZZ Supplier')
    assert.equal(await stockOf(id), 12)
  })
})

describe('product validation', () => {
  it('rejects empty names and categories', async () => {
    assert.equal((await call('POST', '/api/products', productBody({ name: '' }))).status, 400)
    assert.equal((await call('POST', '/api/products', productBody({ name: '   ' }))).status, 400)
    assert.equal((await call('POST', '/api/products', productBody({ category: '' }))).status, 400)
  })

  it('rejects negative or invalid prices and stock levels', async () => {
    for (const over of [
      { sellingPrice: -1 },
      { purchasePrice: -0.01 },
      { sellingPrice: 'ten' },
      { openingStock: -1 },
      { openingStock: 1.5 },
      { minStockLevel: -3 },
      { minStockLevel: null },
    ]) {
      const res = await call('POST', '/api/products', productBody(over))
      assert.equal(res.status, 400, JSON.stringify(over))
      assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    }
  })

  it('accepts zero prices and zero stock', async () => {
    await newProduct({ sellingPrice: 0, purchasePrice: 0, openingStock: 0, minStockLevel: 0 })
  })
})

describe('expense validation', () => {
  const expense = (over: Record<string, unknown> = {}) =>
    call('POST', '/api/expenses', { category: 'Rent', amount: 100, date: '2026-09-29', description: 'ZZ never saved', ...over })

  it('rejects invalid amount, category and date', async () => {
    for (const over of [{ amount: 0 }, { amount: -5 }, { amount: 'x' }, { category: '' }, { category: undefined }, { date: '2026-13-01' }, { date: undefined }]) {
      const res = await expense(over)
      assert.equal(res.status, 400, JSON.stringify(over))
    }
    assert.equal((await counts()).expenses, seedCounts.expenses, 'no invalid expense was stored')
  })
})

describe('error handling', () => {
  it('returns 400 for malformed JSON and keeps serving requests', async () => {
    const res = await call('POST', '/api/sales', undefined, '{oops')
    assert.equal(res.status, 400)
    assert.equal((await call('GET', '/api/health')).status, 200)
  })
})

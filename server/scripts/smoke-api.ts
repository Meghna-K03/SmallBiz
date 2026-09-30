// Read-only API smoke test. Starts the app in-process on a random port, calls every important
// route with GET only, checks status and key fields, and confirms row counts did not change.
// Usage: npm run verify:api
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'

const failures: string[] = []
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
  if (!ok) failures.push(message)
}

const counts = async () =>
  JSON.stringify([await prisma.product.count(), await prisma.sale.count(), await prisma.purchase.count(), await prisma.expense.count()])

const ROUTES: { path: string; keys: string[] }[] = [
  { path: '/api/health', keys: ['status'] },
  { path: '/api/products', keys: [] },
  { path: '/api/sales', keys: [] },
  { path: '/api/purchases', keys: [] },
  { path: '/api/expenses', keys: [] },
  { path: '/api/analytics/summary', keys: ['totalRevenue', 'estimatedProfit', 'inventoryValue', 'lowStockProducts'] },
  { path: '/api/analytics/product-insights', keys: ['analysisPeriod', 'products'] },
  { path: '/api/analytics/forecast?days=7', keys: ['method', 'products'] },
  { path: '/api/analytics/forecast/validated?days=7', keys: ['selectedModel', 'baselineModel', 'products', 'limitation'] },
  { path: '/api/analytics/restocking?days=7', keys: ['summary', 'products'] },
  { path: '/api/analytics/restocking?days=7&forecast=validated', keys: ['forecastSource', 'products'] },
  { path: '/api/analytics/inventory-intelligence?days=7', keys: ['inventoryValue', 'summary', 'products', 'dataSource'] },
  { path: '/api/external/market-prices', keys: ['kind', 'status', 'provenance'] },
  { path: '/api/analytics/competitive-prices', keys: ['files', 'platformCoverage', 'blinkit', 'zepto', 'reference', 'limitations'] },
  { path: '/api/analytics/competitive-prices/observations?limit=5', keys: ['total', 'observations'] },
]

async function main() {
  const server = createApp().listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const before = await counts()
  try {
    for (const { path, keys } of ROUTES) {
      const res = await fetch(base + path)
      const body: any = await res.json().catch(() => null)
      const missing = keys.filter((k) => body === null || !(k in body))
      check(res.status === 200 && missing.length === 0, `GET ${path} -> ${res.status}${missing.length ? ` missing ${missing.join(', ')}` : ''}`)
    }
    const bad = await fetch(`${base}/api/analytics/forecast/validated?days=0`)
    check(bad.status === 400, 'invalid horizon is rejected with 400')
    const unknown = await fetch(`${base}/api/nope`)
    check(unknown.status === 404, 'unknown route returns 404')
    check((await counts()) === before, 'row counts unchanged by the smoke test')
    console.log(`Database connectivity: OK (${JSON.parse(before).join(' / ')} products/sales/purchases/expenses)`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

main()
  .catch((e) => {
    console.error('smoke-api failed:', e instanceof Error ? e.message : e)
    failures.push('smoke test crashed')
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exitCode = failures.length > 0 ? 1 : 0
  })

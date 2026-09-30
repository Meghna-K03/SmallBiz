// Read-only database snapshot used by the verification harness: row counts and
// the sales date range. Run before and after tests to prove no legitimate data changed.
// Usage: npm run db:counts
import { prisma } from '../src/lib/prisma'

async function main() {
  const [products, sales, purchases, expenses, testProducts, range] = await Promise.all([
    prisma.product.count(),
    prisma.sale.count(),
    prisma.purchase.count(),
    prisma.expense.count(),
    prisma.product.count({ where: { name: { startsWith: 'ZZ' } } }),
    prisma.sale.aggregate({ _min: { date: true }, _max: { date: true } }),
  ])
  console.log(
    JSON.stringify({
      products,
      sales,
      purchases,
      expenses,
      leftoverTestProducts: testProducts,
      salesFrom: range._min.date?.toISOString().slice(0, 10) ?? null,
      salesTo: range._max.date?.toISOString().slice(0, 10) ?? null,
    }),
  )
}

main()
  .catch((e) => {
    console.error('db-counts failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

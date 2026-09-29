// Development seed: loads the "Sharma General Store" data that the frontend
// prototype uses (src/data/mockData.ts), so the database and UI stay consistent.
// Re-running is safe: it clears the four tables first, then re-inserts.
import { prisma } from '../src/lib/prisma'
import { EXPENSES, PRODUCTS, PURCHASES, SALES } from '../../src/data/mockData'

// Mock dates are 'YYYY-MM-DD'; store them as UTC midnight (Postgres DATE).
const toDate = (d: string) => new Date(`${d}T00:00:00.000Z`)

async function main() {
  await prisma.$transaction([
    prisma.sale.deleteMany(),
    prisma.purchase.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.product.deleteMany(),
  ])

  // Mock ids ('p1', 's1-1', ...) are not UUIDs, so let the database
  // generate ids and map mock product ids to the created ones.
  const idByMockId = new Map<string, string>()
  for (const p of PRODUCTS) {
    const created = await prisma.product.create({
      data: {
        name: p.name,
        category: p.category,
        unit: p.unit,
        sellingPrice: p.sellingPrice,
        purchasePrice: p.purchasePrice,
        openingStock: p.openingStock,
        minStockLevel: p.minStockLevel,
      },
    })
    idByMockId.set(p.id, created.id)
  }

  const productId = (mockId: string) => {
    const id = idByMockId.get(mockId)
    if (!id) throw new Error(`Unknown mock product id: ${mockId}`)
    return id
  }

  await prisma.sale.createMany({
    data: SALES.map((s) => ({
      productId: productId(s.productId),
      quantity: s.quantity,
      sellingPrice: s.sellingPrice,
      date: toDate(s.date),
    })),
  })

  await prisma.purchase.createMany({
    data: PURCHASES.map((p) => ({
      productId: productId(p.productId),
      quantity: p.quantity,
      purchasePrice: p.purchasePrice,
      date: toDate(p.date),
      supplier: p.supplier ?? null,
    })),
  })

  await prisma.expense.createMany({
    data: EXPENSES.map((e) => ({
      category: e.category,
      amount: e.amount,
      date: toDate(e.date),
      description: e.description,
    })),
  })

  const [products, sales, purchases, expenses] = await Promise.all([
    prisma.product.count(),
    prisma.sale.count(),
    prisma.purchase.count(),
    prisma.expense.count(),
  ])
  console.log(`Seeded: ${products} products, ${sales} sales, ${purchases} purchases, ${expenses} expenses`)
}

main()
  .catch((err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

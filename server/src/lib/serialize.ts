import type { Expense, Product, Purchase, Sale } from '@prisma/client'

// Prisma returns Decimal columns as Decimal objects (JSON strings) and DATE
// columns as full timestamps. The API returns plain numbers and 'YYYY-MM-DD'
// dates, matching the shapes the frontend already uses.

const day = (d: Date) => d.toISOString().slice(0, 10)

export const productDto = (p: Product) => ({
  id: p.id,
  name: p.name,
  category: p.category,
  unit: p.unit,
  sellingPrice: Number(p.sellingPrice),
  purchasePrice: Number(p.purchasePrice),
  openingStock: p.openingStock,
  minStockLevel: p.minStockLevel,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
})

export const saleDto = (s: Sale) => ({
  id: s.id,
  productId: s.productId,
  quantity: s.quantity,
  sellingPrice: Number(s.sellingPrice),
  date: day(s.date),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
})

export const purchaseDto = (p: Purchase) => ({
  id: p.id,
  productId: p.productId,
  quantity: p.quantity,
  purchasePrice: Number(p.purchasePrice),
  date: day(p.date),
  supplier: p.supplier,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
})

export const expenseDto = (e: Expense) => ({
  id: e.id,
  category: e.category,
  amount: Number(e.amount),
  date: day(e.date),
  description: e.description,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
})

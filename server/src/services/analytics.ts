import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../lib/prisma'

/**
 * Read-only business calculations (Phase 4B).
 *
 *   Current Stock    = Opening Stock + purchased quantity - sold quantity
 *   Low Stock        = Current Stock <= Minimum Stock Level
 *   Revenue          = SUM(sale.quantity * sale.sellingPrice)
 *   Estimated Profit = Revenue - Expenses
 *
 * Everything is derived from existing tables. Nothing here writes to the database.
 * Money is summed in integer cents so results have no floating-point drift.
 */

type Db = PrismaClient | Prisma.TransactionClient

export type StockStatus = 'Healthy' | 'Low Stock' | 'Out of Stock'

const toCents = (v: { toString(): string } | number) => Math.round(Number(v) * 100)
const fromCents = (c: number) => c / 100
const day = (d: Date) => d.toISOString().slice(0, 10)

// ---------- Pure helpers (no database) ----------

export function stockStatusOf(currentStock: number, minStockLevel: number): StockStatus {
  if (currentStock <= 0) return 'Out of Stock'
  if (currentStock <= minStockLevel) return 'Low Stock'
  return 'Healthy'
}

export interface ProductStock {
  productId: string
  name: string
  category: string
  unit: string
  openingStock: number
  purchased: number
  sold: number
  currentStock: number
  minStockLevel: number
  stockStatus: StockStatus
}

export interface SaleRow {
  productId: string
  quantity: number
  sellingPrice: number
  date: string
}

export interface TopSellingProduct {
  productId: string
  name: string
  category: string
  quantitySold: number
  revenue: number
}

/** Ranks by quantity sold (desc); ties broken by revenue (desc), then name. */
export function rankTopSelling(
  products: { id: string; name: string; category: string }[],
  sales: SaleRow[],
  limit: number,
): TopSellingProduct[] {
  const byProduct = new Map<string, { qty: number; cents: number }>()
  for (const s of sales) {
    const e = byProduct.get(s.productId) ?? { qty: 0, cents: 0 }
    e.qty += s.quantity
    e.cents += s.quantity * toCents(s.sellingPrice)
    byProduct.set(s.productId, e)
  }
  return products
    .filter((p) => (byProduct.get(p.id)?.qty ?? 0) > 0)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      category: p.category,
      quantitySold: byProduct.get(p.id)!.qty,
      revenue: fromCents(byProduct.get(p.id)!.cents),
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export interface SalesTrendPoint {
  date: string
  total: number
  unitsSold: number
  salesCount: number
}

/** Daily sales totals in ascending date order. Historical data only. */
export function groupSalesByDate(sales: SaleRow[]): SalesTrendPoint[] {
  const days = new Map<string, { cents: number; units: number; count: number }>()
  for (const s of sales) {
    const e = days.get(s.date) ?? { cents: 0, units: 0, count: 0 }
    e.cents += s.quantity * toCents(s.sellingPrice)
    e.units += s.quantity
    e.count += 1
    days.set(s.date, e)
  }
  return [...days.entries()]
    .map(([date, e]) => ({ date, total: fromCents(e.cents), unitsSold: e.units, salesCount: e.count }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export type ActivityType = 'Sale' | 'Purchase' | 'Expense'

export interface ActivityItem {
  type: ActivityType
  id: string
  date: string
  description: string
  amount: number
  createdAt: Date
}

const TYPE_ORDER: Record<ActivityType, number> = { Sale: 0, Purchase: 1, Expense: 2 }

/** Newest first: by date, then creation time, then type and id so the order is fully deterministic. */
export function sortActivity(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.id.localeCompare(b.id),
  )
}

// ---------- Database-backed calculations ----------

async function quantitiesByProduct(db: Db, productId?: string) {
  const where = productId ? { productId } : {}
  const [purchases, sales] = await Promise.all([
    db.purchase.groupBy({ by: ['productId'], where, _sum: { quantity: true } }),
    db.sale.groupBy({ by: ['productId'], where, _sum: { quantity: true } }),
  ])
  return {
    purchased: new Map(purchases.map((r) => [r.productId, r._sum.quantity ?? 0])),
    sold: new Map(sales.map((r) => [r.productId, r._sum.quantity ?? 0])),
  }
}

function withStock(
  p: { id: string; name: string; category: string; unit: string; openingStock: number; minStockLevel: number },
  purchased: number,
  sold: number,
): ProductStock {
  const currentStock = p.openingStock + purchased - sold
  return {
    productId: p.id,
    name: p.name,
    category: p.category,
    unit: p.unit,
    openingStock: p.openingStock,
    purchased,
    sold,
    currentStock,
    minStockLevel: p.minStockLevel,
    stockStatus: stockStatusOf(currentStock, p.minStockLevel),
  }
}

/** Stock for one product, or null if it does not exist. */
export async function getProductStock(productId: string, db: Db = defaultPrisma): Promise<ProductStock | null> {
  const product = await db.product.findUnique({ where: { id: productId } })
  if (!product) return null
  const q = await quantitiesByProduct(db, productId)
  return withStock(product, q.purchased.get(productId) ?? 0, q.sold.get(productId) ?? 0)
}

/** Stock for every product, ordered by name. */
export async function getAllProductStock(db: Db = defaultPrisma): Promise<ProductStock[]> {
  const [products, q] = await Promise.all([db.product.findMany({ orderBy: { name: 'asc' } }), quantitiesByProduct(db)])
  return products.map((p) => withStock(p, q.purchased.get(p.id) ?? 0, q.sold.get(p.id) ?? 0))
}

/** Products at or below their minimum level (Low Stock and Out of Stock), most urgent first. */
export function lowStockFrom(all: ProductStock[]): ProductStock[] {
  return all
    .filter((p) => p.currentStock <= p.minStockLevel)
    .sort((a, b) => a.currentStock - b.currentStock || a.name.localeCompare(b.name))
}

export async function getLowStockProducts(db: Db = defaultPrisma): Promise<ProductStock[]> {
  return lowStockFrom(await getAllProductStock(db))
}

/**
 * Inventory Value = SUM(current stock x purchase price), i.e. what the stock on hand
 * cost to buy. Summed in integer cents. Negative stock counts as 0.
 */
export function calcInventoryValue(items: { currentStock: number; purchasePrice: number }[]): number {
  return fromCents(items.reduce((sum, i) => sum + Math.max(i.currentStock, 0) * toCents(i.purchasePrice), 0))
}

export async function getInventoryValue(db: Db = defaultPrisma): Promise<number> {
  const [products, stock] = await Promise.all([
    db.product.findMany({ select: { id: true, purchasePrice: true } }),
    getAllProductStock(db),
  ])
  const price = new Map(products.map((p) => [p.id, Number(p.purchasePrice)]))
  return calcInventoryValue(stock.map((s) => ({ currentStock: s.currentStock, purchasePrice: price.get(s.productId) ?? 0 })))
}

async function loadSales(db: Db): Promise<SaleRow[]> {
  const rows = await db.sale.findMany({ select: { productId: true, quantity: true, sellingPrice: true, date: true } })
  return rows.map((s) => ({
    productId: s.productId,
    quantity: s.quantity,
    sellingPrice: Number(s.sellingPrice),
    date: day(s.date),
  }))
}

export async function getRevenue(db: Db = defaultPrisma): Promise<number> {
  const sales = await loadSales(db)
  return fromCents(sales.reduce((sum, s) => sum + s.quantity * toCents(s.sellingPrice), 0))
}

export async function getExpensesTotal(db: Db = defaultPrisma): Promise<number> {
  const rows = await db.expense.findMany({ select: { amount: true } })
  return fromCents(rows.reduce((sum, e) => sum + toCents(e.amount), 0))
}

export async function getEstimatedProfit(db: Db = defaultPrisma): Promise<number> {
  const [revenue, expenses] = await Promise.all([getRevenue(db), getExpensesTotal(db)])
  return fromCents(toCents(revenue) - toCents(expenses))
}

export async function getTopSellingProducts(limit = 5, db: Db = defaultPrisma): Promise<TopSellingProduct[]> {
  const [products, sales] = await Promise.all([
    db.product.findMany({ select: { id: true, name: true, category: true } }),
    loadSales(db),
  ])
  return rankTopSelling(products, sales, limit)
}

export async function getSalesTrend(db: Db = defaultPrisma): Promise<SalesTrendPoint[]> {
  return groupSalesByDate(await loadSales(db))
}

/** Latest sales, purchases and expenses combined, newest first. */
export async function getRecentActivity(limit = 10, db: Db = defaultPrisma): Promise<ActivityItem[]> {
  const orderBy = [{ date: 'desc' as const }, { createdAt: 'desc' as const }]
  // Each source is capped at `limit`: the combined newest `limit` items cannot need more.
  const [sales, purchases, expenses] = await Promise.all([
    db.sale.findMany({ orderBy, take: limit, include: { product: { select: { name: true } } } }),
    db.purchase.findMany({ orderBy, take: limit, include: { product: { select: { name: true } } } }),
    db.expense.findMany({ orderBy, take: limit }),
  ])
  const items: ActivityItem[] = [
    ...sales.map((s) => ({
      type: 'Sale' as const,
      id: s.id,
      date: day(s.date),
      description: `Sold ${s.quantity} × ${s.product.name}`,
      amount: fromCents(s.quantity * toCents(s.sellingPrice)),
      createdAt: s.createdAt,
    })),
    ...purchases.map((p) => ({
      type: 'Purchase' as const,
      id: p.id,
      date: day(p.date),
      description: `Restocked ${p.quantity} × ${p.product.name}`,
      amount: fromCents(p.quantity * toCents(p.purchasePrice)),
      createdAt: p.createdAt,
    })),
    ...expenses.map((e) => ({
      type: 'Expense' as const,
      id: e.id,
      date: day(e.date),
      description: e.description,
      amount: fromCents(toCents(e.amount)),
      createdAt: e.createdAt,
    })),
  ]
  return sortActivity(items).slice(0, limit)
}

/** All core metrics in one read-only pass. */
export async function getAnalyticsSummary(db: Db = defaultPrisma) {
  const [stock, inventoryValue, totalRevenue, totalExpenses, topSellingProducts, salesTrend, recentActivity] = await Promise.all([
    getAllProductStock(db),
    getInventoryValue(db),
    getRevenue(db),
    getExpensesTotal(db),
    getTopSellingProducts(5, db),
    getSalesTrend(db),
    getRecentActivity(10, db),
  ])
  return {
    totalRevenue,
    totalExpenses,
    estimatedProfit: fromCents(toCents(totalRevenue) - toCents(totalExpenses)),
    inventoryValue,
    totalProducts: stock.length,
    lowStockProducts: lowStockFrom(stock),
    topSellingProducts,
    salesTrend,
    recentActivity: recentActivity.map(({ createdAt: _createdAt, ...item }) => item),
  }
}

import type { Expense, Product, Purchase, Sale, StockStatus } from '../types'

/**
 * Deterministic business calculations. No AI, no estimation heuristics —
 * every value here is derived directly from recorded data per SPEC.md section 8.
 */

export interface ProductWithStock extends Product {
  currentStock: number
  stockStatus: StockStatus
}

export function getCurrentStock(product: Product, purchases: Purchase[], sales: Sale[]): number {
  const purchasedQty = purchases
    .filter((p) => p.productId === product.id)
    .reduce((sum, p) => sum + p.quantity, 0)
  const soldQty = sales
    .filter((s) => s.productId === product.id)
    .reduce((sum, s) => sum + s.quantity, 0)
  return product.openingStock + purchasedQty - soldQty
}

export function getStockStatus(currentStock: number, minStockLevel: number): StockStatus {
  if (currentStock <= 0) return 'Out of Stock'
  if (currentStock <= minStockLevel) return 'Low Stock'
  return 'Healthy'
}

export function getProductsWithStock(
  products: Product[],
  purchases: Purchase[],
  sales: Sale[],
): ProductWithStock[] {
  return products.map((product) => {
    const currentStock = getCurrentStock(product, purchases, sales)
    return {
      ...product,
      currentStock,
      stockStatus: getStockStatus(currentStock, product.minStockLevel),
    }
  })
}

export function getLowStockProducts(productsWithStock: ProductWithStock[]): ProductWithStock[] {
  return productsWithStock.filter((p) => p.stockStatus !== 'Healthy')
}

export function getSaleTotal(sale: Sale): number {
  return sale.quantity * sale.sellingPrice
}

export function getTotalSales(sales: Sale[]): number {
  return sales.reduce((sum, s) => sum + getSaleTotal(s), 0)
}

export function getTodaysSales(sales: Sale[], today: string): number {
  return getTotalSales(sales.filter((s) => s.date === today))
}

export function getTotalExpenses(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + e.amount, 0)
}

export function getEstimatedProfit(revenue: number, totalExpenses: number): number {
  return revenue - totalExpenses
}

export interface TopSellingProduct {
  product: Product
  quantitySold: number
  revenue: number
}

export function getTopSellingProducts(
  products: Product[],
  sales: Sale[],
  limit = 5,
): TopSellingProduct[] {
  return products
    .map((product) => {
      const productSales = sales.filter((s) => s.productId === product.id)
      return {
        product,
        quantitySold: productSales.reduce((sum, s) => sum + s.quantity, 0),
        revenue: productSales.reduce((sum, s) => sum + getSaleTotal(s), 0),
      }
    })
    .filter((entry) => entry.quantitySold > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
}

export interface SalesTrendPoint {
  date: string
  total: number
}

export function getSalesTrend(sales: Sale[]): SalesTrendPoint[] {
  const totalsByDate = new Map<string, number>()
  for (const sale of sales) {
    totalsByDate.set(sale.date, (totalsByDate.get(sale.date) ?? 0) + getSaleTotal(sale))
  }
  return Array.from(totalsByDate.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export type ActivityType = 'Sale' | 'Purchase' | 'Expense'

export interface ActivityItem {
  type: ActivityType
  date: string
  description: string
  amount: number
}

export function getRecentActivity(
  products: Product[],
  sales: Sale[],
  purchases: Purchase[],
  expenses: Expense[],
  limit = 8,
): ActivityItem[] {
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown product'

  const saleItems: ActivityItem[] = sales.map((s) => ({
    type: 'Sale',
    date: s.date,
    description: `Sold ${s.quantity} × ${productName(s.productId)}`,
    amount: getSaleTotal(s),
  }))

  const purchaseItems: ActivityItem[] = purchases.map((p) => ({
    type: 'Purchase',
    date: p.date,
    description: `Restocked ${p.quantity} × ${productName(p.productId)}`,
    amount: p.quantity * p.purchasePrice,
  }))

  const expenseItems: ActivityItem[] = expenses.map((e) => ({
    type: 'Expense',
    date: e.date,
    description: e.description,
    amount: e.amount,
  }))

  return [...saleItems, ...purchaseItems, ...expenseItems]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

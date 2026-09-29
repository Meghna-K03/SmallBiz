export type Category = 'Groceries' | 'Dairy' | 'Bakery' | 'Staples' | 'Household'

export type Unit = 'packs' | 'liters' | 'bags' | 'bottles' | 'trays'

export type StockStatus = 'Healthy' | 'Low Stock' | 'Out of Stock'

export interface Product {
  id: string
  name: string
  category: Category
  unit: Unit
  /** Stock on hand before any recorded purchases/sales. */
  openingStock: number
  minStockLevel: number
  purchasePrice: number
  sellingPrice: number
}

export interface Sale {
  id: string
  productId: string
  quantity: number
  sellingPrice: number
  date: string
}

export interface Purchase {
  id: string
  productId: string
  quantity: number
  purchasePrice: number
  date: string
  supplier?: string
}

export type ExpenseCategory =
  | 'Rent'
  | 'Electricity'
  | 'Staff Wages'
  | 'Transport'
  | 'Packaging'
  | 'Maintenance'
  | 'Internet & Phone'
  | 'Miscellaneous'

export interface Expense {
  id: string
  category: ExpenseCategory
  amount: number
  date: string
  description: string
}

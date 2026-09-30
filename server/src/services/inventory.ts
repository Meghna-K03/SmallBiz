import type { Prisma } from '@prisma/client'
import { ApiError, badRequest, conflict } from '../lib/errors'
import { prisma } from '../lib/prisma'

/**
 * Inventory rules, enforced on the backend.
 *
 *   Current Stock = Opening Stock + total purchased quantity - total sold quantity
 *
 * Current stock is always calculated from the database; it is never stored.
 */

type Db = Prisma.TransactionClient

export interface StockBreakdown {
  openingStock: number
  purchased: number
  sold: number
  currentStock: number
}

/** Calculates current stock for one product, or null if the product does not exist. */
export async function getStockBreakdown(db: Db, productId: string): Promise<StockBreakdown | null> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { openingStock: true } })
  if (!product) return null

  const [purchases, sales] = await Promise.all([
    db.purchase.aggregate({ where: { productId }, _sum: { quantity: true } }),
    db.sale.aggregate({ where: { productId }, _sum: { quantity: true } }),
  ])
  const purchased = purchases._sum.quantity ?? 0
  const sold = sales._sum.quantity ?? 0

  return {
    openingStock: product.openingStock,
    purchased,
    sold,
    currentStock: product.openingStock + purchased - sold,
  }
}

/**
 * Locks the product row until the surrounding transaction ends, so two
 * requests for the same product cannot both pass the stock check and then
 * together oversell. Returns false if the product does not exist.
 */
async function lockProduct(db: Db, productId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`
  return rows.length > 0
}

export interface ProductInput {
  name: string
  category: string
  unit: string
  sellingPrice: number
  purchasePrice: number
  openingStock: number
  minStockLevel: number
}

const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`

export function insufficientStock(available: number): ApiError {
  const message =
    available <= 0
      ? 'This product is out of stock.'
      : `Only ${units(available)} ${available === 1 ? 'is' : 'are'} available for this product.`
  return new ApiError(400, 'INSUFFICIENT_STOCK', message)
}

/** Records a sale only if the product has enough stock; never lets stock go negative. */
export async function createSale(data: {
  productId: string
  quantity: number
  sellingPrice: number
  date: Date
}) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        if (!(await lockProduct(tx, data.productId))) {
          throw badRequest('productId does not match any existing product')
        }
        const stock = await getStockBreakdown(tx, data.productId)
        if (!stock || data.quantity > stock.currentStock) {
          throw insufficientStock(stock?.currentStock ?? 0)
        }
        return tx.sale.create({ data })
      },
      // Simultaneous sales of one product queue on the row lock above; the default 2 s / 5 s limits are too
      // short for that queue on a remote database, so a waiting sale expired (P2028) instead of being checked.
      { maxWait: 15_000, timeout: 20_000 },
    )
  } catch (err) {
    // Still expired or aborted by the database: nothing was recorded, so ask the client to retry (not a 500).
    const code = (err as { code?: string })?.code
    if (code === 'P2028' || code === 'P2034') throw conflict('Another sale for this product was being recorded at the same time. Please try again.')
    throw err
  }
}

/** Records a purchase (restock). Stock only goes up, so no stock check is needed. */
export async function createPurchase(data: {
  productId: string
  quantity: number
  purchasePrice: number
  date: Date
  supplier: string | null
}) {
  if (!(await prisma.product.findUnique({ where: { id: data.productId }, select: { id: true } }))) {
    throw badRequest('productId does not match any existing product')
  }
  return prisma.purchase.create({ data })
}

/**
 * Updates a product. Changing opening stock changes current stock, so the
 * edit is refused if it would leave already-recorded sales without stock.
 * Returns null if the product does not exist.
 */
export function updateProduct(id: string, data: ProductInput) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockProduct(tx, id))) return null
    const stock = await getStockBreakdown(tx, id)
    if (stock) {
      const newCurrentStock = data.openingStock + stock.purchased - stock.sold
      if (newCurrentStock < 0) {
        throw new ApiError(
          400,
          'INSUFFICIENT_STOCK',
          `Opening stock cannot be ${data.openingStock}: ${units(stock.sold)} sold and ${units(stock.purchased)} purchased ` +
            `are already recorded, which would make current stock negative. It must be at least ${stock.sold - stock.purchased}.`,
        )
      }
    }
    return tx.product.update({ where: { id }, data })
  })
}

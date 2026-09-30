import { Router } from 'express'
import { conflict, notFound } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { productDto } from '../lib/serialize'
import { parseId, Validator } from '../lib/validate'
import { updateProduct } from '../services/inventory'

const router = Router()

function parseProduct(body: unknown) {
  const v = new Validator(body)
  const data = {
    name: v.string('name'),
    category: v.string('category', { max: 100 }),
    unit: v.string('unit', { max: 50 }),
    sellingPrice: v.money('sellingPrice'),
    purchasePrice: v.money('purchasePrice'),
    openingStock: v.integer('openingStock'),
    minStockLevel: v.integer('minStockLevel'),
  }
  v.done()
  return data
}

/** Comparison key for duplicate checks only (stored values are not changed): case, edge and repeated spaces ignored. */
const identity = (name: string, unit: string) => `${name.trim().replace(/\s+/g, ' ').toLowerCase()}|${unit.trim().toLowerCase()}`

/** Two products are the same when name and unit match; "Tata Tea 250g" and "Tata Tea 500g" differ by name, "Oil" in L vs ml by unit. */
async function assertNotDuplicate(data: { name: string; unit: string }, exceptId?: string) {
  const key = identity(data.name, data.unit)
  const same = (await prisma.product.findMany({ select: { id: true, name: true, unit: true } })).find(
    (p) => p.id !== exceptId && identity(p.name, p.unit) === key,
  )
  if (same) throw conflict(`${same.name} (${same.unit}) is already in your inventory.`)
}

router.get('/', async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: { name: 'asc' } })
  res.json(products.map(productDto))
})

router.get('/:id', async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: parseId(req.params.id) } })
  if (!product) throw notFound('Product')
  res.json(productDto(product))
})

router.post('/', async (req, res) => {
  const data = parseProduct(req.body)
  await assertNotDuplicate(data)
  const product = await prisma.product.create({ data })
  res.status(201).json(productDto(product))
})

// PUT replaces all editable fields, so the full product must be sent.
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const data = parseProduct(req.body)
  // Only checked when the name or unit actually changes, so products that are already duplicates stay editable.
  const current = await prisma.product.findUnique({ where: { id }, select: { name: true, unit: true } })
  if (current && identity(current.name, current.unit) !== identity(data.name, data.unit)) await assertNotDuplicate(data, id)
  // The service refuses edits that would leave current stock negative.
  const product = await updateProduct(id, data)
  if (!product) throw notFound('Product')
  res.json(productDto(product))
})

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (!(await prisma.product.findUnique({ where: { id }, select: { id: true } }))) {
    throw notFound('Product')
  }

  // Sales and purchases reference products (onDelete: Restrict), so a product
  // with history cannot be deleted. Report that clearly instead of a DB error.
  const [sales, purchases] = await Promise.all([
    prisma.sale.count({ where: { productId: id } }),
    prisma.purchase.count({ where: { productId: id } }),
  ])
  if (sales > 0 || purchases > 0) {
    throw conflict(
      `Product cannot be deleted because it has ${sales} sale(s) and ${purchases} purchase(s) recorded`,
    )
  }

  await prisma.product.delete({ where: { id } })
  res.status(204).end()
})

export default router

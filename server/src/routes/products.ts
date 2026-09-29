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
  const product = await prisma.product.create({ data: parseProduct(req.body) })
  res.status(201).json(productDto(product))
})

// PUT replaces all editable fields, so the full product must be sent.
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const data = parseProduct(req.body)
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

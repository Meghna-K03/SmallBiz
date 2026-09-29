import { Router } from 'express'
import { notFound } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { saleDto } from '../lib/serialize'
import { parseId, Validator } from '../lib/validate'
import { createSale } from '../services/inventory'

const router = Router()

router.get('/', async (_req, res) => {
  const sales = await prisma.sale.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] })
  res.json(sales.map(saleDto))
})

router.get('/:id', async (req, res) => {
  const sale = await prisma.sale.findUnique({ where: { id: parseId(req.params.id) } })
  if (!sale) throw notFound('Sale')
  res.json(saleDto(sale))
})

// Stock is never stored: the service calculates it (opening stock + purchases
// - sales) and rejects the sale if the quantity exceeds what is available.
router.post('/', async (req, res) => {
  const v = new Validator(req.body)
  const data = {
    productId: v.id('productId'),
    quantity: v.integer('quantity', { positive: true }),
    sellingPrice: v.money('sellingPrice'),
    date: v.date('date'),
  }
  v.done()

  const sale = await createSale(data)
  res.status(201).json(saleDto(sale))
})

export default router

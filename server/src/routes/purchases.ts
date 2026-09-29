import { Router } from 'express'
import { notFound } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { purchaseDto } from '../lib/serialize'
import { parseId, Validator } from '../lib/validate'
import { createPurchase } from '../services/inventory'

const router = Router()

router.get('/', async (_req, res) => {
  const purchases = await prisma.purchase.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] })
  res.json(purchases.map(purchaseDto))
})

router.get('/:id', async (req, res) => {
  const purchase = await prisma.purchase.findUnique({ where: { id: parseId(req.params.id) } })
  if (!purchase) throw notFound('Purchase')
  res.json(purchaseDto(purchase))
})

router.post('/', async (req, res) => {
  const v = new Validator(req.body)
  const data = {
    productId: v.id('productId'),
    quantity: v.integer('quantity', { positive: true }),
    purchasePrice: v.money('purchasePrice'),
    date: v.date('date'),
    supplier: v.string('supplier', { optional: true }) || null,
  }
  v.done()

  const purchase = await createPurchase(data)
  res.status(201).json(purchaseDto(purchase))
})

export default router

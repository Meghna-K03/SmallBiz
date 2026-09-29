import { Router } from 'express'
import { notFound } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { expenseDto } from '../lib/serialize'
import { parseId, Validator } from '../lib/validate'

const router = Router()

router.get('/', async (_req, res) => {
  const expenses = await prisma.expense.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] })
  res.json(expenses.map(expenseDto))
})

router.get('/:id', async (req, res) => {
  const expense = await prisma.expense.findUnique({ where: { id: parseId(req.params.id) } })
  if (!expense) throw notFound('Expense')
  res.json(expenseDto(expense))
})

router.post('/', async (req, res) => {
  const v = new Validator(req.body)
  const data = {
    category: v.string('category', { max: 100 }),
    amount: v.money('amount', { positive: true }),
    date: v.date('date'),
    // Optional in the API; the column is required, so store an empty string.
    description: v.string('description', { optional: true, max: 500 }),
  }
  v.done()

  const expense = await prisma.expense.create({ data })
  res.status(201).json(expenseDto(expense))
})

export default router

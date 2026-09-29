import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { FormField, inputClasses } from '../ui/FormField'
import { FormError } from '../ui/FormError'
import type { Expense, ExpenseCategory } from '../../types'

const categories: ExpenseCategory[] = [
  'Rent',
  'Electricity',
  'Staff Wages',
  'Transport',
  'Packaging',
  'Maintenance',
  'Internet & Phone',
  'Miscellaneous',
]

interface ExpenseFormProps {
  onSubmit: (expense: Omit<Expense, 'id'>) => Promise<void>
}

export function ExpenseForm({ onSubmit }: ExpenseFormProps) {
  const [category, setCategory] = useState<ExpenseCategory>(categories[0])
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!date) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        category,
        amount: Number(amount),
        date,
        description: description.trim(),
      })
      setAmount('')
      setDate('')
      setDescription('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the expense.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
      <FormField label="Category" htmlFor="expense-category" required>
        <select
          id="expense-category"
          className={inputClasses}
          value={category}
          onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Amount" htmlFor="expense-amount" required>
        <input
          id="expense-amount"
          type="number"
          min={0}
          step="0.01"
          className={inputClasses}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </FormField>

      <FormField label="Date" htmlFor="expense-date" required>
        <input
          id="expense-date"
          type="date"
          className={inputClasses}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </FormField>

      <FormField label="Description" htmlFor="expense-description" required>
        <input
          id="expense-description"
          className={inputClasses}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </FormField>

      <div className="space-y-3 sm:col-span-2 lg:col-span-4">
        <FormError message={error} />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Record Expense'}
        </Button>
      </div>
    </form>
  )
}

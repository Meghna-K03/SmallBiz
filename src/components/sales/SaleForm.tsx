import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { FormField, inputClasses } from '../ui/FormField'
import { FormError } from '../ui/FormError'
import type { Product, Sale } from '../../types'

interface SaleFormProps {
  products: Product[]
  onSubmit: (sale: Omit<Sale, 'id'>) => Promise<void>
}

export function SaleForm({ products, onSubmit }: SaleFormProps) {
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [sellingPrice, setSellingPrice] = useState(String(products[0]?.sellingPrice ?? ''))
  const [date, setDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleProductChange(id: string) {
    setProductId(id)
    const product = products.find((p) => p.id === id)
    if (product) setSellingPrice(String(product.sellingPrice))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!productId || !date) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        productId,
        quantity: Number(quantity),
        sellingPrice: Number(sellingPrice),
        date,
      })
      setQuantity('')
      setDate('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the sale.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
      <FormField label="Product" htmlFor="sale-product" required>
        <select
          id="sale-product"
          className={inputClasses}
          value={productId}
          onChange={(e) => handleProductChange(e.target.value)}
          required
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Quantity" htmlFor="sale-quantity" required>
        <input
          id="sale-quantity"
          type="number"
          min={1}
          className={inputClasses}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
      </FormField>

      <FormField label="Selling Price" htmlFor="sale-price" required>
        <input
          id="sale-price"
          type="number"
          min={0}
          step="0.01"
          className={inputClasses}
          value={sellingPrice}
          onChange={(e) => setSellingPrice(e.target.value)}
          required
        />
      </FormField>

      <FormField label="Date" htmlFor="sale-date" required>
        <input
          id="sale-date"
          type="date"
          className={inputClasses}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </FormField>

      <div className="space-y-3 sm:col-span-2 lg:col-span-4">
        <FormError message={error} />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Record Sale'}
        </Button>
      </div>
    </form>
  )
}

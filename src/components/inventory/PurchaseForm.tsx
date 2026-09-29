import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { FormField, inputClasses } from '../ui/FormField'
import { FormError } from '../ui/FormError'
import type { Product, Purchase } from '../../types'

interface PurchaseFormProps {
  products: Product[]
  onSubmit: (purchase: Omit<Purchase, 'id'>) => Promise<void>
}

export function PurchaseForm({ products, onSubmit }: PurchaseFormProps) {
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [date, setDate] = useState('')
  const [supplier, setSupplier] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!productId || !date) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        productId,
        quantity: Number(quantity),
        purchasePrice: Number(purchasePrice),
        date,
        supplier: supplier.trim() || undefined,
      })
      setQuantity('')
      setPurchasePrice('')
      setDate('')
      setSupplier('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the purchase.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <FormField label="Product" htmlFor="purchase-product" required>
        <select
          id="purchase-product"
          className={inputClasses}
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          required
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Quantity" htmlFor="purchase-quantity" required>
        <input
          id="purchase-quantity"
          type="number"
          min={1}
          className={inputClasses}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
      </FormField>

      <FormField label="Purchase Price" htmlFor="purchase-price" required>
        <input
          id="purchase-price"
          type="number"
          min={0}
          step="0.01"
          className={inputClasses}
          value={purchasePrice}
          onChange={(e) => setPurchasePrice(e.target.value)}
          required
        />
      </FormField>

      <FormField label="Date" htmlFor="purchase-date" required>
        <input
          id="purchase-date"
          type="date"
          className={inputClasses}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </FormField>

      <FormField label="Supplier (optional)" htmlFor="purchase-supplier">
        <input
          id="purchase-supplier"
          className={inputClasses}
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
      </FormField>

      <div className="space-y-3 sm:col-span-2 lg:col-span-5">
        <FormError message={error} />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Record Purchase'}
        </Button>
      </div>
    </form>
  )
}

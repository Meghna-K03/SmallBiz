import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { FormField, inputClasses } from '../ui/FormField'
import { FormError } from '../ui/FormError'
import type { Category, Product, Unit } from '../../types'

const categories: Category[] = ['Groceries', 'Dairy', 'Bakery', 'Staples', 'Household']
const units: Unit[] = ['packs', 'liters', 'bags', 'bottles', 'trays']

interface ProductFormProps {
  initialValue?: Product
  onSubmit: (product: Omit<Product, 'id'>) => Promise<void>
  onCancel: () => void
}

export function ProductForm({ initialValue, onSubmit, onCancel }: ProductFormProps) {
  const [name, setName] = useState(initialValue?.name ?? '')
  const [category, setCategory] = useState<Category>(initialValue?.category ?? categories[0])
  const [unit, setUnit] = useState<Unit>(initialValue?.unit ?? units[0])
  const [openingStock, setOpeningStock] = useState(String(initialValue?.openingStock ?? ''))
  const [minStockLevel, setMinStockLevel] = useState(String(initialValue?.minStockLevel ?? ''))
  const [purchasePrice, setPurchasePrice] = useState(String(initialValue?.purchasePrice ?? ''))
  const [sellingPrice, setSellingPrice] = useState(String(initialValue?.sellingPrice ?? ''))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        category,
        unit,
        openingStock: Number(openingStock),
        minStockLevel: Number(minStockLevel),
        purchasePrice: Number(purchasePrice),
        sellingPrice: Number(sellingPrice),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the product.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormField label="Product Name" htmlFor="product-name" required>
        <input
          id="product-name"
          className={inputClasses}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Category" htmlFor="product-category" required>
          <select
            id="product-category"
            className={inputClasses}
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Unit" htmlFor="product-unit" required>
          <select
            id="product-unit"
            className={inputClasses}
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Opening Stock" htmlFor="product-opening-stock" required>
          <input
            id="product-opening-stock"
            type="number"
            min={0}
            className={inputClasses}
            value={openingStock}
            onChange={(e) => setOpeningStock(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Minimum Stock Level" htmlFor="product-min-stock" required>
          <input
            id="product-min-stock"
            type="number"
            min={0}
            className={inputClasses}
            value={minStockLevel}
            onChange={(e) => setMinStockLevel(e.target.value)}
            required
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Purchase Price" htmlFor="product-purchase-price" required>
          <input
            id="product-purchase-price"
            type="number"
            min={0}
            step="0.01"
            className={inputClasses}
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Selling Price" htmlFor="product-selling-price" required>
          <input
            id="product-selling-price"
            type="number"
            min={0}
            step="0.01"
            className={inputClasses}
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            required
          />
        </FormField>
      </div>

      <div className="mb-3">
        <FormError message={error} />
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : initialValue ? 'Save Changes' : 'Add Product'}
        </Button>
      </div>
    </form>
  )
}

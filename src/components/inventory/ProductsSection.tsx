import { useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { StatusBadge } from '../ui/StatusBadge'
import { EmptyState } from '../ui/EmptyState'
import { FormError } from '../ui/FormError'
import { ProductForm } from './ProductForm'
import { useData } from '../../context/DataContext'
import { useAnalytics } from '../../hooks/useAnalytics'
import { MovementBadge } from '../insights/InsightBits'
import { ProductInsightModal } from '../insights/ProductInsightModal'
import type { HorizonDays } from '../../types/analytics'
import { getProductsWithStock } from '../../lib/calculations'
import { formatCurrency } from '../../lib/format'
import type { Product } from '../../types'

export function ProductsSection() {
  const { products, purchases, sales, addProduct, updateProduct, deleteProduct } = useData()
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Product | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [insightProductId, setInsightProductId] = useState<string | null>(null)
  const [days, setDays] = useState<HorizonDays>(7)
  // Backend-calculated insights; the table still works if they fail to load.
  const { insights, forecast, restocking } = useAnalytics(days)
  const insightById = new Map((insights.data?.products ?? []).map((i) => [i.productId, i]))

  const productsWithStock = getProductsWithStock(products, purchases, sales)

  function openAdd() {
    setEditingProduct(null)
    setModalMode('add')
  }

  function openEdit(product: Product) {
    setEditingProduct(product)
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode(null)
    setEditingProduct(null)
  }

  function closeDelete() {
    setDeleteCandidate(null)
    setDeleteError(null)
  }

  // The backend refuses to delete a product that has sales or purchases;
  // its message is shown here and the product stays in the list.
  async function confirmDelete() {
    if (!deleteCandidate) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProduct(deleteCandidate.id)
      closeDelete()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the product.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card
      title="Products"
      action={<Button onClick={openAdd}>Add Product</Button>}
    >
      {productsWithStock.length === 0 ? (
        <EmptyState message="No products yet. Add your first product to get started." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Current Stock</th>
                <th className="py-2 pr-4">Selling Price</th>
                <th className="py-2 pr-4">Purchase Price</th>
                <th className="py-2 pr-4">Min Stock</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Velocity</th>
                <th className="py-2 pr-4">Coverage</th>
                <th className="py-2 pr-4">Movement</th>
                <th className="py-2 pr-0 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productsWithStock.map((product) => (
                <tr key={product.id}>
                  <td className="py-3 pr-4 font-medium text-slate-800">{product.name}</td>
                  <td className="py-3 pr-4 text-slate-600">{product.category}</td>
                  <td className="py-3 pr-4 text-slate-600">
                    {product.currentStock} {product.unit}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{formatCurrency(product.sellingPrice)}</td>
                  <td className="py-3 pr-4 text-slate-600">{formatCurrency(product.purchasePrice)}</td>
                  <td className="py-3 pr-4 text-slate-600">{product.minStockLevel}</td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={product.stockStatus} />
                  </td>
                  {(() => {
                    const insight = insightById.get(product.id)
                    if (!insight) {
                      return (
                        <td colSpan={3} className="py-3 pr-4 text-xs text-slate-400">
                          {insights.status === 'error' ? 'Insights unavailable' : 'Loading insights…'}
                        </td>
                      )
                    }
                    return (
                      <>
                        <td className="py-3 pr-4 text-slate-600">
                          {insight.salesVelocity === null ? '—' : `${insight.salesVelocity}/day`}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {insight.stockCoverageDays === null ? '—' : `${insight.stockCoverageDays} days`}
                        </td>
                        <td className="py-3 pr-4">
                          <MovementBadge movement={insight.movement} />
                        </td>
                      </>
                    )
                  })()}
                  <td className="py-3 pr-0 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => setInsightProductId(product.id)}>
                        Insight
                      </Button>
                      <Button variant="secondary" onClick={() => openEdit(product)}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => setDeleteCandidate(product)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProductInsightModal
        productId={insightProductId}
        onClose={() => setInsightProductId(null)}
        days={days}
        onDaysChange={setDays}
        insights={insights.data}
        forecast={forecast.data}
        restocking={restocking.data}
      />

      <Modal
        title={modalMode === 'edit' ? 'Edit Product' : 'Add Product'}
        isOpen={modalMode !== null}
        onClose={closeModal}
      >
        <ProductForm
          initialValue={editingProduct ?? undefined}
          onCancel={closeModal}
          onSubmit={async (product) => {
            if (modalMode === 'edit' && editingProduct) {
              await updateProduct(editingProduct.id, product)
            } else {
              await addProduct(product)
            }
            closeModal()
          }}
        />
      </Modal>

      <Modal
        title="Delete Product"
        isOpen={deleteCandidate !== null}
        onClose={closeDelete}
      >
        <p className="text-sm text-slate-600">
          Are you sure you want to delete <span className="font-medium">{deleteCandidate?.name}</span>?
          This cannot be undone.
        </p>
        <div className="mt-4">
          <FormError message={deleteError} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={closeDelete} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </Card>
  )
}

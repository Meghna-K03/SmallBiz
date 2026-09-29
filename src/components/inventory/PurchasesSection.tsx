import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { PurchaseForm } from './PurchaseForm'
import { useData } from '../../context/DataContext'
import { formatCurrency, formatDate } from '../../lib/format'

export function PurchasesSection() {
  const { products, purchases, addPurchase } = useData()
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown product'
  const sortedPurchases = [...purchases].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="space-y-6">
      <Card title="Record Purchase / Restock">
        <PurchaseForm products={products} onSubmit={addPurchase} />
      </Card>

      <Card title="Purchase History">
        {sortedPurchases.length === 0 ? (
          <EmptyState message="No purchases recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">Quantity</th>
                  <th className="py-2 pr-4">Purchase Price</th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-0">Supplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedPurchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="py-3 pr-4 font-medium text-slate-800">
                      {productName(purchase.productId)}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{purchase.quantity}</td>
                    <td className="py-3 pr-4 text-slate-600">
                      {formatCurrency(purchase.purchasePrice)}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{formatDate(purchase.date)}</td>
                    <td className="py-3 pr-0 text-slate-600">{purchase.supplier ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

import { Header } from '../components/layout/Header'
import { DataGate } from '../components/ui/DataGate'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SaleForm } from '../components/sales/SaleForm'
import { useData } from '../context/DataContext'
import { getSaleTotal } from '../lib/calculations'
import { formatCurrency, formatDate } from '../lib/format'

export function Sales() {
  const { products, sales, addSale } = useData()
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown product'
  const sortedSales = [...sales].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <Header title="Sales" />
      <main className="flex-1 space-y-6 p-5">
        <DataGate>
        <Card title="Record Sale">
          <SaleForm products={products} onSubmit={addSale} />
        </Card>

        <Card title="Sales History">
          {sortedSales.length === 0 ? (
            <EmptyState message="No sales recorded yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4">Product</th>
                    <th className="py-2 pr-4">Quantity</th>
                    <th className="py-2 pr-4">Total Amount</th>
                    <th className="py-2 pr-0">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedSales.map((sale) => (
                    <tr key={sale.id}>
                      <td className="py-3 pr-4 font-medium text-slate-800">
                        {productName(sale.productId)}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{sale.quantity}</td>
                      <td className="py-3 pr-4 text-slate-600">{formatCurrency(getSaleTotal(sale))}</td>
                      <td className="py-3 pr-0 text-slate-600">{formatDate(sale.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </DataGate>
      </main>
    </>
  )
}

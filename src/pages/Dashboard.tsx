import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { DataGate } from '../components/ui/DataGate'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { EmptyState } from '../components/ui/EmptyState'
import { DashboardInsights } from '../components/insights/DashboardInsights'
import { SalesTrendChart } from '../components/charts/SalesTrendChart'
import { api } from '../lib/api'
import { useData } from '../context/DataContext'
import { formatCurrency, formatDate, getTodayISO } from '../lib/format'
import {
  getEstimatedProfit,
  getRecentActivity,
  getSalesTrend,
  getTodaysSales,
  getTopSellingProducts,
  getTotalExpenses,
  getTotalSales,
} from '../lib/calculations'

/** Overview = business health. Business health only. */
export function Dashboard() {
  const { products, sales, purchases, expenses } = useData()
  const [inventoryValue, setInventoryValue] = useState<number | null>(null)

  // The backend owns this figure (stock on hand x purchase price); it is only displayed here.
  useEffect(() => {
    let cancelled = false
    api
      .getAnalyticsSummary()
      .then((s) => !cancelled && setInventoryValue(s.inventoryValue))
      .catch(() => !cancelled && setInventoryValue(null))
    return () => {
      cancelled = true
    }
  }, [products, sales, purchases])

  const totalSales = getTotalSales(sales)
  const todaysSales = getTodaysSales(sales, getTodayISO())
  const totalExpenses = getTotalExpenses(expenses)
  const estimatedProfit = getEstimatedProfit(totalSales, totalExpenses)
  const trend = getSalesTrend(sales)
  const topSelling = getTopSellingProducts(products, sales).slice(0, 4)
  const recentActivity = getRecentActivity(products, sales, purchases, expenses).slice(0, 5)

  return (
    <>
      <Header title="Overview" subtitle="How your shop is doing, and what to look at next." />
      <main className="flex-1 space-y-6 px-5 pb-10 pt-5 sm:px-8">
        <DataGate>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Sales" value={formatCurrency(totalSales)} hint={`Today: ${formatCurrency(todaysSales)}`} />
            <StatCard label="Expenses" value={formatCurrency(totalExpenses)} />
            <StatCard label="Estimated profit" value={formatCurrency(estimatedProfit)} hint="Sales minus expenses" tone={estimatedProfit >= 0 ? 'positive' : 'warning'} />
            <StatCard label="Inventory value" value={inventoryValue === null ? '—' : formatCurrency(inventoryValue)} hint="Stock on hand, at cost" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card title="Sales, last 14 days" className="lg:col-span-2">
              <SalesTrendChart data={trend} />
            </Card>

            <Card title="Best sellers">
              {topSelling.length === 0 ? (
                <EmptyState message="No sales recorded yet." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {topSelling.map(({ product, quantitySold, revenue }) => (
                    <li key={product.id} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{product.name}</p>
                        <p className="text-xs text-slate-500">
                          {quantitySold} {product.unit} sold
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold text-slate-800">{formatCurrency(revenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <DashboardInsights />

          <Card title="Recent activity" action={<Link to="/sales" className="text-xs font-medium text-accent hover:text-accent-dark">View sales</Link>}>
            {recentActivity.length === 0 ? (
              <EmptyState message="No recent activity." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentActivity.map((activity, index) => (
                  <li key={index} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{activity.description}</p>
                      <p className="text-xs text-slate-500">
                        {activity.type} · {formatDate(activity.date)}
                      </p>
                    </div>
                    <span className={`shrink-0 font-semibold ${activity.type === 'Expense' ? 'text-red-600' : 'text-slate-800'}`}>
                      {activity.type === 'Expense' ? '−' : '+'}
                      {formatCurrency(activity.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </DataGate>
      </main>
    </>
  )
}

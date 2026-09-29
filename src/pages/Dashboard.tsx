import { Header } from '../components/layout/Header'
import { DataGate } from '../components/ui/DataGate'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { StatusBadge } from '../components/ui/StatusBadge'
import { EmptyState } from '../components/ui/EmptyState'
import { SalesTrendChart } from '../components/charts/SalesTrendChart'
import { useData } from '../context/DataContext'
import { formatCurrency, formatDate, getTodayISO } from '../lib/format'
import {
  getEstimatedProfit,
  getLowStockProducts,
  getProductsWithStock,
  getRecentActivity,
  getSalesTrend,
  getTodaysSales,
  getTopSellingProducts,
  getTotalExpenses,
  getTotalSales,
} from '../lib/calculations'

export function Dashboard() {
  const { products, sales, purchases, expenses } = useData()

  const productsWithStock = getProductsWithStock(products, purchases, sales)
  const lowStockProducts = getLowStockProducts(productsWithStock)
  const totalSales = getTotalSales(sales)
  const todaysSales = getTodaysSales(sales, getTodayISO())
  const totalExpenses = getTotalExpenses(expenses)
  const estimatedProfit = getEstimatedProfit(totalSales, totalExpenses)
  const trend = getSalesTrend(sales)
  const topSelling = getTopSellingProducts(products, sales)
  const recentActivity = getRecentActivity(products, sales, purchases, expenses)

  return (
    <>
      <Header title="Dashboard" />
      <main className="flex-1 space-y-6 p-5">
        <DataGate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Today's Sales" value={formatCurrency(todaysSales)} />
          <StatCard label="Total Sales" value={formatCurrency(totalSales)} />
          <StatCard label="Total Expenses" value={formatCurrency(totalExpenses)} />
          <StatCard
            label="Estimated Profit"
            value={formatCurrency(estimatedProfit)}
            hint="Revenue − Expenses"
            tone="positive"
          />
          <StatCard label="Total Products" value={String(products.length)} />
          <StatCard
            label="Low-Stock Products"
            value={String(lowStockProducts.length)}
            tone={lowStockProducts.length > 0 ? 'warning' : 'default'}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title="Sales Trend (last 14 days)" className="lg:col-span-2">
            <SalesTrendChart data={trend} />
          </Card>

          <Card title="Top-Selling Products">
            {topSelling.length === 0 ? (
              <EmptyState message="No sales recorded yet." />
            ) : (
              <ul className="space-y-3">
                {topSelling.map(({ product, quantitySold, revenue }) => (
                  <li key={product.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{product.name}</p>
                      <p className="text-xs text-slate-400">
                        {quantitySold} {product.unit} sold
                      </p>
                    </div>
                    <span className="font-semibold text-slate-700">{formatCurrency(revenue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title="Low-Stock Summary" className="lg:col-span-1">
            {lowStockProducts.length === 0 ? (
              <EmptyState message="All products are healthily stocked." />
            ) : (
              <ul className="space-y-3">
                {lowStockProducts.map((product) => (
                  <li key={product.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{product.name}</p>
                      <p className="text-xs text-slate-400">
                        {product.currentStock} {product.unit} left
                      </p>
                    </div>
                    <StatusBadge status={product.stockStatus} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent Activity" className="lg:col-span-2">
            {recentActivity.length === 0 ? (
              <EmptyState message="No recent activity." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentActivity.map((activity, index) => (
                  <li key={index} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{activity.description}</p>
                      <p className="text-xs text-slate-400">
                        {activity.type} · {formatDate(activity.date)}
                      </p>
                    </div>
                    <span
                      className={`font-semibold ${
                        activity.type === 'Expense' ? 'text-red-600' : 'text-slate-700'
                      }`}
                    >
                      {activity.type === 'Expense' ? '−' : '+'}
                      {formatCurrency(activity.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        </DataGate>
      </main>
    </>
  )
}

import { useState } from 'react'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { formatDate } from '../../lib/format'
import { useAnalytics } from '../../hooks/useAnalytics'
import type { HorizonDays } from '../../types/analytics'
import { formatNumber, historyNote, HorizonSelector, SectionState } from './InsightBits'

const TOP_N = 5

/**
 * Dashboard section: fast movers, demand forecast and restocking suggestions.
 * Every figure comes from the backend analytics endpoints; nothing is calculated here.
 */
export function DashboardInsights() {
  const [days, setDays] = useState<HorizonDays>(7)
  const { insights, forecast, restocking } = useAnalytics(days)

  const period = insights.data?.analysisPeriod
  const forecastRows = [...(forecast.data?.products ?? [])]
    .filter((p) => p.forecastedDemand > 0)
    .sort((a, b) => b.forecastedDemand - a.forecastedDemand)
    .slice(0, TOP_N)

  return (
    <section className="space-y-4" aria-labelledby="inventory-insights-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="inventory-insights-heading" className="text-base font-semibold text-slate-900">
            Inventory Insights
          </h2>
          {period?.startDate && period.endDate && (
            <p className="text-xs text-slate-400">
              Based on sales from {formatDate(period.startDate)} to {formatDate(period.endDate)}
            </p>
          )}
        </div>
        <HorizonSelector value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Fast-Moving Products">
          <SectionState {...insights} onRetry={insights.reload} hasData={insights.data !== null}>
            {insights.data && insights.data.fastMovingProducts.length === 0 ? (
              <EmptyState message="No fast-moving products yet." />
            ) : (
              <ul className="space-y-3">
                {insights.data?.fastMovingProducts.slice(0, TOP_N).map((p) => (
                  <li key={p.productId} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{p.productName}</p>
                      <p className="text-xs text-slate-400">
                        {formatNumber(p.salesVelocity)} sold per day · stock lasts {formatNumber(p.stockCoverageDays)} days
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">{p.totalUnitsSold} sold</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionState>
        </Card>

        <Card title={`Demand Forecast · next ${days} days`}>
          <SectionState {...forecast} onRetry={forecast.reload} hasData={forecast.data !== null}>
            {forecastRows.length === 0 ? (
              <EmptyState message="No demand estimate available yet." />
            ) : (
              <ul className="space-y-3">
                {forecastRows.map((p) => (
                  <li key={p.productId} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{p.productName}</p>
                      <p className="text-xs text-slate-400">
                        {p.averageDailyDemand} per day{historyNote(p.dataStatus) ? ` · ${historyNote(p.dataStatus)}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold text-slate-700">≈ {p.forecastedDemand}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-slate-400">Estimate based on past sales, not a guarantee.</p>
          </SectionState>
        </Card>

        <Card title={`Restocking · next ${days} days`}>
          <SectionState {...restocking} onRetry={restocking.reload} hasData={restocking.data !== null}>
            {restocking.data && (
              <>
                <p className="mb-3 text-sm text-slate-600">
                  <span className="font-semibold text-slate-900">{restocking.data.summary.needsRestocking}</span> of{' '}
                  {restocking.data.summary.totalProducts} products need restocking
                  {restocking.data.summary.insufficientHistory > 0 &&
                    ` · ${restocking.data.summary.insufficientHistory} have too little sales history to judge`}
                </p>
                {restocking.data.needsRestocking.length === 0 ? (
                  <EmptyState message="No products need restocking." />
                ) : (
                  <ul className="space-y-3">
                    {restocking.data.needsRestocking.slice(0, TOP_N).map((p) => (
                      <li key={p.productId} className="flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{p.productName}</p>
                          <p className="text-xs text-slate-400">
                            In stock {p.currentStock} · target {p.targetStock}
                          </p>
                        </div>
                        <span className="shrink-0 font-semibold text-amber-700">
                          Restock {p.recommendedQuantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </SectionState>
        </Card>
      </div>
    </section>
  )
}

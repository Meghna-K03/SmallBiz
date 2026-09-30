import { useState } from 'react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { formatDate, formatDays } from '../../lib/format'
import { useAnalytics } from '../../hooks/useAnalytics'
import type { HorizonDays, ProductIntelligence } from '../../types/analytics'
import { formatPercent, HorizonSelector, PriorityBadge, SectionState } from './InsightBits'
import { ProductInsightModal } from './ProductInsightModal'

const TOP_N = 5

/** Plain-language line for one product that needs attention. */
function attentionLine(p: ProductIntelligence): string {
  const stock = `${p.currentStock} ${p.unit} in stock`
  return p.stockCoverageDays === null ? stock : `${stock} · may last ${formatDays(p.stockCoverageDays)}`
}

/**
 * Overview intelligence: what needs attention, and what is likely to sell next.
 * Every figure comes from the backend analytics endpoints; nothing is calculated here.
 * Forecast accuracy detail is kept, but behind "View forecast details".
 */
export function DashboardInsights() {
  const [days, setDays] = useState<HorizonDays>(7)
  const [openProduct, setOpenProduct] = useState<string | null>(null)
  const { insights, forecast, restocking, intelligence } = useAnalytics(days)

  const intel = intelligence.data
  const attention = (intel?.products ?? []).filter((p) => p.priority !== 'Low').slice(0, 6)
  const attentionIds = new Set(attention.map((p) => p.productId))
  const selling = (insights.data?.fastMovingProducts ?? []).filter((p) => !attentionIds.has(p.productId)).slice(0, 2)
  const nextUp = [...(intel?.products ?? [])].filter((p) => p.predictedDemand > 0).sort((a, b) => b.predictedDemand - a.predictedDemand).slice(0, TOP_N)
  const accuracy = intel?.forecast.accuracy ?? null

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Needs attention">
          <SectionState {...intelligence} onRetry={intelligence.reload} hasData={intel !== null}>
            {attention.length === 0 && selling.length === 0 ? (
              <EmptyState message="Nothing needs your attention right now." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {attention.map((p) => (
                  <li key={p.productId} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{p.productName}</p>
                      <p className="mt-0.5 text-sm text-slate-500">{attentionLine(p)}</p>
                      {p.recommendedQuantity > 0 && (
                        <p className="mt-0.5 text-sm text-slate-700">Suggested restock: {p.recommendedQuantity} {p.unit}</p>
                      )}
                    </div>
                    <PriorityBadge priority={p.priority} />
                  </li>
                ))}
                {selling.map((p) => (
                  <li key={p.productId} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{p.productName}</p>
                      <p className="mt-0.5 text-sm text-slate-500">{p.totalUnitsSold} sold recently</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      Selling quickly
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {restocking.data && restocking.data.summary.insufficientHistory > 0 && (
              <p className="mt-3 text-xs text-slate-400">
                {restocking.data.summary.insufficientHistory} products have too little sales history to judge yet.
              </p>
            )}
          </SectionState>
        </Card>

        <Card title="What's likely to sell next?" action={<HorizonSelector value={days} onChange={setDays} />}>
          <SectionState {...intelligence} onRetry={intelligence.reload} hasData={intel !== null}>
            {nextUp.length === 0 ? (
              <EmptyState message="Not enough sales history to estimate demand yet." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {nextUp.map((p) => (
                  <li key={p.productId} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{p.productName}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        Expected demand: <span className="font-medium text-slate-800">{p.predictedDemand} units</span> · In stock: {p.currentStock}
                        {p.stockCoverageDays !== null && ` · may last ${formatDays(p.stockCoverageDays)}`}
                      </p>
                    </div>
                    <Button variant="secondary" onClick={() => setOpenProduct(p.productId)}>
                      View details
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-400">Based on recent sales. An estimate, not a guarantee.</p>

            {intel && (
              <details className="group mt-3 border-t border-slate-100 pt-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">View forecast details</summary>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Based on</dt>
                    <dd className="text-right text-slate-800">Recent sales ({intel.forecast.selectedModel.label.toLowerCase()})</dd>
                  </div>
                  {intel.forecast.split && accuracy ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Checked against</dt>
                        <dd className="text-right text-slate-800">
                          {formatDate(intel.forecast.split.test.startDate)} – {formatDate(intel.forecast.split.test.endDate)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Typical error</dt>
                        <dd className="text-right text-slate-800">
                          {formatPercent(accuracy.selected.wape)} (simple average: {formatPercent(accuracy.baseline.wape)})
                        </dd>
                      </div>
                    </>
                  ) : (
                    <p className="text-slate-500">Not enough sales history to check the forecast yet.</p>
                  )}
                </dl>
                {intel.forecast.dataQuality?.warning && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">{intel.forecast.dataQuality.warning}</p>}
                <p className="mt-2 text-xs text-slate-400">{intel.forecast.limitation}</p>
              </details>
            )}
          </SectionState>
        </Card>
      </div>

      <ProductInsightModal
        productId={openProduct}
        onClose={() => setOpenProduct(null)}
        days={days}
        onDaysChange={setDays}
        insights={insights.data}
        forecast={forecast.data}
        restocking={restocking.data}
        intelligence={intel}
      />
    </>
  )
}

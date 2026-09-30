import { useState } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { StatusBadge } from '../ui/StatusBadge'
import { api, ApiRequestError } from '../../lib/api'
import { formatDays, wholeDays } from '../../lib/format'
import type {
  ExplainResponse,
  ForecastResponse,
  HorizonDays,
  IntelligenceResponse,
  ProductInsightsResponse,
  RestockingResponse,
} from '../../types/analytics'
import { ForecastVsActualChart } from '../charts/ForecastVsActualChart'
import {
  formatPercent,
  historyNote,
  HorizonSelector,
  MovementBadge,
  PriorityBadge,
  RestockBadge,
  SourceBadge,
} from './InsightBits'

interface Props {
  productId: string | null
  onClose: () => void
  days: HorizonDays
  onDaysChange: (d: HorizonDays) => void
  insights: ProductInsightsResponse | null
  forecast: ForecastResponse | null
  restocking: RestockingResponse | null
  intelligence: IntelligenceResponse | null
}

type Explanation =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; result: ExplainResponse }

const MODEL_LABEL = {
  'historical-mean': 'Historical average',
  'moving-average': 'Moving average',
  'exponential-smoothing': 'Exponential smoothing',
} as const

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4 py-2 text-sm">
    <dt className="text-slate-500">{label}</dt>
    <dd className="text-right font-medium text-slate-800">{value}</dd>
  </div>
)

/**
 * Shows one product's backend insight and lets the owner ask for a plain-language
 * AI explanation of it. The values sent for the explanation are exactly the ones
 * shown here (all calculated by the backend); the frontend changes none of them.
 */
export function ProductInsightModal({
  productId,
  onClose,
  days,
  onDaysChange,
  insights,
  forecast,
  restocking,
  intelligence,
}: Props) {
  // Keyed by product and horizon, so switching either drops an explanation that no longer applies.
  const key = `${productId}:${days}`
  const [explained, setExplained] = useState<{ key: string; value: Explanation }>({ key, value: { state: 'idle' } })
  const explanation: Explanation = explained.key === key ? explained.value : { state: 'idle' }

  const insight = insights?.products.find((p) => p.productId === productId)
  const rec = restocking?.products.find((p) => p.productId === productId)
  const fc = forecast?.products.find((p) => p.productId === productId)
  const intel = intelligence?.products.find((p) => p.productId === productId)
  const ready = Boolean(insight && rec && fc)

  async function explain() {
    if (!insight || !rec || !fc) return
    const requestKey = key
    setExplained({ key: requestKey, value: { state: 'loading' } })
    try {
      const result = await api.explain({
        product: rec.productName,
        currentStock: rec.currentStock,
        minimumStock: rec.minimumStockLevel,
        forecastedDemand: rec.forecastedDemand,
        recommendedPurchase: rec.recommendedQuantity,
        status: rec.status,
        averageDailyDemand: fc.averageDailyDemand,
        // Whole days for what the user reads; the precise value stays in the calculations.
        stockCoverage: wholeDays(intel?.stockCoverageDays ?? insight.stockCoverageDays),
        forecastHorizonDays: rec.forecastHorizonDays,
        // Verified extras, sent only when the backend calculated them.
        ...(intel && {
          restockPriority: intel.priority,
          forecastModel: MODEL_LABEL[intel.forecastModel],
          forecastReliability: intel.dataStatus,
          forecastErrorPercent: intel.testWape === null ? null : Math.round(intel.testWape * 1000) / 10,
        }),
      })
      setExplained({ key: requestKey, value: { state: 'ready', result } })
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'Could not get an explanation.'
      setExplained({ key: requestKey, value: { state: 'error', message } })
    }
  }

  return (
    <Modal title={insight ? `Insight · ${insight.productName}` : 'Product Insight'} isOpen={productId !== null} onClose={onClose}>
      {!ready || !insight || !rec || !fc ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading insight…</p>
      ) : (
        <div className="space-y-5">
          <dl className="divide-y divide-slate-100">
            <Row label="Current stock" value={`${insight.currentStock} ${rec.unit}`} />
            <div className="flex items-center justify-between py-2 text-sm">
              <dt className="text-slate-500">Stock status</dt>
              <dd><StatusBadge status={insight.stockStatus} /></dd>
            </div>
            <Row label="Sales velocity" value={insight.salesVelocity === null ? '—' : `${Math.round(insight.salesVelocity)} per day`} />
            <Row label="Stock coverage" value={insight.stockCoverageDays === null ? 'Not available (no sales)' : formatDays(insight.stockCoverageDays)} />
            <div className="flex items-center justify-between py-2 text-sm">
              <dt className="text-slate-500">Movement</dt>
              <dd><MovementBadge movement={insight.movement} /></dd>
            </div>
          </dl>

          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Forecast &amp; restocking</h3>
              <HorizonSelector value={days} onChange={onDaysChange} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Calculated by system</span>
              <SourceBadge kind="business" />
              {intel && <PriorityBadge priority={intel.priority} />}
            </div>
            <dl className="divide-y divide-slate-200">
              <Row label={`Expected demand (${rec.forecastHorizonDays} days)`} value={`${Math.round(rec.forecastedDemand)} ${rec.unit}`} />
              <Row label="Target stock" value={String(Math.round(rec.targetStock))} />
              <Row label="Suggested restock" value={`${rec.recommendedQuantity} ${rec.unit}`} />
              <div className="flex items-center justify-between py-2 text-sm">
                <dt className="text-slate-500">Restocking status</dt>
                <dd><RestockBadge status={rec.status} /></dd>
              </div>
            </dl>
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-500 hover:text-slate-700">View forecast details</summary>
              <dl className="mt-2 divide-y divide-slate-200">
                <Row label="Based on" value="Based on recent sales" />
                <Row
                label="Forecast reliability"
                value={
                  fc.dataStatus === 'Sufficient' ? 'Sufficient history' : fc.dataStatus === 'Limited History' ? 'Limited history' : 'No sales history'
                }
              />
              {fc.test && (
                <Row
                  label="Error on recent days"
                  value={`${formatPercent(fc.test.model.wape)} (simple average: ${formatPercent(fc.test.baseline.wape)})`}
                />
              )}
              </dl>
            </details>
            {historyNote(rec.dataStatus) && (
              <p className="text-xs text-amber-700">{historyNote(rec.dataStatus)}: treat this estimate with caution.</p>
            )}
            {intel && (
              <p className="text-xs text-slate-600">
                <span className="font-medium">{intel.advice}</span> {intel.priorityReasons.join(' ')}
                {intel.reliabilityNote ? ` ${intel.reliabilityNote}` : ''}
              </p>
            )}
            <p className="text-xs text-slate-500">{rec.reason}</p>
            <p className="text-xs text-slate-400">Estimate based on past sales, not a guarantee.</p>
          </div>

          {fc.testWindow.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-800">Forecast vs actual · last {fc.testWindow.length} days</h3>
              <ForecastVsActualChart data={fc.testWindow} />
              <p className="text-xs text-slate-400">These recent days were held back: the forecast was built without seeing them.</p>
            </div>
          )}

          <div>
            {explanation.state === 'idle' && (
              <Button variant="secondary" onClick={() => void explain()}>
                Explain this insight
              </Button>
            )}
            {explanation.state === 'loading' && (
              <Button variant="secondary" disabled>
                Explaining…
              </Button>
            )}
            {explanation.state === 'error' && (
              <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <p>{explanation.message} The insight above is still accurate.</p>
                <Button variant="secondary" onClick={() => void explain()}>
                  Try Again
                </Button>
              </div>
            )}
            {explanation.state === 'ready' && (
              <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                  {explanation.result.source === 'groq' ? 'AI explanation' : 'Standard explanation'}
                </p>
                <p className="text-sm text-slate-700">{explanation.result.explanation}</p>
                <p className="text-xs text-slate-500">
                  {explanation.result.source === 'groq'
                    ? "Written by AI to explain the system's calculated figures above. The figures themselves are not changed by AI."
                    : "AI was unavailable, so this text was generated directly from the system's calculated figures."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

import type { ReactNode } from 'react'
import { Button } from '../ui/Button'
import type { DataStatus, HorizonDays, Movement, RestockStatus } from '../../types/analytics'

export const HORIZONS: HorizonDays[] = [7, 14, 30]

const badge = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset'

const movementStyles: Record<Movement, string> = {
  'Fast Moving': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  Normal: 'bg-slate-50 text-slate-600 ring-slate-500/20',
  'Slow Moving': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'No Sales': 'bg-slate-50 text-slate-500 ring-slate-400/20',
}

const restockStyles: Record<RestockStatus, string> = {
  'Needs Restocking': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'No Restocking Needed': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'Insufficient History': 'bg-slate-50 text-slate-600 ring-slate-500/20',
}

export const MovementBadge = ({ movement }: { movement: Movement }) => (
  <span className={`${badge} ${movementStyles[movement]}`}>{movement}</span>
)

export const RestockBadge = ({ status }: { status: RestockStatus }) => (
  <span className={`${badge} ${restockStyles[status]}`}>{status}</span>
)

export const historyNote = (s: DataStatus) =>
  s === 'No Sales' ? 'No sales history' : s === 'Limited History' ? 'Limited sales history' : null

export const formatNumber = (n: number | null, suffix = '') => (n === null ? '—' : `${n}${suffix}`)

/** Segmented 7 / 14 / 30 day selector. */
export function HorizonSelector({ value, onChange }: { value: HorizonDays; onChange: (d: HorizonDays) => void }) {
  return (
    <div role="group" aria-label="Forecast horizon" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
      {HORIZONS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={value === d}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {d} days
        </button>
      ))}
    </div>
  )
}

/** Loading / error (with retry) wrapper for one analytics section. */
export function SectionState({
  status,
  error,
  onRetry,
  hasData,
  children,
}: {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  onRetry: () => void
  hasData: boolean
  children: ReactNode
}) {
  if (!hasData && status === 'loading') return <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
  if (!hasData && status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 py-4 text-center">
        <p className="text-sm text-red-700">{error ?? 'Could not load this section.'}</p>
        <Button variant="secondary" onClick={onRetry}>
          Try Again
        </Button>
      </div>
    )
  }
  return <>{children}</>
}

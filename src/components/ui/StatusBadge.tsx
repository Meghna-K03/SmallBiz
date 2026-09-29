import type { StockStatus } from '../../types'

const styles: Record<StockStatus, string> = {
  Healthy: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'Low Stock': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'Out of Stock': 'bg-red-50 text-red-700 ring-red-600/20',
}

export function StatusBadge({ status }: { status: StockStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${styles[status]}`}
    >
      {status}
    </span>
  )
}

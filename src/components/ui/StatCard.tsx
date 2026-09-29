interface StatCardProps {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warning' | 'positive'
}

const toneClasses = {
  default: 'text-slate-900',
  warning: 'text-amber-600',
  positive: 'text-emerald-600',
}

export function StatCard({ label, value, hint, tone = 'default' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClasses[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

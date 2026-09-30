interface StatCardProps {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warning' | 'positive'
}

const toneClasses = {
  default: 'text-slate-900',
  warning: 'text-amber-600',
  positive: 'text-emerald-700',
}

export function StatCard({ label, value, hint, tone = 'default' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(20,28,51,0.04)]">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`font-display mt-2 text-3xl font-semibold ${toneClasses[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

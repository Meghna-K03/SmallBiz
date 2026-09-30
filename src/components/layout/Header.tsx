import type { ReactNode } from 'react'
import { formatDate, getTodayISO } from '../../lib/format'

export function Header({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-5 pb-1 pt-7 sm:px-8">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action ?? <span className="text-sm text-slate-500">{formatDate(getTodayISO())}</span>}
    </header>
  )
}

import { formatDate, getTodayISO } from '../../lib/format'

export function Header({ title }: { title: string }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5">
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      <span className="text-sm text-slate-500">{formatDate(getTodayISO())}</span>
    </header>
  )
}

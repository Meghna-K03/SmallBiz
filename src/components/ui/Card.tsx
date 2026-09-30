import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function Card({ title, action, children, className = '' }: CardProps) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(20,28,51,0.04)] ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-1 pt-5">
          {title && <h3 className="font-display text-lg font-semibold text-slate-900">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

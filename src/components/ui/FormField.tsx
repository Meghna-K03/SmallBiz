import type { ReactNode } from 'react'

export const inputClasses =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'

interface FormFieldProps {
  label: string
  htmlFor: string
  children: ReactNode
  required?: boolean
}

export function FormField({ label, htmlFor, children, required }: FormFieldProps) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}

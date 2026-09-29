import type { ReactNode } from 'react'
import { useData } from '../../context/DataContext'
import { Button } from './Button'

/**
 * Wraps a page's content: shows a loading message until the first fetch
 * finishes, an error with Retry if it failed, and a banner (with the page
 * still usable) if a later refresh failed.
 */
export function DataGate({ children }: { children: ReactNode }) {
  const { status, loadError, reload } = useData()

  if (status === 'loading') {
    return <p className="py-10 text-center text-sm text-slate-500">Loading data…</p>
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center">
        <p className="text-sm text-red-700">{loadError ?? 'Could not load data.'}</p>
        <Button variant="secondary" onClick={() => void reload()}>
          Try Again
        </Button>
      </div>
    )
  }

  return (
    <>
      {loadError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>{loadError}</span>
          <Button variant="secondary" onClick={() => void reload()}>
            Refresh
          </Button>
        </div>
      )}
      {children}
    </>
  )
}

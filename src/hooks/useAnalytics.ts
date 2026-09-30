import { useEffect, useState } from 'react'
import { useData } from '../context/DataContext'
import { api, ApiRequestError } from '../lib/api'
import type {
  ForecastResponse,
  HorizonDays,
  IntelligenceResponse,
  ProductInsightsResponse,
  RestockingResponse,
} from '../types/analytics'

export interface Section<T> {
  status: 'loading' | 'ready' | 'error'
  data: T | null
  error: string | null
  reload: () => void
}

/**
 * Loads one analytics response from the backend. It reloads when the shop's
 * data changes (a sale, purchase, or product edit) or `deps` change. Each
 * section fails on its own, so one failed request never blanks the others.
 * `isCurrent` lets a section drop data that no longer matches (e.g. an old horizon).
 */
function useSection<T>(fetcher: () => Promise<T>, deps: unknown[], isCurrent?: (data: T) => boolean): Section<T> {
  const [state, setState] = useState<{ status: Section<T>['status']; data: T | null; error: string | null }>({
    status: 'loading',
    data: null,
    error: null,
  })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState((s) => {
      const keep = s.data !== null && (!isCurrent || isCurrent(s.data))
      return { status: keep ? 'ready' : 'loading', data: keep ? s.data : null, error: null }
    })
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof ApiRequestError ? err.message : 'Could not load this section.'
        setState((s) => ({ status: 'error', data: s.data, error: message }))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { ...state, reload: () => setNonce((n) => n + 1) }
}

/**
 * Backend analytics for the selected forecast horizon. Refetches automatically
 * after the shop's products, sales or purchases change.
 */
export function useAnalytics(days: HorizonDays) {
  const { products, sales, purchases } = useData()
  const dataVersion = [products, sales, purchases]

  const insights = useSection<ProductInsightsResponse>(() => api.getProductInsights(), dataVersion)
  const forecast = useSection<ForecastResponse>(
    () => api.getForecast(days),
    [days, ...dataVersion],
    (d) => d.forecastHorizonDays === days,
  )
  const restocking = useSection<RestockingResponse>(
    () => api.getRestocking(days),
    [days, ...dataVersion],
    (d) => d.forecastHorizonDays === days,
  )
  const intelligence = useSection<IntelligenceResponse>(
    () => api.getIntelligence(days),
    [days, ...dataVersion],
    (d) => d.forecastHorizonDays === days,
  )
  return { insights, forecast, restocking, intelligence }
}

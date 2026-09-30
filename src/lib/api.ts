import type { Expense, Product, Purchase, Sale } from '../types'
import type {
  AnalyticsSummary,
  ExplainRequest,
  ExplainResponse,
  ForecastResponse,
  ProductInsightsResponse,
  RestockingResponse,
} from '../types/analytics'

/**
 * Thin client for the SmallBiz Lens REST API. The base URL comes from
 * VITE_API_URL (see .env.example); no server secrets ever reach the frontend.
 */

const API_URL = import.meta.env.VITE_API_URL as string | undefined

/** An error whose message is safe to show directly to the shop owner. */
export class ApiRequestError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_URL) {
    throw new ApiRequestError('The app is not configured with a backend address (VITE_API_URL).')
  }

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError('Cannot reach the server. Check that the backend is running and try again.')
  }

  if (response.status === 204) return undefined as T

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    throw new ApiRequestError(errorMessage(response.status, payload))
  }
  return payload as T
}

/** Turns an error response into a short message; never surfaces server internals. */
function errorMessage(status: number, payload: unknown): string {
  const error = (payload as { error?: { message?: string; details?: string[] } } | undefined)?.error
  // 4xx messages come from our own API and are written for users (validation, conflicts).
  if (status >= 400 && status < 500 && error?.message) {
    return error.details?.length ? error.details.join('. ') : error.message
  }
  return 'Something went wrong on the server. Please try again.'
}

type New<T> = Omit<T, 'id'>

// The API returns `supplier: null` when none was given; the UI type uses undefined.
const toPurchase = (p: Purchase & { supplier: string | null }): Purchase => ({
  ...p,
  supplier: p.supplier ?? undefined,
})

export const api = {
  getProducts: () => request<Product[]>('GET', '/products'),
  createProduct: (p: New<Product>) => request<Product>('POST', '/products', p),
  updateProduct: (id: string, p: New<Product>) => request<Product>('PUT', `/products/${id}`, p),
  deleteProduct: (id: string) => request<void>('DELETE', `/products/${id}`),

  getSales: () => request<Sale[]>('GET', '/sales'),
  createSale: (s: New<Sale>) => request<Sale>('POST', '/sales', s),

  getPurchases: () =>
    request<(Purchase & { supplier: string | null })[]>('GET', '/purchases').then((list) =>
      list.map(toPurchase),
    ),
  createPurchase: (p: New<Purchase>) => request<Purchase>('POST', '/purchases', p),

  getExpenses: () => request<Expense[]>('GET', '/expenses'),
  createExpense: (e: New<Expense>) => request<Expense>('POST', '/expenses', e),

  // Analytics: all values are calculated by the backend.
  getAnalyticsSummary: () => request<AnalyticsSummary>('GET', '/analytics/summary'),
  getProductInsights: () => request<ProductInsightsResponse>('GET', '/analytics/product-insights'),
  getForecast: (days: number) => request<ForecastResponse>('GET', `/analytics/forecast?days=${days}`),
  getRestocking: (days: number) => request<RestockingResponse>('GET', `/analytics/restocking?days=${days}`),
  explain: (body: ExplainRequest) => request<ExplainResponse>('POST', '/analytics/explain', body),
}


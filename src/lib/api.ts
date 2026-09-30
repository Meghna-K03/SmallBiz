import type { Expense, Product, Purchase, Sale } from '../types'
import type {
  AnalyticsSummary,
  ExplainRequest,
  ExplainResponse,
  ForecastResponse,
  IntelligenceResponse,
  ProductInsightsResponse,
  RestockingResponse,
  CompetitivePricesResponse,
} from '../types/analytics'

/**
 * Thin client for the SmallBiz Lens REST API. The base URL comes from
 * VITE_API_URL (see .env.example); no server secrets ever reach the frontend.
 */

const API_URL = import.meta.env.VITE_API_URL as string | undefined

/** An error whose message is safe to show directly to the shop owner. */
export class ApiRequestError extends Error {}

/** `token` is sent as a Bearer token; only the account endpoints use it. Shop endpoints are called as before. */
async function request<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  if (!API_URL) {
    throw new ApiRequestError('The app is not configured with a backend address (VITE_API_URL).')
  }

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
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

export interface AccountInfo {
  email: string
  mobile: string
}
export interface ShopProfile {
  name: string
  description: string
  descriptionIsPlaceholder: boolean
  phone: string
  location: string | null
}

export const api = {
  // Accounts
  register: (b: { email: string; mobile: string; password: string; confirmPassword: string }) =>
    request<{ message: string }>('POST', '/auth/register', b),
  login: (b: { email: string; password: string }) =>
    request<{ token: string; account: AccountInfo }>('POST', '/auth/login', b),
  logout: (token: string) => request<void>('POST', '/auth/logout', undefined, token),
  me: (token: string) => request<{ account: AccountInfo; shop: ShopProfile }>('GET', '/auth/me', undefined, token),
  updateProfile: (token: string, b: { name: string; description: string; phone: string; location: string }) =>
    request<{ shop: ShopProfile }>('PUT', '/auth/profile', b, token),
  changePassword: (token: string, b: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    request<{ message: string }>('POST', '/auth/change-password', b, token),

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
  // The dashboard uses the temporally validated forecast. The older /analytics/forecast
  // (plain historical average) still exists on the server for compatibility.
  getForecast: (days: number) =>
    request<Omit<ForecastResponse, 'products'> & { products: (Omit<ForecastResponse['products'][number], 'forecastedDemand'>)[] }>(
      'GET',
      `/analytics/forecast/validated?days=${days}`,
    ).then((f): ForecastResponse => ({ ...f, products: f.products.map((p) => ({ ...p, forecastedDemand: p.predictedDemand })) })),
  getRestocking: (days: number) =>
    request<RestockingResponse>('GET', `/analytics/restocking?days=${days}&forecast=validated`),
  getIntelligence: (days: number) => request<IntelligenceResponse>('GET', `/analytics/inventory-intelligence?days=${days}`),
  // Blinkit and Zepto prices from the project's own files (no shop data involved).
  getCompetitivePrices: () => request<CompetitivePricesResponse>('GET', '/analytics/competitive-prices'),
  explain: (body: ExplainRequest) => request<ExplainResponse>('POST', '/analytics/explain', body),
}


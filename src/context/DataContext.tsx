import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, ApiRequestError } from '../lib/api'
import type { Expense, Product, Purchase, Sale } from '../types'

type Status = 'loading' | 'ready' | 'error'

interface DataContextValue {
  products: Product[]
  sales: Sale[]
  purchases: Purchase[]
  expenses: Expense[]
  /** 'loading' until the first fetch finishes; 'error' if that first fetch failed. */
  status: Status
  /** Set when the first load failed, or a refresh after a successful save failed. */
  loadError: string | null
  reload: () => Promise<void>
  // Mutations resolve once the backend has saved the change and the data is
  // refreshed. They reject with an ApiRequestError (safe message) on failure.
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>
  updateProduct: (id: string, product: Omit<Product, 'id'>) => Promise<void>
  deleteProduct: (id: string) => Promise<void>
  addSale: (sale: Omit<Sale, 'id'>) => Promise<void>
  addPurchase: (purchase: Omit<Purchase, 'id'>) => Promise<void>
  addExpense: (expense: Omit<Expense, 'id'>) => Promise<void>
}

const DataContext = createContext<DataContextValue | undefined>(undefined)

const messageOf = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.'

export function DataProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [p, s, pu, e] = await Promise.all([
        api.getProducts(),
        api.getSales(),
        api.getPurchases(),
        api.getExpenses(),
      ])
      setProducts(p)
      setSales(s)
      setPurchases(pu)
      setExpenses(e)
      setStatus('ready')
      setLoadError(null)
    } catch (err) {
      // Keep whatever data is already on screen; only a first-load failure blocks the pages.
      setStatus((prev) => (prev === 'ready' ? 'ready' : 'error'))
      setLoadError(messageOf(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<DataContextValue>(() => {
    // Run a write, then refresh one collection. A failed write rejects to the
    // caller's form; a failed refresh after a successful write shows a banner.
    async function mutate<T>(write: () => Promise<T>, refresh: () => Promise<void>): Promise<void> {
      await write()
      try {
        await refresh()
        setLoadError(null)
      } catch (err) {
        setLoadError(`Saved, but the list could not be refreshed. ${messageOf(err)}`)
      }
    }

    return {
      products,
      sales,
      purchases,
      expenses,
      status,
      loadError,
      reload,
      addProduct: (product) =>
        mutate(() => api.createProduct(product), async () => setProducts(await api.getProducts())),
      updateProduct: (id, product) =>
        mutate(() => api.updateProduct(id, product), async () => setProducts(await api.getProducts())),
      deleteProduct: (id) =>
        mutate(() => api.deleteProduct(id), async () => setProducts(await api.getProducts())),
      addSale: (sale) =>
        mutate(() => api.createSale(sale), async () => setSales(await api.getSales())),
      addPurchase: (purchase) =>
        mutate(() => api.createPurchase(purchase), async () => setPurchases(await api.getPurchases())),
      addExpense: (expense) =>
        mutate(() => api.createExpense(expense), async () => setExpenses(await api.getExpenses())),
    }
  }, [products, sales, purchases, expenses, status, loadError, reload])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a DataProvider')
  return ctx
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type AccountInfo, type ShopProfile } from '../lib/api'
import { clearToken, getToken, setToken } from '../lib/session'

/**
 * Real (basic) accounts: the server issues a session token at sign-in, and a stored token is
 * checked with the server on every page load, so only a registered account can get in. The retail
 * data endpoints themselves are unchanged and are not protected by this yet.
 */

type Status = 'checking' | 'signedOut' | 'signedIn'

interface AuthValue {
  status: Status
  account: AccountInfo | null
  token: string | null
  /** The shop profile, shared so the sidebar and the profile panel always show the same saved values. */
  shop: ShopProfile | null
  setShop: (shop: ShopProfile) => void
  /** Called once the server has accepted the credentials. */
  signIn: (token: string, account: AccountInfo) => void
  signOut: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: Status; account: AccountInfo | null; token: string | null }>(() => {
    const token = getToken()
    return { status: token ? 'checking' : 'signedOut', account: null, token }
  })

  const [shop, setShop] = useState<ShopProfile | null>(null)

  // A token left in this browser is only trusted after the server confirms it.
  useEffect(() => {
    const token = getToken()
    if (!token) return
    let cancelled = false
    api
      .me(token)
      .then((r) => {
        if (cancelled) return
        setState({ status: 'signedIn', account: r.account, token })
        setShop(r.shop)
      })
      .catch(() => {
        if (cancelled) return
        clearToken()
        setState({ status: 'signedOut', account: null, token: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // After a fresh sign-in the profile is not loaded yet.
  useEffect(() => {
    if (state.status !== 'signedIn' || !state.token || shop) return
    let cancelled = false
    api
      .me(state.token)
      .then((r) => !cancelled && setShop(r.shop))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [state.status, state.token, shop])

  const signIn = useCallback((token: string, account: AccountInfo) => {
    setToken(token)
    setState({ status: 'signedIn', account, token })
  }, [])

  const signOut = useCallback(() => {
    const token = getToken()
    clearToken()
    setState({ status: 'signedOut', account: null, token: null })
    setShop(null)
    if (token) void api.logout(token).catch(() => undefined) // best effort: the local session is already gone
  }, [])

  const value = useMemo(() => ({ ...state, shop, setShop, signIn, signOut }), [state, shop, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

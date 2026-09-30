const KEY = 'smallbiz.session-token'

/** The session token issued by the server at sign-in. Kept in this browser only; storage failures are tolerated. */
export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    /* storage unavailable: the session then lasts until the page is closed */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

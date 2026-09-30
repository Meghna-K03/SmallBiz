import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing and input rules for accounts. Pure: no database, no framework.
 * Uses Node's built-in scrypt (a memory-hard password hash), so no extra dependency is needed.
 */

const KEY_LENGTH = 64
const SCRYPT = { N: 16384, r: 8, p: 1 }

export const MIN_PASSWORD_LENGTH = 8

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, KEY_LENGTH, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))))

/** "scrypt$<salt hex>$<hash hex>". A fresh random salt for every password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await derive(password, Buffer.from(saltHex, 'hex'))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** A random session token (sent to the browser) and its SHA-256 (the only thing stored). */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// ---------- input rules ----------

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isValidEmail = (email: string) => email.length <= 254 && EMAIL.test(email)

/** "+91 98765-43210", "098765 43210", "9876543210" -> "9876543210"; null when it is not a 10-digit Indian mobile. */
export function normalizeMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

export function passwordProblem(password: string): string | null {
  if (password === '') return 'Please enter a password.'
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password.length > 200) return 'Password is too long.'
  return null
}

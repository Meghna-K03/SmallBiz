import { Router, type RequestHandler } from 'express'
import { SHOP_PROFILE } from '../config/shopProfile'
import { ApiError, conflict, validationError } from '../lib/errors'
import {
  hashPassword,
  hashToken,
  isValidEmail,
  newSessionToken,
  normalizeEmail,
  normalizeMobile,
  passwordProblem,
  verifyPassword,
} from '../lib/password'
import { prisma } from '../lib/prisma'

/**
 * Basic accounts: create account, sign in, sign out, current account, change password.
 * Only these routes use accounts. The existing retail routes are unchanged (and unauthenticated,
 * as before), and nothing here reads or writes a retail table.
 */

const router = Router()

const SESSION_DAYS = 30
const INVALID_LOGIN = 'Incorrect email or password.'

/** A hash of a random password, checked when the email is unknown so both failures take similar time. */
let decoyHash: Promise<string> | null = null
const decoy = () => (decoyHash ??= hashPassword('decoy-password-for-timing'))

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

const unauthorized = (message = 'Please sign in again.') => new ApiError(401, 'UNAUTHORIZED', message)

/** Requires `Authorization: Bearer <token>` for a live session; puts the account and session ids on res.locals. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) throw unauthorized()
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { account: true } })
    if (!session || session.expiresAt.getTime() <= Date.now()) throw unauthorized()
    res.locals.auth = { sessionId: session.id, account: session.account }
    next()
  } catch (err) {
    next(err)
  }
}

const publicAccount = (a: { email: string; mobile: string }) => ({ email: a.email, mobile: a.mobile })

router.post('/register', async (req, res) => {
  const body = req.body ?? {}
  const email = normalizeEmail(text(body.email))
  const mobileRaw = text(body.mobile).trim()
  const password = text(body.password)
  const confirm = text(body.confirmPassword)

  const problems: string[] = []
  if (!isValidEmail(email)) problems.push('Please enter a valid email address.')
  const mobile = normalizeMobile(mobileRaw)
  if (mobileRaw === '') problems.push('Please enter your mobile number.')
  else if (!mobile) problems.push('Please enter a valid 10-digit mobile number.')
  const pw = passwordProblem(password)
  if (pw) problems.push(pw)
  else if (confirm !== password) problems.push('Passwords do not match.')
  if (problems.length > 0 || !mobile) throw validationError(problems)

  if (await prisma.account.findUnique({ where: { email } })) throw conflict('An account with this email already exists.')
  if (await prisma.account.findUnique({ where: { mobile } })) throw conflict('An account with this mobile number already exists.')

  try {
    await prisma.account.create({ data: { email, mobile, passwordHash: await hashPassword(password) } })
  } catch (err) {
    // Two requests racing past the checks above: the unique indexes are the final guard.
    if ((err as { code?: string })?.code === 'P2002') throw conflict('An account with this email or mobile number already exists.')
    throw err
  }
  res.status(201).json({ message: 'Account created. You can now sign in.' })
})

router.post('/login', async (req, res) => {
  const body = req.body ?? {}
  const email = normalizeEmail(text(body.email))
  const password = text(body.password)
  if (email === '' || password === '') throw new ApiError(400, 'VALIDATION_ERROR', 'Enter your email and password.')

  const account = await prisma.account.findUnique({ where: { email } })
  const ok = await verifyPassword(password, account?.passwordHash ?? (await decoy()))
  if (!account || !ok) throw new ApiError(401, 'INVALID_CREDENTIALS', INVALID_LOGIN)

  const { token, tokenHash } = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await prisma.session.create({ data: { accountId: account.id, tokenHash, expiresAt } })
  res.json({ token, expiresAt: expiresAt.toISOString(), account: publicAccount(account) })
})

router.post('/logout', requireAuth, async (_req, res) => {
  await prisma.session.deleteMany({ where: { id: res.locals.auth.sessionId } })
  res.status(204).end()
})

/** The shop profile: the owner's edits where they exist, otherwise the defaults (phone = registered mobile). */
const shopFor = (a: { mobile: string; shopName: string | null; shopDescription: string | null; shopPhone: string | null; shopLocation: string | null }) => ({
  name: a.shopName ?? SHOP_PROFILE.name,
  description: a.shopDescription ?? SHOP_PROFILE.description,
  descriptionIsPlaceholder: a.shopDescription === null && SHOP_PROFILE.descriptionIsPlaceholder,
  phone: a.shopPhone ?? a.mobile,
  location: a.shopLocation ?? SHOP_PROFILE.location,
})

// The signed-in account plus the shop profile.
router.get('/me', requireAuth, (_req, res) => {
  const { account } = res.locals.auth
  res.json({ account: publicAccount(account), shop: shopFor(account) })
})

// Edit the shop profile. Stored on the account; no retail table is touched.
router.put('/profile', requireAuth, async (req, res) => {
  const { account } = res.locals.auth
  const body = req.body ?? {}
  const name = text(body.name).trim()
  const description = text(body.description).trim()
  const phone = text(body.phone).trim()
  const location = text(body.location).trim()

  const problems: string[] = []
  if (name === '') problems.push('Please enter the shop name.')
  else if (name.length > 100) problems.push('The shop name must be 100 characters or fewer.')
  if (description.length > 500) problems.push('The description must be 500 characters or fewer.')
  const phoneDigits = phone.replace(/\D/g, '')
  if (phone === '') problems.push('Please enter a phone number.')
  else if (!/^[0-9+\-()\s]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) problems.push('Please enter a valid phone number.')
  if (location.length > 200) problems.push('The location must be 200 characters or fewer.')
  if (problems.length > 0) throw validationError(problems)

  const updated = await prisma.account.update({
    where: { id: account.id },
    // Empty description/location go back to the defaults.
    data: { shopName: name, shopDescription: description || null, shopPhone: phone, shopLocation: location || null },
  })
  res.json({ shop: shopFor(updated) })
})

router.post('/change-password', requireAuth, async (req, res) => {
  const { account, sessionId } = res.locals.auth
  const body = req.body ?? {}
  const current = text(body.currentPassword)
  const next = text(body.newPassword)
  const confirm = text(body.confirmPassword)

  if (current === '') throw validationError(['Please enter your current password.'])
  const problem = passwordProblem(next)
  if (problem) throw validationError([problem.replace('Please enter a password.', 'Please enter a new password.')])
  if (confirm !== next) throw validationError(['Passwords do not match.'])
  if (!(await verifyPassword(current, account.passwordHash))) throw new ApiError(400, 'WRONG_PASSWORD', 'Your current password is not correct.')
  if (next === current) throw validationError(['Choose a new password that is different from the current one.'])

  await prisma.account.update({ where: { id: account.id }, data: { passwordHash: await hashPassword(next) } })
  // Any other device signed in with the old password is signed out; this session stays.
  await prisma.session.deleteMany({ where: { accountId: account.id, NOT: { id: sessionId } } })
  res.json({ message: 'Your password has been changed.' })
})

export default router

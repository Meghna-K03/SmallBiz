// Account flow through the real API and database. Creates only temporary "zz-auth-..." accounts and
// deletes exactly those afterwards. No retail table is read or written.
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'

let server: Server
let base = ''

before(async () => {
  server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
})

after(async () => {
  await prisma.account.deleteMany({ where: { email: { startsWith: 'zz-auth-' } } }) // sessions cascade
  await new Promise((r) => server.close(r))
  await prisma.$disconnect()
})

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const run = Math.random().toString(36).slice(2, 8)
const email = `zz-auth-${run}@example.test`
const mobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
const PASSWORD = 'first-password-1'
const NEW_PASSWORD = 'second-password-2'
const signup = (over: Record<string, unknown> = {}) => call('POST', '/auth/register', { email, mobile, password: PASSWORD, confirmPassword: PASSWORD, ...over })

describe('accounts', () => {
  it('signup requires a valid email, a mobile number, a password and a matching confirmation', async () => {
    const noMobile = await signup({ mobile: '' })
    assert.equal(noMobile.status, 400)
    assert.ok(noMobile.body.error.details.includes('Please enter your mobile number.'))
    assert.ok((await signup({ email: 'nope' })).body.error.details.includes('Please enter a valid email address.'))
    assert.ok((await signup({ mobile: '123' })).body.error.details.includes('Please enter a valid 10-digit mobile number.'))
    assert.ok((await signup({ confirmPassword: 'different-1' })).body.error.details.includes('Passwords do not match.'))
    assert.equal((await signup({ password: '', confirmPassword: '' })).status, 400)
    assert.equal(await prisma.account.count({ where: { email } }), 0, 'nothing is created by invalid signups')
  })

  it('creates an account, stores a hash (not the password) and rejects duplicates', async () => {
    const ok = await signup()
    assert.equal(ok.status, 201)
    const row = await prisma.account.findUniqueOrThrow({ where: { email } })
    assert.ok(!row.passwordHash.includes(PASSWORD))
    assert.ok(row.passwordHash.startsWith('scrypt$'))
    assert.equal(JSON.stringify(ok.body).includes(row.passwordHash), false, 'no hash in the response')

    const dupEmail = await signup({ mobile: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}` })
    assert.equal(dupEmail.status, 409)
    assert.equal(dupEmail.body.error.message, 'An account with this email already exists.')
    const dupMobile = await signup({ email: `zz-auth-${run}-b@example.test` })
    assert.equal(dupMobile.status, 409)
    assert.equal(dupMobile.body.error.message, 'An account with this mobile number already exists.')
  })

  it('login needs no mobile number; wrong password and unknown email are rejected the same way', async () => {
    const wrong = await call('POST', '/auth/login', { email, password: 'wrong-password-9' })
    const unknown = await call('POST', '/auth/login', { email: `zz-auth-none-${run}@example.test`, password: PASSWORD })
    for (const r of [wrong, unknown]) {
      assert.equal(r.status, 401)
      assert.equal(r.body.error.message, 'Incorrect email or password.')
    }
    const ok = await call('POST', '/auth/login', { email: email.toUpperCase(), password: PASSWORD })
    assert.equal(ok.status, 200)
    assert.ok(ok.body.token)
    assert.equal(ok.body.account.email, email)
    assert.equal(JSON.stringify(ok.body).includes('passwordHash'), false)
    const stored = await prisma.session.findMany({ where: { account: { email } } })
    assert.ok(stored.every((s) => s.tokenHash !== ok.body.token), 'the raw token is not stored')
  })

  it('protected routes need a valid session; /me returns the shop profile with the registered phone', async () => {
    assert.equal((await call('GET', '/auth/me')).status, 401)
    assert.equal((await call('GET', '/auth/me', undefined, 'bogus')).status, 401)
    const { body } = await call('POST', '/auth/login', { email, password: PASSWORD })
    const me = await call('GET', '/auth/me', undefined, body.token)
    assert.equal(me.status, 200)
    assert.equal(me.body.shop.name, 'Sharma Grocery Store')
    assert.equal(me.body.shop.phone, mobile)
    assert.ok(me.body.shop.description)
    assert.equal(me.body.shop.location, null, 'no invented address')
  })

  it('edit profile: saves, shows on the next /me, validates, and needs a session', async () => {
    const { body } = await call('POST', '/auth/login', { email, password: PASSWORD })
    const t = body.token
    const edit = { name: 'Sharma Fresh Mart', description: 'Fresh food.', phone: '98765 43210', location: 'MG Road' }
    assert.equal((await call('PUT', '/auth/profile', edit)).status, 401)
    assert.equal((await call('PUT', '/auth/profile', { ...edit, name: '  ' }, t)).status, 400)
    assert.equal((await call('PUT', '/auth/profile', { ...edit, phone: 'abc' }, t)).status, 400)
    const saved = await call('PUT', '/auth/profile', edit, t)
    assert.equal(saved.status, 200)
    const me = await call('GET', '/auth/me', undefined, t)
    assert.deepEqual({ ...me.body.shop, descriptionIsPlaceholder: undefined }, { ...edit, descriptionIsPlaceholder: undefined })
    assert.equal(me.body.account.mobile, mobile, 'the login mobile is not changed')
    const cleared = await call('PUT', '/auth/profile', { ...edit, description: '', location: '' }, t)
    assert.equal(cleared.body.shop.location, null)
    assert.equal(cleared.body.shop.descriptionIsPlaceholder, true)
  })

  it('change password: needs the current password, validates, then old fails and new works', async () => {
    const { body } = await call('POST', '/auth/login', { email, password: PASSWORD })
    const t = body.token
    const change = (over: Record<string, unknown>) => call('POST', '/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD, ...over }, t)

    assert.equal((await call('POST', '/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).status, 401)
    assert.equal((await change({ currentPassword: 'not-my-password' })).status, 400)
    assert.equal((await change({ currentPassword: '' })).status, 400)
    assert.equal((await change({ newPassword: '' , confirmPassword: '' })).status, 400)
    assert.equal((await change({ confirmPassword: 'mismatch-pass-1' })).status, 400)
    assert.equal((await call('POST', '/auth/login', { email, password: PASSWORD })).status, 200, 'unchanged after failed attempts')

    const ok = await change({})
    assert.equal(ok.status, 200)
    assert.equal((await call('POST', '/auth/login', { email, password: PASSWORD })).status, 401, 'old password rejected')
    assert.equal((await call('POST', '/auth/login', { email, password: NEW_PASSWORD })).status, 200, 'new password works')
    assert.equal((await call('GET', '/auth/me', undefined, t)).status, 200, 'current session stays signed in')
  })

  it('logout ends the session', async () => {
    const { body } = await call('POST', '/auth/login', { email, password: NEW_PASSWORD })
    assert.equal((await call('POST', '/auth/logout', undefined, body.token)).status, 204)
    assert.equal((await call('GET', '/auth/me', undefined, body.token)).status, 401)
  })

  it('expired sessions are refused', async () => {
    const { body } = await call('POST', '/auth/login', { email, password: NEW_PASSWORD })
    await prisma.session.updateMany({ where: { account: { email } }, data: { expiresAt: new Date(Date.now() - 1000) } })
    assert.equal((await call('GET', '/auth/me', undefined, body.token)).status, 401)
  })
})

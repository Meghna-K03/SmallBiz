// Pure tests (no database): password hashing and account input rules.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hashPassword, hashToken, isValidEmail, newSessionToken, normalizeEmail, normalizeMobile, passwordProblem, verifyPassword } from '../src/lib/password'

describe('password hashing', () => {
  it('never stores the password and uses a fresh salt each time', async () => {
    const a = await hashPassword('correct horse battery')
    const b = await hashPassword('correct horse battery')
    assert.ok(!a.includes('correct horse battery'))
    assert.notEqual(a, b)
    assert.ok(a.startsWith('scrypt$'))
  })
  it('accepts the right password and rejects a wrong one', async () => {
    const h = await hashPassword('right-password-1')
    assert.equal(await verifyPassword('right-password-1', h), true)
    assert.equal(await verifyPassword('right-password-2', h), false)
    assert.equal(await verifyPassword('', h), false)
  })
  it('rejects a malformed stored hash instead of throwing', async () => {
    assert.equal(await verifyPassword('x', 'not-a-hash'), false)
    assert.equal(await verifyPassword('x', 'scrypt$$'), false)
  })
})

describe('session tokens', () => {
  it('stores only a hash of the token', () => {
    const { token, tokenHash } = newSessionToken()
    assert.notEqual(token, tokenHash)
    assert.equal(hashToken(token), tokenHash)
    assert.notEqual(newSessionToken().token, token)
  })
})

describe('account input rules', () => {
  it('normalises and validates email', () => {
    assert.equal(normalizeEmail('  Shop@Example.COM '), 'shop@example.com')
    assert.equal(isValidEmail('shop@example.com'), true)
    for (const bad of ['', 'shop', 'shop@', '@example.com', 'a b@example.com', 'shop@example']) assert.equal(isValidEmail(bad), false, bad)
  })
  it('normalises Indian mobile numbers to 10 digits and rejects the rest', () => {
    for (const ok of ['9876543210', '+91 98765 43210', '098765-43210', '91 9876543210']) assert.equal(normalizeMobile(ok), '9876543210', ok)
    for (const bad of ['', '12345', '5876543210', '98765432101', 'abcdefghij']) assert.equal(normalizeMobile(bad), null, bad)
  })
  it('enforces a minimum password length', () => {
    assert.equal(passwordProblem(''), 'Please enter a password.')
    assert.match(passwordProblem('short')!, /at least 8/)
    assert.equal(passwordProblem('long-enough-1'), null)
  })
})

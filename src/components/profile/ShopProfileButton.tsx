import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { BUSINESS_NAME } from '../../data/mockData'
import { useAuth } from '../../context/AuthContext'
import { api, ApiRequestError, type ShopProfile } from '../../lib/api'
import { Button } from '../ui/Button'
import { StoreIcon } from '../ui/Icons'
import { Modal } from '../ui/Modal'

/**
 * Shop name as a profile trigger. Opens a small panel with the shop's details and a change-password
 * form. Nothing here touches the retail data.
 */

const MIN_PASSWORD = 8

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  )
}

function ChangePassword({ token }: { token: string }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (current === '') return setResult({ ok: false, message: 'Please enter your current password.' })
    if (next === '') return setResult({ ok: false, message: 'Please enter a new password.' })
    if (next.length < MIN_PASSWORD) return setResult({ ok: false, message: `New password must be at least ${MIN_PASSWORD} characters.` })
    if (confirm !== next) return setResult({ ok: false, message: 'Passwords do not match.' })
    setBusy(true)
    try {
      const r = await api.changePassword(token, { currentPassword: current, newPassword: next, confirmPassword: confirm })
      setResult({ ok: true, message: r.message })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiRequestError ? err.message : 'Could not change the password. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-slate-100'
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <div>
        <label htmlFor="pw-current" className="text-sm font-medium text-slate-700">
          Current password
        </label>
        <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} className={field} />
      </div>
      <div>
        <label htmlFor="pw-new" className="text-sm font-medium text-slate-700">
          New password
        </label>
        <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} disabled={busy} className={field} />
      </div>
      <div>
        <label htmlFor="pw-confirm" className="text-sm font-medium text-slate-700">
          Confirm new password
        </label>
        <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} className={field} />
      </div>
      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={`rounded-lg p-3 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {result.message}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  )
}

function EditProfile({ token, shop, onSaved, onCancel }: { token: string; shop: ShopProfile; onSaved: (shop: ShopProfile) => void; onCancel: () => void }) {
  const [name, setName] = useState(shop.name)
  // The placeholder text is not the owner's own words, so it is not pre-filled as if it were.
  const [description, setDescription] = useState(shop.descriptionIsPlaceholder ? '' : shop.description)
  const [phone, setPhone] = useState(shop.phone)
  const [location, setLocation] = useState(shop.location ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (name.trim() === '') return setError('Please enter the shop name.')
    if (phone.trim() === '') return setError('Please enter a phone number.')
    setBusy(true)
    setError(null)
    try {
      const r = await api.updateProfile(token, { name, description, phone, location })
      onSaved(r.shop)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the profile. Please try again.')
      setBusy(false)
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-slate-100'
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <div>
        <label htmlFor="shop-name" className="text-sm font-medium text-slate-700">
          Shop name
        </label>
        <input id="shop-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={100} className={field} />
      </div>
      <div>
        <label htmlFor="shop-description" className="text-sm font-medium text-slate-700">
          Description
        </label>
        <textarea id="shop-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} maxLength={500} className={field} />
      </div>
      <div>
        <label htmlFor="shop-phone" className="text-sm font-medium text-slate-700">
          Phone number
        </label>
        <input id="shop-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} className={field} />
      </div>
      <div>
        <label htmlFor="shop-location" className="text-sm font-medium text-slate-700">
          Location
        </label>
        <input id="shop-location" value={location} onChange={(e) => setLocation(e.target.value)} disabled={busy} maxLength={200} className={field} />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ProfilePanel() {
  const { token, account, shop, setShop, signOut } = useAuth()
  const [changing, setChanging] = useState(false)
  const [editing, setEditing] = useState(false)

  if (!shop || !token || !account) return <p className="py-6 text-center text-sm text-slate-500">Loading…</p>

  if (editing) {
    return (
      <EditProfile
        token={token}
        shop={shop}
        onSaved={(s) => {
          setShop(s)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <dl className="divide-y divide-slate-100">
        <Detail label="Shop name">{shop.name}</Detail>
        <Detail label="Description">
          {shop.description}
          {shop.descriptionIsPlaceholder && <span className="mt-0.5 block text-xs text-slate-400">General description; the shop&apos;s own text has not been added yet.</span>}
        </Detail>
        <Detail label="Phone number">{shop.phone}</Detail>
        <Detail label="Location">{shop.location ?? <span className="text-slate-500">Not added yet</span>}</Detail>
        <Detail label="Signed in as">{account.email}</Detail>
      </dl>

      <div className="border-t border-slate-100 pt-4">
        {changing ? (
          <>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Change password</h3>
            <ChangePassword token={token} />
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>Edit profile</Button>
            <Button variant="secondary" onClick={() => setChanging(true)}>
              Change password
            </Button>
            <Button variant="secondary" onClick={signOut}>
              Sign out
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function ShopProfileButton({ variant }: { variant: 'sidebar' | 'mobile' }) {
  const [open, setOpen] = useState(false)
  const { shop } = useAuth()
  // Until the saved profile loads, the default name is shown.
  const shopName = shop?.name ?? BUSINESS_NAME

  const chevron = (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 8 5 5 5-5" />
    </svg>
  )

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-200">
            <StoreIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] uppercase tracking-wide text-slate-500">Shop profile</span>
            <span className="block text-sm font-medium leading-snug text-white">{shopName}</span>
          </span>
          <span className="text-slate-400">{chevron}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-300 hover:text-white"
        >
          <StoreIcon className="h-4 w-4" />
          <span className="max-w-[9rem] truncate">{shopName}</span>
          {chevron}
        </button>
      )}

      {/* Portaled to <body>: the sidebar is its own stacking context, and the page would otherwise paint over the dialog. */}
      {createPortal(
        <Modal title="Shop profile" isOpen={open} onClose={() => setOpen(false)}>
          <ProfilePanel />
        </Modal>,
        document.body,
      )}
    </>
  )
}

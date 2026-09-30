import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { LogoMark } from '../components/ui/Icons'
import { useAuth } from '../context/AuthContext'
import { api, ApiRequestError, type AccountInfo } from '../lib/api'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE = /^(\+?91)?[6-9]\d{9}$/
const MIN_PASSWORD = 8

/** Timings (ms) of the success transition, which starts only after the server has accepted the sign-in. Total is about 4.8 s. */
const CARD_OUT = 350
const SECOND_MESSAGE_AT = 1650
/** Last stage: the tiles circle the cart and are drawn into it (the circle lasts 0.8 s, then each tile enters the cart 0.15 s after the previous one). */
const ORBIT_AT = 3300
const ORBIT_MS = 2100
const NAVIGATE_AT = ORBIT_AT + ORBIT_MS + 100

/** Grocery tiles around the cart, as percentages of the stage. */
const TILES: { icon: string; label: string; left: string; top: string; delay: number; angle: number; radius: number }[] = [
  { icon: '🍎', label: 'apple', left: '18%', top: '16%', delay: 0.05, angle: -133, radius: 47 },
  { icon: '🥕', label: 'carrot', left: '50%', top: '6%', delay: 0.15, angle: -90, radius: 44 },
  { icon: '🥦', label: 'broccoli', left: '82%', top: '16%', delay: 0.25, angle: -47, radius: 47 },
  { icon: '🍅', label: 'tomato', left: '14%', top: '76%', delay: 0.2, angle: 144, radius: 44 },
  { icon: '🍊', label: 'orange', left: '50%', top: '90%', delay: 0.1, angle: 90, radius: 40 },
  { icon: '📦', label: 'box', left: '86%', top: '76%', delay: 0.3, angle: 36, radius: 44 },
]

type Phase = 'form' | 'leaving' | 'stage'
type Mode = 'signin' | 'signup'
type Errors = { email?: string; mobile?: string; password?: string; confirm?: string; form?: string }

export function Login() {
  const { status, signIn } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [created, setCreated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState<Phase>('form')
  const [secondMessage, setSecondMessage] = useState(false)
  const [orbit, setOrbit] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const pending = timers
    return () => pending.current.forEach(window.clearTimeout)
  }, [])

  // Already signed in (and not in the middle of the transition): go straight to the app.
  if (status === 'signedIn' && phase === 'form') return <Navigate to="/" replace />

  const busy = submitting || phase !== 'form'

  function switchMode(next: Mode) {
    if (busy) return
    setMode(next)
    setErrors({})
    setCreated(false)
    setPassword('')
    setConfirm('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return

    const next: Errors = {}
    if (!EMAIL.test(email.trim())) next.email = email.trim() === '' ? 'Please enter your email address.' : 'Please enter a valid email address.'
    if (mode === 'signup') {
      if (mobile.trim() === '') next.mobile = 'Please enter your mobile number.'
      else if (!MOBILE.test(mobile.replace(/[\s-]/g, ''))) next.mobile = 'Please enter a valid 10-digit mobile number.'
      if (password === '') next.password = 'Please enter a password.'
      else if (password.length < MIN_PASSWORD) next.password = `Password must be at least ${MIN_PASSWORD} characters.`
      else if (confirm !== password) next.confirm = 'Passwords do not match.'
    } else if (password === '') next.password = 'Please enter your password.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      if (mode === 'signup') {
        await api.register({ email: email.trim(), mobile: mobile.trim(), password, confirmPassword: confirm })
        setCreated(true)
        setPassword('')
        setConfirm('')
      } else {
        const session = await api.login({ email: email.trim(), password })
        startTransition(session.token, session.account)
      }
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.'
      // Put a field-specific server message next to its field, anything else in the card.
      if (/mobile number already/i.test(message)) setErrors({ mobile: message })
      else if (/email already/i.test(message)) setErrors({ email: message })
      else setErrors({ form: message })
    } finally {
      setSubmitting(false)
    }
  }

  /** The server accepted the sign-in: play the transition, and only then create the session and open the app. */
  function startTransition(token: string, account: AccountInfo) {
    setPhase('leaving')
    const at = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))
    at(() => setPhase('stage'), CARD_OUT)
    at(() => setSecondMessage(true), SECOND_MESSAGE_AT)
    at(() => setOrbit(true), ORBIT_AT)
    at(() => {
      signIn(token, account)
      navigate('/', { replace: true })
    }, NAVIGATE_AT)
  }

  const input = (bad?: string) =>
    `mt-1.5 w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-slate-100 ${
      bad ? 'border-red-400' : 'border-slate-300'
    }`

  const fieldError = (id: string, message?: string) =>
    message && (
      <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-red-600">
        {message}
      </p>
    )

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => switchMode(m)}
      disabled={busy}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
    </button>
  )

  return (
    <div
      className="flex min-h-screen items-center justify-center overflow-hidden bg-slate-900 bg-cover bg-center bg-no-repeat px-4 py-10"
      // A light dark layer over the same image keeps the card and the animation in front.
      style={{ backgroundImage: "linear-gradient(rgba(15, 23, 42, 0.4), rgba(15, 23, 42, 0.4)), url(/login-bg.png)" }}
    >
      {phase !== 'stage' && (
        <main className={`w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl shadow-black/30 sm:p-9 ${phase === 'leaving' ? 'sb-card-out' : ''}`}>
          <div className="flex items-center justify-center gap-2.5">
            <LogoMark className="h-9 w-9" />
            <span className="font-display text-xl font-semibold text-slate-900">SmallBiz Lens</span>
          </div>

          <div className="mt-6 text-center">
            <h1 className="font-display text-2xl font-semibold text-slate-900">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
            <p className="mt-1 text-sm text-slate-500">{mode === 'signin' ? 'Sign in to your store.' : 'Set up sign-in for your store.'}</p>
          </div>

          <div role="tablist" aria-label="Sign in or create account" className="mt-6 flex rounded-lg bg-slate-100 p-1">
            {tab('signin', 'Sign in')}
            {tab('signup', 'Create account')}
          </div>

          {created ? (
            <div role="status" className="mt-7 space-y-4 text-center">
              <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">Your account has been created. You can now sign in.</p>
              <button
                type="button"
                onClick={() => {
                  setMode('signin')
                  setCreated(false)
                }}
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Continue to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)} noValidate className="mt-6 space-y-5" aria-busy={busy}>
              {errors.form && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {errors.form}
                </p>
              )}

              <div>
                <label htmlFor="email" className="text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  disabled={busy}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  className={input(errors.email)}
                />
                {fieldError('email', errors.email)}
              </div>

              {mode === 'signup' && (
                <div>
                  <label htmlFor="mobile" className="text-sm font-medium text-slate-700">
                    Mobile Number
                  </label>
                  <input
                    id="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="Enter your mobile number"
                    disabled={busy}
                    aria-invalid={Boolean(errors.mobile)}
                    aria-describedby={errors.mobile ? 'mobile-error' : undefined}
                    className={input(errors.mobile)}
                  />
                  {fieldError('mobile', errors.mobile)}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-slate-700">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signin' ? 'Enter your password' : `At least ${MIN_PASSWORD} characters`}
                    disabled={busy}
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    className={`${input(errors.password)} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={busy}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:opacity-60"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {showPassword ? (
                        <>
                          <path d="M3 3l18 18" />
                          <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12.7 12.7 0 0 1-2.6 3.3M6.6 6.7A12.6 12.6 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.4 4-.9" />
                          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                        </>
                      ) : (
                        <>
                          <path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6Z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
                {fieldError('password', errors.password)}
              </div>

              {mode === 'signup' && (
                <div>
                  <label htmlFor="confirm" className="text-sm font-medium text-slate-700">
                    Confirm password
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Enter your password again"
                    disabled={busy}
                    aria-invalid={Boolean(errors.confirm)}
                    aria-describedby={errors.confirm ? 'confirm-error' : undefined}
                    className={input(errors.confirm)}
                  />
                  {fieldError('confirm', errors.confirm)}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {busy ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          )}
        </main>
      )}

      {phase === 'stage' && (
        <div role="status" aria-live="polite" className="flex w-full flex-col items-center text-center">
          <div className="relative h-[min(64vw,15rem)] w-[min(64vw,15rem)]" aria-hidden="true">
            {orbit ? (
              <div className="sb-orbit-spin absolute inset-0">
                {TILES.map((t, i) => (
                  <span key={t.label} className="absolute left-1/2 top-1/2 h-0 w-0" style={{ transform: `rotate(${t.angle}deg)` }}>
                    <span
                      className="sb-orbit-absorb absolute left-0 top-0 block h-0 w-0"
                      style={{ '--r': `calc(min(64vw, 15rem) * ${t.radius / 100})`, '--d': `${0.8 + i * 0.15}s` } as React.CSSProperties}
                    >
                      <span className="absolute -translate-x-1/2 -translate-y-1/2">
                        <span className="sb-orbit-upright block" style={{ '--a': `${t.angle}deg` } as React.CSSProperties}>
                          <span className="flex h-[clamp(2.75rem,12vw,3.75rem)] w-[clamp(2.75rem,12vw,3.75rem)] items-center justify-center rounded-2xl bg-white/10 text-[clamp(1.5rem,7vw,2.1rem)] ring-1 ring-white/15">{t.icon}</span>
                        </span>
                      </span>
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <>
            {TILES.map((t) => (
              <span key={t.label} className="sb-pop-in absolute -translate-x-1/2 -translate-y-1/2" style={{ left: t.left, top: t.top, animationDelay: `${t.delay}s` }}>
                <span
                  className="sb-bounce flex h-[clamp(2.75rem,12vw,3.75rem)] w-[clamp(2.75rem,12vw,3.75rem)] items-center justify-center rounded-2xl bg-white/10 text-[clamp(1.5rem,7vw,2.1rem)] ring-1 ring-white/15"
                  style={{ animationDelay: `${t.delay + 0.3}s` }}
                >
                  {t.icon}
                </span>
              </span>
            ))}
              </>
            )}
            <span className="sb-pop-in absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ animationDelay: '0s' }}>
              <span className={`${orbit ? 'sb-cart-pulse' : 'sb-bounce'} flex h-[clamp(3.5rem,15vw,4.75rem)] w-[clamp(3.5rem,15vw,4.75rem)] items-center justify-center rounded-full bg-accent text-[clamp(1.9rem,9vw,2.6rem)] shadow-lg shadow-black/30`}>
                🛒
              </span>
            </span>
          </div>

          <p key={secondMessage ? 'second' : 'first'} className="sb-fade-in mt-8 max-w-xs px-2 text-base text-slate-100 sm:max-w-sm sm:text-lg">
            {secondMessage ? "Sit tight, we're getting your store ready." : 'Logging you in...'}
          </p>
        </div>
      )}
    </div>
  )
}

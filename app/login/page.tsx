'use client'
// SIGN IN.
//
// 2026-08-20 — rebuilt after Jon was locked out. Three things were wrong:
//
//  1. THE MAGIC LINK HUNG FOREVER. Supabase answers /auth/v1/otp with a 503 when it cannot send
//     the mail, and it can sit there for a long time first. The button stayed on "…" and the user
//     was told nothing at all. Every auth call is now raced against a timeout and every failure
//     produces a sentence a human can act on — see friendlyAuthError().
//  2. PHONE SIGN-IN WAS QUIETLY BROKEN. The inputs carried no autoComplete, so iOS and Android
//     never offered the saved password, and the email field had autocorrect and auto-capitalise
//     on — a phone keyboard will happily turn an address into "Jon@Stay-Hospitality.com" or
//     autocorrect it outright. Fixed with the standard attributes; autoFocus is off on the first
//     field so the keyboard does not jump the layout on arrival.
//  3. THERE WAS NO WAY BACK IN without email. Password is now the default tab and a password
//     reset exists.
//
// NOTE ON EMAIL: this project sends auth mail through Supabase's BUILT-IN service, which is
// documented as testing-only — 2 messages per hour, and it refuses any address that is not a
// member of the Supabase organisation. Until custom SMTP is enabled in the Supabase dashboard,
// magic links and password resets cannot be relied on. The copy below says so rather than
// pretending otherwise.
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { Mail, Lock, ArrowRight, AlertTriangle } from 'lucide-react'

type Mode = 'password' | 'magic'

const TIMEOUT_MS = 20000

/** Never let an auth call hang the button. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('__timeout__')), ms)),
  ])
}

/** Supabase's auth errors are written for developers. These are written for whoever is locked out. */
function friendlyAuthError(e: any): string {
  const raw = String((e && e.message) || e || '')
  if (raw === '__timeout__') {
    return 'That took too long and never came back — the email service is not responding. Sign in with your password instead.'
  }
  if (/not authorized/i.test(raw)) {
    return 'The email service will not deliver to that address yet. Sign in with your password, or ask for custom SMTP to be switched on in Supabase.'
  }
  if (/error sending|unexpected_failure|503/i.test(raw)) {
    return 'We could not send the email — the mail service rejected it. Sign in with your password instead.'
  }
  if (/rate limit|only request this after|too many/i.test(raw)) {
    return 'Too many link requests. The built-in email service allows only a couple an hour — wait, or sign in with your password.'
  }
  if (/signups not allowed/i.test(raw)) {
    return 'No account exists for that email address. Check the spelling, or ask an admin to add you.'
  }
  if (/invalid login credentials/i.test(raw)) {
    return 'That email and password do not match. If you have never set a password, use the magic link once and it will ask you to create one.'
  }
  if (/email not confirmed/i.test(raw)) {
    return 'That account has not been confirmed yet. Ask an admin to confirm it in Supabase.'
  }
  return raw || 'Something went wrong. Try again.'
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode]     = useState<Mode>('password')
  const [email, setEmail]   = useState('')
  const [pw, setPw]         = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]     = useState(false)
  const [reset, setReset]   = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setErr(null)
    const supabase = createClient()
    try {
      if (mode === 'password') {
        const { error } = await withTimeout(supabase.auth.signInWithPassword({ email: email.trim(), password: pw }), TIMEOUT_MS)
        if (error) throw error
        router.push('/'); router.refresh()
      } else {
        const { error } = await withTimeout(supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: false },
        }), TIMEOUT_MS)
        if (error) throw error
        setSent(true)
      }
    } catch (e: any) {
      setErr(friendlyAuthError(e))
    } finally {
      setLoading(false)
    }
  }

  async function sendReset() {
    if (!email.trim()) { setErr('Type your email address first.'); return }
    setLoading(true); setErr(null)
    try {
      const supabase = createClient()
      const { error } = await withTimeout(supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/welcome/password`,
      }), TIMEOUT_MS)
      if (error) throw error
      setReset(true)
    } catch (e: any) {
      setErr(friendlyAuthError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-app flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Brand */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white border border-line shadow-soft">
            <img src="/icon-192.png" alt="Lighthouse" className="w-7 h-7 rounded-lg" />
            <span className="font-bold tracking-tight text-ink">LIGHTHOUSE</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lifted border border-line p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-ink tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">Sign in to Stay Hospitality operations.</p>

          {sent || reset ? (
            <div className="mt-6">
              <p className="text-sm text-ink">
                {reset ? <>Password reset sent to <strong>{email}</strong>.</> : <>Check <strong>{email}</strong> for the sign-in link.</>}
              </p>
              <p className="mt-2 text-[12.5px] text-muted">
                Nothing after a minute or two? The mail service on this project is the built-in
                Supabase one, which only sends a couple of messages an hour. Use your password instead.
              </p>
              <button onClick={() => { setSent(false); setReset(false); setMode('password') }}
                className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium">&larr; Back to sign in</button>
            </div>
          ) : (
            <>
              <div className="mt-5 inline-flex p-0.5 rounded-lg bg-app">
                <button type="button" onClick={() => { setMode('password'); setErr(null) }} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${mode === 'password' ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'}`}>Password</button>
                <button type="button" onClick={() => { setMode('magic'); setErr(null) }} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${mode === 'magic' ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'}`}>Magic link</button>
              </div>

              <form onSubmit={submit} className="mt-5 space-y-3">
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
                  {/* autoComplete + autoCapitalize/autoCorrect are what make this work on a phone:
                      without them iOS never offers the saved login and helpfully capitalises the
                      first letter of the address. */}
                  <input
                    type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    name="email" autoComplete="email" inputMode="email"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    placeholder="you@stay-hospitality.com"
                    className="w-full pl-10 pr-3 py-3 rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white text-base sm:text-sm" />
                </div>
                {mode === 'password' && (
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
                    <input
                      type="password" required value={pw} onChange={e => setPw(e.target.value)}
                      name="password" autoComplete="current-password"
                      placeholder="Password"
                      className="w-full pl-10 pr-3 py-3 rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white text-base sm:text-sm" />
                  </div>
                )}
                {err && (
                  <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-[13px] border border-rose-200 flex gap-2">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                )}
                <button type="submit" disabled={loading || !email || (mode === 'password' && !pw)}
                  className="w-full inline-flex items-center justify-center gap-2 bg-ink text-white rounded-lg py-3 font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 text-sm shadow-sm">
                  {loading ? 'Working…' : mode === 'password' ? <>Sign in <ArrowRight size={14} /></> : <>Send magic link <ArrowRight size={14} /></>}
                </button>
              </form>

              {mode === 'password' && (
                <button type="button" onClick={sendReset} disabled={loading}
                  className="mt-3 text-xs text-muted hover:text-ink font-medium disabled:opacity-50">
                  Forgot your password?
                </button>
              )}

              <p className="mt-6 text-xs text-muted text-center">
                First time here? <Link href="/signup" className="text-brand-600 hover:text-brand-700 font-medium">Create an account</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'
// SET A PASSWORD — where a magic link drops you the first time (Jon, 2026-08-20).
//
// The reason this screen exists: auth mail on this project goes through Supabase's built-in
// service, which sends 2 messages an hour and refuses any address outside the Supabase org. A
// magic link is therefore a nice-to-have, not a way in. Everyone should own a password.
//
// Setting one stamps `password_set: true` into user_metadata, which /auth/callback reads — so this
// screen shows once and then never again. Skipping is allowed (nobody should be trapped on a form
// they did not ask for), and it will simply offer again next time.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { Lock, Check, AlertTriangle, ArrowRight } from 'lucide-react'

export default function SetPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [pw, setPw]   = useState('')
  const [pw2, setPw2] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data && data.user) setEmail(data.user.email || '')
    }).catch(() => {})
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (pw.length < 8)  { setErr('Use at least 8 characters.'); return }
    if (pw !== pw2)     { setErr('The two passwords do not match.'); return }
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: pw, data: { password_set: true } })
      if (error) throw error
      setDone(true)
      setTimeout(() => { router.push('/'); router.refresh() }, 1100)
    } catch (e: any) {
      setErr(String((e && e.message) || e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-app flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white border border-line shadow-soft">
            <img src="/icon-192.png" alt="Lighthouse" className="w-7 h-7 rounded-lg" />
            <span className="font-bold tracking-tight text-ink">LIGHTHOUSE</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lifted border border-line p-6 sm:p-8">
          {done ? (
            <div className="text-center py-4">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center mx-auto">
                <Check size={19} />
              </div>
              <p className="text-[15px] font-bold text-ink mt-3">Password set</p>
              <p className="text-[13px] text-muted mt-1">Taking you in&hellip;</p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-ink tracking-tight">Set a password</h1>
              <p className="mt-1.5 text-sm text-muted">
                You are signed in{email ? <> as <strong className="text-ink">{email}</strong></> : null}. Give yourself a
                password so you never have to wait on an email again &mdash; especially on your phone.
              </p>

              <form onSubmit={submit} className="mt-5 space-y-3">
                {/* A hidden username field is what tells a password manager which login this
                    password belongs to. Without it iOS saves it against nothing useful. */}
                <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
                  <input type="password" required value={pw} onChange={e => setPw(e.target.value)}
                    name="new-password" autoComplete="new-password" placeholder="New password (8+ characters)"
                    className="w-full pl-10 pr-3 py-3 rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white text-base sm:text-sm" />
                </div>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
                  <input type="password" required value={pw2} onChange={e => setPw2(e.target.value)}
                    name="confirm-password" autoComplete="new-password" placeholder="Type it again"
                    className="w-full pl-10 pr-3 py-3 rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white text-base sm:text-sm" />
                </div>
                {err && (
                  <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-[13px] border border-rose-200 flex gap-2">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                )}
                <button type="submit" disabled={loading || !pw || !pw2}
                  className="w-full inline-flex items-center justify-center gap-2 bg-ink text-white rounded-lg py-3 font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 text-sm shadow-sm">
                  {loading ? 'Saving…' : <>Save password <ArrowRight size={14} /></>}
                </button>
              </form>

              <button type="button" onClick={() => router.push('/')}
                className="mt-4 text-xs text-muted hover:text-ink font-medium w-full text-center">
                Skip for now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

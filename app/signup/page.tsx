'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail]   = useState('')
  const [pw, setPw]         = useState('')
  const [pw2, setPw2]       = useState('')
  const [loading, setLoading] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (pw !== pw2)    { setErr('Passwords do not match.');                  return }
    if (!email.toLowerCase().endsWith('@stay-hospitality.com')) {
      setErr('Use your @stay-hospitality.com email.'); return
    }
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signUp({
        email,
        password: pw,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
      })
      if (error) throw error

      // If Supabase requires email confirmation, session will be null
      if (!data.session) {
        setNeedsConfirm(true)
      } else {
        router.push('/reservations')
        router.refresh()
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 border border-slate-200">
        <h1 className="text-3xl font-bold text-slate-900">Create account</h1>
        <p className="mt-2 text-sm text-slate-500">Stay Hospitality emails only.</p>

        {needsConfirm ? (
          <>
            <p className="mt-5 text-sm text-slate-700">
              We sent a confirmation link to <strong>{email}</strong>. Click it, then come back and sign in.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-block text-sm text-brand-600 hover:underline font-medium"
            >← Back to sign in</Link>
          </>
        ) : (
          <>
            <form onSubmit={submit} className="mt-6 space-y-3">
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@stay-hospitality.com"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition"
              />
              <input
                type="password"
                required
                value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder="Password (min 8 chars)"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition"
              />
              <input
                type="password"
                required
                value={pw2}
                onChange={e => setPw2(e.target.value)}
                placeholder="Confirm password"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition"
              />
              {err && <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm">{err}</div>}
              <button
                type="submit"
                disabled={loading || !email || !pw || !pw2}
                className="w-full bg-slate-900 text-white rounded-lg py-2.5 font-medium hover:bg-slate-800 transition disabled:opacity-50"
              >
                {loading ? 'Creating…' : 'Create account'}
              </button>
            </form>
            <p className="mt-5 text-xs text-slate-500 text-center">
              Already have an account?{' '}
              <Link href="/login" className="text-brand-600 hover:underline font-medium">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

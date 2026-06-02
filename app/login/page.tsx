'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

type Mode = 'password' | 'magic'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode]     = useState<Mode>('password')
  const [email, setEmail]   = useState('')
  const [pw, setPw]         = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]     = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setErr(null)
    const supabase = createClient()
    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
        if (error) throw error
        router.push('/reservations')
        router.refresh()
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
        })
        if (error) throw error
        setSent(true)
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
        <h1 className="text-3xl font-bold text-slate-900">STAYBOARD</h1>
        <p className="mt-2 text-sm text-slate-500">Sign in to Stay Hospitality.</p>

        {sent ? (
          <>
            <p className="mt-4 text-sm text-slate-700">Check <strong>{email}</strong> for the sign-in link.</p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="mt-4 text-sm text-slate-500 hover:text-slate-900"
            >
              ← Use a different email
            </button>
          </>
        ) : (
          <>
            <div className="mt-6 inline-flex p-1 rounded-lg bg-slate-100">
              <button
                onClick={() => setMode('password')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  mode === 'password' ? 'bg-white shadow text-slate-900' : 'text-slate-500'
                }`}
              >Password</button>
              <button
                onClick={() => setMode('magic')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  mode === 'magic' ? 'bg-white shadow text-slate-900' : 'text-slate-500'
                }`}
              >Magic link</button>
            </div>

            <form onSubmit={submit} className="mt-4 space-y-3">
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@stay-hospitality.com"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition"
              />
              {mode === 'password' && (
                <input
                  type="password"
                  required
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  placeholder="Password"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition"
                />
              )}
              {err && <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm">{err}</div>}
              <button
                type="submit"
                disabled={loading || !email || (mode === 'password' && !pw)}
                className="w-full bg-slate-900 text-white rounded-lg py-2.5 font-medium hover:bg-slate-800 transition disabled:opacity-50"
              >
                {loading ? '…' : mode === 'password' ? 'Sign in' : 'Send magic link'}
              </button>
            </form>

            <p className="mt-5 text-xs text-slate-500 text-center">
              First time here?{' '}
              <Link href="/signup" className="text-brand-600 hover:underline font-medium">Create an account</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

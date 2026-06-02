'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setErr(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
      })
      if (error) throw error
      setSent(true)
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
        <p className="mt-2 text-sm text-slate-500">
          {sent
            ? `Check ${email} for the sign-in link.`
            : 'Enter your Stay Hospitality email to receive a sign-in link.'}
        </p>
        {!sent && (
          <form onSubmit={sendMagicLink} className="mt-6 space-y-3">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@stay-hospitality.com"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition"
            />
            {err && <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm">{err}</div>}
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-slate-900 text-white rounded-lg py-2.5 font-medium hover:bg-slate-800 transition disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
        {sent && (
          <button
            onClick={() => { setSent(false); setEmail('') }}
            className="mt-6 text-sm text-slate-500 hover:text-slate-900"
          >
            ← Use a different email
          </button>
        )}
      </div>
    </div>
  )
}

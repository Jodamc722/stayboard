'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { Mail, Lock, ArrowRight } from 'lucide-react'

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
        router.push('/'); router.refresh()
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
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
    <div className="min-h-screen bg-app flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Brand */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white border border-line shadow-soft">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xs">S</div>
            <span className="font-bold tracking-tight text-ink">STAYBOARD</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lifted border border-line p-8">
          <h1 className="text-2xl font-bold text-ink tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">Sign in to Stay Hospitality operations.</p>

          {sent ? (
            <div className="mt-6">
              <p className="text-sm text-ink">Check <strong>{email}</strong> for the sign-in link.</p>
              <button onClick={() => { setSent(false); setEmail('') }} className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium">← Use a different email</button>
            </div>
          ) : (
            <>
              <div className="mt-5 inline-flex p-0.5 rounded-lg bg-app">
                <button onClick={() => setMode('password')} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${mode === 'password' ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'}`}>Password</button>
                <button onClick={() => setMode('magic')} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${mode === 'magic' ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'}`}>Magic link</button>
              </div>

              <form onSubmit={submit} className="mt-5 space-y-3">
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
                  <input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="you@stay-hospitality.com"
                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white text-sm" />
                </div>
                {mode === 'password' && (
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
                    <input type="password" required value={pw} onChange={e => setPw(e.target.value)} placeholder="Password"
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white text-sm" />
                  </div>
                )}
                {err && <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm border border-rose-200">{err}</div>}
                <button type="submit" disabled={loading || !email || (mode === 'password' && !pw)}
                  className="w-full inline-flex items-center justify-center gap-2 bg-ink text-white rounded-lg py-2.5 font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 text-sm shadow-sm">
                  {loading ? '…' : mode === 'password' ? <>Sign in <ArrowRight size={14} /></> : <>Send magic link <ArrowRight size={14} /></>}
                </button>
              </form>

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

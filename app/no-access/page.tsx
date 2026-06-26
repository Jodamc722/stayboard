'use client'
import { createClient } from '@/lib/supabase-browser'
import { ShieldAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function NoAccess() {
  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-app px-4">
      <div className="max-w-md w-full rounded-2xl border border-line bg-white p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mb-3"><ShieldAlert size={22} /></div>
        <h1 className="text-lg font-bold text-ink">Access not enabled</h1>
        <p className="text-sm text-muted mt-2">Your account isn&apos;t on the StayBoard access list yet, or it has been disabled. Please ask an admin to grant you access.</p>
        <button onClick={signOut} className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-600 text-white px-4 py-2 text-sm font-semibold hover:bg-brand-700">Sign out</button>
      </div>
    </div>
  )
}

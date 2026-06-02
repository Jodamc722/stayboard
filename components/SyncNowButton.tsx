'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function SyncNowButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function run() {
    setErr(null); setMsg('Syncing…')
    try {
      const r = await fetch('/api/sync/guesty', { method: 'POST' })
      const d = await r.json()
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setMsg(`Synced ${d.reservations} reservations, ${d.listings} listings, ${d.conversations} threads in ${Math.round(d.elapsed_ms / 100) / 10}s`)
      startTransition(() => router.refresh())
    } catch (e: any) {
      setErr(e.message || String(e))
      setMsg(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && !err && <span className="text-xs text-slate-500">{msg}</span>}
      {err && <span className="text-xs text-rose-600">{err}</span>}
      <button
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition"
      >
        {pending ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  )
}

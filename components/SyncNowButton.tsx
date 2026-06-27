'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Check, AlertCircle } from 'lucide-react'

export function SyncNowButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<'idle' | 'syncing' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  async function run() {
    if (state === 'syncing') return
    setState('syncing'); setMsg(null)
    try {
      const r = await fetch('/api/sync/guesty', { method: 'POST' })
      // Read as text first: a long full sync can exceed the serverless time limit and return a
      // plain-text gateway error (not JSON), which would otherwise throw a cryptic parse error.
      const text = await r.text()
      let d: any = null
      try { d = text ? JSON.parse(text) : null } catch { /* non-JSON (timeout / gateway error) */ }
      if (!d) {
        setState('err')
        if (r.status === 504 || /timeout|timed out|an error occurred/i.test(text)) {
          setMsg('Sync is taking a while — it may still be finishing in the background. Refresh in a moment.')
        } else {
          setMsg(`Sync failed (HTTP ${r.status}).`)
        }
        startTransition(() => router.refresh())
        setTimeout(() => setState('idle'), 6000)
        return
      }
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setState('ok')
      setMsg(`${d.reservations} res · ${d.listings} props · ${d.conversations} threads`)
      startTransition(() => router.refresh())
      setTimeout(() => setState('idle'), 3500)
    } catch (e: any) {
      setState('err')
      setMsg(e.message || 'Sync failed')
      setTimeout(() => setState('idle'), 5000)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={`text-xs ${state === 'err' ? 'text-rose-600' : 'text-muted'} animate-fade-in`}>{msg}</span>
      )}
      <button
        onClick={run}
        disabled={state === 'syncing' || pending}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all shadow-sm
          ${state === 'ok'  ? 'bg-emerald-600 text-white' :
            state === 'err' ? 'bg-rose-600 text-white' :
            'bg-ink text-white hover:bg-ink/90 disabled:opacity-60'}`}
      >
        {state === 'syncing' ? <><RefreshCw size={13} className="animate-spin" /> Syncing</>
         : state === 'ok'   ? <><Check size={13} /> Synced</>
         : state === 'err'  ? <><AlertCircle size={13} /> Failed</>
         :                    <><RefreshCw size={13} /> Sync now</>}
      </button>
    </div>
  )
}

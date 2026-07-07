'use client'
import { useState } from 'react'
import { UploadCloud, Loader2, Check, AlertTriangle } from 'lucide-react'

// Pushes every guidebook's guest link into the Guesty "Guidebook" custom field.
export function PushGuestyButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function push() {
    if (busy) return
    setBusy(true); setMsg(''); setErr('')
    try {
      const r = await fetch('/api/guidebook/push-guesty', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ all: true }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Push failed')
      setMsg('Pushed ' + (d.pushed ?? 0) + ' of ' + (d.total ?? 0) + ' to Guesty')
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={push} disabled={busy} title="Write each guidebook's guest link into the Guesty Guidebook custom field" className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg border border-neutral-200 bg-white text-ink px-3.5 py-2 hover:bg-app disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
        {busy ? 'Pushing…' : 'Push links to Guesty'}
      </button>
      {msg && <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><Check size={13} />{msg}</span>}
      {err && <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600"><AlertTriangle size={13} />{err}</span>}
    </span>
  )
}

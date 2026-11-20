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
    // CLEAN-UP (Jon, 2026-11-20; his rule: nothing is written to Guesty without a person confirming).
    // One click used to write the guest link of EVERY written guidebook, drafts included, into Guesty.
    // The two buttons beside it already asked first.
    if (!window.confirm('Write the guest link of EVERY guidebook into Guesty\u2019s Guidebook field, one per listing? This includes drafts nobody has approved yet. To push one book, approve it in Review instead.')) return
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
      <button type="button" onClick={push} disabled={busy} title="Write each guidebook's guest link into the Guesty Guidebook custom field" className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-neutral-200 bg-white text-ink px-2.5 py-1 hover:bg-app disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
        {busy ? 'Pushing…' : 'Push all to Guesty'}
      </button>
      {msg && <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-green-700"><Check size={13} />{msg}</span>}
      {err && <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-rose-600"><AlertTriangle size={13} />{err}</span>}
    </span>
  )
}

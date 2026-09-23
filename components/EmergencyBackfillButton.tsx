'use client'
// "Refresh emergency info" — runs the backfill across every guidebook.
//
// The emergency block is written into new books automatically; this is the button for the books
// that already exist, and for the day a hospital's number changes in lib/emergency.ts. It reports
// what it did, and — more usefully — names any book it could NOT place, because that is a book
// whose listing has no coordinates and no city we recognise, and somebody has to go fix the
// listing rather than the guidebook.
import { useState } from 'react'
import { LifeBuoy, Loader2 } from 'lucide-react'

export function EmergencyBackfillButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [bad, setBad] = useState<string[]>([])

  async function run() {
    if (busy) return
    if (!window.confirm('Write 911, the local police non-emergency line and the nearest emergency room into EVERY guidebook? This overwrites the emergency block in each one and leaves every other page alone.')) return
    setBusy(true); setMsg(null); setBad([])
    try {
      const r = await fetch('/api/guidebook/emergency', { method: 'POST' })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Could not update the guidebooks.')
      setMsg(j.updated + ' of ' + j.books + ' guidebooks updated' + (j.needsAttention ? ' · ' + j.needsAttention + ' could not be placed' : ''))
      setBad((j.results || []).filter((x: any) => !x.ok).map((x: any) => String(x.book || x.id) + (x.note ? ' — ' + x.note : '')))
    } catch (e: any) { setMsg(e?.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={run} disabled={busy} title="Write 911, the police non-emergency number and the nearest 24-hour emergency room into every guidebook"
        className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-line bg-white text-ink px-2.5 py-1 hover:bg-app disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <LifeBuoy size={13} />} Refresh emergency info
      </button>
      {msg && <span className="text-[12px] font-semibold text-ink">{msg}</span>}
      {bad.length > 0 && (
        <div className="w-full text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <b>Needs a look</b> — the listing has no address we can place, so no hospital was written: {bad.join(' · ')}
        </div>
      )}
    </>
  )
}

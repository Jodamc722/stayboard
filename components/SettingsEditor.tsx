'use client'
// BOOKING SETTINGS YOU CAN CHANGE HERE (2026-10-30 audit: the settings gaps on the unit page were a
// dead end — read-only rows, and "Settings →" links that went nowhere). Min nights and check-in /
// check-out now save straight to Guesty through the same route the building's bulk panel uses
// (/api/bulk-policies with this one listing). Cancellation policy and Instant Book cannot be set
// through Guesty's API, so those rows say where to change them instead of pretending.
import { useState } from 'react'
import { Ban, CalendarClock, Zap, Check, Loader2, Pencil } from 'lucide-react'

type Meta = { cancel: { label: string; tier: string }; minN: any; maxN: any; instant: boolean; instantRaw: any; checkIn: string; checkOut: string }

const toneCls = (t: 'good' | 'bad' | 'muted') => t === 'good' ? 'text-emerald-700' : t === 'bad' ? 'text-rose-700' : 'text-ink'

export function SettingsEditor({ listingId, meta }: { listingId: string; meta: Meta }) {
  const [edit, setEdit] = useState(false)
  const [minN, setMinN] = useState(meta.minN != null ? String(meta.minN) : '')
  const [ci, setCi] = useState(meta.checkIn || '')
  const [co, setCo] = useState(meta.checkOut || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save() {
    const policy: any = {}
    if (minN && Number(minN) !== Number(meta.minN)) policy.minNights = Number(minN)
    if (ci && ci !== meta.checkIn) policy.checkInTime = ci
    if (co && co !== meta.checkOut) policy.checkOutTime = co
    if (!Object.keys(policy).length) { setEdit(false); return }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/bulk-policies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingIds: [listingId], policy }) })
      const j = await r.json().catch(() => ({}))
      const res = Array.isArray(j?.results) ? j.results[0] : null
      if (!r.ok || j?.error || (res && res.ok === false)) throw new Error(j?.error || res?.error || 'Guesty did not take it')
      setMsg({ ok: true, text: 'Saved to Guesty — the score updates in a moment.' }); setEdit(false)
      try { window.dispatchEvent(new CustomEvent('stay:score-refresh')) } catch { /* no-op */ }
    } catch (e: any) { setMsg({ ok: false, text: String(e?.message || e) }) } finally { setBusy(false) }
  }

  const row = (Icon: any, label: string, value: React.ReactNode, tone: 'good' | 'bad' | 'muted', hint?: string) => (
    <div className="flex items-center gap-2 px-3 py-2">
      <Icon size={13} className="text-muted shrink-0" />
      <dt className="text-muted w-28 shrink-0">{label}</dt>
      <dd className={'font-semibold flex-1 ' + toneCls(tone)}>{value}</dd>
      {hint && <span className="text-[10.5px] text-muted text-right">{hint}</span>}
    </div>
  )
  const inp = 'h-7 rounded-md border border-line px-2 text-[12.5px] w-24'
  return (
    <div id="settings-panel" className="rounded-2xl border border-line bg-white overflow-hidden scroll-mt-20">
      <div className="px-3 py-2 bg-app border-b border-line flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex-1">Booking settings</span>
        {!edit
          ? <button onClick={() => { setEdit(true); setMsg(null) }} className="text-[11.5px] font-semibold inline-flex items-center gap-1 text-brand-700 hover:text-brand-800"><Pencil size={11} /> Edit</button>
          : <span className="inline-flex items-center gap-2">
              <button onClick={save} disabled={busy} className="text-[11.5px] font-semibold rounded-md bg-brand-600 text-white px-2 py-0.5 disabled:opacity-50 inline-flex items-center gap-1">{busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save to Guesty</button>
              <button onClick={() => { setEdit(false); setMinN(meta.minN != null ? String(meta.minN) : ''); setCi(meta.checkIn || ''); setCo(meta.checkOut || '') }} className="text-[11.5px] text-muted">Cancel</button>
            </span>}
      </div>
      <dl className="divide-y divide-line text-[12.5px]">
        {row(Ban, 'Cancellation', meta.cancel.label, meta.cancel.tier === 'flex' ? 'good' : meta.cancel.tier === 'strict' ? 'bad' : 'muted', 'change in Guesty / each channel')}
        {row(CalendarClock, 'Min nights', edit ? <input type="number" min={1} value={minN} onChange={e => setMinN(e.target.value)} className={inp} /> : (meta.minN != null ? String(meta.minN) : 'Not set'), meta.minN != null && Number(meta.minN) <= 3 ? 'good' : 'muted', edit ? 'default; Stay Window dates keep their own' : undefined)}
        {row(CalendarClock, 'Max nights', meta.maxN != null ? String(meta.maxN) : '—', 'muted')}
        {row(Zap, 'Instant Book', meta.instant ? 'On' : (meta.instantRaw == null ? 'Unknown' : 'Off'), meta.instant ? 'good' : 'bad', meta.instant ? undefined : 'turn on in Airbnb / Vrbo')}
        {row(CalendarClock, 'Check-in / out', edit
          ? <span className="inline-flex items-center gap-1"><input type="time" value={ci} onChange={e => setCi(e.target.value)} className={inp} /> / <input type="time" value={co} onChange={e => setCo(e.target.value)} className={inp} /></span>
          : (meta.checkIn || meta.checkOut ? `${meta.checkIn || '—'} / ${meta.checkOut || '—'}` : 'Not set'), 'muted')}
      </dl>
      {msg && <p className={'px-3 py-2 text-[11.5px] border-t border-line ' + (msg.ok ? 'text-emerald-700' : 'text-rose-700')}>{msg.text}</p>}
    </div>
  )
}

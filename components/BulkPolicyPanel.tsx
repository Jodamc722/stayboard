'use client'
// Bulk-set booking policies across a building's units: check-in / check-out times, min / max
// nights, and house-rules text. Only the fields you fill are sent (partial update), to the
// units you pick, after you confirm. Writes to Guesty via /api/bulk-policies (PUT per listing).
// Note: cancellation policy is channel-specific in Guesty and handled separately, so it's not here.
import { useState } from 'react'
import { Check, SlidersHorizontal, AlertTriangle, RefreshCw, X, Clock } from 'lucide-react'

type Unit = { id: string; name: string }
type Res = { id: string; name: string; ok: boolean; error?: string }

export function BulkPolicyPanel({ units }: { units: Unit[] }) {
  const [open, setOpen] = useState(false)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [minNights, setMinNights] = useState('')
  const [maxNights, setMaxNights] = useState('')
  const [houseRules, setHouseRules] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set(units.map(u => u.id)))
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [results, setResults] = useState<Res[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const toggleU = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const policy: any = {}
  if (/^\d{1,2}:\d{2}$/.test(checkIn)) policy.checkInTime = checkIn
  if (/^\d{1,2}:\d{2}$/.test(checkOut)) policy.checkOutTime = checkOut
  if (minNights && Number(minNights) > 0) policy.minNights = Number(minNights)
  if (maxNights && Number(maxNights) > 0) policy.maxNights = Number(maxNights)
  if (houseRules.trim()) policy.houseRules = houseRules.trim()
  const fieldCount = Object.keys(policy).length
  const canApply = fieldCount > 0 && sel.size > 0

  const summary = [
    policy.checkInTime && `check-in ${policy.checkInTime}`,
    policy.checkOutTime && `check-out ${policy.checkOutTime}`,
    policy.minNights != null && `min ${policy.minNights}n`,
    policy.maxNights != null && `max ${policy.maxNights}n`,
    policy.houseRules && 'house rules',
  ].filter(Boolean).join(', ')

  async function apply() {
    setBusy(true); setErr(null); setResults(null)
    try {
      const res = await fetch('/api/bulk-policies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingIds: Array.from(sel), policy }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setResults(d.results || []); setConfirming(false)
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg border border-brand-200 text-brand-700 bg-brand-50 px-3 py-2 hover:bg-brand-100">
        <SlidersHorizontal size={14} /> Bulk set policies
      </button>
    )
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white p-4 mb-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><SlidersHorizontal size={14} className="text-brand-600" /> Bulk set policies</h2>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X size={16} /></button>
      </div>

      {results ? (
        <div>
          <div className="text-[13px] font-semibold text-ink mb-2">Done — {results.filter(r => r.ok).length}/{results.length} units updated.</div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {results.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-[12px] border border-line rounded-lg px-2.5 py-1.5">
                <span className="text-ink truncate">{r.name}</span>
                {r.ok ? <span className="text-emerald-700 inline-flex items-center gap-1 shrink-0"><Check size={12} /> updated</span>
                  : <span className="text-rose-600 inline-flex items-center gap-1 shrink-0" title={r.error}><AlertTriangle size={12} /> failed</span>}
              </div>
            ))}
          </div>
          <button onClick={() => location.reload()} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 underline underline-offset-2"><RefreshCw size={12} /> Reload</button>
        </div>
      ) : (
        <>
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">1. Set the policies to apply <span className="text-muted/70">(leave blank to skip)</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <label className="text-[11px] text-muted">Check-in
              <div className="relative mt-0.5"><Clock size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" /><input value={checkIn} onChange={e => setCheckIn(e.target.value)} placeholder="15:00" className="w-full pl-7 pr-2 py-1.5 text-[13px] rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" /></div>
            </label>
            <label className="text-[11px] text-muted">Check-out
              <div className="relative mt-0.5"><Clock size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" /><input value={checkOut} onChange={e => setCheckOut(e.target.value)} placeholder="11:00" className="w-full pl-7 pr-2 py-1.5 text-[13px] rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" /></div>
            </label>
            <label className="text-[11px] text-muted">Min nights
              <input value={minNights} onChange={e => setMinNights(e.target.value.replace(/\D/g, ''))} placeholder="2" className="w-full mt-0.5 px-2 py-1.5 text-[13px] rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </label>
            <label className="text-[11px] text-muted">Max nights
              <input value={maxNights} onChange={e => setMaxNights(e.target.value.replace(/\D/g, ''))} placeholder="45" className="w-full mt-0.5 px-2 py-1.5 text-[13px] rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </label>
          </div>
          <label className="block text-[11px] text-muted mb-3">House rules (additional text)
            <textarea value={houseRules} onChange={e => setHouseRules(e.target.value)} rows={2} placeholder="e.g. No parties or events. Quiet hours 10pm–8am. No smoking indoors." className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </label>

          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">2. Apply to units <span className="text-brand-700">· {sel.size}/{units.length}</span></div>
            <div className="flex gap-2 text-[11px]">
              <button onClick={() => setSel(new Set(units.map(u => u.id)))} className="text-brand-700 hover:underline">All</button>
              <button onClick={() => setSel(new Set())} className="text-muted hover:underline">None</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-4 max-h-44 overflow-y-auto">
            {units.map(u => {
              const on = sel.has(u.id)
              return (
                <button key={u.id} onClick={() => toggleU(u.id)} className={`text-left text-[12px] px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-2 ${on ? 'bg-app border-line text-ink' : 'bg-white border-line text-muted'}`}>
                  <span className={`w-4 h-4 rounded border inline-flex items-center justify-center shrink-0 ${on ? 'bg-brand-600 border-brand-600 text-white' : 'border-line'}`}>{on && <Check size={11} />}</span>
                  <span className="truncate">{u.name}</span>
                </button>
              )
            })}
          </div>

          {err && <div className="text-[12px] text-rose-600 mb-2 inline-flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}</div>}

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line">
            {!confirming ? (
              <button onClick={() => setConfirming(true)} disabled={!canApply} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
                Review &amp; apply to Guesty
              </button>
            ) : (
              <>
                <span className="text-[12px] text-ink">Apply <b>{summary}</b> to <b>{sel.size}</b> unit{sel.size === 1 ? '' : 's'} on Guesty?</span>
                <button onClick={apply} disabled={busy} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700 disabled:opacity-50">{busy ? 'Applying…' : 'Yes, apply'}</button>
                <button onClick={() => setConfirming(false)} disabled={busy} className="text-[12px] text-muted hover:text-ink">Cancel</button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}

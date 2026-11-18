'use client'
// BASE PRICES for one property: what Guesty says now, what the nights actually sold for, and the
// price proposed from that (the yearly average night: Jon, 2026-11-18). Jon and Bernadette edit the proposal,
// pick the units, and confirm; only then is anything written to Guesty (/api/base-price).
import { useState } from 'react'
import { DollarSign, RefreshCw, X, Check, AlertTriangle } from 'lucide-react'

type Unit = {
  id: string; name: string; bedrooms: number | null
  base: number | null; weekendBase: number | null; booked: number | null; nights: number; basis: 'own' | 'building' | 'none'
  proposed: number | null; proposedWeekend: number | null
  calendar?: { open?: number; atBase?: number; first?: string | null; error?: string }
}
type Res = { id: string; name: string; ok: boolean; error?: string; from?: number | null; to?: number }
const money = (n: number | null | undefined) => (n == null ? '—' : '$' + Math.round(n).toLocaleString())

export function BasePricePanel({ building, ids }: { building: string; ids: string[] }) {
  const [open, setOpen] = useState(false)
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [lift, setLift] = useState<number | null>(null)
  const [edit, setEdit] = useState<Record<string, { base: string; weekend: string }>>({})
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [results, setResults] = useState<Res[] | null>(null)
  const [err, setErr] = useState('')
  const [canPush, setCanPush] = useState(false)

  const load = async (calendar: boolean) => {
    setBusy(calendar ? 'calendar' : 'load'); setErr(''); setResults(null)
    try {
      const r = await fetch('/api/base-price?ids=' + encodeURIComponent(ids.join(',')) + (calendar ? '&calendar=1' : ''))
      const j = await r.json()
      if (!j.ok) { setErr(j.error || 'Could not load.'); return }
      setUnits(j.units); setLift(j.summary?.weekendLift ?? null); setCanPush(!!j.canPush)
      if (!calendar) {
        const e: Record<string, { base: string; weekend: string }> = {}
        for (const u of j.units as Unit[]) e[u.id] = { base: u.proposed != null ? String(u.proposed) : '', weekend: u.proposedWeekend != null ? String(u.proposedWeekend) : '' }
        setEdit(e)
        setSel(new Set((j.units as Unit[]).filter(u => u.proposed != null && u.proposed !== u.base).map(u => u.id)))
      }
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const changes = (units || []).filter(u => sel.has(u.id)).map(u => ({ id: u.id, basePrice: Number(edit[u.id]?.base), weekendBasePrice: edit[u.id]?.weekend ? Number(edit[u.id].weekend) : null }))
    .filter(c => Number.isFinite(c.basePrice) && c.basePrice >= 20)
  const apply = async () => {
    setBusy('apply'); setErr('')
    try {
      const r = await fetch('/api/base-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) })
      const j = await r.json()
      if (!j.ok) { setErr(j.error || 'Nothing was changed.'); return }
      setResults(j.results); setConfirming(false)
      setUnits(us => (us || []).map(u => { const x = (j.results as any[]).find(q => q.id === u.id && q.ok); return x ? { ...u, base: x.to, weekendBase: x.toWeekend ?? u.weekendBase } : u }))
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }
  const atBaseUnits = (units || []).filter(u => (u.calendar?.atBase || 0) > 0)
  const inp = 'w-[76px] h-7 rounded-lg border border-line px-1.5 text-[12.5px] text-ink tabular-nums'

  if (!open) return <button onClick={() => { setOpen(true); if (!units) load(false) }} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line bg-white text-[13px] font-semibold text-ink hover:border-ink/40"><DollarSign size={14} /> Base prices</button>

  return (
    <div className="w-full rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 mb-1">
        <DollarSign size={15} className="text-muted" />
        <h3 className="text-[14px] font-bold text-ink flex-1">Base prices · {building}</h3>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink" title="Close"><X size={16} /></button>
      </div>
      <p className="text-[12px] text-muted mb-3">The base price is what the booking site shows and what a day falls back to when nothing else has priced it. PriceLabs sets the nightly rate; this does not move a night it has priced. Proposed = the average night sold over the last 12 months plus 15%{lift ? `; weekend = that × ${lift}` : ''}. Nothing changes in Guesty until you apply.{canPush ? '' : ' Only Jon and Bernadette can apply a change.'}</p>
      {err ? <p className="text-[12.5px] text-rose-700 mb-2">{err}</p> : null}
      {busy === 'load' || !units ? <p className="text-[13px] text-muted">Loading…</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-muted">
                <th className="py-1 pr-2 w-6"></th><th className="py-1 pr-3 font-semibold">Unit</th>
                <th className="py-1 pr-3 font-semibold">Base now</th><th className="py-1 pr-3 font-semibold">Weekend now</th>
                <th className="py-1 pr-3 font-semibold">Yearly avg</th><th className="py-1 pr-3 font-semibold">New base</th><th className="py-1 pr-3 font-semibold">New weekend</th>
                <th className="py-1 font-semibold">Calendar</th>
              </tr></thead>
              <tbody>
                {units.map(u => (
                  <tr key={u.id} className="border-t border-line/70">
                    <td className="py-1.5 pr-2"><input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} /></td>
                    <td className="py-1.5 pr-3 font-semibold text-ink">{u.name}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{money(u.base)}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-muted">{money(u.weekendBase)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{money(u.booked)} <span className="text-muted">{u.basis === 'own' ? `· ${u.nights} nights` : u.basis === 'building' ? '· from similar units' : '· no bookings'}</span></td>
                    <td className="py-1.5 pr-3"><input className={inp} inputMode="numeric" value={edit[u.id]?.base ?? ''} onChange={e => setEdit(x => ({ ...x, [u.id]: { base: e.target.value, weekend: x[u.id]?.weekend ?? '' } }))} /></td>
                    <td className="py-1.5 pr-3"><input className={inp} inputMode="numeric" value={edit[u.id]?.weekend ?? ''} onChange={e => setEdit(x => ({ ...x, [u.id]: { base: x[u.id]?.base ?? '', weekend: e.target.value } }))} /></td>
                    <td className="py-1.5 text-muted">{!u.calendar ? '' : u.calendar.error ? u.calendar.error : (u.calendar.atBase || 0) > 0 ? <span className="text-amber-700">{u.calendar.atBase} open days at base, from {u.calendar.first}</span> : 'all open days priced'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {atBaseUnits.length > 0 ? <p className="mt-2 text-[12px] text-amber-700 flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {atBaseUnits.length} unit{atBaseUnits.length === 1 ? ' has' : 's have'} bookable days that nothing has priced, so they sell at the base price. Lowering the base lowers those days too. Price them in PriceLabs first, or leave those units unticked.</p> : null}
          {results ? <p className="mt-2 text-[12.5px] text-ink">{results.filter(r => r.ok).length} updated{results.some(r => !r.ok) ? ` · ${results.filter(r => !r.ok).length} not changed: ${results.filter(r => !r.ok).map(r => r.name + ' (' + r.error + ')').join('; ')}` : ''}.</p> : null}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={() => load(true)} disabled={!!busy} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line text-[12.5px] font-semibold text-ink disabled:opacity-50"><RefreshCw size={13} className={busy === 'calendar' ? 'animate-spin' : ''} /> {busy === 'calendar' ? 'Reading calendars…' : 'Check calendars first'}</button>
            {!confirming
              ? <button onClick={() => setConfirming(true)} disabled={!!busy || !changes.length || !canPush} title={canPush ? undefined : 'Only Jon and Bernadette can push base prices to Guesty'} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-ink text-white text-[12.5px] font-semibold disabled:opacity-40">Apply to {changes.length} unit{changes.length === 1 ? '' : 's'}</button>
              : <><span className="text-[12.5px] text-ink">Write {changes.length} base price{changes.length === 1 ? '' : 's'} to Guesty?</span>
                <button onClick={apply} disabled={!!busy} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-ink text-white text-[12.5px] font-semibold disabled:opacity-50"><Check size={13} /> {busy === 'apply' ? 'Writing…' : 'Yes, write them'}</button>
                <button onClick={() => setConfirming(false)} className="h-8 px-3 rounded-lg border border-line text-[12.5px] font-semibold text-ink">Cancel</button></>}
          </div>
        </>
      )}
    </div>
  )
}

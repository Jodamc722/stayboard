'use client'
// BASE RATES, THE FULL LIST (Jon, 2026-11-18: "the base rates should show on admin page, by listing. Full list…
// with it opening to the unit"). Every active listing with the base price Guesty holds for it, its weekend base,
// and its yearly average night (what it took for its nights over the last 12 months, over the nights sold). A row
// opens the unit's page. PriceLabs sets the nightly rate; the base is the fallback and the figure the site prints.
//
// PUSH TO GUESTY FROM HERE (Jon, 2026-11-18: "can we push the base rates from here to guesty"). Type a new base (and
// weekend base) on any rows, or fill the rows showing with their booked night, then Review. Nothing is written
// until the review is confirmed: it lists every change, old to new, and reads each unit's calendar first, because
// a day nothing has priced sells AT the base price, so lowering a base re-prices those days. The write itself is
// /api/base-price POST: only the two base fields change, every other price goes back as it was, and each change
// is logged with the old value so it can be put back.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, RefreshCw, AlertTriangle, Check, UploadCloud } from 'lucide-react'
import { LeanPick, LeanEmpty, Tag } from '@/components/lean'

type Unit = { id: string; name: string; building: string; bedrooms: number | null; base: number | null; weekendBase: number | null; booked: number | null; nights: number; basis: 'own' | 'building' | 'none'; proposed?: number | null; proposedWeekend?: number | null }
type Cal = { open?: number; atBase?: number; first?: string | null; error?: string }
type Res = { id: string; name: string; ok: boolean; error?: string; from?: number | null; to?: number; toWeekend?: number | null }
type Sort = 'name' | 'building' | 'high' | 'low' | 'gap'
const money = (n: number | null | undefined) => (n == null ? '—' : '$' + Math.round(n).toLocaleString())
const beds = (n: number | null) => (n == null ? '' : n === 0 ? 'Studio' : n + ' BR')
/** How far the base sits from the booked night, as a share of the booked night. Null when either is missing. */
const gapOf = (u: Unit) => (u.base && u.booked ? (u.base - u.booked) / u.booked : null)

export function AdminBaseRates({ canEdit: canEditProp = false }: { canEdit?: boolean }) {
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [q, setQ] = useState(''); const [building, setBuilding] = useState('all'); const [sort, setSort] = useState<Sort>('building'); const [show, setShow] = useState<'all' | 'off' | 'none'>('all')
  // ONLY JON AND BERNADETTE PUSH (Jon, 2026-11-18): the server says who may, and refuses anyone else's write.
  const [canPush, setCanPush] = useState(false)
  const canEdit = canPush
  const load = () => { setBusy(true); setErr(''); fetch('/api/base-price?all=1', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) { setUnits(j.units || []); setCanPush(!!j.canPush && canEditProp) } else setErr(j?.error || 'Could not load the base rates.') }).catch(() => setErr('Could not load the base rates.')).finally(() => setBusy(false)) }
  useEffect(load, [])
  const buildings = useMemo(() => Array.from(new Set((units || []).map(u => u.building).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [units])
  const off = (u: Unit) => { const g = gapOf(u); return g != null && Math.abs(g) >= 0.3 }
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const byName = (a: Unit, b: Unit) => a.name.localeCompare(b.name, undefined, { numeric: true })
    return (units || [])
      .filter(u => (building === 'all' || u.building === building) && (!s || (u.name + ' ' + u.building).toLowerCase().includes(s)) && (show === 'all' || (show === 'off' ? off(u) : u.base == null)))
      .sort((a, b) => sort === 'name' ? byName(a, b)
        : sort === 'high' ? (b.base ?? -1) - (a.base ?? -1) || byName(a, b)
        : sort === 'low' ? (a.base ?? 1e9) - (b.base ?? 1e9) || byName(a, b)
        : sort === 'gap' ? Math.abs(gapOf(b) ?? -1) - Math.abs(gapOf(a) ?? -1) || byName(a, b)
        : a.building.localeCompare(b.building) || byName(a, b))
  }, [units, q, building, sort, show])
  const nOff = (units || []).filter(off).length, nNone = (units || []).filter(u => u.base == null).length

  // ── new prices, typed here, pushed only after a review ──
  const [edit, setEdit] = useState<Record<string, { base?: string; weekend?: string }>>({})
  const [review, setReview] = useState(false); const [cal, setCal] = useState<Record<string, Cal> | null>(null)
  const [pushing, setPushing] = useState(''); const [results, setResults] = useState<Res[] | null>(null); const [pushErr, setPushErr] = useState('')
  const n = (v?: string) => { const x = Number(String(v ?? '').replace(/[$,\s]/g, '')); return v != null && String(v).trim() !== '' && Number.isFinite(x) ? Math.round(x) : null }
  /** Rows whose typed price differs from what Guesty holds. A weekend typed alone keeps the base as it is. */
  const changes = useMemo(() => (units || []).map(u => {
    const b = n(edit[u.id]?.base), w = n(edit[u.id]?.weekend)
    const base = b ?? u.base, baseChanged = b != null && b !== u.base, wkChanged = w != null && w !== u.weekendBase
    if ((!baseChanged && !wkChanged) || base == null) return null
    const bad = base < 20 || base > 5000 || (w != null && (w < 20 || w > 8000))
    return { u, basePrice: base, weekendBasePrice: wkChanged ? w : null, baseChanged, wkChanged, bad }
  }).filter(Boolean) as { u: Unit; basePrice: number; weekendBasePrice: number | null; baseChanged: boolean; wkChanged: boolean; bad: boolean }[], [units, edit])
  const good = changes.filter(c => !c.bad), lowered = good.filter(c => c.baseChanged && c.u.base != null && c.basePrice < c.u.base)
  const fillShown = () => setEdit(e => { const x = { ...e }; for (const u of list) if (u.proposed != null && u.proposed !== u.base) x[u.id] = { base: String(u.proposed), weekend: u.proposedWeekend != null ? String(u.proposedWeekend) : '' }; return x })
  async function openReview() {
    setReview(true); setResults(null); setPushErr(''); setCal(null)
    // the calendar, for the units whose base is going DOWN: the days that would re-price
    const ids = lowered.map(c => c.u.id)
    if (!ids.length) { setCal({}); return }
    const out: Record<string, Cal> = {}
    try {
      for (let i = 0; i < ids.length; i += 40) {
        const j = await fetch('/api/base-price?calendar=1&ids=' + encodeURIComponent(ids.slice(i, i + 40).join(',')), { cache: 'no-store' }).then(r => r.json())
        for (const x of (j?.units || []) as any[]) out[x.id] = x.calendar || { error: 'not read' }
      }
    } catch { /* shown as not read */ }
    setCal(out)
  }
  async function push() {
    setPushErr(''); const all: Res[] = []
    try {
      for (let i = 0; i < good.length; i += 50) {
        setPushing(`Writing ${Math.min(i + 50, good.length)} of ${good.length}…`)
        const j = await fetch('/api/base-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: good.slice(i, i + 50).map(c => ({ id: c.u.id, basePrice: c.basePrice, weekendBasePrice: c.weekendBasePrice })) }) }).then(r => r.json())
        if (!j?.ok) { setPushErr(j?.error || 'Guesty did not take the changes.'); break }
        all.push(...(j.results as Res[]))
      }
    } catch (e: any) { setPushErr(String(e?.message || e)) }
    setPushing(''); setResults(all)
    const done = new Map(all.filter(r => r.ok).map(r => [r.id, r] as [string, Res]))
    setUnits(us => (us || []).map(u => { const r = done.get(u.id); return r ? { ...u, base: r.to ?? u.base, weekendBase: r.toWeekend ?? u.weekendBase } : u }))
    setEdit(e => { const x = { ...e }; done.forEach((_, id) => { delete x[id] }); return x })
  }
  const atBase = cal ? lowered.filter(c => (cal[c.u.id]?.atBase || 0) > 0) : []
  const inp = 'w-[70px] h-7 rounded-lg border border-line px-1.5 text-right text-[12.5px] text-ink tabular-nums'

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit or building…" aria-label="Find a unit or building" className="w-56 max-w-full rounded-lg border border-line bg-white pl-7 pr-2 py-1.5 text-[12.5px]" />
          </div>
          {buildings.length > 1 ? <select value={building} onChange={e => setBuilding(e.target.value)} aria-label="Building" className="max-w-[220px] rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink"><option value="all">All buildings ({buildings.length})</option>{buildings.map(b => <option key={b} value={b}>{b}</option>)}</select> : null}
          <LeanPick size="sm" value={show} onPick={setShow} options={[{ v: 'all', label: <>All <span className="opacity-60 tabular-nums">{units?.length ?? ''}</span></> }, { v: 'off', label: <>Far from yearly avg <span className="opacity-60 tabular-nums">{nOff}</span></>, title: 'Base price 30% or more above or below the yearly average night' }, { v: 'none', label: <>No base price <span className="opacity-60 tabular-nums">{nNone}</span></> }]} />
          <span className="ml-auto flex items-center gap-1.5 flex-wrap"><span className="text-[11px] text-muted">Sort</span>
            <LeanPick size="sm" value={sort} onPick={setSort} options={[{ v: 'building', label: 'Building' }, { v: 'name', label: 'Unit' }, { v: 'high', label: 'Highest base' }, { v: 'low', label: 'Lowest base' }, { v: 'gap', label: 'Biggest gap', title: 'Base price furthest from the yearly average night' }]} />
            <button type="button" onClick={load} disabled={busy} title="Read the list again" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1.5 text-[12px] font-medium text-ink disabled:opacity-50"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh</button>
          </span>
        </div>
      </div>
      <p className="px-1 text-[11.5px] text-muted">{list.length} listing{list.length === 1 ? '' : 's'} · <b>Base</b> and <b>Weekend</b> are what Guesty holds now, as of the last listings sync · <b>Yearly avg</b> is the average night sold over the last 12 months · click a listing to open its unit page. PriceLabs sets the nightly rate; the base is the fallback for a day it has not priced, and the figure the booking site shows.{canEdit ? ' Type a new base or weekend price on any rows, then review and push to Guesty.' : ' Jon and Bernadette can change a base price here.'}</p>
      {canEdit && units ? (
        <div className="rounded-2xl border border-line bg-white px-3 py-2 flex flex-wrap items-center gap-2 text-[12.5px] sticky top-2 z-10 shadow-sm">
          <span className="mr-auto text-ink">{changes.length ? <><b>{good.length}</b> price change{good.length === 1 ? '' : 's'} ready{changes.length > good.length ? <span className="text-rose-700"> · {changes.length - good.length} out of range ($20 to $5,000)</span> : null}</> : <span className="text-muted">No changes typed yet.</span>}</span>
          <button type="button" onClick={fillShown} title="Sets the new base of every row showing to its yearly average night plus 15% (rounded to $5), and the weekend to match. Nothing is written until you push." className="rounded-lg border border-line bg-white px-2.5 py-1.5 font-medium text-ink">Fill the {list.length} showing with yearly avg +15%</button>
          {changes.length ? <button type="button" onClick={() => setEdit({})} className="text-muted underline">Clear</button> : null}
          <button type="button" disabled={!good.length} onClick={openReview} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 font-semibold text-white disabled:opacity-40"><UploadCloud size={13} /> Review and push to Guesty</button>
        </div>
      ) : null}
      {review ? (
        <div className="rounded-2xl border border-ink/20 bg-white p-4 text-[12.5px] text-ink">
          <p className="text-[14px] font-bold">{results ? 'Pushed to Guesty' : `Write ${good.length} base price${good.length === 1 ? '' : 's'} to Guesty?`}</p>
          {!results ? <>
            <p className="text-muted mt-1">Only the base and weekend base change. PriceLabs keeps setting the nightly rate. Every other price on the listing goes back exactly as it is, and each change is logged with the old value.</p>
            <div className="mt-2 max-h-[280px] overflow-auto rounded-xl border border-line">
              <table className="w-full text-[12.5px]"><tbody>{good.map(c => { const k = cal?.[c.u.id]; return (
                <tr key={c.u.id} className="border-b border-line/70 last:border-0">
                  <td className="py-1.5 pl-3 pr-2 font-semibold">{c.u.name}<span className="font-normal text-muted"> · {c.u.building}</span></td>
                  <td className="px-2 tabular-nums whitespace-nowrap">{c.baseChanged ? <>{money(c.u.base)} → <b>{money(c.basePrice)}</b></> : <span className="text-muted">base stays {money(c.u.base)}</span>}</td>
                  <td className="px-2 tabular-nums whitespace-nowrap text-muted">{c.wkChanged ? <>weekend {money(c.u.weekendBase)} → <b className="text-ink">{money(c.weekendBasePrice)}</b></> : ''}</td>
                  <td className="pl-2 pr-3 text-muted">{!(c.baseChanged && c.u.base != null && c.basePrice < c.u.base) ? '' : !cal ? 'reading its calendar…' : !k || k.error ? 'calendar not read' : (k.atBase || 0) > 0 ? <span className="text-amber-700 font-semibold">{k.atBase} open days not priced by PriceLabs, from {k.first}</span> : 'PriceLabs prices every open day'}</td>
                </tr>) })}</tbody></table>
            </div>
            {lowered.length ? (!cal ? <p className="mt-2 text-muted">Reading the calendars of the {lowered.length} unit{lowered.length === 1 ? '' : 's'} whose base is going down…</p>
              : atBase.length ? <p className="mt-2 text-amber-700 flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> PriceLabs sets the nightly rate, so priced nights do not move. {atBase.length} unit{atBase.length === 1 ? ' has' : 's have'} open days PriceLabs has not priced yet: only those fall back to the base, so they would take the new one until PriceLabs prices them.</p>
              : <p className="mt-2 text-muted">PriceLabs prices every open day on these units, so no night’s rate changes.</p>) : null}
            {pushErr ? <p className="mt-2 text-rose-700">{pushErr}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" disabled={!!pushing || (lowered.length > 0 && !cal)} onClick={push} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 font-semibold text-white disabled:opacity-50"><Check size={13} /> {pushing || 'Yes, write them to Guesty'}</button>
              <button type="button" disabled={!!pushing} onClick={() => setReview(false)} className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink">Cancel</button>
            </div>
          </> : <>
            <p className="mt-1"><b>{results.filter(r => r.ok).length}</b> updated in Guesty{results.some(r => !r.ok) ? <span className="text-rose-700"> · {results.filter(r => !r.ok).length} not changed</span> : ''}.</p>
            {results.some(r => !r.ok) ? <ul className="mt-1 list-disc pl-5 text-rose-700">{results.filter(r => !r.ok).map(r => <li key={r.id}>{r.name}: {r.error}</li>)}</ul> : null}
            {pushErr ? <p className="mt-1 text-rose-700">{pushErr}</p> : null}
            <button type="button" onClick={() => { setReview(false); setResults(null) }} className="mt-2 rounded-lg border border-line px-3 py-1.5 font-semibold text-ink">Done</button>
          </>}
        </div>
      ) : null}
      {err ? <LeanEmpty>{err}</LeanEmpty> : !units ? <LeanEmpty>Reading every listing’s base rate…</LeanEmpty> : list.length === 0 ? <LeanEmpty>No listing matches.</LeanEmpty> : (
        <div className="rounded-2xl border border-line bg-white overflow-x-auto">
          <table className={"w-full text-[13px] " + (canEdit ? "min-w-[820px]" : "min-w-[640px]")}>
            <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line">
              <th className="py-2 pl-4 pr-2 font-semibold">Listing</th><th className="px-2 font-semibold">Building</th><th className="px-2 font-semibold">Size</th>
              <th className="px-2 text-right font-semibold">Base</th><th className="px-2 text-right font-semibold">Weekend</th><th className="px-2 text-right font-semibold">Yearly avg</th>{canEdit ? <><th className="px-2 text-right font-semibold">New base</th><th className="px-2 text-right font-semibold">New weekend</th></> : null}<th className="pl-2 pr-4 font-semibold" />
            </tr></thead>
            <tbody>{list.map(u => { const g = gapOf(u); const href = '/listings/' + encodeURIComponent(u.id); return (
              <tr key={u.id} className="border-b border-line/70 last:border-0 hover:bg-app/60">
                <td className="py-0 pl-4 pr-2"><Link href={href} className="block py-2 font-semibold text-ink hover:underline">{u.name || 'Unnamed listing'}</Link></td>
                <td className="px-2 text-muted">{u.building || '—'}</td>
                <td className="px-2 text-muted whitespace-nowrap">{beds(u.bedrooms)}</td>
                <td className="px-2 text-right tabular-nums font-semibold text-ink">{money(u.base)}</td>
                <td className="px-2 text-right tabular-nums text-ink">{money(u.weekendBase)}</td>
                <td className="px-2 text-right tabular-nums text-muted" title={u.basis === 'own' ? u.nights + ' nights sold in the last 12 months' : u.basis === 'building' ? 'Too few nights of its own: the same size in its building' : 'No booked nights to go on'}>{money(u.booked)}{u.basis === 'building' ? '*' : ''}</td>
                {canEdit ? <>
                  <td className="px-2 text-right"><input className={inp} inputMode="numeric" placeholder="—" aria-label={'New base price for ' + u.name} value={edit[u.id]?.base ?? ''} onChange={e => setEdit(x => ({ ...x, [u.id]: { ...x[u.id], base: e.target.value } }))} /></td>
                  <td className="px-2 text-right"><input className={inp} inputMode="numeric" placeholder="—" aria-label={'New weekend base for ' + u.name} value={edit[u.id]?.weekend ?? ''} onChange={e => setEdit(x => ({ ...x, [u.id]: { ...x[u.id], weekend: e.target.value } }))} /></td>
                </> : null}
                <td className="pl-2 pr-4 whitespace-nowrap">{u.base == null ? <Tag tone="rose">No base price</Tag> : g != null && Math.abs(g) >= 0.3 ? <Tag tone="amber" title="Base price against the yearly average night">{g > 0 ? '+' : '−'}{Math.round(Math.abs(g) * 100)}% vs yearly avg</Tag> : null}</td>
              </tr>) })}</tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-muted border-t border-line">* too few nights of its own, so the average is the same size of unit in its building.</p>
        </div>
      )}
    </div>
  )
}

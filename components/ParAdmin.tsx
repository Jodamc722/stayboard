'use client'
// Admin console — INVENTORY PAR LEVELS. The required count of each essential per unit, by room
// type. Audits count what is actually there; anything under these numbers becomes a restock order
// line, so this table is what decides how much stock the portfolio buys.
//
// Counts scale with the unit ("per guest", "per bed"), which is why each line is a qty + a basis
// rather than a flat number. A preview column shows what the rule resolves to for a sample unit so
// the effect of a change is visible before saving. Owner-only, defaults always available to restore.
import { useEffect, useMemo, useState } from 'react'
import { Boxes, Loader2, Check, AlertTriangle, Save, Plus, Trash2, RotateCcw } from 'lucide-react'
import { DEFAULT_PAR, PAR_BASIS_LABEL, PAR_CATEGORIES, PAR_CATEGORY_LABEL, mergePar, parFor, type ParBasis, type ParTable, type UnitShape } from '@/lib/par-levels'

const BASES: ParBasis[] = ['unit', 'guest', 'bedroom', 'bathroom', 'bed']

export function ParAdmin({ isOwner }: { isOwner: boolean }) {
  const [t, setT] = useState<ParTable>(DEFAULT_PAR)
  const [saved, setSaved] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [cat, setCat] = useState<string>('kitchen')
  // Sample unit for the preview column — a 2 bed / 2 bath sleeping 4 is the portfolio's median.
  const [shape, setShape] = useState<UnitShape>({ bedrooms: 2, bathrooms: 2, guests: 4, beds: 2 })

  useEffect(() => {
    fetch('/api/audit/par', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const m = mergePar(j && j.table ? { rooms: j.table } : null)
      setT(m); setSaved(JSON.stringify(m)); setLoaded(true)
    }).catch(() => { setT(DEFAULT_PAR); setSaved(JSON.stringify(DEFAULT_PAR)); setLoaded(true) })
  }, [])

  const dirty = useMemo(() => loaded && JSON.stringify(t) !== saved, [t, saved, loaded])
  const rules = t[cat] || []
  const edit = (fn: (d: ParTable) => void) => setT(prev => { const next: ParTable = JSON.parse(JSON.stringify(prev)); fn(next); return next })

  async function save() {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/audit/par', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: t }) })
      const j = await r.json(); if (!r.ok) throw new Error((j && j.error) || 'Could not save.')
      const m = mergePar(j && j.table ? { rooms: j.table } : null)
      setT(m); setSaved(JSON.stringify(m))
      setMsg('Saved. Every audit link picks this up on its next load.')
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <Boxes size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">Inventory par levels</span>
        {dirty && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Unsaved</span>}
        <button onClick={save} disabled={!isOwner || busy || !dirty}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save par levels
        </button>
      </div>

      <div className="p-4 space-y-4">
        <p className="text-[13px] text-muted">What a unit must have to be guest-ready. On a walk the team counts each line; anything under par becomes a restock order on the audit, priced and approved on the order desk like any other buy.</p>
        {!isOwner && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> These numbers drive what the portfolio buys, so only the owner can edit them. You can look, but Save is off.
          </div>
        )}
        {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}
        {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

        <div className="flex flex-wrap gap-1.5">
          {PAR_CATEGORIES.map(k => (
            <button key={k} onClick={() => setCat(k)}
              className={'text-[12px] px-2.5 py-1.5 rounded-lg border font-semibold transition-colors ' + (cat === k ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-muted hover:border-brand-300')}>
              {PAR_CATEGORY_LABEL[k]} <span className="opacity-60">{(t[k] || []).length}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[12px] text-muted">
          <span className="font-semibold text-ink">Preview for a sample unit:</span>
          {([['bedrooms', 'bd'], ['bathrooms', 'ba'], ['guests', 'guests'], ['beds', 'beds']] as const).map(([k, lbl]) => (
            <label key={k} className="inline-flex items-center gap-1">
              <input type="number" min={1} max={20} value={(shape as any)[k]}
                onChange={e => setShape(s => ({ ...s, [k]: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))}
                className="w-14 rounded-lg border border-line px-1.5 py-1 text-[12px]" />
              {lbl}
            </label>
          ))}
        </div>

        <div className="rounded-xl border border-line overflow-hidden">
          <div className="grid grid-cols-[1fr_70px_120px_70px_70px_80px_36px] gap-2 px-3 py-2 bg-app text-[10px] uppercase tracking-wider text-muted font-semibold">
            <span>Item</span><span>Qty</span><span>Basis</span><span>Min</span><span>Max</span><span>Par here</span><span />
          </div>
          {rules.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">No par lines for {PAR_CATEGORY_LABEL[cat]}. Add one below.</div>}
          {rules.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_120px_70px_70px_80px_36px] gap-2 px-3 py-1.5 border-t border-line items-center">
              <input value={r.item} disabled={!isOwner} onChange={e => edit(d => { d[cat][i].item = e.target.value.slice(0, 60) })}
                className="rounded-lg border border-line px-2 py-1 text-[13px] disabled:bg-app" />
              <input type="number" min={0} max={99} value={r.qty} disabled={!isOwner} onChange={e => edit(d => { d[cat][i].qty = Math.max(0, Math.min(99, Number(e.target.value) || 0)) })}
                className="rounded-lg border border-line px-2 py-1 text-[13px] disabled:bg-app" />
              <select value={r.per} disabled={!isOwner} onChange={e => edit(d => { d[cat][i].per = e.target.value as ParBasis })}
                className="rounded-lg border border-line px-1.5 py-1 text-[12px] disabled:bg-app">
                {BASES.map(b => <option key={b} value={b}>{PAR_BASIS_LABEL[b]}</option>)}
              </select>
              <input type="number" min={0} max={99} value={r.min == null ? '' : r.min} disabled={!isOwner} placeholder="—"
                onChange={e => edit(d => { const v = Number(e.target.value); if (e.target.value === '' || !Number.isFinite(v) || v <= 0) delete d[cat][i].min; else d[cat][i].min = Math.min(99, Math.round(v)) })}
                className="rounded-lg border border-line px-2 py-1 text-[13px] disabled:bg-app" />
              <input type="number" min={0} max={99} value={r.max == null ? '' : r.max} disabled={!isOwner} placeholder="—"
                onChange={e => edit(d => { const v = Number(e.target.value); if (e.target.value === '' || !Number.isFinite(v) || v <= 0) delete d[cat][i].max; else d[cat][i].max = Math.min(99, Math.round(v)) })}
                className="rounded-lg border border-line px-2 py-1 text-[13px] disabled:bg-app" />
              <span className="text-[13px] font-bold tabular-nums text-brand-700">{parFor(r, shape)}</span>
              <button onClick={() => edit(d => { d[cat].splice(i, 1) })} disabled={!isOwner}
                className="text-muted hover:text-rose-600 disabled:opacity-30" title="Remove line"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => edit(d => { d[cat].push({ item: '', qty: 1, per: 'unit' }) })} disabled={!isOwner}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:border-brand-300 hover:text-ink disabled:opacity-40">
            <Plus size={13} /> Add a line
          </button>
          <button onClick={() => edit(d => { d[cat] = DEFAULT_PAR[cat].map(r => ({ ...r })) })} disabled={!isOwner}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:border-brand-300 hover:text-ink disabled:opacity-40">
            <RotateCcw size={13} /> Reset {PAR_CATEGORY_LABEL[cat]} to defaults
          </button>
        </div>
        <p className="text-[11px] text-muted">Per-bedroom and per-bathroom lines are counted in EACH such room, not once for the unit &mdash; a 2-bath unit needs the hand-towel par in both bathrooms.</p>
      </div>
    </div>
  )
}

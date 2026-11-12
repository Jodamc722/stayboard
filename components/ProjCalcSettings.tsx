'use client'
// THE PROJECTIONS CALCULATOR, TUNED BY THE SALES TEAM (Jon, 2026-11-12: "real data that we can train or
// adjust in the sales tab… if they add an amenity, beach view etc. it adjusts the projections by %").
// Every percentage the public calculator lays on top of the library's projections, editable here; the
// base numbers always come from the Projections library itself.
import { useEffect, useState } from 'react'
import { Calculator, ChevronDown, ChevronRight, Loader2, Plus, Trash2, ExternalLink } from 'lucide-react'
import type { ProjCalcSettings, ViewKey, KitchenKey } from '@/lib/projection-calc'

const box = 'w-16 rounded-lg border border-line px-2 py-1 text-[13px] text-ink text-right tabular-nums'
export function ProjCalcSettingsPanel() {
  const [open, setOpen] = useState(false)
  const [s, setS] = useState<ProjCalcSettings | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open && !s) fetch('/api/sales/calc-settings', { cache: 'no-store' }).then(r => r.json()).then(d => d?.ok && setS(d.settings)).catch(() => setMsg('Could not load the settings.')) }, [open, s])
  const pct = (v: number, set: (n: number) => void, unit = '%') => <span className="inline-flex items-center gap-1"><input className={box} inputMode="decimal" value={String(v)} onChange={e => set(Number(e.target.value.replace(/[^\d.-]/g, '')) || 0)} /><span className="text-muted text-[12px] w-6">{unit}</span></span>
  const pts = (v: number, set: (n: number) => void) => pct(v, set, 'pts')
  async function save() {
    if (!s) return
    setBusy(true); setMsg('')
    try {
      const d = await fetch('/api/sales/calc-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: s }) }).then(r => r.json())
      if (d?.ok) { setS(d.settings); setMsg('Saved. The calculator uses these now.') } else setMsg(d?.error || 'Could not save.')
    } catch { setMsg('Could not save.') } finally { setBusy(false) }
  }
  const row = 'flex items-center justify-between gap-3 py-1.5 border-b border-line last:border-0 text-[13px] text-ink'
  return (
    <section className="rounded-2xl border border-line bg-white mb-6">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Calculator size={15} /> Projections calculator <span className="text-muted font-normal text-[12.5px]">· the free public tool: how view, kitchen, balcony, amenities, beach and size move the rate and the occupancy</span></span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && (
        <div className="px-4 pb-4">
          {!s ? <p className="text-[13px] text-muted py-3"><Loader2 size={14} className="inline animate-spin mr-1" />Loading…</p> : (
            <>
              <p className="text-[12.5px] text-muted mb-3 max-w-[95ch]">The base is always this library: the building’s own projections when an owner picks a building we hold, else the area’s plans and comparables, else South Florida. Each factor moves the <b>nightly rate</b> (%) and/or <b>occupancy</b> (points). They do not stack: the biggest gain counts in full and each next one counts {Math.round(s.diminish * 100)}% of the one before. Building amenities (marked “building”) add nothing when the base is that building’s own projections, half against the area. The starting values come from AirDNA’s 2025 amenity study, set conservatively for South Florida condos. <a href="/tools/income" target="_blank" rel="noreferrer" className="font-semibold text-ink inline-flex items-center gap-1">Open the calculator <ExternalLink size={12} /></a></p>
              <div className="grid gap-5 lg:grid-cols-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted mb-1">View</p>
                  <p className="text-[11px] text-muted">Rate</p>
                  {(Object.keys(s.view) as ViewKey[]).map(k => <div key={k} className={row}><input className="min-w-0 flex-1 bg-transparent" value={s.viewLabel[k]} onChange={e => setS({ ...s, viewLabel: { ...s.viewLabel, [k]: e.target.value } })} />{pct(s.view[k], n => setS({ ...s, view: { ...s.view, [k]: n } }))}</div>)}
                  <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted mt-4 mb-1">Kitchen and balcony</p>
                  {(['kitchenette', 'none'] as KitchenKey[]).map(k => <div key={k} className={row}><span className="flex-1">{k === 'kitchenette' ? 'Kitchenette' : 'No kitchen'}</span>{pct(s.kitchen[k], n => setS({ ...s, kitchen: { ...s.kitchen, [k]: n } }))}{pts(s.kitchenOcc[k], n => setS({ ...s, kitchenOcc: { ...s.kitchenOcc, [k]: n } }))}</div>)}
                  <div className={row}><span>Balcony or terrace</span>{pct(s.balcony, n => setS({ ...s, balcony: n }))}</div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted mb-1">Amenities <span className="normal-case tracking-normal font-normal">· rate %, occupancy pts</span></p>
                  {s.amenities.map((a, i) => (
                    <div key={i} className={row}>
                      <input className="min-w-0 flex-1 bg-transparent" value={a.label} onChange={e => setS({ ...s, amenities: s.amenities.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                      {pct(a.pct, n => setS({ ...s, amenities: s.amenities.map((x, j) => j === i ? { ...x, pct: n } : x) }))}
                      {pts(a.occ, n => setS({ ...s, amenities: s.amenities.map((x, j) => j === i ? { ...x, occ: n } : x) }))}
                      <label className="inline-flex items-center gap-1 text-[11px] text-muted" title="Usually the building's: not counted when the base is the building's own projections"><input type="checkbox" checked={a.shared} onChange={e => setS({ ...s, amenities: s.amenities.map((x, j) => j === i ? { ...x, shared: e.target.checked } : x) })} />building</label>
                      <button type="button" title="Remove" onClick={() => setS({ ...s, amenities: s.amenities.filter((_, j) => j !== i) })} className="text-muted hover:text-ink"><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setS({ ...s, amenities: [...s.amenities, { key: 'amenity-' + Date.now().toString(36), label: 'New amenity', pct: 1, occ: 0, shared: false }] })} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink"><Plus size={13} /> Add an amenity</button>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted mb-1">Distance to the beach</p>
                  {s.beach.map((b, i) => (
                    <div key={i} className={row}>
                      <span className="inline-flex items-center gap-1">Within <input className={box} inputMode="decimal" value={String(b.maxMi)} onChange={e => setS({ ...s, beach: s.beach.map((x, j) => j === i ? { ...x, maxMi: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } : x) })} /> mi</span>
                      {pct(b.pct, n => setS({ ...s, beach: s.beach.map((x, j) => j === i ? { ...x, pct: n } : x) }))}
                      {pts(b.occ, n => setS({ ...s, beach: s.beach.map((x, j) => j === i ? { ...x, occ: n } : x) }))}
                    </div>
                  ))}
                  <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted mt-4 mb-1">Size and limits</p>
                  <div className={row}><span>Per 10% larger than the comparables</span>{pct(s.sqftPer10, n => setS({ ...s, sqftPer10: n }))}</div>
                  <div className={row}><span>Size never more than ±</span>{pct(s.sqftCap, n => setS({ ...s, sqftCap: n }))}</div>
                  <div className={row}><span>Each next gain counts (of the one before)</span>{pct(Math.round(s.diminish * 100), n => setS({ ...s, diminish: Math.max(0, Math.min(100, n)) / 100 }))}</div>
                  <div className={row}><span>Rate never moves more than ±</span>{pct(s.adrCap, n => setS({ ...s, adrCap: n }))}</div>
                  <div className={row}><span>Occupancy never moves more than ±</span>{pts(s.occCap, n => setS({ ...s, occCap: n }))}</div>
                  <div className={row}><span>Occupancy never above</span>{pct(s.occMax, n => setS({ ...s, occMax: n }))}</div>
                  <div className={row}><span>Revenue never moves more than ±</span>{pct(s.cap, n => setS({ ...s, cap: n }))}</div>
                  <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted mt-4 mb-1">The estimate line</p>
                  <textarea rows={3} value={s.note} onChange={e => setS({ ...s, note: e.target.value })} className="w-full rounded-lg border border-line px-2 py-1.5 text-[12.5px] text-ink" />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
                {msg ? <span className="text-[12.5px] text-muted">{msg}</span> : s.updatedAt ? <span className="text-[12px] text-muted">Last saved {new Date(s.updatedAt).toLocaleDateString()}{s.updatedBy ? ' by ' + s.updatedBy : ''}</span> : null}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

'use client'
// COMPARABLES FROM THE LIBRARY (Jon, 2026-11-11: "the projections library should be a place in the deck
// we can pull comps from, in the builder; also the ability to add custom ones we create manually; when
// generating a report we can select comps in the creator and in the builder").
//
// Lists every building in the Projections library (lib/sales-library). Open one to see its unit types
// (each with the range it projects) and its own comparables; tick any of them and add. A unit type comes
// in as a comparable carrying its yearly range, nightly rate and occupancy. A custom comparable can be
// typed in at the bottom. Used in the magazine builder, the deck's Floor plans & comps editor and the
// new-deck form.
import { useEffect, useState } from 'react'
import { Loader2, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { normalizeCma, planNumbers, newId, money, type PacketComp } from '@/lib/sales-cma'
export { bedKey, attachComps } from '@/lib/sales-comps'

type Row = { id: string; name: string; area: string; plans: number; comps: number }
type Opt = { key: string; comp: PacketComp; label: string; sub: string }
const dash = (a: number, b: number) => a ? (a === b ? money(a) : money(a) + '–' + money(b).slice(1)) : '—'

export function LibraryCompPicker({ onAdd, exclude, compact, dark }: { onAdd: (comps: PacketComp[]) => void; exclude?: string; compact?: boolean; dark?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [opts, setOpts] = useState<Record<string, Opt[]>>({})
  const [pick, setPick] = useState<Record<string, Opt>>({})
  const [custom, setCustom] = useState({ name: '', market: '', lo: '', hi: '', nlo: '', nhi: '', occ: '' })
  const [msg, setMsg] = useState('')

  useEffect(() => { fetch('/api/sales/buildings', { cache: 'no-store' }).then(r => r.json()).then(d => setRows(d?.ok ? d.buildings : [])).catch(() => setRows([])) }, [])

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    if (opts[id]) return
    try {
      const d = await fetch('/api/sales/buildings?id=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json())
      const b = d?.building; const cm = normalizeCma(b?.cma)
      if (!cm) return
      const fromPlans: Opt[] = cm.plans.map(p => ({ p, n: planNumbers(cm, p) })).filter(x => x.n.lo > 0).map(({ p, n }) => ({
        key: id + ':p:' + p.id, label: p.name, sub: dash(n.lo, n.hi) + ' a year' + (p.sf ? ' · ' + p.sf : ''),
        comp: { id: newId(), name: b.name + ' ' + p.name, market: b.area || '', basis: 'Stay projection, established listing', lo: n.lo, hi: n.hi, nightlyLo: n.nightlyLo, nightlyHi: n.nightlyHi, occLo: p.occLo, occHi: p.occHi },
      }))
      const fromComps: Opt[] = cm.comps.map(c => ({ key: id + ':c:' + c.id, label: c.name, sub: (c.grossText || dash(c.lo, c.hi)) + ' · comparable', comp: { ...c, id: newId() } }))
      setOpts(o => ({ ...o, [id]: [...fromPlans, ...fromComps] }))
    } catch { setMsg('Could not open that building.') }
  }
  const chosen = Object.values(pick)
  const n = (v: string) => { const x = Number(String(v).replace(/[$,%\s]/g, '').replace(/k$/i, '000')); return Number.isFinite(x) ? x : 0 }
  const addCustom = () => {
    if (!custom.name.trim() || !n(custom.lo)) { setMsg('A custom comparable needs a name and a yearly figure.'); return }
    const occ = custom.occ.split(/[-–to ]+/).map(n).filter(Boolean)
    onAdd([{ id: newId(), name: custom.name.trim(), market: custom.market.trim(), basis: 'Added by the sales team', lo: n(custom.lo), hi: n(custom.hi) || n(custom.lo), nightlyLo: n(custom.nlo), nightlyHi: n(custom.nhi) || n(custom.nlo), occLo: occ[0] || 0, occHi: occ[1] || occ[0] || 0 }])
    setCustom({ name: '', market: '', lo: '', hi: '', nlo: '', nhi: '', occ: '' }); setMsg('Custom comparable added.')
  }

  const ink = dark ? '#fff' : '#0F1640', line = dark ? 'rgba(255,255,255,.2)' : '#E3DED3', muted = dark ? 'rgba(255,255,255,.65)' : '#80859A'
  const box: React.CSSProperties = { width: '100%', minWidth: 0, font: '500 12.5px Inter, sans-serif', border: '1px solid ' + line, borderRadius: 8, padding: '6px 8px', color: '#0F1640', background: '#fff' }
  return (
    <div style={{ font: '400 12.5px Inter, sans-serif', color: ink }}>
      {!rows ? <p style={{ color: muted }}><Loader2 size={13} className="animate-spin" style={{ display: 'inline', marginRight: 6 }} />Loading the library…</p> : (
        <div style={{ border: '1px solid ' + line, borderRadius: 10, overflow: 'hidden', maxHeight: compact ? 260 : 360, overflowY: 'auto' }}>
          {rows.filter(r => r.id !== exclude).map(r => (
            <div key={r.id} style={{ borderBottom: '1px solid ' + line }}>
              <button type="button" onClick={() => toggle(r.id)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'none', border: 0, cursor: 'pointer', color: ink, textAlign: 'left' }}>
                {open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <b style={{ fontWeight: 600 }}>{r.name}</b><span style={{ color: muted }}>{[r.area, r.plans + ' unit types', r.comps + ' comps'].filter(Boolean).join(' · ')}</span>
              </button>
              {open === r.id && (
                <div style={{ padding: '0 10px 8px 32px' }}>
                  {!opts[r.id] ? <p style={{ color: muted }}>Loading…</p> : !opts[r.id].length ? <p style={{ color: muted }}>No figures in this building yet.</p> : opts[r.id].map(o => (
                    <label key={o.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!pick[o.key]} onChange={e => setPick(p => { const x = { ...p }; if (e.target.checked) x[o.key] = o; else delete x[o.key]; return x })} />
                      <span>{o.label}</span><span style={{ color: muted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{o.sub}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!rows.filter(r => r.id !== exclude).length && <p style={{ padding: 10, color: muted }}>The library is empty. Add buildings on Sales → Projections library.</p>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button type="button" disabled={!chosen.length} onClick={() => { onAdd(chosen.map(o => ({ ...o.comp, id: newId() }))); setMsg(chosen.length + ' comparable' + (chosen.length === 1 ? '' : 's') + ' added.'); setPick({}) }}
          style={{ font: '600 12.5px Inter, sans-serif', border: 0, borderRadius: 8, padding: '7px 12px', background: chosen.length ? (dark ? '#fff' : '#0F1640') : line, color: chosen.length ? (dark ? '#0F1640' : '#fff') : muted, cursor: chosen.length ? 'pointer' : 'default' }}>
          Add {chosen.length || ''} from the library
        </button>
        {msg && <span style={{ color: muted }}>{msg}</span>}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}><Plus size={12} style={{ display: 'inline', marginRight: 4 }} />Add a custom comparable</summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
          <input style={{ ...box, gridColumn: '1 / -1' }} placeholder="Name, e.g. Natiivo 1 bed" value={custom.name} onChange={e => setCustom(c => ({ ...c, name: e.target.value }))} />
          <input style={{ ...box, gridColumn: '1 / -1' }} placeholder="Market, e.g. Downtown, delivered 2025" value={custom.market} onChange={e => setCustom(c => ({ ...c, market: e.target.value }))} />
          <input style={box} placeholder="Gross low a year" inputMode="decimal" value={custom.lo} onChange={e => setCustom(c => ({ ...c, lo: e.target.value }))} />
          <input style={box} placeholder="Gross high a year" inputMode="decimal" value={custom.hi} onChange={e => setCustom(c => ({ ...c, hi: e.target.value }))} />
          <input style={box} placeholder="Nightly low" inputMode="decimal" value={custom.nlo} onChange={e => setCustom(c => ({ ...c, nlo: e.target.value }))} />
          <input style={box} placeholder="Nightly high" inputMode="decimal" value={custom.nhi} onChange={e => setCustom(c => ({ ...c, nhi: e.target.value }))} />
          <input style={{ ...box, gridColumn: '1 / -1' }} placeholder="Occupancy %, e.g. 70-75" value={custom.occ} onChange={e => setCustom(c => ({ ...c, occ: e.target.value }))} />
          <button type="button" onClick={addCustom} style={{ gridColumn: '1 / -1', font: '600 12.5px Inter, sans-serif', border: '1px solid ' + line, borderRadius: 8, padding: '7px 12px', background: '#fff', color: '#0F1640', cursor: 'pointer' }}>Add this comparable</button>
        </div>
      </details>
    </div>
  )
}


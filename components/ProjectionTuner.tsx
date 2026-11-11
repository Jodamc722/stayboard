'use client'
// THE PROJECTION BUILDER (Jon, 2026-11-11: "have a projection builder where you can scale the
// projections on the page, and adjust the months easily. An easy tool for our sales team to modify
// projections on the magazine and the report. Real amazing customizations, real tools").
//
// One floor plan's projection, hands-on:
//   • Scale — a slider from −40% to +40% on the whole range (plan.adjust), with quick steps.
//   • The months — drag any bar up or down, or type the figure under it. "Keep the yearly total"
//     moves money between months (the year stays put); off, the year becomes the sum of the months.
//   • The year — type the low and high by hand when the sales team knows better.
//   • Reset — back to the calculation from the comps.
// Every change goes through lib/sales-cma (setMonth, planNumbers), so the magazine and the keynote
// print exactly what this shows. Used on the Sales tab and in the magazine's edit drawer.
import { useRef, useState } from 'react'
import { RotateCcw, Lock, Unlock } from 'lucide-react'
import { planNumbers, setMonth, resetPlan, range, money, MONTHS, type SalesCma, type PacketPlan } from '@/lib/sales-cma'

const NAVY = '#111A4A', SAND = '#B59A6A', RULE = '#E3DED3', MUTED = '#80859A', INK = '#0F1640'
const num = (v: string) => { const n = parseFloat(String(v).replace(/[$,\sKk]/g, '')); return Number.isFinite(n) ? (/k/i.test(v) ? n * 1000 : n) : NaN }

export function ProjectionTuner({ cma, plan, onChange, compact }: { cma: SalesCma; plan: PacketPlan; onChange: (p: PacketPlan) => void; compact?: boolean }) {
  const n = planNumbers(cma, plan)
  const [keepYear, setKeepYear] = useState(true)
  const [drag, setDrag] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const H = compact ? 150 : 190
  const live = Math.max(...n.months.map(m => m.hi)) * 1.25 || 1
  // Frozen while dragging: a scale that grew with the bar would make it run away under the pointer.
  const frozen = useRef(live)
  const top = drag != null ? frozen.current : live
  const adj = plan.adjust || 0
  const touched = !!(adj || plan.season || (plan.override && plan.override.lo > 0))

  function valueAt(clientY: number) {
    const r = box.current?.getBoundingClientRect()
    if (!r) return 0
    const y = Math.min(r.bottom, Math.max(r.top, clientY))
    return Math.round(((r.bottom - y) / r.height) * top / 50) * 50
  }
  function onDown(i: number, e: React.PointerEvent) {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    frozen.current = live
    setDrag(i)
    onChange(setMonth(cma, plan, i, valueAt(e.clientY), keepYear))
  }
  function onMove(i: number, e: React.PointerEvent) {
    if (drag !== i) return
    onChange(setMonth(cma, plan, i, valueAt(e.clientY), keepYear))
  }

  return (
    <div className="pt-root" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: MUTED }}>Per year</p>
          <p style={{ margin: '2px 0 0', fontFamily: 'Fraunces, Georgia, serif', fontSize: compact ? 22 : 26, color: INK, fontVariantNumeric: 'lining-nums' }}>{range(n.lo, n.hi)}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: MUTED }}>{range(n.monthLo, n.monthHi)} a month · peak {money(n.peak)} in {n.peakMonth} · {money(n.nightlyLo)}–{money(n.nightlyHi)} a night</p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setKeepYear(k => !k)} title={keepYear ? 'Dragging a month moves money between months; the year stays the same' : 'Dragging a month changes the year'}
            style={pill(keepYear)}>{keepYear ? <Lock size={12} /> : <Unlock size={12} />} {keepYear ? 'Keep the yearly total' : 'Months set the year'}</button>
          {touched && <button type="button" onClick={() => onChange(resetPlan(plan))} title="Back to the calculation from the comparable set" style={pill(false)}><RotateCcw size={12} /> Reset</button>}
        </div>
      </div>

      {/* Scale */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: MUTED }}>Scale</span>
        <input type="range" min={-40} max={40} step={1} value={adj} onChange={e => onChange({ ...plan, adjust: Number(e.target.value) })} aria-label="Scale this projection"
          style={{ width: '100%', accentColor: NAVY }} />
        <span style={{ minWidth: 52, textAlign: 'right', fontWeight: 700, fontSize: 13, color: adj ? INK : MUTED, fontVariantNumeric: 'tabular-nums' }}>{adj > 0 ? '+' : ''}{adj}%</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {[-10, -5, 0, 5, 10, 15].map(v => (
          <button key={v} type="button" onClick={() => onChange({ ...plan, adjust: v })} style={{ ...chip, ...(adj === v ? { background: NAVY, color: '#fff', borderColor: NAVY } : {}) }}>{v > 0 ? '+' : ''}{v}%</button>
        ))}
      </div>

      {/* Months */}
      <p style={{ margin: '16px 0 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: MUTED }}>Months <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>· drag a bar or type the high-end figure</span></p>
      <div ref={box} style={{ position: 'relative', height: H, display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', alignItems: 'end', gap: 4, borderBottom: '1px solid ' + INK, touchAction: 'none', userSelect: 'none' }}>
        {[0.25, 0.5, 0.75].map(f => <div key={f} style={{ position: 'absolute', left: 0, right: 0, bottom: f * H, borderTop: '1px dashed ' + RULE, pointerEvents: 'none' }} />)}
        {n.months.map((m, i) => (
          <div key={i} onPointerDown={e => onDown(i, e)} onPointerMove={e => onMove(i, e)} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
            title={`${MONTHS[i]}: ${money(m.lo)} to ${money(m.hi)}. Drag to change.`}
            style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, cursor: 'ns-resize' }}>
            <span style={{ fontSize: 9.5, fontWeight: 600, color: drag === i ? NAVY : INK, position: 'absolute', bottom: (m.hi / top) * H + 4, whiteSpace: 'nowrap' }}>{'$' + (m.hi / 1000).toFixed(1) + 'K'}</span>
            <span style={{ width: '32%', height: (m.lo / top) * H, background: SAND, borderRadius: 2 }} />
            <span style={{ width: '32%', height: (m.hi / top) * H, background: drag === i ? '#3A5BD9' : NAVY, borderRadius: 2, boxShadow: drag === i ? '0 0 0 2px #fff, 0 0 0 3px #3A5BD9' : undefined }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4, marginTop: 6 }}>
        {n.months.map((m, i) => (
          <label key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 9.5, letterSpacing: '.08em', color: MUTED }}>{MONTHS[i].toUpperCase()}</span>
            <MonthInput value={m.hi} onCommit={v => onChange(setMonth(cma, plan, i, v, keepYear))} />
          </label>
        ))}
      </div>

      {/* The year by hand */}
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14, fontSize: 12, color: MUTED }}>
          <span>Set the year by hand</span>
          <MonthInput wide value={plan.override?.lo || 0} placeholder="low" onCommit={v => onChange({ ...plan, adjust: 0, override: { lo: v, hi: plan.override?.hi || n.hi } })} />
          <span>to</span>
          <MonthInput wide value={plan.override?.hi || 0} placeholder="high" onCommit={v => onChange({ ...plan, adjust: 0, override: { lo: plan.override?.lo || n.lo, hi: v } })} />
        </div>
      )}
    </div>
  )
}

/** A dollar box that commits on blur or Enter, so typing "9500" is not nine separate edits. */
function MonthInput({ value, onCommit, wide, placeholder }: { value: number; onCommit: (v: number) => void; wide?: boolean; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null)
  const shown = text != null ? text : value ? (wide ? Math.round(value).toLocaleString('en-US') : (value / 1000).toFixed(1) + 'K') : ''
  const commit = () => { if (text == null) return; const v = num(text); setText(null); if (Number.isFinite(v) && v >= 0) onCommit(!wide && v < 100 ? v * 1000 : v) }
  return (
    <input value={shown} placeholder={placeholder} inputMode="decimal" onChange={e => setText(e.target.value)} onFocus={e => { setText(shown); e.target.select() }} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur() } }}
      style={{ width: wide ? 96 : '100%', minWidth: 0, textAlign: 'center', fontSize: 11, padding: '4px 2px', border: '1px solid ' + RULE, borderRadius: 6, color: INK, background: '#fff', fontVariantNumeric: 'tabular-nums' }} />
  )
}

const chip: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, border: '1px solid ' + RULE, background: '#fff', color: INK, cursor: 'pointer' }
const pill = (on: boolean): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 999, border: '1px solid ' + (on ? NAVY : RULE), background: on ? '#EEF1FB' : '#fff', color: INK, cursor: 'pointer' })

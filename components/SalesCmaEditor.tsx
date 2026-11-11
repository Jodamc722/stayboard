'use client'
// FLOOR PLANS & COMPS — the editor for a sales deck's building pages (lib/sales-cma), on the Sales tab.
// Nick types the comparables and the floor plans; every range, nightly rate, monthly figure and peak
// is calculated (planNumbers) and shown as he types, exactly as the keynote slides and the magazine
// will print it. Saving writes content.cma on the deck's own owner_reports row — re-read just before
// the write so an edit made in the deck meanwhile is not lost.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, X, Check, BookOpen, Presentation, Wand2 } from 'lucide-react'
import {
  normalizeCma, riderTemplate, blankCma, planNumbers, range, money, suggestHow, newId,
  type SalesCma, type PacketComp, type PacketPlan,
} from '@/lib/sales-cma'

type Any = any
const num = (v: string) => { const n = parseFloat(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0 }
const inp = 'w-full min-w-0 rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink'
const lab = 'text-[10.5px] uppercase tracking-wider text-muted font-semibold'

/** Lines of "Title | text" ⇄ pairs, for the wording blocks that are lists of two things. */
const pairsToText = (p: [string, string][]) => p.map(([a, b]) => a + ' | ' + b).join('\n')
const textToPairs = (t: string): [string, string][] => t.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf('|'); return i < 0 ? [l, ''] as [string, string] : [l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string] })

export function SalesCmaEditor({ report, onClose }: { report: { id: string; code: string; scope_label: string | null }; onClose: () => void }) {
  const [cma, setCma] = useState<SalesCma | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [dirty, setDirty] = useState(false)
  const [wordOpen, setWordOpen] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/reports?id=' + encodeURIComponent(report.id), { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (!live) return
      setCma(normalizeCma(d?.report?.content?.cma))
      setLoading(false)
    }).catch(() => { if (live) { setMsg('Could not load this deck.'); setLoading(false) } })
    return () => { live = false }
  }, [report.id])

  const set = (f: (c: SalesCma) => SalesCma) => { setCma(c => c ? f(structuredClone(c)) : c); setDirty(true); setMsg('') }

  async function save(next?: SalesCma | null) {
    const value = next === undefined ? cma : next
    setBusy(true); setMsg('')
    try {
      const fresh = await fetch('/api/reports?id=' + encodeURIComponent(report.id), { cache: 'no-store' }).then(r => r.json())
      const content = { ...(fresh?.report?.content || {}), cma: value }
      const r = await fetch('/api/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: report.id, content }) })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Save failed')
      setDirty(false); setMsg('Saved. The magazine and the keynote show it now.')
    } catch (e: Any) { setMsg(e?.message || 'Save failed') }
    setBusy(false)
  }

  const nums = useMemo(() => cma ? cma.plans.map(p => planNumbers(cma, p)) : [], [cma])

  const shell = (body: React.ReactNode) => (
    <section className="rounded-2xl border border-ink/20 bg-white p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-[14px] font-bold text-ink mr-auto">Floor plans &amp; comps <span className="text-muted font-normal">· {report.scope_label || 'Sales deck'}</span></h2>
        <a href={'/r/' + report.code + '?view=magazine'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app"><BookOpen size={13} /> Magazine</a>
        <a href={'/r/' + report.code} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app"><Presentation size={13} /> Keynote</a>
        {cma && <button type="button" disabled={busy || !dirty} onClick={() => save()} className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-3 py-1 text-[12px] font-semibold disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>}
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:text-ink"><X size={16} /></button>
      </div>
      {msg && <p role="status" className="text-[12.5px] text-muted">{msg}</p>}
      {body}
    </section>
  )

  if (loading) return shell(<p className="text-[13px] text-muted"><Loader2 size={13} className="inline animate-spin mr-1.5" />Loading…</p>)
  if (!cma) return shell(
    <div className="flex items-center gap-2 flex-wrap">
      <p className="text-[13px] text-muted mr-2">This deck has no building pages yet.</p>
      <button type="button" onClick={() => { const c = blankCma(report.scope_label || '', ''); setCma(c); setDirty(true) }} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-app">Start blank for this building</button>
      <button type="button" onClick={() => { setCma(riderTemplate()); setDirty(true) }} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-app">Start from The Rider example</button>
    </div>,
  )

  const comp = (i: number, patch: Partial<PacketComp>) => set(c => { c.comps[i] = { ...c.comps[i], ...patch }; return c })
  const plan = (i: number, patch: Partial<PacketPlan>) => set(c => { c.plans[i] = { ...c.plans[i], ...patch }; return c })
  const S = cma.sections

  return shell(
    <div className="space-y-5">
      {/* The building and which pages print */}
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.6fr_0.6fr]">
        <label className="block"><span className={lab}>Building</span><input className={inp} value={cma.building} onChange={e => set(c => ({ ...c, building: e.target.value }))} /></label>
        <label className="block"><span className={lab}>Area</span><input className={inp} value={cma.area} onChange={e => set(c => ({ ...c, area: e.target.value }))} /></label>
        <label className="block" title="New-build uplift at the low end of every range"><span className={lab}>Uplift low %</span><input className={inp} inputMode="decimal" value={cma.uplift.lo} onChange={e => set(c => ({ ...c, uplift: { ...c.uplift, lo: num(e.target.value) } }))} /></label>
        <label className="block" title="New-build uplift at the high end of every range"><span className={lab}>Uplift high %</span><input className={inp} inputMode="decimal" value={cma.uplift.hi} onChange={e => set(c => ({ ...c, uplift: { ...c.uplift, hi: num(e.target.value) } }))} /></label>
      </div>
      <label className="block"><span className={lab}>Why the uplift (finishes the sentence “…raised X% at the low end and Y% at the high end,”)</span><input className={inp} value={cma.uplift.why} onChange={e => set(c => ({ ...c, uplift: { ...c.uplift, why: e.target.value } }))} /></label>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {([['partner', 'Agent partner program'], ['second', 'Stay as a second option'], ['market', 'Market and comps'], ['glance', 'Floor plans at a glance'], ['plans', 'One page per floor plan']] as [keyof SalesCma['sections'], string][]).map(([k, l]) => (
          <label key={k} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink">
            <input type="checkbox" checked={!!S[k]} onChange={e => set(c => ({ ...c, sections: { ...c.sections, [k]: e.target.checked } }))} /> {l}
          </label>
        ))}
      </div>

      {/* Comparables */}
      <div>
        <div className="flex items-center gap-2 mb-1.5"><h3 className="text-[13px] font-bold text-ink">Comparable set</h3><span className="text-[12px] text-muted">Low and high are the gross per year the ranges are built from.</span></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[12px]">
            <thead><tr className="text-left text-muted">{['Comparable', 'Market', 'Basis', 'Gross shown as (optional)', 'Low $', 'High $', 'Nightly low', 'Nightly high', 'Occ. low %', 'Occ. high %', ''].map(h => <th key={h} className="px-1 pb-1 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {cma.comps.map((x, i) => (
                <tr key={x.id}>
                  <td className="p-1 w-[16%]"><input className={inp} value={x.name} onChange={e => comp(i, { name: e.target.value })} /></td>
                  <td className="p-1 w-[12%]"><input className={inp} value={x.market} onChange={e => comp(i, { market: e.target.value })} /></td>
                  <td className="p-1 w-[12%]"><input className={inp} value={x.basis} onChange={e => comp(i, { basis: e.target.value })} /></td>
                  <td className="p-1 w-[13%]"><input className={inp} value={x.grossText || ''} placeholder={range(x.lo, x.hi)} onChange={e => comp(i, { grossText: e.target.value })} /></td>
                  {(['lo', 'hi', 'nightlyLo', 'nightlyHi', 'occLo', 'occHi'] as const).map(f => (
                    <td key={f} className="p-1"><input className={inp} inputMode="decimal" value={x[f] || ''} onChange={e => comp(i, { [f]: num(e.target.value) } as Any)} /></td>
                  ))}
                  <td className="p-1"><button type="button" title="Remove this comparable" onClick={() => set(c => ({ ...c, comps: c.comps.filter((_, j) => j !== i), plans: c.plans.map(p => ({ ...p, compIds: p.compIds.filter(id => id !== x.id) })) }))} className="p-1 text-muted hover:text-red-600"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => set(c => ({ ...c, comps: [...c.comps, { id: newId(), name: '', market: '', basis: 'Stay projection, fully ramped', lo: 0, hi: 0, nightlyLo: 0, nightlyHi: 0, occLo: 70, occHi: 75 }] }))}
          className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app"><Plus size={13} /> Add comparable</button>
      </div>

      {/* Floor plans */}
      <div>
        <div className="flex items-center gap-2 mb-1.5"><h3 className="text-[13px] font-bold text-ink">Floor plans</h3><span className="text-[12px] text-muted">Range = comparable × scale × (1 − lockout %) × uplift. Type a range to set it by hand.</span></div>
        <div className="space-y-2.5">
          {cma.plans.map((p, i) => { const n = nums[i]; return (
            <div key={p.id} className="rounded-xl border border-line p-3 space-y-2">
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-[1.3fr_1fr_0.9fr_1.4fr_0.55fr_0.6fr_0.5fr_0.55fr_0.55fr_auto]">
                <label><span className={lab}>Floor plan</span><input className={inp} value={p.name} onChange={e => plan(i, { name: e.target.value })} /></label>
                <label><span className={lab}>Size</span><input className={inp} value={p.sf} onChange={e => plan(i, { sf: e.target.value })} /></label>
                <label><span className={lab}>From price</span><input className={inp} value={p.price} onChange={e => plan(i, { price: e.target.value })} /></label>
                <label><span className={lab}>Built from</span>
                  <select className={inp} value={p.baseId} onChange={e => plan(i, { baseId: e.target.value })}>
                    {cma.comps.map(x => <option key={x.id} value={x.id}>{x.name || 'Unnamed comparable'}</option>)}
                  </select>
                </label>
                <label title="1 = the comparable as is; 1.45 = two-bedroom from a one-bedroom"><span className={lab}>Scale ×</span><input className={inp} inputMode="decimal" value={p.scale} onChange={e => plan(i, { scale: num(e.target.value) || 1 })} /></label>
                <label title="Lockouts: less this % for shared turnover and one entry"><span className={lab}>Less %</span><input className={inp} inputMode="decimal" value={p.less} onChange={e => plan(i, { less: num(e.target.value) })} /></label>
                <label title="Separate listings in the unit; the nightly rate is shown per suite"><span className={lab}>Suites</span><input className={inp} inputMode="numeric" value={p.suites} onChange={e => plan(i, { suites: Math.max(1, Math.round(num(e.target.value)) || 1) })} /></label>
                <label><span className={lab}>Occ. low %</span><input className={inp} inputMode="decimal" value={p.occLo} onChange={e => plan(i, { occLo: num(e.target.value) })} /></label>
                <label><span className={lab}>Occ. high %</span><input className={inp} inputMode="decimal" value={p.occHi} onChange={e => plan(i, { occHi: num(e.target.value) })} /></label>
                <button type="button" title="Remove this floor plan" onClick={() => set(c => ({ ...c, plans: c.plans.filter((_, j) => j !== i) }))} className="self-end p-1.5 text-muted hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
                <span className="text-muted">Comps on its page:</span>
                {cma.comps.map(x => (
                  <label key={x.id} className="inline-flex items-center gap-1 text-ink">
                    <input type="checkbox" checked={p.compIds.includes(x.id)} onChange={e => plan(i, { compIds: e.target.checked ? [...p.compIds, x.id] : p.compIds.filter(id => id !== x.id) })} /> {x.name || 'Unnamed'}
                  </label>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="block"><span className={lab}>How we got there</span>
                  <textarea rows={2} className={inp} value={p.how} onChange={e => plan(i, { how: e.target.value })} />
                </label>
                <button type="button" onClick={() => plan(i, { how: suggestHow(cma, p) })} title="Write it from the numbers" className="self-end inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:bg-app"><Wand2 size={13} /> Write it</button>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg bg-app px-3 py-2 text-[12.5px]">
                <span><b className="text-ink">{range(n.lo, n.hi)}</b> <span className="text-muted">a year</span></span>
                <span><b className="text-ink">{range(n.monthLo, n.monthHi)}</b> <span className="text-muted">a month</span></span>
                <span><b className="text-ink">{money(n.nightlyLo)}–{money(n.nightlyHi)}</b> <span className="text-muted">a night{p.suites > 1 ? ' per suite' : ''}</span></span>
                <span><span className="text-muted">peak</span> <b className="text-ink">{money(n.peak)}</b> <span className="text-muted">{n.peakMonth}</span></span>
                <span className="ml-auto inline-flex items-center gap-1.5 text-muted">Set by hand
                  <input className={inp + ' w-24'} placeholder="low" inputMode="decimal" value={p.override?.lo || ''} onChange={e => plan(i, { override: { lo: num(e.target.value), hi: p.override?.hi || 0 } })} />
                  <input className={inp + ' w-24'} placeholder="high" inputMode="decimal" value={p.override?.hi || ''} onChange={e => plan(i, { override: { lo: p.override?.lo || 0, hi: num(e.target.value) } })} />
                </span>
              </div>
            </div>
          ) })}
        </div>
        <button type="button" disabled={!cma.comps.length} title={cma.comps.length ? '' : 'Add a comparable first'}
          onClick={() => set(c => ({ ...c, plans: [...c.plans, { id: newId(), name: '', sf: '', price: '', rules: 'Short-term rentals allowed', compIds: c.comps.slice(0, 2).map(x => x.id), baseId: c.comps[0].id, scale: 1, less: 0, suites: 1, occLo: 70, occHi: 75, how: '', override: null }] }))}
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app disabled:opacity-40"><Plus size={13} /> Add floor plan</button>
      </div>

      {/* Market */}
      <label className="block"><span className={lab}>Market snapshot — one per line: Title | text</span>
        <textarea rows={6} className={inp} value={pairsToText(cma.market.bullets)} onChange={e => set(c => ({ ...c, market: { ...c.market, bullets: textToPairs(e.target.value) } }))} />
      </label>

      {/* Wording */}
      <div>
        <button type="button" onClick={() => setWordOpen(o => !o)} className="text-[12.5px] font-semibold text-ink underline underline-offset-2">{wordOpen ? 'Hide' : 'Edit'} the partner program and second-option wording</button>
        {wordOpen && (
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <label className="block"><span className={lab}>Partner program intro</span><textarea rows={2} className={inp} value={cma.partner.lead} onChange={e => set(c => ({ ...c, partner: { ...c.partner, lead: e.target.value } }))} /></label>
            <label className="block"><span className={lab}>Referral fees — Amount | for what</span><textarea rows={3} className={inp} value={pairsToText(cma.partner.fees)} onChange={e => set(c => ({ ...c, partner: { ...c.partner, fees: textToPairs(e.target.value) } }))} /></label>
            <label className="block"><span className={lab}>Partner cards — Title | text</span><textarea rows={4} className={inp} value={pairsToText(cma.partner.cards)} onChange={e => set(c => ({ ...c, partner: { ...c.partner, cards: textToPairs(e.target.value) } }))} /></label>
            <label className="block"><span className={lab}>At this building — one per line</span><textarea rows={4} className={inp} value={cma.partner.here.join('\n')} onChange={e => set(c => ({ ...c, partner: { ...c.partner, here: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) } }))} /></label>
            <label className="block"><span className={lab}>Second option — owners choose their manager</span><textarea rows={4} className={inp} value={cma.second.choose} onChange={e => set(c => ({ ...c, second: { ...c.second, choose: e.target.value } }))} /></label>
            <label className="block"><span className={lab}>Questions buyers ask — Question | answer</span><textarea rows={7} className={inp} value={pairsToText(cma.second.qa)} onChange={e => set(c => ({ ...c, second: { ...c.second, qa: textToPairs(e.target.value) } }))} /></label>
            <label className="block lg:col-span-2"><span className={lab}>Fine print</span><textarea rows={3} className={inp} value={cma.disclaimer} onChange={e => set(c => ({ ...c, disclaimer: e.target.value }))} /></label>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => { if (window.confirm('Remove the building pages from this deck?')) { setCma(null); save(null) } }} className="text-[12px] text-muted hover:text-red-600">Remove the building pages</button>
      </div>
    </div>,
  )
}

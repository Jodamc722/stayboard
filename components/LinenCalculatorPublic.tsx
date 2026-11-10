'use client'
// THE LINEN CALCULATOR, FOR ANYONE WITH THE LINK (Jon, 2026-11-10) — /kit/linens. The same arithmetic
// as Onboarding → Linens (lib/linens.ts linenNeeds / linenTotals) on Jon's standard, without prices,
// vendors or SKUs. FOUR INPUTS (Jon, 2026-11-10: "linen will just be bed type, kitchen number, full
// bathrooms, and occupancy"): beds by type, occupancy, full bathrooms, kitchens. Bedrooms is not asked;
// the one per-bedroom item (throw blanket) goes by the beds that are not sofa beds. Several units add up to a full order. Each person who
// opens the link starts blank; nothing is saved and the address never changes.
import { useEffect, useMemo, useState } from 'react'
import { Bath, BedDouble, ChefHat, ClipboardCopy, Copy, ExternalLink, FileSpreadsheet, Link2, Minus, Package, Plus, RotateCcw, Trash2, Users } from 'lucide-react'
import { LINEN_GROUPS, LINEN_TIERS, SOFA_BED, linenNeeds, linenTotals, linenText, parSentence, tierOf, type LinenStandard, type LinenTier, type LinenUnit } from '@/lib/linens'
import { linenShopUrl, publicTierLabel } from '@/lib/linens-public'

type U = { name: string; bathrooms: number; guests: number; kitchens: number; beds: Record<string, number> }
const blank = (name = 'This home'): U => ({ name, bathrooms: 2, guests: 6, kitchens: 1, beds: { King: 1, Queen: 1 } })
/** Bedrooms for the per-bedroom items: the beds that are not sofa beds, at least one. */
const roomsOf = (beds: Record<string, number>) => Math.max(1, Object.entries(beds).filter(([s]) => s !== SOFA_BED).reduce((a, [, n]) => a + (n || 0), 0))
const toUnit = (u: U, i: number): LinenUnit => ({ id: 'u' + i, name: u.name, bedrooms: roomsOf(u.beds), bathrooms: u.bathrooms, guests: u.guests, kitchens: u.kitchens, beds: u.beds, bedsSource: 'manual' })
const GROUP_NOTE: Record<string, string> = { Bed: 'Sized to each bed', Bath: 'Per guest and per full bathroom', Kitchen: 'Per kitchen', Other: 'Per bed (sofa beds not counted)' }

export function LinenCalculatorPublic({ standard }: { standard: LinenStandard }) {
  const [units, setUnits] = useState<U[]>([blank()])
  const [view, setView] = useState<number | 'order'>(0)
  const [tier, setTier] = useState<LinenTier>('mid')
  const [copied, setCopied] = useState('')
  useEffect(() => { try { if (window.location.search) window.history.replaceState(null, '', '/kit/linens') } catch { /* fine */ } }, [])

  const multi = units.length > 1
  const idx = view === 'order' ? -1 : Math.min(view, units.length - 1)
  const u = idx >= 0 ? units[idx] : null
  const set = (patch: Partial<U>) => setUnits(us => us.map((x, i) => (i === idx ? { ...x, ...patch } : x)))
  const setBed = (size: string, n: number) => u && set({ beds: { ...u.beds, [size]: Math.max(0, Math.min(20, n)) } })
  const addUnit = (copyOf?: U) => setUnits(us => {
    const base = us.map(x => (us.length === 1 && x.name === 'This home' ? { ...x, name: 'Unit 1' } : x))
    const src = copyOf || base[base.length - 1]
    const next = [...base, { ...JSON.parse(JSON.stringify(src)), name: copyOf ? `${src.name} (copy)` : `Unit ${base.length + 1}` }]
    setView(next.length - 1)
    return next
  })
  const removeUnit = () => { setUnits(us => us.filter((_, i) => i !== idx)); setView(0) }
  const startOver = () => { setUnits([blank()]); setView(0); setTier('mid') }

  const lus = useMemo(() => units.map(toUnit), [units])
  const one = useMemo(() => (idx >= 0 ? linenTotals(standard, [lus[idx]], tier) : null), [standard, lus, idx, tier])
  const perUnit = useMemo(() => lus.map(x => linenTotals(standard, [x], tier)), [standard, lus, tier])
  const all = useMemo(() => linenTotals(standard, lus, tier), [standard, lus, tier])
  const needsOf = useMemo(() => (idx >= 0 ? linenNeeds(standard, lus[idx]) : []), [standard, lus, idx])
  const itemById = useMemo(() => new Map(standard.items.map(i => [i.id, i] as const)), [standard])
  const productOf = (id: string) => { const it = itemById.get(id); return it ? tierOf(it, tier).product || '' : '' }
  const shop = (id: string, name: string, size?: string) => <a className="nlc-shop" href={linenShopUrl(productOf(id), name, size)} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Shop</a>
  const rowNeed = (key: string) => needsOf.find(r => r.itemId + '|' + (r.size || '') === key)

  const flash = (w: string) => { setCopied(w); setTimeout(() => setCopied(''), 1800) }
  const copyText = async (t: string, w: string) => { try { await navigator.clipboard.writeText(t); flash(w) } catch { window.prompt('Copy this', t) } }
  const xlsx = '/api/public/linens/xlsx?t=' + tier + '&u=' + encodeURIComponent(JSON.stringify(units.map(x => ({ n: x.name, bd: roomsOf(x.beds), ba: x.bathrooms, g: x.guests, k: x.kitchens, beds: x.beds }))))
  const bedSizes = standard.bedSizes
  const beds = u ? Object.values(u.beds).reduce((a, b) => a + (b || 0), 0) : 0

  return (
    <div className="nlc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="nlc-wrap">
        <header className="nlc-head"><img src="/stay-logo.png" alt="Stay Hospitality" className="nlc-logo" /></header>
        <div className="nlc-eyebrow">Linen calculator</div>
        <h1>{multi ? 'Linen for your units' : 'Linen for your home'}</h1>
        <p className="nlc-lede">Enter the beds, occupancy, full bathrooms and kitchens and the list sizes itself: every sheet, towel and pillow, at {parSentence(standard) || `${standard.par} sets in rotation`}. One set on the bed, one in the wash, one on the shelf. Onboarding several units? Add each one for the full order. Your changes are only on your screen.</p>

        <div className="nlc-tabs" role="tablist" aria-label="Units">
          {multi && units.map((x, i) => (
            <button key={i} type="button" role="tab" aria-selected={view === i} className={view === i ? 'on' : ''} onClick={() => setView(i)}>{x.name || `Unit ${i + 1}`}<small>{Object.values(x.beds).reduce((a, b) => a + b, 0)} beds · sleeps {x.guests}</small></button>
          ))}
          <button type="button" className="nlc-add" onClick={() => addUnit()}><Plus size={14} /> Add unit</button>
          {multi && <button type="button" role="tab" aria-selected={view === 'order'} className={'nlc-ordertab' + (view === 'order' ? ' on' : '')} onClick={() => setView('order')}><Package size={14} /> Full order</button>}
        </div>

        {u && (
          <section className="nlc-panel" aria-label="The home">
            {multi && (
              <div className="nlc-uhead">
                <input aria-label="Unit name" value={u.name} onChange={e => set({ name: e.target.value.slice(0, 40) })} placeholder="Unit name, e.g. 302" />
                <button type="button" onClick={() => addUnit(u)}><Copy size={13} /> Same layout</button>
                <button type="button" onClick={removeUnit} className="nlc-del"><Trash2 size={13} /> Remove</button>
              </div>
            )}
            <div className="nlc-beds">
              <span className="nlc-l"><BedDouble size={15} /> Beds by type <small className="nlc-bedn">{beds} bed{beds === 1 ? '' : 's'}</small></span>
              <div className="nlc-bedgrid">
                {bedSizes.map(sz => (
                  <div key={sz} className={'nlc-bed' + ((u.beds[sz] || 0) > 0 ? ' on' : '')}>
                    <span>{sz}{sz === SOFA_BED ? <small>linen as {standard.sofaSize}</small> : null}</span>
                    <Step v={u.beds[sz] || 0} label={sz + ' beds'} onChange={n => setBed(sz, n)} small />
                  </div>
                ))}
              </div>
            </div>
            <div className="nlc-counts">
              {([['guests', 'Occupancy', Users, 1, 50], ['bathrooms', 'Full bathrooms', Bath, 0, 20], ['kitchens', 'Kitchens', ChefHat, 0, 10]] as const).map(([k, label, Icon, lo, hi]) => (
                <div key={k} className="nlc-count">
                  <span className="nlc-l"><Icon size={15} /> {label}</span>
                  <Step v={u[k]} label={label} onChange={n => set({ [k]: Math.max(lo, Math.min(hi, n)) } as any)} />
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="nlc-bar">
          <div className="nlc-grade" role="radiogroup" aria-label="Linen tier">
            {LINEN_TIERS.map(t => <button key={t} type="button" role="radio" aria-checked={tier === t} className={tier === t ? 'on' : ''} onClick={() => setTier(t)}>{publicTierLabel(standard.tierLabels[t])}</button>)}
          </div>
          <div className="nlc-acts">
            <button type="button" onClick={() => copyText(window.location.origin + '/kit/linens', 'link')}><Link2 size={14} /> {copied === 'link' ? 'Link copied' : 'Copy link'}</button>
            <button type="button" onClick={() => copyText(linenText(view === 'order' ? all : one || all, `Linen — ${view === 'order' ? units.length + ' units' : u?.name} (${publicTierLabel(standard.tierLabels[tier])})`), 'list')}><ClipboardCopy size={14} /> {copied === 'list' ? 'Copied' : 'Copy list'}</button>
            <a href={xlsx}><FileSpreadsheet size={14} /> Excel</a>
            <button type="button" onClick={startOver}><RotateCcw size={14} /> Start over</button>
          </div>
        </div>

        {view === 'order' ? (
          <div className="nlc-scroll">
            <table className="nlc-t nlc-order">
              <thead><tr><th>Item</th>{units.map((x, i) => <th key={i} className="n">{x.name}</th>)}<th className="n">Total</th><th /></tr></thead>
              {LINEN_GROUPS.map(g => {
                const rows = all.rows.filter(r => r.group === g && r.need > 0)
                if (!rows.length) return null
                return (
                  <tbody key={g}>
                    <tr className="cat"><td colSpan={units.length + 3}>{g}</td></tr>
                    {rows.map(r => (
                      <tr key={r.key}>
                        <td><b>{r.name}</b>{r.size ? <small>{r.size}</small> : null}{productOf(r.itemId) ? <small>{productOf(r.itemId)}</small> : null}</td>
                        {perUnit.map((p, i) => <td key={i} className="n">{p.rows.find(x => x.key === r.key)?.need || '—'}</td>)}
                        <td className="n"><span className="nlc-q">{r.need}</span></td>
                        <td className="n">{shop(r.itemId, r.name, r.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
        ) : one ? (
          <table className="nlc-t">
            <thead><tr><th>Item</th><th className="n">On the bed</th><th className="n">Needed</th></tr></thead>
            {LINEN_GROUPS.map(g => {
              const rows = one.rows.filter(r => r.group === g && r.need > 0)
              if (!rows.length) return null
              return (
                <tbody key={g}>
                  <tr className="cat"><td colSpan={3}><div className="nlc-grp"><span>{g}</span><span className="nlc-grp-n">{rows.reduce((a, r) => a + r.need, 0)} pieces</span></div><small className="nlc-grp-d">{GROUP_NOTE[g]}</small></td></tr>
                  {rows.map(r => {
                    const n = rowNeed(r.key)
                    return (
                      <tr key={r.key}>
                        <td><b>{r.name}{r.size ? ` · ${r.size}` : ''}</b><small>{productOf(r.itemId)}{productOf(r.itemId) ? ' · ' : ''}{shop(r.itemId, r.name, r.size)}</small></td>
                        <td className="n">{n ? <>{n.perUnitQty}{n.par !== 1 ? <small>× {n.par} in rotation</small> : <small>stocked once</small>}</> : '—'}</td>
                        <td className="n"><span className="nlc-q">{r.need}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              )
            })}
          </table>
        ) : null}
        <p className="nlc-fine">Counts follow Stay’s linen standard: {parSentence(standard) || `${standard.par} sets in rotation`}. Pillows are stocked per bed; pillow protectors and cases are counted per pillow. A sofa bed takes {standard.sofaSize} linen at {standard.sofaPar} sets. Kitchen towels are per kitchen; bath towels and washcloths follow occupancy; hand towels, makeup towels and bath mats follow full bathrooms. Shop links open an Amazon search for that tier of each piece. Prices are quoted separately by Stay.</p>
      </main>
    </div>
  )
}

function Step({ v, label, onChange, small }: { v: number; label: string; onChange: (n: number) => void; small?: boolean }) {
  return (
    <div className={'nlc-step' + (small ? ' sm' : '')}>
      <button type="button" aria-label={'Fewer ' + label} onClick={() => onChange(v - 1)}><Minus size={small ? 14 : 16} /></button>
      <input aria-label={label} type="number" value={v} onChange={e => onChange(Math.round(+e.target.value) || 0)} />
      <button type="button" aria-label={'More ' + label} onClick={() => onChange(v + 1)}><Plus size={small ? 14 : 16} /></button>
    </div>
  )
}

const CSS = `
.nlc{--paper:#fff;--ground:#EEF1F0;--ink:#15212B;--muted:#6B7880;--line:#DCE2E0;--accent:#1F5F5B;--soft:#E2EFED;--display:'Instrument Serif',Georgia,serif;--ui:'Geist','Inter',system-ui,sans-serif;
  background:var(--ground);color:var(--ink);font-family:var(--ui);font-size:14.5px;line-height:1.45;min-height:100vh;color-scheme:light;padding-block:24px 48px}
.nlc *{box-sizing:border-box}
.nlc-wrap{max-width:860px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:28px max(20px,env(safe-area-inset-right,0px)) 28px max(20px,env(safe-area-inset-left,0px))}
@media (min-width:700px){.nlc-wrap{padding:36px 40px}}
.nlc-head{margin-bottom:24px}.nlc-logo{height:28px;width:auto}
.nlc-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600}
.nlc h1{font-family:var(--display);font-weight:400;font-size:clamp(34px,6vw,46px);line-height:1.05;margin:6px 0 8px}
.nlc-lede{color:var(--muted);margin:0 0 20px;max-width:64ch}
.nlc-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.nlc-tabs button{display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px;border:1px solid var(--line);background:var(--paper);border-radius:12px;padding:7px 12px;font:600 13.5px var(--ui);color:var(--ink);cursor:pointer}
.nlc-tabs button small{font-weight:400;font-size:11.5px;color:var(--muted)}
.nlc-tabs button.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:var(--soft)}
.nlc-tabs .nlc-add,.nlc-tabs .nlc-ordertab{flex-direction:row;align-items:center;gap:6px}
.nlc-tabs .nlc-add{border-style:dashed;color:var(--accent)}
.nlc-tabs .nlc-ordertab{background:var(--ink);color:#fff;border-color:var(--ink)}.nlc-tabs .nlc-ordertab.on{background:var(--accent);border-color:var(--accent);box-shadow:none}
.nlc-panel{border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;gap:14px}
.nlc-uhead{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.nlc-uhead input{flex:1 1 180px;min-width:0;border:1px solid var(--line);border-radius:10px;padding:8px 12px;font:600 15px var(--ui);color:var(--ink)}
.nlc-uhead button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:7px 12px;font:600 12.5px var(--ui);color:var(--ink);cursor:pointer}
.nlc-uhead .nlc-del{color:#A3302A}
.nlc-counts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.nlc-count{display:grid;gap:6px}
.nlc-l{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);font-weight:500}
.nlc-bedn{margin-left:auto;font-size:12.5px;color:var(--ink)}
.nlc-step{display:flex;align-items:center;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:var(--paper)}
.nlc-step button{border:0;background:none;width:40px;height:40px;display:grid;place-items:center;cursor:pointer;color:var(--ink)}.nlc-step button:hover{background:var(--soft)}
.nlc-step input{border:0;width:100%;min-width:0;text-align:center;font:400 24px var(--display);color:var(--ink);background:none;-moz-appearance:textfield}
.nlc-step.sm button{width:32px;height:32px}.nlc-step.sm input{font-size:20px}
.nlc-step input::-webkit-outer-spin-button,.nlc-step input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.nlc-beds{display:grid;gap:8px}
.nlc-beds + .nlc-counts{border-top:1px solid var(--line);padding-top:14px}
.nlc-bedgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.nlc-bed{display:grid;gap:6px;border:1px solid var(--line);border-radius:12px;padding:10px}.nlc-bed.on{border-color:var(--accent);background:var(--soft)}
.nlc-bed span{font-weight:600;font-size:13.5px}.nlc-bed small{display:block;font-weight:400;font-size:11.5px;color:var(--muted)}
.nlc-kit{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding-top:14px}
.nlc-yn{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px}
.nlc-yn button{border:0;background:none;border-radius:999px;padding:6px 18px;font:600 13.5px var(--ui);color:var(--muted);cursor:pointer}.nlc-yn button.on{background:var(--ink);color:#fff}
.nlc button:focus-visible,.nlc a:focus-visible,.nlc input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.nlc-bar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin:22px 0 6px}
.nlc-grade{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px}
.nlc-grade button{border:0;background:none;border-radius:999px;padding:6px 14px;font:600 13px var(--ui);color:var(--muted);cursor:pointer}.nlc-grade button.on{background:var(--accent);color:#fff}
.nlc-acts{display:flex;flex-wrap:wrap;gap:8px}
.nlc-acts button,.nlc-acts a{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:7px 13px;font:600 13px var(--ui);color:var(--ink);cursor:pointer;text-decoration:none}
.nlc-acts button:hover,.nlc-acts a:hover{border-color:var(--ink)}
.nlc-scroll{overflow-x:auto}
.nlc-t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.nlc-order{min-width:480px}
.nlc-t th{text-align:left;font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--ink)}
.nlc-t td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.nlc-t td small{display:block;color:var(--muted);font-size:12px;font-weight:400}
.nlc-t .n{text-align:right}
.nlc-t tr.cat td{font-family:var(--display);font-size:20px;padding-top:20px;border-bottom:1px solid var(--ink)}
.nlc-grp{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.nlc-grp-n{font-family:var(--ui);font-size:12.5px;color:var(--muted)}
.nlc-grp-d{display:block;font-family:var(--ui);font-size:12.5px;color:var(--muted);margin-top:2px}
.nlc-shop{display:inline-flex;align-items:center;gap:4px;color:var(--accent);font:600 12.5px var(--ui);text-decoration:none;white-space:nowrap}.nlc-shop:hover{text-decoration:underline}
.nlc-q{font-family:var(--display);font-size:24px}
.nlc-fine{margin-top:22px;font-size:12.5px;color:var(--muted)}
@media (max-width:560px){.nlc-counts{grid-template-columns:1fr}}
@media print{.nlc{background:#fff;padding:0}.nlc-wrap{border:0}.nlc-panel,.nlc-acts,.nlc-tabs{display:none}}
`

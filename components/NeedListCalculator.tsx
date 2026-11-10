'use client'
// THE NEED LIST CALCULATOR (Jon, 2026-11-10) — /kit/list, open to anyone. The home's details in, the
// list out: every item, must-have or recommended (optional on request), and how many, grouped into the
// sets things are bought in. Like the linen calculator.
// ONE CLEAN LINK, EACH PERSON THEIR OWN LIST (Jon, 2026-11-10: "have the link refresh and clear it out,
// make it per person who clicks in can modify it"): /kit/list always opens on a blank, default home;
// whatever someone changes is theirs alone and stays on their screen only — the address never
// changes, so the link they pass on is still blank, and a refresh starts over. A link that still
// carries old settings (?u=…) opens with them once, then the address is cleaned.
//   • PIECES come from lib/need-list.ts (its own standard, not the starter kit or the order form).
//   • WHAT TO BUY comes from lib/need-buy.ts: sets where things are sold as sets, packs, singles, each
//     with a Standard / Mid / Luxury Amazon link (Stay's own picks are marked).
//   • SEVERAL UNITS (Jon: "if onboarding multiple units, create a full order — add unit"): one tab per
//     unit, and a Full order tab that adds them up, with a column per unit.
import { useEffect, useMemo, useState } from 'react'
import { Bath, BedDouble, Check, ChefHat, ClipboardCopy, Copy, ExternalLink, FileSpreadsheet, Link2, Minus, Package, Plus, RotateCcw, Star, Trash2, Users } from 'lucide-react'
import { APPLIANCES, SIZE_LIMITS, describeSize, type KitCount, type KitSize } from '@/lib/starter-kit'
import { GROUP_NOTE, NEED_ROOMS, needList, type NeedLine } from '@/lib/need-list'
import { GRADES, buyList, howBought, type BuyLine, type Grade } from '@/lib/need-buy'
import { NeedPicture } from '@/components/NeedIcons'
import { needQuery, sizeFromParams, unitsFromParam, type NeedParams, type NeedUnit } from '@/lib/starter-kit-params'

const TYPE = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
const COUNTS: { k: KitCount; label: string; Icon: any }[] = [
  { k: 'bedrooms', label: 'Bedrooms', Icon: BedDouble }, { k: 'bathrooms', label: 'Bathrooms', Icon: Bath }, { k: 'guests', label: 'Guests', Icon: Users },
]
const SINGLE = 'This home'

export function NeedListCalculator({ initial }: { initial: NeedParams }) {
  const [units, setUnits] = useState<NeedUnit[]>(() => unitsFromParam(initial.u) || [{ name: SINGLE, size: sizeFromParams(initial) }])
  const [view, setView] = useState<number | 'order'>(0)
  const [showOpt, setShowOpt] = useState(initial.opt === '1')
  const [grade, setGrade] = useState<Grade>(initial.t === 'std' || initial.t === 'lux' ? initial.t : 'mid')
  const [copied, setCopied] = useState('')
  const query = needQuery(units, showOpt, grade)
  // The address stays the plain link: strip anything an older shared link carried, once, on open.
  useEffect(() => { try { if (window.location.search) window.history.replaceState(null, '', '/kit/list') } catch { /* the list still works */ } }, [])
  const startOver = () => { setUnits([{ name: SINGLE, size: sizeFromParams({}) }]); setView(0); setShowOpt(false); setGrade('mid') }

  const multi = units.length > 1
  const idx = view === 'order' ? -1 : Math.min(view, units.length - 1)
  const unit = idx >= 0 ? units[idx] : null
  const size = unit?.size
  const setSize = (fn: (z: KitSize) => KitSize) => setUnits(us => us.map((x, i) => (i === idx ? { ...x, size: fn(x.size) } : x)))
  const setName = (name: string) => setUnits(us => us.map((x, i) => (i === idx ? { ...x, name } : x)))
  const addUnit = (copyOf?: NeedUnit) => {
    setUnits(us => {
      const base = us.map((x, i) => (us.length === 1 && x.name === SINGLE ? { ...x, name: 'Unit 1' } : x))
      const next = [...base, { name: copyOf ? `${copyOf.name === SINGLE ? 'Unit 1' : copyOf.name} (copy)` : `Unit ${base.length + 1}`, size: JSON.parse(JSON.stringify((copyOf || base[base.length - 1]).size)) }]
      setView(next.length - 1)
      return next
    })
  }
  const removeUnit = () => { setUnits(us => { const next = us.filter((_, i) => i !== idx); return next.length === 1 ? [{ ...next[0], name: next[0].name }] : next }); setView(0) }

  // Per unit: the pieces, and what to buy for them. Recommended always; optional only when asked for.
  const per = useMemo(() => units.map(u => { const lines = needList(u.size).filter(l => l.tier !== 'optional' || showOpt); return { lines, buy: buyList(lines) } }), [units, showOpt])
  const cur = idx >= 0 ? per[idx] : null
  // The full order: every buy line, a quantity per unit, and the total.
  const order = useMemo(() => {
    const rows = new Map<string, { line: BuyLine; qty: number[] }>()
    per.forEach((p, i) => p.buy.forEach(b => {
      const r = rows.get(b.key) || { line: b, qty: units.map(() => 0) }
      r.qty[i] += b.qty
      rows.set(b.key, r)
    }))
    return Array.from(rows.values()).sort((a, b) => NEED_ROOMS.indexOf(a.line.group as any) - NEED_ROOMS.indexOf(b.line.group as any))
  }, [per, units])

  const setCount = (k: KitCount, v: number) => { const [lo, hi] = SIZE_LIMITS[k]; setSize(z => ({ ...z, [k]: Math.max(lo, Math.min(hi, Math.round(v) || lo)) })) }
  const flash = (what: string) => { setCopied(what); setTimeout(() => setCopied(''), 1800) }
  const copyText = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); flash(what) } catch { window.prompt('Copy this', text) } }
  const gradeLabel = GRADES.find(g => g.k === grade)!.label
  const asText = () => {
    const out: string[] = []
    if (multi || view === 'order') {
      out.push(`Full order — ${units.length} unit${units.length === 1 ? '' : 's'} (${gradeLabel})`, '')
      for (const r of order) out.push(`- ${r.qty.reduce((a, b) => a + b, 0)} × ${r.line.name}  [${units.map((u, i) => `${u.name}: ${r.qty[i]}`).join(', ')}]  ${r.line.shop[grade].url}`)
    } else if (cur && size) {
      out.push(`What the home needs — ${describeSize(size)}`, '')
      for (const room of NEED_ROOMS) {
        const rows = cur.lines.filter(l => l.item.room === room)
        if (!rows.length) continue
        out.push(`${room.toUpperCase()} (${rows.reduce((a, l) => a + l.count, 0)} pieces)`)
        for (const l of rows) out.push(`- ${l.count} ${l.item.name} (${TYPE[l.tier]})`)
        out.push('')
      }
    }
    out.push('', 'Coffee maker: Nespresso or Keurig pod machine; Stay supplies the pods. Linen is quoted separately.')
    return out.join('\n')
  }
  const shopA = (b: BuyLine, label = 'Shop') => (
    <a className="nlc-shop" href={b.shop[grade].url} target="_blank" rel="noopener noreferrer">{b.shop[grade].pinned ? <><Star size={12} /> Stay’s pick</> : <><ExternalLink size={12} /> {label}</>}</a>
  )

  return (
    <div className="nlc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="nlc-wrap">
        <header className="nlc-head">
          <img src="/stay-logo.png" alt="Stay Hospitality" className="nlc-logo" />
        </header>
        <div className="nlc-eyebrow">Need list</div>
        <h1>{multi ? 'What your units need' : 'What your home needs'}</h1>
        <p className="nlc-lede">Tell us about the home and the list sizes itself: every item a short-term rental needs, how many, and how to buy it. Onboarding several units? Add each one and get the full order. Your changes are only on your screen; download the Excel or copy the list to keep them.</p>

        <div className="nlc-tabs" role="tablist" aria-label="Units">
          {multi && units.map((u, i) => (
            <button key={i} type="button" role="tab" aria-selected={view === i} className={view === i ? 'on' : ''} onClick={() => setView(i)}>{u.name || `Unit ${i + 1}`}<small>{u.size.bedrooms === 0 ? 'Studio' : u.size.bedrooms + ' bd'} · {u.size.guests} gst</small></button>
          ))}
          <button type="button" className="nlc-add" onClick={() => addUnit()}><Plus size={14} /> Add unit</button>
          {multi && <button type="button" role="tab" aria-selected={view === 'order'} className={'nlc-ordertab' + (view === 'order' ? ' on' : '')} onClick={() => setView('order')}><Package size={14} /> Full order</button>}
        </div>

        {unit && size && (
          <section className="nlc-panel" aria-label="The home">
            {multi && (
              <div className="nlc-uhead">
                <input aria-label="Unit name" value={unit.name} onChange={e => setName(e.target.value)} placeholder="Unit name, e.g. 302" />
                <button type="button" onClick={() => addUnit(unit)} title="Add another unit with the same layout"><Copy size={13} /> Same layout</button>
                <button type="button" onClick={removeUnit} title="Remove this unit" className="nlc-del"><Trash2 size={13} /> Remove</button>
              </div>
            )}
            <div className="nlc-counts">
              {COUNTS.map(({ k, label, Icon }) => (
                <div key={k} className="nlc-count">
                  <span className="nlc-l"><Icon size={15} /> {label}</span>
                  <div className="nlc-step">
                    <button type="button" aria-label={'Fewer ' + label} onClick={() => setCount(k, size[k] - 1)}><Minus size={16} /></button>
                    <input aria-label={label} type="number" value={size[k]} onChange={e => setCount(k, +e.target.value)} />
                    <button type="button" aria-label={'More ' + label} onClick={() => setCount(k, size[k] + 1)}><Plus size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="nlc-kit">
              <span className="nlc-l"><ChefHat size={15} /> Kitchen</span>
              <div className="nlc-yn" role="radiogroup" aria-label="Kitchen">
                {[true, false].map(v => <button key={String(v)} type="button" role="radio" aria-checked={size.kitchen === v} className={size.kitchen === v ? 'on' : ''} onClick={() => setSize(z => ({ ...z, kitchen: v }))}>{v ? 'Yes' : 'No'}</button>)}
              </div>
            </div>
            {size.kitchen && (
              <div className="nlc-apps">
                {APPLIANCES.map(a => (
                  <label key={a.k} className={'nlc-app' + (size.appliances[a.k] ? ' on' : '')}>
                    <input type="checkbox" checked={size.appliances[a.k]} onChange={e => setSize(z => ({ ...z, appliances: { ...z.appliances, [a.k]: e.target.checked } }))} />
                    <span className="nlc-box">{size.appliances[a.k] && <Check size={12} />}</span>{a.label}
                  </label>
                ))}
              </div>
            )}
            <label className="nlc-opt"><input type="checkbox" checked={showOpt} onChange={e => setShowOpt(e.target.checked)} /> Show optional extras too</label>
          </section>
        )}

        <div className="nlc-bar">
          <div className="nlc-grade" role="radiogroup" aria-label="Shopping grade">
            {GRADES.map(g => <button key={g.k} type="button" role="radio" aria-checked={grade === g.k} title={g.hint} className={grade === g.k ? 'on' : ''} onClick={() => setGrade(g.k)}>{g.label}</button>)}
          </div>
          <div className="nlc-acts">
            <button type="button" onClick={() => copyText(window.location.origin + '/kit/list', 'link')} title="The plain link: whoever opens it starts with a blank list of their own"><Link2 size={14} /> {copied === 'link' ? 'Link copied' : 'Copy link'}</button>
            <button type="button" onClick={startOver} title="Clear everything and start from a blank home"><RotateCcw size={14} /> Start over</button>
            <button type="button" onClick={() => copyText(asText(), 'list')}><ClipboardCopy size={14} /> {copied === 'list' ? 'Copied' : 'Copy list'}</button>
            <a href={'/api/public/starter-kit/list/xlsx?' + query}><FileSpreadsheet size={14} /> Excel</a>
          </div>
        </div>

        {view === 'order' ? (
          <div className="nlc-scroll">
            <table className="nlc-t nlc-order">
              <thead><tr><th>Buy</th>{units.map((u, i) => <th key={i} className="n">{u.name}</th>)}<th className="n">Total</th><th /></tr></thead>
              {NEED_ROOMS.map(room => {
                const rows = order.filter(r => r.line.group === room)
                if (!rows.length) return null
                return (
                  <tbody key={room}>
                    <tr className="cat"><td colSpan={units.length + 3}>{room}</td></tr>
                    {rows.map(r => (
                      <tr key={r.line.key}>
                        <td><b>{r.line.name}</b>{r.line.kind === 'set' && r.line.contents ? <small>{r.line.contents.map(c => `${c.per} ${c.name.toLowerCase()}`).join(', ')} per set</small> : null}</td>
                        {r.qty.map((q, i) => <td key={i} className="n">{q || '—'}</td>)}
                        <td className="n"><span className="nlc-q">{r.qty.reduce((a, b) => a + b, 0)}</span></td>
                        <td className="n">{shopA(r.line)}</td>
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
        ) : cur && size ? (
          <table className="nlc-t">
            <thead><tr><th>Item</th><th>Type</th><th className="n">Needed</th></tr></thead>
            {NEED_ROOMS.map(room => {
              const rows = cur.lines.filter(l => l.item.room === room)
              if (!rows.length) return null
              const sets = cur.buy.filter(b => b.kind === 'set' && b.group === room)
              return (
                <tbody key={room}>
                  <tr className="cat"><td colSpan={3}><div className="nlc-grp"><span>{room}</span><span className="nlc-grp-n">{rows.length} item{rows.length === 1 ? '' : 's'} · {rows.reduce((a, l) => a + l.count, 0)} pieces</span></div>{GROUP_NOTE[room] && <small className="nlc-grp-d">{GROUP_NOTE[room]}</small>}</td></tr>
                  {sets.map(b => (
                    <tr key={b.key} className="nlc-setrow"><td colSpan={3}>
                      <div className="nlc-set"><span><b>Buy {b.qty} × {b.name}</b><small>Each set: {b.contents!.map(c => `${c.per} ${c.name.toLowerCase()}`).join(', ')}</small></span>{shopA(b)}</div>
                    </td></tr>
                  ))}
                  {rows.map(l => <ItemRow key={l.item.key} l={l} buy={cur.buy} shopA={shopA} />)}
                </tbody>
              )
            })}
          </table>
        ) : null}
        <p className="nlc-fine">Counts are pieces, sized to the home. Dinner plates, bowls, tall glasses, dinner forks, table knives and soup spoons follow the vacation-rental standard of two place settings per guest, so a full house can eat twice before anything is washed; side plates, mugs, wine and short glasses and teaspoons are one per guest. Where things are sold as a set we list the set, and anything the sets leave short is bought separately. Bath items are per bathroom; hangers (20) and luggage racks per bedroom; smoke alarms one per bedroom plus one outside the bedrooms (check local code). Homes for 10 or more guests get a second coffee maker and extra pans, boards and serving pieces. Links marked Stay’s pick are products from Stay’s own list; the others open an Amazon search for that grade of the item. The coffee maker is a Nespresso or Keurig pod machine; Stay supplies the pods. Linen is quoted separately.</p>
      </main>
    </div>
  )
}

function ItemRow({ l, buy, shopA }: { l: NeedLine; buy: BuyLine[]; shopA: (b: BuyLine, label?: string) => JSX.Element }) {
  const own = buy.find(b => b.key === l.item.key)
  return (
    <tr>
      <td><div className="nlc-it"><span className="nlc-pic"><NeedPicture k={l.item.key} name={l.item.name} /></span><span><b>{l.item.name}</b><small>{l.rule}</small><small className="nlc-how">{howBought(buy, l.item.key)}{own ? <> · {shopA(own)}</> : null}</small></span></div></td>
      <td><i className={'nlc-tier ' + l.tier}>{TYPE[l.tier]}</i></td>
      <td className="n"><span className="nlc-q">{l.count}</span></td>
    </tr>
  )
}

const CSS = `
.nlc{--paper:#fff;--ground:#EEF1F0;--ink:#15212B;--muted:#6B7880;--line:#DCE2E0;--accent:#1F5F5B;--soft:#E2EFED;--display:'Instrument Serif',Georgia,serif;--ui:'Geist','Inter',system-ui,sans-serif;
  background:var(--ground);color:var(--ink);font-family:var(--ui);font-size:14.5px;line-height:1.45;min-height:100vh;color-scheme:light;padding-block:24px 48px}
.nlc *{box-sizing:border-box}
.nlc-wrap{max-width:820px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:28px max(20px,env(safe-area-inset-right,0px)) 28px max(20px,env(safe-area-inset-left,0px))}
@media (min-width:700px){.nlc-wrap{padding:36px 40px}}
.nlc-head{margin-bottom:24px}.nlc-logo{height:28px;width:auto}
.nlc-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600}
.nlc h1{font-family:var(--display);font-weight:400;font-size:clamp(34px,6vw,46px);line-height:1.05;margin:6px 0 8px}
.nlc-lede{color:var(--muted);margin:0 0 20px;max-width:60ch}
.nlc-panel{border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;gap:14px}
.nlc-counts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.nlc-count{display:grid;gap:6px}
.nlc-l{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);font-weight:500}
.nlc-step{display:flex;align-items:center;border:1px solid var(--line);border-radius:999px;overflow:hidden}
.nlc-step button{border:0;background:none;width:40px;height:40px;display:grid;place-items:center;cursor:pointer;color:var(--ink)}.nlc-step button:hover{background:var(--soft)}
.nlc-step input{border:0;width:100%;min-width:0;text-align:center;font:400 24px var(--display);color:var(--ink);background:none;-moz-appearance:textfield}
.nlc-step input::-webkit-outer-spin-button,.nlc-step input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.nlc-kit{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding-top:14px}
.nlc-yn{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px}
.nlc-yn button{border:0;background:none;border-radius:999px;padding:6px 18px;font:600 13.5px var(--ui);color:var(--muted);cursor:pointer}.nlc-yn button.on{background:var(--ink);color:#fff}
.nlc-apps{display:flex;flex-wrap:wrap;gap:8px}
.nlc-app{position:relative;display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:6px 13px 6px 8px;font-size:13.5px;cursor:pointer;color:var(--muted)}
.nlc-app input{position:absolute;opacity:0;width:1px;height:1px}
.nlc-box{width:17px;height:17px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;color:#fff}
.nlc-app.on{color:var(--ink);border-color:var(--accent);background:var(--soft)}.nlc-app.on .nlc-box{background:var(--accent);border-color:var(--accent)}
.nlc-app:focus-within,.nlc button:focus-visible,.nlc a:focus-visible,.nlc input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.nlc-opt{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink);border-top:1px solid var(--line);padding-top:12px}
.nlc-bar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin:22px 0 6px}
.nlc-sum{font-size:14px;color:var(--muted)}.nlc-sum b{color:var(--ink);font-variant-numeric:tabular-nums}
.nlc-acts{display:flex;flex-wrap:wrap;gap:8px}
.nlc-acts button,.nlc-acts a{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:7px 13px;font:600 13px var(--ui);color:var(--ink);cursor:pointer;text-decoration:none}
.nlc-acts button:hover,.nlc-acts a:hover{border-color:var(--ink)}
.nlc-t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.nlc-t th{text-align:left;font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--ink)}
.nlc-t td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.nlc-t td small{display:block;color:var(--muted);font-size:12px}
.nlc-t .n{text-align:right}
.nlc-t tr.cat td{font-family:var(--display);font-size:20px;padding-top:20px;border-bottom:1px solid var(--ink)}
.nlc-tier{font-style:normal;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
.nlc-tier.must{background:#E1EAF5;color:#1C4A7E}.nlc-tier.recommended{background:#E0EFE4;color:#25633A}.nlc-tier.optional{background:#ECEFF1;color:#56626B}
.nlc-it{display:flex;align-items:center;gap:12px}.nlc-pic{flex:none;width:52px;height:52px;border-radius:12px;background:var(--soft);color:var(--accent);display:grid;place-items:center}
.nlc-grp{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.nlc-grp-n{font-family:var(--ui);font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.nlc-grp-d{display:block;font-family:var(--ui);font-size:12.5px;color:var(--muted);margin-top:2px}
.nlc-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.nlc-tabs button{display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px;border:1px solid var(--line);background:var(--paper);border-radius:12px;padding:7px 12px;font:600 13.5px var(--ui);color:var(--ink);cursor:pointer}
.nlc-tabs button small{font-weight:400;font-size:11.5px;color:var(--muted)}
.nlc-tabs button.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:var(--soft)}
.nlc-tabs .nlc-add,.nlc-tabs .nlc-ordertab{flex-direction:row;align-items:center;gap:6px}
.nlc-tabs .nlc-add{border-style:dashed;color:var(--accent)}
.nlc-tabs .nlc-ordertab{background:var(--ink);color:#fff;border-color:var(--ink)}.nlc-tabs .nlc-ordertab.on{background:var(--accent);border-color:var(--accent);box-shadow:none}
.nlc-uhead{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.nlc-uhead input{flex:1 1 180px;min-width:0;border:1px solid var(--line);border-radius:10px;padding:8px 12px;font:600 15px var(--ui);color:var(--ink)}
.nlc-uhead button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:7px 12px;font:600 12.5px var(--ui);color:var(--ink);cursor:pointer}
.nlc-uhead .nlc-del{color:#A3302A}
.nlc-grade{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px}
.nlc-grade button{border:0;background:none;border-radius:999px;padding:6px 14px;font:600 13px var(--ui);color:var(--muted);cursor:pointer}.nlc-grade button.on{background:var(--accent);color:#fff}
.nlc-shop{display:inline-flex;align-items:center;gap:4px;color:var(--accent);font:600 12.5px var(--ui);text-decoration:none;white-space:nowrap}.nlc-shop:hover{text-decoration:underline}
.nlc-how{color:var(--ink)!important;margin-top:2px}
.nlc-setrow td{background:var(--soft);border-bottom:1px solid var(--line)}
.nlc-set{display:flex;justify-content:space-between;align-items:center;gap:12px}.nlc-set small{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.nlc-scroll{overflow-x:auto}
.nlc-order{min-width:520px}.nlc-order td small{display:block;color:var(--muted);font-size:12px}
.nlc-q{font-family:var(--display);font-size:24px}
.nlc-fine{margin-top:22px;font-size:12.5px;color:var(--muted)}
@media (max-width:560px){.nlc-counts{grid-template-columns:1fr}.nlc-t th:nth-child(2),.nlc-t td:nth-child(2){padding-inline:4px}}
@media print{.nlc{background:#fff;padding:0}.nlc-wrap{border:0}.nlc-panel,.nlc-acts{display:none}}
`

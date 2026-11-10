'use client'
// THE NEED LIST CALCULATOR (Jon, 2026-11-10) — /kit/list, open to anyone. The home's details in, the
// list out: every item, must-have or recommended (optional on request), and how many. Like the linen
// calculator. The details stay in the address so the filled-in list can be shared as a link.
// It counts PIECES (plates, bowls, forks, wine glasses), from lib/need-list.ts — its own standard, not
// the starter kit's products or the client order form.
import { useEffect, useMemo, useState } from 'react'
import { Bath, BedDouble, Check, ChefHat, ClipboardCopy, FileSpreadsheet, Link2, Minus, Plus, Users } from 'lucide-react'
import { APPLIANCES, SIZE_LIMITS, describeSize, type KitCount, type KitSize } from '@/lib/starter-kit'
import { GROUP_NOTE, NEED_ROOMS, needList } from '@/lib/need-list'
import { NeedPicture } from '@/components/NeedIcons'
import { paramsFromSize, sizeFromParams, type NeedParams } from '@/lib/starter-kit-params'

const TYPE = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
const COUNTS: { k: KitCount; label: string; Icon: any }[] = [
  { k: 'bedrooms', label: 'Bedrooms', Icon: BedDouble }, { k: 'bathrooms', label: 'Bathrooms', Icon: Bath }, { k: 'guests', label: 'Guests', Icon: Users },
]

export function NeedListCalculator({ initial }: { initial: NeedParams }) {
  const [size, setSize] = useState<KitSize>(() => sizeFromParams(initial))
  const [showOpt, setShowOpt] = useState(initial.opt === '1')
  const [copied, setCopied] = useState('')
  const query = paramsFromSize(size, showOpt)
  useEffect(() => { try { window.history.replaceState(null, '', '/kit/list?' + query) } catch { /* the list still works */ } }, [query])

  // Recommended items are always on this list; optional ones only when asked for.
  const lines = useMemo(() => needList(size).filter(l => l.tier !== 'optional' || showOpt), [size, showOpt])
  const n = (tier: 'must' | 'recommended' | 'optional') => lines.filter(l => l.tier === tier).length

  const setCount = (k: KitCount, v: number) => { const [lo, hi] = SIZE_LIMITS[k]; setSize(z => ({ ...z, [k]: Math.max(lo, Math.min(hi, Math.round(v) || lo)) })) }
  const flash = (what: string) => { setCopied(what); setTimeout(() => setCopied(''), 1800) }
  const copyText = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); flash(what) } catch { window.prompt('Copy this', text) } }
  const asText = () => {
    const out = [`What the home needs — ${describeSize(size)}`, '']
    for (const room of NEED_ROOMS) {
      const rows = lines.filter(l => l.item.room === room)
      if (!rows.length) continue
      out.push(`${room.toUpperCase()} (${rows.reduce((a, l) => a + l.count, 0)} pieces)`)
      for (const l of rows) out.push(`- ${l.count} ${l.item.name} (${TYPE[l.tier]})`)
      out.push('')
    }
    out.push('Coffee maker: Nespresso or Keurig pod machine; Stay supplies the pods. Linen is quoted separately.')
    return out.join('\n')
  }

  return (
    <div className="nlc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="nlc-wrap">
        <header className="nlc-head">
          <img src="/stay-logo.png" alt="Stay Hospitality" className="nlc-logo" />
        </header>
        <div className="nlc-eyebrow">Need list</div>
        <h1>What your home needs</h1>
        <p className="nlc-lede">Tell us about the home and the list sizes itself: every item a short-term rental needs, must-haves and recommended, and how many.</p>

        <section className="nlc-panel" aria-label="The home">
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

        <div className="nlc-bar">
          <div className="nlc-sum"><b>{n('must')}</b> must-have · <b>{n('recommended')}</b> recommended{showOpt ? <> · <b>{n('optional')}</b> optional</> : null}</div>
          <div className="nlc-acts">
            <button type="button" onClick={() => copyText(window.location.origin + '/kit/list?' + query, 'link')}><Link2 size={14} /> {copied === 'link' ? 'Link copied' : 'Copy link'}</button>
            <button type="button" onClick={() => copyText(asText(), 'list')}><ClipboardCopy size={14} /> {copied === 'list' ? 'List copied' : 'Copy list'}</button>
            <a href={'/api/public/starter-kit/list/xlsx?' + query}><FileSpreadsheet size={14} /> Excel</a>
          </div>
        </div>

        <table className="nlc-t">
          <thead><tr><th>Item</th><th>Type</th><th className="n">Needed</th></tr></thead>
          {NEED_ROOMS.map(room => {
            const rows = lines.filter(l => l.item.room === room)
            if (!rows.length) return null
            return (
              <tbody key={room}>
                <tr className="cat"><td colSpan={3}><div className="nlc-grp"><span>{room}</span><span className="nlc-grp-n">{rows.length} item{rows.length === 1 ? '' : 's'} · {rows.reduce((a, l) => a + l.count, 0)} pieces</span></div>{GROUP_NOTE[room] && <small className="nlc-grp-d">{GROUP_NOTE[room]}</small>}</td></tr>
                {rows.map(l => (
                  <tr key={l.item.key}>
                    <td><div className="nlc-it"><span className="nlc-pic"><NeedPicture k={l.item.key} name={l.item.name} /></span><span><b>{l.item.name}</b><small>{l.rule}</small></span></div></td>
                    <td><i className={'nlc-tier ' + l.tier}>{TYPE[l.tier]}</i></td>
                    <td className="n"><span className="nlc-q">{l.count}</span></td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
        <p className="nlc-fine">Counts are pieces, sized to the home. Plates, bowls, mugs, tall glasses and everyday flatware follow the vacation-rental standard of two place settings per guest, so a full house can eat twice before anything is washed. Wine glasses are 1.5 per guest to allow for breakage. Bath items are per bathroom; hangers (20) and luggage racks per bedroom; smoke alarms one per bedroom plus one outside the bedrooms (check local code). Homes for 10 or more guests get a second coffee maker and extra pans, boards and serving pieces. Must-haves are what every home needs, whoever supplies them. The coffee maker is a Nespresso or Keurig pod machine; Stay supplies the pods. Linen is quoted separately.</p>
      </main>
    </div>
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
.nlc-q{font-family:var(--display);font-size:24px}
.nlc-fine{margin-top:22px;font-size:12.5px;color:var(--muted)}
@media (max-width:560px){.nlc-counts{grid-template-columns:1fr}.nlc-t th:nth-child(2),.nlc-t td:nth-child(2){padding-inline:4px}}
@media print{.nlc{background:#fff;padding:0}.nlc-wrap{border:0}.nlc-panel,.nlc-acts{display:none}}
`

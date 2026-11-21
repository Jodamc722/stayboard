'use client'
// ONBOARDING COST ESTIMATOR (Jon, 2026-11-20) — /sales/onboarding-cost.
//
// IT LOOKS LIKE THE INVENTORY CALCULATOR ON PURPOSE (Jon, 2026-11-21: "should look like the onboarding
// calculator but giving estimates to the sales team"). Same card, same steppers, same kitchen and appliance
// chips, same Standard / Mid / Luxury switch, same sets and tags as /kit/list (components/NeedListCalculator.tsx).
// What it adds is money: a price on every buy line at the chosen grade, the linen at par, the onboarding
// clean, and one total sales can say out loud.
//
// The list and its counts are the calculator's (lib/onboard-estimate-list.ts → lib/need-list.ts, lib/need-buy.ts),
// so more guests means more plates and glasses. The prices are lib/onboard-estimate.ts PRICE_BOOK, and a
// full-level user can retype any of them here without a deploy. A fully furnished unit is assumed, we supply
// the consumables, and appliances are never priced: what the kitchen has only shapes the list.
import { useEffect, useMemo, useState } from 'react'
import { Bath, BedDouble, Check, ChefHat, ClipboardCopy, ExternalLink, Loader2, Minus, Plus, RotateCcw, SlidersHorizontal, Users } from 'lucide-react'
import { linenQuote, atPar, type LinenStandard } from '@/lib/linens'
import { GROUP_NOTE, NEED_ROOMS } from '@/lib/need-list'
import { APPLIANCES } from '@/lib/starter-kit'
import { needQuery } from '@/lib/starter-kit-params'
import { NeedPicture } from '@/components/NeedIcons'
import { buyRowsFor, priceBookLines } from '@/lib/onboard-estimate-list'
import {
  EST_BEDS, EST_LEVELS, EST_LEVEL_HINT, EST_LEVEL_LABEL, GRADE_OF, LINEN_TIER_OF, OPTIONAL_FOR_LEVEL, PRICE_BOOK,
  estDefaults, estimate, estimateText, guestsFromBeds, kitSizeOf, linenUnitOf, unitLabel, bedsText, normEstSettings,
  type EstInput, type EstLevel, type EstSettings,
} from '@/lib/onboard-estimate'

const TYPE = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const cents = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const BED_LABEL: Record<string, string> = { 'Sofa bed': 'Sofa' }
const RATE_FIELDS: [keyof EstSettings, string][] = [
  ['cleanStudio', 'Clean, studio ($)'], ['clean1br', 'Clean, 1 bedroom ($)'], ['cleanPerExtraBedroom', 'Clean, each extra bedroom ($)'],
  ['sqftStepCost', 'Clean, per block over typical size ($)'], ['sqftStep', 'Block size (sq ft)'], ['taxPct', 'Linen tax (%)'], ['linenUpliftPct', 'Linen allowance (%)'],
]
type Data = { standard: LinenStandard; settings: EstSettings; level: string }

function Big({ label, Icon, value, onChange, min, max, step = 1 }: { label: string; Icon: any; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  const put = (v: number) => onChange(Math.max(min, Math.min(max, Math.round((Number(v) || min) / step) * step)))
  return (
    <div className="oce-count">
      <span className="oce-l"><Icon size={15} /> {label}</span>
      <div className="oce-step">
        <button type="button" aria-label={'Fewer ' + label} onClick={() => put(value - step)}><Minus size={16} /></button>
        <input aria-label={label} type="number" step={step} value={value} onChange={e => put(+e.target.value)} />
        <button type="button" aria-label={'More ' + label} onClick={() => put(value + step)}><Plus size={16} /></button>
      </div>
    </div>
  )
}
function Small({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <span className={'oce-mini' + (value > 0 ? ' on' : '')}>
      <span>{label}</span>
      <button type="button" aria-label={'Fewer: ' + label} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Minus size={13} /></button>
      <b>{value}</b>
      <button type="button" aria-label={'More: ' + label} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Plus size={13} /></button>
    </span>
  )
}

export function OnboardCostEstimator() {
  const [input, setInput] = useState<EstInput>(() => estDefaults(1))
  const [picks, setPicks] = useState<Record<string, boolean>>({})
  const [data, setData] = useState<Data | null>(null)
  const [draft, setDraft] = useState<EstSettings | null>(null)
  const [view, setView] = useState<'estimate' | 'prices'>('estimate')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let dead = false
    fetch('/api/onboard-estimate', { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (dead) return
      if (!j?.ok) { setErr(j?.error || 'Could not load the estimator.'); return }
      setData({ standard: j.standard, settings: normEstSettings(j.settings), level: j.level || 'view' })
    }).catch(() => { if (!dead) setErr('Could not load the estimator. Check the connection and reload.') })
    return () => { dead = true }
  }, [])

  const settings = draft || data?.settings || null
  const rows = useMemo(() => buyRowsFor(input), [input])
  const est = useMemo(() => {
    if (!data || !settings) return null
    const std = input.par ? atPar(data.standard, input.par) : data.standard
    const q = linenQuote({ ...std, markupPct: 0, taxPct: 0 }, [linenUnitOf(input)], LINEN_TIER_OF[input.level])
    return estimate(q, rows, input, settings, picks)
  }, [data, settings, input, rows, picks])
  const bookLines = useMemo(() => priceBookLines(), [])

  const set = (patch: Partial<EstInput>) => { setInput(i => ({ ...i, ...patch })); setCopied(false) }
  const setBed = (k: string, n: number) => { setCopied(false); setInput(i => {
    const beds = { ...i.beds, [k]: n }; if (!n) delete beds[k]
    return Object.keys(beds).length ? { ...i, beds, guests: guestsFromBeds(beds) } : i
  }) }
  const pickBedrooms = (b: number) => { setCopied(false); setInput(i => ({ ...estDefaults(b), kitchen: i.kitchen, appliances: i.appliances, optional: i.optional, sqft: i.sqft, level: i.level, par: i.par })) }
  const pickLevel = (level: EstLevel) => set({ level, optional: OPTIONAL_FOR_LEVEL[level] })
  const startOver = () => { setInput(estDefaults(1)); setPicks({}); setCopied(false) }
  const copy = async () => { if (!est) return; try { await navigator.clipboard.writeText(estimateText(input, est)); setCopied(true) } catch { setErr('Could not copy from this browser.') } }
  const setPrice = (key: string, at: number, v: number) => {
    if (!settings || !Number.isFinite(v) || v < 0) return
    const cur = (settings.prices[key] || PRICE_BOOK[key].p).slice() as [number, number, number]
    cur[at] = v
    const prices = { ...settings.prices, [key]: cur }
    if (cur.every((x, n) => x === PRICE_BOOK[key].p[n])) delete prices[key]   // back to the book: nothing to save
    setDraft(normEstSettings({ ...settings, prices }))
  }
  const saveRates = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const r = await fetch('/api/onboard-estimate', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: draft }) })
      const j = await r.json().catch(() => null)
      if (!j?.ok) { setErr(j?.error || 'Could not save the prices.'); return }
      setData(d => (d ? { ...d, settings: normEstSettings(j.settings) } : d)); setDraft(null); setErr('')
    } catch { setErr('Could not save the prices. Check the connection and try again.') } finally { setSaving(false) }
  }

  if (err && !data) return <div className="oce"><style dangerouslySetInnerHTML={{ __html: CSS }} /><main className="oce-wrap"><h1>Onboarding cost</h1><p className="oce-err" role="alert">{err}</p></main></div>
  if (!data || !settings || !est) return <div className="oce"><style dangerouslySetInnerHTML={{ __html: CSS }} /><main className="oce-wrap"><h1>Onboarding cost</h1><p className="oce-lede"><Loader2 size={14} className="oce-spin" /> Loading prices…</p></main></div>

  const canEdit = data.level === 'full'
  const par = input.par || data.standard.par
  const level = EST_LEVEL_LABEL[input.level]
  const size = kitSizeOf(input)
  const needHref = '/kit/list?' + needQuery([{ name: 'This home', size }], input.optional, GRADE_OF[input.level])
  const inv = est.inventory

  return (
    <div className="oce">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="oce-wrap">
        <div className="oce-eyebrow">Onboarding cost</div>
        <h1>What a new unit costs</h1>
        <p className="oce-lede">Tell us about the unit and the estimate sizes itself: linen at par, the onboarding clean, and everything the unit needs at the grade you pick. Fully furnished unit, we supply the consumables. An estimate, not a quote.</p>

        <section className="oce-panel" aria-label="The unit">
          <div className="oce-counts">
            <Big label="Bedrooms" Icon={BedDouble} value={input.bedrooms} min={0} max={8} onChange={pickBedrooms} />
            <Big label="Bathrooms" Icon={Bath} value={input.baths} min={1} max={12} step={0.5} onChange={n => set({ baths: n })} />
            <Big label="Guests" Icon={Users} value={input.guests} min={1} max={30} onChange={n => set({ guests: n })} />
          </div>
          <div className="oce-beds">
            <span className="oce-l"><BedDouble size={15} /> Beds</span>
            <div className="oce-minis">
              {EST_BEDS.map(k => <Small key={k} label={BED_LABEL[k] || k} value={input.beds[k] || 0} min={0} max={12} onChange={n => setBed(k, n)} />)}
              <Small label="Linen par" value={par} min={1} max={6} step={0.5} onChange={n => set({ par: n })} />
              <label className="oce-sqft">Sq ft<input type="number" inputMode="numeric" min={0} placeholder="optional" value={input.sqft || ''} onChange={e => set({ sqft: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></label>
            </div>
          </div>
          <div className="oce-kit">
            <span className="oce-l"><ChefHat size={15} /> Kitchen</span>
            <div className="oce-yn" role="radiogroup" aria-label="Kitchen">
              {[true, false].map(v => <button key={String(v)} type="button" role="radio" aria-checked={input.kitchen === v} className={input.kitchen === v ? 'on' : ''} onClick={() => set({ kitchen: v })}>{v ? 'Yes' : 'No'}</button>)}
            </div>
          </div>
          {input.kitchen && (
            <div className="oce-apps">
              {APPLIANCES.map(a => (
                <label key={a.k} className={'oce-app' + (input.appliances[a.k] ? ' on' : '')}>
                  <input type="checkbox" checked={input.appliances[a.k]} onChange={e => set({ appliances: { ...input.appliances, [a.k]: e.target.checked } })} />
                  <span className="oce-box">{input.appliances[a.k] && <Check size={12} />}</span>{a.label}
                </label>
              ))}
            </div>
          )}
          <label className="oce-opt"><input type="checkbox" checked={input.optional} onChange={e => set({ optional: e.target.checked })} /> Include optional extras</label>
        </section>

        <div className="oce-bar">
          <div className="oce-grade" role="radiogroup" aria-label="Grade">
            {EST_LEVELS.map(l => <button key={l} type="button" role="radio" aria-checked={input.level === l} title={EST_LEVEL_HINT[l]} className={input.level === l ? 'on' : ''} onClick={() => pickLevel(l)}>{EST_LEVEL_LABEL[l]}</button>)}
          </div>
          <div className="oce-acts">
            <button type="button" onClick={copy}><ClipboardCopy size={14} /> {copied ? 'Copied' : 'Copy estimate'}</button>
            <button type="button" onClick={startOver}><RotateCcw size={14} /> Start over</button>
            <a href={needHref} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Need list</a>
            {canEdit && <button type="button" aria-pressed={view === 'prices'} className={view === 'prices' ? 'on' : ''} onClick={() => setView(v => (v === 'prices' ? 'estimate' : 'prices'))}><SlidersHorizontal size={14} /> Prices</button>}
          </div>
        </div>
        <p className="oce-hint">{EST_LEVEL_HINT[input.level]}</p>

        <section className="oce-est" aria-label="Estimate">
          <div className="oce-est-top">
            <div>
              <div className="oce-est-what">{unitLabel(input.bedrooms)} · {bedsText(input.beds)} · {input.baths} bath · sleeps {input.guests}</div>
              <div className="oce-total" data-est-total>{usd(est.total)}</div>
            </div>
            <div className="oce-range">{usd(est.low)} to {usd(est.high)}</div>
          </div>
          <dl>
            <div><dt>Linen <small>{level} · par {par} · +{settings.linenUpliftPct}%</small></dt><dd>{usd(est.lines.linen)}</dd></div>
            <div><dt>Onboarding clean <small>{est.clean.extra ? '+' + usd(est.clean.extra) + ' for size' : 'one time'}</small></dt><dd>{usd(est.lines.clean)}</dd></div>
            <div><dt>Kitchen and housewares <small>{inv.count} items · {level.toLowerCase()}</small></dt><dd>{usd(est.lines.inventory)}</dd></div>
          </dl>
        </section>
        {est.linen.unpriced > 0 && <p className="oce-warn" role="status">{est.linen.unpriced} linen {est.linen.unpriced === 1 ? 'line has' : 'lines have'} no price yet, so linen reads low. Add the price per item on <a href="/onboarding/linens">Linens</a>.</p>}
        {err && <p className="oce-err" role="alert">{err}</p>}

        {view === 'prices' && canEdit ? (
          <section className="oce-prices" aria-label="Prices">
            <div className="oce-rates">
              {RATE_FIELDS.map(([k, label]) => (
                <label key={k} htmlFor={'rate-' + k}>{label}
                  <input id={'rate-' + k} type="number" min={0} step="any" value={String(settings[k] as number)} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) setDraft(normEstSettings({ ...settings, [k]: v })) }} />
                </label>
              ))}
            </div>
            <div className="oce-scroll">
              <table className="oce-t oce-book">
                <thead><tr><th>Price per set, pack or item</th>{EST_LEVELS.map(l => <th key={l} className="n">{EST_LEVEL_LABEL[l]}</th>)}</tr></thead>
                <tbody>
                  {bookLines.map(b => (
                    <tr key={b.key}>
                      <td><b>{b.label}</b><small>{PRICE_BOOK[b.key].what.join(' · ')}</small></td>
                      {EST_LEVELS.map((l, n) => (
                        <td key={l} className="n"><input aria-label={b.label + ', ' + EST_LEVEL_LABEL[l]} type="number" min={0} step="any" className={settings.prices[b.key] ? 'own' : ''} value={String((settings.prices[b.key] || PRICE_BOOK[b.key].p)[n])} onChange={e => setPrice(b.key, n, Number(e.target.value))} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="oce-save">
              <button type="button" className="oce-go" disabled={!draft || saving} onClick={saveRates}>{saving ? 'Saving…' : 'Save prices'}</button>
              {draft ? <button type="button" onClick={() => setDraft(null)}>Undo</button> : null}
              <span>{draft ? 'Not saved yet' : 'Saved prices apply to everyone'}</span>
            </div>
          </section>
        ) : (
          <table className="oce-t">
            <thead><tr><th>Item</th><th>Type</th><th className="n">Qty</th><th className="n">Estimate</th></tr></thead>
            <tbody>
              <tr className="cat"><td colSpan={4}><div className="oce-grp"><span>Linen</span><span className="oce-grp-n">{usd(est.lines.linen)}</span></div><small className="oce-grp-d">Bedding and towels at par {par}, priced per item, plus {settings.taxPct}% tax and the {settings.linenUpliftPct}% allowance</small></td></tr>
              {est.linen.rows.filter(r => r.qty > 0).map(r => (
                <tr key={r.key}>
                  <td><b>{r.name}{r.size ? ', ' + r.size : ''}</b><small>{r.price === null ? 'no price yet' : cents(r.price) + ' each'}</small></td>
                  <td />
                  <td className="n"><span className="oce-q">{r.qty}</span></td>
                  <td className="n">{r.cost === null ? '—' : cents(r.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tbody>
              <tr className="cat"><td colSpan={4}><div className="oce-grp"><span>Onboarding clean</span><span className="oce-grp-n">{usd(est.lines.clean)}</span></div><small className="oce-grp-d">One time, before the first guest{est.clean.extra ? ': ' + usd(est.clean.base) + ' plus ' + usd(est.clean.extra) + ' for the size' : ''}</small></td></tr>
            </tbody>
            {NEED_ROOMS.map(room => {
              const list = inv.rows.filter(r => r.group === room)
              if (!list.length) return null
              return (
                <tbody key={room}>
                  <tr className="cat"><td colSpan={4}><div className="oce-grp"><span>{room}</span><span className="oce-grp-n">{usd(list.reduce((a, r) => a + (r.on ? r.cost : 0), 0))}</span></div>{GROUP_NOTE[room] && <small className="oce-grp-d">{GROUP_NOTE[room]}</small>}</td></tr>
                  {list.map(r => (
                    <tr key={r.key} className={r.on ? '' : 'off'}>
                      <td>
                        <label className="oce-it">
                          <input type="checkbox" checked={r.on} onChange={e => { setPicks(p => ({ ...p, [r.key]: e.target.checked })); setCopied(false) }} />
                          <span className="oce-pic" aria-hidden="true"><NeedPicture k={r.icon || r.key} name={r.name} size={36} /></span>
                          <span><b>{r.name}</b>{r.product ? <small>{r.product}{r.price !== null && r.qty > 1 ? ' · ' + usd(r.price) + ' each' : ''}</small> : null}{r.detail ? <small>Each set: {r.detail}</small> : null}</span>
                        </label>
                      </td>
                      <td><i className={'oce-tier ' + r.tier}>{TYPE[r.tier]}</i></td>
                      <td className="n"><span className="oce-q">{r.qty}</span></td>
                      <td className="n oce-amt">{r.price === null ? 'no price' : usd(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              )
            })}
          </table>
        )}
        <p className="oce-fine">Untick what the unit already has. Counts are the need list’s: two place settings per guest, a wine glass per guest, hangers and luggage racks per bedroom. Standard is basic and value-first, Mid is Stay’s usual pick, Luxury is premium brands; prices are typical retail for that grade. Not on the list because we supply them: soap dispensers and every consumable. Furniture, TVs and appliances are not priced.{inv.unpriced.length ? ' No price yet for ' + inv.unpriced.join(', ') + '.' : ''}</p>
      </main>
    </div>
  )
}

const CSS = `
.oce{--paper:#fff;--ground:transparent;--ink:#15212B;--muted:#6B7880;--line:#DCE2E0;--accent:#1F5F5B;--soft:#E2EFED;--on:#fff;
  --must-bg:#E1EAF5;--must-fg:#1C4A7E;--rec-bg:#E0EFE4;--rec-fg:#25633A;--opt-bg:#ECEFF1;--opt-fg:#56626B;--warn-bg:#FBF1DC;--warn-fg:#7A5210;--bad:#A3302A;
  --display:'Instrument Serif',Georgia,serif;--ui:'Geist','Inter',system-ui,sans-serif;
  background:var(--ground);color:var(--ink);font-family:var(--ui);font-size:14.5px;line-height:1.45;color-scheme:light;padding:16px 12px 48px}
.oce *{box-sizing:border-box}
.oce-wrap{max-width:860px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:24px 18px}
@media (min-width:700px){.oce{padding:24px 24px 48px}.oce-wrap{padding:36px 40px}}
.oce-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600}
.oce h1{font-family:var(--display);font-weight:400;font-size:clamp(34px,6vw,46px);line-height:1.05;margin:6px 0 8px;color:var(--ink)}
.oce-lede{color:var(--muted);margin:0 0 20px;max-width:62ch}
.oce-spin{animation:oce-spin 1s linear infinite;vertical-align:-2px}@keyframes oce-spin{to{transform:rotate(360deg)}}
.oce-panel{border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;gap:14px}
.oce-counts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.oce-count{display:grid;gap:6px}
.oce-l{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);font-weight:500}
.oce-step{display:flex;align-items:center;border:1px solid var(--line);border-radius:999px;overflow:hidden}
.oce-step button{border:0;background:none;width:40px;height:40px;flex:none;display:grid;place-items:center;cursor:pointer;color:var(--ink)}.oce-step button:hover{background:var(--soft)}
.oce-step input{border:0;width:100%;min-width:0;text-align:center;font:400 24px var(--display);color:var(--ink);background:none;-moz-appearance:textfield}
.oce-step input::-webkit-outer-spin-button,.oce-step input::-webkit-inner-spin-button,.oce-sqft input::-webkit-outer-spin-button,.oce-sqft input::-webkit-inner-spin-button,.oce-book input::-webkit-outer-spin-button,.oce-book input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.oce-beds{display:grid;gap:8px;border-top:1px solid var(--line);padding-top:14px}
.oce-minis{display:flex;flex-wrap:wrap;gap:8px}
.oce-mini{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--line);border-radius:999px;padding:2px 4px 2px 12px;font-size:13.5px;color:var(--muted)}
.oce-mini.on{color:var(--ink)}
.oce-mini b{min-width:22px;text-align:center;font:400 19px var(--display);color:var(--ink)}
.oce-mini button{border:0;background:none;width:30px;height:30px;border-radius:999px;display:grid;place-items:center;cursor:pointer;color:var(--ink)}.oce-mini button:hover{background:var(--soft)}.oce-mini button:disabled{opacity:.3;cursor:default}
.oce-sqft{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:2px 12px;font-size:13.5px;color:var(--muted);min-height:36px}
.oce-sqft input{border:0;background:none;width:84px;font:500 14px var(--ui);color:var(--ink);-moz-appearance:textfield}
.oce-kit{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding-top:14px}
.oce-yn{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px}
.oce-yn button{border:0;background:none;border-radius:999px;padding:6px 18px;font:600 13.5px var(--ui);color:var(--muted);cursor:pointer}.oce-yn button.on{background:var(--ink);color:var(--paper)}
.oce-apps{display:flex;flex-wrap:wrap;gap:8px}
.oce-app{position:relative;display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:6px 13px 6px 8px;font-size:13.5px;cursor:pointer;color:var(--muted)}
.oce-app input{position:absolute;opacity:0;width:1px;height:1px}
.oce-box{width:17px;height:17px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;color:var(--on)}
.oce-app.on{color:var(--ink);border-color:var(--accent);background:var(--soft)}.oce-app.on .oce-box{background:var(--accent);border-color:var(--accent)}
.oce-app:focus-within,.oce button:focus-visible,.oce a:focus-visible,.oce input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.oce-opt{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink);border-top:1px solid var(--line);padding-top:12px}
.oce-opt input,.oce-it input{accent-color:var(--accent);width:16px;height:16px;flex:none}
.oce-bar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin:22px 0 4px}
.oce-grade{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px}
.oce-grade button{border:0;background:none;border-radius:999px;padding:6px 14px;font:600 13px var(--ui);color:var(--muted);cursor:pointer}.oce-grade button.on{background:var(--accent);color:var(--on)}
.oce-hint{margin:0 0 12px;font-size:12.5px;color:var(--muted)}
.oce-acts{display:flex;flex-wrap:wrap;gap:8px}
.oce-acts button,.oce-acts a,.oce-save button{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:7px 13px;font:600 13px var(--ui);color:var(--ink);cursor:pointer;text-decoration:none}
.oce-acts button:hover,.oce-acts a:hover{border-color:var(--ink)}.oce-acts button.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.oce-est{background:var(--ink);color:var(--paper);border-radius:14px;padding:18px 20px}
.oce-est-top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.oce-est-what{font-size:12.5px;opacity:.75}
.oce-total{font:400 clamp(44px,9vw,58px)/1 var(--display);margin-top:4px;font-variant-numeric:tabular-nums}
.oce-range{font-size:13px;opacity:.75;font-variant-numeric:tabular-nums;padding-bottom:6px}
.oce-est dl{margin:12px 0 0;display:grid}
.oce-est dl div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-top:1px solid color-mix(in srgb,var(--paper) 22%,transparent)}
.oce-est dt{font-weight:600}.oce-est dt small{font-weight:400;font-size:12px;opacity:.7;margin-left:6px}
.oce-est dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.oce-warn{margin:10px 0 0;background:var(--warn-bg);color:var(--warn-fg);border-radius:10px;padding:9px 12px;font-size:13px}.oce-warn a{color:inherit;font-weight:600}
.oce-err{color:var(--bad);font-size:13px;margin:10px 0 0}
.oce-t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;margin-top:8px}
.oce-t th{text-align:left;font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--ink)}
.oce-t td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.oce-t td small{display:block;color:var(--muted);font-size:12px}
.oce-t .n{text-align:right;white-space:nowrap}
.oce-t tr.cat td{font-family:var(--display);font-size:20px;padding-top:20px;border-bottom:1px solid var(--ink)}
.oce-grp{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.oce-grp-n{font-family:var(--ui);font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.oce-grp-d{display:block;font-family:var(--ui);font-size:12.5px;color:var(--muted);margin-top:2px}
.oce-tier{font-style:normal;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
.oce-tier.must{background:var(--must-bg);color:var(--must-fg)}.oce-tier.recommended{background:var(--rec-bg);color:var(--rec-fg)}.oce-tier.optional{background:var(--opt-bg);color:var(--opt-fg)}
.oce-it{display:flex;align-items:center;gap:10px;cursor:pointer}
.oce-pic{flex:none;width:44px;height:44px;border-radius:12px;background:var(--soft);color:var(--accent);display:grid;place-items:center}
.oce-q{font-family:var(--display);font-size:22px}
.oce-amt{font-weight:600}
.oce-t tr.off td{color:var(--muted)}.oce-t tr.off .oce-amt{text-decoration:line-through;font-weight:400}.oce-t tr.off .oce-pic{opacity:.45}
.oce-fine{margin-top:22px;font-size:12.5px;color:var(--muted)}
.oce-prices{margin-top:14px;display:grid;gap:14px}
.oce-rates{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.oce-rates label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
.oce-rates input,.oce-book input{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:500 14px var(--ui);color:var(--ink);background:var(--paper);-moz-appearance:textfield}
.oce-book input{width:78px;text-align:right}.oce-book input.own{border-color:var(--accent);background:var(--soft)}
.oce-scroll{overflow-x:auto}.oce-book{min-width:520px;margin-top:0}
.oce-save{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12.5px;color:var(--muted)}
.oce-save .oce-go{background:var(--accent);color:var(--on);border-color:var(--accent)}.oce-save .oce-go:disabled{opacity:.5;cursor:default}
@media (max-width:560px){
  .oce-counts{grid-template-columns:1fr}
  .oce-t:not(.oce-book) th:nth-child(2),.oce-t:not(.oce-book) td:nth-child(2){display:none}
  .oce-t td,.oce-t th{padding-inline:6px}.oce-pic{width:38px;height:38px}
}
@media print{.oce-panel,.oce-acts{display:none}.oce-wrap{border:0}}
`

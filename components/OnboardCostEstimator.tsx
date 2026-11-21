'use client'
// ONBOARDING COST ESTIMATOR (Jon, 2026-11-20) — /sales/onboarding-cost. Sales describes the unit with
// chips and steppers (no drop-downs) and reads three lines: linen, the onboarding clean, inventory.
// It assumes a fully furnished unit, and we supply the consumables. Appliances are never priced — what
// the unit has only shapes the inventory list. One level per unit (standard / mid / luxury) picks the
// linen tier and the product on every line. Kept lean on purpose (Jon: "lean this up"): one card of
// rows, no help paragraphs. All arithmetic is lib/onboard-estimate.ts and lib/linens.ts.
import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Loader2, Minus, Plus } from 'lucide-react'
import { LeanHead, Tag } from '@/components/lean'
import { linenQuote, atPar, fmtUsd, type LinenStandard } from '@/lib/linens'
import {
  EST_BEDS, EST_HAS, EST_LEVELS, EST_LEVEL_LABEL, LINEN_TIER_OF, STOCK_FOR_LEVEL, WHY_CONSUMABLE, estDefaults, estimate, estimateText, guestsFromBeds, hasDefaults, linenUnitOf, unitLabel, bedsText, normEstSettings,
  type EstInput, type EstKitchen, type EstLevel, type EstRow, type EstSettings, type EstStock,
} from '@/lib/onboard-estimate'

const CARD = 'rounded-2xl border border-line bg-white'
const CHIP = 'rounded-full border px-3 py-1 text-[13px] font-semibold min-h-[32px]'
const ON = CHIP + ' border-neutral-900 bg-neutral-900 text-white'
const OFF = CHIP + ' border-line bg-white text-ink hover:bg-app'
const NUM = 'rounded-lg border border-line bg-white px-2 py-1 text-[13px] tabular-nums focus:outline-none focus:border-ink'
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const BEDROOMS = ['Studio', '1', '2', '3', '4']
const KITCHENS: [EstKitchen, string][] = [['full', 'Full'], ['kitchenette', 'Kitchenette'], ['none', 'None']]
const STOCKS: [EstStock, string][] = [['must', 'Must-haves'], ['rec', '+ Recommended'], ['all', 'Everything'], ['none', 'None']]
const PLACE: Record<EstLevel, string> = { standard: 'Broward', mid: 'Miami', luxury: 'Salato' }
const NEED_TAG: Record<string, string> = { recommended: 'recommended', suggested: 'nice to have' }
const BED_LABEL: Record<string, string> = { 'Sofa bed': 'Sofa' }
const RATE_FIELDS: [keyof EstSettings, string][] = [
  ['cleanStudio', 'Clean, studio ($)'], ['clean1br', 'Clean, 1 bedroom ($)'], ['cleanPerExtraBedroom', 'Clean, each extra bedroom ($)'],
  ['sqftStepCost', 'Clean, per block over typical size ($)'], ['sqftStep', 'Block size (sq ft)'], ['taxPct', 'Linen tax (%)'], ['linenUpliftPct', 'Linen allowance (%)'],
]

function Chips<T extends string | number>({ value, options, onPick }: { value: T; options: [T, string, string?][]; onPick: (v: T) => void }) {
  return <>{options.map(([v, label, sub]) => (
    <button key={String(v)} type="button" aria-pressed={value === v} title={sub} onClick={() => onPick(v)} className={value === v ? ON : OFF}>{label}</button>
  ))}</>
}
function Step({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  const btn = 'h-7 w-7 rounded-md text-ink inline-flex items-center justify-center hover:bg-app disabled:opacity-30'
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white pl-3 pr-1 min-h-[32px]">
      <span className="text-[13px] font-semibold">{label}</span>
      <button type="button" className={btn} aria-label={'Fewer: ' + label} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Minus size={13} /></button>
      <span className="min-w-[18px] text-center text-[13px] font-bold tabular-nums">{value}</span>
      <button type="button" className={btn} aria-label={'More: ' + label} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Plus size={13} /></button>
    </span>
  )
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-2.5 border-b border-line last:border-b-0">
      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold sm:pt-2">{label}</div>
      <div className="flex flex-wrap items-center gap-2 min-w-0">{children}</div>
    </div>
  )
}

export function OnboardCostEstimator() {
  const [data, setData] = useState<{ standard: LinenStandard; rows: EstRow[]; left: { name: string; why: string }[]; settings: EstSettings; level: string } | null>(null)
  const [err, setErr] = useState('')
  const [input, setInput] = useState<EstInput>(() => estDefaults(1))
  const [picks, setPicks] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<'inv' | 'linen' | 'rates'>('inv')
  const [copied, setCopied] = useState(false)
  const [draft, setDraft] = useState<EstSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let dead = false
    fetch('/api/onboard-estimate', { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (dead) return
      if (!j?.ok) { setErr(j?.error || 'Could not load the estimator.'); return }
      setData({ standard: j.standard, rows: j.rows || [], left: j.left || [], settings: normEstSettings(j.settings), level: j.level || 'view' })
    }).catch(() => { if (!dead) setErr('Could not load the estimator. Check the connection and reload.') })
    return () => { dead = true }
  }, [])

  const settings = draft || data?.settings || null
  const est = useMemo(() => {
    if (!data || !settings) return null
    const std = input.par ? atPar(data.standard, input.par) : data.standard
    const q = linenQuote({ ...std, markupPct: 0, taxPct: 0 }, [linenUnitOf(input)], LINEN_TIER_OF[input.level])
    return estimate(q, data.rows, input, settings, picks)
  }, [data, settings, input, picks])

  const set = (patch: Partial<EstInput>, clearPicks = false) => { setInput(i => ({ ...i, ...patch })); if (clearPicks) setPicks({}); setCopied(false) }
  const setBed = (k: string, n: number) => setInput(i => {
    const beds = { ...i.beds, [k]: n }; if (!n) delete beds[k]
    return Object.keys(beds).length ? { ...i, beds, guests: guestsFromBeds(beds) } : i
  })
  const pickBedrooms = (b: number) => setInput(i => ({ ...estDefaults(b), kitchen: i.kitchen, sqft: i.sqft, level: i.level, par: i.par, stock: i.stock, has: i.has }))
  const copy = async () => { if (!est) return; try { await navigator.clipboard.writeText(estimateText(input, est)); setCopied(true) } catch { setErr('Could not copy from this browser.') } }
  const saveRates = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const r = await fetch('/api/onboard-estimate', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: draft }) })
      const j = await r.json().catch(() => null)
      if (!j?.ok) { setErr(j?.error || 'Could not save the rates.'); return }
      setData(d => d ? { ...d, settings: normEstSettings(j.settings) } : d); setDraft(null); setErr('')
    } catch { setErr('Could not save the rates. Check the connection and try again.') } finally { setSaving(false) }
  }

  if (err && !data) return <div className="p-6"><LeanHead title="Onboarding cost" /><p className="text-[13px] text-rose-700">{err}</p></div>
  if (!data || !settings || !est) return <div className="p-6"><LeanHead title="Onboarding cost" /><p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading prices…</p></div>

  const canEdit = data.level === 'full'
  const par = input.par || data.standard.par
  const groups: string[] = []
  for (const r of est.inventory.rows) if (!groups.includes(r.category)) groups.push(r.category)
  const consumables = data.left.filter(l => l.why === WHY_CONSUMABLE).length
  const unpricedLeft = data.left.filter(l => l.why !== WHY_CONSUMABLE).map(l => l.name)
  const lines: [string, number, string][] = [
    ['Linen', est.lines.linen, EST_LEVEL_LABEL[input.level] + ' · par ' + par + ' · +' + settings.linenUpliftPct + '%'],
    ['Onboarding clean', est.lines.clean, est.clean.extra ? '+' + usd(est.clean.extra) + ' for size' : 'one time'],
    ['Inventory', est.lines.inventory, est.inventory.count ? est.inventory.count + ' items · ' + EST_LEVEL_LABEL[input.level].toLowerCase() : 'nothing to buy'],
  ]

  return (
    <div className="p-4 sm:p-6 max-w-[1100px]">
      <LeanHead title="Onboarding cost" sub="Fully furnished unit · we supply consumables · an estimate, not a quote" />
      {err ? <p className="mb-3 text-[13px] text-rose-700">{err}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] items-start">
        <section className={CARD + ' min-w-0'}>
          <Row label="Bedrooms"><Chips value={Math.min(input.bedrooms, 4)} options={BEDROOMS.map((b, i) => [i, b] as [number, string])} onPick={pickBedrooms} /></Row>
          <Row label="Beds">{EST_BEDS.map(k => <Step key={k} label={BED_LABEL[k] || k} value={input.beds[k] || 0} min={0} max={8} onChange={n => setBed(k, n)} />)}</Row>
          <Row label="Unit">
            <Step label="Baths" value={input.baths} min={1} max={8} step={0.5} onChange={n => set({ baths: n })} />
            <Step label="Guests" value={input.guests} min={1} max={20} onChange={n => set({ guests: n })} />
            <Step label="TVs" value={input.tvs} min={0} max={8} onChange={n => set({ tvs: n })} />
            <input id="est-sqft" type="number" inputMode="numeric" min={0} step={50} placeholder="Sq ft" aria-label="Square feet" title={'Typical ' + unitLabel(input.bedrooms).toLowerCase() + ': ' + est.clean.typical.toLocaleString('en-US') + ' sq ft'} className={NUM + ' w-[84px] min-h-[32px]'} value={input.sqft || ''} onChange={e => set({ sqft: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
          </Row>
          <Row label="Kitchen">
            <Chips value={input.kitchen} options={KITCHENS} onPick={k => set({ kitchen: k, has: hasDefaults(k) }, true)} />
            <span className="text-[12px] text-muted pl-1">has</span>
            {EST_HAS.map(h => <button key={h.key} type="button" aria-pressed={!!input.has[h.key]} title={h.key === 'microwave' ? 'No microwave adds a countertop one' : 'No stove means no cookware set'} className={input.has[h.key] ? ON : OFF} onClick={() => set({ has: { ...input.has, [h.key]: !input.has[h.key] } }, true)}>{h.label}</button>)}
          </Row>
          <Row label="Level">
            <Chips value={input.level} options={EST_LEVELS.map(l => [l, EST_LEVEL_LABEL[l], PLACE[l]] as [EstLevel, string, string])} onPick={l => set({ level: l, stock: input.stock === 'none' ? 'none' : STOCK_FOR_LEVEL[l] }, true)} />
            <Step label="Linen par" value={par} min={1} max={4} step={0.5} onChange={n => set({ par: n === data.standard.par ? 0 : n })} />
          </Row>
          <Row label="Inventory"><Chips value={input.stock} options={STOCKS} onPick={s => set({ stock: s }, true)} /></Row>
        </section>

        <aside className={CARD + ' p-4 flex flex-col gap-2 lg:sticky lg:top-4 min-w-0'} aria-live="polite">
          <div className="text-[12.5px] text-muted">{unitLabel(input.bedrooms)} · {bedsText(input.beds)} · {input.baths} bath · sleeps {input.guests}</div>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="text-[40px] leading-none font-bold tabular-nums tracking-tight" data-est-total>{usd(est.total)}</div>
            <div className="text-[12.5px] text-muted">{usd(est.low)} to {usd(est.high)}</div>
          </div>
          <div className="border-t border-line mt-1">
            {lines.map(([label, amt, note]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 py-2 border-b border-line">
                <span className="text-[13.5px] font-semibold">{label} <span className="font-normal text-[12px] text-muted">{note}</span></span>
                <span className="text-[13.5px] font-bold tabular-nums">{usd(amt)}</span>
              </div>
            ))}
          </div>
          {est.linen.unpriced > 0 ? <p className="text-[12.5px] text-amber-700">{est.linen.unpriced} linen {est.linen.unpriced === 1 ? 'line has' : 'lines have'} no price, so linen reads low. <a className="underline" href="/onboarding/linens">Add prices</a></p> : null}
          <button type="button" onClick={copy} className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white font-semibold text-[13px] min-h-[36px] px-3 hover:bg-neutral-800">{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy the estimate'}</button>
        </aside>
      </div>

      <div className="mt-5 flex flex-wrap gap-1 border-b border-line" role="tablist">
        {([['inv', 'Inventory'], ['linen', 'Linen'], ...(canEdit ? [['rates', 'Rates']] : [])] as [typeof tab, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={'px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px ' + (tab === k ? 'border-neutral-900 text-ink' : 'border-transparent text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>

      {tab === 'inv' ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <tbody>
              {groups.map(g => [
                <tr key={'g' + g} className="bg-app text-[12px] font-semibold"><td className="w-7" /><td className="py-1.5 px-1" colSpan={2}>{g}</td><td /><td className="py-1.5 px-1 text-right">{usd(est.inventory.groups[g] || 0)}</td></tr>,
                ...est.inventory.rows.filter(r => r.category === g).map(r => (
                  <tr key={r.name} className={'border-b border-line ' + (r.on ? '' : 'text-muted')}>
                    <td className="py-1.5"><input type="checkbox" id={'est-' + r.name} checked={r.on} aria-label={r.name} onChange={e => { setPicks(p => ({ ...p, [r.name]: e.target.checked })); setCopied(false) }} className="h-4 w-4 accent-neutral-900 align-middle" /></td>
                    <td className="py-1.5 px-1 whitespace-nowrap"><label htmlFor={'est-' + r.name} className="cursor-pointer font-medium">{r.name}</label>{NEED_TAG[r.need] ? <span className="ml-2"><Tag>{NEED_TAG[r.need]}</Tag></span> : null}</td>
                    <td className="py-1.5 px-1 text-[12px] text-muted max-w-[320px] truncate hidden md:table-cell" title={r.product}>{r.product}</td>
                    <td className="py-1.5 px-1 text-right">{r.qty > 1 ? '×' + r.qty : ''}</td>
                    <td className={'py-1.5 px-1 text-right ' + (r.on ? '' : 'line-through')}>{fmtUsd(r.cost)}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted">Untick what the unit has. Not listed: {consumables} consumables we supply{unpricedLeft.length ? '; no price yet for ' + unpricedLeft.join(', ') : ''}.</p>
        </div>
      ) : null}

      {tab === 'linen' ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <tbody>
              {est.linen.rows.map(r => (
                <tr key={r.key} className="border-b border-line">
                  <td className="py-1.5 px-1 whitespace-nowrap font-medium">{r.name}{r.size ? ', ' + r.size : ''}</td>
                  <td className="py-1.5 px-1 text-[12px] text-muted max-w-[320px] truncate hidden md:table-cell" title={r.product}>{r.product}</td>
                  <td className="py-1.5 px-1 text-right">{r.qty} × {r.price === null ? <Tag tone="amber">no price</Tag> : fmtUsd(r.price)}</td>
                  <td className="py-1.5 px-1 text-right">{r.cost === null ? '' : fmtUsd(r.cost)}</td>
                </tr>
              ))}
              <tr className="bg-app font-semibold"><td className="py-1.5 px-1" colSpan={3}>At par {par} {fmtUsd(est.linen.atPar)} · with {settings.taxPct}% tax {fmtUsd(est.linen.taxed)} · with the {settings.linenUpliftPct}% allowance</td><td className="py-1.5 px-1 text-right">{fmtUsd(est.linen.total)}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted">Par levels and prices come from <a className="underline" href="/onboarding/linens">Linens</a>.</p>
        </div>
      ) : null}

      {tab === 'rates' && canEdit ? (
        <div className="mt-3">
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {RATE_FIELDS.map(([k, label]) => (
              <label key={k} htmlFor={'rate-' + k} className="flex flex-col gap-1 text-[12px] text-muted">{label}
                <input id={'rate-' + k} type="number" min={0} step="any" className={NUM} value={String(settings[k] as number)} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) setDraft(normEstSettings({ ...settings, [k]: v })) }} />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!draft || saving} onClick={saveRates} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 text-white font-semibold text-[13px] min-h-[36px] px-3 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : null} Save rates</button>
            {draft ? <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-line bg-white text-ink font-semibold text-[13px] min-h-[36px] px-3 hover:bg-app">Undo</button> : null}
            <span className="text-[12px] text-muted">{draft ? 'Not saved yet' : 'Saved rates apply to everyone'}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

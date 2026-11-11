'use client'
// THE ORDER & SET-UP CHECKLIST on the starter kit page (Jon, 2026-11-11: "The goal is to make it easy and
// add a checkmark list for them too, so when they order they can check it off and a checklist for added
// to unit. Make it super nice").
//
// Every item the home needs, grouped Must have → Recommended → Optional, with two big ticks per line:
// Ordered (only where something is left to buy — owner-provided and already-covered lines say so instead)
// and In unit. Progress overall and per tier, and a filter for what is not ordered / not in the unit yet.
// The ticks live in the kit's own saved selection (selection.ordered / selection.added) and are saved by
// StarterKitReport through the same POST as every other choice, so the owner, a buyer and the team see
// the same list on any device. The Excel and PDF downloads print them ticked.
//
// Rendered inside StarterKitReport's .skr scope, so it uses that page's colour variables; its own
// classes are .skc-*.
import { useMemo, useState } from 'react'
import { Check, ListChecks, PackageCheck, ShoppingCart } from 'lucide-react'
import { needsOrder, type KitLine, type KitTier } from '@/lib/starter-kit'

export type TickKind = 'ordered' | 'added'
const TIERS: KitTier[] = ['must', 'recommended', 'optional']
const TIER_LABEL: Record<KitTier, string> = { must: 'Must have', recommended: 'Recommended', optional: 'Optional' }
const TIER_HINT: Record<KitTier, string> = { must: 'Every home needs these', recommended: 'Guests notice when these are missing', optional: 'Extras you chose' }
type Filter = 'all' | 'notOrdered' | 'notAdded'
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

export function StarterKitChecklist({ lines, ordered, added, onTick, saving }: {
  lines: KitLine[]                                   // the included lines, as the kit computes them
  ordered: Record<string, boolean>; added: Record<string, boolean>
  onTick: (kind: TickKind, key: string, on: boolean) => void
  saving: 'idle' | 'saving' | 'saved' | 'error'
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const stats = useMemo(() => {
    const toOrder = lines.filter(needsOrder)
    const by = Object.fromEntries(TIERS.map(t => {
      const ls = lines.filter(l => l.item.tier === t)
      const o = ls.filter(needsOrder)
      return [t, { n: ls.length, toOrder: o.length, ordered: o.filter(l => ordered[l.item.key]).length, added: ls.filter(l => added[l.item.key]).length }]
    })) as Record<KitTier, { n: number; toOrder: number; ordered: number; added: number }>
    return { toOrder: toOrder.length, ordered: toOrder.filter(l => ordered[l.item.key]).length, added: lines.filter(l => added[l.item.key]).length, by }
  }, [lines, ordered, added])

  const keep = (l: KitLine) => filter === 'all' ? true : filter === 'notOrdered' ? needsOrder(l) && !ordered[l.item.key] : !added[l.item.key]
  const shown = TIERS.map(t => ({ t, ls: lines.filter(l => l.item.tier === t && keep(l)) }))
  const notOrdered = stats.toOrder - stats.ordered, notAdded = lines.length - stats.added
  const allDone = lines.length > 0 && notAdded === 0 && notOrdered === 0

  return (
    <section className="skr-sec skc" id="checklist" aria-labelledby="skc-h">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="skr-sec-h">
        <h2 id="skc-h">Order &amp; set-up checklist</h2>
        <p>
          <span className={'skc-save ' + saving} aria-live="polite">
            {saving === 'saving' ? 'Saving ticks…' : saving === 'error' ? 'Not saved yet, we will retry on your next tick' : 'Ticks save to this kit link, so everyone with it sees the same list'}
          </span>
        </p>
      </div>

      <div className="skc-over">
        <Meter icon={<ShoppingCart size={18} />} label="Ordered" a={stats.ordered} b={stats.toOrder} note={stats.toOrder < lines.length ? `${lines.length - stats.toOrder} covered or provided by you` : 'items left to buy'} />
        <Meter icon={<PackageCheck size={18} />} label="In the unit" a={stats.added} b={lines.length} note="items set up in the home" />
        {allDone && <div className="skc-done-all"><Check size={18} /> Everything is ordered and in the unit. The home is ready.</div>}
      </div>

      <div className="skc-filter" role="radiogroup" aria-label="Show">
        {([['all', `All ${lines.length}`], ['notOrdered', `Not ordered · ${notOrdered}`], ['notAdded', `Not in unit · ${notAdded}`]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {shown.map(({ t, ls }) => {
        const s = stats.by[t]
        if (!s.n) return null
        return (
          <div key={t} className={'skc-tier ' + t}>
            <div className="skc-tier-h">
              <div className="skc-tier-t"><i className={'skr-tier ' + t}>{TIER_LABEL[t]}</i><span>{TIER_HINT[t]} · {s.n} item{s.n === 1 ? '' : 's'}</span></div>
              <div className="skc-mini">
                <span title="Ordered"><ShoppingCart size={13} /> {s.ordered}/{s.toOrder}<b><i style={{ width: pct(s.ordered, s.toOrder) + '%' }} /></b></span>
                <span title="In the unit"><PackageCheck size={13} /> {s.added}/{s.n}<b><i style={{ width: pct(s.added, s.n) + '%' }} /></b></span>
              </div>
            </div>
            {ls.length === 0 ? (
              <p className="skc-empty"><Check size={15} /> {filter === 'notOrdered' ? 'All ordered here.' : 'All in the unit here.'}</p>
            ) : (
              <ul className="skc-list">
                {ls.map(l => {
                  const k = l.item.key
                  const o = !!ordered[k], a = !!added[k]
                  const orderable = needsOrder(l)
                  return (
                    <li key={k} className={'skc-row' + (a && (o || !orderable) ? ' done' : '')}>
                      <div className="skc-name">
                        <b>{l.item.name}</b>
                        <small>{l.item.category} · {l.source === 'self' ? 'you provide it' : l.toBuy > 0 ? `buy ${l.toBuy}` : 'covered by what you have'}{l.qty > 1 ? ` · ${l.qty} in the home` : ''}</small>
                      </div>
                      {orderable ? (
                        <button type="button" className={'skc-tick' + (o ? ' on' : '')} aria-pressed={o} aria-label={(o ? 'Ordered: ' : 'Mark ordered: ') + l.item.name} onClick={() => onTick('ordered', k, !o)}>
                          <span className="skc-box">{o && <Check size={16} strokeWidth={3} />}</span><span className="skc-tl">Ordered</span>
                        </button>
                      ) : <span className="skc-na">{l.source === 'self' ? 'Yours' : 'Covered'}</span>}
                      <button type="button" className={'skc-tick' + (a ? ' on' : '')} aria-pressed={a} aria-label={(a ? 'In the unit: ' : 'Mark in the unit: ') + l.item.name} onClick={() => onTick('added', k, !a)}>
                        <span className="skc-box">{a && <Check size={16} strokeWidth={3} />}</span><span className="skc-tl">In unit</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
      {lines.length === 0 && <p className="skc-empty"><ListChecks size={15} /> Nothing is in the kit yet.</p>}
    </section>
  )
}

function Meter({ icon, label, a, b, note }: { icon: React.ReactNode; label: string; a: number; b: number; note: string }) {
  const p = pct(a, b)
  return (
    <div className="skc-meter">
      <div className="skc-meter-h"><span>{icon} {label}</span><b>{a}<small>/{b}</small></b></div>
      <div className="skc-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={b} aria-valuenow={a}><i style={{ width: p + '%' }} /></div>
      <div className="skc-meter-s">{p}% · {note}</div>
    </div>
  )
}

const CSS = `
.skc-save{font-size:13px;color:var(--muted)}.skc-save.error{color:#A3302A}
.skc-over{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.skc-meter{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:16px 18px;display:grid;gap:10px}
.skc-meter-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.skc-meter-h span{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:14.5px}.skc-meter-h span svg{color:var(--accent)}
.skc-meter-h b{font-family:var(--display);font-weight:400;font-size:38px;line-height:1;font-variant-numeric:tabular-nums}.skc-meter-h small{font-size:20px;color:var(--muted)}
.skc-bar{height:10px;border-radius:999px;background:var(--ground);overflow:hidden}.skc-bar i{display:block;height:100%;background:var(--accent);border-radius:999px;transition:width .35s}
.skc-meter-s{font-size:12.5px;color:var(--muted)}
.skc-done-all{grid-column:1/-1;display:flex;align-items:center;gap:10px;background:var(--rec-bg);color:var(--rec);border-radius:14px;padding:12px 16px;font-weight:600}
.skc-filter{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 4px}
.skc-filter button{min-height:44px;border:1px solid var(--line);background:var(--paper);color:var(--ink2);border-radius:999px;padding:0 18px;font:600 14px var(--ui);cursor:pointer}
.skc-filter button.on{background:var(--ink);border-color:var(--ink);color:#fff}
.skc-tier{margin-top:18px;background:var(--paper);border:1px solid var(--line);border-left:5px solid var(--opt);border-radius:16px;overflow:hidden}
.skc-tier.must{border-left-color:var(--must)}.skc-tier.recommended{border-left-color:var(--rec)}
.skc-tier-h{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 18px;padding:14px 16px;border-bottom:1px solid var(--line);background:#FAFBFB}
.skc-tier-t{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.skc-tier-t span{font-size:13px;color:var(--muted)}
.skc-mini{display:flex;gap:16px}
.skc-mini span{display:grid;grid-template-columns:auto auto;align-items:center;gap:2px 6px;font-size:12.5px;font-weight:600;color:var(--ink2);font-variant-numeric:tabular-nums}
.skc-mini span svg{color:var(--muted)}
.skc-mini b{grid-column:1/-1;display:block;width:96px;height:6px;border-radius:999px;background:var(--ground);overflow:hidden}.skc-mini b i{display:block;height:100%;background:var(--accent);transition:width .35s}
.skc-list{list-style:none;margin:0;padding:0}
.skc-row{display:grid;grid-template-columns:minmax(0,1fr) 128px 128px;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}
.skc-row:last-child{border-bottom:0}
.skc-name b{display:block;font-weight:600;font-size:15.5px}.skc-name small{display:block;font-size:12.5px;color:var(--muted);margin-top:1px}
.skc-row.done{background:#F7FAF8}.skc-row.done .skc-name b{color:var(--muted);text-decoration:line-through;text-decoration-color:rgba(37,99,58,.5)}
.skc-tick{display:flex;align-items:center;gap:10px;min-height:52px;width:100%;border:1.5px solid var(--line);background:var(--paper);border-radius:14px;padding:0 12px;cursor:pointer;font:600 14px var(--ui);color:var(--ink2);-webkit-tap-highlight-color:transparent;transition:background .15s,border-color .15s}
.skc-tick:hover{border-color:var(--accent)}
.skc-box{flex:none;width:26px;height:26px;border-radius:8px;border:2px solid #B8C2C0;display:grid;place-items:center;color:#fff;transition:background .15s,border-color .15s}
.skc-tick.on{background:var(--rec-bg);border-color:var(--rec);color:var(--rec)}.skc-tick.on .skc-box{background:var(--rec);border-color:var(--rec)}
.skc-tick:active{transform:scale(.98)}
.skc-na{display:flex;align-items:center;justify-content:center;min-height:52px;border:1.5px dashed var(--line);border-radius:14px;font-size:13px;color:var(--muted)}
.skc-empty{display:flex;align-items:center;gap:8px;margin:0;padding:16px;color:var(--rec);font-size:14px;font-weight:500}
@media (max-width:640px){
  .skc-over{grid-template-columns:1fr}
  .skc-row{grid-template-columns:1fr 1fr;row-gap:8px;padding:12px}
  .skc-name{grid-column:1/-1}
  .skc-mini b{width:72px}
}
@media (prefers-reduced-motion:reduce){.skc *{transition:none!important}}
@media print{
  .skc-filter{display:none}.skc-tick,.skc-na{min-height:0;padding:4px 8px;border-radius:6px}.skc-box{width:14px;height:14px;border-radius:3px}
  .skc-tier{break-inside:auto}.skc-row{break-inside:avoid;padding:6px 10px}
}
`

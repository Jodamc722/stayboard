'use client'
// VIEWS — the period, cut any way (Jon, 2026-11-23: "have multiple ways of viewing data, booking window,
// LOS, etc"). Pick what to group by, what to measure, and optionally what to split each group by. The
// data is the report's own stay-by-room lines (lib/garden/report-depth `cube`), so every view adds up to
// the same totals as the numbers at the top of the page, and follows the period, the side and the filters.
import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { LeanEmpty } from '@/components/lean'

type Line = { c: string; l: number; d: number | null; a: string; b: string | null; s: string; w: string; t: string; n: number; r: number; x: number; k: number }
type Dim = { key: string; label: string; hint: string; of: (x: Line) => string | null; order?: string[]; sort?: 'label' }
type Measure = { key: string; label: string; additive: boolean; fmt: (v: number | null) => string }

const money = (n: number | null) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')
const int = (n: number | null) => n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString('en-US')
const one = (n: number | null) => n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1)
const pct = (n: number | null) => n == null ? '—' : Math.round(n) + '%'

const LEAD = ['Same day', '1 day', '2–3 days', '4–7 days', '8–14 days', '15–30 days', '31–60 days', '61–90 days', '91+ days']
const leadOf = (d: number | null) => d == null ? null : d <= 0 ? LEAD[0] : d === 1 ? LEAD[1] : d <= 3 ? LEAD[2] : d <= 7 ? LEAD[3] : d <= 14 ? LEAD[4] : d <= 30 ? LEAD[5] : d <= 60 ? LEAD[6] : d <= 90 ? LEAD[7] : LEAD[8]
const LOS = ['1 night', '2 nights', '3 nights', '4 nights', '5 nights', '6 nights', '7 nights', '8–13 nights', '14–29 nights', '30+ nights']
const losOf = (n: number) => n <= 7 ? LOS[Math.max(1, n) - 1] : n <= 13 ? LOS[7] : n <= 29 ? LOS[8] : LOS[9]
const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const dowOf = (ymd: string) => DOW[(new Date(ymd + 'T12:00:00Z').getUTCDay() + 6) % 7]
const monthName = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const weekOf = (ymd: string) => { const t = Date.parse(ymd + 'T12:00:00Z'); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10) }
const weekName = (w: string) => 'Week of ' + new Date(w + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const DIMS: Dim[] = [
  { key: 'lead', label: 'Booking window', hint: 'days between the booking and the arrival', of: x => leadOf(x.d), order: LEAD },
  { key: 'los', label: 'Length of stay', hint: 'nights of the whole stay', of: x => losOf(x.l), order: LOS },
  { key: 'channel', label: 'Channel', hint: 'where the booking came from', of: x => x.c },
  { key: 'dow', label: 'Arrival day', hint: 'day of the week the guest arrives', of: x => dowOf(x.a), order: DOW },
  { key: 'amonth', label: 'Arrival month', hint: 'month of arrival', of: x => x.a.slice(0, 7), sort: 'label' },
  { key: 'aweek', label: 'Arrival week', hint: 'week of arrival, Monday to Sunday', of: x => weekOf(x.a), sort: 'label' },
  { key: 'bmonth', label: 'Booked month', hint: 'month the booking was made', of: x => x.b ? x.b.slice(0, 7) : null, sort: 'label' },
  { key: 'bweek', label: 'Booked week', hint: 'week the booking was made (pickup)', of: x => x.b ? weekOf(x.b) : null, sort: 'label' },
  { key: 'type', label: 'Room type', hint: 'Cloudbeds room type', of: x => x.t },
  { key: 'wing', label: 'Wing', hint: 'room number block', of: x => x.w, sort: 'label' },
  { key: 'side', label: 'Garden / Botanica', hint: 'which side of the property the room is on', of: x => x.s === 'botanica' ? 'Botanica' : 'Garden' },
]
const nameOf = (dim: Dim, k: string) => dim.key === 'amonth' || dim.key === 'bmonth' ? monthName(k) : dim.key === 'aweek' || dim.key === 'bweek' ? weekName(k) : k

type Acc = { rev: number; nights: number; stays: number; losSum: number; leadSum: number; leadN: number; dead: number }
const acc = (): Acc => ({ rev: 0, nights: 0, stays: 0, losSum: 0, leadSum: 0, leadN: 0, dead: 0 })
const put = (a: Acc, x: Line) => { if (x.x) { a.dead += x.k; return } a.rev += x.r; a.nights += x.n; a.stays += x.k; a.losSum += x.l * x.k; if (x.d != null) { a.leadSum += x.d * x.k; a.leadN += x.k } }
const MEASURES: (Measure & { of: (a: Acc, total: Acc) => number | null })[] = [
  { key: 'rev', label: 'Revenue', additive: true, fmt: money, of: a => a.rev },
  { key: 'nights', label: 'Room nights', additive: true, fmt: int, of: a => a.nights },
  { key: 'stays', label: 'Stays', additive: true, fmt: int, of: a => a.stays },
  { key: 'adr', label: 'ADR', additive: false, fmt: money, of: a => a.nights ? a.rev / a.nights : null },
  { key: 'los', label: 'Average stay', additive: false, fmt: v => v == null ? '—' : one(v) + ' nts', of: a => a.stays ? a.losSum / a.stays : null },
  { key: 'lead', label: 'Average booking window', additive: false, fmt: v => v == null ? '—' : Math.round(v) + ' days', of: a => a.leadN ? a.leadSum / a.leadN : null },
  { key: 'cancel', label: 'Cancelled', additive: false, fmt: pct, of: a => a.stays + a.dead ? (a.dead / (a.stays + a.dead)) * 100 : null },
]
// Split colours: the brand green first, then quiet hues that stay apart from it and from each other.
const HUES = ['#52705a', '#c08a3e', '#5b7fa6', '#a8627a', '#7b6bd0', '#4f9a94', '#9a9a9a']

export function GardenViews({ api, from, to, scope, fq }: { api: string; from: string; to: string; scope: string; fq: string }) {
  const [d, setD] = useState<any>(null)
  const [dimKey, setDimKey] = useState('lead')
  const [mKey, setMKey] = useState('rev')
  const [splitKey, setSplitKey] = useState('')
  useEffect(() => { setD(null); fetch(`${api}?depth=1&from=${from}&to=${to}&scope=${scope}${fq}`, { cache: 'no-store' }).then(r => r.json()).then(setD).catch(e => setD({ ok: false, error: String(e) })) }, [api, from, to, scope, fq])
  // Which view is open lives in the URL, so a link opens the same one.
  useEffect(() => { try { const sp = new URLSearchParams(location.search); const g = sp.get('by'), m = sp.get('measure'), s = sp.get('split'); if (g && DIMS.some(x => x.key === g)) setDimKey(g); if (m && MEASURES.some(x => x.key === m)) setMKey(m); if (s && DIMS.some(x => x.key === s)) setSplitKey(s) } catch {} }, [])
  const keep = (k: string, v: string) => { try { const u = new URL(location.href); if (v) u.searchParams.set(k, v); else u.searchParams.delete(k); history.replaceState(null, '', u.toString()) } catch {} }

  const dim = DIMS.find(x => x.key === dimKey)!, measure = MEASURES.find(x => x.key === mKey)!
  const split = splitKey && splitKey !== dimKey ? DIMS.find(x => x.key === splitKey) || null : null
  const view = useMemo(() => {
    const lines: Line[] = d?.cube || []
    const total = acc(), groups = new Map<string, Acc>(), cells = new Map<string, Map<string, Acc>>(), splitTot = new Map<string, Acc>()
    let unknown = 0
    for (const x of lines) {
      const g = dim.of(x)
      if (g == null) { if (!x.x) unknown += x.k; continue }
      put(total, x)
      if (!groups.has(g)) groups.set(g, acc()); put(groups.get(g)!, x)
      if (split) {
        const s = split.of(x) ?? 'Not known'
        if (!cells.has(g)) cells.set(g, new Map()); const row = cells.get(g)!
        if (!row.has(s)) row.set(s, acc()); put(row.get(s)!, x)
        if (!splitTot.has(s)) splitTot.set(s, acc()); put(splitTot.get(s)!, x)
      }
    }
    let keys = Array.from(groups.keys())
    if (dim.order) keys = dim.order.filter(k => groups.has(k))
    else if (dim.sort === 'label') keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    else keys.sort((a, b) => groups.get(b)!.rev - groups.get(a)!.rev)
    // The split's columns: the six largest by revenue, the rest together.
    let cols = Array.from(splitTot.keys())
    if (split?.order) cols = split.order.filter(k => splitTot.has(k)); else if (split?.sort === 'label') cols.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); else cols.sort((a, b) => splitTot.get(b)!.rev - splitTot.get(a)!.rev)
    const shown = cols.slice(0, 6), rest = cols.slice(6)
    const cell = (g: string, s: string): Acc => cells.get(g)?.get(s) || acc()
    const restOf = (g: string): Acc => { const a = acc(); for (const s of rest) { const c = cell(g, s); a.rev += c.rev; a.nights += c.nights; a.stays += c.stays; a.losSum += c.losSum; a.leadSum += c.leadSum; a.leadN += c.leadN; a.dead += c.dead } return a }
    return { total, groups, keys, shown, rest, cell, restOf, unknown, lines: lines.length }
  }, [d, dim, split])

  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2 py-6"><Loader2 size={14} className="animate-spin" /> Building the views…</p>
  if (!d.ok) return <LeanEmpty>{d.error || 'Could not build the views.'}</LeanEmpty>
  const val = (a: Acc) => measure.of(a, view.total)
  const max = Math.max(1e-9, ...view.keys.map(k => Number(val(view.groups.get(k)!)) || 0))
  const splitCols = split ? [...view.shown, ...(view.rest.length ? ['Other'] : [])] : []
  const part = (g: string, s: string) => s === 'Other' ? view.restOf(g) : view.cell(g, s)
  const exportCsv = () => {
    const head = [dim.label, 'Revenue', 'Share of revenue %', 'Room nights', 'Stays', 'ADR', 'Average stay (nights)', 'Average booking window (days)', 'Cancelled %', ...splitCols.map(s => `${split!.label}: ${nameOf(split!, s)} — ${measure.label}`)]
    const row = (label: string, a: Acc, g?: string) => [label, Math.round(a.rev), view.total.rev ? Math.round((a.rev / view.total.rev) * 1000) / 10 : 0, a.nights, Math.round(a.stays * 10) / 10, a.nights ? Math.round(a.rev / a.nights) : '', a.stays ? Math.round((a.losSum / a.stays) * 10) / 10 : '', a.leadN ? Math.round(a.leadSum / a.leadN) : '', a.stays + a.dead ? Math.round((a.dead / (a.stays + a.dead)) * 100) : '', ...(g ? splitCols.map(s => { const v = val(part(g, s)); return v == null ? '' : Math.round(v * 100) / 100 }) : splitCols.map(() => ''))]
    const rows = [head, ...view.keys.map(k => row(nameOf(dim, k), view.groups.get(k)!, k)), row('Total', view.total)]
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `garden-${dim.key}-${from}-to-${to}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  const chip = (on: boolean) => `text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ${on ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`
  const th = 'px-3 py-2 font-semibold text-right whitespace-nowrap'

  return (
    <div>
      <div className="grid gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-wrap"><span className="w-[72px] shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-muted">View by</span>{DIMS.map(x => <button key={x.key} title={x.hint} onClick={() => { setDimKey(x.key); keep('by', x.key) }} className={chip(dimKey === x.key)}>{x.label}</button>)}</div>
        <div className="flex items-center gap-1.5 flex-wrap"><span className="w-[72px] shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Measure</span>{MEASURES.map(x => <button key={x.key} onClick={() => { setMKey(x.key); keep('measure', x.key) }} className={chip(mKey === x.key)}>{x.label}</button>)}</div>
        <div className="flex items-center gap-1.5 flex-wrap"><span className="w-[72px] shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Split by</span><button onClick={() => { setSplitKey(''); keep('split', '') }} className={chip(!split)}>Nothing</button>{DIMS.filter(x => x.key !== dimKey && ['channel', 'side', 'los', 'lead', 'type', 'dow'].includes(x.key)).map(x => <button key={x.key} title={x.hint} onClick={() => { setSplitKey(x.key); keep('split', x.key) }} className={chip(split?.key === x.key)}>{x.label}</button>)}
          <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app"><Download size={12} /> Export this view</button></div>
      </div>

      {view.keys.length ? (
        <div className="rounded-xl border border-line bg-white overflow-x-auto">
          <div className="px-3.5 pt-3 pb-1 flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-ink">{measure.label} by {dim.label.toLowerCase()}{split ? `, split by ${split.label.toLowerCase()}` : ''}</span>
            <span className="text-[11.5px] text-muted">{dim.hint}</span>
            {split && measure.additive ? <span className="ml-auto flex items-center gap-2.5 flex-wrap text-[11px] text-muted">{splitCols.map((s, i) => <span key={s} className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: HUES[i % HUES.length] }} />{nameOf(split, s)}</span>)}</span> : null}
          </div>
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">
              <th className="px-3 py-2 font-semibold text-left">{dim.label}</th><th className="px-3 py-2 font-semibold text-left w-[30%] min-w-[160px]">{measure.label}</th>
              {split ? splitCols.map(s => <th key={s} className={th}>{nameOf(split, s)}</th>) : <>
                {mKey === 'rev' ? null : <th className={th}>Revenue</th>}<th className={th} title="Share of the revenue shown here">Share</th><th className={th}>Room nights</th><th className={th}>Stays</th><th className={th}>ADR</th><th className={th} title="Average nights of the whole stay">Avg stay</th><th className={th} title="Average days between booking and arrival">Booked ahead</th><th className={th} title="Share of bookings cancelled or no-show">Cancelled</th></>}
            </tr></thead>
            <tbody>
              {view.keys.map(k => { const a = view.groups.get(k)!, v = val(a); return (
                <tr key={k} className="border-b border-line/60">
                  <td className="px-3 py-2 font-semibold text-ink whitespace-nowrap">{nameOf(dim, k)}</td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2">
                    <div className="flex-1 h-3 rounded bg-app overflow-hidden flex">
                      {split && measure.additive ? splitCols.map((s, i) => { const pv = Number(val(part(k, s))) || 0; return pv > 0 ? <div key={s} title={`${nameOf(split, s)}: ${measure.fmt(pv)}`} style={{ width: `${(pv / max) * 100}%`, background: HUES[i % HUES.length] }} className="h-full border-r border-white last:border-r-0" /> : null })
                        : <div className="h-full bg-brand-600 rounded" style={{ width: `${Math.max(v ? 1.5 : 0, ((Number(v) || 0) / max) * 100)}%` }} />}
                    </div>
                    <span className="w-[76px] text-right font-semibold text-ink">{measure.fmt(v)}</span>
                  </div></td>
                  {split ? splitCols.map(s => <td key={s} className="px-3 py-2 text-right">{measure.fmt(val(part(k, s)))}</td>) : <>
                    {mKey === 'rev' ? null : <td className="px-3 py-2 text-right">{money(a.rev)}</td>}<td className="px-3 py-2 text-right text-muted">{view.total.rev ? pct((a.rev / view.total.rev) * 100) : '—'}</td><td className="px-3 py-2 text-right">{int(a.nights)}</td><td className="px-3 py-2 text-right">{int(a.stays)}</td>
                    <td className="px-3 py-2 text-right">{a.nights ? money(a.rev / a.nights) : '—'}</td><td className="px-3 py-2 text-right">{a.stays ? one(a.losSum / a.stays) : '—'}</td><td className="px-3 py-2 text-right">{a.leadN ? Math.round(a.leadSum / a.leadN) + ' d' : '—'}</td><td className="px-3 py-2 text-right">{a.stays + a.dead ? pct((a.dead / (a.stays + a.dead)) * 100) : '—'}</td></>}
                </tr>) })}
              <tr className="bg-app/60 font-semibold text-ink">
                <td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{measure.fmt(val(view.total))}</td>
                {split ? splitCols.map(s => <td key={s} className="px-3 py-2" />) : <>
                  {mKey === 'rev' ? null : <td className="px-3 py-2 text-right">{money(view.total.rev)}</td>}<td className="px-3 py-2 text-right">100%</td><td className="px-3 py-2 text-right">{int(view.total.nights)}</td><td className="px-3 py-2 text-right">{int(view.total.stays)}</td>
                  <td className="px-3 py-2 text-right">{view.total.nights ? money(view.total.rev / view.total.nights) : '—'}</td><td className="px-3 py-2 text-right">{view.total.stays ? one(view.total.losSum / view.total.stays) : '—'}</td><td className="px-3 py-2 text-right">{view.total.leadN ? Math.round(view.total.leadSum / view.total.leadN) + ' d' : '—'}</td><td className="px-3 py-2 text-right">{view.total.stays + view.total.dead ? pct((view.total.dead / (view.total.stays + view.total.dead)) * 100) : '—'}</td></>}
              </tr>
            </tbody>
          </table>
          <p className="text-[11.5px] text-muted px-3.5 py-2 border-t border-line/60">Revenue and room nights are the part of each stay inside {from} to {to}. A stay in two rooms counts as one stay.{view.unknown ? ` ${int(view.unknown)} stay${view.unknown === 1 ? ' has' : 's have'} no ${dim.key.startsWith('b') || dim.key === 'lead' ? 'booking date' : 'value'} and ${view.unknown === 1 ? 'is' : 'are'} left out of this view.` : ''}{d.partial ? ' Some bookings could not be read just now, so these numbers may be short — refresh in a moment.' : ''}</p>
        </div>
      ) : <LeanEmpty>No stays in this period{fq ? ' with these filters' : ''}.</LeanEmpty>}
    </div>
  )
}

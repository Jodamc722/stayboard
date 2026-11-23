'use client'
// GARDEN REVENUE (lib/garden/revenue) — rebuilt around a PERIOD (Jon, 2026-11-20: "make it clearer and
// cleaner and be able to select dates and time periods").
//   1. Pick the period: presets, the arrows (one period back / forward) or two dates.
//   2. Six numbers for it, each against the period just before.
//   3. One chart — revenue, occupancy or ADR — by day, week or month, whichever fits the length.
//   4. The detail in tabs: Channels · Bookings · Rates ahead · Room types.
// A period before the hotel was connected can be read in from Cloudbeds with one button.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react'
import { LeanEmpty, Tag } from '@/components/lean'
import { ResDrawer } from '@/components/GardenResDetail'
import { GardenDepth } from '@/components/GardenDepth'

const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')
const moneyK = (n: number) => n >= 10000 ? '$' + (Math.round(n / 100) / 10).toLocaleString('en-US') + 'k' : money(n)
const pct = (n: number | null | undefined) => n == null ? '—' : n + '%'
const iso = (d: Date) => d.toISOString().slice(0, 10)
const add = (ymd: string, n: number) => iso(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5))
const todayNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const dayLabel = (s: string, yr = false) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: yr ? 'numeric' : undefined, timeZone: 'UTC' })
const dow = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const monthStart = (ymd: string, off = 0) => { const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)) - 1 + off; return iso(new Date(Date.UTC(y, m, 1, 12))) }
const monthEnd = (ymd: string, off = 0) => { const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)) + off; return iso(new Date(Date.UTC(y, m, 0, 12))) }

type Preset = { key: string; label: string; range: (t: string) => [string, string] }
const PRESETS: Preset[] = [
  { key: 'today', label: 'Today', range: t => [t, t] },
  { key: 'week', label: 'This week', range: t => { const d = (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7; return [add(t, -d), add(t, 6 - d)] } },
  { key: 'month', label: 'This month', range: t => [monthStart(t), monthEnd(t)] },
  { key: 'lastmonth', label: 'Last month', range: t => [monthStart(t, -1), monthEnd(t, -1)] },
  { key: 'nextmonth', label: 'Next month', range: t => [monthStart(t, 1), monthEnd(t, 1)] },
  { key: 'last30', label: 'Last 30 days', range: t => [add(t, -29), t] },
  { key: 'next30', label: 'Next 30 days', range: t => [t, add(t, 29)] },
  { key: 'next90', label: 'Next 90 days', range: t => [t, add(t, 89)] },
  { key: 'ytd', label: 'Year to date', range: t => [t.slice(0, 4) + '-01-01', t] },
]
type Metric = 'revenue' | 'occupancy' | 'adr'
type Tab = 'depth' | 'channels' | 'bookings' | 'ahead' | 'types'
type Scope = 'all' | 'garden' | 'botanica'

function Delta({ cur, prev, unit }: { cur: number | null; prev: number | null; unit: 'pct' | 'pts' }) {
  if (cur == null || prev == null || (unit === 'pct' && !prev)) return <span className="text-muted">no earlier period to compare</span>
  const v = unit === 'pct' ? Math.round(((cur - prev) / prev) * 100) : Math.round((cur - prev) * 10) / 10
  if (!v) return <span className="text-muted">same as the period before</span>
  return <span className={v > 0 ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>{v > 0 ? '▲' : '▼'} {Math.abs(v)}{unit === 'pct' ? '%' : ' pts'}</span>
}
function Kpi({ label, value, children, sub }: { label: string; value: string; children?: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-3 min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="text-[24px] font-semibold tabular-nums text-ink leading-tight mt-0.5">{value}</div>
      <div className="text-[11.5px] mt-0.5 truncate">{children}</div>
      {sub ? <div className="text-[11px] text-muted truncate">{sub}</div> : null}
    </div>
  )
}

export function GardenRevenue() {
  const t0 = useMemo(todayNY, [])
  const [range, setRange] = useState<[string, string]>(() => PRESETS[2].range(todayNY()))
  const [preset, setPreset] = useState('month')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState<Metric>('revenue')
  const [tab, setTab] = useState<Tab>('channels')
  const [ahead, setAhead] = useState(60)
  const [bf, setBf] = useState<'all' | 'owed' | 'guesty' | 'cloudbeds'>('all')
  const [bq, setBq] = useState('')
  const [open, setOpen] = useState<any | null>(null)
  const [fill, setFill] = useState('')
  const [scope, setScopeState] = useState<Scope>('all')
  const setScope = (v: Scope) => { setScopeState(v); try { const u = new URL(location.href); if (v === 'all') u.searchParams.delete('scope'); else u.searchParams.set('scope', v); history.replaceState(null, '', u.toString()) } catch {} }

  // The period lives in the URL, so a link or a reload opens the same one.
  useEffect(() => { try { const sp = new URLSearchParams(location.search); const sc = sp.get('scope'); if (sc === 'garden' || sc === 'botanica') setScopeState(sc); if (sp.get('view') === 'depth') setTab('depth'); const f = sp.get('from'), t = sp.get('to'); if (f && t && /^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t) && t >= f) { setRange([f, t]); setPreset(PRESETS.find(p => { const r = p.range(todayNY()); return r[0] === f && r[1] === t })?.key || 'custom') } } catch {} }, [])
  const go = (r: [string, string], key: string) => { setRange(r); setPreset(key); try { const u = new URL(location.href); u.searchParams.set('from', r[0]); u.searchParams.set('to', r[1]); history.replaceState(null, '', u.toString()) } catch {} }
  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/garden/revenue?from=${range[0]}&to=${range[1]}&ahead=${ahead}&scope=${scope}`, { cache: 'no-store' }).then(x => x.json()).catch(e => ({ ok: false, error: String(e) }))
    setD(r); setLoading(false)
  }, [range, ahead, scope])
  useEffect(() => { load() }, [load])

  const span = Math.round((Date.parse(range[1]) - Date.parse(range[0])) / 864e5) + 1
  const shift = (dir: 1 | -1) => {
    const wholeMonth = range[0] === monthStart(range[0]) && range[1] === monthEnd(range[0])
    go(wholeMonth ? [monthStart(range[0], dir), monthEnd(range[0], dir)] : [add(range[0], dir * span), add(range[1], dir * span)], 'custom')
  }
  // Day bars up to 45 days, weeks up to ~6 months, months beyond.
  const grain: 'day' | 'week' | 'month' = span <= 45 ? 'day' : span <= 190 ? 'week' : 'month'
  const series = useMemo(() => {
    const days: any[] = d?.byDay || []
    if (grain === 'day') return days.map(x => ({ key: x.date, label: String(Number(x.date.slice(8))), sub: dow(x.date), title: dayLabel(x.date), nights: x.nights, revenue: x.revenue, n: 1, future: x.date > t0, today: x.date === t0 }))
    const m = new Map<string, any>()
    for (const x of days) {
      const k = grain === 'month' ? x.date.slice(0, 7) : add(x.date, -((new Date(x.date + 'T12:00:00Z').getUTCDay() + 6) % 7))
      const g = m.get(k) || { key: k, nights: 0, revenue: 0, n: 0, first: x.date, last: x.date }
      g.nights += x.nights; g.revenue += x.revenue; g.n++; g.last = x.date; m.set(k, g)
    }
    return Array.from(m.values()).map(g => ({ ...g, label: grain === 'month' ? new Date(g.key + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : dayLabel(g.first), sub: '', title: grain === 'month' ? new Date(g.key + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : `${dayLabel(g.first)} – ${dayLabel(g.last)}`, future: g.first > t0, today: false }))
  }, [d, grain, t0])
  const val = (x: any) => metric === 'revenue' ? x.revenue : metric === 'occupancy' ? (d?.rooms ? Math.round((x.nights / (d.rooms * x.n)) * 1000) / 10 : 0) : (x.nights ? Math.round(x.revenue / x.nights) : 0)
  const fmt = (v: number) => metric === 'revenue' ? money(v) : metric === 'occupancy' ? v + '%' : money(v)
  const max = Math.max(1, ...series.map(val))

  const backfill = async () => {
    if (!d?.coverageFrom) return
    const end = add(d.coverageFrom, -1)
    for (let a = range[0]; a <= end; a = add(a, 10)) {
      const b = add(a, 9) > end ? end : add(a, 9)
      setFill(`Reading ${dayLabel(a)} – ${dayLabel(b)} from Cloudbeds…`)
      const r = await fetch('/api/garden/revenue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: a, to: b }) }).then(x => x.json()).catch(e => ({ ok: false, error: String(e) }))
      if (!r?.ok) { setFill('Stopped: ' + (r?.error || 'Cloudbeds did not answer.')); return }
    }
    setFill(''); load()
  }
  const exportCsv = () => {
    const rows = [['Guest', 'Room', 'Check-in', 'Check-out', 'Nights', 'Channel', 'Total', 'Balance', 'Status', 'Booked', 'System'], ...(d?.bookings || []).map((b: any) => [b.guest || '', (b.rooms || []).join(' '), b.checkIn, b.checkOut, b.nights ?? '', b.channel, b.total, b.balance ?? '', b.status, String(b.bookedAt || '').slice(0, 10), b.origin])]
    const csv = rows.map(r => r.map((c: any) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `garden-bookings-${range[0]}-to-${range[1]}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const head = (
    <div className="space-y-2 mb-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESETS.map(p => <button key={p.key} onClick={() => go(p.range(t0), p.key)} className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${preset === p.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{p.label}</button>)}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12.5px]" title="Botanica = the rooms sold as Botanica through Guesty (matched by room number). Garden = every other room.">
          {([['all', 'Whole property'], ['garden', 'Garden'], ['botanica', 'Botanica']] as [Scope, string][]).map(([k, l]) => <button key={k} onClick={() => setScope(k)} className={'px-3 py-1.5 font-semibold border-l border-line first:border-l-0 ' + (scope === k ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink')}>{l}{d?.segments ? <span className="ml-1 font-normal opacity-80">{d.segments[k]}</span> : null}</button>)}
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => shift(-1)} aria-label="Earlier period" className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ChevronLeft size={15} /></button>
          <button onClick={() => shift(1)} aria-label="Later period" className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ChevronRight size={15} /></button>
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-muted">From <input type="date" value={range[0]} max={range[1]} onChange={e => e.target.value && go([e.target.value, e.target.value > range[1] ? e.target.value : range[1]], 'custom')} className="text-[12px] font-semibold border border-line rounded-lg px-2.5 py-1.5 bg-white text-ink outline-none" /></label>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-muted">to <input type="date" value={range[1]} min={range[0]} onChange={e => e.target.value && go([range[0], e.target.value], 'custom')} className="text-[12px] font-semibold border border-line rounded-lg px-2.5 py-1.5 bg-white text-ink outline-none" /></label>
        <span className="text-sm font-semibold text-ink inline-flex items-center gap-1.5 ml-1">{loading ? <Loader2 size={15} className="text-brand-600 animate-spin" /> : <CalendarRange size={15} className="text-brand-600" />} {dayLabel(range[0], range[0].slice(0, 4) !== range[1].slice(0, 4))} – {dayLabel(range[1], true)} <span className="text-[12px] font-medium text-muted">· {span} night{span === 1 ? '' : 's'}</span></span>
      </div>
    </div>
  )
  if (!d) return <div>{head}<p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Adding up the period…</p></div>
  if (!d.ok) return <div>{head}<LeanEmpty>{d.error}</LeanEmpty></div>
  const b = d.books, p = d.prev
  const prevLabel = `vs ${dayLabel(p.from)} – ${dayLabel(p.to)}`
  const beforeCoverage = d.coverageFrom && range[0] < d.coverageFrom
  const prevCovered = !d.coverageFrom || p.from >= d.coverageFrom
  const future = range[0] > t0, past = range[1] < t0
  const fwdMax = Math.max(1, ...d.forward.map((x: any) => x.rate || 0))
  const ql = bq.trim().toLowerCase()
  const bookings = (d.bookings || []).filter((x: any) => (bf === 'all' || (bf === 'owed' ? (x.balance || 0) > 0 : x.origin === bf)) && (!ql || [x.guest, (x.rooms || []).join(' '), x.channel, x.id].join(' ').toLowerCase().includes(ql)))
  const owed = (d.bookings || []).filter((x: any) => (x.balance || 0) > 0)

  return (
    <div className={loading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      {head}

      {beforeCoverage ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 mb-3 text-[12.5px] text-amber-900 flex items-center gap-3 flex-wrap">
          <span>Lighthouse has the hotel&apos;s bookings from <b>{dayLabel(d.coverageFrom, true)}</b>. The part of this period before that is not loaded yet, so these numbers are low.</span>
          <button onClick={backfill} disabled={!!fill && !fill.startsWith('Stopped')} className="ml-auto rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">{fill && !fill.startsWith('Stopped') ? 'Loading…' : 'Load it from Cloudbeds'}</button>
          {fill ? <span className="basis-full text-[12px]">{fill}</span> : null}
        </div>
      ) : null}

      {/* The period in six numbers, each against the one before it. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi label={future ? 'Revenue on the books' : 'Room revenue'} value={money(b.revenue)} sub={prevCovered ? prevLabel : undefined}>{prevCovered ? <Delta cur={b.revenue} prev={p.revenue} unit="pct" /> : <span className="text-muted">earlier period not loaded</span>}</Kpi>
        <Kpi label="Occupancy" value={pct(b.occupancy)} sub={`${b.nights.toLocaleString()} of ${(d.rooms * span).toLocaleString()} room nights`}>{prevCovered ? <Delta cur={b.occupancy} prev={p.occupancy} unit="pts" /> : null}</Kpi>
        <Kpi label="ADR" value={money(b.adr)} sub="average rate per night sold">{prevCovered ? <Delta cur={b.adr} prev={p.adr} unit="pct" /> : null}</Kpi>
        <Kpi label="RevPAR" value={money(b.revpar)} sub={`revenue per room, ${d.rooms} rooms`}>{prevCovered ? <Delta cur={b.revpar} prev={p.revpar} unit="pct" /> : null}</Kpi>
        <Kpi label="Stays" value={b.bookings.toLocaleString()} sub={`${b.cancelled} cancelled or no-show`}>{prevCovered ? <Delta cur={b.bookings} prev={p.bookings} unit="pct" /> : null}</Kpi>
        <Kpi label={future ? 'Booked so far' : 'Booked in this period'} value={past || !future ? String(d.booked.bookings) : '—'} sub={past || !future ? `${money(d.booked.revenue)} · for any stay date` : 'the period has not started'}>{d.booked.cancelled ? <span className="text-muted">{d.booked.cancelled} of them since cancelled</span> : <span className="text-muted">new reservations made</span>}</Kpi>
      </div>
      <p className="text-[11.5px] text-muted mt-1.5">{scope === 'all' ? 'Whole property' : scope === 'garden' ? 'Garden rooms only' : 'Botanica rooms only'}: {d.rooms} rooms{d.segments?.blocked ? `, ${d.segments.blocked} of them blocked in Cloudbeds` : ''}.{d.guesty?.bookings ? ` Includes ${d.guesty.bookings} Botanica booking${d.guesty.bookings === 1 ? '' : 's'} from Guesty (${money(d.guesty.revenue)}).` : ''}</p>
      {d.today && range[0] <= t0 && range[1] >= t0 ? <p className="text-[12px] text-ink mt-2"><span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted mr-2">Today, live from Cloudbeds</span>{pct(d.today.occupancy)} occupied · {d.today.arrivals} arrivals · {d.today.departures} departures · {d.today.inHouse} in house · {d.today.bookings} booked today</p> : null}

      {/* One chart. */}
      <div className="rounded-xl border border-line bg-white p-3.5 mt-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[13px] font-semibold text-ink">{metric === 'revenue' ? 'Room revenue' : metric === 'occupancy' ? 'Occupancy' : 'ADR'} by {grain}</span>
          <span className="text-[11.5px] text-muted">{series.some(x => x.future) ? 'lighter bars are still to come (on the books today)' : ''}</span>
          <div className="ml-auto inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
            {(['revenue', 'occupancy', 'adr'] as Metric[]).map(m => <button key={m} onClick={() => setMetric(m)} className={'px-3 py-1 font-semibold border-l border-line first:border-l-0 ' + (metric === m ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>{m === 'revenue' ? 'Revenue' : m === 'occupancy' ? 'Occupancy' : 'ADR'}</button>)}
          </div>
        </div>
        {series.length && series.some(x => val(x) > 0) ? (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-[3px] h-44" style={{ minWidth: series.length * 16 }}>
              {series.map(x => { const v = val(x); return (
                <div key={x.key} className="flex-1 min-w-[12px] h-full flex flex-col justify-end items-center group relative" title={`${x.title}: ${fmt(v)}${metric !== 'revenue' ? ' · ' + money(x.revenue) : ''} · ${x.nights} room nights`}>
                  {series.length <= 16 ? <span className="text-[10px] tabular-nums text-muted mb-0.5">{metric === 'revenue' ? moneyK(v) : fmt(v)}</span> : null}
                  <div className={'w-full rounded-t ' + (x.today ? 'bg-brand-800' : x.future ? 'bg-brand-300' : 'bg-brand-600')} style={{ height: `${Math.max(v > 0 ? 2 : 0, Math.round((v / max) * (series.length <= 16 ? 86 : 100)))}%` }} />
                </div>
              ) })}
            </div>
            <div className="flex gap-[3px] mt-1" style={{ minWidth: series.length * 16 }}>
              {series.map((x, i) => <div key={x.key} className={'flex-1 min-w-[12px] text-center text-[9.5px] leading-tight tabular-nums ' + (x.today ? 'text-ink font-bold' : 'text-muted')}>{grain === 'day' ? (series.length <= 31 || i % 2 === 0 ? <>{x.label}<br /><span className="opacity-70">{series.length <= 16 ? x.sub : x.sub.slice(0, 1)}</span></> : '') : (series.length <= 14 || i % 2 === 0 ? x.label : '')}</div>)}
            </div>
          </div>
        ) : <p className="text-[12.5px] text-muted py-8 text-center">Nothing booked in this period yet.</p>}
      </div>

      {/* The detail, in tabs. */}
      <div className="flex gap-1 mt-5 mb-3 border-b border-line">
        {([['depth', 'In-depth report'], ['channels', `Channels · ${d.byChannel.length}`], ['bookings', `Bookings · ${(d.bookings || []).length}`], ['ahead', 'Rates ahead'], ['types', `Room types · ${d.types.length}`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-[13px] font-semibold -mb-px border-b-2 ${tab === k ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {tab === 'depth' ? <GardenDepth from={range[0]} to={range[1]} scope={scope} onScope={setScope} /> : null}

      {tab === 'channels' ? (d.byChannel.length ? (
        <div className="rounded-xl border border-line bg-white overflow-x-auto">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{[['Channel', ''], ['Share of revenue', ''], ['Revenue', ''], ['Room nights', ''], ['Stays', ''], ['ADR', ''], ['Booked ahead', 'Average days between booking and arrival'], ['Length of stay', 'Average nights'], ['Cancelled', 'Share of this channel\'s bookings cancelled or no-show']].map(([h, t]) => <th key={h} title={t} className={'px-3 py-2 font-semibold ' + (h === 'Channel' || h === 'Share of revenue' ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
            <tbody>{d.byChannel.map((c: any) => (
              <tr key={c.channel} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-2 font-semibold text-ink">{c.channel}</td>
                <td className="px-3 py-2"><div className="flex items-center gap-2"><div className="w-28 h-1.5 rounded bg-app overflow-hidden"><div className="h-full bg-brand-600" style={{ width: c.share + '%' }} /></div>{c.share}%</div></td>
                <td className="px-3 py-2 text-right font-semibold">{money(c.revenue)}</td><td className="px-3 py-2 text-right">{c.nights}</td><td className="px-3 py-2 text-right">{c.bookings}</td>
                <td className="px-3 py-2 text-right">{money(c.adr)}</td><td className="px-3 py-2 text-right">{c.lead == null ? '—' : c.lead + ' days'}</td><td className="px-3 py-2 text-right">{c.los == null ? '—' : c.los + ' nts'}</td><td className="px-3 py-2 text-right">{c.cancelRate}%</td>
              </tr>))}</tbody>
          </table>
          <p className="text-[11.5px] text-muted px-3 py-2 border-t border-line/60">Cloudbeds sells through {d.channels.length} channels; {d.channels.filter((c: any) => c.on).length} are switched on.</p>
        </div>
      ) : <LeanEmpty>No stays in this period, so no channel split yet.</LeanEmpty>) : null}

      {tab === 'bookings' ? ((d.bookings || []).length ? (<>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {([['all', `All ${d.bookings.length}`], ['owed', `Balance owed ${owed.length} · ${money(owed.reduce((a: number, x: any) => a + (x.balance || 0), 0))}`], ['cloudbeds', 'Cloudbeds'], ...(d.guesty?.bookings ? [['guesty', `Botanica in Guesty ${d.guesty.bookings}`]] : [])] as [typeof bf, string][]).map(([k, l]) => <button key={k} onClick={() => setBf(k)} className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${bf === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{l}</button>)}
          <input value={bq} onChange={e => setBq(e.target.value)} placeholder="Guest, room, channel" className="ml-auto h-8 w-48 rounded-lg border border-line bg-white px-2 text-[12px]" />
          <button onClick={exportCsv} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app"><Download size={12} /> Export</button>
        </div>
        <div className="rounded-xl border border-line bg-white overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted sticky top-0 bg-white"><tr className="border-b border-line">{['Guest', 'Room', 'Stay', 'Nights', 'Channel', 'Total', 'Balance', 'Status', 'Booked'].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (['Total', 'Balance', 'Nights'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
            <tbody>{bookings.map((x: any) => (
              <tr key={x.id} onClick={() => setOpen(x)} className="border-b border-line/60 last:border-0 hover:bg-app/60 cursor-pointer">
                <td className="px-3 py-1.5 font-semibold text-ink whitespace-nowrap">{x.guest || 'Guest'}{x.origin === 'guesty' ? <span className="ml-1"><Tag tone="violet" title="Botanica stay still in Guesty — counted for reporting">Guesty</Tag></span> : null}</td>
                <td className="px-3 py-1.5 text-muted max-w-[10rem] truncate">{(x.rooms || []).join(', ') || '—'}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{dayLabel(x.checkIn)} → {dayLabel(x.checkOut)}</td>
                <td className="px-3 py-1.5 text-right">{x.nights ?? '—'}</td>
                <td className="px-3 py-1.5 text-muted">{x.channel}</td>
                <td className="px-3 py-1.5 text-right">{money(x.total)}</td>
                <td className={'px-3 py-1.5 text-right ' + ((x.balance || 0) > 0 ? 'text-amber-700 font-semibold' : 'text-muted')}>{(x.balance || 0) > 0 ? money(x.balance) : 'paid'}</td>
                <td className="px-3 py-1.5 text-muted whitespace-nowrap">{String(x.status || '').replace(/_/g, ' ')}</td>
                <td className="px-3 py-1.5 text-muted whitespace-nowrap">{x.bookedAt ? dayLabel(String(x.bookedAt).slice(0, 10)) : '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {d.bookings.length >= 400 ? <p className="text-[11.5px] text-muted mt-1">Showing the first 400 stays of the period. Shorten the period to see the rest.</p> : null}
        <ResDrawer id={open?.id || null} title={open ? `${open.guest || 'Guest'} · ${(open.rooms || []).join(', ') || 'unassigned'}` : ''} onClose={() => setOpen(null)} />
      </>) : <LeanEmpty>No stays in this period.</LeanEmpty>) : null}

      {tab === 'ahead' ? (<>
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {[30, 60, 90].map(n => <button key={n} onClick={() => setAhead(n)} className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${ahead === n ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>Next {n} days</button>)}
          <span className="text-[12px] text-muted ml-2">From today, whatever period is picked above. Average occupancy {pct(d.forwardSummary.occupancy)} · average rate on the shelf {money(d.forwardSummary.rate)}</span>
        </div>
        {d.forward.length ? (
          <div className="rounded-xl border border-line bg-white p-3 overflow-x-auto">
            <div className="flex items-end gap-[3px] h-40 min-w-max">
              {d.forward.map((x: any) => (
                <div key={x.date} className="flex flex-col items-center justify-end h-full w-4" title={`${dow(x.date)} ${dayLabel(x.date)} · ${x.left} of ${x.units} left to sell · ${pct(x.occupancy)} occupied · rate ${money(x.rate)}${x.closedTypes ? ` · ${x.closedTypes} room types closed` : ''}`}>
                  <div className="w-full rounded-t bg-brand-600/80" style={{ height: `${Math.round(((x.rate || 0) / fwdMax) * 100)}%` }} />
                  <div className="w-full h-1.5 mt-0.5 rounded" style={{ background: x.occupancy == null ? '#e5e7eb' : `rgba(190,60,45,${Math.min(1, (x.occupancy || 0) / 100 + 0.08)})` }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10.5px] text-muted mt-1"><span>{dayLabel(d.forward[0].date)}</span><span>bar = the rate on sale · strip under it = how full (darker is fuller)</span><span>{dayLabel(d.forward[d.forward.length - 1].date)}</span></div>
          </div>
        ) : <LeanEmpty>No rates mirrored yet — they fill in on the next Cloudbeds sync.</LeanEmpty>}
      </>) : null}

      {tab === 'types' ? (
        <div className="rounded-xl border border-line bg-white overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted sticky top-0 bg-white"><tr className="border-b border-line">{['Room type', 'Rooms', 'Lowest rate', 'Average', 'Highest', 'Min stay', 'Days closed'].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (h === 'Room type' ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
            <tbody>{d.types.map((t: any) => (
              <tr key={t.id} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-1.5 text-ink">{t.name}</td><td className="px-3 py-1.5 text-right">{t.units || '—'}</td>
                <td className="px-3 py-1.5 text-right">{money(t.rateLow)}</td><td className="px-3 py-1.5 text-right font-semibold">{money(t.rateAvg)}</td><td className="px-3 py-1.5 text-right">{money(t.rateHigh)}</td>
                <td className="px-3 py-1.5 text-right">{t.minStay ?? '—'}</td><td className="px-3 py-1.5 text-right">{t.closedDays || ''}</td>
              </tr>))}</tbody>
          </table>
          <p className="text-[11.5px] text-muted px-3 py-2 border-t border-line/60">Rates on sale over the next {ahead} days, from the Cloudbeds calendar.</p>
        </div>
      ) : null}

      {d.collected.count ? <p className="text-[12px] text-muted mt-4">Collected in this period through Cloudbeds Payments: <b className="text-ink">{money(d.collected.charges)}</b> · refunded {money(d.collected.refunds)} · {d.collected.count} transactions.</p> : null}
    </div>
  )
}

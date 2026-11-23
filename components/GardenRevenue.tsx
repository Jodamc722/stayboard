'use client'
// GARDEN REVENUE (lib/garden/revenue) — rebuilt around a PERIOD (Jon, 2026-11-20: "make it clearer and
// cleaner and be able to select dates and time periods").
//   1. Pick the period: presets, the arrows (one period back / forward) or two dates.
//   2. Six numbers for it, each against the period just before.
//   3. One chart — revenue, occupancy or ADR — by day, week or month, whichever fits the length.
//   4. The detail in tabs: Channels · Bookings · Rates ahead · Room types.
// A period before the hotel was connected can be read in from Cloudbeds with one button.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Loader2, RefreshCw, Share2, SlidersHorizontal, X } from 'lucide-react'
import { LeanEmpty, Tag } from '@/components/lean'
import { ResDrawer } from '@/components/GardenResDetail'
import { GardenDepth, GardenSplit } from '@/components/GardenDepth'
import { GardenViews } from '@/components/GardenViews'

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
type Tab = 'views' | 'depth' | 'channels' | 'bookings' | 'ahead' | 'types'
// THE FILTER BAR (Jon, 2026-11-23: "make sure we have filter options always, for any report"). Every
// number, chart, tab, view and export on the page follows it, and it travels in the URL.
type Filter = { ch: string[]; rt: string[]; wing: string[]; los: string; lead: string; origin: string }
const NO_FILTER: Filter = { ch: [], rt: [], wing: [], los: '', lead: '', origin: '' }
const LOS_OPTS: [string, string][] = [['', 'Any length of stay'], ['1-1', '1 night'], ['2-3', '2–3 nights'], ['4-6', '4–6 nights'], ['7-13', '7–13 nights'], ['14-29', '14–29 nights'], ['30-', '30+ nights']]
const LEAD_OPTS: [string, string][] = [['', 'Any booking window'], ['0-0', 'Same day'], ['1-3', '1–3 days ahead'], ['4-7', '4–7 days'], ['8-14', '8–14 days'], ['15-30', '15–30 days'], ['31-60', '31–60 days'], ['61-90', '61–90 days'], ['91-', '91+ days']]
const ORIGIN_OPTS: [string, string][] = [['', 'Cloudbeds and Guesty'], ['cloudbeds', 'Cloudbeds only'], ['guesty', 'Guesty only']]
const filterQuery = (f: Filter) => (f.ch.length ? '&ch=' + encodeURIComponent(f.ch.join('|')) : '') + (f.rt.length ? '&rt=' + encodeURIComponent(f.rt.join('|')) : '') + (f.wing.length ? '&wing=' + encodeURIComponent(f.wing.join('|')) : '') + (f.los ? '&los=' + f.los : '') + (f.lead ? '&lead=' + f.lead : '') + (f.origin ? '&origin=' + f.origin : '')
const ago = (iso: string | null) => { if (!iso) return 'not yet'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

/** A pick-several dropdown for the filter bar. */
function Multi({ label, all, picked, onChange }: { label: string; all: { name: string; n: number }[]; picked: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  if (!all.length && !picked.length) return null
  const names = Array.from(new Set([...all.map(x => x.name), ...picked]))
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border ${picked.length ? 'bg-brand-50 text-brand-800 border-brand-300' : 'bg-white text-muted border-line hover:text-ink'}`}>{picked.length ? `${label}: ${picked.length === 1 ? picked[0] : picked.length + ' picked'}` : label}<ChevronDown size={12} /></button>
      {open ? (<>
        <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
        <div className="absolute z-30 mt-1 w-64 max-h-72 overflow-y-auto rounded-xl border border-line bg-white shadow-lg p-1.5">
          {names.map(nm => { const on = picked.includes(nm), n = all.find(x => x.name === nm)?.n; return (
            <label key={nm} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-app text-[12.5px] text-ink cursor-pointer">
              <input type="checkbox" checked={on} onChange={() => onChange(on ? picked.filter(x => x !== nm) : [...picked, nm])} className="accent-[rgb(var(--c-brand-600))]" />
              <span className="flex-1 min-w-0 truncate">{nm}</span>{n != null ? <span className="text-[11px] text-muted tabular-nums">{n}</span> : null}
            </label>) })}
          {picked.length ? <button onClick={() => onChange([])} className="w-full text-left px-2 py-1.5 text-[12px] font-semibold text-muted hover:text-ink">Clear</button> : null}
        </div>
      </>) : null}
    </div>
  )
}
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
      <div className="text-[11.5px] mt-0.5 leading-snug">{children}</div>
      {sub ? <div className="text-[11px] text-muted leading-snug">{sub}</div> : null}
    </div>
  )
}

/** `api` is where the numbers come from: the signed-in route, or the passcode link's (shared = true:
 *  no guest names, nothing opens into a reservation, no loading of history). `canShare` shows the
 *  Share button (a Reports owner). `onLocked` is called when the link asks for its passcode. */
export function GardenRevenue({ api = '/api/garden/revenue', shared = false, canShare = false, onLocked }: { api?: string; shared?: boolean; canShare?: boolean; onLocked?: (msg: string) => void } = {}) {
  const t0 = useMemo(todayNY, [])
  const [range, setRange] = useState<[string, string]>(() => PRESETS[2].range(todayNY()))
  const [preset, setPreset] = useState('month')
  const [d, setD] = useState<any>(null)
  // The in-depth report for the same period, side and filters: loaded once here, read by the side-by-side
  // table at the top, the Views tab and the In-depth tab.
  const [dd, setDd] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState<Metric>('revenue')
  const [tab, setTab] = useState<Tab>('views')
  const [ahead, setAhead] = useState(60)
  const [bf, setBf] = useState<'all' | 'owed' | 'guesty' | 'cloudbeds'>('all')
  const [bq, setBq] = useState('')
  const [open, setOpen] = useState<any | null>(null)
  const [fill, setFill] = useState('')
  const [filter, setFilterState] = useState<Filter>(NO_FILTER)
  const [refreshing, setRefreshing] = useState('')
  const [share, setShare] = useState<any | null>(null)
  const [copied, setCopied] = useState('')
  const fq = useMemo(() => filterQuery(filter), [filter])
  const filterN = filter.ch.length + filter.rt.length + filter.wing.length + (filter.los ? 1 : 0) + (filter.lead ? 1 : 0) + (filter.origin ? 1 : 0)
  const setFilter = (f: Filter) => { setFilterState(f); try { const u = new URL(location.href); for (const k of ['ch', 'rt', 'wing', 'los', 'lead', 'origin']) u.searchParams.delete(k); new URLSearchParams(filterQuery(f).slice(1)).forEach((v, k) => u.searchParams.set(k, v)); history.replaceState(null, '', u.toString()) } catch {} }
  const [scope, setScopeState] = useState<Scope>('all')
  const setScope = (v: Scope) => { setScopeState(v); try { const u = new URL(location.href); if (v === 'all') u.searchParams.delete('scope'); else u.searchParams.set('scope', v); history.replaceState(null, '', u.toString()) } catch {} }

  // The period lives in the URL, so a link or a reload opens the same one.
  useEffect(() => { try { const sp = new URLSearchParams(location.search); const sc = sp.get('scope'); if (sc === 'garden' || sc === 'botanica') setScopeState(sc); const vw = sp.get('view'); if (vw && ['views', 'depth', 'channels', 'bookings', 'ahead', 'types'].includes(vw)) setTab(vw as Tab); const L = (k: string) => (sp.get(k) || '').split('|').filter(Boolean); const R = (k: string, o: [string, string][]) => o.some(x => x[0] === sp.get(k)) ? sp.get(k)! : ''; setFilterState({ ch: L('ch'), rt: L('rt'), wing: L('wing'), los: R('los', LOS_OPTS), lead: R('lead', LEAD_OPTS), origin: R('origin', ORIGIN_OPTS) }); const f = sp.get('from'), t = sp.get('to'); if (f && t && /^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t) && t >= f) { setRange([f, t]); setPreset(PRESETS.find(p => { const r = p.range(todayNY()); return r[0] === f && r[1] === t })?.key || 'custom') } } catch {} }, [])
  const go = (r: [string, string], key: string) => { setRange(r); setPreset(key); try { const u = new URL(location.href); u.searchParams.set('from', r[0]); u.searchParams.set('to', r[1]); history.replaceState(null, '', u.toString()) } catch {} }
  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`${api}?from=${range[0]}&to=${range[1]}&ahead=${ahead}&scope=${scope}${fq}`, { cache: 'no-store' }).then(x => x.json()).catch(e => ({ ok: false, error: String(e) }))
    if (r?.needsPassword && onLocked) { onLocked(String(r.error || '')); setLoading(false); return }
    setD(r); setLoading(false)
  }, [range, ahead, scope, fq, api, onLocked])
  const loadDepth = useCallback(async () => {
    setDd(null)
    const r = await fetch(`${api}?depth=1&from=${range[0]}&to=${range[1]}&scope=${scope}${fq}`, { cache: 'no-store' }).then(x => x.json()).catch(e => ({ ok: false, error: String(e) }))
    if (!r?.needsPassword) setDd(r)
  }, [range, scope, fq, api])
  useEffect(() => { loadDepth() }, [loadDepth])
  const pickTab = (k: Tab) => { setTab(k); try { const u = new URL(location.href); u.searchParams.set('view', k); history.replaceState(null, '', u.toString()) } catch {} }
  // REFRESH: read Cloudbeds now, then add the period up again.
  const refresh = async () => {
    setRefreshing('Reading Cloudbeds…')
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: true }) }).then(x => x.json()).catch(e => ({ ok: false, error: String(e) }))
    if (r?.needsPassword && onLocked) { onLocked(String(r.error || '')); setRefreshing(''); return }
    await Promise.all([load(), loadDepth()])
    setRefreshing(r?.ok ? (r.fresh ? 'Already up to date' : 'Updated') : 'Cloudbeds did not answer — showing the last sync')
    setTimeout(() => setRefreshing(''), 4000)
  }
  const shareCall = async (op: 'status' | 'mint' | 'off') => {
    setShare((x: any) => ({ ...(x || {}), busy: true, error: '' }))
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ share: op }) }).then(x => x.json()).catch(e => ({ ok: false, error: String(e) }))
    setShare((x: any) => r?.ok ? { ...r, passcode: r.passcode || (op === 'status' ? x?.passcode : null), busy: false } : { ...(x || {}), busy: false, error: r?.error || r?.message || 'Could not do that.' })
  }
  const copy = (k: string, text: string) => { try { navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1800) } catch {} }
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
    const rows = [[shared ? 'Reservation' : 'Guest', 'Room', 'Check-in', 'Check-out', 'Nights', 'Channel', 'Total', 'Balance', 'Status', 'Booked', 'System'], ...(d?.bookings || []).map((b: any) => [shared ? b.id : b.guest || '', (b.rooms || []).join(' '), b.checkIn, b.checkOut, b.nights ?? '', b.channel, b.total, b.balance ?? '', b.status, String(b.bookedAt || '').slice(0, 10), b.origin])]
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
        <span className="text-sm font-semibold text-ink inline-flex items-center gap-1.5 ml-1 order-last sm:order-none">{loading ? <Loader2 size={15} className="text-brand-600 animate-spin" /> : <CalendarRange size={15} className="text-brand-600" />} {dayLabel(range[0], range[0].slice(0, 4) !== range[1].slice(0, 4))} – {dayLabel(range[1], true)} <span className="text-[12px] font-medium text-muted">· {span} night{span === 1 ? '' : 's'}</span></span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted mr-0.5"><SlidersHorizontal size={12} /> Filters</span>
        <Multi label="Channel" all={d?.options?.channels || []} picked={filter.ch} onChange={v => setFilter({ ...filter, ch: v })} />
        <Multi label="Room type" all={d?.options?.types || []} picked={filter.rt} onChange={v => setFilter({ ...filter, rt: v })} />
        <Multi label="Wing" all={d?.options?.wings || []} picked={filter.wing} onChange={v => setFilter({ ...filter, wing: v })} />
        {([['los', LOS_OPTS], ['lead', LEAD_OPTS], ['origin', ORIGIN_OPTS]] as ['los' | 'lead' | 'origin', [string, string][]][]).map(([k, opts]) => (
          <select key={k} value={filter[k]} onChange={e => setFilter({ ...filter, [k]: e.target.value })} aria-label={opts[0][1]} className={`text-[12px] font-semibold pl-2.5 pr-1 py-1.5 rounded-lg border outline-none ${filter[k] ? 'bg-brand-50 text-brand-800 border-brand-300' : 'bg-white text-muted border-line'}`}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        ))}
        {filterN ? <button onClick={() => setFilter(NO_FILTER)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1.5 rounded-lg text-muted hover:text-ink"><X size={12} /> Clear {filterN}</button> : null}
        <span className="ml-auto inline-flex items-center gap-2 text-[11.5px] text-muted">
          <span title={d?.syncAt ? new Date(d.syncAt).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET' : ''}>{refreshing || <>Cloudbeds read {ago(d?.syncAt || null)}</>}</span>
          <button onClick={refresh} disabled={refreshing === 'Reading Cloudbeds…'} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app disabled:opacity-60"><RefreshCw size={12} className={refreshing === 'Reading Cloudbeds…' ? 'animate-spin' : ''} /> Refresh</button>
          {canShare && !shared ? <button onClick={() => { setShare({ busy: true }); shareCall('status') }} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white"><Share2 size={12} /> Share</button> : null}
        </span>
      </div>
      {share ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 p-4" onClick={() => setShare(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1"><h2 className="text-[17px] font-semibold text-ink normal-case">Share this report</h2><span className="flex-1" /><button onClick={() => setShare(null)} aria-label="Close" className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-app"><X size={16} /></button></div>
            <p className="text-[12.5px] text-muted mb-3">A read-only copy of this page for the revenue team: every period, side, filter and view, kept current from Cloudbeds. It shows no guest names and opens only with the passcode.</p>
            {share.path ? (<>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted mb-1">Link</div>
              <div className="flex items-center gap-2 mb-3"><code className="flex-1 min-w-0 truncate rounded-lg bg-app px-2.5 py-2 text-[12.5px] text-ink">{location.origin + share.path}</code><button onClick={() => copy('link', location.origin + share.path)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-2 rounded-lg border border-line bg-white text-ink">{copied === 'link' ? <Check size={12} /> : <Copy size={12} />} {copied === 'link' ? 'Copied' : 'Copy'}</button></div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted mb-1">Passcode</div>
              {share.passcode ? (<>
                <div className="flex items-center gap-2"><code className="flex-1 rounded-lg bg-brand-50 border border-brand-300 px-2.5 py-2 text-[15px] font-semibold tracking-wide text-ink">{share.passcode}</code><button onClick={() => copy('pw', share.passcode)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-2 rounded-lg border border-line bg-white text-ink">{copied === 'pw' ? <Check size={12} /> : <Copy size={12} />} {copied === 'pw' ? 'Copied' : 'Copy'}</button></div>
                <p className="text-[12px] text-amber-800 mt-1.5">Copy it now. It is shown this once and is not kept anywhere readable; send it separately from the link.</p>
              </>) : share.hasPasscode ? <p className="text-[12.5px] text-ink">A passcode is set (ends {String(share.hint || '').replace(/•/g, '') || '••'}). Opened {share.uses} time{share.uses === 1 ? '' : 's'}{share.lastUsedAt ? `, last ${ago(share.lastUsedAt)}` : ''}.</p> : <p className="text-[12.5px] text-ink">No passcode yet, so the link opens for nobody outside Lighthouse.</p>}
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <button disabled={share.busy} onClick={() => shareCall('mint')} className="rounded-lg bg-ink text-white px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50">{share.hasPasscode ? 'Make a new passcode' : 'Create passcode'}</button>
                {share.hasPasscode ? <button disabled={share.busy} onClick={() => shareCall('off')} className="rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-rose-700 disabled:opacity-50">Turn the link off</button> : null}
                {share.hasPasscode && !share.passcode ? <span className="text-[11.5px] text-muted basis-full">A new passcode replaces the old one: anyone using the old one is asked again.</span> : null}
              </div>
            </>) : share.busy ? <p className="text-[12.5px] text-muted inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> One moment…</p> : null}
            {share.error ? <p className="text-[12.5px] text-rose-700 mt-2">{share.error}</p> : null}
          </div>
        </div>
      ) : null}
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
          {shared ? null : <button onClick={backfill} disabled={!!fill && !fill.startsWith('Stopped')} className="ml-auto rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">{fill && !fill.startsWith('Stopped') ? 'Loading…' : 'Load it from Cloudbeds'}</button>}
          {fill ? <span className="basis-full text-[12px]">{fill}</span> : null}
        </div>
      ) : null}

      {d.partial ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 mb-3 text-[12.5px] text-rose-800">Some bookings could not be read just now, so these numbers may be short. Press Refresh in a moment.</div> : null}

      {/* The period in six numbers, each against the one before it. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi label={future ? 'Revenue on the books' : 'Room revenue'} value={money(b.revenue)} sub={prevCovered ? prevLabel : undefined}>{prevCovered ? <Delta cur={b.revenue} prev={p.revenue} unit="pct" /> : <span className="text-muted">earlier period not loaded</span>}</Kpi>
        <Kpi label="Occupancy" value={pct(b.occupancy)} sub={`${b.nights.toLocaleString()} of ${(d.rooms * span).toLocaleString()} room nights`}>{prevCovered ? <Delta cur={b.occupancy} prev={p.occupancy} unit="pts" /> : null}</Kpi>
        <Kpi label="ADR" value={money(b.adr)} sub="average rate per night sold">{prevCovered ? <Delta cur={b.adr} prev={p.adr} unit="pct" /> : null}</Kpi>
        <Kpi label="RevPAR" value={money(b.revpar)} sub={`revenue per room, ${d.rooms} rooms`}>{prevCovered ? <Delta cur={b.revpar} prev={p.revpar} unit="pct" /> : null}</Kpi>
        <Kpi label="Stays" value={b.bookings.toLocaleString()} sub={`${b.cancelled} cancelled or no-show`}>{prevCovered ? <Delta cur={b.bookings} prev={p.bookings} unit="pct" /> : null}</Kpi>
        <Kpi label={future ? 'Booked so far' : 'Booked in this period'} value={past || !future ? String(d.booked.bookings) : '—'} sub={past || !future ? `${money(d.booked.revenue)} · for any stay date` : 'the period has not started'}>{d.booked.cancelled ? <span className="text-muted">{d.booked.cancelled} of them since cancelled</span> : <span className="text-muted">new reservations made</span>}</Kpi>
      </div>
      <p className="text-[11.5px] text-muted mt-1.5">{scope === 'all' ? 'Whole property' : scope === 'garden' ? 'Garden rooms only' : 'Botanica rooms only'}: {d.rooms} rooms{d.segments?.blocked ? `, ${d.segments.blocked} of them blocked in Cloudbeds` : ''}.{d.guesty?.bookings ? ` Includes ${d.guesty.bookings} Botanica booking${d.guesty.bookings === 1 ? '' : 's'} from Guesty (${money(d.guesty.revenue)}).` : ''}{filterN ? ` ${filterN} filter${filterN === 1 ? '' : 's'} on: every number below counts only what matches.` : ''}</p>
      {d.basis ? <p className="text-[11.5px] text-muted mt-0.5">{d.basis.gross ? (d.basis.room ? `Revenue: ${d.basis.room.toLocaleString()} stays at room revenue before taxes and fees; ${d.basis.gross.toLocaleString()} Cloudbeds stays still at the reservation total (taxes and fees in it) until their breakdown is read.` : 'Revenue is the Cloudbeds reservation total for each stay, which has taxes and fees in it; Botanica stays in Guesty are accommodation plus cleaning.') : 'Revenue is room revenue before taxes and fees.'}</p> : null}
      {d.today && range[0] <= t0 && range[1] >= t0 ? <p className="text-[12px] text-ink mt-2"><span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted mr-2">Today, live from Cloudbeds</span>{pct(d.today.occupancy)} occupied · {d.today.arrivals} arrivals · {d.today.departures} departures · {d.today.inHouse} in house · {d.today.bookings} booked today</p> : null}

      {/* The three sides next to each other, before anything else. */}
      <div className="mt-4">{dd?.ok && dd.split ? <GardenSplit d={dd} scope={scope} onScope={setScope} compact /> : dd && !dd.ok ? null : <p className="text-[12.5px] text-muted inline-flex items-center gap-2 mb-4"><Loader2 size={13} className="animate-spin" /> Comparing Whole property, Garden and Botanica…</p>}</div>

      {/* One chart. */}
      <div className="rounded-xl border border-line bg-white p-3.5">
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
      <div className="flex gap-1 mt-5 mb-3 border-b border-line overflow-x-auto">
        {([['views', 'Views'], ['depth', 'In-depth report'], ['channels', `Channels · ${d.byChannel.length}`], ['bookings', `Bookings · ${(d.bookings || []).length}`], ['ahead', 'Rates ahead'], ['types', `Room types · ${d.types.length}`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => pickTab(k)} className={`px-3 py-2 text-[13px] font-semibold whitespace-nowrap -mb-px border-b-2 ${tab === k ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {tab === 'views' ? <GardenViews api={api} from={range[0]} to={range[1]} scope={scope} fq={fq} data={dd} /> : null}
      {tab === 'depth' ? <GardenDepth api={api} fq={fq} shared={shared} data={dd} splitAbove from={range[0]} to={range[1]} scope={scope} onScope={setScope} /> : null}

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
          <input value={bq} onChange={e => setBq(e.target.value)} placeholder={shared ? 'Room, channel, number' : 'Guest, room, channel'} className="ml-auto h-8 w-48 rounded-lg border border-line bg-white px-2 text-[12px]" />
          <button onClick={exportCsv} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app"><Download size={12} /> Export</button>
        </div>
        <div className="rounded-xl border border-line bg-white overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted sticky top-0 bg-white"><tr className="border-b border-line">{[shared ? 'Reservation' : 'Guest', 'Room', 'Stay', 'Nights', 'Channel', 'Total', 'Balance', 'Status', 'Booked'].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (['Total', 'Balance', 'Nights'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
            <tbody>{bookings.map((x: any) => (
              <tr key={x.id} onClick={() => { if (!shared) setOpen(x) }} className={'border-b border-line/60 last:border-0 ' + (shared ? '' : 'hover:bg-app/60 cursor-pointer')}>
                <td className="px-3 py-1.5 font-semibold text-ink whitespace-nowrap">{shared ? <span className="font-mono text-[11.5px] font-normal">{String(x.id).replace(/^gy:/, '').slice(0, 14)}</span> : x.guest || 'Guest'}{x.origin === 'guesty' ? <span className="ml-1"><Tag tone="violet" title="Botanica stay still in Guesty — counted for reporting">Guesty</Tag></span> : null}</td>
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
        {(d.bookingsTotal || 0) > d.bookings.length ? <p className="text-[11.5px] text-muted mt-1">Showing the first {d.bookings.length.toLocaleString()} of {d.bookingsTotal.toLocaleString()} stays. The numbers above count all of them; shorten the period or add a filter to list the rest.</p> : null}
        {shared ? null : <ResDrawer id={open?.id || null} title={open ? `${open.guest || 'Guest'} · ${(open.rooms || []).join(', ') || 'unassigned'}` : ''} onClose={() => setOpen(null)} />}
      </>) : <LeanEmpty>No stays in this period{filterN ? ' with these filters' : ''}.</LeanEmpty>) : null}

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

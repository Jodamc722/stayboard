'use client'
// SALES — what we booked, by the day the booking was made (lib/sales-report has the rules).
//
// Read top-down, the way the question is asked:
//   1. Four numbers: booked today, this week, this month, and what is on the books for the next 30
//      days — each against last year.
//   2. One sentence of "so what".
//   3. The units that need a price or content action, worst first. Channels, months against budget,
//      cancellations and the daily trend sit behind tabs.
// One money format (whole dollars), one percent format (whole points, signed), calm colours: a
// number is only red or green when it is a comparison.
//
// LOADS ITSELF (2026-11-10). The page draws the frame and this fetches /api/revenue/sales behind a
// skeleton. The first answer carries the headline and the worst 60 units; the full unit list
// (?part=units) is asked for only when "All", "Raise rate", a search or "Show all" needs it, and the
// daily series (?part=daily) only when the Daily tab is opened.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanEmpty, LeanPick, Pill, Tag, type Tone } from '@/components/lean'
import type { SalesReport as Report, SalesPeriod, PaceUnit, PaceStatus, SalesMonth, SalesDay } from '@/lib/sales-report'

type TabKey = 'pace' | 'channels' | 'months' | 'cancels' | 'daily'
type PaceView = 'action' | 'ahead' | 'all'

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const md = (iso: string): string => (iso && iso.length >= 10 ? MO[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10)) : '—')
const money = (n: number): string => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
const int = (n: number): string => Math.round(n).toLocaleString('en-US')
const pct0 = (ratio: number): string => Math.round(ratio * 100) + '%'
const signed = (p: number): string => (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(Math.round(p)) + '%'
const plural = (n: number, one: string, many?: string): string => int(n) + ' ' + (n === 1 ? one : (many || one + 's'))

/** A change vs last year. Green and red are kept for this and nothing else. */
function Delta({ p, suffix = 'vs LY', title }: { p: number | null; suffix?: string; title?: string }) {
  if (p == null) return <span title={title} className="text-[11px] text-muted">no last year</span>
  const flat = Math.abs(p) < 2
  const cls = flat ? 'text-muted' : p > 0 ? 'text-emerald-700' : 'text-rose-700'
  return <span title={title} className={`text-[11.5px] font-semibold tabular-nums ${cls}`}>{flat ? 'level' : signed(p)} <span className="font-medium text-muted">{suffix}</span></span>
}

function Tile({ label, value, delta, same, lines, accent }: { label: string; value: string; delta: ReactNode; same?: ReactNode; lines: string[]; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-3.5 py-3 min-w-0 ${accent ? 'border-brand-200 bg-brand-50/60' : 'border-line bg-white'}`}>
      <div className="text-[10.5px] uppercase tracking-wider font-semibold text-muted">{label}</div>
      <div className="text-[22px] sm:text-2xl font-bold text-ink tabular-nums leading-tight mt-0.5 truncate">{value}</div>
      <div className="mt-0.5">{delta}</div>
      {same ? <div>{same}</div> : null}
      {lines.map((l, i) => <div key={i} className="text-[11.5px] text-muted mt-0.5 truncate" title={l}>{l}</div>)}
    </div>
  )
}

const STATUS: Record<PaceStatus, { label: string; tone: Tone; tint?: 'rose' | 'amber' | 'emerald' }> = {
  behind: { label: 'Behind', tone: 'rose', tint: 'rose' },
  cold: { label: 'Gone cold', tone: 'amber', tint: 'amber' },
  watch: { label: 'Watch', tone: 'slate' },
  ahead: { label: 'Raise rate', tone: 'emerald' },
  ok: { label: 'On pace', tone: 'slate' },
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted truncate">{k}</div>
      <div className="text-[13px] text-ink tabular-nums truncate">{v}</div>
    </div>
  )
}

/** Bookings made per day, last 28 days: a bar for this year, a tick for the same weekday last year. */
function DailyChart({ days, showMoney }: { days: Report['days']; showMoney: boolean }) {
  const val = (d: Report['days'][number]) => (showMoney ? d.revenue : d.bookings)
  const lyVal = (d: Report['days'][number]) => (showMoney ? d.lyRevenue : d.lyBookings)
  const fmt = (n: number) => (showMoney ? money(n) : int(n))
  const W = 720, H = 170, padT = 16, padB = 20
  const max = Math.max(1, ...days.map(d => Math.max(val(d), lyVal(d))))
  const n = days.length || 1
  const slot = W / n
  const bw = Math.max(4, slot - 6)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Booked per day, last 28 days, against the same weekday last year">
      <line x1={0} x2={W} y1={y(max)} y2={y(max)} stroke="currentColor" className="text-line" strokeWidth={1} />
      <line x1={0} x2={W} y1={y(max / 2)} y2={y(max / 2)} stroke="currentColor" className="text-line" strokeWidth={1} opacity={0.6} />
      <text x={2} y={y(max) - 4} className="fill-current text-muted" fontSize={10}>{fmt(max)} / day</text>
      {days.map((d, i) => {
        const x = i * slot + (slot - bw) / 2
        return (
          <g key={d.d}>
            <rect x={x} y={y(val(d))} width={bw} height={Math.max(1, H - padB - y(val(d)))} rx={2} fill="currentColor" className="text-brand-500" />
            <line x1={x - 1} x2={x + bw + 1} y1={y(lyVal(d))} y2={y(lyVal(d))} stroke="currentColor" className="text-ink" strokeWidth={1.5} opacity={0.55} />
            <rect x={i * slot} y={0} width={slot} height={H - padB} fill="transparent">
              <title>{`${md(d.d)} · ${fmt(val(d))} booked (${plural(d.bookings, 'booking')}) · last year ${fmt(lyVal(d))}`}</title>
            </rect>
          </g>
        )
      })}
      <text x={2} y={H - 5} className="fill-current text-muted" fontSize={10}>{days[0] ? md(days[0].d) : ''}</text>
      <text x={W - 2} y={H - 5} textAnchor="end" className="fill-current text-muted" fontSize={10}>Today</text>
    </svg>
  )
}

function MonthRow({ m, showMoney }: { m: SalesMonth; showMoney: boolean }) {
  // The bar runs to the budget when there is one, otherwise to where last year finished.
  const goal = showMoney ? (m.budget ?? m.lyFinal) : null
  const fill = goal && goal > 0 ? Math.min(100, (m.revenue / goal) * 100) : null
  const mark = goal && goal > 0 && m.lySameTime != null ? Math.min(100, (m.lySameTime / goal) * 100) : null
  return (
    <li className="px-3 sm:px-4 py-3">
      <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
        <span className="text-[13.5px] font-semibold text-ink">{m.label}</span>
        <span className="text-[12px] text-muted">{pct0(m.occ)} booked · {plural(m.nights, 'night')} · {plural(m.daysLeft, 'day')} left</span>
        <span className="ml-auto text-[15px] font-bold text-ink tabular-nums">{showMoney ? money(m.revenue) : plural(m.nights, 'night')}</span>
      </div>
      {fill != null && (
        <div className="relative h-2.5 rounded-full bg-app mt-1.5" title={m.budget != null ? `Budget ${money(m.budget)}` : m.lyFinal != null ? `Last year finished at ${money(m.lyFinal)}` : undefined}>
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(1.5, fill)}%` }} />
          {mark != null && <div className="absolute top-[-2px] h-[14px] w-[2px] bg-ink/60 rounded" style={{ left: `${mark}%` }} title={`Last year at this point: ${money(m.lySameTime || 0)}`} />}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
        {showMoney && m.budget != null && m.pctOfBudget != null && <Tag tone={m.pctOfBudget >= 100 ? 'emerald' : 'brand'} title={`${money(m.revenue)} on the books of a ${money(m.budget)} budget (net accommodation)`}>{m.pctOfBudget}% of budget</Tag>}
        {showMoney && m.budget == null && <Tag title="No budget for this month has come through from the Revenue App (or the budget feed is switched off in Money source)">No budget</Tag>}
        {m.pctVsLy != null
          ? <Tag tone={m.pctVsLy >= 2 ? 'emerald' : m.pctVsLy <= -2 ? 'rose' : 'slate'} title="All units: against everything that was on the books for this month at the same point last year">{signed(m.pctVsLy)} vs LY at this point · all units</Tag>
          : <Tag>no last year</Tag>}
        {m.ssPctVsLy != null && <Tag tone={m.ssPctVsLy >= 2 ? 'emerald' : m.ssPctVsLy <= -2 ? 'rose' : 'slate'}
          title={`Same-store: only units active now that were already live a year ago — ${showMoney && m.ssRevenue != null && m.ssLySameTime != null ? `${money(m.ssRevenue)} vs ${money(m.ssLySameTime)}` : `${int(m.ssNights)} vs ${int(m.ssLyNightsSameTime || 0)} nights`}`}>{signed(m.ssPctVsLy)} same-store</Tag>}
        {showMoney && m.lyFinal != null && <span className="text-[11.5px] text-muted">Last year finished at {money(m.lyFinal)}{m.lySameTime != null ? ` · had ${money(m.lySameTime)} by now` : ''}</span>}
      </div>
    </li>
  )
}

const API = '/api/revenue/sales'

/** The frame of the report while it loads: four tiles, the sentence, a few rows. */
function Skeleton() {
  const bar = 'rounded bg-line/60 animate-pulse'
  return (
    <div aria-busy="true" aria-label="Loading the sales report">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-2xl border border-line bg-white px-3.5 py-3">
            <div className={`${bar} h-2.5 w-20`} />
            <div className={`${bar} h-7 w-28 mt-2`} />
            <div className={`${bar} h-2.5 w-24 mt-2`} />
            <div className={`${bar} h-2.5 w-32 mt-1.5`} />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-line bg-white px-3.5 py-3 mb-4"><div className={`${bar} h-3 w-4/5`} /></div>
      <div className="rounded-2xl border border-line bg-white divide-y divide-line/70">
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="px-3 sm:px-4 py-3"><div className={`${bar} h-3`} style={{ width: `${70 - i * 6}%` }} /></div>)}
      </div>
    </div>
  )
}

export function SalesReport() {
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [allUnits, setAllUnits] = useState<PaceUnit[] | null>(null)
  const [unitsFailed, setUnitsFailed] = useState(false)
  const [days, setDays] = useState<SalesDay[] | null>(null)
  const [daysFailed, setDaysFailed] = useState(false)
  const [tab, setTab] = useState<TabKey>('pace')
  const [paceView, setPaceView] = useState<PaceView>('action')
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)

  // The report itself — once, when the page opens.
  useEffect(() => {
    let live = true
    fetch(API, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => null)
        if (!live) return
        if (r.ok && j && j.ok) setData(j as Report)
        else setError(String((j && (j.message || j.error)) || 'the server answered ' + r.status))
      })
      .catch(e => { if (live) setError(String((e && e.message) || e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  // Every unit — only when a view needs more than the first answer carried.
  const partial = !!data && data.pace.unitsPartial
  const wantAll = paceView !== 'action' || q.trim() !== '' || showAll
  const needUnits = partial && wantAll && allUnits == null && !unitsFailed
  useEffect(() => {
    if (!needUnits) return
    let live = true
    fetch(API + '?part=units', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!live) return; if (j && j.ok && Array.isArray(j.units)) setAllUnits(j.units as PaceUnit[]); else setUnitsFailed(true) })
      .catch(() => { if (live) setUnitsFailed(true) })
    return () => { live = false }
  }, [needUnits])

  // The daily series — only when its tab is opened.
  const needDays = !!data && data.daysDeferred && tab === 'daily' && days == null && !daysFailed
  useEffect(() => {
    if (!needDays) return
    let live = true
    fetch(API + '?part=daily', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!live) return; if (j && j.ok && Array.isArray(j.days)) setDays(j.days as SalesDay[]); else setDaysFailed(true) })
      .catch(() => { if (live) setDaysFailed(true) })
    return () => { live = false }
  }, [needDays])

  const units = allUnits || (data ? data.pace.units : null)
  const paceRows = useMemo(() => {
    let r: PaceUnit[] = units || []
    if (paceView === 'action') r = r.filter(u => u.status === 'behind' || u.status === 'cold' || u.status === 'watch')
    else if (paceView === 'ahead') r = r.filter(u => u.status === 'ahead')
    const t = q.trim().toLowerCase()
    if (t) r = r.filter(u => u.name.toLowerCase().includes(t) || u.building.toLowerCase().includes(t))
    return r
  }, [units, paceView, q])

  if (!data) {
    return (
      <div className="p-4 sm:p-6 max-w-[1100px] mx-auto">
        <LeanHead title="Sales" sub={loading ? 'Booked by the day the booking was made · against last year' : undefined} />
        {loading ? <Skeleton /> : <LeanEmpty>The sales report could not be built{error ? ` — ${error}` : ''}. Reload in a minute; if it keeps failing, check the Guesty sync on System health.</LeanEmpty>}
      </div>
    )
  }

  const d = data
  const sm = d.showMoney
  const asOfLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d.generatedAt)) + ' ET'
  const P = (k: SalesPeriod['key']): SalesPeriod => d.periods.find(p => p.key === k) || d.periods[0]
  const pToday = P('today'), pYest = P('yesterday'), pWeek = P('week'), pMonth = P('month')
  const head = (p: SalesPeriod): string => (sm ? money(p.now.revenue) : plural(p.now.bookings, 'booking'))
  const change = (p: SalesPeriod): number | null => (sm ? p.revenuePct : p.bookingsPct)
  // SAME-STORE: only the units active now that were already live a year ago, on both sides.
  const ssChange = (p: SalesPeriod): number | null => (sm ? p.sameStore.revenuePct : p.sameStore.bookingsPct)
  const ssTitle = (p: SalesPeriod): string =>
    `Same-store = the ${int(d.sameStoreUnits)} of ${int(d.activeUnits)} active units that were already live on ${md(d.asOfLastYear)} last year. `
    + `Now ${sm ? money(p.sameStore.now.revenue) + ' · ' : ''}${plural(p.sameStore.now.bookings, 'booking')}; last year ${sm ? money(p.sameStore.ly.revenue) + ' · ' : ''}${plural(p.sameStore.ly.bookings, 'booking')}.`
  const same = (p: SalesPeriod) => <Delta p={ssChange(p)} suffix="same-store" title={ssTitle(p)} />
  const lyTitle = (p: SalesPeriod): string =>
    `Last year (${md(p.lyFrom)}${p.lyTo !== p.lyFrom ? '–' + md(p.lyTo) : ''}${p.partial ? ', up to the same time of day' : ''}): `
    + (sm ? money(p.ly.revenue) + ' · ' : '') + plural(p.ly.bookings, 'booking') + (p.ly.cancelled ? `, ${int(p.ly.cancelled)} later cancelled` : '')
  const lines = (p: SalesPeriod): string[] => {
    const out = [(sm ? plural(p.now.bookings, 'booking') + ' · ' : '') + plural(p.now.nights, 'night')]
    if (p.now.cancelled > 0) out.push(int(p.now.cancelled) + ' cancelled since' + (sm ? ' (' + money(p.now.cancelledRevenue) + ')' : ''))
    return out
  }
  const needs = d.pace.behind + d.pace.cold
  const watch = d.pace.watch
  const first = d.pace.units.find(u => u.status === 'behind' || u.status === 'cold')
  const dirPts = d.directShare != null && d.lyDirectShare != null ? Math.round((d.directShare - d.lyDirectShare) * 100) : null

  // ---- the one sentence ----
  const mChange = change(pMonth)
  const mSame = ssChange(pMonth)
  const soWhat = [
    `Month to date we booked ${head(pMonth)}`
      + (mChange == null ? '' : Math.abs(mChange) < 2 ? ', level with the same dates last year' : `, ${Math.abs(Math.round(mChange))}% ${mChange > 0 ? 'up' : 'down'} on the same dates last year`)
      + (mSame == null ? '' : ` (${Math.abs(mSame) < 2 ? 'level' : signed(mSame)} same-store, ${int(d.sameStoreUnits)} of ${int(d.activeUnits)} units)`),
    d.directShare != null ? `direct is ${pct0(d.directShare)} of it` + (dirPts != null && dirPts !== 0 ? ` (${dirPts > 0 ? '+' : '−'}${Math.abs(dirPts)} pts)` : '') : '',
    needs > 0 ? `${plural(needs, 'unit')} ${needs === 1 ? 'needs' : 'need'} a price or listing action${first ? ` — start with ${first.name}` : ''}` : 'no unit is behind pace',
    d.cancels.count > 0 ? `${plural(d.cancels.count, 'booking')} cancelled in the last ${d.cancels.days} days${sm ? ` (${money(d.cancels.revenue)})` : ''}` : '',
  ].filter(Boolean).join('; ') + '.'

  const visible = showAll ? paceRows : paceRows.slice(0, 30)
  // While the full list is on its way the rows on screen are only the top of it.
  const unitsLoading = needUnits
  const dayRows = d.daysDeferred ? days : d.days
  // How many rows this view has in all — known from the counts even before the full list arrives.
  const viewTotal = !partial || allUnits != null || q.trim() !== '' ? paceRows.length
    : paceView === 'action' ? needs + watch : paceView === 'ahead' ? d.pace.ahead : d.pace.totalUnits
  const chMax = d.channels.reduce((m, c) => Math.max(m, c.share), 0) || 1

  return (
    <div className="p-4 sm:p-6 max-w-[1100px] mx-auto">
      <LeanHead title="Sales" sub={`Booked by the day the booking was made · against last year · as of ${asOfLabel}`}>
        <Pill tone="brand" onClick={() => setTab('channels')} title="Share of this month's booked value that came direct (booking engine, website, direct)">
          Direct {d.directShare != null ? pct0(d.directShare) : '—'}
        </Pill>
        <Pill tone={needs > 0 ? 'rose' : 'emerald'} onClick={() => { setTab('pace'); setPaceView('action') }} title="Units behind last year's pace or with no bookings coming in">
          {needs > 0 ? `${int(needs)} need action` : 'All on pace'}
        </Pill>
        <Pill tone={d.cancels.count > 0 ? 'amber' : 'slate'} onClick={() => setTab('cancels')} title={`Cancelled in the last ${d.cancels.days} days`}>
          {int(d.cancels.count)} cancelled
        </Pill>
        <Link href="/revenue" className="rounded-lg px-2 py-1 text-[12px] font-semibold border border-line bg-white text-muted hover:text-ink whitespace-nowrap" title="Stay-date revenue, occupancy, ADR and RevPAR by unit">Revenue Center</Link>
        <Link href="/marketing" className="rounded-lg px-2 py-1 text-[12px] font-semibold border border-line bg-white text-muted hover:text-ink whitespace-nowrap" title="Every direct booking, one by one">Direct bookings</Link>
      </LeanHead>

      {/* 1. The four numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-3">
        <Tile label="Booked today" value={head(pToday)} accent
          delta={<Delta p={change(pToday)} suffix="vs LY by now · all units" title={lyTitle(pToday)} />} same={same(pToday)}
          lines={[...lines(pToday), `Yesterday ${head(pYest)}${change(pYest) != null ? ' (' + signed(change(pYest) as number) + ')' : ''}`]} />
        <Tile label="This week" value={head(pWeek)}
          delta={<Delta p={change(pWeek)} suffix="vs LY · all units" title={lyTitle(pWeek)} />} same={same(pWeek)}
          lines={[`Mon ${md(pWeek.from)} – today`, ...lines(pWeek)]} />
        <Tile label="This month" value={head(pMonth)}
          delta={<Delta p={change(pMonth)} suffix="vs LY · all units" title={lyTitle(pMonth)} />} same={same(pMonth)}
          lines={[`${md(pMonth.from)} – today`, ...lines(pMonth)]} />
        <Tile label="On the books · next 30 days" value={pct0(d.pace.occ30)}
          delta={<Delta p={d.pace.allPct30} suffix="nights vs LY · all units" title={`${int(d.pace.nights30)} nights on the books now vs ${int(d.pace.allLy30)} at this point last year, every unit we had then`} />}
          same={<Delta p={d.pace.pct30} suffix="same-store" title={`${int(d.pace.sameNights30)} nights on the books vs ${int(d.pace.sameLy30)} at this point last year, over the ${int(d.pace.sameUnits)} units that were live then`} />}
          lines={[`${plural(d.pace.nights30, 'night')} · ${int(d.pace.activeUnits)} units`, d.pace.pct60 != null ? `Next 60 days ${signed(d.pace.pct60)} same-store` : `Next 60 days ${plural(d.pace.nights60, 'night')}`]} />
      </div>

      {/* 2. So what */}
      <p className="rounded-2xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] text-ink mb-4 leading-snug">{soWhat}</p>

      {d.notes.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 mb-3">Read with care: {d.notes.join(' · ')}.</p>
      )}

      {/* 3. The detail */}
      <LeanTabs<TabKey>
        value={tab} onChange={setTab}
        tabs={[
          { key: 'pace', label: 'Needs action', n: needs + watch },
          { key: 'channels', label: 'Channels' },
          { key: 'months', label: 'Months vs budget' },
          { key: 'cancels', label: 'Cancelled', n: d.cancels.count },
          { key: 'daily', label: 'Daily' },
        ]} />

      {tab === 'pace' && (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <LeanPick<PaceView> value={paceView} onPick={v => { setPaceView(v); setShowAll(false) }}
              options={[
                { v: 'action', label: `Needs action ${int(needs + watch)}`, title: 'Behind last year, gone cold, or under the building' },
                { v: 'ahead', label: `Raise rate ${int(d.pace.ahead)}`, title: '85%+ booked and well up on last year' },
                { v: 'all', label: `All ${int(d.pace.totalUnits)}` },
              ]} />
            <input value={q} onChange={e => { setQ(e.target.value); setShowAll(false) }} placeholder="Unit or building…" aria-label="Filter units"
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12.5px] text-ink w-full sm:w-48 sm:ml-auto focus:outline-none focus:border-brand-500" />
          </div>
          {unitsLoading ? (
            <LeanEmpty>Loading every unit…</LeanEmpty>
          ) : unitsFailed && wantAll && partial && allUnits == null ? (
            <LeanEmpty>The full unit list did not load. <button onClick={() => setUnitsFailed(false)} className="font-semibold text-brand-700 hover:underline">Try again</button></LeanEmpty>
          ) : paceRows.length === 0 ? (
            <LeanEmpty>{paceView === 'action' ? 'No unit is behind pace for the next 30 days.' : 'No units match.'}</LeanEmpty>
          ) : (
            <LeanList>
              {visible.map(u => {
                const st = STATUS[u.status]
                const gap = u.ly30 != null ? u.nights30 - u.ly30 : null
                return (
                  <LeanRow key={u.id} tint={st.tint}
                    name={u.name} meta={u.building}
                    tags={<>
                      <Tag tone={st.tone} title={u.why || undefined}>{st.label}</Tag>
                      <Tag title={`${u.nights30} guest nights booked of ${30 - u.held30} sellable in the next 30 days`}>{pct0(u.occ30)} booked</Tag>
                      {gap != null && gap !== 0 && <Tag tone={gap < 0 ? 'rose' : 'emerald'} title={`${u.nights30} nights on the books vs ${u.ly30} at this point last year`}>{gap > 0 ? '+' : '−'}{Math.abs(gap)} nights vs LY</Tag>}
                      {u.pickup14 === 0
                        ? <Tag tone={u.open30 >= 10 ? 'amber' : 'slate'} title="No booking made for this unit in the last 14 days">No pickup 14d</Tag>
                        : <Tag title={`${u.pickup14} booking${u.pickup14 === 1 ? '' : 's'} made in the last 14 days (${u.pickupNights14} nights)`}>{u.pickup14} booked 14d</Tag>}
                    </>}>
                    {u.action ? <p className="text-[13px] text-ink font-medium">{u.action}</p> : null}
                    {u.why ? <p className="text-[12.5px] text-muted">{u.why}</p> : null}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 pt-1">
                      <Fact k="Next 30 days" v={`${u.nights30} nights${u.ly30 != null ? ` · LY ${u.ly30}` : ' · new unit'}`} />
                      <Fact k="Next 60 days" v={`${u.nights60} nights${u.ly60 != null ? ` · LY ${u.ly60}` : ''}`} />
                      <Fact k="Open nights (30)" v={`${u.open30}${u.held30 > 0 ? ` · ${u.held30} owner-held` : ''}`} />
                      <Fact k={u.building} v={`${pct0(u.bldOcc30)} booked`} />
                      {sm && <Fact k="On the books (30)" v={money(u.revenue30)} />}
                    </div>
                  </LeanRow>
                )
              })}
            </LeanList>
          )}
          {!unitsLoading && !showAll && viewTotal > visible.length && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-[12.5px] font-semibold text-brand-700 hover:underline">Show all {int(viewTotal)}</button>
          )}
          <p className="text-[11.5px] text-muted mt-2 px-1">
            Pace = guest nights on the books for {md(d.pace.from)} – {md(d.pace.to30)} against the same weekdays last year, counting only what had been booked by {md(d.asOfLastYear)}. Confirmed, checked-in and checked-out stays only. A unit is compared with last year only if it is same-store (live on that date). Owner and friends-&amp;-family stays are not sales; their nights come off what is left to sell. Last year leaves out stays cancelled after that date, so a small gap is not a signal.
          </p>
        </>
      )}

      {tab === 'channels' && (
        d.channels.length === 0 ? <LeanEmpty>No bookings made this month yet.</LeanEmpty> : (
          <>
            <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70">
              {d.channels.map(c => {
                const pts = c.lyShare != null ? Math.round((c.share - c.lyShare) * 100) : null
                return (
                  <li key={c.name} className="px-3 sm:px-4 py-2.5">
                    <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-ink">{c.name}</span>
                      {c.family === 'direct' && <Tag tone="brand">no channel fee</Tag>}
                      <span className="text-[12px] text-muted">{plural(c.bookings, 'booking')} · {plural(c.nights, 'night')}{c.cancelled > 0 ? ` · ${int(c.cancelled)} cancelled since` : ''}</span>
                      <span className="ml-auto text-[13.5px] font-bold text-ink tabular-nums">{sm ? money(c.revenue) + ' · ' : ''}{pct0(c.share)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-2 rounded-full bg-app overflow-hidden"><div className={`h-full rounded-full ${c.family === 'direct' ? 'bg-brand-600' : 'bg-brand-300'}`} style={{ width: `${Math.max(c.share > 0 ? 1.5 : 0, (c.share / chMax) * 100)}%` }} /></div>
                      <span className={`w-[92px] shrink-0 text-right text-[11.5px] tabular-nums ${pts == null || pts === 0 ? 'text-muted' : pts > 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                        title={c.lyShare != null ? `${pct0(c.lyShare)} of last year's month-to-date bookings` : 'Nothing booked on this channel in the same dates last year'}>
                        {pts == null ? 'new vs LY' : pts === 0 ? 'same share' : `${pts > 0 ? '+' : '−'}${Math.abs(pts)} pts vs LY`}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="text-[11.5px] text-muted mt-2 px-1">
              Bookings made {md(pMonth.from)} – today by where they came from, as a share of {sm ? 'booked value (accommodation before channel fees; no cleaning or taxes)' : 'bookings'}. Direct = booking engine, website and direct; Manual = reservations keyed in by the office. Owner stays are left out.
            </p>
          </>
        )
      )}

      {tab === 'months' && (
        <>
          <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70">
            {d.months.map(m => <MonthRow key={m.month} m={m} showMoney={sm} />)}
          </ul>
          <p className="text-[11.5px] text-muted mt-2 px-1">
            {sm ? 'Net accommodation for stays in each month — accommodation after the channel fee incl. its tax (hostServiceFeeIncTax, else hostServiceFee), the basis the budget is written in. ' : ''}Same-store = units active now that were already live a year ago. The bar fills toward the budget, or toward where last year finished when there is no budget; the dark mark is where last year stood at this point.
          </p>
        </>
      )}

      {tab === 'cancels' && (
        d.cancels.count === 0 ? <LeanEmpty>Nothing cancelled in the last {d.cancels.days} days.</LeanEmpty> : (
          <>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <Tag tone="amber">{plural(d.cancels.count, 'booking')} · {plural(d.cancels.nights, 'night')}{sm ? ' · ' + money(d.cancels.revenue) : ''}</Tag>
              {d.cancels.byChannel.slice(0, 5).map(c => <Tag key={c.name}>{c.name} {int(c.count)}</Tag>)}
            </div>
            <LeanList>
              {d.cancels.list.map(c => {
                const soon = c.daysToArrival != null && c.daysToArrival <= 7
                return (
                  <LeanRow key={c.id} name={c.unit} meta={`${c.channel} · ${md(c.checkIn)} – ${md(c.checkOut)} · ${plural(c.nights, 'night')}`}
                    tags={<>
                      {sm && <Tag tone="amber">{money(c.revenue)}</Tag>}
                      {c.daysToArrival != null && c.daysToArrival >= 0 && <Tag tone={soon ? 'rose' : 'slate'} title="Days between the cancellation and the arrival — the time left to resell the nights">{c.daysToArrival === 0 ? 'day of arrival' : `${c.daysToArrival}d before arrival`}</Tag>}
                      <Tag title={d.cancels.mode === 'changed' ? 'The day the reservation last changed in Guesty' : 'The day the booking was made'}>{d.cancels.mode === 'changed' ? 'cancelled' : 'booked'} {md(c.changed)}</Tag>
                    </>} />
                )
              })}
            </LeanList>
            {d.cancels.count > d.cancels.list.length && <p className="text-[11.5px] text-muted mt-2 px-1">Showing the {d.cancels.list.length} largest of {int(d.cancels.count)}.</p>}
            <p className="text-[11.5px] text-muted mt-2 px-1">
              {d.cancels.mode === 'changed'
                ? 'Guest cancellations dated by the day the reservation last changed in Guesty, largest first. Red = cancelled within a week of arrival: reopen and reprice those nights first.'
                : 'Bookings made in the last 28 days that have already cancelled, largest first.'}
            </p>
          </>
        )
      )}

      {tab === 'daily' && (
        <section className="rounded-2xl border border-line bg-white p-3.5 sm:p-5">
          <p className="text-[12.5px] text-muted mb-2">{sm ? 'Value' : 'Number'} of bookings made each day, last 28 days. Bar = this year · line = the same weekday last year.</p>
          <div className="lh-hscroll -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            <div className="min-w-[560px] sm:min-w-0">
              {dayRows
                ? <DailyChart days={dayRows} showMoney={sm} />
                : daysFailed
                  ? <p className="text-[13px] text-muted py-6 text-center">The daily series did not load. <button onClick={() => setDaysFailed(false)} className="font-semibold text-brand-700 hover:underline">Try again</button></p>
                  : <div className="h-[170px] rounded-xl bg-line/40 animate-pulse" aria-busy="true" aria-label="Loading the daily series" />}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

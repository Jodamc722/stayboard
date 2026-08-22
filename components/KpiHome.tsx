'use client'
// THE HOME PAGE, REBUILT AS A KPI BOARD.
//
// The old home listed today's arrivals and departures by name. That is a work queue, and there are
// already better ones (/plan, /schedule). What was missing was the question a business unit is
// actually judged on: are we filling the units, are we charging enough, is housekeeping making or
// losing money, are guests happy, and is the team getting the work done.
//
// So: big live numbers for today, then every trended KPI against the SAME LENGTH period before it,
// then the three places work comes from — ops throughput, guest experience, and the listings that
// need attention. Every number is a link into the screen that can do something about it.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { SyncNowButton } from '@/components/SyncNowButton'
import { LaborEconStrip } from '@/components/LaborEconStrip'
import {
  LogIn, LogOut, Users, Sparkles, TrendingUp, TrendingDown, Minus, ArrowUpRight,
  Star, PhoneCall, AlertTriangle, Wrench, ClipboardCheck, Brush, Timer, DollarSign,
  MessageSquare, Activity, RefreshCw,
} from 'lucide-react'

const PERIODS = [{ d: 7, l: '7 days' }, { d: 30, l: '30 days' }, { d: 90, l: '90 days' }, { d: 365, l: '12 months' }]

/* ------------------------------------------------------------------ formatting */
function money(n: any): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M'
  if (Math.abs(v) >= 10_000) return '$' + Math.round(v / 1000) + 'k'
  return '$' + Math.round(v).toLocaleString()
}
function exact(n: any): string {
  const v = Number(n)
  return Number.isFinite(v) ? '$' + Math.round(v).toLocaleString() : '—'
}
function pct(n: any, dp = 1): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(dp) + '%' : '—'
}
function count(n: any): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toLocaleString() : '—'
}
function when(iso: any): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const m = Math.floor((Date.now() - d.getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  return Math.floor(h / 24) + 'd ago'
}

/* ------------------------------------------------------------------ pieces */

// A change against the prior period. `invert` for numbers where down is good (cost, complaints).
function Delta({ v, suffix = '', invert = false, label = 'vs prior' }:
  { v: number | null | undefined; suffix?: string; invert?: boolean; label?: string }) {
  if (v == null || !Number.isFinite(Number(v))) return <span className="text-[11px] text-muted">no prior period</span>
  const n = Number(v)
  const up = n > 0.05, down = n < -0.05
  const good = invert ? down : up
  const bad = invert ? up : down
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus
  const tone = good ? 'text-emerald-700' : bad ? 'text-rose-700' : 'text-muted'
  return (
    <span className={'inline-flex items-center gap-1 text-[11px] font-semibold ' + tone}>
      <Icon size={12} />{n > 0 ? '+' : ''}{n}{suffix} {label}
    </span>
  )
}

function Tile({ label, value, sub, delta, href, Icon, accent, alert }: {
  label: string; value: string; sub?: any; delta?: any; href?: string; Icon?: any; accent?: boolean; alert?: boolean
}) {
  const body = (
    <div className={'h-full rounded-xl border px-3.5 py-3 transition-colors ' +
      (accent ? 'border-brand-200 bg-brand-50/60 hover:bg-brand-50'
        : alert ? 'border-rose-200 bg-rose-50/50 hover:bg-rose-50'
          : 'border-line bg-white hover:border-brand-200 hover:bg-app/60')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] tracking-wider uppercase text-muted font-semibold truncate">{label}</span>
        {Icon && <Icon size={13} className={alert ? 'text-rose-500' : 'text-muted/60'} />}
      </div>
      <div className={'text-[26px] leading-none font-bold mt-1.5 tabular-nums ' + (alert ? 'text-rose-700' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11.5px] text-muted mt-1 truncate">{sub}</div>}
      {delta !== undefined && <div className="mt-1">{delta}</div>}
    </div>
  )
  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}

function Panel({ title, note, right, children }: { title: string; note?: string; right?: any; children: any }) {
  return (
    <section className="rounded-2xl border border-line bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink text-[15px] tracking-tight">{title}</h2>
          {note && <p className="text-[11.5px] text-muted mt-0.5">{note}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

function Bar({ value, max, tone = 'brand' }: { value: number; max: number; tone?: 'brand' | 'rose' | 'emerald' }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  const bg = tone === 'rose' ? 'bg-rose-400' : tone === 'emerald' ? 'bg-emerald-400' : 'bg-brand-400'
  return (
    <div className="h-1.5 rounded-full bg-app overflow-hidden">
      <div className={'h-full rounded-full ' + bg} style={{ width: w + '%' }} />
    </div>
  )
}

function Big({ label, value, sub, href, Icon, tone }: {
  label: string; value: any; sub?: string; href?: string; Icon?: any; tone?: 'alert' | 'good'
}) {
  const inner = (
    <div className="px-3 py-2 h-full">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted font-semibold">
        {Icon && <Icon size={12} className="text-muted/70" />}<span className="truncate">{label}</span>
      </div>
      <div className={'text-[32px] leading-none font-bold mt-1.5 tabular-nums ' +
        (tone === 'alert' ? 'text-rose-600' : tone === 'good' ? 'text-emerald-600' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-1 truncate">{sub}</div>}
    </div>
  )
  return href ? <Link href={href} className="block hover:bg-app/70 rounded-lg transition-colors">{inner}</Link> : inner
}

function Skel({ h = 84 }: { h?: number }) {
  return <div className="rounded-xl border border-line bg-white animate-pulse" style={{ height: h }} />
}

/* ------------------------------------------------------------------ the page */

export function KpiHome({ dateLabel }: { dateLabel: string }) {
  const [days, setDays] = useState(30)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [market, setMarket] = useState('all')
  const [building, setBuilding] = useState('all')
  const [cut, setCut] = useState<'market' | 'building' | 'day'>('market')

  const [k, setK] = useState<any>(null)
  const [rev, setRev] = useState<any>(null)
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const range = (from && to) ? '&from=' + from + '&to=' + to : ''
  const scope = '&market=' + encodeURIComponent(market) + '&building=' + encodeURIComponent(building)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/kpi?days=' + days + scope + range, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load the numbers')
      setK(j)
    } catch (e: any) { setErr(String((e && e.message) || e)) }
    setLoading(false)
    // Reviews and listing health are slower and independent — never let them hold up the board.
    fetch('/api/reviews/kpi?days=' + days + scope + range, { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (j && j.ok) setRev(j) }).catch(() => {})
    fetch('/api/listing-health?slim=1', { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (j && j.summary) setHealth(j) }).catch(() => {})
  }, [days, market, building, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  // Refresh when the tab comes back into view — a KPI board left open overnight must not lie.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const t = (k && k.today) || {}
  const r = (k && k.revenue) || {}
  const c = (k && k.cleaning) || {}
  const lab = (k && k.labor) || {}
  const w = (k && k.work) || {}
  const wc = (k && k.welcome) || {}
  const s = (k && k.sentiment) || {}
  const g = (k && k.glitches) || {}
  const win = (k && k.window) || {}
  const canSeeMoney = !k || k.canSeeMoney
  const rh = (rev && rev.headline) || {}

  const windowLabel = win.from
    ? (win.days === 1 ? 'Today' : win.from + ' → ' + win.to + ' (' + win.days + ' days)')
    : ''

  return (
    <div>
      {/* ---------------------------------------------------------------- header */}
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Stay Hospitality</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Business KPIs</h1>
          <p className="text-sm text-muted mt-1">
            {dateLabel}
            {k && k.lastSync && <span> · <Activity size={11} className="inline -mt-0.5 text-muted/70" /> synced {when(k.lastSync)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app text-ink disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {loading ? 'Working…' : 'Refresh'}
          </button>
          <SyncNowButton />
        </div>
      </header>

      {/* ---------------------------------------------------------------- controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => { setDays(p.d); setFrom(''); setTo('') }}
              className={'text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md border ' +
                (days === p.d && !from ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{p.l}</button>
          ))}
        </div>
        <select value={market} onChange={e => { setMarket(e.target.value); setBuilding('all') }}
          className="text-[12px] border border-line rounded-md px-2 py-1.5 bg-white">
          <option value="all">All markets</option>
          {((k && k.filters && k.filters.markets) || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={building} onChange={e => setBuilding(e.target.value)}
          className="text-[12px] border border-line rounded-md px-2 py-1.5 bg-white">
          <option value="all">All buildings</option>
          {((k && k.filters && k.filters.buildings) || []).map((b: string) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-[12px] border border-line rounded-md px-1.5 py-1.5 bg-white" />
          <span>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-[12px] border border-line rounded-md px-1.5 py-1.5 bg-white" />
          {(from || to) && <button onClick={() => { setFrom(''); setTo('') }} className="text-[11px] font-semibold text-ink underline">clear</button>}
        </span>
        {err && <span className="text-[11.5px] text-rose-700">{err}</span>}
      </div>

      {/* ---------------------------------------------------------------- today */}
      <section className="rounded-2xl border border-line bg-white mb-5 overflow-hidden">
        <header className="px-4 py-2.5 border-b border-line flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-ink text-[15px] tracking-tight">Right now</h2>
          <span className="text-[11px] text-muted">{t.units != null ? t.units + ' active units' : ''}</span>
        </header>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-y lg:divide-y-0 divide-line py-1">
          <Big label="Arrivals" value={count(t.arrivals)} Icon={LogIn} href="/plan" sub={t.arrivals7 != null ? t.arrivals7 + ' next 7 days' : undefined} />
          <Big label="Departures" value={count(t.departures)} Icon={LogOut} href="/plan" sub={t.sameDayTurns ? t.sameDayTurns + ' same-day turns' : 'no same-day turns'} />
          <Big label="In house" value={count(t.inHouse)} Icon={Users} href="/reservations" sub={t.occupancy != null ? pct(t.occupancy, 0) + ' of units' : undefined} />
          <Big label="Cleans today" value={t.cleansScheduled != null ? t.cleansDone + '/' + t.cleansScheduled : '—'} Icon={Brush} href="/schedule"
            sub={t.cleansScheduled ? Math.round((t.cleansDone / t.cleansScheduled) * 100) + '% done' : 'none scheduled'} />
          <Big label="Welcome calls due" value={count(t.welcomeDueNow)} Icon={PhoneCall} href="/welcome-calls" sub="next 48 hours"
            tone={t.welcomeDueNow > 0 ? 'alert' : undefined} />
          <Big label="Open work" value={count(t.openWork)} Icon={AlertTriangle} href="/glitches"
            sub={t.openGlitches != null ? t.openGlitches + ' glitches · ' + count(t.openTasks) + ' unfinished tasks' : 'nothing open'}
            tone={t.openGlitches > 0 ? 'alert' : undefined} />
          <Big label="Unhappy guests" value={count(t.openUnhappy)} Icon={MessageSquare} href="/messages"
            sub={t.awaitingReply ? t.awaitingReply + ' awaiting a reply' : 'open threads'} tone={t.openUnhappy > 0 ? 'alert' : undefined} />
          <Big label="Booked next 7d" value={canSeeMoney ? money(t.booked7) : '—'} Icon={DollarSign} href="/revenue" sub="value of arrivals" />
        </div>
      </section>

      {/* ---------------------------------------------------------------- window label */}
      {windowLabel && (
        <p className="text-[12px] text-muted mb-2.5">
          Everything below covers <span className="font-semibold text-ink">{windowLabel}</span>, compared with the {win.days} days before it
          ({win.prevFrom} → {win.prevTo}).
          {market !== 'all' ? ' ' + market + ' only.' : ''}{building !== 'all' ? ' ' + building + ' only.' : ''}
        </p>
      )}

      {/* ---------------------------------------------------------------- KPI grid */}
      {!k && loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <Skel key={i} />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Tile label="Occupancy" value={pct(r.occupancy, 1)} Icon={Users} href="/revenue"
              sub={r.nights != null ? count(r.nights) + ' of ' + count(r.available) + ' unit-nights' : undefined}
              delta={<Delta v={r.occupancyChange} suffix=" pts" />} accent />
            <Tile label="ADR (incl. cleaning)" value={canSeeMoney ? exact(r.adr) : '—'} Icon={DollarSign} href="/revenue"
              sub={canSeeMoney && r.adrRoomOnly != null ? exact(r.adrRoomOnly) + ' room only' : undefined}
              delta={<Delta v={r.adrChange} suffix="%" />} />
            <Tile label="RevPAR" value={canSeeMoney ? exact(r.revpar) : '—'} Icon={TrendingUp} href="/revenue"
              sub="revenue per available unit-night" delta={<Delta v={r.revparChange} suffix="%" />} />
            <Tile label="Revenue" value={canSeeMoney ? money(r.total) : '—'} Icon={DollarSign} href="/revenue"
              sub="stay nights in window + cleaning" delta={<Delta v={r.totalChange} suffix="%" />} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Tile label="Cleaning revenue" value={canSeeMoney ? money(c.revenue) : '—'} Icon={Brush} href="/labor"
              sub={c.turns != null
                ? 'net · ' + count(c.turnsInHouse ?? c.turns) + ' in-house turns · ' + (canSeeMoney ? exact(c.feePerTurn) : '—') + ' a turn'
                  + (c.turnsVendor ? ' · ' + count(c.turnsVendor) + ' vendor' : '')
                  + (c.turnsBackfilled ? ' · ' + count(c.turnsBackfilled) + ' Expedia rebuilt' : '')
                  + (c.turnsUnpriced ? ' · ' + count(c.turnsUnpriced) + ' with no fee on file' : '')
                : undefined}
              delta={<Delta v={c.revenueChange} suffix="%" />} />
            {/* Margin and labour cost only mean something once somebody records what the cleaners were
                paid. Breezeway leaves rate_paid empty, so rather than print a flattering 100% margin
                these tiles say so and point at the fix. */}
            <Tile label="Cleaning margin" value={canSeeMoney && c.costKnown ? money(c.margin) : 'Not costed'} Icon={DollarSign} href="/labor"
              sub={canSeeMoney
                ? (c.costKnown
                  ? 'fees ' + money(c.revenue) + ' − pay ' + money(c.cost) + (c.marginPct != null ? ' · ' + pct(c.marginPct, 0) : '')
                  : 'no cleaner pay on record — upload a Homebase timesheet')
                : undefined}
              delta={c.costKnown ? <Delta v={c.marginChange} suffix="%" /> : undefined}
              alert={canSeeMoney && c.costKnown && c.margin != null && c.margin < 0} />
            <Tile label={lab.known ? 'Labor cost' : 'Hours worked'}
              value={lab.known ? (canSeeMoney ? money(lab.cost) : '—') : (lab.hours != null ? Math.round(lab.hours).toLocaleString() + 'h' : '—')}
              Icon={Timer} href="/labor"
              sub={lab.known
                ? (canSeeMoney && lab.costRatio != null ? pct(lab.costRatio, 1) + ' of revenue' : '') + (lab.homebaseConnected ? ' · Homebase' : ' · Breezeway pay')
                : 'logged on Breezeway tasks · no pay rate on record'}
              delta={lab.known ? <Delta v={lab.costChange} suffix="%" invert /> : undefined} />
            <Tile label={lab.known ? 'Cost per turn' : 'Minutes per turn'}
              value={lab.known ? (canSeeMoney ? exact(lab.costPerTurn) : '—') : (c.minutesPerTurn != null ? c.minutesPerTurn + ' min' : '—')}
              Icon={Brush} href="/cleaners"
              sub={lab.known
                ? (c.minutesPerTurn != null ? c.minutesPerTurn + ' min a turn on average' : 'no completion times yet')
                : 'benchmark: studio 90 · 2BR 120 · 3BR+ 180'} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Tile label="Review score" value={rh.avg != null ? Number(rh.avg).toFixed(2) : (rev ? '—' : '…')} Icon={Star} href="/reviews"
              sub={rh.fiveShare != null ? pct(rh.fiveShare, 1) + ' five star · ' + count(rh.n) + ' reviews' : 'loading reviews'}
              delta={rh.change != null ? <Delta v={rh.change} /> : undefined}
              alert={rh.avg != null && Number(rh.avg) < 4.5} />
            <Tile label="Review responses" value={rh.replyCoverage != null ? pct(rh.replyCoverage, 1) : (rev ? '—' : '…')} Icon={MessageSquare} href="/reviews"
              sub={rh.awaitingReply != null
                ? count(rh.awaitingReply) + ' still waiting' + (rh.medianReplyHours != null ? ' · ' + rh.medianReplyHours + 'h median' : '')
                : 'reply coverage'}
              alert={rh.awaitingReply > 0} />
            <Tile label="Welcome calls" value={wc.pct != null ? pct(wc.pct, 1) : '—'} Icon={PhoneCall} href="/welcome-calls"
              sub={wc.arrivals != null ? count(wc.done) + ' of ' + count(wc.arrivals) + ' arrivals called' : undefined}
              delta={wc.pct != null && wc.pctPrev != null ? <Delta v={Math.round((wc.pct - wc.pctPrev) * 10) / 10} suffix=" pts" /> : undefined}
              alert={wc.pct != null && wc.pct < 80} />
            <Tile label="Guest sentiment" value={s.happyPct != null ? pct(s.happyPct, 1) : '—'} Icon={Sparkles} href="/messages"
              sub={s.scanned != null ? count(s.unhappy) + ' unhappy of ' + count(s.scanned) + ' scanned threads' : undefined}
              delta={s.happyPct != null && s.happyPctPrev != null ? <Delta v={Math.round((s.happyPct - s.happyPctPrev) * 10) / 10} suffix=" pts" /> : undefined}
              alert={s.happyPct != null && s.happyPct < 90} />
          </div>
        </>
      )}

      {/* labor economics - same numbers as /labor, the briefs and the schedule strip */}
      <LaborEconStrip days={7} />

      {/* ---------------------------------------------------------------- ops throughput */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          <Panel
            title="Work completed"
            note={w.completed != null
              ? count(w.completed) + ' of ' + count(w.scheduled) + ' Breezeway tasks closed'
                + (w.completionRate != null ? ' · ' + pct(w.completionRate, 0) + ' completion' : '')
                + (w.onTimeRate != null ? ' · ' + pct(w.onTimeRate, 0) + ' finished on the day' : '')
              : 'pulling Breezeway…'}
            right={
              <div className="flex gap-1">
                {(['market', 'building', 'day'] as const).map(x => (
                  <button key={x} onClick={() => setCut(x)}
                    className={'text-[11px] font-semibold px-2 py-1 rounded-md border capitalize ' +
                      (cut === x ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>
                    {x === 'day' ? 'by day' : 'by ' + x}
                  </button>
                ))}
              </div>
            }>
            {/* Three of these across a phone is ~90px a tile, and each carries a label, a 32px
                number and a "was 1,100" sub-label — the labels truncated to "Mainten…". Stacked
                below 640px (with the divider turned horizontal), three across from sm: up. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line border-b border-line">
              <Big label="Cleans" value={count(w.cleans)} Icon={Brush} href="/schedule"
                sub={w.cleansPrev != null ? 'was ' + count(w.cleansPrev) : undefined} />
              <Big label="Maintenance" value={count(w.maintenance)} Icon={Wrench} href="/glitches"
                sub={w.maintenancePrev != null ? 'was ' + count(w.maintenancePrev) : undefined} />
              <Big label="Inspections" value={count(w.inspections)} Icon={ClipboardCheck} href="/inspections"
                sub={w.inspectionsPrev != null ? 'was ' + count(w.inspectionsPrev) : undefined} />
            </div>

            {/* Five-column reference tables. Rather than drop columns (Occ and Revenue are the
                point of the cut), they scroll inside their own box on a phone; the page itself
                never travels sideways. min-w only bites below the panel's own width. */}
            {cut === 'market' && (
              <div className="lh-hscroll">
              <table className="w-full min-w-[480px] text-[12.5px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted">
                    <th className="text-left font-semibold px-4 py-2">Market</th>
                    <th className="text-right font-semibold px-2">Units</th>
                    <th className="text-right font-semibold px-2">Done</th>
                    <th className="text-right font-semibold px-2">Occ</th>
                    <th className="text-right font-semibold px-4">{canSeeMoney ? 'Revenue' : 'Nights'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {(w.byMarket || []).map((m: any) => (
                    <tr key={m.market} className="hover:bg-app/60">
                      <td className="px-4 py-2 font-medium text-ink">{m.market}</td>
                      <td className="px-2 text-right tabular-nums text-muted">{count(m.units)}</td>
                      <td className="px-2 text-right tabular-nums font-semibold text-ink">{count(m.done)}</td>
                      <td className="px-2 text-right tabular-nums">{pct(m.occupancy, 0)}</td>
                      <td className="px-4 text-right tabular-nums">{canSeeMoney ? money(m.revenue) : count(m.nights)}</td>
                    </tr>
                  ))}
                  {(!w.byMarket || !w.byMarket.length) && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No work in this window.</td></tr>}
                </tbody>
              </table>
              </div>
            )}

            {cut === 'building' && (
              <div className="lh-hscroll">
              <table className="w-full min-w-[480px] text-[12.5px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted">
                    <th className="text-left font-semibold px-4 py-2">Building</th>
                    <th className="text-right font-semibold px-2">Cleans</th>
                    <th className="text-right font-semibold px-2">Maint.</th>
                    <th className="text-right font-semibold px-2">Insp.</th>
                    <th className="text-right font-semibold px-4">Done</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {(w.byBuilding || []).map((b: any) => (
                    <tr key={b.building} className="hover:bg-app/60">
                      <td className="px-4 py-2 font-medium text-ink truncate max-w-[220px]">{b.building}</td>
                      <td className="px-2 text-right tabular-nums">{count(b.cleans)}</td>
                      <td className="px-2 text-right tabular-nums">{count(b.maintenance)}</td>
                      <td className="px-2 text-right tabular-nums">{count(b.inspections)}</td>
                      <td className="px-4 text-right tabular-nums font-semibold text-ink">{count(b.done)}</td>
                    </tr>
                  ))}
                  {(!w.byBuilding || !w.byBuilding.length) && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No work in this window.</td></tr>}
                </tbody>
              </table>
              </div>
            )}

            {cut === 'day' && (
              <div className="px-4 py-3">
                {(() => {
                  const rows = (w.byDay || [])
                  const max = rows.reduce((m: number, x: any) => Math.max(m, x.done), 0)
                  const show = rows.slice(-45)
                  return (
                    <div>
                      <div className="flex items-end gap-[3px] h-28">
                        {show.map((x: any) => (
                          <div key={x.date} title={x.date + ' · ' + x.done + ' tasks'}
                            className="flex-1 bg-brand-300 hover:bg-brand-500 rounded-t transition-colors"
                            style={{ height: Math.max(2, max ? (x.done / max) * 100 : 0) + '%' }} />
                        ))}
                      </div>
                      <div className="flex justify-between text-[10px] text-muted mt-1.5">
                        <span>{show.length ? show[0].date : ''}</span>
                        <span>peak {max} tasks in a day</span>
                        <span>{show.length ? show[show.length - 1].date : ''}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </Panel>
        </div>

        {/* service failures */}
        <Panel title="Service failures" note={g.opened != null ? count(g.opened) + ' glitches raised in this window' : 'loading…'}>
          <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
            <Big label="Raised" value={count(g.opened)} href="/glitches" sub={g.openedPrev != null ? 'was ' + count(g.openedPrev) : undefined} />
            <Big label="Cost" value={canSeeMoney ? money(g.cost) : '—'} href="/glitches" sub="recovery + refunds"
              tone={g.cost > 0 ? 'alert' : undefined} />
          </div>
          <ul className="divide-y divide-line/70">
            {(g.categories || []).map((x: any) => (
              <li key={x.category} className="px-4 py-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[12.5px] text-ink truncate">{x.category}</span>
                  <span className="text-[12px] font-semibold tabular-nums text-muted">{x.n}</span>
                </div>
                <Bar value={x.n} max={(g.categories[0] || {}).n || 1} tone="rose" />
              </li>
            ))}
            {(!g.categories || !g.categories.length) && <li className="px-4 py-6 text-center text-muted text-sm">No glitches raised. Good window.</li>}
          </ul>
          {(s.topIssues || []).length > 0 && (
            <div className="px-4 py-3 border-t border-line">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">What unhappy guests raise</div>
              <div className="flex flex-wrap gap-1.5">
                {(s.topIssues || []).map((x: any) => (
                  <span key={x.issue} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-app text-ink tabular-nums">
                    {x.issue} <span className="text-muted">{x.n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ---------------------------------------------------------------- guest experience */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Panel title="Recent low reviews" note="3 stars or under in this window — click through to reply or raise a task">
          <ul className="divide-y divide-line/70 max-h-[420px] overflow-auto">
            {((k && k.negatives) || []).map((n: any) => (
              <li key={n.id}>
                <Link href="/reviews" className="group flex gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                  <span className={'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-bold ' +
                    (n.rating <= 2 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>{n.rating}★</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-semibold text-ink truncate">{n.unit}</span>
                      {n.channel && <span className="text-[10px] uppercase tracking-wider text-muted">{n.channel}</span>}
                      {!n.replied && <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 rounded px-1">no reply</span>}
                    </div>
                    <p className="text-[11.5px] text-muted line-clamp-2">{n.quote || '(no written review)'}</p>
                  </div>
                  <ArrowUpRight size={13} className="text-muted opacity-0 group-hover:opacity-100 shrink-0" />
                </Link>
              </li>
            ))}
            {k && (!k.negatives || !k.negatives.length) && <li className="px-4 py-8 text-center text-muted text-sm">No reviews at 3 stars or under. Rare — enjoy it.</li>}
            {!k && <li className="px-4 py-8 text-center text-muted text-sm">Loading…</li>}
          </ul>
        </Panel>

        <Panel title="Reputation by month" note={rev ? 'bar = five-star share, number = average' : 'loading reviews…'}>
          <div className="px-4 py-4">
            {(() => {
              const months = (rev && rev.months) || []
              if (!months.length) return <p className="text-sm text-muted text-center py-8">No review history in this window.</p>
              return (
                /* Twelve columns sharing a phone width is ~16px each — the month label and the
                   count under every bar truncated to nothing. The chart keeps its real column
                   width and scrolls sideways in its own box; above 640px it fits and never does. */
                <div className="lh-hscroll -mx-4 px-4 sm:mx-0 sm:px-0">
                <div className="flex items-end gap-2 h-40 min-w-[440px] sm:min-w-0">
                  {months.slice(-12).map((m: any) => (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <span className="text-[10px] font-semibold text-ink tabular-nums">{m.avg != null ? Number(m.avg).toFixed(2) : '—'}</span>
                      <div className="w-full bg-app rounded-t flex items-end" style={{ height: 96 }}>
                        <div className="w-full bg-brand-400 rounded-t" style={{ height: Math.max(2, Number(m.fiveShare) || 0) + '%' }} />
                      </div>
                      <span className="text-[9.5px] text-muted truncate w-full text-center">{String(m.month).slice(2)}</span>
                      <span className="text-[9.5px] text-muted tabular-nums">{m.n}</span>
                    </div>
                  ))}
                </div>
                </div>
              )
            })()}
          </div>
          <div className="px-4 py-3 border-t border-line grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Weakest category</div>
              <div className="text-[13px] font-semibold text-ink mt-0.5">
                {rev && rev.categories && rev.categories[0] ? rev.categories[0].label + ' ' + Number(rev.categories[0].avg).toFixed(2) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Review rate</div>
              <div className="text-[13px] font-semibold text-ink mt-0.5">{rh.reviewRate != null ? pct(rh.reviewRate, 1) : '—'}</div>
            </div>
          </div>
        </Panel>

        <Panel title="Listings to optimize"
          note={health ? 'weakest health scores across the portfolio' : 'scoring listings…'}
          right={<Link href="/health" className="text-[11.5px] font-semibold text-brand-600 hover:underline">All →</Link>}>
          <ul className="divide-y divide-line/70 max-h-[420px] overflow-auto">
            {((health && health.worst) || []).slice(0, 8).map((l: any) => (
              <li key={l.id}>
                <Link href={'/listings/' + l.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                  <span className={'shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[12px] font-bold ' +
                    (l.score < 60 ? 'bg-rose-50 text-rose-700' : l.score < 75 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>
                    {Math.round(l.score)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-ink truncate">{l.name}</div>
                    <div className="text-[11px] text-muted truncate">
                      {(l.issues && l.issues[0] && l.issues[0].title) || l.topIssue || (l.avgStars != null ? Number(l.avgStars).toFixed(2) + '★ over ' + l.reviewCount + ' reviews' : l.market)}
                    </div>
                  </div>
                  <ArrowUpRight size={13} className="text-muted opacity-0 group-hover:opacity-100 shrink-0" />
                </Link>
              </li>
            ))}
            {!health && <li className="px-4 py-8 text-center text-muted text-sm">Loading…</li>}
            {health && (!health.worst || !health.worst.length) && <li className="px-4 py-8 text-center text-muted text-sm">Nothing scoring badly.</li>}
          </ul>
          {health && health.summary && (
            <div className="px-4 py-3 border-t border-line flex flex-wrap gap-3 text-[11.5px]">
              <span className="text-muted">Portfolio <span className="font-semibold text-ink tabular-nums">{health.summary.avgScore}</span></span>
              <span className="text-muted">At risk <span className="font-semibold text-rose-700 tabular-nums">{(health.summary.atRisk || 0) + (health.summary.critical || 0)}</span></span>
              <span className="text-muted">Open fixes <span className="font-semibold text-ink tabular-nums">{health.summary.openActions}</span></span>
            </div>
          )}
        </Panel>
      </div>

      {/* ---------------------------------------------------------------- channels + footnote */}
      {canSeeMoney && r.channels && r.channels.length > 0 && (
        <Panel title="Where the nights come from" note="channel mix by unit-nights in this window">
          {/* Channel · Nights · Share · Revenue · bar — a reference table, so it scrolls inside
              its own box on a phone rather than dropping a column. */}
          <div className="lh-hscroll">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left font-semibold px-4 py-2">Channel</th>
                <th className="text-right font-semibold px-2">Nights</th>
                <th className="text-right font-semibold px-2">Share</th>
                <th className="text-right font-semibold px-4">Revenue</th>
                <th className="w-1/3 px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {r.channels.map((ch: any) => (
                <tr key={ch.channel} className="hover:bg-app/60">
                  <td className="px-4 py-2 font-medium text-ink truncate max-w-[200px]">{ch.channel}</td>
                  <td className="px-2 text-right tabular-nums">{count(ch.nights)}</td>
                  <td className="px-2 text-right tabular-nums text-muted">{pct(ch.share, 1)}</td>
                  <td className="px-4 text-right tabular-nums font-semibold text-ink">{money(ch.revenue)}</td>
                  <td className="px-4"><Bar value={ch.nights} max={r.channels[0].nights || 1} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Panel>
      )}

      <p className="text-[11px] text-muted mt-4 leading-relaxed">
        Occupancy counts booked unit-nights against active units × days in the window. ADR includes the cleaning fee.
        Cleaning revenue is NET of the channel&apos;s cut, on units our own crew turns (vendor checkouts counted separately);
        Expedia-bundled fees are rebuilt from the unit&apos;s own booking history — the same rules as the Labor board.
        {c.costKnown
          ? ' Cleaning pay is what Breezeway records as paid on completed housekeeping tasks.'
          : ' Breezeway is not recording what cleaners are paid, so margin and cost per turn stay blank rather than flattering — upload a Homebase timesheet on the Labor page and they fill in with real hours and payroll.'}
      </p>
    </div>
  )
}

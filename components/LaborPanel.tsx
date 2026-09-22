'use client'
import { LaborWeekly } from '@/components/LaborWeekly'
import { LaborDays } from '@/components/LaborDays'
// components/LaborPanel.tsx (v4) — live labor dashboard for /labor.
// v4: custom day/range picker, payroll vs revenue with banding, today strip
// for in-day decisions, click-a-person task drill-down (Breezeway).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, Users } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, IconBtn } from '@/components/lean'

const MARKETS = [{ k: 'all', l: 'All' }, { k: 'miami', l: 'Miami' }, { k: 'broward', l: 'Broward' }, { k: 'north', l: 'North' }]
const PRESETS = [{ d: 7, l: '7d' }, { d: 14, l: '14d' }, { d: 30, l: '30d' }]

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
const pct = (n: number | null | undefined) => n == null ? '—' : Math.round(Number(n) * 10) / 10 + '%'
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
// "3 studio · 2×1BR · 1×3BR" — the room-size mix of a person's departure cleans.
const ROOM_ORDER = ['studio', '1br', '2br', '3br', '4br+']
const ROOM_LABEL: Record<string, string> = { studio: 'studio', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br+': '4BR+' }
const roomMixTxt = (mix: Record<string, number> | null | undefined): string => {
  if (!mix) return ''
  return ROOM_ORDER.filter(k => mix[k]).map(k => `${mix[k]}×${ROOM_LABEL[k]}`).join(' · ')
}

// Fixed 2026-08-21 from Jon's screenshot of /labor, in two passes.
//   1. A grid item defaults to min-width:auto, so it refuses to shrink below its content — $13,393
//      at 22px overflowed its column and, with no horizontal gap, printed on top of the next tile.
//      `min-w-0` is what lets the track constrain it.
//   2. Wrapping is the wrong safety net for MONEY: "$13,39 / 3" on two lines reads as two numbers.
//      So the value stays `whitespace-nowrap` and is sized to fit the narrowest tile we render
//      (a quarter-width department card, ~90px), with `overflow-hidden` on the root as the
//      last-resort guarantee that nothing can ever ride over the tile beside it. Labels and subs
//      are prose, so they still wrap.
function Stat({ label, value, sub, tone, title }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad'; title?: string }) {
  const color = tone === 'bad' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-700' : 'text-ink'
  return (
    <div className="min-w-0 overflow-hidden text-center px-1" title={title}>
      <div className={'text-[18px] xl:text-[20px] font-bold tabular-nums leading-tight whitespace-nowrap ' + color}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mt-0.5 break-words">{label}</div>
      {sub && <div className="text-[10.5px] text-muted break-words">{sub}</div>}
    </div>
  )
}

export function LaborPanel() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [days, setDays] = useState(7)
  const [market, setMarket] = useState('all')
  const [open, setOpen] = useState<string>('')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  // FOUR TABS, NOT SEVENTEEN STACKED CARDS (Jon, 2026-09-01: "the labor page needs to be
  // cleaner and make more sense"). Every number still comes from the one engine; the tabs are
  // presentation. Overview answers "how are we doing", Cost per clean answers Jon's standing
  // question, People is the crew, Data health is why the other three can be believed.
  const [tab, setTab] = useState<'overview' | 'costs' | 'people' | 'health'>('overview')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const range = from && to ? `&from=${from}&to=${to}` : `&days=${days}`
      const r = await fetch(`/api/labor/kpi?market=${market}${range}`, { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not load labor data')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [days, from, to, market])
  useEffect(() => { load() }, [load])

  const pickToday = () => { const t = todayISO(); setFrom(t); setTo(t) }
  const pickPreset = (n: number) => { setFrom(''); setTo(''); setDays(n) }

  const people = d?.people || []
  const pay = d?.payroll || {}
  // The shared labor P&L (lib/labor-econ) — same object the briefs print from.
  const econ = (d as any)?.econ
  const pnl = econ?.pnl
  // The KPI block — revenue over payroll by crew, and the per-head table below it.
  const kpi = econ?.kpi
  // Per-person P&L keyed by the Homebase spelling, so the People table can show what each person
  // earned (cleaning fees + the charges typed on their tasks) beside what they cost.
  const econBy: Record<string, any> = {}
  for (const x of ((econ?.people || []) as any[])) econBy[x.name] = x
  const DEPT_SHORT: Record<string, string> = { housekeeping: 'HK', supervision: 'Sup', ccs: 'CCS', maintenance: 'Maint', inspection: 'Insp', other: '—' }
  const tasks = d?.tasks || {}
  const tdy = d?.today
  const personTasks = d?.personTasks || {}
  const flags = d?.flags || { overtimeRisk: [], noShows: [], stillClockedIn: [] }
  const hasFlags = flags.overtimeRisk.length || flags.noShows.length || flags.stillClockedIn.length
  const bandTone = pay.band === 'on_target' ? 'good' : pay.band === 'watch' ? 'warn' : pay.band === 'over' ? 'bad' : undefined
  // The server decides who sees amounts (lib/access.ts canSeeMoney) and simply doesn't send them to
  // anyone else — `moneyHidden` only tells this component which layout to draw. Every dollar tile
  // below has a percentage counterpart, so the board answers the same questions either way.
  const hideMoney = d?.moneyHidden === true
  const peopleCols = hideMoney ? 7 : 11

  // THE PERSON'S DAYS, NOT JUST THEIR TASKS (Jon, 2026-08-23: "the labor KPI dashboard needs
  // to show all the color"). Each day is a ledger line — cleans and the net fees they earned,
  // charges on other work, hours, loaded wages, hops, margin — with that day's Breezeway task
  // story underneath. The engine's personDays is the money; personTasks is the narrative.
  const TaskList = ({ name }: { name: string }) => {
    const rows = personTasks[name] || []
    const ledger: any[] = ((econ?.personDays || {})[name] || []).slice().reverse()
    if (!rows.length && !ledger.length) return <div className="px-6 py-3 text-[12px] text-muted">No Breezeway tasks or punches recorded for {name} in this range.</div>
    const byDay: Record<string, any[]> = {}
    for (const t of rows) (byDay[t.date] = byDay[t.date] || []).push(t)
    const days = ledger.length ? ledger.map((l: any) => l.d) : Object.keys(byDay).sort().reverse()
    const ledBy: Record<string, any> = {}
    for (const l of ledger) ledBy[l.d] = l
    return (
      <div className="px-6 py-2 bg-app/60">
        {days.map((d: string) => {
          const L = ledBy[d]
          return (
            <div key={d} className="py-1">
              <div className="flex items-center gap-2 text-[11.5px] py-1 font-semibold text-ink border-b border-line/60">
                <span className="tabular-nums">{String(d).slice(5)}</span>
                {L && <>
                  <span className="text-muted font-normal">· {L.cleans} clean{L.cleans === 1 ? '' : 's'} · {L.hours}h{L.hops ? ` · ${L.hops} hop${L.hops === 1 ? '' : 's'}` : ''}</span>
                  {!hideMoney && <span className="ml-auto tabular-nums font-normal text-muted">
                    {L.fee > 0 && <span className="mr-2">fees {fmt$(L.fee)}</span>}
                    {L.billable > 0 && <span className="mr-2">billables {fmt$(L.billable)}</span>}
                    <span className="mr-2">wages {fmt$(L.wages)}</span>
                    <span className={'font-semibold ' + (L.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{L.margin >= 0 ? '+' : ''}{fmt$(L.margin)}</span>
                  </span>}
                </>}
              </div>
              {(byDay[d] || []).map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[12.5px] py-1 border-b border-line/40 last:border-0">
                  <span className="w-20 shrink-0" />
                  <span className={'text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ' +
                    (t.kind === 'clean' ? 'bg-indigo-100 text-indigo-700' : t.kind === 'inspection' ? 'bg-sky-100 text-sky-700' : t.kind === 'maintenance' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-muted')}>{t.kind}</span>
                  <span className="text-ink font-medium truncate">{t.unit}</span>
                  <span className="text-muted truncate hidden sm:inline">· {t.task}</span>
                  <span className="ml-auto text-muted tabular-nums shrink-0">{t.minutes != null ? t.minutes + 'm' : ''}</span>
                  <span className="text-ink tabular-nums w-14 text-right shrink-0">{t.pay != null && t.pay > 0 ? fmt$(t.pay) : ''}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  // TREND — cost per clean and HK margin over the selected window. Two measures of different
  // scale = two panels with one axis each (never a dual-axis chart). Weekly buckets once the
  // window is 3+ weeks (a single day is noisy — paperwork lag), daily below that. Single series
  // per panel, so the title carries identity and no legend is needed.
  const TrendCard = () => {
    const daily: any[] = (econ?.daily || [])
    const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null)
    if (hideMoney || daily.length < 7) return null
    const weekly = daily.length >= 21
    const keyOf = (d: string) => {
      if (!weekly) return d
      const dt = new Date(d + 'T12:00:00Z'); const dow = dt.getUTCDay()
      return new Date(dt.getTime() - dow * 864e5).toISOString().slice(0, 10)
    }
    const idx: Record<string, number> = {}
    const buckets: { label: string; cleans: number; fee: number; wages: number }[] = []
    for (const r of daily) {
      const k = keyOf(r.d)
      if (!(k in idx)) { idx[k] = buckets.length; buckets.push({ label: k, cleans: 0, fee: 0, wages: 0 }) }
      const b = buckets[idx[k]]
      b.cleans += r.cleans + (r.cleansByOthers || 0); b.fee += r.fee; b.wages += r.hkWages
    }
    const rows = buckets.filter(b => b.cleans > 0).map(b => ({
      label: b.label, cleans: b.cleans,
      cpc: Math.round((b.wages / b.cleans) * 100) / 100,
      marginPct: b.fee > 0 ? Math.round(((b.fee - b.wages) / b.fee) * 1000) / 10 : null,
      fee: Math.round(b.fee), wages: Math.round(b.wages),
    }))
    if (rows.length < 2) return null
    const H = 96, W = 100 / rows.length
    const Panel = ({ title, sub, val, fmtV, color }: { title: string; sub: string; val: (r: any) => number | null; fmtV: (n: number) => string; color: (v: number) => string }) => {
      const vals = rows.map(val).filter((v): v is number => v != null)
      if (!vals.length) return null
      const max = Math.max(...vals, 0), min = Math.min(...vals, 0)
      const span = max - min || 1
      const y = (v: number) => H - ((v - min) / span) * (H - 14)
      const zero = y(0)
      return (
        <div className="flex-1 min-w-[260px]">
          <p className="text-[11px] font-bold text-ink">{title} <span className="font-normal text-muted">· {sub}</span></p>
          <svg viewBox={`0 0 100 ${H + 16}`} preserveAspectRatio="none" className="w-full h-28 mt-1">
            <line x1="0" x2="100" y1={zero} y2={zero} stroke="#e5e7eb" strokeWidth="0.5" />
            {rows.map((r, i) => {
              const v = val(r)
              if (v == null) return null
              const yy = y(v)
              const top = Math.min(yy, zero), h = Math.max(1.5, Math.abs(zero - yy))
              return (
                <rect key={i} x={i * W + W * 0.18} width={W * 0.64} y={top} height={h} rx="1" fill={color(v)}
                  onMouseEnter={e => setTip({ x: (e as any).clientX, y: (e as any).clientY, lines: [(weekly ? 'wk of ' : '') + r.label.slice(5), `${fmtV(v)} · ${r.cleans} cleans`, `fees $${r.fee.toLocaleString()} · wages $${r.wages.toLocaleString()}`] })}
                  onMouseLeave={() => setTip(null)} />
              )
            })}
          </svg>
          <div className="flex justify-between text-[10px] text-muted tabular-nums">
            <span>{(weekly ? 'wk ' : '') + rows[0].label.slice(5)}</span>
            <span className="font-semibold text-ink">{(() => { const v = val(rows[rows.length - 1]); return v != null ? fmtV(v) + ' latest' : '' })()}</span>
            <span>{(weekly ? 'wk ' : '') + rows[rows.length - 1].label.slice(5)}</span>
          </div>
        </div>
      )
    }
    return (
      <div className="rounded-xl border border-line bg-white px-4 py-3 relative">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold mb-2" title={'Housekeepers only, engine numbers. Young buckets read expensive until cleans are closed in Breezeway — the latest ' + (weekly ? 'week' : 'days') + ' settle down as paperwork lands.'}>Trend <span className="normal-case font-normal">· {weekly ? 'by week' : 'by day'} · hover a bar</span></p>
        <div className="flex flex-wrap gap-6">
          <Panel title="Cost per turn" sub="HK wages ÷ turns · lower is better" val={r => r.cpc} fmtV={n => '$' + n.toFixed(0)} color={() => '#6366f1'} />
          <Panel title="HK margin %" sub="net fees kept after loaded wages" val={r => r.marginPct} fmtV={n => n.toFixed(0) + '%'} color={v => (v >= 0 ? '#059669' : '#e11d48')} />
        </div>
        {tip && (
          <div style={{ position: 'fixed', left: tip.x + 10, top: tip.y - 10, zIndex: 50 }} className="pointer-events-none rounded-lg border border-line bg-white shadow-md px-2.5 py-1.5">
            {tip.lines.map((l, i) => <div key={i} className={'text-[11px] ' + (i === 0 ? 'text-muted' : i === 1 ? 'font-semibold text-ink' : 'text-muted')}>{l}</div>)}
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="space-y-3">
      {/* ONE LINE: title, the Board|Dashboard switch (nav diet 2026-08-11 — one Labor nav entry, the
          dashboard is a tab here) and the window's headline numbers. Every pill's hover carries the
          detail the old "Payroll vs revenue" tile grid printed. */}
      <LeanHead title="Labor">
        <span className="inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line mr-1">
          <span className="text-[12px] font-semibold px-2.5 py-1 bg-ink text-white">Board</span>
          <Link href="/labor/dashboard" prefetch={false} className="text-[12px] font-semibold px-2.5 py-1 bg-white text-muted hover:bg-app">Dashboard</Link>
        </span>
        {d ? <>
          <Pill tone={bandTone === 'good' ? 'emerald' : bandTone === 'warn' ? 'amber' : bandTone === 'bad' ? 'rose' : 'slate'}
            title={'Labor % of revenue' + (pay.goalPct != null ? ' · goal ≤ ' + pay.goalPct + '%' : '') + (d.range ? ' · ' + d.range.start + ' → ' + d.range.end : '')}>
            {pay.laborPct != null ? pay.laborPct + '%' : '—'} labor
          </Pill>
          {hideMoney ? <>
            <Pill tone={pay.scheduledVsActualPct != null && pay.scheduledVsActualPct > 105 ? 'amber' : 'slate'} title="Payroll vs scheduled — 100% = spent what was planned">{pct(pay.scheduledVsActualPct)} vs sched</Pill>
            <Pill title="Vendor mix — share of cleaning revenue turned by vendors">{pct(pay.vendorMixPct)} vendor</Pill>
          </> : <>
            <Pill title={'Punches (Homebase clock only — salaries and the 17WEST credit are in the crew cards) · scheduled ' + fmt$(pay.scheduled)}>{fmt$(pay.actual)} punches</Pill>
            <Pill tone="brand" title={'In-house cleaning revenue, net of channel cut · vendor-cleaned units ' + fmt$(pay.revenueVendor ?? 0)}>{fmt$(pay.revenueInhouse ?? pay.revenue)} rev</Pill>
          </>}
          <Pill tone={(d.totalOvertimeHours ?? 0) > 0 ? 'amber' : 'slate'} title="Overtime hours in the window">{d.totalOvertimeHours ?? '—'}h OT</Pill>
          <Pill title={'Hours worked · ' + d.totalScheduledHours + ' scheduled'}>{d.totalActualHours ?? '—'}h</Pill>
        </> : null}
      </LeanHead>

      {/* window + market, one line */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1">
          {MARKETS.map(m => (
            <button key={m.k} onClick={() => setMarket(m.k)}
              className={'text-[12px] font-semibold px-2 py-1 rounded-lg border ' + (market === m.k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{m.l}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={pickToday}
            className={'text-[12px] font-semibold px-2 py-1 rounded-lg border ' + (from && from === to && from === todayISO() ? 'bg-ink text-white border-ink' : 'bg-white text-muted hover:text-ink border-line')}>Today</button>
          {PRESETS.map(p => (
            <button key={p.d} onClick={() => pickPreset(p.d)}
              className={'text-[12px] font-semibold px-2 py-1 rounded-lg ' + (!from && days === p.d ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{p.l}</button>
          ))}
          {/* iOS forces a focused field to 16px, and a 16px date does not fit in 112px — both
              pickers read "08/14…". On a phone they share the row and take what they need. */}
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From" aria-label="From"
            className="text-[12px] border border-line rounded-lg px-1 py-1 bg-white flex-1 min-w-[135px] sm:flex-none sm:w-[118px]" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} title="To" aria-label="To"
            className="text-[12px] border border-line rounded-lg px-1 py-1 bg-white flex-1 min-w-[135px] sm:flex-none sm:w-[118px]" />
          <IconBtn title="Reload the numbers" onClick={load}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></IconBtn>
        </div>
      </div>

      <LeanTabs
        tabs={[
          { key: 'overview' as const, label: 'Overview' },
          { key: 'costs' as const, label: 'Cost per clean' },
          { key: 'people' as const, label: 'People', n: people.length },
          { key: 'health' as const, label: 'Data health' },
        ]}
        value={tab} onChange={setTab} />

      {/* PAYROLL HOLES BANNER — on every tab, because every dollar below is a floor when it shows. */}
      {d && d.payrollComplete === false ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-[12.5px] text-rose-800"
          title="Payroll, cost per clean and margins are floors, not totals. Refresh in a minute — failed weeks are never cached.">
          <b>Homebase missed weeks</b>{d.payrollFailedWeeks?.length ? ': ' + d.payrollFailedWeeks.join(', ') : ''} — payroll figures are floors.
        </div>
      ) : null}

      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12.5px] text-rose-700">{err}</div>}
      {tab === 'overview' ? (<>
      {/* TODAY — in-day decisions, one line */}
      {tdy && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag tone="violet" title={'Right now · ' + tdy.date}>Now</Tag>
          <Pill tone="violet" title={tdy.clockedInNow.join(', ') || 'Nobody clocked in'}>{loading ? '…' : tdy.clockedInNow.length} clocked in</Pill>
          <Pill title="Hours so far today">{loading ? '…' : tdy.hoursSoFar}h so far</Pill>
          {hideMoney ? <>
            <Pill title="Labor % of today's cleaning revenue">{loading ? '…' : pct(tdy.laborPct)} labor</Pill>
            <Pill title="Vs scheduled — 100% = on plan">{loading ? '…' : pct(tdy.vsScheduledPct)} vs sched</Pill>
          </> : <>
            <Pill title={'Payroll so far today · scheduled ' + fmt$(tdy.scheduledPayroll)}>{loading ? '…' : fmt$(tdy.payrollSoFar)} payroll</Pill>
            <Pill tone="brand" title="Cleaning revenue today, net of channel cut">{loading ? '…' : fmt$(tdy.cleaningRevenueToday)} rev</Pill>
          </>}
          <Pill title="Breezeway tasks done today">{loading ? '…' : tdy.tasksDoneToday} done</Pill>
        </div>
      )}
      {/* TREND — the direction of cost/clean and margin across the selected window */}
      <TrendCard />
      {/* DEPARTMENTS: housekeeping economics + maintenance utilization */}
      {/* DEPARTMENT ECONOMICS — each crew judged on what it actually earns.
          Jon, 2026-08-12: housekeeping is housekeepers only; supervisors are their own category
          and are carried by management fees, not by the cleaning margin. */}
      {d?.departments && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl border border-line bg-white px-3 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Housekeeping <span className="normal-case font-normal">· housekeepers only</span></p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-3">
              {hideMoney ? <>
                <Stat label="Labor %" value={loading ? '…' : pct(d.departments.housekeeping.laborPct)} title="Of in-house cleaning revenue" />
                <Stat label="Margin %" value={loading ? '…' : pct(d.departments.housekeeping.marginPct)}
                  tone={d.departments.housekeeping.marginPct > 0 ? 'good' : 'bad'} />
                <Stat label="Share of payroll" value={loading ? '…' : pct(d.departments.housekeeping.payrollSharePct)} title="Of all payroll" />
                <Stat label="Cleans" value={loading ? '…' : String(d.departments.housekeeping.departureCleans ?? 0)} sub={(d.departments.housekeeping.otherHkTasks ?? 0) + ' other HK tasks'} />
                <Stat label="Hours" value={loading ? '…' : d.departments.housekeeping.hours + 'h'} sub={d.departments.housekeeping.people + ' people'} />
              </> : <>
                <Stat label="Cleaning revenue" value={loading ? '…' : fmt$(d.departments.housekeeping.revenue)} title="Net fees on every departure clean" />
                <Stat label="Payroll" value={loading ? '…' : fmt$(d.departments.housekeeping.payroll)} sub={d.departments.housekeeping.hours + 'h · ' + d.departments.housekeeping.people + ' housekeepers'} />
                <Stat label="Margin" value={loading ? '…' : fmt$(d.departments.housekeeping.margin)} tone={d.departments.housekeeping.margin > 0 ? 'good' : 'bad'} title="Fees − housekeeper wages" />
                <Stat label="Labor cost / clean" value={loading ? '…' : fmt$(d.departments.housekeeping.costPerClean)} sub={(d.departments.housekeeping.departureCleans ?? 0) + ' departure cleans'} />
                <Stat label="Time / clean" value={loading ? '…' : (d.departments.housekeeping.hoursPerClean != null ? d.departments.housekeeping.hoursPerClean + 'h' : '—')} title="Housekeeper hours ÷ cleans" />
                <Stat label="Fee / clean" value={loading ? '…' : fmt$(d.departments.housekeeping.feePerClean)} />
                <Stat label="Labor %" value={loading ? '…' : (d.departments.housekeeping.laborPct != null ? d.departments.housekeeping.laborPct + '%' : '—')} />
              </>}
            </div>
          </div>
          {/* Supervisors: overhead, and deliberately given no cleaning margin. What pays for them
              is the management fee on the stays they keep standards on. */}
          <div className="rounded-xl border border-line bg-white px-3 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Supervisors <span className="normal-case font-normal">· overhead</span></p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-3">
              <Stat label={hideMoney ? 'Share of payroll' : 'Payroll'}
                value={loading ? '…' : (hideMoney ? pct(d.departments.supervision?.payrollSharePct) : fmt$(d.departments.supervision?.payroll))}
                sub={(d.departments.supervision?.hours ?? 0) + 'h · ' + (d.departments.supervision?.people ?? 0) + ' people'} />
              {!hideMoney && <Stat label="Management fees" value={loading ? '…' : fmt$(d.departments.supervision?.managementFee)} title="Guesty commission in the window" />}
              <Stat label="% of mgmt fee" value={loading ? '…' : pct(d.departments.supervision?.coveragePct)}
                tone={(d.departments.supervision?.coveragePct ?? 0) < 100 ? 'good' : 'bad'} title="Supervisor cost ÷ management fees" />
              {/* Turns they covered. The FEE is housekeeping's (Jon, 2026-09-09), so this is not
                  their revenue — but a supervisor doing six turns a week is a staffing fact, and
                  the tile disappearing entirely was how it would have been missed. */}
              {(d.departments.supervision?.depCleans ?? 0) > 0 &&
                <Stat label="Cleans covered" value={loading ? '…' : String(d.departments.supervision?.depCleans ?? 0)}
                  sub={hideMoney ? 'turns they did themselves' : fmt$(d.departments.supervision?.cleanFeesToHk) + ' credited to housekeeping'} />}
              <Stat label="Team" value={loading ? '…' : String((d.departments.supervision?.names || []).length)} sub={(d.departments.supervision?.names || []).join(', ') || '—'} />
            </div>
          </div>
          <div className="rounded-xl border border-line bg-white px-3 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Maintenance</p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-3">
              {/* Payroll is Homebase, hours are Breezeway, billable is the charge typed on the
                  task — each tile says which, so no two are read as the same number. */}
              <Stat label={hideMoney ? 'Share of payroll' : 'Payroll'}
                value={loading ? '…' : (hideMoney ? pct(d.departments.maintenance.payrollSharePct) : fmt$(d.departments.maintenance.payroll))}
                sub={(d.departments.maintenance.clockedHours ?? 0) + 'h clocked · ' + d.departments.maintenance.people + ' people'} />
              {!hideMoney && <Stat label="Billable" value={loading ? '…' : fmt$(d.departments.maintenance.billableRevenue)} sub={(d.departments.maintenance.billableTasks ?? 0) + ' charged'} />}
              {(d.departments.maintenance.depCleans ?? 0) > 0 &&
                <Stat label="Cleans covered" value={loading ? '…' : String(d.departments.maintenance.depCleans ?? 0)}
                  sub={hideMoney ? 'turns they did themselves' : fmt$(d.departments.maintenance.cleanFeesToHk) + ' credited to housekeeping'} />}
              {!hideMoney && <Stat label="Margin" value={loading ? '…' : fmt$(d.departments.maintenance.margin)} tone={(d.departments.maintenance.margin ?? 0) > 0 ? 'good' : 'bad'} title="Billable charges − wages" />}
              <Stat label="Billable vs wages" value={loading ? '…' : pct(d.departments.maintenance.billableCoveragePct)}
                tone={d.departments.maintenance.billableCoveragePct != null ? (d.departments.maintenance.billableCoveragePct >= 100 ? 'good' : 'bad') : undefined} />
              <Stat label="Hours on tasks" value={loading ? '…' : (d.departments.maintenance.hours ?? 0) + 'h'}
                sub={(d.departments.maintenance.tasksCompleted ?? 0) + ' tasks · Breezeway'} />
              <Stat label="On-task %" value={loading ? '…' : (d.departments.maintenance.utilizationPct != null ? d.departments.maintenance.utilizationPct + '%' : '—')} title="Breezeway ÷ Homebase hours" />
              {/* Not a rounding error — a finished task with nothing in the cost field earns $0. */}
              <Stat label="No charge entered" value={loading ? '…' : String(d.departments.maintenance.tasksNoCharge ?? 0)}
                tone={(d.departments.maintenance.tasksNoCharge ?? 0) > 0 ? 'warn' : undefined} title="Finished, nothing billed — a task with nothing in the cost field earns $0" />
            </div>
          </div>
          {/* VENDOR CLEANS — their own section (Jon, 2026-08-21). They used to hang off the
              housekeeping card, which invited reading vendor revenue as part of our crew's margin.
              A vendor turn costs us no Homebase hour, so it has no cost per clean and says so. */}
          {(() => {
            const vb = (econ?.buckets || []).filter((b: any) => b && b.inHouse === false)[0]
            const vendorRev = vb?.cleaningRevenue ?? d.departments.housekeeping?.vendorRevenue ?? 0
            const vendorCleans = vb?.cleans ?? 0
            if (!vendorRev && !vendorCleans) return null
            return (
              <div className="rounded-xl border border-line bg-white px-3 py-4">
                <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3" title="Kept out of the housekeeping margin and out of cost per clean — otherwise a vendor turn makes our own crew look cheaper than it is.">Vendor cleans <span className="normal-case font-normal">· not our labor</span></p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                  {!hideMoney && <Stat label="Cleaning revenue" value={loading ? '…' : fmt$(vendorRev)} sub="vendor-cleaned units" />}
                  <Stat label="Cleans" value={loading ? '…' : String(vendorCleans || '—')} sub="turned by a vendor" />
                  {!hideMoney && vendorCleans > 0 && <Stat label="Fee / clean" value={loading ? '…' : fmt$(vb?.feePerClean)} />}
                  <Stat label="Our hours" value={loading ? '…' : '0h'} title="No Homebase cost against these" />
                </div>
              </div>
            )
          })()}
          <div className="rounded-xl border border-line bg-white px-3 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Inspections</p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-3">
              <Stat label={hideMoney ? 'Share of payroll' : 'Payroll'}
                value={loading ? '…' : (hideMoney ? pct(d.departments.inspection?.payrollSharePct) : fmt$(d.departments.inspection?.payroll))}
                sub={(d.departments.inspection?.hours ?? 0) + 'h · ' + (d.departments.inspection?.people ?? 0) + ' people'} />
              <Stat label="Inspections" value={loading ? '…' : String(d.departments.inspection?.inspections ?? 0)} />
              {!hideMoney && <Stat label="Cost / inspection" value={loading ? '…' : fmt$(d.departments.inspection?.costPerInspection)} />}
            </div>
          </div>
        </div>
      )}
      {/* WEEK BY WEEK — the trend Jon asked for: cleans against the hours and payroll that turned
          them, revenue and HK payroll leading. Its own endpoint so the board is not held up by it. */}
      {/* LABOR BY DAY, BY CREW (Jon, 2026-09-21: "HK alone, Supervisor alone, Maintenance alone vs
          billable labor recorded for the day"). Hours per turn is HK-only; supervisors and
          maintenance are paid hours against the charges the team entered. One engine run. */}
      <LaborDays market={market} />
      <LaborWeekly market={market} />
      {/* PER PERSON, BY CREW (Jon, 2026-09-09: "rev per team member vs payroll broken by
          departments"). The honest part is the blank column: a supervisor and a coordinator earn
          no revenue of their own — every dollar they touch was counted on somebody else's line —
          so they are shown as what they cost against the management fee instead of being handed a
          share of housekeeping's takings. A number that is missing for a stated reason is worth
          more than one that moves when the cleaners have a good week. */}
      {kpi && (kpi as any).perHead && (
        <div className="rounded-xl border border-line bg-white px-3 py-4">
          <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-2 flex items-center gap-1" title={String((kpi as any).perHead.basis || '')}>
            <Users size={11} /> Per person, by crew
          </p>
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-[12px]">
            <thead className="text-[10px] uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="text-left font-semibold py-1.5 pr-2">Crew</th>
                <th className="text-right font-semibold py-1.5 px-2">People</th>
                <th className="text-right font-semibold py-1.5 px-2">Payroll</th>
                <th className="text-right font-semibold py-1.5 px-2">Payroll / person</th>
                <th className="text-right font-semibold py-1.5 px-2">Revenue</th>
                <th className="text-right font-semibold py-1.5 px-2">Revenue / person</th>
                <th className="text-right font-semibold py-1.5 pl-2">Per $1 of wages</th>
              </tr>
            </thead>
            <tbody>
              {((kpi as any).perHead.rows || []).map((r: any) => (
                <tr key={r.dept} className="border-b border-line/60">
                  <td className="py-2 pr-2">
                    <b>{r.label}</b>
                    {!r.attributable && <div className="text-[10.5px] text-muted">{r.note}</div>}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{r.people}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmt$(r.payroll)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmt$(r.payrollPerPerson)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {r.attributable ? fmt$(r.revenue)
                      : <span className="text-muted">{r.pctOfManagementFee != null ? r.pctOfManagementFee + '% of the mgmt fee' : 'no revenue of its own'}</span>}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{r.attributable ? fmt$(r.revenuePerPerson) : <span className="text-muted">—</span>}</td>
                  <td className={'py-2 pl-2 text-right tabular-nums font-semibold ' + (r.revenuePerPayrollDollar == null ? 'text-muted' : r.revenuePerPayrollDollar >= 1 ? 'text-emerald-700' : 'text-rose-700')}>
                    {r.revenuePerPayrollDollar != null ? '$' + Number(r.revenuePerPayrollDollar).toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink/60">
                <td className="py-2 pr-2" title="Overhead included — what the whole payroll brings back per head"><b>Everyone</b></td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold">{(kpi as any).perHead.total.people}</td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmt$((kpi as any).perHead.total.payroll)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt$((kpi as any).perHead.total.payrollPerPerson)}</td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmt$((kpi as any).perHead.total.revenue)}</td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmt$((kpi as any).perHead.total.revenuePerPerson)}</td>
                <td className={'py-2 pl-2 text-right tabular-nums font-semibold ' + (((kpi as any).perHead.total.revenuePerPayrollDollar ?? 0) >= 1 ? 'text-emerald-700' : 'text-rose-700')}>
                  {(kpi as any).perHead.total.revenuePerPayrollDollar != null ? '$' + Number((kpi as any).perHead.total.revenuePerPayrollDollar).toFixed(2) : '—'}
                </td>
              </tr>
            </tbody>
          </table></div>
        </div>
      )}
      {/* TASKS — Breezeway completions, one line */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Tag title="Tasks completed in Breezeway in this window">Tasks done</Tag>
        <Pill>{loading ? '…' : tasks.total ?? 0} total</Pill>
        <Pill>{loading ? '…' : tasks.clean ?? 0} cleans</Pill>
        <Pill>{loading ? '…' : tasks.inspection ?? 0} inspections</Pill>
        <Pill>{loading ? '…' : tasks.maintenance ?? 0} maintenance</Pill>
        <Pill>{loading ? '…' : tasks.other ?? 0} other</Pill>
      </div>
      </>) : null}
      {tab === 'costs' ? (<>
      {/* COST PER CLEAN — BY CREW, BY MARKET. The same grid the Daily Labor email leads with,
          served live: one denominator (departure cleans done in the market) for all three crews,
          so the rows always sum to the combined line. */}
      {pnl?.perClean?.markets?.length ? (
        <div className="rounded-xl border border-line bg-white px-4 py-4">
          <div className="text-[13px] font-bold text-ink mb-2">Cost per clean — by crew, by market <span className="font-semibold text-muted text-[11px]">· every row ÷ that market's departure cleans</span></div>
          <div className="lh-hscroll"><table className="w-full text-[12.5px] min-w-[560px]">
            <thead><tr className="text-left text-muted">
              <th className="py-1.5 pr-2 font-semibold">Crew</th>
              {[...pnl.perClean.markets, pnl.perClean.total].map((m: any, i: number) => (
                <th key={m.key} className={'py-1.5 px-2 text-right font-semibold ' + (i === pnl.perClean.markets.length ? 'border-l border-line' : '')}>{i === pnl.perClean.markets.length ? 'Combined' : m.label}</th>
              ))}
            </tr></thead>
            <tbody>
              {([['housekeeping', 'Housekeepers', 'true unit cost — wages spent turning units'], ['supervision', 'Supervisors', 'allocated by where their tasks were'], ['maintenance', 'Maintenance', 'allocated by task share · earns its own billables']] as const).map(([k, label, sub]) => (
                <tr key={k} className="border-t border-line/70">
                  <td className="py-2 pr-2"><b>{label}</b><div className="text-[10.5px] text-muted">{sub}</div></td>
                  {[...pnl.perClean.markets, pnl.perClean.total].map((m: any, i: number) => (
                    <td key={m.key} className={'py-2 px-2 text-right tabular-nums ' + (i === pnl.perClean.markets.length ? 'border-l border-line' : '')}>
                      {m[k]?.perClean != null ? (<><b>{'$' + Number(m[k].perClean).toFixed(2)}</b><div className="text-[10.5px] text-muted">{fmt$(m[k].payroll)}{m[k].hours ? ' · ' + Math.round(m[k].hours) + 'h' : ''}</div></>) : <span className="text-muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-ink/60">
                <td className="py-2 pr-2"><b>All three crews</b><div className="text-[10.5px] text-muted">what a turn really costs in payroll</div></td>
                {[...pnl.perClean.markets, pnl.perClean.total].map((m: any, i: number) => (
                  <td key={m.key} className={'py-2 px-2 text-right tabular-nums ' + (i === pnl.perClean.markets.length ? 'border-l border-line' : '')}>
                    {m.all?.perClean != null ? (<><b className="text-[14px]">{'$' + Number(m.all.perClean).toFixed(2)}</b><div className="text-[10.5px] text-muted">{fmt$(m.all.payroll)}</div></>) : <span className="text-muted">—</span>}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-line/70 text-muted">
                <td className="py-1.5 pr-2">Departure cleans</td>
                {[...pnl.perClean.markets, pnl.perClean.total].map((m: any, i: number) => (
                  <td key={m.key} className={'py-1.5 px-2 text-right tabular-nums font-semibold ' + (i === pnl.perClean.markets.length ? 'border-l border-line' : '')}>{m.cleans || 0}</td>
                ))}
              </tr>
            </tbody>
          </table></div>
        </div>
      ) : null}
      {/* THE SIMPLE P&L (Jon, 2026-08-26: "Something just feels off about labor... keep it simple
          and just make sure that this is extremely accurate"). Housekeeping and maintenance, by
          market and in total, on one allocation rule, with the reconciliation shown rather than
          claimed and the people bending cost per clean named instead of blended away. */}
      {pnl && (
        <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-[13px] font-bold text-ink">Labor P&amp;L</h3>
            <p className="text-[11px] text-muted mt-0.5 max-w-[86ch] line-clamp-1" title={String(pnl.basis || '')}>{pnl.basis}</p>
          </div>

          {/* housekeeping */}
          <div className="px-4 pb-1">
            <p className="text-[10px] uppercase tracking-[0.14em] text-brand-600 font-bold mt-2 mb-1">Housekeeping</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted border-b border-line">
                    <th className="text-left font-semibold py-1.5 pr-2">Market</th>
                    <th className="text-right font-semibold py-1.5 px-2">Staff</th>
                    <th className="text-right font-semibold py-1.5 px-2">Hours</th>
                    <th className="text-right font-semibold py-1.5 px-2">Payroll</th>
                    <th className="text-right font-semibold py-1.5 px-2">Cleans</th>
                    <th className="text-right font-semibold py-1.5 px-2">Hrs / clean</th>
                    <th className="text-right font-semibold py-1.5 px-2">Cost / clean</th>
                    <th className="text-right font-semibold py-1.5 px-2">Revenue</th>
                    <th className="text-right font-semibold py-1.5 px-2">Profit</th>
                    <th className="text-right font-semibold py-1.5 pl-2">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {(pnl.housekeeping?.markets || []).map((r: any) => (
                    <tr key={r.key} className="border-b border-line/60">
                      <td className="text-left py-1.5 pr-2 font-semibold text-ink">{r.label}</td>
                      <td className="text-right py-1.5 px-2 text-muted">{r.people}</td>
                      <td className="text-right py-1.5 px-2">{Math.round(r.hours).toLocaleString('en-US')}</td>
                      <td className="text-right py-1.5 px-2">{fmt$(r.payroll)}</td>
                      <td className="text-right py-1.5 px-2">{r.cleans}</td>
                      <td className="text-right py-1.5 px-2">{r.hoursPerClean ?? '—'}</td>
                      <td className="text-right py-1.5 px-2 font-bold text-ink">{fmt$(r.costPerClean)}</td>
                      <td className="text-right py-1.5 px-2">{fmt$(r.revenue)}</td>
                      <td className={'text-right py-1.5 px-2 font-semibold ' + (r.profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{fmt$(r.profit)}</td>
                      <td className={'text-right py-1.5 pl-2 ' + (r.profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{pct(r.marginPct)}</td>
                    </tr>
                  ))}
                  {pnl.housekeeping?.total && (
                    <tr className="bg-app/60">
                      <td className="text-left py-2 pr-2 font-black text-ink">{pnl.housekeeping.total.label}</td>
                      <td className="text-right py-2 px-2 font-semibold">{pnl.housekeeping.total.people}</td>
                      <td className="text-right py-2 px-2 font-semibold">{Math.round(pnl.housekeeping.total.hours).toLocaleString('en-US')}</td>
                      <td className="text-right py-2 px-2 font-semibold">{fmt$(pnl.housekeeping.total.payroll)}</td>
                      <td className="text-right py-2 px-2 font-semibold">{pnl.housekeeping.total.cleans}</td>
                      <td className="text-right py-2 px-2 font-semibold">{pnl.housekeeping.total.hoursPerClean ?? '—'}</td>
                      <td className="text-right py-2 px-2 font-black text-ink">{fmt$(pnl.housekeeping.total.costPerClean)}</td>
                      <td className="text-right py-2 px-2 font-semibold">{fmt$(pnl.housekeeping.total.revenue)}</td>
                      <td className={'text-right py-2 px-2 font-black ' + (pnl.housekeeping.total.profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{fmt$(pnl.housekeeping.total.profit)}</td>
                      <td className={'text-right py-2 pl-2 font-black ' + (pnl.housekeeping.total.profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{pct(pnl.housekeeping.total.marginPct)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* who is bending cost per clean */}
          {pnl.lowYield?.people?.length > 0 && (
            <div className="mx-4 my-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
              title="Either they belong on another crew, or this is real housekeeping work that earns nothing — both are worth knowing, and neither should be averaged in silently.">
              <p className="text-[11.5px] text-amber-900">
                <b>{fmt$(pnl.lowYield.payroll)}</b> of housekeeping payroll ({pct(pnl.lowYield.pctOfPayroll)}) and{' '}
                <b>{Math.round(pnl.lowYield.hours)}</b> hours belong to {pnl.lowYield.people.length} {pnl.lowYield.people.length === 1 ? 'person who turned' : 'people who turned'}{' '}
                {pnl.lowYield.cleans === 0 ? 'no units' : pnl.lowYield.cleans + (pnl.lowYield.cleans === 1 ? ' unit' : ' units')} in this window.
                They are inside the cost per clean above; without them it reads <b>{fmt$(pnl.lowYield.costPerCleanExcluding)}</b>.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {pnl.lowYield.people.map((p: any) => (
                  <span key={p.name} className="text-[10.5px] rounded-full bg-white border border-amber-300 px-2 py-0.5 text-amber-800">
                    {p.name} · {Math.round(p.hours)}h · {fmt$(p.payroll)} · {p.cleans} clean{p.cleans === 1 ? '' : 's'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* maintenance */}
          <div className="px-4 pb-1">
            <p className="text-[10px] uppercase tracking-[0.14em] text-brand-600 font-bold mt-2 mb-1">Maintenance</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted border-b border-line">
                    <th className="text-left font-semibold py-1.5 pr-2">Market</th>
                    <th className="text-right font-semibold py-1.5 px-2">Staff</th>
                    <th className="text-right font-semibold py-1.5 px-2">Hours</th>
                    <th className="text-right font-semibold py-1.5 px-2">Payroll</th>
                    <th className="text-right font-semibold py-1.5 px-2">Billable rev</th>
                    <th className="text-right font-semibold py-1.5 px-2">Profit</th>
                    <th className="text-right font-semibold py-1.5 px-2">Margin</th>
                    <th className="text-right font-semibold py-1.5 pl-2">Tasks priced</th>
                  </tr>
                </thead>
                <tbody>
                  {(pnl.maintenance?.markets || []).map((r: any) => (
                    <tr key={r.key} className="border-b border-line/60">
                      <td className="text-left py-1.5 pr-2 font-semibold text-ink">{r.label}</td>
                      <td className="text-right py-1.5 px-2 text-muted">{r.people}</td>
                      <td className="text-right py-1.5 px-2">{Math.round(r.hours).toLocaleString('en-US')}</td>
                      <td className="text-right py-1.5 px-2">{fmt$(r.payroll)}</td>
                      <td className="text-right py-1.5 px-2">{fmt$(r.revenue)}</td>
                      <td className={'text-right py-1.5 px-2 font-semibold ' + (r.profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{fmt$(r.profit)}</td>
                      <td className={'text-right py-1.5 px-2 ' + (r.profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{pct(r.marginPct)}</td>
                      <td className="text-right py-1.5 pl-2 text-muted">{r.tasksBilled}/{r.tasks}</td>
                    </tr>
                  ))}
                  {pnl.maintenance?.total && (
                    <tr className="bg-app/60">
                      <td className="text-left py-2 pr-2 font-black text-ink">{pnl.maintenance.total.label}</td>
                      <td className="text-right py-2 px-2 font-semibold">{pnl.maintenance.total.people}</td>
                      <td className="text-right py-2 px-2 font-semibold">{Math.round(pnl.maintenance.total.hours).toLocaleString('en-US')}</td>
                      <td className="text-right py-2 px-2 font-semibold">{fmt$(pnl.maintenance.total.payroll)}</td>
                      <td className="text-right py-2 px-2 font-semibold">{fmt$(pnl.maintenance.total.revenue)}</td>
                      <td className={'text-right py-2 px-2 font-black ' + (pnl.maintenance.total.profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{fmt$(pnl.maintenance.total.profit)}</td>
                      <td className={'text-right py-2 px-2 font-black ' + (pnl.maintenance.total.profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{pct(pnl.maintenance.total.marginPct)}</td>
                      <td className="text-right py-2 pl-2 font-semibold">{pnl.maintenance.total.tasksBilled}/{pnl.maintenance.total.tasks}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* the maintenance margin, explained by the thing that causes it */}
          {pnl.quality?.maintUnpricedPct > 0 && (
            <div className="mx-4 my-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[11.5px] text-amber-900">
                <b>{pnl.quality.maintTasksNoCharge} of {pnl.quality.maintTasks} maintenance tasks ({pct(pnl.quality.maintUnpricedPct)}) have no charge entered</b>
                {' '}— the margin above is what we billed, not what we did.
              </p>
            </div>
          )}

          {/* what would make these numbers wrong */}
          <div className="mx-4 mb-4 rounded-xl border border-line bg-app/50 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted font-bold mb-1.5">What could still be wrong</p>
            <ul className="text-[11.5px] text-body space-y-1">
              <li>
                {pnl.reconciles?.housekeeping?.payrollDelta === 0 && pnl.reconciles?.maintenance?.payrollDelta === 0
                  ? <span className="text-emerald-700">✓ Markets add to the totals exactly — payroll, hours and cleans all reconcile to zero.</span>
                  : <span className="text-rose-600">Markets do not add to the totals — HK payroll off by {fmt$(pnl.reconciles?.housekeeping?.payrollDelta)}, maintenance off by {fmt$(pnl.reconciles?.maintenance?.payrollDelta)}.</span>}
              </li>
              <li>
                {pnl.quality?.payrollComplete
                  ? <span className="text-emerald-700">✓ Every Homebase week in this window came back — payroll is complete.</span>
                  : <span className="text-rose-600">Homebase failed for {(pnl.quality?.failedWeeks || []).join(', ')} — every payroll figure above is understated.</span>}
              </li>
              {(pnl.quality?.rateOutliers || []).length > 0 && (
                <li className="text-amber-800">
                  {pnl.quality.rateOutliers.map((r: any) => `${r.name} reads $${r.impliedRate}/hr against ${Math.round(r.hours)} hours`).join('; ')} — far under everyone else, so their wage data is probably incomplete and their crew&apos;s payroll is understated.
                </li>
              )}
              {(pnl.quality?.workedNoPay || []).length > 0 && (
                <li className="text-amber-800">
                  {pnl.quality.workedNoPay.map((r: any) => `${r.name} turned ${r.cleans} unit${r.cleans === 1 ? '' : 's'} with no Homebase hours at all`).join('; ')} — those cleans are in the denominator with no wages behind them, which pulls cost per clean down.
                </li>
              )}
              {pnl.quality?.cleansNoAssignee > 0 && (
                <li className="text-amber-800">
                  {pnl.quality.cleansNoAssignee} departure cleans have nobody assigned in Breezeway, so they cannot be counted or credited to anyone.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
      </>) : null}
      {tab === 'people' ? (<>
      {/* flags — one line of tags, the names in each tag's hover */}
      {!!hasFlags && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <AlertTriangle size={14} className="text-amber-600" />
          {flags.overtimeRisk.length > 0 && <Tag tone="rose" title={'OT risk this workweek: ' + flags.overtimeRisk.join(', ')}>{flags.overtimeRisk.length} OT risk</Tag>}
          {flags.noShows.length > 0 && <Tag tone="amber" title={'Scheduled, never clocked in: ' + flags.noShows.map((n: any) => n.name + ' (' + String(n.date).slice(5) + ')').join(', ')}>{flags.noShows.length} no-show{flags.noShows.length === 1 ? '' : 's'}</Tag>}
          {flags.stillClockedIn.length > 0 && <Tag tone="amber" title={'Open timecards: ' + flags.stillClockedIn.join(', ')}>{flags.stillClockedIn.length} open card{flags.stillClockedIn.length === 1 ? '' : 's'}</Tag>}
        </div>
      )}
      {/* PEOPLE — one row each: crew, hours, payroll and the flags as tags; open a row for the full
          ledger line and their days (Breezeway tasks + the engine's per-day P&L). */}
      <LeanSection title="People" n={people.length} right="open a row for their days">
        {!people.length ? <LeanEmpty>{loading ? 'Loading…' : 'No Homebase data in this range.'}</LeanEmpty> : (
          <LeanList>
            {people.map((p: any) => {
              const e = econBy[p.name]
              const payroll = e?.agencyLoad > 0 ? fmt$(e.payroll) : (p.laborCost != null ? fmt$(p.laborCost) : '—')
              const cleanRev = e?.cleaningRevenue ? fmt$(e.cleaningRevenue)
                : e?.cleanFeesToHk > 0 ? '(' + fmt$(e.cleanFeesToHk) + ')'
                  : ((d as any)?.personRevenue?.[p.name] != null ? fmt$((d as any).personRevenue[p.name]) : '—')
              const nTasks = (personTasks[p.name] || []).length
              return (
                <LeanRow key={p.name} name={p.name}
                  open={open === p.name} onToggle={() => setOpen(open === p.name ? '' : p.name)}
                  meta={(DEPT_SHORT[e?.dept] || '—') + ' · ' + p.actualHours + 'h of ' + p.scheduledHours + (hideMoney ? '' : ' · ' + payroll)}
                  tags={<>
                    {p.overtimeHours > 0 ? <Tag tone="rose" title="Overtime hours in the window">{p.overtimeHours}h OT</Tag> : null}
                    {p.overtimeRisk ? <Tag tone="rose" title={'Projected ' + p.projectedWeekHours + 'h this workweek'}>OT risk</Tag> : null}
                    {p.openTimecard ? <Tag tone="emerald" title="Clocked in right now">on shift</Tag> : null}
                    {!p.openTimecard && p.missedClockOuts && p.missedClockOuts.length > 0 ? (
                      <Tag tone="amber" title={'Clocked in on ' + p.missedClockOuts.join(', ') + ' and never clocked out — their hours and cost are understated until the card is closed'}>
                        no clock-out{p.missedClockOuts.length > 1 ? ' ×' + p.missedClockOuts.length : ''}</Tag>
                    ) : null}
                    {e ? <Tag tone={e.agency ? 'violet' : 'slate'} title="Employment: W-2 or the agency they come through">{e.agencyLabel || 'W-2'}</Tag> : null}
                    {e && !e.declared ? <Tag tone="amber" title="Crew inferred from their work — name them on the roster to lock it in">crew?</Tag> : null}
                    {!hideMoney && e ? <Tag tone={e.margin >= 0 ? 'emerald' : 'rose'} title="Margin: fees + billables − loaded wages">{fmt$(e.margin)}</Tag> : null}
                  </>}>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted tabular-nums">
                    <span>Sched <b className="text-ink">{p.scheduledHours}h</b></span>
                    <span>Actual <b className="text-ink">{p.actualHours}h</b></span>
                    <span>OT <b className={p.overtimeHours > 0 ? 'text-rose-700' : 'text-ink'}>{p.overtimeHours || '—'}</b></span>
                    {!hideMoney && <>
                      <span>$/hr <b className="text-ink">{(p as any).wageRate != null ? '$' + (p as any).wageRate : '—'}</b></span>
                      <span title={e?.agencyLoad > 0 ? 'Homebase wages ' + fmt$(e.wagesHomebase) + ' + agency markup ' + fmt$(e.agencyLoad) : undefined}>Payroll <b className="text-ink">{payroll}</b>{e?.agencyLoad > 0 ? <span className="text-indigo-600">*</span> : null}</span>
                      <span title={e?.cleanFeesToHk > 0 ? fmt$(e.cleanFeesToHk) + ' on ' + e.depCleans + ' turns they covered — credited to housekeeping, not to them' : undefined}>Cleaning rev <b className="text-ink">{cleanRev}</b></span>
                      <span>Billable <b className="text-ink">{e?.billableRevenue ? fmt$(e.billableRevenue) : '—'}</b></span>
                      <span>Margin <b className={!e ? 'text-muted' : e.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{e ? fmt$(e.margin) : '—'}</b></span>
                    </>}
                    <span>Tasks <b className="text-ink">{nTasks || '—'}</b></span>
                    <span>Wk proj <b className={p.overtimeRisk ? 'text-rose-700' : 'text-ink'}>{p.projectedWeekHours}h</b></span>
                  </div>
                  {/* W-2 vs agency, what sizes they turned, and building hops (Jon, 2026-08-22). */}
                  {e && (e.cleans > 0 || roomMixTxt(e.roomMix) || e.travel) ? (
                    <div className="text-[11.5px] text-muted">
                      {e.cleans > 0 && <span className="font-semibold text-ink">{e.cleans} clean{e.cleans === 1 ? '' : 's'}</span>}
                      {e.cleans > 0 && roomMixTxt(e.roomMix) ? ' · ' : ''}
                      {roomMixTxt(e.roomMix)}
                      {e.travel ? <span> · {e.travel.hops} building hop{e.travel.hops === 1 ? '' : 's'} ≈ {e.travel.minutes}m travel</span> : null}
                    </div>
                  ) : null}
                  <div className="-mx-3 sm:-mx-4 rounded-lg overflow-hidden"><TaskList name={p.name} /></div>
                </LeanRow>
              )
            })}
          </LeanList>
        )}
      </LeanSection>
      </>) : null}
      {tab === 'health' ? (<>
      {/* THE ROSTER HOLES, PRICED. Both blocks come from lib/labor-econ and are computed across
          every market, so the number does not move with the tab. Named, not hinted at: a gap you
          can see beats a number quietly filled in. */}
      {(econ?.unrostered?.people > 0 || econ?.unassignedMarket?.people > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 space-y-2">
          {econ?.unrostered?.people > 0 && (
            <p className="text-[12.5px] text-amber-900 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                <b>{econ.unrostered.people} on payroll are on nobody&apos;s crew</b> — {econ.unrostered.hours}h
                {!hideMoney && <> and {fmt$(econ.unrostered.payroll)} of wages</> } sitting in Other instead of a margin:{' '}
                <span className="font-medium">{(econ.unrostered.names || []).join(', ')}</span>.{' '}
                <a href="/users?tab=settings" className="underline font-semibold">Place them in Crew &amp; roles →</a>
              </span>
            </p>
          )}
          {econ?.unassignedMarket?.people > 0 && (
            <p className="text-[12.5px] text-amber-900 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                <b>{econ.unassignedMarket.people} on payroll have no area set</b> — {econ.unassignedMarket.hours}h
                {!hideMoney && <> and {fmt$(econ.unassignedMarket.payroll)} of wages</> } left out of <em>every</em> market tab
                rather than counted on all of them:{' '}
                <span className="font-medium">{(econ.unassignedMarket.names || []).join(', ')}</span>.{' '}
                <a href="/users?tab=settings" className="underline font-semibold">Set their area in Staffing →</a>
              </span>
            </p>
          )}
        </div>
      )}
      {/* THE TRUE-UP — where every dollar landed (Jon, 2026-08-21: "the labor mecca... it should
          be a true up"). The board is only trustworthy if the reader can see what the engine did
          with every fee and every payroll week: what was credited, what sits on unclosed paperwork
          (and will settle), what never matched, what the OTA took, what got rebuilt on Expedia,
          and what 17WEST covers. Pick any window above — this trues up with it. */}
      {!hideMoney && econ?.feeAudit && (
        <div className="rounded-xl border border-line bg-white px-3 py-4">
          <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3" title="Re-checked on every load">
            True-up · where every cleaning fee landed <span className="normal-case font-normal">· {d?.range ? `${d.range.start} → ${d.range.end}` : ''}</span>
          </p>
          {econ?.payrollAudit && !econ.payrollAudit.complete && (
            <div className="mx-2 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 font-semibold">
              Homebase did not return timecards for: {econ.payrollAudit.failedWeeks.join(', ')} — every payroll-based number on this page is understated until it does. Refresh in a minute.
            </div>
          )}
          <div className="px-2 overflow-x-auto">
            <table className="w-full text-sm max-w-2xl">
              <tbody>
                <tr className="border-t border-line"><td className="py-1.5 pr-3">Credited to a housekeeper <span className="text-[10px] text-muted">clean closed, person named — in the margins above</span></td>
                  <td className="py-1.5 text-right font-medium text-emerald-700">{fmt$(econ.feeAudit.credited)}</td></tr>
                <tr className="border-t border-line"><td className="py-1.5 pr-3">On cleans not yet closed in Breezeway <span className="text-[10px] text-muted">work almost certainly done — settles into the row above as paperwork lands</span></td>
                  <td className="py-1.5 text-right font-medium text-amber-700">{fmt$(econ.feeAudit.cleanNotClosed)}</td></tr>
                <tr className="border-t border-line"><td className="py-1.5 pr-3">Clean closed with no assignee <span className="text-[10px] text-muted">nobody to credit — name assignees in Breezeway</span></td>
                  <td className="py-1.5 text-right">{fmt$(econ.feeAudit.cleanNoAssignee)}</td></tr>
                <tr className="border-t border-line"><td className="py-1.5 pr-3">No clean found for the checkout <span className="text-[10px] text-muted">searched 2 days before to 7 after</span></td>
                  <td className="py-1.5 text-right text-red-600">{fmt$(econ.feeAudit.noCleanFound)}</td></tr>
              </tbody>
            </table>
          </div>
          <details className="px-2 mt-3">
          <summary className="text-[12px] font-semibold text-muted cursor-pointer hover:text-ink">How the fees and wages were adjusted</summary>
          <div className="mt-1.5 space-y-1 text-[11.5px] text-muted">
            {econ.feeAudit.movedCleansMatched > 0 && (
              <p>{econ.feeAudit.movedCleansMatched} moved clean{econ.feeAudit.movedCleansMatched === 1 ? '' : 's'} matched to a nearby day — a rescheduled clean keeps its fee.</p>
            )}
            {econ?.kpi?.housekeeping?.channelCut > 0 && (
              <p>Channel cut: guests paid {fmt$(econ.kpi.housekeeping.revenueGross)} in cleaning fees; the OTAs kept {fmt$(econ.kpi.housekeeping.channelCut)} — every number above is the net.</p>
            )}
            {econ?.bundledFeeBackfill?.checkouts > 0 && (
              <p>Expedia bundles the cleaning fee into the fare on {econ.bundledFeeBackfill.checkouts} checkout{econ.bundledFeeBackfill.checkouts === 1 ? '' : 's'} here — {fmt$(econ.bundledFeeBackfill.amount)} rebuilt from each unit&apos;s own non-Expedia fee and moved out of the fare, never invented.</p>
            )}
            {econ?.kpi?.agencyLoad?.total > 0 && (
              <p>Agency markup — {econ.kpi.agencyLoad.byAgency.map((a: any) => `${a.label}: ${fmt$(a.load)} on ${fmt$(a.wages)} wages (${a.people} people)`).join(' · ')} — already inside every payroll line and cost per clean above.</p>
            )}
            {econ?.kpi?.management?.salaryWindow > 0 && (
              <p>Management (salaried) — {econ.kpi.management.people.map((m: any) => `${m.name} $${(m.annual / 1000).toFixed(0)}k/yr → ${fmt$(m.windowSalary)} this window`).join(' · ')} — the salary IS the cost; punches are shown for comparison and never charged. Each salary sits inside its own crew, so it is already in that crew&apos;s payroll and in the loaded cost per clean, never added on top.</p>
            )}
            {econ?.kpi?.seventeenWest?.covered > 0 && (
              <p>17WEST covers {fmt$(econ.kpi.seventeenWest.covered)} of George Paz + Yoslenis&apos;s {fmt$(econ.kpi.seventeenWest.wages)} wages this window ($100k/yr, pro-rated) — maintenance and supervisor lines carry only Stay&apos;s share, and 17WEST tasks are unbilled by design.</p>
            )}
            <p>Yesterday always reads expensive — its fees sit on cleans nobody has closed yet. Manage on a settled window; this page recomputes every line from scratch on every load, so corrections in Breezeway, Homebase or Guesty true up here automatically.</p>
          </div>
          </details>
        </div>
      )}
      {/* VENDOR-MANAGED UNITS WE WORKED ON OURSELVES.
          Two jobs: allocate our own cost when we step onto a vendor's building, and check the
          vendor's invoice against the checkouts that actually happened. */}
      {!hideMoney && econ?.vendorWork?.byBuilding?.length > 0 && (
        <div className="rounded-xl border border-line bg-white px-3 py-4 overflow-x-auto">
          <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">
            Vendor buildings <span className="normal-case font-normal">· what they owe us a clean for, and what we did ourselves</span>
          </p>
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1 pr-3">Building</th><th className="py-1 pr-3">Checkouts</th>
                <th className="py-1 pr-3">Cleans vendor logged</th><th className="py-1 pr-3">Cleaning rev</th>
                <th className="py-1 pr-3">Our jobs there</th><th className="py-1 pr-3">Our cleans</th><th className="py-1">We billed</th>
              </tr>
            </thead>
            <tbody>
              {econ.vendorWork.byBuilding.map((b: any) => (
                <tr key={b.building} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-medium text-ink">{b.building}</td>
                  <td className="py-1.5 pr-3">{b.checkouts || '—'}</td>
                  {/* More cleans logged than checkouts is the invoice red flag. */}
                  <td className={'py-1.5 pr-3 ' + (b.vendorCleansLogged > b.checkouts ? 'text-red-600 font-medium' : '')}>
                    {b.vendorCleansLogged || '—'}
                    {b.vendorCleansLogged > b.checkouts && <span className="ml-1 text-[10px]">over checkouts</span>}
                  </td>
                  <td className="py-1.5 pr-3">{b.cleaningRevenue ? fmt$(b.cleaningRevenue) : '—'}</td>
                  <td className={'py-1.5 pr-3 ' + (b.ourTasks ? 'text-amber-700 font-medium' : '')}>{b.ourTasks || '—'}</td>
                  <td className={'py-1.5 pr-3 ' + (b.ourCleans ? 'text-amber-700 font-medium' : '')}>{b.ourCleans || '—'}</td>
                  <td className="py-1.5">{b.ourBilled ? fmt$(b.ourBilled) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {econ.vendorWork.ourTaskCount > 0 && (
            <div className="mt-3">
              <p className="text-[11px] text-amber-700 mb-1">
                {econ.vendorWork.ourTaskCount} job{econ.vendorWork.ourTaskCount === 1 ? '' : 's'} our crew did on vendor-managed units
                {econ.vendorWork.ourCleanCount > 0 ? ' (' + econ.vendorWork.ourCleanCount + ' of them departure cleans)' : ''} —
                {econ.vendorWork.unbilled > 0 ? ' ' + econ.vendorWork.unbilled + ' with nothing billed to anyone.' : ' all billed.'}
              </p>
              <table className="w-full text-[12.5px] min-w-[680px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Unit</th><th className="py-1 pr-3">Who</th>
                    <th className="py-1 pr-3">Job</th><th className="py-1 pr-3">Time</th><th className="py-1">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {econ.vendorWork.ourTasks.slice(0, 25).map((t: any, i: number) => (
                    <tr key={i} className="border-t border-line/60">
                      <td className="py-1 pr-3 text-muted">{t.date}</td>
                      <td className="py-1 pr-3 text-ink">{t.unit}</td>
                      <td className="py-1 pr-3">{t.person}</td>
                      <td className="py-1 pr-3">{t.kind === 'clean' ? <b>Departure clean</b> : t.task.slice(0, 46)}</td>
                      <td className="py-1 pr-3 text-muted">{t.minutes ? t.minutes + 'm' : '—'}</td>
                      <td className={'py-1 ' + (t.billed ? '' : 'text-amber-700')}>{t.billed ? fmt$(t.billed) : 'not billed'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>) : null}
    </section>
  )
}

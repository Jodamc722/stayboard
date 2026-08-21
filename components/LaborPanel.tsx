'use client'
import { LaborWeekly } from '@/components/LaborWeekly'
// components/LaborPanel.tsx (v4) — live labor dashboard for /labor.
// v4: custom day/range picker, payroll vs revenue with banding, today strip
// for in-day decisions, click-a-person task drill-down (Breezeway).
import { useCallback, useEffect, useState } from 'react'
import { Clock, AlertTriangle, RefreshCw, DollarSign, ClipboardList, ChevronRight, Zap } from 'lucide-react'

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
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-700' : 'text-ink'
  return (
    <div className="min-w-0 overflow-hidden text-center px-1">
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
  const cleaners = d?.perCleaner || []
  const pay = d?.payroll || {}
  // The shared labor P&L (lib/labor-econ) — same object the briefs print from.
  const econ = (d as any)?.econ
  // Per-person P&L keyed by the Homebase spelling, so the People table can show what each person
  // earned (cleaning fees + the charges typed on their tasks) beside what they cost.
  const econBy: Record<string, any> = {}
  for (const x of ((econ?.people || []) as any[])) econBy[x.name] = x
  const DEPT_SHORT: Record<string, string> = { housekeeping: 'HK', supervision: 'Sup', maintenance: 'Maint', inspection: 'Insp', other: '—' }
  const tasks = d?.tasks || {}
  const tdy = d?.today
  const attr = d?.attribution || {}
  const personTasks = d?.personTasks || {}
  const flags = d?.flags || { overtimeRisk: [], noShows: [], stillClockedIn: [] }
  const hasFlags = flags.overtimeRisk.length || flags.noShows.length || flags.stillClockedIn.length
  const bandTone = pay.band === 'on_target' ? 'good' : pay.band === 'watch' ? 'warn' : pay.band === 'over' ? 'bad' : undefined
  // The server decides who sees amounts (lib/access.ts canSeeMoney) and simply doesn't send them to
  // anyone else — `moneyHidden` only tells this component which layout to draw. Every dollar tile
  // below has a percentage counterpart, so the board answers the same questions either way.
  const hideMoney = d?.moneyHidden === true
  const peopleCols = hideMoney ? 7 : 11

  const TaskList = ({ name }: { name: string }) => {
    const rows = personTasks[name] || []
    if (!rows.length) return <div className="px-6 py-3 text-[12px] text-muted">No Breezeway tasks recorded for {name} in this range.</div>
    return (
      <div className="px-6 py-2 bg-app/60">
        {rows.map((t: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-[12.5px] py-1 border-b border-line/40 last:border-0">
            <span className="text-muted tabular-nums w-20 shrink-0">{String(t.date).slice(5)}</span>
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
  }

  return (
    <section className="space-y-4">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-ink flex items-center gap-1.5"><Clock size={15} /> Labor <span className="text-[11px] font-semibold text-muted">· the true-up — every brief and board reads from this engine</span></h2>
        <div className="flex items-center gap-1 ml-2">
          {MARKETS.map(m => (
            <button key={m.k} onClick={() => setMarket(m.k)}
              className={'text-[11px] font-semibold px-2 py-0.5 rounded-lg border ' + (market === m.k ? 'bg-ink text-white border-ink' : 'text-muted border-line hover:text-ink')}>{m.l}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={pickToday}
            className={'text-[11px] font-semibold px-2 py-0.5 rounded ' + (from && from === to && from === todayISO() ? 'bg-ink text-white' : 'text-muted hover:text-ink border border-line')}>Today</button>
          {PRESETS.map(p => (
            <button key={p.d} onClick={() => pickPreset(p.d)}
              className={'text-[11px] font-semibold px-1.5 py-0.5 rounded ' + (!from && days === p.d ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{p.l}</button>
          ))}
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From"
            className="text-[11px] border border-line rounded px-1 py-0.5 bg-white w-[112px]" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} title="To"
            className="text-[11px] border border-line rounded px-1 py-0.5 bg-white w-[112px]" />
          <button onClick={load} className="text-muted hover:text-ink p-1" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div>}

      {/* TODAY — in-day decisions */}
      {tdy && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-3 py-3">
          <p className="text-[10px] uppercase tracking-wide text-indigo-700 font-bold px-2 mb-2 flex items-center gap-1">
            <Zap size={11} /> Right now · {tdy.date}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-2 gap-y-3">
            <Stat label="Clocked in now" value={loading ? '…' : String(tdy.clockedInNow.length)}
              sub={tdy.clockedInNow.slice(0, 3).join(', ') + (tdy.clockedInNow.length > 3 ? ` +${tdy.clockedInNow.length - 3}` : '')} />
            <Stat label="Hours so far" value={loading ? '…' : String(tdy.hoursSoFar)} />
            {hideMoney ? <>
              <Stat label="Labor % today" value={loading ? '…' : pct(tdy.laborPct)} sub="of today's cleaning revenue" />
              <Stat label="vs scheduled" value={loading ? '…' : pct(tdy.vsScheduledPct)} sub="100% = on plan" />
            </> : <>
              <Stat label="Payroll so far" value={loading ? '…' : fmt$(tdy.payrollSoFar)} sub={'sched ' + fmt$(tdy.scheduledPayroll)} />
              <Stat label="Cleaning rev today" value={loading ? '…' : fmt$(tdy.cleaningRevenueToday)} sub="net of channel cut" />
            </>}
            <Stat label="Tasks done" value={loading ? '…' : String(tdy.tasksDoneToday)} />
          </div>
        </div>
      )}

      {/* PAYROLL VS REVENUE */}
      <div className="rounded-xl border border-line bg-white px-3 py-4">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3 flex items-center gap-1">
          <DollarSign size={11} /> {hideMoney ? 'Labor vs revenue' : 'Payroll vs revenue'}
          <span className="normal-case font-normal">· {d?.range ? `${d.range.start} → ${d.range.end}` : ''}</span>
          {attr.rate != null && !attr.reliable && (
            <span className="ml-auto normal-case font-semibold text-amber-700">attribution {Math.round((attr.rate || 0) * 100)}% — fix Breezeway assignees</span>
          )}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-4">
          {hideMoney ? <>
            <Stat label="Payroll vs sched" value={loading ? '…' : pct(pay.scheduledVsActualPct)} sub="100% = spent what was planned"
              tone={pay.scheduledVsActualPct != null && pay.scheduledVsActualPct > 105 ? 'warn' : undefined} />
            <Stat label="Vendor mix" value={loading ? '…' : pct(pay.vendorMixPct)} sub="of cleaning revenue" />
          </> : <>
            <Stat label="Payroll (actual)" value={loading ? '…' : fmt$(pay.actual)} sub="Homebase timecards" />
            <Stat label="Payroll (sched)" value={loading ? '…' : fmt$(pay.scheduled)} sub="Homebase shifts" />
            <Stat label="In-house revenue" value={loading ? '…' : fmt$(pay.revenueInhouse ?? pay.revenue)} sub="net of channel cut" />
            <Stat label="Vendor revenue" value={loading ? '…' : fmt$(pay.revenueVendor ?? 0)} sub="vendor-cleaned units" />
          </>}
          <Stat label="Labor %" value={loading ? '…' : (pay.laborPct != null ? pay.laborPct + '%' : '—')}
            sub={pay.goalPct != null ? `goal ≤ ${pay.goalPct}%` : ''} tone={bandTone as any} />
          <Stat label="OT hours" value={loading ? '…' : String(d?.totalOvertimeHours ?? '—')} tone={(d?.totalOvertimeHours ?? 0) > 0 ? 'warn' : undefined} />
          <Stat label="Hours" value={loading ? '…' : String(d?.totalActualHours ?? '—')} sub={d ? 'of ' + d.totalScheduledHours + ' sched' : ''} />
        </div>
      </div>

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
                <Stat label="Labor %" value={loading ? '…' : pct(d.departments.housekeeping.laborPct)} sub="of in-house cleaning revenue" />
                <Stat label="Margin %" value={loading ? '…' : pct(d.departments.housekeeping.marginPct)}
                  tone={d.departments.housekeeping.marginPct > 0 ? 'good' : 'bad'} />
                <Stat label="Share of payroll" value={loading ? '…' : pct(d.departments.housekeeping.payrollSharePct)} sub="of all payroll" />
                <Stat label="Cleans" value={loading ? '…' : String(d.departments.housekeeping.departureCleans ?? 0)} sub={(d.departments.housekeeping.otherHkTasks ?? 0) + ' other HK tasks'} />
                <Stat label="Hours" value={loading ? '…' : d.departments.housekeeping.hours + 'h'} sub={d.departments.housekeeping.people + ' people'} />
              </> : <>
                <Stat label="Cleaning revenue" value={loading ? '…' : fmt$(d.departments.housekeeping.revenue)} sub="net, credited to housekeepers" />
                <Stat label="Payroll" value={loading ? '…' : fmt$(d.departments.housekeeping.payroll)} sub={d.departments.housekeeping.hours + 'h · ' + d.departments.housekeeping.people + ' housekeepers'} />
                <Stat label="Margin" value={loading ? '…' : fmt$(d.departments.housekeeping.margin)} tone={d.departments.housekeeping.margin > 0 ? 'good' : 'bad'} sub="fees − housekeeper wages" />
                <Stat label="Labor cost / clean" value={loading ? '…' : fmt$(d.departments.housekeeping.costPerClean)} sub={(d.departments.housekeeping.departureCleans ?? 0) + ' departure cleans'} />
                <Stat label="Time / clean" value={loading ? '…' : (d.departments.housekeeping.hoursPerClean != null ? d.departments.housekeeping.hoursPerClean + 'h' : '—')} sub="housekeeper hours ÷ cleans" />
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
              {!hideMoney && <Stat label="Management fees" value={loading ? '…' : fmt$(d.departments.supervision?.managementFee)} sub="Guesty commission, window" />}
              <Stat label="% of mgmt fee" value={loading ? '…' : pct(d.departments.supervision?.coveragePct)}
                tone={(d.departments.supervision?.coveragePct ?? 0) < 100 ? 'good' : 'bad'} sub="supervisor cost ÷ fees" />
              {!hideMoney && (d.departments.supervision?.cleaningRevenue ?? 0) > 0 &&
                <Stat label="Cleaning rev" value={loading ? '…' : fmt$(d.departments.supervision?.cleaningRevenue)} sub="cleans they did themselves" />}
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
              {!hideMoney && <Stat label="Billable" value={loading ? '…' : fmt$(d.departments.maintenance.billableRevenue)} sub={(d.departments.maintenance.billableTasks ?? 0) + ' tasks with a charge'} />}
              {!hideMoney && (d.departments.maintenance.cleaningRevenue ?? 0) > 0 &&
                <Stat label="Cleaning rev" value={loading ? '…' : fmt$(d.departments.maintenance.cleaningRevenue)} sub="departure cleans they turned" />}
              {!hideMoney && <Stat label="Margin" value={loading ? '…' : fmt$(d.departments.maintenance.margin)} tone={(d.departments.maintenance.margin ?? 0) > 0 ? 'good' : 'bad'} sub="billable + cleans − wages" />}
              <Stat label="Billable vs wages" value={loading ? '…' : pct(d.departments.maintenance.billableCoveragePct)}
                tone={d.departments.maintenance.billableCoveragePct != null ? (d.departments.maintenance.billableCoveragePct >= 100 ? 'good' : 'bad') : undefined} />
              <Stat label="Hours on tasks" value={loading ? '…' : (d.departments.maintenance.hours ?? 0) + 'h'}
                sub={(d.departments.maintenance.tasksCompleted ?? 0) + ' tasks · Breezeway'} />
              <Stat label="On-task %" value={loading ? '…' : (d.departments.maintenance.utilizationPct != null ? d.departments.maintenance.utilizationPct + '%' : '—')} sub="Breezeway ÷ Homebase hours" />
              {/* Not a rounding error — a finished task with nothing in the cost field earns $0. */}
              <Stat label="No charge entered" value={loading ? '…' : String(d.departments.maintenance.tasksNoCharge ?? 0)}
                tone={(d.departments.maintenance.tasksNoCharge ?? 0) > 0 ? 'warn' : undefined} sub="finished, nothing billed" />
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
                <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Vendor cleans <span className="normal-case font-normal">· not our labor</span></p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                  {!hideMoney && <Stat label="Cleaning revenue" value={loading ? '…' : fmt$(vendorRev)} sub="vendor-cleaned units" />}
                  <Stat label="Cleans" value={loading ? '…' : String(vendorCleans || '—')} sub="turned by a vendor" />
                  {!hideMoney && vendorCleans > 0 && <Stat label="Fee / clean" value={loading ? '…' : fmt$(vb?.feePerClean)} />}
                  <Stat label="Our hours" value={loading ? '…' : '0h'} sub="no Homebase cost against these" />
                </div>
                <p className="text-[10.5px] text-muted px-2 mt-2 leading-snug">
                  Kept out of the housekeeping margin and out of cost per clean — otherwise a vendor turn
                  makes our own crew look cheaper than it is.
                </p>
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
      <LaborWeekly market={market} />

      {/* REVENUE OVER PAYROLL, THREE WAYS — the same table the daily brief leads with.
          Supervisors sit below the line: a fixed cost, never divided into revenue. */}
      {!hideMoney && econ?.kpi && (
        <div className="rounded-xl border border-line bg-white px-3 py-4 overflow-x-auto">
          <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">
            Revenue vs payroll <span className="normal-case font-normal">· margin by crew</span>
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1 pr-3">Crew</th><th className="py-1 pr-3 text-right">Revenue</th>
                <th className="py-1 pr-3 text-right">Payroll</th><th className="py-1 pr-3 text-right">Margin</th>
                <th className="py-1 pr-3 text-right">Margin %</th><th className="py-1">Read</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="py-1.5 pr-3 font-medium text-ink">Housekeeping<div className="text-[11px] text-muted font-normal">{econ.kpi.housekeeping.cleans} departure cleans · {econ.kpi.housekeeping.hours}h{(econ.kpi.housekeeping.chargedCleans ?? 0) > 0 ? ' · incl. ' + fmt$(econ.kpi.housekeeping.chargedCleans) + ' charged cleaning work' : ''}</div></td>
                <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.housekeeping.revenueWithCharged ?? econ.kpi.housekeeping.revenue)}</td>
                <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.housekeeping.payroll)}</td>
                <td className={'py-1.5 pr-3 text-right font-semibold ' + (econ.kpi.housekeeping.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt$(econ.kpi.housekeeping.margin)}</td>
                <td className={'py-1.5 pr-3 text-right font-semibold ' + (econ.kpi.housekeeping.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{pct(econ.kpi.housekeeping.marginPct)}</td>
                <td className="py-1 text-[11px] text-muted">{fmt$(econ.kpi.housekeeping.costPerClean)} cost · {fmt$(econ.kpi.housekeeping.revPerClean)} rev / clean</td>
              </tr>
              {econ.kpi.housekeepingLoaded && (
                <tr className="border-t border-line">
                  <td className="py-1.5 pr-3 font-medium text-ink">+ Supervisors<div className="text-[11px] text-muted font-normal">loaded cost of running housekeeping</div></td>
                  <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.housekeepingLoaded.revenue)}</td>
                  <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.housekeepingLoaded.payroll)}</td>
                  <td className={'py-1.5 pr-3 text-right font-semibold ' + (econ.kpi.housekeepingLoaded.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt$(econ.kpi.housekeepingLoaded.margin)}</td>
                  <td className={'py-1.5 pr-3 text-right font-semibold ' + (econ.kpi.housekeepingLoaded.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{pct(econ.kpi.housekeepingLoaded.marginPct)}</td>
                  <td className="py-1 text-[11px] text-muted">{fmt$(econ.kpi.housekeepingLoaded.costPerClean)} loaded / clean</td>
                </tr>
              )}
              <tr className="border-t-2 border-ink">
                <td className="py-1.5 pr-3 font-medium text-ink">Maintenance <span className="text-[11px] text-muted font-normal">separate department</span><div className="text-[11px] text-muted font-normal">{econ.kpi.maintenance.tasksBilled} tasks billed · {econ.kpi.maintenance.hours}h</div></td>
                <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.maintenance.revenue)}</td>
                <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.maintenance.payroll)}</td>
                <td className={'py-1.5 pr-3 text-right font-semibold ' + (econ.kpi.maintenance.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt$(econ.kpi.maintenance.margin)}</td>
                <td className={'py-1.5 pr-3 text-right font-semibold ' + (econ.kpi.maintenance.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{pct(econ.kpi.maintenance.marginPct)}</td>
                <td className="py-1 text-[11px] text-amber-700">{econ.kpi.maintenance.tasksNoCharge > 0 ? econ.kpi.maintenance.tasksNoCharge + ' finished with no charge' : ''}</td>
              </tr>
              {/* No blended "Staff total" row — Jon (2026-08-18): keep tabs on HK and Maintenance,
                  supervisors as their own line. */}
              <tr className="border-t-2 border-ink bg-app/40">
                <td className="py-1.5 pr-3">Supervisors <span className="text-[11px] text-muted">fixed</span><div className="text-[11px] text-muted">{(econ.kpi.supervisors.names || []).join(', ') || '—'}</div></td>
                <td className="py-1.5 pr-3 text-right text-muted">n/a</td>
                <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.supervisors.payroll)}</td>
                <td className="py-1.5 pr-3 text-right text-muted">—</td>
                <td className="py-1.5 pr-3 text-right text-muted">—</td>
                <td className="py-1 text-[11px] text-muted">{pct(econ.kpi.supervisors.pctOfManagementFee)} of {fmt$(econ.kpi.supervisors.managementFee)} mgmt fees</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 pr-3 font-medium">All in<div className="text-[11px] text-muted font-normal">HK + maintenance + supervisors</div></td>
                <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.allIn.revenue)}</td>
                <td className="py-1.5 pr-3 text-right">{fmt$(econ.kpi.allIn.payroll)}</td>
                <td className={'py-1.5 pr-3 text-right font-semibold ' + (econ.kpi.allIn.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt$(econ.kpi.allIn.margin)}</td>
                <td className={'py-1.5 pr-3 text-right font-semibold ' + (econ.kpi.allIn.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{pct(econ.kpi.allIn.marginPct)}</td>
                <td className="py-1"></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            Revenue cleans = departure cleans that earned a guest fee, plus cleaning tasks with a charge entered. Strips, common areas, pool, trash and office cleaning earn nothing and are outside both sides.
          </p>
        </div>
      )}

      {/* THE THREE HOUSEKEEPING CATEGORIES — Miami, Broward, Vendor-cleaned.
          Cost per clean is housekeeper wages over the units housekeepers turned in that market.
          A housekeeper who works both markets has her wages split by her share of cleans in each.
          The vendor row carries revenue and a clean count and never a cost per clean: nobody on
          our payroll cleaned those units. */}
      {!hideMoney && econ?.buckets?.length > 0 && (
        <div className="rounded-xl border border-line bg-white px-3 py-4 overflow-x-auto">
          <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Housekeeping by market <span className="normal-case font-normal">· departure cleans from Breezeway, matched to Guesty checkouts</span></p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1 pr-3">Bucket</th><th className="py-1 pr-3">Cleans</th><th className="py-1 pr-3">Housekeepers</th>
                <th className="py-1 pr-3">Hours</th><th className="py-1 pr-3">Payroll</th>
                <th className="py-1 pr-3">Labor $ / clean</th><th className="py-1 pr-3">Time / clean</th>
                <th className="py-1 pr-3">Cleaning rev</th><th className="py-1 pr-3">Fee / clean</th>
                <th className="py-1 pr-3">Margin</th><th className="py-1">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {econ.buckets.map((b: any) => (
                <tr key={b.key} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-medium text-ink">{/unassigned/i.test(String(b.label)) ? 'No clean matched' : b.label}{/unassigned/i.test(String(b.label)) && <div className="text-[10px] text-muted font-normal">HK hours with no matched clean — already in cost per clean</div>}{!b.inHouse && <span className="ml-1 text-[10px] text-muted">no in-house labor</span>}</td>
                  <td className="py-1.5 pr-3">{b.cleans || '—'}</td>
                  <td className="py-1.5 pr-3">{b.people || '—'}</td>
                  <td className="py-1.5 pr-3">{b.hours ? b.hours + 'h' : '—'}</td>
                  <td className="py-1.5 pr-3">{b.payroll ? fmt$(b.payroll) : '—'}</td>
                  <td className="py-1.5 pr-3 font-medium text-ink">{b.laborCostPerClean != null ? fmt$(b.laborCostPerClean) : '—'}</td>
                  <td className="py-1.5 pr-3">{b.hoursPerClean != null ? b.hoursPerClean + 'h' : '—'}</td>
                  <td className="py-1.5 pr-3">{b.cleaningRevenue ? fmt$(b.cleaningRevenue) : '—'}</td>
                  <td className="py-1.5 pr-3">{b.feePerClean != null ? fmt$(b.feePerClean) : '—'}</td>
                  <td className={'py-1.5 pr-3 font-medium ' + (b.margin >= 0 ? 'text-emerald-700' : 'text-red-600')}>{fmt$(b.margin)}</td>
                  <td className="py-1">{b.marginPct != null ? b.marginPct + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            Supervisors are not in these numbers — their hours are fixed overhead. Maintenance is not either, even when a tech turns a unit: that fee is maintenance revenue.
          </p>
        </div>
      )}

      {/* THE TRUE-UP — where every dollar landed (Jon, 2026-08-21: "the labor mecca... it should
          be a true up"). The board is only trustworthy if the reader can see what the engine did
          with every fee and every payroll week: what was credited, what sits on unclosed paperwork
          (and will settle), what never matched, what the OTA took, what got rebuilt on Expedia,
          and what 17WEST covers. Pick any window above — this trues up with it. */}
      {!hideMoney && econ?.feeAudit && (
        <div className="rounded-xl border border-line bg-white px-3 py-4">
          <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">
            True-up · where every cleaning fee landed <span className="normal-case font-normal">· {d?.range ? `${d.range.start} → ${d.range.end}` : ''} · re-checked on every load</span>
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
          <div className="px-2 mt-3 space-y-1 text-[11.5px] text-muted">
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
            {econ?.kpi?.seventeenWest?.covered > 0 && (
              <p>17WEST covers {fmt$(econ.kpi.seventeenWest.covered)} of George Paz + Yoslenis&apos;s {fmt$(econ.kpi.seventeenWest.wages)} wages this window ($100k/yr, pro-rated) — maintenance and supervisor lines carry only Stay&apos;s share, and 17WEST tasks are unbilled by design.</p>
            )}
            <p>Yesterday always reads expensive — its fees sit on cleans nobody has closed yet. Manage on a settled window; this page recomputes every line from scratch on every load, so corrections in Breezeway, Homebase or Guesty true up here automatically.</p>
          </div>
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
          <table className="w-full text-sm">
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
              <table className="w-full text-[12.5px]">
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

      {/* THE WHOLE LABOR P&L ON ONE LINE PER CREW — what it earned, what it cost, what is left. */}
      {!hideMoney && econ && (
        <div className="rounded-xl border border-line bg-white px-3 py-4 overflow-x-auto">
          <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Department P&amp;L <span className="normal-case font-normal">· cleaning fees + billable charges vs payroll</span></p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1 pr-3">Department</th><th className="py-1 pr-3">People</th><th className="py-1 pr-3">Hours</th>
                <th className="py-1 pr-3">Payroll</th><th className="py-1 pr-3">Cleans</th><th className="py-1 pr-3">Cleaning rev</th>
                <th className="py-1 pr-3">Billable</th><th className="py-1 pr-3">Margin</th><th className="py-1">Measured on</th>
              </tr>
            </thead>
            <tbody>
              {(econ.departments || []).filter((x: any) => x.people > 0).map((x: any) => (
                <tr key={x.key} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-medium text-ink">{x.label}</td>
                  <td className="py-1.5 pr-3">{x.people}</td>
                  <td className="py-1.5 pr-3">{x.hours}h</td>
                  <td className="py-1.5 pr-3">{fmt$(x.payroll)}</td>
                  <td className="py-1.5 pr-3">{x.cleans || '—'}</td>
                  <td className="py-1.5 pr-3">{x.cleaningRevenue ? fmt$(x.cleaningRevenue) : '—'}</td>
                  <td className="py-1.5 pr-3">{x.billableRevenue ? fmt$(x.billableRevenue) : '—'}</td>
                  <td className={'py-1.5 pr-3 font-medium ' + (x.key === 'supervision' ? 'text-muted' : x.margin >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                    {x.key === 'supervision' ? '—' : fmt$(x.margin)}
                  </td>
                  <td className="py-1 text-[11px] text-muted">{x.basis}</td>
                </tr>
              ))}
              {/* Makes the table add up. Fees on checkouts we could not tie to anybody's clean
                  belong to the company, not to a crew — so they sit on their own line. */}
              {econ.cleaningRevenueUnattributed > 0 && (
                <tr className="border-t border-line text-muted">
                  <td className="py-1.5 pr-3">Unattributed</td>
                  <td className="py-1.5 pr-3">—</td><td className="py-1.5 pr-3">—</td><td className="py-1.5 pr-3">—</td>
                  <td className="py-1.5 pr-3">—</td>
                  <td className="py-1.5 pr-3">{fmt$(econ.cleaningRevenueUnattributed)}</td>
                  <td className="py-1.5 pr-3">—</td><td className="py-1.5 pr-3">—</td>
                  <td className="py-1 text-[11px]">checkout with no clean matched to a person</td>
                </tr>
              )}
              <tr className="border-t-2 border-ink font-medium">
                <td className="py-1.5 pr-3">Total</td>
                <td className="py-1.5 pr-3">{(econ.people || []).length}</td>
                <td className="py-1.5 pr-3">—</td>
                <td className="py-1.5 pr-3">{fmt$(econ.payroll)}</td>
                <td className="py-1.5 pr-3">{econ.cleans || '—'}</td>
                <td className="py-1.5 pr-3">{fmt$(econ.cleaningRevenue)}</td>
                <td className="py-1.5 pr-3">{fmt$(econ.billableRevenue)}</td>
                <td className={'py-1.5 pr-3 ' + (econ.margin >= 0 ? 'text-emerald-700' : 'text-red-600')}>{fmt$(econ.margin)}</td>
                <td className="py-1 text-[11px] text-muted">+{fmt$(econ.managementFee)} mgmt fees → {fmt$(econ.marginWithFee)}</td>
              </tr>
            </tbody>
          </table>
          {econ.coverage?.tasksWithNoCharge > 0 && (
            <p className="mt-2 text-[11px] text-amber-700">
              {econ.coverage.tasksWithNoCharge} finished task{econ.coverage.tasksWithNoCharge === 1 ? '' : 's'} carried no charge in Breezeway — that work earns $0 here until a cost is entered on it.
            </p>
          )}
        </div>
      )}

      {/* TASKS */}
      <div className="rounded-xl border border-line bg-white px-3 py-4">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3 flex items-center gap-1">
          <ClipboardList size={11} /> Tasks completed <span className="normal-case font-normal">· Breezeway</span>
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-2 gap-y-4">
          <Stat label="Total" value={loading ? '…' : String(tasks.total ?? 0)} />
          <Stat label="Cleans" value={loading ? '…' : String(tasks.clean ?? 0)} />
          <Stat label="Inspections" value={loading ? '…' : String(tasks.inspection ?? 0)} />
          <Stat label="Maintenance" value={loading ? '…' : String(tasks.maintenance ?? 0)} />
          <Stat label="Other" value={loading ? '…' : String(tasks.other ?? 0)} />
        </div>
      </div>

      {/* flags */}
      {!!hasFlags && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
          {flags.overtimeRisk.length > 0 && (
            <p className="text-[13px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><b>OT risk this workweek:</b> {flags.overtimeRisk.join(', ')}</span>
            </p>
          )}
          {flags.noShows.length > 0 && (
            <p className="text-[13px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><b>Scheduled, never clocked in:</b> {flags.noShows.map((n: any) => n.name + ' (' + String(n.date).slice(5) + ')').join(', ')}</span>
            </p>
          )}
          {flags.stillClockedIn.length > 0 && (
            <p className="text-[13px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><b>Open timecards:</b> {flags.stillClockedIn.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      {/* PEOPLE — hours + payroll, click for their tasks */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-4 pt-3 pb-1">
          People · click a name for their tasks
        </p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted border-b border-line">
              <th className="text-left font-semibold px-4 py-2">Person</th>
              <th className="text-left font-semibold px-2 py-2">Crew</th>
              <th className="text-right font-semibold px-2 py-2">Sched</th>
              <th className="text-right font-semibold px-2 py-2">Actual</th>
              <th className="text-right font-semibold px-2 py-2">OT</th>
              {!hideMoney && <>
                <th className="text-right font-semibold px-2 py-2">$/hr</th>
                <th className="text-right font-semibold px-2 py-2">Payroll</th>
                <th className="text-right font-semibold px-2 py-2">Cleaning rev</th>
                <th className="text-right font-semibold px-2 py-2">Billable</th>
                <th className="text-right font-semibold px-2 py-2">Margin</th>
              </>}
              <th className="text-right font-semibold px-2 py-2">Tasks</th>
              <th className="text-right font-semibold px-4 py-2">Wk proj</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p: any) => (
              <>
                <tr key={p.name} onClick={() => setOpen(open === p.name ? '' : p.name)}
                  className="border-b border-line/50 last:border-0 cursor-pointer hover:bg-app/50">
                  <td className="px-4 py-2 text-ink font-medium">
                    <ChevronRight size={12} className={'inline mr-1 -mt-0.5 text-muted transition-transform ' + (open === p.name ? 'rotate-90' : '')} />
                    {p.name}
                    {p.overtimeRisk && <span className="ml-2 text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">OT risk</span>}
                    {p.openTimecard && <span className="ml-2 text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">on shift now</span>}
                    {!p.openTimecard && p.missedClockOuts && p.missedClockOuts.length > 0 && (
                      <span title={'Clocked in on ' + p.missedClockOuts.join(', ') + ' and never clocked out — their hours and cost are understated until the card is closed'}
                        className="ml-2 text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        never clocked out{p.missedClockOuts.length > 1 ? ' ×' + p.missedClockOuts.length : ''}</span>
                    )}
                    {/* W-2 vs agency, what sizes they turned, and building hops — the person's day
                        in one line (Jon, 2026-08-22). */}
                    {econBy[p.name] && (
                      <div className="text-[10px] text-muted font-normal mt-0.5 pl-4">
                        <span className={'px-1 py-px rounded border font-semibold mr-1 ' + (econBy[p.name].agency ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-app text-muted border-line')}>
                          {econBy[p.name].agencyLabel || 'W-2'}
                        </span>
                        {econBy[p.name].cleans > 0 && <span className="font-semibold text-ink">{econBy[p.name].cleans} clean{econBy[p.name].cleans === 1 ? '' : 's'}</span>}
                        {econBy[p.name].cleans > 0 && roomMixTxt(econBy[p.name].roomMix) ? ' · ' : ''}
                        {roomMixTxt(econBy[p.name].roomMix)}
                        {econBy[p.name].travel ? <span> · {econBy[p.name].travel.hops} building hop{econBy[p.name].travel.hops === 1 ? '' : 's'} ≈ {econBy[p.name].travel.minutes}m travel</span> : null}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-left text-[11px] text-muted">
                    {DEPT_SHORT[econBy[p.name]?.dept] || '—'}
                    {econBy[p.name] && !econBy[p.name].declared && <span title="Crew inferred from their work — name them on the roster to lock it in" className="ml-1 text-amber-600">?</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{p.scheduledHours}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">{p.actualHours}</td>
                  <td className={'px-2 py-2 text-right tabular-nums ' + (p.overtimeHours > 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>{p.overtimeHours || '—'}</td>
                  {!hideMoney && <>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{(p as any).wageRate != null ? '$' + (p as any).wageRate : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink" title={econBy[p.name]?.agencyLoad > 0 ? 'Homebase wages ' + fmt$(econBy[p.name].wagesHomebase) + ' + agency markup ' + fmt$(econBy[p.name].agencyLoad) : undefined}>
                      {econBy[p.name]?.agencyLoad > 0 ? fmt$(econBy[p.name].payroll) : (p.laborCost != null ? fmt$(p.laborCost) : '—')}
                      {econBy[p.name]?.agencyLoad > 0 && <span className="text-indigo-600">*</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{econBy[p.name]?.cleaningRevenue ? fmt$(econBy[p.name].cleaningRevenue) : ((d as any)?.personRevenue?.[p.name] != null ? fmt$((d as any).personRevenue[p.name]) : '—')}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{econBy[p.name]?.billableRevenue ? fmt$(econBy[p.name].billableRevenue) : '—'}</td>
                    <td className={'px-2 py-2 text-right tabular-nums font-medium ' + (!econBy[p.name] ? 'text-muted' : econBy[p.name].margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{econBy[p.name] ? fmt$(econBy[p.name].margin) : '—'}</td>
                  </>}
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{(personTasks[p.name] || []).length || '—'}</td>
                  <td className={'px-4 py-2 text-right tabular-nums ' + (p.overtimeRisk ? 'text-rose-700 font-bold' : 'text-muted')}>{p.projectedWeekHours}h</td>
                </tr>
                {open === p.name && (
                  <tr key={p.name + '-detail'}><td colSpan={peopleCols} className="p-0"><TaskList name={p.name} /></td></tr>
                )}
              </>
            ))}
            {!people.length && !loading && (
              <tr><td colSpan={peopleCols} className="px-4 py-6 text-center text-muted">No Homebase data in this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* CLEANERS — revenue vs cost */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-4 pt-3 pb-1">
          Cleaners · revenue generated vs cost
        </p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted border-b border-line">
              <th className="text-left font-semibold px-4 py-2">Cleaner</th>
              <th className="text-right font-semibold px-2 py-2">Cleans</th>
              <th className="text-right font-semibold px-2 py-2">Revenue</th>
              <th className="text-right font-semibold px-2 py-2">Payroll</th>
              <th className="text-right font-semibold px-2 py-2">Margin</th>
              <th className="text-right font-semibold px-4 py-2">Rev / $</th>
            </tr>
          </thead>
          <tbody>
            {cleaners.map((c: any) => (
              <tr key={c.name} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2 text-ink font-medium">{c.name}
                  {c.avgFeePerClean != null && <span className="ml-2 text-[10.5px] text-muted">avg fee {fmt$(c.avgFeePerClean)}</span>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">{c.cleans}</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">{fmt$(c.revenueGenerated)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink">{fmt$(c.payroll > 0 ? c.payroll : c.taskPay)}</td>
                <td className={'px-2 py-2 text-right tabular-nums ' + (c.margin < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>{fmt$(c.margin)}</td>
                <td className={'px-4 py-2 text-right tabular-nums font-bold ' + (c.revenuePerLaborDollar != null && c.revenuePerLaborDollar < 1 ? 'text-rose-700' : 'text-ink')}>
                  {c.revenuePerLaborDollar != null ? '$' + c.revenuePerLaborDollar : '—'}
                </td>
              </tr>
            ))}
            {!cleaners.length && !loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No completed cleans in this range{market !== 'all' ? ' for this market' : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

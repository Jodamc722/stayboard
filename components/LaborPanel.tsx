'use client'
// components/LaborPanel.tsx (v4) — live labor dashboard for /labor.
// v4: custom day/range picker, payroll vs revenue with banding, today strip
// for in-day decisions, click-a-person task drill-down (Breezeway).
import { useCallback, useEffect, useState } from 'react'
import { Clock, AlertTriangle, RefreshCw, DollarSign, ClipboardList, ChevronRight, Zap } from 'lucide-react'

const MARKETS = [{ k: 'all', l: 'All' }, { k: 'miami', l: 'Miami' }, { k: 'broward', l: 'Broward' }, { k: 'north', l: 'North' }]
const PRESETS = [{ d: 7, l: '7d' }, { d: 14, l: '14d' }, { d: 30, l: '30d' }]

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-700' : 'text-ink'
  return (
    <div className="text-center px-2">
      <div className={'text-[22px] font-bold tabular-nums ' + color}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mt-0.5">{label}</div>
      {sub && <div className="text-[10.5px] text-muted">{sub}</div>}
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
  const tasks = d?.tasks || {}
  const tdy = d?.today
  const attr = d?.attribution || {}
  const personTasks = d?.personTasks || {}
  const flags = d?.flags || { overtimeRisk: [], noShows: [], stillClockedIn: [] }
  const hasFlags = flags.overtimeRisk.length || flags.noShows.length || flags.stillClockedIn.length
  const bandTone = pay.band === 'on_target' ? 'good' : pay.band === 'watch' ? 'warn' : pay.band === 'over' ? 'bad' : undefined

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
        <h2 className="text-[15px] font-bold text-ink flex items-center gap-1.5"><Clock size={15} /> Labor</h2>
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
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-y-3">
            <Stat label="Clocked in now" value={loading ? '…' : String(tdy.clockedInNow.length)}
              sub={tdy.clockedInNow.slice(0, 3).join(', ') + (tdy.clockedInNow.length > 3 ? ` +${tdy.clockedInNow.length - 3}` : '')} />
            <Stat label="Hours so far" value={loading ? '…' : String(tdy.hoursSoFar)} />
            <Stat label="Payroll so far" value={loading ? '…' : fmt$(tdy.payrollSoFar)} sub={'sched ' + fmt$(tdy.scheduledPayroll)} />
            <Stat label="Cleaning rev today" value={loading ? '…' : fmt$(tdy.cleaningRevenueToday)} />
            <Stat label="Tasks done" value={loading ? '…' : String(tdy.tasksDoneToday)} />
          </div>
        </div>
      )}

      {/* PAYROLL VS REVENUE */}
      <div className="rounded-xl border border-line bg-white px-3 py-4">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3 flex items-center gap-1">
          <DollarSign size={11} /> Payroll vs revenue
          <span className="normal-case font-normal">· {d?.range ? `${d.range.start} → ${d.range.end}` : ''}</span>
          {attr.rate != null && !attr.reliable && (
            <span className="ml-auto normal-case font-semibold text-amber-700">attribution {Math.round((attr.rate || 0) * 100)}% — fix Breezeway assignees</span>
          )}
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-y-4">
          <Stat label="Payroll (actual)" value={loading ? '…' : fmt$(pay.actual)} sub="Homebase timecards" />
          <Stat label="Payroll (sched)" value={loading ? '…' : fmt$(pay.scheduled)} sub="Homebase shifts" />
          <Stat label="In-house revenue" value={loading ? '…' : fmt$(pay.revenueInhouse ?? pay.revenue)} sub="guest fees, in-house units" />
          <Stat label="Vendor revenue" value={loading ? '…' : fmt$(pay.revenueVendor ?? 0)} sub="vendor-cleaned units" />
          <Stat label="Labor %" value={loading ? '…' : (pay.laborPct != null ? pay.laborPct + '%' : '—')}
            sub={pay.goalPct != null ? `goal ≤ ${pay.goalPct}%` : ''} tone={bandTone as any} />
          <Stat label="OT hours" value={loading ? '…' : String(d?.totalOvertimeHours ?? '—')} tone={(d?.totalOvertimeHours ?? 0) > 0 ? 'warn' : undefined} />
          <Stat label="Hours" value={loading ? '…' : String(d?.totalActualHours ?? '—')} sub={d ? 'of ' + d.totalScheduledHours + ' sched' : ''} />
        </div>
      </div>

      {/* DEPARTMENTS: housekeeping economics + maintenance utilization */}
      {d?.departments && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-xl border border-line bg-white px-3 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Housekeeping</p>
            <div className="grid grid-cols-3 gap-y-3">
              <Stat label="In-house revenue" value={loading ? '…' : fmt$(d.departments.housekeeping.revenue)} sub="cleaning fees, in-house units" />
              <Stat label="Labor" value={loading ? '…' : fmt$(d.departments.housekeeping.payroll)} sub={d.departments.housekeeping.hours + 'h · ' + d.departments.housekeeping.people + ' people' + (d.departments.housekeeping.supervisorPayroll ? ' · incl ' + fmt$(d.departments.housekeeping.supervisorPayroll) + ' supervisors' : '')} />
              <Stat label="In-house margin" value={loading ? '…' : fmt$(d.departments.housekeeping.margin)} tone={d.departments.housekeeping.margin > 0 ? 'good' : 'bad'} />
              <Stat label="Vendor revenue" value={loading ? '…' : fmt$(d.departments.housekeeping.vendorRevenue)} sub="cleaned by vendors" />
              <Stat label="Cost / clean" value={loading ? '…' : fmt$(d.departments.housekeeping.costPerClean)} />
              <Stat label="Fee / clean" value={loading ? '…' : fmt$(d.departments.housekeeping.feePerClean)} />
              <Stat label="Labor %" value={loading ? '…' : (d.departments.housekeeping.laborPct != null ? d.departments.housekeeping.laborPct + '%' : '—')} />
            </div>
          </div>
          <div className="rounded-xl border border-line bg-white px-3 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Inspections</p>
            <div className="grid grid-cols-3 gap-y-3">
              <Stat label="Payroll" value={loading ? '…' : fmt$(d.departments.inspection?.payroll)} sub={(d.departments.inspection?.hours ?? 0) + 'h · ' + (d.departments.inspection?.people ?? 0) + ' people'} />
              <Stat label="Inspections" value={loading ? '…' : String(d.departments.inspection?.inspections ?? 0)} />
              <Stat label="Cost / inspection" value={loading ? '…' : fmt$(d.departments.inspection?.costPerInspection)} />
            </div>
          </div>
          <div className="rounded-xl border border-line bg-white px-3 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3">Maintenance</p>
            <div className="grid grid-cols-3 gap-y-3">
              {/* Payroll is Homebase, hours are Breezeway — each tile says which, so the two are
                  never read as the same number. */}
              <Stat label="Payroll" value={loading ? '…' : fmt$(d.departments.maintenance.payroll)}
                sub={(d.departments.maintenance.clockedHours ?? 0) + 'h clocked · ' + d.departments.maintenance.people + ' people'} />
              <Stat label="Hours on tasks" value={loading ? '…' : (d.departments.maintenance.hours ?? 0) + 'h'}
                sub={(d.departments.maintenance.tasksCompleted ?? 0) + ' tasks · Breezeway'} />
              <Stat label="On-task %" value={loading ? '…' : (d.departments.maintenance.utilizationPct != null ? d.departments.maintenance.utilizationPct + '%' : '—')} sub="Breezeway hours ÷ Homebase hours" />
              <Stat label="Cost / task" value={loading ? '…' : fmt$(d.departments.maintenance.costPerTask)} />
              <Stat label="Billable" value={loading ? '…' : fmt$(d.departments.maintenance.billableRevenue)} sub={(d.departments.maintenance.billableTasks ?? 0) + ' tasks · Breezeway billing'} />
            </div>
          </div>
        </div>
      )}

      {/* TASKS */}
      <div className="rounded-xl border border-line bg-white px-3 py-4">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3 flex items-center gap-1">
          <ClipboardList size={11} /> Tasks completed <span className="normal-case font-normal">· Breezeway</span>
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-y-4">
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
              <th className="text-right font-semibold px-2 py-2">Sched</th>
              <th className="text-right font-semibold px-2 py-2">Actual</th>
              <th className="text-right font-semibold px-2 py-2">OT</th>
              <th className="text-right font-semibold px-2 py-2">$/hr</th>
              <th className="text-right font-semibold px-2 py-2">Payroll</th>
              <th className="text-right font-semibold px-2 py-2">Revenue</th>
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
                    {p.openTimecard && <span className="ml-2 text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">clocked in</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{p.scheduledHours}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">{p.actualHours}</td>
                  <td className={'px-2 py-2 text-right tabular-nums ' + (p.overtimeHours > 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>{p.overtimeHours || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{(p as any).wageRate != null ? '$' + (p as any).wageRate : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{p.laborCost != null ? fmt$(p.laborCost) : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{(d as any)?.personRevenue?.[p.name] != null ? fmt$((d as any).personRevenue[p.name]) : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{(personTasks[p.name] || []).length || '—'}</td>
                  <td className={'px-4 py-2 text-right tabular-nums ' + (p.overtimeRisk ? 'text-rose-700 font-bold' : 'text-muted')}>{p.projectedWeekHours}h</td>
                </tr>
                {open === p.name && (
                  <tr key={p.name + '-detail'}><td colSpan={9} className="p-0"><TaskList name={p.name} /></td></tr>
                )}
              </>
            ))}
            {!people.length && !loading && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-muted">No Homebase data in this range.</td></tr>
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

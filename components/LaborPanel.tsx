'use client'
// components/LaborPanel.tsx (v2) — live labor dashboard for /labor.
// Markets: All / Miami / Broward / North (from lib/segments marketOf).
// Cost basis: Breezeway rate_paid (per-task pay). Homebase supplies hours/OT.
import { useCallback, useEffect, useState } from 'react'
import { Clock, AlertTriangle, TrendingUp, TrendingDown, Minus, RefreshCw, DollarSign, ClipboardList } from 'lucide-react'

const RANGES = [{ d: 7, l: '7d' }, { d: 14, l: '14d' }, { d: 30, l: '30d' }]
const MARKETS = [{ k: 'all', l: 'All' }, { k: 'miami', l: 'Miami' }, { k: 'broward', l: 'Broward' }, { k: 'north', l: 'North' }]

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

function Stat({ label, value, sub, warn, good }: { label: string; value: string; sub?: string; warn?: boolean; good?: boolean }) {
  return (
    <div className="text-center px-2">
      <div className={'text-[22px] font-bold tabular-nums ' + (warn ? 'text-rose-700' : good ? 'text-emerald-700' : 'text-ink')}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mt-0.5">{label}</div>
      {sub && <div className="text-[10.5px] text-muted">{sub}</div>}
    </div>
  )
}

export function LaborPanel() {
  const [days, setDays] = useState(7)
  const [market, setMarket] = useState('all')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/labor/kpi?days=${days}&market=${market}`, { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not load labor data')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [days, market])
  useEffect(() => { load() }, [load])

  const people = d?.people || []
  const cleaners = d?.perCleaner || []
  const eco = d?.economics || {}
  const tasks = d?.tasks || {}
  const attr = d?.attribution || {}
  const flags = d?.flags || { overtimeRisk: [], noShows: [], stillClockedIn: [] }
  const hasFlags = flags.overtimeRisk.length || flags.noShows.length || flags.stillClockedIn.length

  return (
    <section className="space-y-4">
      {/* header row */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-ink flex items-center gap-1.5"><Clock size={15} /> Labor</h2>
        <div className="flex items-center gap-1 ml-2">
          {MARKETS.map(m => (
            <button key={m.k} onClick={() => setMarket(m.k)}
              className={'text-[11px] font-semibold px-2 py-0.5 rounded-lg border ' + (market === m.k ? 'bg-ink text-white border-ink' : 'text-muted border-line hover:text-ink')}>{m.l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {RANGES.map(r => (
            <button key={r.d} onClick={() => setDays(r.d)}
              className={'text-[11px] font-semibold px-1.5 py-0.5 rounded ' + (days === r.d ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{r.l}</button>
          ))}
          <button onClick={load} className="text-muted hover:text-ink p-1" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div>}

      {/* CLEANING ECONOMICS — revenue vs what cleaners were paid */}
      <div className="rounded-xl border border-line bg-white px-3 py-4">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3 flex items-center gap-1">
          <DollarSign size={11} /> Cleaning economics
          <span className="normal-case font-normal">· fees collected vs task pay (Breezeway)</span>
          {attr.rate != null && (
            <span className={'ml-auto normal-case font-semibold ' + (attr.reliable ? 'text-emerald-700' : 'text-amber-700')}>
              attribution {Math.round((attr.rate || 0) * 100)}%{attr.reliable ? ' ✓' : ' — fix assignees before ranking people'}
            </span>
          )}
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-y-4">
          <Stat label="Cleaning revenue" value={loading ? '…' : fmt$(eco.cleaningRevenue)} sub="guest fees, checkouts in window" />
          <Stat label="Cleaning labor" value={loading ? '…' : fmt$(eco.cleaningLaborCost)} sub="task pay (rate_paid)" />
          <Stat label="Margin" value={loading ? '…' : fmt$(eco.cleaningMargin)}
            sub={eco.cleaningMarginPct != null ? eco.cleaningMarginPct + '%' : ''}
            good={eco.cleaningMargin > 0} warn={eco.cleaningMargin < 0} />
          <Stat label="Rev per labor $" value={loading ? '…' : (eco.revenuePerLaborDollar != null ? '$' + eco.revenuePerLaborDollar : '—')} />
          <Stat label="Hours worked" value={loading ? '…' : String(d?.totalActualHours ?? '—')} sub={d ? 'of ' + d.totalScheduledHours + ' scheduled (Homebase)' : ''} />
        </div>
      </div>

      {/* TASKS COMPLETED */}
      <div className="rounded-xl border border-line bg-white px-3 py-4">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-2 mb-3 flex items-center gap-1">
          <ClipboardList size={11} /> Tasks completed <span className="normal-case font-normal">· Breezeway, this window</span>
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
              <span><b>Overtime risk this workweek{d?.week ? ` (${d.week.weekStart} start)` : ''}:</b> {flags.overtimeRisk.join(', ')}</span>
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
              <span><b>Open timecards (missed punch?):</b> {flags.stillClockedIn.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      {/* PER-CLEANER: revenue generated vs pay */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-4 pt-3 pb-1">
          Cleaners · revenue generated vs pay
        </p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted border-b border-line">
              <th className="text-left font-semibold px-4 py-2">Cleaner</th>
              <th className="text-right font-semibold px-2 py-2">Cleans</th>
              <th className="text-right font-semibold px-2 py-2">Revenue</th>
              <th className="text-right font-semibold px-2 py-2">Pay</th>
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
                <td className="px-2 py-2 text-right tabular-nums text-ink">{fmt$(c.taskPay)}</td>
                <td className={'px-2 py-2 text-right tabular-nums ' + (c.margin < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>{fmt$(c.margin)}</td>
                <td className={'px-4 py-2 text-right tabular-nums font-bold ' + (c.revenuePerLaborDollar != null && c.revenuePerLaborDollar < 1 ? 'text-rose-700' : 'text-ink')}>
                  {c.revenuePerLaborDollar != null ? '$' + c.revenuePerLaborDollar : '—'}
                </td>
              </tr>
            ))}
            {!cleaners.length && !loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No completed cleans in this window{market !== 'all' ? ' for this market' : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* HOURS: Homebase per-person */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-4 pt-3 pb-1">
          Hours · Homebase {market !== 'all' && <span className="normal-case font-normal">(one Homebase location — hours are portfolio-wide)</span>}
        </p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted border-b border-line">
              <th className="text-left font-semibold px-4 py-2">Person</th>
              <th className="text-right font-semibold px-2 py-2">Sched</th>
              <th className="text-right font-semibold px-2 py-2">Actual</th>
              <th className="text-right font-semibold px-2 py-2">Var</th>
              <th className="text-right font-semibold px-4 py-2">Wk proj</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p: any) => {
              const V = p.varianceHours > 0.5 ? TrendingUp : p.varianceHours < -0.5 ? TrendingDown : Minus
              return (
                <tr key={p.name} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-2 text-ink font-medium">
                    {p.name}
                    {p.overtimeRisk && <span className="ml-2 text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">OT risk</span>}
                    {p.openTimecard && <span className="ml-2 text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">clocked in</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{p.scheduledHours}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">{p.actualHours}</td>
                  <td className={'px-2 py-2 text-right tabular-nums ' + (Math.abs(p.varianceHours) > 2 ? 'text-rose-700 font-semibold' : 'text-muted')}>
                    <V size={11} className="inline mr-0.5 -mt-0.5" />{p.varianceHours > 0 ? '+' : ''}{p.varianceHours}
                  </td>
                  <td className={'px-4 py-2 text-right tabular-nums ' + (p.overtimeRisk ? 'text-rose-700 font-bold' : 'text-muted')}>{p.projectedWeekHours}h</td>
                </tr>
              )
            })}
            {!people.length && !loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No Homebase data in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

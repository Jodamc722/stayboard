'use client'
// components/LaborPanel.tsx — drop into the /labor page.
// Follows the Lighthouse conventions used elsewhere (ink/muted/line/app tokens,
// rounded-xl cards, Fold pattern from ReviewKpis).
import { useCallback, useEffect, useState } from 'react'
import { Clock, AlertTriangle, TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react'

const RANGES = [{ d: 7, l: '7d' }, { d: 14, l: '14d' }, { d: 30, l: '30d' }]

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="text-center px-2">
      <div className={'text-[22px] font-bold tabular-nums ' + (warn ? 'text-rose-700' : 'text-ink')}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mt-0.5">{label}</div>
      {sub && <div className="text-[10.5px] text-muted">{sub}</div>}
    </div>
  )
}

export function LaborPanel() {
  const [days, setDays] = useState(7)
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/labor/kpi?days=' + days, { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not load labor data')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [days])
  useEffect(() => { load() }, [load])

  const fmt$ = (n: number | null) => n == null ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  const people = d?.people || []
  const flags = d?.flags || { overtimeRisk: [], noShows: [], stillClockedIn: [] }
  const hasFlags = flags.overtimeRisk.length || flags.noShows.length || flags.stillClockedIn.length

  return (
    <section className="space-y-4">
      {/* header row */}
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-bold text-ink flex items-center gap-1.5"><Clock size={15} /> Labor</h2>
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

      {/* headline stats */}
      <div className="rounded-xl border border-line bg-white px-3 py-4">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-y-4">
          <Stat label="Actual hours" value={d ? String(d.totalActualHours) : '…'} sub={d ? 'of ' + d.totalScheduledHours + ' scheduled' : ''} />
          <Stat label="Variance" value={d ? (d.totalActualHours - d.totalScheduledHours > 0 ? '+' : '') + Math.round((d.totalActualHours - d.totalScheduledHours) * 10) / 10 + 'h' : '…'}
            warn={d && d.totalActualHours - d.totalScheduledHours > 4} />
          <Stat label="Overtime" value={d ? d.totalOvertimeHours + 'h' : '…'} warn={d && d.totalOvertimeHours > 0} />
          <Stat label="Labor cost" value={d ? fmt$(d.totalLaborCost) : '…'}
            sub={d && d.costDataCoverage < 1 ? Math.round(d.costDataCoverage * 100) + '% of cards have wages' : ''} />
          <Stat label="Hrs / clean" value={d?.hoursPerClean != null ? String(d.hoursPerClean) : '—'}
            sub={d?.cleansCompleted != null ? d.cleansCompleted + ' cleans' : ''} />
          <Stat label="Cost / occ. night" value={d ? fmt$(d.laborCostPerOccupiedNight) : '…'} />
        </div>
      </div>

      {/* flags */}
      {!!hasFlags && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
          {flags.overtimeRisk.length > 0 && (
            <p className="text-[13px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><b>Overtime risk this week:</b> {flags.overtimeRisk.join(', ')} — projected ≥ 40h. Trim remaining shifts or expect OT pay.</span>
            </p>
          )}
          {flags.noShows.length > 0 && (
            <p className="text-[13px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><b>Scheduled, never clocked in:</b> {flags.noShows.map((n: any) => n.name + ' (' + n.date.slice(5) + ')').join(', ')}</span>
            </p>
          )}
          {flags.stillClockedIn.length > 0 && (
            <p className="text-[13px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><b>Open timecards (missed punch?):</b> {flags.stillClockedIn.join(', ')} — inflates hours until closed.</span>
            </p>
          )}
        </div>
      )}

      {/* per-person table */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted border-b border-line">
              <th className="text-left font-semibold px-4 py-2.5">Person</th>
              <th className="text-right font-semibold px-2 py-2.5">Sched</th>
              <th className="text-right font-semibold px-2 py-2.5">Actual</th>
              <th className="text-right font-semibold px-2 py-2.5">Var</th>
              <th className="text-right font-semibold px-2 py-2.5">OT</th>
              <th className="text-right font-semibold px-2 py-2.5">Cost</th>
              <th className="text-right font-semibold px-4 py-2.5">Wk proj</th>
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
                  <td className={'px-2 py-2 text-right tabular-nums ' + (p.overtimeHours > 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>{p.overtimeHours || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{p.laborCost != null ? '$' + p.laborCost.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</td>
                  <td className={'px-4 py-2 text-right tabular-nums ' + (p.projectedWeekHours >= 40 ? 'text-rose-700 font-bold' : 'text-muted')}>{p.projectedWeekHours}h</td>
                </tr>
              )
            })}
            {!people.length && !loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">No labor data in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

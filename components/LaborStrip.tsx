'use client'
// components/LaborStrip.tsx (v2) — collapsible team roster from Homebase.
// Mounted on /schedule and /plan (Today in Ops). Homebase is the source of
// truth: who is scheduled today, who is clocked in right now, hours worked,
// payroll accrued vs scheduled, and per-person hour warnings (over schedule,
// OT risk this workweek). Auto-refreshes every 5 minutes. Never blocks the page.
import { useEffect, useState } from 'react'
import { Zap, ChevronRight, AlertTriangle } from 'lucide-react'

const KEY = 'sb_team_open'
const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function LaborStrip() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => { try { if (localStorage.getItem(KEY) === '1') setOpen(true) } catch {} }, [])
  const toggle = () => setOpen(o => { try { localStorage.setItem(KEY, o ? '0' : '1') } catch {}; return !o })

  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/labor/kpi?days=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.ok) setD(j); else setErr(true) })
      .catch(() => { if (alive) setErr(true) })
    load()
    const iv = setInterval(load, 5 * 60 * 1000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  if (err) return null
  const t = d?.today
  const clocked = t?.clockedInNow || []
  const people = (d?.people || []).filter((p: any) => p.scheduledHours > 0 || p.actualHours > 0)
  const otRisk = d?.flags?.overtimeRisk || []
  const noShows = (d?.flags?.noShows || []).map((n: any) => n.name)
  const over = people.filter((p: any) => p.scheduledHours > 0 && p.actualHours > p.scheduledHours + 0.5)

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/50 overflow-hidden">
      <button onClick={toggle} className="w-full px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-left">
        <span className="font-bold text-indigo-700 uppercase tracking-wide text-[10px] flex items-center gap-1">
          <ChevronRight size={12} className={'transition-transform ' + (open ? 'rotate-90' : '')} />
          <Zap size={11} /> Team today
        </span>
        {!d ? <span className="text-muted">loading…</span> : (
          <>
            <span><b className="text-ink">{clocked.length}</b> <span className="text-muted">clocked in</span></span>
            <span><b className="text-ink">{people.length}</b> <span className="text-muted">on schedule</span></span>
            <span><b className="text-ink">{t?.hoursSoFar ?? 0}h</b> <span className="text-muted">worked</span></span>
            <span><b className="text-ink">{fmt$(t?.payrollSoFar)}</b> <span className="text-muted">of {fmt$(t?.scheduledPayroll)} sched payroll</span></span>
            {(otRisk.length > 0 || over.length > 0) && (
              <span className="text-rose-700 font-semibold flex items-center gap-1"><AlertTriangle size={12} />{otRisk.length > 0 ? `${otRisk.length} OT risk` : ''}{otRisk.length > 0 && over.length > 0 ? ' · ' : ''}{over.length > 0 ? `${over.length} over schedule` : ''}</span>
            )}
            <span className="ml-auto text-indigo-700 font-semibold">{open ? 'hide' : 'details'}</span>
          </>
        )}
      </button>

      {open && d && (
        <div className="px-4 pb-3">
          <table className="w-full text-[12.5px] bg-white rounded-lg overflow-hidden">
            <thead>
              <tr className="text-[9.5px] uppercase tracking-wide text-muted border-b border-line">
                <th className="text-left font-semibold px-3 py-1.5">Person</th>
                <th className="text-right font-semibold px-2 py-1.5">Sched</th>
                <th className="text-right font-semibold px-2 py-1.5">Worked</th>
                <th className="text-right font-semibold px-2 py-1.5">Wk proj</th>
                <th className="text-right font-semibold px-3 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p: any) => {
                const isIn = clocked.some((n: string) => n === p.name)
                const isOver = p.scheduledHours > 0 && p.actualHours > p.scheduledHours + 0.5
                const isNoShow = noShows.includes(p.name)
                return (
                  <tr key={p.name} className="border-b border-line/40 last:border-0">
                    <td className="px-3 py-1.5 text-ink font-medium">{p.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.scheduledHours}h</td>
                    <td className={'px-2 py-1.5 text-right tabular-nums ' + (isOver ? 'text-rose-700 font-bold' : 'font-semibold text-ink')}>{p.actualHours}h</td>
                    <td className={'px-2 py-1.5 text-right tabular-nums ' + (p.overtimeRisk ? 'text-rose-700 font-bold' : 'text-muted')}>{p.projectedWeekHours}h</td>
                    <td className="px-3 py-1.5 text-right">
                      {isIn && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 ml-1">clocked in</span>}
                      {isOver && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 ml-1">over sched</span>}
                      {p.overtimeRisk && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">OT risk</span>}
                      {isNoShow && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 ml-1">no show</span>}
                      {!isIn && !isOver && !p.overtimeRisk && !isNoShow && <span className="text-[11px] text-muted">—</span>}
                    </td>
                  </tr>
                )
              })}
              {!people.length && <tr><td colSpan={5} className="px-3 py-3 text-center text-muted">Nobody scheduled today.</td></tr>}
            </tbody>
          </table>
          <div className="mt-1.5 text-right"><a href="/labor" className="text-[11.5px] text-indigo-700 font-semibold hover:underline">Full labor board →</a></div>
        </div>
      )}
    </div>
  )
}

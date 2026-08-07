'use client'
// components/LaborStrip.tsx — one-line labor pulse for the Schedule page.
// Today's staffing cost vs revenue at a glance: who's on the clock, payroll
// accrued vs scheduled, cleaning revenue landing today. Data: /api/labor/kpi.
import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function LaborStrip() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    fetch('/api/labor/kpi?days=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.ok) setD(j); else setErr(true) })
      .catch(() => setErr(true))
  }, [])

  if (err) return null   // never block the schedule on labor data
  const t = d?.today
  const clocked = t?.clockedInNow || []

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/50 px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
      <span className="font-bold text-indigo-700 uppercase tracking-wide text-[10px] flex items-center gap-1"><Zap size={11} /> Labor today</span>
      {!d ? (
        <span className="text-muted">loading…</span>
      ) : (
        <>
          <span><b className="text-ink">{clocked.length}</b> <span className="text-muted">clocked in{clocked.length ? ' — ' + clocked.slice(0, 3).join(', ') + (clocked.length > 3 ? ` +${clocked.length - 3}` : '') : ''}</span></span>
          <span><b className="text-ink">{t?.hoursSoFar ?? 0}h</b> <span className="text-muted">worked</span></span>
          <span><b className="text-ink">{fmt$(t?.payrollSoFar)}</b> <span className="text-muted">payroll of {fmt$(t?.scheduledPayroll)} scheduled</span></span>
          <span><b className="text-ink">{fmt$(t?.cleaningRevenueToday)}</b> <span className="text-muted">cleaning revenue today</span></span>
          {(d?.flags?.overtimeRisk?.length ?? 0) > 0 && (
            <span className="text-rose-700 font-semibold">OT risk: {d.flags.overtimeRisk.join(', ')}</span>
          )}
          <a href="/labor" className="ml-auto text-indigo-700 font-semibold hover:underline">Labor board →</a>
        </>
      )}
    </div>
  )
}

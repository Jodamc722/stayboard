'use client'
// components/LaborEconStrip.tsx - the labor economics summary, ONE source of truth.
// Reads /api/labor/kpi (same endpoint as /labor, the briefs and the schedule strip)
// so every surface shows the same numbers. Manager-facing: dollar amounts included.
// Mount anywhere a scheduling/margin decision gets made: home KPI board, /billing, /labor.
import { useEffect, useState } from 'react'
import { DollarSign, ArrowRight } from 'lucide-react'

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US')

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-700' : 'text-ink'
  return (
    <div className="text-center px-2">
      <div className={'text-[17px] font-bold tabular-nums ' + color}>{value}</div>
      <div className="text-[9.5px] uppercase tracking-wide text-muted font-semibold mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  )
}

export function LaborEconStrip({ days = 7 }: { days?: number }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let dead = false
    fetch('/api/labor/kpi?days=' + days, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!dead) (j && j.ok ? setD(j) : setErr(true)) })
      .catch(() => { if (!dead) setErr(true) })
    return () => { dead = true }
  }, [days])
  if (err) return null
  const hk = d?.departments?.housekeeping
  const mt = d?.departments?.maintenance
  const sup = d?.departments?.supervision
  const econ = d?.econ
  const pay = d?.payroll
  const band = pay?.band
  const bandTone = band === 'over' ? 'bad' : band === 'watch' ? 'warn' : band === 'on_target' ? 'good' : undefined
  const L0 = !d
  const v = (x: any, f?: (n: any) => string) => (L0 ? '—' : x == null ? '—' : f ? f(x) : String(x))
  return (
    <section className="rounded-xl border border-line bg-white px-3 py-3">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold flex items-center gap-1">
          <DollarSign size={11} /> Labor economics - last {days}d</p>
        <a href="/labor" className="text-[11px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-0.5">Full labor board <ArrowRight size={11} /></a>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-y-3 items-start">
        <Tile label="Cost / clean" value={v(hk?.costPerClean, fmt$)} sub="housekeepers only" />
        <Tile label="Fee / clean" value={v(hk?.feePerClean, fmt$)} sub="in-house units" />
        <Tile label="HK margin" value={v(hk?.margin, fmt$)} tone={hk && hk.margin < 0 ? 'bad' : 'good'} sub="fees - HK wages" />
        <Tile label="Maint billable" value={v(mt?.billableRevenue, fmt$)} sub="charge on the task" />
        <Tile label="Maint margin" value={v(mt?.margin ?? mt?.billableMargin, fmt$)} tone={mt && (mt.margin ?? mt.billableMargin) < 0 ? 'bad' : 'good'} sub={L0 ? undefined : 'vs ' + fmt$(mt?.payroll) + ' wages'} />
        <Tile label="Supervisors" value={v(sup?.payroll, fmt$)} sub={L0 ? undefined : (sup?.coveragePct != null ? sup.coveragePct + '% of mgmt fees' : 'overhead')} />
        <Tile label="Payroll" value={v(pay?.actual, fmt$)} sub={L0 ? undefined : 'sched ' + fmt$(pay?.scheduled)} />
        <Tile label="Total margin" value={v(econ?.margin, fmt$)} tone={econ && econ.margin < 0 ? 'bad' : 'good'} sub={L0 ? undefined : 'cleaning + billable - payroll'} />
        <Tile label="Labor %" value={v(pay?.laborPct, (n) => n + '%')} tone={bandTone as any} sub={L0 ? undefined : 'goal <= ' + (pay?.goalPct ?? '—') + '%'} />
      </div>
    </section>
  )
}

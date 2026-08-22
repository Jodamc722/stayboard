'use client'
// LIVE LABOR DASHBOARD (Jon, 2026-08-10: "a live labor dashboard I can click into at any time,
// this will show all the details, sort by date, week, month etc. Auto updates").
//
// Same numbers as the morning email — both read /api/labor/report — so the screen can never
// disagree with the inbox. What is off leads; the detail sits underneath it.
//
// BILLABLES ARE ON THEIR OWN CLOCK. Owner billing detail gets edited days after the work, so a
// one-day slice of it is always stale and always low. That block covers a rolling 45 days and
// re-reads on every load, which is why its window says something different to the rest of the page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Timer, RefreshCw, AlertTriangle, AlertOctagon, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react'

type Dept = 'housekeeping' | 'maintenance' | 'inspection' | 'other'
type Flag = { level: 'red' | 'amber'; kind: string; title: string; detail: string; people?: string[] }
type PersonRow = {
  name: string; role: string | null; dept: Dept
  hours: number; overtime: number; payroll: number; days: number
  cleans: number; tasks: number; taskHours: number
  coveragePct: number | null; costPerClean: number | null
}
type Report = {
  ok: boolean; from: string; to: string; days: number; label: string; generatedAt: string
  totals: { hours: number; overtime: number; payroll: number; people: number }
  byDept: Record<Dept, { hours: number; payroll: number; people: number }>
  checkouts: number; vendorCheckouts: number; departureClosed: number
  mix: Record<string, { tasks: number; hours: number; materials: number }>
  cleaningRevenue: number
  costPerClean: number | null; hoursPerClean: number | null; feePerClean: number | null
  cleaningMargin: number | null; cleaningMarginPct: number | null
  laborPctOfRevenue: number | null; band: 'on_target' | 'watch' | 'over' | 'no_data'
  billable: { from: string; to: string; days: number; billed: number; tasks: number; tasksWithBilling: number; tasksMissingDetail: number; hours: number; maintenancePayroll: number; margin: number }
  people: PersonRow[]
  flags: Flag[]
  settings: { pct_good: number; pct_bad: number }
  error?: string
}

const money = (n: number | null | undefined) => n == null ? '—' : (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }

const MIX_LABEL: Record<string, string> = {
  departure: 'Departure cleans', otherClean: 'Other housekeeping',
  inspection: 'Inspections', maintenance: 'Maintenance', other: 'Everything else',
}
const DEPT_LABEL: Record<Dept, string> = {
  housekeeping: 'Housekeeping', maintenance: 'Maintenance', inspection: 'Inspections', other: 'Other roles',
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' | 'good' }) {
  const c = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-700' : 'text-ink'
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">{label}</div>
      <div className={'text-2xl font-bold tabular-nums mt-1 tracking-tight ' + c}>{value}</div>
      {sub ? <div className="text-[11px] text-muted mt-0.5">{sub}</div> : null}
    </div>
  )
}

export function LaborDashboard() {
  const today = ymd(new Date())
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  const [anchor, setAnchor] = useState(shift(today, -1))   // yesterday, same as the email
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sortKey, setSortKey] = useState<keyof PersonRow>('payroll')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [auto, setAuto] = useState(true)
  const timer = useRef<any>(null)

  const load = useCallback(async (quiet?: boolean) => {
    if (!quiet) { setLoading(true); setErr('') }
    try {
      const r = await fetch('/api/labor/report?period=' + period + '&anchor=' + anchor, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load the labor report.')
      setData(j)
    } catch (e: any) { if (!quiet) setErr(String(e?.message || e)) }
    if (!quiet) setLoading(false)
  }, [period, anchor])
  useEffect(() => { load() }, [load])

  // Auto-update. Five minutes is well inside how fast a timecard or a billing edit matters, and
  // the refetch is quiet so the page never flashes a spinner at someone mid-read.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (auto) timer.current = setInterval(() => load(true), 5 * 60 * 1000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [auto, load])

  const step = (dir: number) => {
    setAnchor(a => period === 'day' ? shift(a, dir)
      : period === 'week' ? shift(a, dir * 7)
      : (() => { const d = new Date(a + 'T12:00:00'); d.setMonth(d.getMonth() + dir); return ymd(d) })())
  }

  const people = useMemo(() => {
    const rows = (data?.people || []).slice()
    rows.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      const n = (typeof av === 'number' ? av : -1) - (typeof bv === 'number' ? bv : -1)
      const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : n
      return sortDir === 'desc' ? -cmp : cmp
    })
    return rows
  }, [data, sortKey, sortDir])

  const sortBy = (k: keyof PersonRow) => {
    if (k === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc') }
  }
  const Th = ({ k, children, right }: { k: keyof PersonRow; children: any; right?: boolean }) => (
    <th onClick={() => sortBy(k)}
      className={'px-3 py-2 font-semibold cursor-pointer select-none hover:text-ink ' + (right ? 'text-right' : 'text-left') + (sortKey === k ? ' text-ink' : '')}>
      {children}{sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  )

  const csv = () => {
    if (!data) return
    const head = ['Person', 'Role', 'Department', 'Days', 'Hours', 'Overtime', 'Payroll', 'Cleans', 'Tasks', 'Task hours', 'Coverage %', 'Cost/clean']
    const lines = [head.join(',')].concat(people.map(p => [
      p.name, p.role || '', p.dept, p.days, p.hours, p.overtime, p.payroll, p.cleans, p.tasks, p.taskHours,
      p.coveragePct ?? '', p.costPerClean ?? '',
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'labor-' + data.from + '_' + data.to + '.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const bandTone = data?.band === 'over' ? 'bad' : data?.band === 'watch' ? 'warn' : data?.band === 'on_target' ? 'good' : undefined

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-xl border border-line bg-white shadow-soft overflow-hidden">
          {(['day', 'week', 'month'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={'px-3 py-1.5 text-[12.5px] font-semibold capitalize ' + (period === p ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-xl border border-line bg-white shadow-soft overflow-hidden">
          <button onClick={() => step(-1)} className="px-2 py-1.5 text-muted hover:text-ink" aria-label="Previous"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-2 text-[12.5px] font-semibold text-ink whitespace-nowrap">{data?.label || '…'}</span>
          <button onClick={() => step(1)} disabled={data ? data.to >= today : false}
            className="px-2 py-1.5 text-muted hover:text-ink disabled:opacity-30" aria-label="Next"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <button onClick={() => { setPeriod('day'); setAnchor(shift(today, -1)) }}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft">Yesterday</button>
        <span className="flex-1" />
        <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted cursor-pointer" title="Refetch every 5 minutes">
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} className="accent-brand-600 w-4 h-4" />
          Auto-update
        </label>
        <button onClick={csv} disabled={!people.length}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button onClick={() => load()} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
          <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
        </button>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}
      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Reading Homebase, Breezeway and Guesty…
        </div>
      ) : null}

      {data ? (
        <>
          {/* WHAT LOOKS OFF, first. A report that buries its exceptions under its totals gets read
              once and then skimmed forever. */}
          {data.flags.length ? (
            <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
              <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                <AlertOctagon size={15} className="text-rose-500" />
                <span className="text-sm font-bold text-ink">What looks off</span>
                <span className="text-[11px] text-muted">{data.flags.length} item{data.flags.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y divide-line">
                {data.flags.map((f, i) => (
                  <div key={f.kind + i} className={'px-4 py-3 ' + (f.level === 'red' ? 'bg-rose-50/40' : '')}>
                    <div className="flex items-start gap-2">
                      <span className={'text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded mt-0.5 ' + (f.level === 'red' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}>
                        {f.level === 'red' ? 'action' : 'watch'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-ink">{f.title}</p>
                        <p className="text-[12px] text-muted mt-0.5">{f.detail}</p>
                        {f.people?.length ? <p className="text-[11.5px] text-ink/70 mt-1">{f.people.join(' · ')}</p> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12.5px] text-emerald-800 font-semibold">
              Nothing looks off for {data.label}.
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Payroll" value={money(data.totals.payroll)} sub={data.totals.hours + 'h · ' + data.totals.people + ' people'} />
            <Stat label="Overtime" value={data.totals.overtime + 'h'} sub="the most expensive hour we buy" tone={data.totals.overtime > 0 ? 'warn' : undefined} />
            <Stat label="Cleans" value={String(data.checkouts)} sub={data.departureClosed + ' closed in Breezeway'} />
            <Stat label="Cost / clean" value={money(data.costPerClean)} sub="housekeeping wages ÷ checkouts" />
            <Stat label="Time / clean" value={data.hoursPerClean != null ? data.hoursPerClean + 'h' : '—'} sub="housekeeping hours ÷ checkouts" />
            <Stat label="Labor % of rev" value={data.laborPctOfRevenue != null ? data.laborPctOfRevenue + '%' : '—'}
              sub={'goal ≤ ' + data.settings.pct_good + '%'} tone={bandTone as any} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* payroll by department */}
            <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
              <div className="px-4 py-3 border-b border-line text-sm font-bold text-ink">Payroll by department</div>
              <table className="w-full text-[12.5px]">
                <thead><tr className="bg-app text-muted text-[10px] uppercase tracking-wider">
                  <th className="px-3 py-2 text-left font-semibold">Department</th>
                  <th className="px-3 py-2 text-right font-semibold">People</th>
                  <th className="px-3 py-2 text-right font-semibold">Hours</th>
                  <th className="px-3 py-2 text-right font-semibold">Payroll</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {(Object.keys(data.byDept) as Dept[]).filter(d => data.byDept[d].hours > 0).map(d => (
                    <tr key={d}>
                      <td className="px-3 py-2 font-semibold text-ink">{DEPT_LABEL[d]}</td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums">{data.byDept[d].people}</td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums">{data.byDept[d].hours}h</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(data.byDept[d].payroll)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ink">
                    <td className="px-3 py-2 font-bold text-ink">Total</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{data.totals.people}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{data.totals.hours}h</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{money(data.totals.payroll)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* work completed */}
            <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
              <div className="px-4 py-3 border-b border-line text-sm font-bold text-ink">Work completed</div>
              <table className="w-full text-[12.5px]">
                <thead><tr className="bg-app text-muted text-[10px] uppercase tracking-wider">
                  <th className="px-3 py-2 text-left font-semibold">Kind of work</th>
                  <th className="px-3 py-2 text-right font-semibold">Tasks</th>
                  <th className="px-3 py-2 text-right font-semibold">Hours</th>
                  <th className="px-3 py-2 text-right font-semibold">Billed</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {Object.keys(MIX_LABEL).filter(k => data.mix[k] && data.mix[k].tasks > 0).map(k => (
                    <tr key={k}>
                      <td className="px-3 py-2 font-semibold text-ink">{MIX_LABEL[k]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{data.mix[k].tasks}</td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums">{data.mix[k].hours}h</td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums">{data.mix[k].materials ? money(data.mix[k].materials) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-2 text-[11px] text-muted border-t border-line">
                {data.checkouts} in-house checkouts owed a clean; {data.departureClosed} departure cleans were closed.
                {data.vendorCheckouts ? ' ' + data.vendorCheckouts + ' more checkouts belong to vendor-cleaned buildings.' : ''}
              </p>
            </div>
          </div>

          {/* cleaning money */}
          <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
            <div className="px-4 py-3 border-b border-line text-sm font-bold text-ink">Cleaning money</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-line">
              <div className="px-4 py-3"><div className="text-[10.5px] uppercase tracking-wider text-muted font-bold">Guest fees</div><div className="text-lg font-bold tabular-nums">{money(data.cleaningRevenue)}</div><div className="text-[11px] text-muted">{data.feePerClean != null ? money(data.feePerClean) + ' per turn' : ''}</div></div>
              <div className="px-4 py-3"><div className="text-[10.5px] uppercase tracking-wider text-muted font-bold">HK payroll</div><div className="text-lg font-bold tabular-nums">{money(data.byDept.housekeeping.payroll)}</div><div className="text-[11px] text-muted">{data.byDept.housekeeping.hours}h clocked</div></div>
              <div className="px-4 py-3"><div className="text-[10.5px] uppercase tracking-wider text-muted font-bold">Margin</div><div className={'text-lg font-bold tabular-nums ' + ((data.cleaningMargin ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700')}>{money(data.cleaningMargin)}</div><div className="text-[11px] text-muted">{data.cleaningMarginPct != null ? data.cleaningMarginPct + '%' : ''}</div></div>
              <div className="px-4 py-3"><div className="text-[10.5px] uppercase tracking-wider text-muted font-bold">Cost / clean</div><div className="text-lg font-bold tabular-nums">{money(data.costPerClean)}</div><div className="text-[11px] text-muted">departure cleans only</div></div>
            </div>
          </div>

          {/* billables — its own window, deliberately */}
          <div className="rounded-2xl border border-brand-200 bg-brand-50/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-200 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-ink">Billable work</span>
              <span className="text-[11px] text-muted">rolling {data.billable.days} days · {data.billable.from} → {data.billable.to} · re-read on every load</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-brand-200/60">
              <div className="px-4 py-3"><div className="text-[10.5px] uppercase tracking-wider text-muted font-bold">Billed to owners</div><div className="text-lg font-bold tabular-nums">{money(data.billable.billed)}</div><div className="text-[11px] text-muted">entered on the tasks in Breezeway</div></div>
              <div className="px-4 py-3"><div className="text-[10.5px] uppercase tracking-wider text-muted font-bold">Tasks with a cost</div><div className={'text-lg font-bold tabular-nums ' + (data.billable.tasksWithBilling < data.billable.tasks / 2 ? 'text-amber-600' : '')}>{data.billable.tasksWithBilling}<span className="text-muted font-normal"> / {data.billable.tasks}</span></div><div className="text-[11px] text-muted">the rest bill nothing</div></div>
              <div className="px-4 py-3"><div className="text-[10.5px] uppercase tracking-wider text-muted font-bold">Maint payroll</div><div className="text-lg font-bold tabular-nums">{money(data.billable.maintenancePayroll)}</div><div className="text-[11px] text-muted">clocked wages</div></div>
              <div className="px-4 py-3"><div className="text-[10.5px] uppercase tracking-wider text-muted font-bold">Margin</div><div className={'text-lg font-bold tabular-nums ' + (data.billable.margin < 0 ? 'text-rose-600' : 'text-emerald-700')}>{money(data.billable.margin)}</div><div className="text-[11px] text-muted">billed less wages</div></div>
            </div>
            <p className="px-4 py-2 text-[11px] text-muted border-t border-brand-200/60">
              This is the amount actually entered against each task in Breezeway — nothing priced or estimated. Only {data.billable.tasksWithBilling} of {data.billable.tasks} tasks
              carry one, so the margin is a floor. {data.billable.hours}h of time was logged on these tasks, shown for context only.
              Billing gets edited days after the work, so this window is deliberately wider than the rest of the page — a correction
              made this morning to a task from five weeks ago shows up here immediately.
            </p>
          </div>

          {/* per person */}
          <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <Timer size={15} className="text-brand-600" />
              <span className="text-sm font-bold text-ink">Per person</span>
              <span className="text-[11px] text-muted">click a column to sort</span>
            </div>
            {/* Ten sortable columns. Inside a scroller w-full alone shrinks the table to the phone
                instead of scrolling it, so every number column collapsed. */}
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] min-w-[900px]">
                <thead><tr className="bg-app text-muted text-[10px] uppercase tracking-wider">
                  <Th k="name">Person</Th>
                  <Th k="dept">Dept</Th>
                  <Th k="days" right>Days</Th>
                  <Th k="hours" right>Hours</Th>
                  <Th k="overtime" right>OT</Th>
                  <Th k="payroll" right>Payroll</Th>
                  <Th k="cleans" right>Cleans</Th>
                  <Th k="tasks" right>Tasks</Th>
                  <Th k="coveragePct" right>On task</Th>
                  <Th k="costPerClean" right>Cost/clean</Th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {people.map(p => (
                    <tr key={p.name} className="hover:bg-app/50">
                      <td className="px-3 py-2 font-semibold text-ink whitespace-nowrap">{p.name}
                        {p.role ? <span className="block text-[10.5px] text-muted font-normal">{p.role}</span> : null}</td>
                      <td className="px-3 py-2 text-muted">{DEPT_LABEL[p.dept]}</td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums">{p.days}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.hours}</td>
                      <td className={'px-3 py-2 text-right tabular-nums ' + (p.overtime > 0 ? 'text-amber-600 font-semibold' : 'text-muted')}>{p.overtime || '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(p.payroll)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.cleans || '—'}</td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums">{p.tasks || '—'}</td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums" title={p.taskHours + 'h logged on tasks against ' + p.hours + 'h clocked'}>
                        {p.coveragePct != null ? p.coveragePct + '%' : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.costPerClean)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-3 py-2 text-[11px] text-muted border-t border-line flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              &ldquo;On task&rdquo; is time logged against Breezeway tasks as a share of clocked time — a low number means work is
              happening off the task list, not that someone is idle. Cleans credit both the assignee and whoever closed the task.
            </p>
          </div>

          <p className="text-[11px] text-muted">
            Updated {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            {auto ? ' · refreshing every 5 minutes' : ''} · same figures as the daily labor email.
          </p>
        </>
      ) : null}
    </div>
  )
}

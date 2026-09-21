'use client'
// LABOR BY DAY, BY CREW — the one KPI table.
//
// Jon, 2026-09-21: "track labor hours per turn, and margins of rev vs labor cost. This needs to be
// the most accurate KPI we track… HK alone, Supervisor alone, Maintenance alone vs billable labor
// recorded for the day."
//
// Reads /api/labor/days (lib/labor-day.ts): one engine run over the window, one row per ET day,
// three crews side by side. Housekeeping is judged on hours and cost PER TURN (HK-only — a turn a
// supervisor or a tech covered is shown, never divided into HK wages); supervisors and maintenance
// are judged on PAID HOURS vs BILLED HOURS — what the team actually entered on Breezeway tasks,
// which is a manual process and is exactly the number Jon is not confident in.
import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { CleanLog } from '@/components/CleanLog'

type Crew = { people: number; hours: number; payroll: number | null; punchPayroll: number | null; cleans: number; billable: number | null; billedHours: number | null; billedPct: number | null; names: string[] }
type Row = {
  d: string; dow: string
  crews: { housekeeping: Crew; supervision: Crew; maintenance: Crew; other: Crew }
  hk: { cleans: number; coveredByOthers: number; cleansTotal: number; fees: number | null; hoursPerClean: number | null; costPerClean: number | null; hoursPerCleanHkOnly: number | null; costPerCleanHkOnly: number | null; margin: number | null; marginPct: number | null }
  total: { hours: number; payroll: number | null; cleans: number; fees: number | null; billable: number | null; billedHours: number | null; margin: number | null }
}
type Data = {
  from: string; to: string; chargeRate: number; rows: Row[]; sum: Row; basis: string; moneyHidden: boolean
  health: {
    payrollComplete: boolean; failedWeeks: string[]; timecardsOutsideWindow: number
    feesNoCleanFound: number | null; excludedNonLive: { reservations: number; grossFees: number }
    excludedOwnerFF: { reservations: number; grossFees: number }; movedCleans: number
    unrostered: { people: number; payroll: number | null; names: string[] }
    unassignedMarket: { people: number; payroll: number | null; names: string[] }
    tasksNoCharge: number; salaried: string[]
  }
}

const money = (n: number | null | undefined) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'))
const hrs = (n: number | null | undefined) => (n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString('en-US') + 'h')
const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function drift(v: number | null, avg: number | null): 'high' | 'low' | null {
  if (v == null || avg == null || avg === 0) return null
  const x = (v - avg) / avg
  if (x > 0.15) return 'high'
  if (x < -0.15) return 'low'
  return null
}

const RANGES = [{ k: 7, l: '7d' }, { k: 14, l: '14d' }, { k: 28, l: '28d' }]

export function LaborDays({ market = 'all' }: { market?: string }) {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [days, setDays] = useState(14)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [showNames, setShowNames] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    const to = dISO(addDays(new Date(), -1))
    const from = dISO(addDays(new Date(to + 'T12:00:00Z'), -(days - 1)))
    fetch(`/api/labor/days?from=${from}&to=${to}&market=${encodeURIComponent(market)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j?.ok) setD(j); else setErr(j?.error || 'Could not build the day view.') })
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [days, market])
  useEffect(() => { load() }, [load])

  const sum = d?.sum
  const avgHpc = sum?.hk.hoursPerCleanHkOnly ?? null
  const avgCpc = sum?.hk.costPerClean ?? null
  const h = d?.health

  const cell = (v: string, cls = 'text-ink') => <td className={'py-1.5 pr-3 text-right tabular-nums ' + cls}>{v}</td>

  return (
    <div className="rounded-xl border border-line bg-white px-3 py-4">
      <div className="flex items-center justify-between gap-2 flex-wrap px-2 mb-1">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold flex items-center gap-1">
          <CalendarDays size={11} /> Labor by day, by crew
          <span className="normal-case font-normal">· hours per turn · paid hours vs billed hours</span>
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-app/40 p-0.5">
            {RANGES.map(r => (
              <button key={r.k} onClick={() => setDays(r.k)}
                className={`px-2 py-0.5 rounded text-[11.5px] font-semibold ${r.k === days ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>{r.l}</button>
            ))}
          </div>
          <button onClick={load} disabled={loading} className="text-muted hover:text-ink disabled:opacity-40" title="Rebuild">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>
      <p className="text-[10.5px] text-muted px-2 mb-3">{d?.basis || 'Homebase punches for hours and wages · departure turns housekeepers did · net fees on confirmed checkouts · charges the team entered on tasks.'}</p>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 mb-3 flex items-start gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{err}</div>}
      {loading && !d && <div className="px-2 py-8 text-center text-sm text-muted">Building {days} days through the labor engine — this takes a moment.</div>}

      {d && sum && (
        <>
          {/* Window health — named, never hidden (feedback-alerts-must-name-things). */}
          {h && (() => {
            const notes: { t: string; bad: boolean }[] = []
            if (!h.payrollComplete) notes.push({ t: `Homebase did not return every week (${h.failedWeeks.join(', ')}) — payroll understated`, bad: true })
            if (h.unrostered.people > 0) notes.push({ t: `${h.unrostered.people} on payroll with no crew${h.unrostered.payroll ? ` (${money(h.unrostered.payroll)})` : ''}: ${h.unrostered.names.slice(0, 4).join(', ')} — place them in Crew & roles`, bad: true })
            if (h.unassignedMarket.people > 0 && market !== 'all') notes.push({ t: `${h.unassignedMarket.people} with no Staffing area are off every market tab: ${h.unassignedMarket.names.slice(0, 4).join(', ')}`, bad: true })
            if (h.timecardsOutsideWindow > 0) notes.push({ t: `${h.timecardsOutsideWindow} Homebase cards dated outside the window were left out`, bad: false })
            if (h.excludedNonLive.reservations > 0) notes.push({ t: `${h.excludedNonLive.reservations} reservation rows that never became stays (inquiries, expired, pending) kept out of revenue${h.excludedNonLive.grossFees ? ` — ${money(h.excludedNonLive.grossFees)} of fees that were being counted before` : ''}`, bad: false })
            if (h.excludedOwnerFF.reservations > 0) notes.push({ t: `${h.excludedOwnerFF.reservations} owner / friends-&-family checkouts carry $0`, bad: false })
            if (h.feesNoCleanFound != null && h.feesNoCleanFound > 0) notes.push({ t: `${money(h.feesNoCleanFound)} of fees on confirmed checkouts with no departure clean found within 9 days`, bad: h.feesNoCleanFound > 1000 })
            if (h.movedCleans > 0) notes.push({ t: `${h.movedCleans} departure tasks deleted or cancelled in Breezeway (moved — not counted)`, bad: false })
            if (h.tasksNoCharge > 0) notes.push({ t: `${h.tasksNoCharge} maintenance tasks closed with no charge entered`, bad: h.tasksNoCharge > 50 })
            if (h.salaried.length) notes.push({ t: `salaries by the day: ${h.salaried.join(', ')} (punches shown beside)`, bad: false })
            if (!notes.length) return null
            return (
              <ul className="mb-3 px-2 space-y-0.5">
                {notes.map((n, i) => (
                  <li key={i} className={'text-[11.5px] flex items-start gap-1.5 ' + (n.bad ? 'text-amber-800' : 'text-muted')}>
                    <span className={'mt-[5px] h-1.5 w-1.5 rounded-full shrink-0 ' + (n.bad ? 'bg-amber-500' : 'bg-slate-300')} />{n.t}
                  </li>
                ))}
              </ul>
            )
          })()}

          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <table className="w-full text-[12.5px] min-w-[1180px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.09em] text-muted border-b border-line">
                  <th className="py-1 pr-3 text-left" rowSpan={2}>Day</th>
                  <th className="py-1 pr-3 text-center whitespace-nowrap border-l border-line/70 bg-emerald-50/40" colSpan={8}>Housekeeping · alone</th>
                  <th className="py-1 pr-3 text-center whitespace-nowrap border-l border-line/70 bg-sky-50/40" colSpan={4}>Supervisors · alone</th>
                  <th className="py-1 pr-3 text-center whitespace-nowrap border-l border-line/70 bg-amber-50/40" colSpan={4}>Maintenance · alone</th>
                  <th className="py-1 pr-3 text-center whitespace-nowrap border-l border-line/70" colSpan={3}>All crews</th>
                </tr>
                <tr className="text-[10px] uppercase tracking-[0.09em] text-muted border-b border-line">
                  <th className="py-1 pr-3 text-right whitespace-nowrap border-l border-line/70 bg-emerald-50/40">Turns · total</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-emerald-50/40">HK own</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-emerald-50/40">Hours</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-emerald-50/40">Payroll</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-emerald-50/40">$ / turn · total</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-emerald-50/40">$ / own</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-emerald-50/40">h / turn · own</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-emerald-50/40">Fees · margin</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap border-l border-line/70 bg-sky-50/40">Paid h</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-sky-50/40">Payroll</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-sky-50/40">Billed</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-sky-50/40">Turns</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap border-l border-line/70 bg-amber-50/40">Paid h</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-amber-50/40">Payroll</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-amber-50/40">Billed</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap bg-amber-50/40">Billed / paid</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap border-l border-line/70">Hours</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap">Payroll</th>
                  <th className="py-1 pr-3 text-right whitespace-nowrap">Rev − payroll</th>
                </tr>
              </thead>
              <tbody>
                {[...d.rows, sum].map((r, i) => {
                  const isSum = i === d.rows.length
                  const hk = r.crews.housekeeping, sp = r.crews.supervision, mt = r.crews.maintenance
                  const hpc = isSum ? null : drift(r.hk.hoursPerCleanHkOnly, avgHpc)
                  const cpc = isSum ? null : drift(r.hk.costPerClean, avgCpc)
                  const quiet = !isSum && r.total.hours === 0 && r.total.cleans === 0
                  const billedCls = (c: Crew) => c.hours > 0 && c.billedPct != null ? (c.billedPct >= 60 ? 'text-emerald-700' : c.billedPct >= 30 ? 'text-ink' : 'text-rose-700') : 'text-muted'
                  return (
                    <tr key={r.d || 'sum'} className={(isSum ? 'border-t-2 border-ink font-semibold ' : 'border-b border-line/60 ') + (quiet ? 'opacity-50' : '')}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {isSum ? <span className="text-[11px] uppercase tracking-wide text-muted">{d.rows.length} days</span> : (
                          <>
                            <span className="text-muted text-[11px] mr-1.5">{r.dow}</span>
                            <button onClick={() => setOpenDay(openDay === r.d ? null : r.d)}
                              className={`font-medium underline decoration-dotted underline-offset-2 hover:text-brand-700 ${openDay === r.d ? 'text-brand-700' : 'text-ink'}`}
                              title="See every clean this day">{dayLabel(r.d)}</button>
                          </>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums border-l border-line/70 font-semibold text-ink">{r.hk.cleansTotal}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        <button onClick={() => setShowNames(showNames === r.d + 'hk' ? null : r.d + 'hk')} className="text-ink hover:text-brand-700" title={hk.names.join(', ') || 'nobody'}>{r.hk.cleans}</button>
                        {r.hk.coveredByOthers > 0 && <span className="text-[10.5px] text-emerald-700 font-normal"> +{r.hk.coveredByOthers} covered</span>}
                      </td>
                      {cell(hrs(hk.hours), 'text-muted')}
                      {cell(money(hk.payroll), 'text-muted')}
                      {cell(money(r.hk.costPerClean), cpc === 'high' ? 'text-rose-700 font-semibold' : cpc === 'low' ? 'text-emerald-700 font-semibold' : 'text-ink font-semibold')}
                      {cell(money(r.hk.costPerCleanHkOnly), 'text-muted')}
                      {cell(r.hk.hoursPerCleanHkOnly == null ? '—' : r.hk.hoursPerCleanHkOnly + 'h', hpc === 'high' ? 'text-rose-700 font-semibold' : hpc === 'low' ? 'text-emerald-700 font-semibold' : 'text-ink')}
                      <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
                        <span className="text-muted">{money(r.hk.fees)}</span>
                        {r.hk.margin != null && <span className={'ml-1 ' + (r.hk.margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{money(r.hk.margin)}{r.hk.marginPct != null && <span className="text-[10.5px] font-normal"> · {r.hk.marginPct}%</span>}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums border-l border-line/70 text-ink" title={sp.names.join(', ')}>{hrs(sp.hours)}{sp.people > 0 && <span className="text-[10.5px] text-muted font-normal"> · {sp.people}</span>}</td>
                      {cell(money(sp.payroll), 'text-muted')}
                      {cell(sp.billable == null ? '—' : (sp.billable > 0 ? money(sp.billable) + ' · ' + hrs(sp.billedHours) : '—'), billedCls(sp))}
                      {cell(sp.cleans ? String(sp.cleans) : '—', 'text-muted')}
                      <td className="py-1.5 pr-3 text-right tabular-nums border-l border-line/70 text-ink" title={mt.names.join(', ')}>{hrs(mt.hours)}{mt.people > 0 && <span className="text-[10.5px] text-muted font-normal"> · {mt.people}</span>}</td>
                      {cell(money(mt.payroll), 'text-muted')}
                      {cell(mt.billable == null ? '—' : (mt.billable > 0 ? money(mt.billable) + ' · ' + hrs(mt.billedHours) : '$0'), mt.billable ? 'text-ink' : 'text-rose-700')}
                      {cell(mt.billedPct == null ? '—' : mt.billedPct + '%', billedCls(mt) + ' font-semibold')}
                      {cell(hrs(r.total.hours), 'text-muted border-l border-line/70')}
                      {cell(money(r.total.payroll), 'text-muted')}
                      {cell(money(r.total.margin), (r.total.margin ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700')}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] text-muted px-2 mt-2">
            Housekeeping, two ways: <b>$ / turn · total</b> is housekeeper wages over every turn in the market — a turn Yoslenis or a tech covered is a saving, so this is the number. <b>$ / own</b> and <b>h / turn · own</b> divide the same wages by the turns housekeepers themselves did — whether the controllable team is scheduled well. Supervisors and maintenance are judged on paid hours vs the charges the team entered on their tasks (÷ ${d.chargeRate}/h) — a low billed-to-paid % is either work that was never priced or hours that produced nothing billable. Bold red/green = more than 15% off the {d.rows.length}-day average. Salaries are spread by the day; agency markups ride on the wages they were computed on.
          </p>
          {showNames && (() => {
            const r = d.rows.find(x => x.d + 'hk' === showNames)
            if (!r) return null
            return <p className="text-[11px] text-muted px-2 mt-1">Housekeepers {dayLabel(r.d)}: {r.crews.housekeeping.names.join(', ') || 'nobody punched'}</p>
          })()}
          {openDay && (
            <CleanLog from={openDay} to={openDay} market={market} label={dayLabel(openDay)} onClose={() => setOpenDay(null)} />
          )}
        </>
      )}
    </div>
  )
}

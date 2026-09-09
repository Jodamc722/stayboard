'use client'
// LABOR AGAINST THE CLEANS ON THE BOARD — drawn once, used by the in-app planner and by the review
// link Jon sends, so the two can never disagree (Jon, 2026-09-09: "share total revenue and actual
// labor" · "we want to see the actual scheduled cleans and who's cleaning them so we can get an
// idea of labor").
//
// The one rule this component exists to enforce: ACTUAL AND SCHEDULED ARE NEVER ADDED TOGETHER.
// Days that have been worked carry punched hours; days still ahead carry what people are rostered
// for. Summing them would produce a spend that is half fact and half plan, which is exactly the
// number nobody can act on. They sit side by side, labelled, and the margin line only uses the
// half that is real.
import { DollarSign, Clock, Sparkles, AlertTriangle, CalendarClock } from 'lucide-react'

export type LaborDay = {
  date: string; ahead: boolean; cleans: number; other: number; people: number
  revenue: number; hours: number | null; cost: number | null; basis: 'actual' | 'scheduled' | 'none'
}
export type LaborTotals = {
  cleans: number; other: number; revenue: number
  actualHours: number; actualCost: number; actualDays: number
  scheduledHours: number; scheduledCost: number; scheduledDays: number
  perClean: number | null; revenuePerClean: number | null
}
export type LaborPerson = { name: string; market: string; cleans: number; other: number; days: number; hours: number | null; cost: number | null }
export type ScheduleLaborData = {
  from: string; to: string; today: string
  days: LaborDay[]; people: LaborPerson[]; totals: LaborTotals
  payrollComplete: boolean; notes: string[]
}

const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString()
const shortDay = (ymd: string) => { try { return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) } catch { return ymd } }

function Stat({ label, value, sub, tone = 'ink', Icon }: { label: string; value: string; sub?: string; tone?: 'ink' | 'good' | 'warn'; Icon?: any }) {
  const cls = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink'
  return (
    <div className="px-4 py-3 min-w-0">
      <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted inline-flex items-center gap-1">{Icon ? <Icon size={11} /> : null}{label}</p>
      <p className={'text-[22px] font-bold leading-tight tabular-nums mt-0.5 ' + cls}>{value}</p>
      {sub ? <p className="text-[11.5px] text-muted leading-tight">{sub}</p> : null}
    </div>
  )
}

export function ScheduleLaborStrip({ data }: { data: ScheduleLaborData }) {
  const t = data.totals
  const hasActual = t.actualDays > 0
  const hasAhead = t.scheduledDays > 0
  const margin = hasActual ? t.revenue - t.actualCost : null

  return (
    <section className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-line">
        <Stat label="Departure cleans" value={String(t.cleans)} sub={t.other ? t.other + ' other jobs' : 'on this board'} Icon={Sparkles} />
        <Stat label="Cleaning revenue" value={money(t.revenue)} sub={t.revenuePerClean ? money(t.revenuePerClean) + ' a clean' : undefined} Icon={DollarSign} />
        <Stat
          label={hasActual ? 'Labor — actual' : 'Labor — scheduled'}
          value={hasActual ? money(t.actualCost) : (t.scheduledCost ? money(t.scheduledCost) : '—')}
          sub={hasActual
            ? t.actualHours + 'h punched over ' + t.actualDays + ' day' + (t.actualDays === 1 ? '' : 's')
            : (t.scheduledHours ? t.scheduledHours + 'h rostered' : 'no shifts set yet')}
          tone={hasActual ? 'ink' : 'warn'} Icon={Clock} />
        <Stat
          label={hasActual ? 'Left after labor' : 'Still ahead'}
          value={hasActual ? money(margin) : (hasAhead ? t.scheduledDays + ' days' : '—')}
          sub={hasActual
            ? (t.perClean ? money(t.perClean) + ' cost a clean' : 'on the days worked')
            : 'labor is a plan, not a spend'}
          tone={hasActual ? (margin != null && margin > 0 ? 'good' : 'warn') : 'warn'} Icon={CalendarClock} />
      </div>

      {/* The split, said plainly, because half this window has usually not happened yet. */}
      {hasActual && hasAhead ? (
        <p className="px-4 py-2 border-t border-line text-[11.5px] text-muted">
          {t.actualDays} day{t.actualDays === 1 ? '' : 's'} worked and punched · {t.scheduledDays} day{t.scheduledDays === 1 ? '' : 's'} still ahead,
          rostered for {t.scheduledHours}h{t.scheduledCost ? ' (' + money(t.scheduledCost) + ')' : ''}. The two are never added together.
        </p>
      ) : null}

      {!data.payrollComplete ? (
        <div className="px-4 py-2.5 border-t border-amber-200 bg-amber-50 flex items-start gap-2">
          <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-[12px] text-amber-900">Homebase came back short for part of this window, so the actual labor above is <b>understated</b>. Treat it as a floor, not the figure.</p>
        </div>
      ) : null}

      {/* Day by day: the shape of the week, and where the load sits. */}
      <div className="border-t border-line overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[520px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted">
              <th className="text-left font-bold px-4 py-2">Day</th>
              <th className="text-right font-bold px-3 py-2">Cleans</th>
              <th className="text-right font-bold px-3 py-2">On it</th>
              <th className="text-right font-bold px-3 py-2">Revenue</th>
              <th className="text-right font-bold px-3 py-2">Hours</th>
              <th className="text-right font-bold px-4 py-2">Labor</th>
            </tr>
          </thead>
          <tbody>
            {data.days.filter(d => d.cleans || d.other || d.cost != null).map(d => (
              <tr key={d.date} className="border-t border-line">
                <td className="px-4 py-2 font-semibold text-ink whitespace-nowrap">
                  {shortDay(d.date)}
                  {d.date === data.today ? <span className="ml-1.5 text-[10px] font-bold uppercase text-brand-700">today</span> : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{d.cleans || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{d.people || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{d.revenue ? money(d.revenue) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{d.hours != null ? d.hours + 'h' : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {d.cost != null ? <span className={d.basis === 'scheduled' ? 'text-amber-700' : 'text-ink'}>{money(d.cost)}</span> : <span className="text-muted">—</span>}
                  {d.basis === 'scheduled' ? <span className="ml-1 text-[10px] uppercase font-bold text-amber-600">sched</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Who carried it. Hours appear against a name only for days that have been punched. */}
      {data.people.length ? (
        <div className="border-t border-line px-4 py-3">
          <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted mb-2">Cleans by person</p>
          <div className="flex flex-wrap gap-1.5">
            {data.people.filter(p => p.cleans || p.other).map(p => (
              <span key={p.name} className="inline-flex items-baseline gap-1.5 rounded-lg border border-line bg-app/50 px-2 py-1">
                <span className="text-[12.5px] font-semibold text-ink">{p.name}</span>
                <span className="text-[11.5px] text-muted tabular-nums">{p.cleans} clean{p.cleans === 1 ? '' : 's'}</span>
                {p.hours != null ? <span className="text-[11px] text-brand-700 tabular-nums">{p.hours}h</span> : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {data.notes.length ? (
        <div className="border-t border-line px-4 py-2">
          {data.notes.map((n, i) => <p key={i} className="text-[11px] text-muted">{n}</p>)}
        </div>
      ) : null}
    </section>
  )
}

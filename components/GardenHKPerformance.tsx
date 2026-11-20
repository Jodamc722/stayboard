'use client'
// HOUSEKEEPING PERFORMANCE (lib/garden/hk-perf) — the KPIs, by person and by day, and how the
// scheduling held up: housekeepers the day needed vs put on the schedule vs who actually cleaned.
// Counted from the day tracking started; a room's time is when the sync saw it change in Cloudbeds.
import { useEffect, useState } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { LeanEmpty, Tag } from '@/components/lean'

const dayShort = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const t12 = (hm: string | null) => { if (!hm) return '—'; const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}` }
const pct = (n: number | null) => n == null ? '—' : n + '%'
const frac = (x: any) => x ? `${x.done}/${x.total}` : '—'

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-[22px] font-semibold tabular-nums leading-tight mt-0.5 ${tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-rose-700' : 'text-ink'}`}>{value}</div>
      {sub ? <div className="text-[11px] text-muted mt-0.5">{sub}</div> : null}
    </div>
  )
}
const grade = (n: number | null, good: number, ok: number) => n == null ? undefined : n >= good ? 'good' : n >= ok ? 'warn' : 'bad'

export function GardenHKPerformance() {
  const [days, setDays] = useState(14)
  const [d, setD] = useState<any | null>(null)
  useEffect(() => { setD(null); fetch(`/api/garden/hk-plan?performance=${days}`, { cache: 'no-store' }).then(r => r.json()).then(setD).catch(e => setD({ ok: false, error: String(e) })) }, [days])
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Adding it up…</p>
  if (!d.ok) return <LeanEmpty>{d.error}</LeanEmpty>
  if (!d.ready) return <LeanEmpty>Performance tracking needs its two tables (migration 180_garden_hk_performance.sql). Once they exist, every room cleaned is logged from the next Cloudbeds sync.</LeanEmpty>
  const k = d.kpi
  return (
    <div className="pb-10">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <BarChart3 size={18} className="text-ink" /><h1 className="text-[20px] font-semibold text-ink">Housekeeping performance</h1>
        <span className="text-[12.5px] text-muted">{d.since ? `${d.daysTracked} day${d.daysTracked === 1 ? '' : 's'} tracked, since ${dayShort(d.since)}` : 'tracking starts with the next Cloudbeds sync'}</span>
        <span className="flex-1" />
        {[7, 14, 30, 90].map(n => <button key={n} onClick={() => setDays(n)} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${days === n ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{n} days</button>)}
      </div>
      <p className="text-[12px] text-muted mb-3">Counted from the hotel&apos;s own room changes in Cloudbeds: a room is &ldquo;cleaned&rdquo; the first time it goes from dirty to clean or inspected that day, credited to whoever had the room. Times are when the sync saw the change, so right to within about half an hour. Nothing before the first tracked day exists to count.</p>

      {!d.daysTracked ? <LeanEmpty>Nothing logged yet. The first numbers appear after the next Cloudbeds sync that sees a room cleaned.</LeanEmpty> : (<>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 mb-4">
          <Kpi label="Rooms cleaned" value={String(k.roomsCleaned)} sub={`${k.hours} h credited · ${d.inspections?.logged ?? 0} inspected`} />
          <Kpi label="Rooms per person per day" value={k.roomsPerPersonDay == null ? '—' : String(k.roomsPerPersonDay)} sub="rooms with a named housekeeper" />
          <Kpi label="Arrival rooms ready on time" value={pct(k.arrivalOnTimePct)} tone={grade(k.arrivalOnTimePct, 95, 80)} sub={`by ${t12(d.checkIn)} check-in · ${k.arrivalRoomsLogged} rooms`} />
          <Kpi label="Checkouts turned same day" value={pct(k.checkoutPct)} tone={grade(k.checkoutPct, 95, 85)} sub="finished days only" />
          <Kpi label="Stayovers serviced" value={pct(k.stayoverPct)} tone={grade(k.stayoverPct, 90, 75)} sub={k.stayoverSkipped ? `${k.stayoverSkipped} skipped (DND / refused)` : 'of those not DND / refused'} />
          <Kpi label="Scheduling" value={k.daysNoSchedule ? `${k.daysNoSchedule} day${k.daysNoSchedule === 1 ? '' : 's'}` : k.daysShort ? `${k.daysShort} short` : 'On plan'} tone={k.daysNoSchedule || k.daysShort ? 'bad' : 'good'} sub={k.daysNoSchedule ? 'with work and nobody on the schedule' : k.daysShort ? 'days with fewer scheduled than needed' : k.daysOver ? `${k.daysOver} day${k.daysOver === 1 ? '' : 's'} over-staffed` : 'scheduled matched the need'} />
        </div>
        {k.unattributed ? <p className="text-[12px] text-amber-800 mb-3">{k.unattributed} cleaned room{k.unattributed === 1 ? ' was' : 's were'} not assigned to anyone, so no one gets the credit. Assign rooms on the Housekeeping day and every clean lands on a name.</p> : null}

        <h2 className="text-[12px] font-bold uppercase tracking-wider text-ink mb-1 px-1">By housekeeper</h2>
        <div className="rounded-xl border border-line bg-white overflow-x-auto mb-4">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{['Housekeeper', 'Days', 'Rooms', 'Turns', 'Checkouts', 'Stayovers', 'Other', 'Hours credited', 'Rooms / day', 'Of a full shift'].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (h === 'Housekeeper' ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
            <tbody>{d.people.map((p: any) => (
              <tr key={p.name} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-1.5 font-semibold text-ink">{p.name}</td>
                <td className="px-3 py-1.5 text-right">{p.days}</td><td className="px-3 py-1.5 text-right font-semibold">{p.rooms}</td>
                <td className="px-3 py-1.5 text-right">{p.turns || ''}</td><td className="px-3 py-1.5 text-right">{p.checkouts || ''}</td><td className="px-3 py-1.5 text-right">{p.stayovers || ''}</td><td className="px-3 py-1.5 text-right text-muted">{p.other || ''}</td>
                <td className="px-3 py-1.5 text-right">{p.hours}</td><td className="px-3 py-1.5 text-right">{p.roomsPerDay}</td>
                <td className="px-3 py-1.5 text-right"><span className="inline-flex items-center gap-2"><span className="w-20 h-1.5 rounded bg-app overflow-hidden inline-block"><span className={`block h-full ${p.load > 105 ? 'bg-rose-500' : p.load >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: Math.min(100, p.load) + '%' }} /></span>{p.load}%</span></td>
              </tr>))}</tbody>
          </table>
        </div>

        {d.inspections?.byPerson?.length ? (<>
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-ink mb-1 px-1">Inspections <span className="font-normal normal-case tracking-normal text-muted">· {d.inspections.logged} rooms inspected in the period</span></h2>
          <div className="rounded-xl border border-line bg-white overflow-x-auto mb-4">
            <table className="w-full text-[12.5px] tabular-nums">
              <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{['Inspector', 'Given', 'Inspected', 'Done'].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (h === 'Inspector' ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
              <tbody>{d.inspections.byPerson.map((p: any) => <tr key={p.name} className="border-b border-line/60 last:border-0"><td className="px-3 py-1.5 font-semibold text-ink">{p.name}</td><td className="px-3 py-1.5 text-right">{p.assigned}</td><td className="px-3 py-1.5 text-right font-semibold">{p.done}</td><td className="px-3 py-1.5 text-right">{p.assigned ? Math.round((p.done / p.assigned) * 100) + '%' : '—'}</td></tr>)}</tbody>
            </table>
          </div>
        </>) : null}

        <h2 className="text-[12px] font-bold uppercase tracking-wider text-ink mb-1 px-1">By day <span className="font-normal normal-case tracking-normal text-muted">· needed vs scheduled vs who cleaned</span></h2>
        <div className="rounded-xl border border-line bg-white overflow-x-auto">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">{['Day', 'Turns', 'Checkouts', 'Stayovers', 'Rooms cleaned', 'Inspected', 'Needed', 'Scheduled', 'Cleaned by', 'Arrival rooms ready', 'Last turn ready', ''].map(h => <th key={h} className={'px-3 py-2 font-semibold ' + (h === 'Day' ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
            <tbody>{d.days.map((x: any) => (
              <tr key={x.date} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-1.5 font-semibold text-ink whitespace-nowrap">{dayShort(x.date)}{x.inProgress ? <span className="ml-1"><Tag tone="brand">today</Tag></span> : null}</td>
                <td className="px-3 py-1.5 text-right">{frac(x.turns)}</td><td className="px-3 py-1.5 text-right">{frac(x.checkouts)}</td><td className="px-3 py-1.5 text-right">{frac(x.stayovers)}{x.stayovers?.skip ? <span className="text-muted"> · {x.stayovers.skip} skip</span> : null}</td>
                <td className="px-3 py-1.5 text-right font-semibold">{x.cleaned}</td>
                <td className="px-3 py-1.5 text-right">{x.inspected ?? 0}</td>
                <td className="px-3 py-1.5 text-right">{x.need ?? '—'}</td>
                <td className={'px-3 py-1.5 text-right ' + (x.need != null && x.scheduled < x.need ? 'text-rose-700 font-semibold' : '')}>{x.scheduled}</td>
                <td className="px-3 py-1.5 text-right">{x.worked}</td>
                <td className="px-3 py-1.5 text-right">{x.arrivals != null ? `${x.arrivalsReady}/${x.arrivals}` : '—'}</td>
                <td className="px-3 py-1.5 text-right">{t12(x.lastTurnReady)}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">{x.need != null && x.scheduled === 0 && x.need > 0 ? <Tag tone="rose">no schedule</Tag> : x.need != null && x.scheduled < x.need ? <Tag tone="amber">{x.need - x.scheduled} short</Tag> : x.need != null && x.scheduled > x.need + 1 ? <Tag tone="sky">{x.scheduled - x.need} over</Tag> : x.need != null ? <Tag tone="emerald">on plan</Tag> : null}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <p className="text-[11.5px] text-muted mt-2">Needed = the day&apos;s work at 45 minutes a checkout or turn and 20 a stayover, over a 7-hour shift. Scheduled = housekeepers on the Staff week for that day. Cleaned by = people credited with at least one room.</p>
      </>)}
    </div>
  )
}

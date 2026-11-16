'use client'
// THE SCHEDULER'S HEADER (2026-09-28 audit: "the Scheduler opens on the board"). One line: the
// title, the week sandbox, and the capacity verdict as a single Pill — "Crew 88%" in the verdict's
// colour, the sentence on hover. The full capacity strip (its ‹ day › pager and the suggested moves)
// opens underneath on a click instead of taking a band above the board on every visit. The Pill and
// the strip read the same cached /api/capacity entry (lib/swr), so opening it costs no second call.
import { useEffect, useState } from 'react'
import { CalendarRange, ChevronDown, Users } from 'lucide-react'
import { LeanHead, Pill, type Tone } from '@/components/lean'
import { CapacityPanel } from '@/components/OpsV2'
import { ScheduleSuggesterButton } from '@/components/ScheduleSuggester'
import { useCachedFetch } from '@/lib/swr'

type Kpi = {
  peopleOnShift: number; workMinutes: number; travelMinutes: number; capacityMinutes: number
  utilisationPct: number; overloaded: number; unassignedCount: number
}

const hrs = (mins: number) => {
  const m = Math.max(0, Math.round(mins))
  const h = Math.floor(m / 60), r = m % 60
  return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'
}

export function ScheduleHead() {
  const [open, setOpen] = useState(false)
  // THE PILL FOLLOWS THE BOARD'S DAY (2026-11-10). The board announces the day it is showing
  // ('lh:schedule-day', see ScheduleBoard) and /api/capacity takes ?date=. Before this the pill
  // said "today" over whatever day was open. Today keeps the bare key, so it still shares one
  // cache entry with CapacityPanel's own read; another day uses the same key the panel's pager does.
  const [sel, setSel] = useState<{ date: string; today: string; short: number } | null>(null)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) setSel({ date: d.date, today: typeof d.today === 'string' ? d.today : '', short: Number(d.short) || 0 })
    }
    window.addEventListener('lh:schedule-day', on)
    return () => window.removeEventListener('lh:schedule-day', on)
  }, [])
  const other = !!sel && !!sel.today && sel.date !== sel.today
  const dayWord = other && sel ? new Date(sel.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'today'
  const { data } = useCachedFetch<{ ok?: boolean; kpi?: Kpi }>(other && sel ? '/api/capacity?date=' + sel.date : '/api/capacity', { ttl: 5 * 60_000 })
  const k = data && data.ok ? data.kpi : undefined
  // ONE VERDICT, NOT TWO (2026-11-16 audit). The pill said "Team has room today" in green while the board's own rail,
  // two inches below, said "Short 10h 44m — add 2 cleaners" in red: by the clock the day fits, by the labor KPI it is
  // two people short, and seven people were past a full day. The board now tells the pill when it is short, the pill
  // leads with that, and people past a full day keep it off green.
  const short = sel ? sel.short : 0
  // The labor KPI is a guide, not an alarm (Jon, 2026-11-02): under it is amber, never red. Red is only "more work than hours".
  const tone: Tone = !k ? 'slate' : k.utilisationPct > 100 ? 'rose' : short > 0 || k.utilisationPct >= 85 || k.overloaded > 0 ? 'amber' : 'emerald'
  const title = (k
    ? (other ? dayWord : 'Today') + ', by the clock (cleaning time + travel vs. shift time — a different question from the KPI hours on the board below): ' + hrs(k.workMinutes + k.travelMinutes) + ' of work on ' + k.peopleOnShift + ' '
      + (k.peopleOnShift === 1 ? 'person' : 'people') + ' ≈ ' + hrs(k.capacityMinutes) + ' capacity. '
    : 'Is the day doable? ')
    + (other ? 'The plan that opens below starts on today — use its pager for ' + dayWord + '. ' : '')
    + (open ? 'Click to hide the capacity plan.' : 'Click for the capacity plan, other days and suggested moves.')
  return (
    <>
      <LeanHead title="Schedule" icon={<CalendarRange size={18} className="text-brand-600" />}>
        {/* PHONE (2026-11-09 audit): the right side of the header is one swipeable row with no
            scrollbar, and the sentence ran off the edge behind the Suggest button. The pill goes
            first and, under sm, says the short thing the comment at the top always promised. */}
        <Pill tone={tone} title={title} onClick={() => setOpen(o => !o)}>
          <span className="inline-flex items-center gap-1">
            <Users size={12} />
            <span className="sm:hidden">{k ? 'Crew ' + k.utilisationPct + '% ' + dayWord : 'Doable?'}</span>
            <span className="hidden sm:inline">{k ? (short > 0 ? short + (short === 1 ? ' cleaner' : ' cleaners') + ' under the labor guide ' + dayWord : k.utilisationPct > 100 ? 'Too much work ' + dayWord : k.utilisationPct >= 85 ? 'Team nearly full ' + dayWord : k.overloaded > 0 ? 'Work is uneven ' + dayWord : 'Team has room ' + dayWord) + ' · ' + k.utilisationPct + '% by the clock' : 'Is today doable?'}</span>
            {k && k.unassignedCount > 0 ? <span className="opacity-80 hidden sm:inline">· {k.unassignedCount} {k.unassignedCount === 1 ? 'clean' : 'cleans'} with nobody on {k.unassignedCount === 1 ? 'it' : 'them'}</span> : null}
            {k && k.overloaded > 0 ? <span className="opacity-80 hidden sm:inline">· {k.overloaded} past a full day</span> : null}
            <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </span>
        </Pill>
        {/* The sandbox (Jon, 2026-09-23): a proposed day in a popup, moved around, then approved. */}
        <ScheduleSuggesterButton />
      </LeanHead>
      {/* IS THE DAY DOABLE — the measured capacity model (lib/capacity), pointed at whichever day is
          being planned. The board below decides WHO takes each clean; this says whether the day fits
          at all. Collapsed by default: the board is what the page is for. */}
      {open ? <CapacityPanel pager /> : null}
    </>
  )
}

'use client'
// THE SCHEDULER'S HEADER (2026-09-28 audit: "the Scheduler opens on the board"). One line: the
// title, the week sandbox, and the capacity verdict as a single Pill — "Crew 88%" in the verdict's
// colour, the sentence on hover. The full capacity strip (its ‹ day › pager and the suggested moves)
// opens underneath on a click instead of taking a band above the board on every visit. The Pill and
// the strip read the same cached /api/capacity entry (lib/swr), so opening it costs no second call.
import { useState } from 'react'
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
  // Same key and TTL as CapacityPanel's own read for today, so both share one cache entry.
  const { data } = useCachedFetch<{ ok?: boolean; kpi?: Kpi }>('/api/capacity', { ttl: 5 * 60_000 })
  const k = data && data.ok ? data.kpi : undefined
  const tone: Tone = !k ? 'slate' : k.utilisationPct > 100 ? 'rose' : k.utilisationPct >= 85 ? 'amber' : 'emerald'
  const title = (k
    ? 'Today: ' + hrs(k.workMinutes + k.travelMinutes) + ' of work on ' + k.peopleOnShift + ' '
      + (k.peopleOnShift === 1 ? 'person' : 'people') + ' ≈ ' + hrs(k.capacityMinutes) + ' capacity. '
    : 'Is the day doable? ')
    + (open ? 'Click to hide the capacity plan.' : 'Click for the capacity plan, other days and suggested moves.')
  return (
    <>
      <LeanHead title="Scheduler" icon={<CalendarRange size={18} className="text-brand-600" />}>
        {/* The sandbox (Jon, 2026-09-23): a proposed day in a popup, moved around, then approved. */}
        <ScheduleSuggesterButton />
        <Pill tone={tone} title={title} onClick={() => setOpen(o => !o)}>
          <span className="inline-flex items-center gap-1">
            <Users size={12} /> {k ? (k.utilisationPct > 100 ? 'Too much work today' : k.utilisationPct >= 85 ? 'Team nearly full today' : 'Team has room today') + ' · ' + k.utilisationPct + '%' : 'Is today doable?'}
            {k && k.unassignedCount > 0 ? <span className="opacity-80 hidden sm:inline">· {k.unassignedCount} {k.unassignedCount === 1 ? 'clean' : 'cleans'} with nobody on {k.unassignedCount === 1 ? 'it' : 'them'}</span> : null}
            {k && k.overloaded > 0 ? <span className="opacity-80 hidden sm:inline">· {k.overloaded} past a full day</span> : null}
            <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </span>
        </Pill>
      </LeanHead>
      {/* IS THE DAY DOABLE — the measured capacity model (lib/capacity), pointed at whichever day is
          being planned. The board below decides WHO takes each clean; this says whether the day fits
          at all. Collapsed by default: the board is what the page is for. */}
      {open ? <CapacityPanel pager /> : null}
    </>
  )
}

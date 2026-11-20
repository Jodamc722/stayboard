'use client'
// BOARD | CALENDAR (Jon, 2026-11-10: "calendar on scheduler / multi cal view on tab at top"). The board
// stays the default; ?view=calendar opens (and links straight to) the multi-calendar.
//
// ONE TAB ROW (Jon, 2026-11-20: "think a professional webapp, organized and easy to use"). There were two rows of
// tabs stacked — Board / Multi-calendar here, then Day board / GE Log / Weekly planner inside the board — so four
// destinations took two rows and "Board" appeared twice. This file now owns one strip of four and hands it to the
// board, which draws it on its first line beside the week-ahead button. Nothing was removed: ?view=calendar still
// opens the calendar, and ?tab=gelog / ?tab=weekly (the board's old deep links) still open their tabs.
import { useEffect, useState } from 'react'
import { ScheduleBoard } from '@/components/ScheduleBoard'
import { ScheduleMultiCal } from '@/components/ScheduleMultiCal'

type View = 'board' | 'gelog' | 'planner' | 'calendar'
const TABS: { key: View; label: string; title: string }[] = [
  { key: 'board', label: 'Board', title: 'The day (or week) of cleans: assign, stage and push' },
  // Second, beside Board, where it was before the rows were merged (Jon, 2026-11-20: "Multi calendar, where is that").
  { key: 'calendar', label: 'Multi-calendar', title: 'Every unit across the coming weeks: stays, blocks and gaps' },
  { key: 'gelog', label: 'GE Log', title: 'The same day read by person: every task under whoever holds it' },
  { key: 'planner', label: 'Weekly planner', title: 'The Homebase week and the staffing forecast' },
]

export function ScheduleTabs() {
  const [view, setView] = useState<View>('board')
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const t = sp.get('tab')
      if (sp.get('view') === 'calendar') setView('calendar')
      else if (t === 'weekly' || t === 'planner') setView('planner')
      else if (t === 'gelog' || t === 'ge') setView('gelog')
    } catch { /* board */ }
  }, [])
  const pick = (v: View) => {
    setView(v)
    try {
      const u = new URL(window.location.href)
      if (v === 'calendar') u.searchParams.set('view', 'calendar'); else u.searchParams.delete('view')
      if (v === 'gelog') u.searchParams.set('tab', 'gelog'); else if (v === 'planner') u.searchParams.set('tab', 'weekly'); else u.searchParams.delete('tab')
      window.history.replaceState(null, '', u.toString())
    } catch { /* fine */ }
  }
  // The same look as LeanTabs' strip (components/lean), without its wrapper row — the board places it.
  const strip = (
    <div className="lh-tabs-strip inline-flex rounded-xl border border-line overflow-hidden text-[12.5px] max-w-full overflow-x-auto">
      {TABS.map(t => (
        <button key={t.key} onClick={() => pick(t.key)} aria-pressed={view === t.key} title={t.title}
          className={`lh-tab px-2.5 sm:px-3 py-1.5 font-semibold border-l border-line first:border-l-0 whitespace-nowrap ${view === t.key ? 'lh-tab-on bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
  if (view === 'calendar') return <><div className="mb-3">{strip}</div><ScheduleMultiCal /></>
  return <ScheduleBoard tab={view} tabs={strip} />
}

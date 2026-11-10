'use client'
// BOARD | CALENDAR (Jon, 2026-11-10: "calendar on scheduler / multi cal view on tab at top"). The board
// stays the default; ?view=calendar opens (and links straight to) the multi-calendar.
import { useEffect, useState } from 'react'
import { LeanTabs } from '@/components/lean'
import { ScheduleBoard } from '@/components/ScheduleBoard'
import { ScheduleMultiCal } from '@/components/ScheduleMultiCal'

type View = 'board' | 'calendar'

export function ScheduleTabs() {
  const [view, setView] = useState<View>('board')
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('view') === 'calendar') setView('calendar') } catch { /* board */ }
  }, [])
  const pick = (v: View) => {
    setView(v)
    try {
      const u = new URL(window.location.href)
      if (v === 'calendar') u.searchParams.set('view', 'calendar'); else u.searchParams.delete('view')
      window.history.replaceState(null, '', u.toString())
    } catch { /* fine */ }
  }
  return (
    <>
      <LeanTabs<View> tabs={[{ key: 'board', label: 'Board' }, { key: 'calendar', label: 'Multi-calendar' }]} value={view} onChange={pick} />
      {view === 'calendar' ? <ScheduleMultiCal /> : <ScheduleBoard />}
    </>
  )
}

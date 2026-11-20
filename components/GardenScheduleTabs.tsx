'use client'
// The Garden scheduler's two views (2026-11-20): the housekeeping day — rooms, by kind of clean, and
// who has them — the staff week (shifts), and performance (KPIs by person and day). Kept in ?view= so a link opens the right one.
import { useEffect, useState } from 'react'
import { GardenHKPlan } from '@/components/GardenHKPlan'
import { GardenScheduleGrid } from '@/components/GardenScheduleGrid'
import { GardenHKPerformance } from '@/components/GardenHKPerformance'

type View = 'rooms' | 'staff' | 'performance'
export function GardenScheduleTabs({ canEdit, canAssign }: { canEdit: boolean; canAssign: boolean }) {
  const [view, setView] = useState<View>('rooms')
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('view'); if (v === 'staff' || v === 'performance') setView(v) }, [])
  const go = (v: View) => { setView(v); try { const u = new URL(window.location.href); if (v === 'rooms') u.searchParams.delete('view'); else u.searchParams.set('view', v); window.history.replaceState(null, '', u.toString()) } catch { /* ignore */ } }
  return (
    <>
      <div className="flex gap-1 mb-4 border-b border-line print:hidden">
        {([['rooms', 'Housekeeping day'], ['staff', 'Staff week'], ['performance', 'Performance']] as [View, string][]).map(([k, l]) => (
          <button key={k} onClick={() => go(k)} className={`px-3 py-2 text-[13px] font-semibold -mb-px border-b-2 ${view === k ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {view === 'rooms' ? <GardenHKPlan canEdit={canAssign} /> : view === 'staff' ? <GardenScheduleGrid canEdit={canEdit} /> : <GardenHKPerformance />}
    </>
  )
}

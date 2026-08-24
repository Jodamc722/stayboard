// WEEKLY PLANNER — the schedule and the daily assignments, by market (Jon, 2026-08-21).
import { Shell } from '@/components/Shell'
import { TeamPlanner } from '@/components/TeamPlanner'
import { Users } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Weekly Planner — Lighthouse' }

export default function TeamPage() {
  return (
    <Shell>
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted inline-flex items-center gap-1.5"><Users size={11} /> Team</p>
        <h1 className="text-xl font-bold text-ink mt-1">Weekly Planner</h1>
        <p className="text-[12.5px] text-muted mt-0.5 max-w-2xl">
          Who is working which days and what is on their day, market by market — with the same tags the
          day sheet uses, so the crew can plan around a long stay or a big arrival before it lands.
        </p>
      </div>
      <TeamPlanner />
    </Shell>
  )
}

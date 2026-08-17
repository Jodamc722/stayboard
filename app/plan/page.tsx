'use client'
// Today in Ops — v2 (Jon, 2026-08-14: "complete revamp", then "feels a bit busy, love the push
// section" on the first draft).
//
// The page is now three tabs behind one sentence: BOARD (exceptions only, full board one tap
// away), PEOPLE (the person axis — lanes, load, tap-to-push), PUSH (the suggestion queue,
// promoted from a collapsed section to a destination). The heavy lifting lives in OpsV2;
// TodayInOps is unchanged and mounts inside Board's "Show all".
//
// What left this page and where it went:
//   • The 3-day improvement plan section — its engine now feeds the Push tab, which is the same
//     content with the evidence attached and one-tap filing. The /api/ops-plan/daily endpoint is
//     untouched, so nothing downstream moves.
//   • LaborStrip — cost numbers are a report, not a landing-page instrument; it sits quietly at
//     the bottom now rather than above the day's work.
//   • AuditFollowUps stays: it renders nothing when there is nothing outstanding, and when it
//     does render it IS an exception in the by-exception sense.
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { OpsV2 } from '@/components/OpsV2'
import { LaborStrip } from '@/components/LaborStrip'
import { AuditFollowUps } from '@/components/AuditFollowUps'
import { ClipboardList } from 'lucide-react'

export default function OpsPlanPage() {
  return (
    <Shell>
      <header className="mb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><ClipboardList size={13} /> Operations</p>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-3xl font-bold text-ink tracking-tight">Today in Ops</h1>
          {/* Paper copy of the day for whoever is running the field. */}
          <Link href="/plan/print" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5 text-muted hover:text-ink"
            title="Printable day sheet: arrivals, departures, owner stays, work orders, open issues and vacant units">
            Day sheet &rarr;
          </Link>
        </div>
      </header>

      <OpsV2 />

      {/* Cleanliness follow-ups from audits — renders nothing when none are outstanding. */}
      <div className="mt-6"><AuditFollowUps /></div>

      {/* Labor cost vs plan — reference material, below the fold on purpose. */}
      <div className="mt-4"><LaborStrip /></div>
    </Shell>
  )
}

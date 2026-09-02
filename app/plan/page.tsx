'use client'
// Today in Ops — v2 (Jon, 2026-08-14: "complete revamp", then "feels a bit busy, love the push
// section" on the first draft).
//
// 2026-09-02 (Jon: "Grid + Staffing only"): two tabs — GRID (the board, default) and STAFFING
// (the person axis — lanes, load, the capacity model). Board and Push tabs retired; "what needs a
// person" is the Command Center's Do-next list now. The heavy lifting lives in OpsV2.
//
// What left this page and where it went:
//   • The 3-day improvement plan section → the Push tab (2026-08-14) → RETIRED 2026-09-02 along
//     with the Push tab itself. What a person should do next now lives on the Command Center's
//     Do-next list (lib/command-day); /api/ops-plan/daily is a 410 stub.
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
      {/* HIDDEN ON A PHONE. Shell's mobile app bar already prints "Today in Ops" (lib/nav), so this
          block repeated the page title plus an eyebrow — about 70px of a 750px screen, on the one
          page where vertical space decides how many units you can see before scrolling. */}
      <header className="mb-4 hidden sm:block">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><ClipboardList size={13} /> Operations</p>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-3xl font-bold text-ink tracking-tight">Today in Ops</h1>
          {/* Paper copy of the day for whoever is running the field. */}
          <Link href="/plan/print" className="hidden sm:inline-flex text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:bg-app items-center gap-1.5 text-muted hover:text-ink"
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

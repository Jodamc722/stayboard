'use client'
// Today in Ops — v2 (Jon, 2026-08-14: "complete revamp", then "feels a bit busy, love the push
// section" on the first draft).
//
// 2026-09-02 (Jon: "Grid + Staffing only"): the board is the page; "what needs a person" is the
// Command Center's Do-next list now. The heavy lifting lives in OpsV2.
//
// What left this page and where it went:
//   • The 3-day improvement plan → the Push tab → RETIRED 2026-09-02 (/api/ops-plan/daily is a 410).
//   • LaborStrip — cost numbers are a report, not a landing-page instrument; it sits at the bottom.
//   • AuditFollowUps renders nothing when nothing is outstanding; when it renders it IS an exception.
//
// LEAN PASS (2026-09-22): the header (title, day sheet, day pager, Add task) is ONE line inside
// OpsV2, so this shell no longer prints its own title row.
import { Shell } from '@/components/Shell'
import { OpsV2 } from '@/components/OpsV2'
import { LaborStrip } from '@/components/LaborStrip'
import { AuditFollowUps } from '@/components/AuditFollowUps'

export default function OpsPlanPage() {
  return (
    <Shell>
      <OpsV2 />

      {/* Cleanliness follow-ups from audits — renders nothing when none are outstanding. */}
      <div className="mt-5"><AuditFollowUps /></div>

      {/* Labor cost vs plan — reference material, below the fold on purpose. */}
      <div className="mt-4"><LaborStrip /></div>
    </Shell>
  )
}

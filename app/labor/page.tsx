'use client'
// Labor — the live board, and nothing else.
//
// THE CSV LEDGER IS GONE (Jon, 2026-09-01: "make sure the data is one source"). This page used to
// render a second accounting system under the live one: a hand-uploaded Homebase timesheet CSV
// with its own clean definition, name matcher and labels. Two answers on one scroll is how a
// payroll conversation becomes unwinnable. Every number now comes from lib/labor-econ through
// /api/labor/kpi; the punches come straight from the Homebase API, paginated, every location.
// The one-line header (title, Board|Dashboard switch, headline pills) is drawn by LaborPanel.
import { Shell } from '@/components/Shell'
import { LaborPanel } from '@/components/LaborPanel'

export default function LaborPage() {
  return (
    <Shell>
      <LaborPanel />
    </Shell>
  )
}

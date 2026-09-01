'use client'
// Labor — the live board, and nothing else.
//
// THE CSV LEDGER IS GONE (Jon, 2026-09-01: "make sure the data is one source"). This page used to
// render a second accounting system under the live one: a hand-uploaded Homebase timesheet CSV,
// aggregated with its own clean definition (strips and walkthroughs counted as cleans), its own
// name matcher (first name + last initial), no agency markup, no salary handling — and the same
// labels ("Labor cost", "Cost / clean") as the engine above it. Two answers on one scroll is how
// a payroll conversation becomes unwinnable. Every number now comes from lib/labor-econ through
// /api/labor/kpi; the punches come straight from the Homebase API, paginated, every location.
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { Timer } from 'lucide-react'
import { LaborPanel } from '@/components/LaborPanel'

export default function LaborPage() {
  return (
    <Shell>
      <header className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted flex items-center gap-1.5"><Timer size={12} /> Team</div>
        <h1 className="text-3xl font-bold text-ink mt-1">Labor</h1>
        <p className="text-sm text-muted mt-1">Live from Homebase punches and the Breezeway board — one engine, the same numbers the morning briefs print.</p>
        {/* Nav diet 2026-08-11 (Jon): one Labor nav entry — the dashboard is a tab here. */}
        <span className="mt-3 inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line">
          <span className="text-sm font-medium px-3 py-1.5 bg-ink text-white">Board</span>
          <Link href="/labor/dashboard" prefetch={false} className="text-sm font-medium px-3 py-1.5 bg-white text-muted hover:bg-app">Dashboard</Link>
        </span>
      </header>

      <LaborPanel />
    </Shell>
  )
}

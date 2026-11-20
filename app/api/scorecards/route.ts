// SCORECARDS (Jon, 2026-11-20: "Everything should have a scorecard for things completed and Leaderboard based on KPI").
//
//   GET   yesterday and the last 7 days, one scorecard per team (lib/scorecards, cached a few minutes)
//
// A leaderboard names people, so this is gated by its own key (`scorecards`, view), the same one the
// middleware checks for the /scoreboard page. Read-only: there is nothing to POST.
import { NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildScorecards } from '@/lib/scorecards'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await requireLevel('scorecards', 'view')
  if (!gate.ok) return gate.res
  try {
    return NextResponse.json(await buildScorecards())
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

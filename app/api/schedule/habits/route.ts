// How we scheduled in the last 30 days (lib/schedule-habits) plus Eve's shadow-scheduler scorecard —
// what "Suggest a schedule" and the weekly planner show as her read of the team.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { learnHabits } from '@/lib/schedule-habits'
import { shadowReadiness } from '@/lib/eve/scheduler-shadow'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireLevel('schedule', 'view')
  if (!gate.ok) return gate.res
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30))
  try {
    const [habits, shadow] = await Promise.all([learnHabits(days), shadowReadiness().catch(() => null)])
    return NextResponse.json({ ok: true, habits, shadow: shadow ? { scored: shadow.scored, wins: shadow.wins, ready: shadow.ready, window: shadow.window, needed: shadow.needed } : null })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}

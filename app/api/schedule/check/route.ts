// TOMORROW AT A GLANCE, FOR THE SCHEDULER PAGE (Jon, 2026-10-01: "I want the app to help with
// scheduling"). The same evening check Eve runs (lib/eve/schedule-check), read here by anyone who
// can see the schedule, for any date: cleans with nobody on them (same-day first, with the check-in
// time), people OFF on the roster but assigned, people over their own usual day, late same-day
// turns, the day against the people rostered, the three days after, and who usually covers each
// unowned clean. Nothing is posted.
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyLevel } from '@/lib/access'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(req: NextRequest) {
  const gate = await requireAnyLevel(['schedule', 'plan'], 'view')
  if (!gate.ok) return gate.res
  const date = req.nextUrl.searchParams.get('date') || undefined
  try {
    const { runScheduleCheck } = await import('@/lib/eve/schedule-check')
    const r = await runScheduleCheck({ preview: true, date })
    return NextResponse.json({ ok: true, date: r.date, markets: r.markets, notes: r.notes })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}

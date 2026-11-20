// TODAY IN OPS — thin route over lib/ops-day.ts (the builder moved there 2026-09-02 so the
// Command Center can read the same day in-process). Optional ?date=YYYY-MM-DD.
import { NextRequest, NextResponse } from 'next/server'
import { buildOpsDay } from '@/lib/ops-day'
import { requireVrUser } from '@/lib/vr-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try {
    const day = await buildOpsDay(req.nextUrl.searchParams.get('date'), { fresh: req.nextUrl.searchParams.get('refresh') === '1' })
    // The cached day carries the listing directory and the capacity picture for the Command Center,
    // which reads them in-process. The directory stays off the wire — it is most of the payload.
    //
    // SPEED (Jon, 2026-11-20 audit: this route measured 3.7s and /api/capacity 1.4s beside it). Today's day is
    // built WITH the capacity picture — and the route then threw it away, so the page asked /api/capacity for the
    // same picture in the same second: a second cold build, with its own Homebase and task reads, racing this one.
    // The numbers the page actually draws from it (the crew chip, each person's "booked of", the planner's
    // ceiling, the suggested moves) now ride on this response, trimmed to those fields, and the page skips the
    // second request for today. Another day has no picture here, and still reads /api/capacity as before.
    const { listingMeta: _meta, picture, ...board } = day
    const capacity = picture ? {
      ok: true as const, date: picture.date, builtAt: picture.builtAt,
      people: (picture.people || []).map(p => ({
        person: p.person, cleans: p.cleans, otherTasks: p.otherTasks, workMinutes: p.workMinutes, travelMinutes: p.travelMinutes,
        loadMinutes: p.loadMinutes, capacityMinutes: p.capacityMinutes, utilisationPct: p.utilisationPct,
        headroomCleans: p.headroomCleans, verdict: p.verdict, lowConfidence: p.lowConfidence,
      })),
      unassigned: (picture.unassigned || []).map(u => ({ stop: { id: u.stop.id }, minutes: u.minutes })),
      suggestions: picture.suggestions, kpi: picture.kpi, notes: picture.notes,
    } : null
    return NextResponse.json(capacity ? { ...board, capacity } : board)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { buildSchedule } from '@/lib/schedule-build'
import { requireVrUser } from '@/lib/vr-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The board's data. The computation lives in lib/schedule-build.ts (shared with the public team
// scheduler link); this file only checks the session.
export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  // A throw here used to escape as a bare 500 with no body, so the board could only say "Could not
  // load the schedule." The reason now comes back as the JSON error the board already displays.
  try {
    const payload = await buildSchedule(sp.get('view'), sp.get('date'))
    // WEEK VIEW, TRIMMED (2026-11-10). The Scheduler's week grid draws a unit name, its building
    // chip, the door code and a per-day dollar total — and was sent every field of every clean for
    // seven days plus the whole cleaner list. Opt-in (?slim=1), sent only by the Scheduler board:
    // the Weekly planner reads the same week un-trimmed and is left exactly as it was.
    if (sp.get('slim') === '1' && payload && payload.view === 'week' && Array.isArray(payload.days)) {
      const days = (payload.days as any[]).map(d => {
        const markets: Record<string, any[]> = {}
        for (const mk of Object.keys(d.markets || {})) {
          markets[mk] = ((d.markets[mk] || []) as any[]).map(c => ({
            listingId: c.listingId, unit: c.unit, market: c.market, hub: c.hub, date: c.date,
            sameDayTurn: !!c.sameDayTurn, doorCode: c.doorCode ?? null, vendor: c.vendor ?? null,
            movedTo: c.movedTo ?? null, cleaningFee: c.cleaningFee ?? null,
            // Present on every clean in the board's type; not drawn in the week grid.
            guestOut: null, nights: null, bedrooms: null, checkOutTime: null,
          }))
        }
        return { date: d.date, dow: d.dow, count: d.count, markets }
      })
      return NextResponse.json({ ...payload, days, housekeepers: [], newArrivals: [], slim: true })
    }
    return NextResponse.json(payload)
  } catch (e: any) {
    console.error('[api/schedule]', e)
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

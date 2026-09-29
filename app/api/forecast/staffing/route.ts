// THE 14-DAY STAFFING FORECAST (lib/forecast/staffing) — per market per day: checkouts on the
// books, the pickup expected, people needed vs rostered, and a short / ok / over verdict, plus how
// the forecast has done so far (lib/forecast/ledger).
//
//   GET ?from=YYYY-MM-DD&days=14   → { ok, days[], short[], basis, notes, track: { cleans, people } }
//
// No dollars anywhere in it. Read by the Weekly Planner strip, and meant for the Command Center.
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyLevel } from '@/lib/access'
import { buildStaffingForecast } from '@/lib/forecast/staffing'
import { trackRecord } from '@/lib/forecast/ledger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireAnyLevel(['team-schedule', 'schedule', 'command'], 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  try {
    const [fc, cleans, people] = await Promise.all([
      buildStaffingForecast({ from: sp.get('from') || undefined, days: Number(sp.get('days')) || 14 }),
      // ±2 cleans on a market-day counts as right; people needed has to be exact.
      trackRecord('cleans', { days: 30, tolerance: 2 }).catch(() => null),
      trackRecord('people_needed', { days: 30, tolerance: 0 }).catch(() => null),
    ])
    return NextResponse.json({ ...fc, track: { cleans, people } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'The staffing forecast could not be built: ' + String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}

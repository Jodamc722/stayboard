// THE SALES REPORT, AS DATA (lib/sales-report) — what /revenue/sales fetches after its shell is up.
//
//   GET                → the first-paint copy: headline, channels, months, cancellations, and the
//                        worst 60 units that need action (no daily series)
//   GET ?part=units    → { ok, units }  every unit's pace row (the "All" / "Raise rate" views, search)
//   GET ?part=daily    → { ok, days }   the 28-day booked-per-day series (the Daily tab)
//
// All three come out of the SAME ten-minute cached build — a part is a slice, never a second read.
// Gated like the page: `revenue` view. Dollars additionally need the money permission
// (canSeeMoney); without it every amount is zeroed here, on the server, before it is sliced.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, canSeeMoney } from '@/lib/access'
import { buildSalesReport, withoutMoney, firstPaint } from '@/lib/sales-report'

export const dynamic = 'force-dynamic'
// Seven paged reads over two years of bookings on a cold cache.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireLevel('revenue', 'view')
  if (!gate.ok) return gate.res
  const part = String(req.nextUrl.searchParams.get('part') || '')
  try {
    const full = await buildSalesReport()
    const r = canSeeMoney(gate.access) ? full : withoutMoney(full)
    if (part === 'units') return NextResponse.json({ ok: true, units: r.pace.units })
    if (part === 'daily') return NextResponse.json({ ok: true, days: r.days })
    return NextResponse.json(firstPaint(r))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'The sales report could not be built: ' + String((e && e.message) || e).slice(0, 200) }, { status: 500 })
  }
}

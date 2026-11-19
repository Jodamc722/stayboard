// The team's side of the booking links (lib/booking): the types, their hours, and the latest bookings.
//   GET                  → { types, log }
//   POST { types }       → saves the types
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readBooking, saveBookingTypes } from '@/lib/booking'

export const dynamic = 'force-dynamic'
export async function GET() {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  const s = await readBooking()
  return NextResponse.json({ ok: true, types: s.types, log: s.log.slice(0, 15) })
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const r = await saveBookingTypes(b?.types, g.access.email || null)
  return r.ok ? NextResponse.json({ ok: true, types: r.types }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 })
}

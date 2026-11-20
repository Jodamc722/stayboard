// MY BOOKING LINKS (lib/booking saveMyTypes): the links on my own calendar. Any signed-in person.
//   GET            → { ok, me, types (mine), log (bookings on mine) }
//   POST { types } → replaces mine; nobody else's are touched
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/access'
import { readBooking, saveMyTypes } from '@/lib/booking'

export const dynamic = 'force-dynamic'
export async function GET() {
  const g = await requireUser(); if (!g.ok) return g.res
  const me = String(g.access.email || '').toLowerCase()
  const s = await readBooking()
  const types = s.types.filter(t => t.host === me), slugs = new Set(types.map(t => t.slug))
  return NextResponse.json({ ok: true, me, types, log: s.log.filter(l => slugs.has(l.slug)).slice(0, 15) })
}
export async function POST(req: NextRequest) {
  const g = await requireUser(); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const r = await saveMyTypes(b?.types, String(g.access.email || ''), g.access.email || null)
  return r.ok ? NextResponse.json({ ok: true, types: r.types }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 })
}

// CLAIM A SPARE FOR A STAY — the weekend move.
//
//   POST { pass, permitId, reservationId } -> { ok }
//
// Jon, 2026-09-16, on why the pool exists at all: "in case the guest books last minute or
// something like that, and the vendor doesn't work weekends. They're going to provide a couple of
// extra codes just in case."
//
// So this is the office's action, not the vendor's: a booking lands on a Saturday, there is no
// permit for it, and somebody at Stay takes one of the spare codes out of the drawer and puts it
// on that stay. It requires a SIGNED-IN Lighthouse user — the vendor holds the passcode, and the
// passcode is not enough to reassign a credential to a different guest.
import { NextRequest, NextResponse } from 'next/server'
import { parkingGate } from '@/lib/parking-gate'
import { buildParkingBoard, claimSpare, logParking } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({} as any))
  const gate = await parkingGate(req, String(params.code || ''), String(body?.pass || ''))
  if (!gate.ok) return gate.res
  if (!gate.signedIn) {
    return NextResponse.json({ ok: false, error: 'Assigning a spare needs a Lighthouse sign-in.' }, { status: 403 })
  }

  const permitId = String(body?.permitId || '').trim()
  const reservationId = String(body?.reservationId || '').trim()
  if (!permitId || !reservationId) return NextResponse.json({ ok: false, error: 'Pick a spare and a stay.' }, { status: 400 })

  const board = await buildParkingBoard(gate.link)
  const row = board.rows.find(r => r.reservationId === reservationId)
  if (!row) return NextResponse.json({ ok: false, error: 'That stay is not on this link.' }, { status: 403 })
  if (row.permit) return NextResponse.json({ ok: false, error: 'That stay already has a permit.' }, { status: 409 })
  if (!board.pool.items.some(s => s.id === permitId)) {
    return NextResponse.json({ ok: false, error: 'That spare is not in this pool.' }, { status: 403 })
  }

  const who = gate.who || 'office'
  const res = await claimSpare({
    permitId, building: board.building, who,
    stay: { reservationId: row.reservationId, listingId: row.listingId, unit: row.unit, checkIn: row.checkIn, checkOut: row.checkOut },
  })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 409 })

  await logParking({ code: gate.link.code, action: 'assign', ip: gate.ip,
    detail: 'spare ' + permitId + ' -> ' + reservationId + ' · ' + row.unit + ' · by ' + who })
  return NextResponse.json({ ok: true, id: res.id, left: Math.max(0, board.pool.spare - 1) })
}

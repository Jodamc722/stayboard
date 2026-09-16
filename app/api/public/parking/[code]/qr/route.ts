// READ ONE PERMIT — a short-lived signed URL, handed back for an <img src>.
//
//   POST { pass, id } -> { ok, url, expiresIn }
//
// The storage path never reaches the browser and the bucket is private, so the only way to see a
// QR is to ask this route, with this link, for a permit this link covers. The URL expires in five
// minutes: long enough to render or print, short enough that a pasted link is useless by the time
// it is read. A public bucket would have made every QR a permanent, un-revokable gate key.
import { NextRequest, NextResponse } from 'next/server'
import { parkingGate } from '@/lib/parking-gate'
import { buildParkingBoard, signedQrUrl, logParking, QR_SIGNED_SECONDS } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({} as any))
  const gate = await parkingGate(req, String(params.code || ''), String(body?.pass || ''))
  if (!gate.ok) return gate.res

  const id = String(body?.id || '').trim()
  if (!/^[0-9a-f-]{16,64}$/i.test(id)) return NextResponse.json({ ok: false, error: 'Which permit?' }, { status: 400 })

  // THE SCOPE GUARD. Rebuilding the board is what tells us which reservations this link covers —
  // without it a permit id from one building would open through another building's link.
  const board = await buildParkingBoard(gate.link)
  const url = await signedQrUrl(id, {
    building: board.building,
    reservationIds: new Set(board.rows.map(r => r.reservationId)),
  })
  if (!url) return NextResponse.json({ ok: false, error: 'That permit is not on this link.' }, { status: 404 })

  await logParking({ code: gate.link.code, action: 'view', detail: 'permit ' + id, ip: gate.ip })
  return NextResponse.json({ ok: true, url, expiresIn: QR_SIGNED_SECONDS })
}

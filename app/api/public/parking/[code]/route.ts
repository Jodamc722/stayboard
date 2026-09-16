// THE PARKING BOARD — every upcoming stay at the link's building, and what the vendor has sent back.
//
//   POST { pass } -> the board, or { locked: true }
//
// POST rather than GET because the passcode is in the body: see lib/parking-gate.
import { NextRequest, NextResponse } from 'next/server'
import { parkingGate } from '@/lib/parking-gate'
import { buildParkingBoard, logParking } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({} as any))
  const gate = await parkingGate(req, String(params.code || ''), String(body?.pass || ''))
  if (!gate.ok) return gate.res
  try {
    const board = await buildParkingBoard(gate.link)
    await logParking({ code: gate.link.code, action: 'open', detail: gate.signedIn ? 'signed in · ' + (gate.who || '') : 'passcode', ip: gate.ip })
    // `canAssign` is the office's extra power on the same page: bind a spare to a stay when a
    // last-minute booking lands and the vendor is not working. The vendor never sees the control,
    // and the route that performs it checks for a session of its own.
    return NextResponse.json({ ...board, canAssign: gate.signedIn })
  } catch (e: any) {
    // A failed read says so. It does not render an empty board, which reads as "no arrivals".
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

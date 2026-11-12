// INQUIRY AND BOOKING-REQUEST ANSWERS FROM THE THREAD (lib/guesty-requests).
//   GET  ?reservationId=…                          → { status, source, can:{preapprove,approve,decline}, inGuesty:[…], reasons }
//   POST { reservationId, action, reason?, message? } → asks Guesty to pre-approve / accept / decline
// Every answer is one person's press, gated on edit access to Messages, logged with who and what (never the
// message to the guest). Guesty processes it in the background; the reply says the status it reads back.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { logActivity } from '@/lib/activity'
import { liveRequestState, runBookingAction, DECLINE_REASONS, type BookingAction } from '@/lib/guesty-requests'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('messages', 'view'); if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('reservationId') || '').trim()
  if (!id) return NextResponse.json({ ok: false, error: 'reservationId required' }, { status: 400 })
  try { return NextResponse.json({ ok: true, ...(await liveRequestState(id)), reasons: DECLINE_REASONS }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 502 }) }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('messages', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const id = String(b?.reservationId || '').trim()
  const action = String(b?.action || '') as BookingAction
  if (!id || ['preapprove', 'approve', 'decline'].indexOf(action) < 0) return NextResponse.json({ ok: false, error: 'reservationId and action (preapprove | approve | decline) required' }, { status: 400 })
  const log = (outcome: string, extra: Record<string, any> = {}) => logActivity({
    email: String(g.access.email || ''), kind: 'api', path: '/api/messages/booking', feature: 'messages:booking', need: 'edit', allowed: true,
    meta: { reservationId: id, action, reason: action === 'decline' ? String(b?.reason || '') : undefined, outcome, ...extra },
  })
  try {
    const r = await runBookingAction(id, action, { reason: b?.reason, message: b?.message })
    log('sent', { status: r.status })
    return NextResponse.json({ ok: true, status: r.status })
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 300)
    log('refused', { error: error.slice(0, 120) })
    return NextResponse.json({ ok: false, error }, { status: 409 })
  }
}

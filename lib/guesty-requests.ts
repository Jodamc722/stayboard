// INQUIRIES AND BOOKING REQUESTS FROM THE INBOX (Jon, 2026-11-12: "I want to be able to fully integrate and manage
// guest messages from Lighthouse" → "Inquiries & requests").
//
// What Guesty's Open API lets us do (verified against open-api-docs.guesty.com, 2026-11-12):
//   · PRE-APPROVE an Airbnb inquiry — POST /reservations-v3/{id}/pre-approve (status must be 'inquiry');
//   · ACCEPT a booking request     — POST /reservations-v3/{id}/approve     (status must be 'reserved');
//   · DECLINE a booking request    — POST /reservations-v3/{id}/decline     { reason, messageToGuest }
//     (status must be 'reserved'; Airbnb refuses a decline without a reason).
// All three are processed by Guesty asynchronously: a 200 means "request created", and the reservation's status
// changes a moment later — so we say "sent to Guesty" and re-read the booking, never "done".
//
// What it does NOT let us do: send an Airbnb SPECIAL OFFER (no endpoint), decline an inquiry, or quote a Vrbo
// inquiry. Those stay one tap away in Guesty, and the thread says so instead of pretending.
import 'server-only'
import { guestyGet, guestyWrite, pullReservationsByIds } from './guesty'

export type BookingAction = 'preapprove' | 'approve' | 'decline'

/** Airbnb's decline reasons, as a host reads them. The key is what Guesty passes on. */
export const DECLINE_REASONS: { key: string; label: string }[] = [
  { key: 'dates_not_available', label: 'Dates aren’t available' },
  { key: 'not_a_good_fit', label: 'Not a good fit for the home' },
  { key: 'waiting_for_better_reservation', label: 'Waiting for a better booking' },
  { key: 'not_comfortable', label: 'Not comfortable with the request' },
  { key: 'other', label: 'Other' },
]

export type RequestState = {
  status: string
  source: string
  /** What can be done to this booking from the inbox right now. */
  can: { preapprove: boolean; approve: boolean; decline: boolean }
  /** Things only Guesty can do for it (special offer, quoting an inquiry). */
  inGuesty: string[]
}

const isAirbnb = (src: string) => /airbnb/i.test(src)

/** The actions a status allows — the same test the server applies before it calls Guesty. */
export function actionsFor(status: string, source: string): RequestState['can'] & { inGuesty: string[] } {
  const st = String(status || '').toLowerCase()
  const air = isAirbnb(source)
  const inquiry = st === 'inquiry'
  const request = st === 'reserved'
  const inGuesty: string[] = []
  if (inquiry && air) inGuesty.push('Special offer')
  if (inquiry && !air) inGuesty.push('Send a quote')
  return { preapprove: inquiry && air, approve: request, decline: request, inGuesty }
}

/** The booking's live status and channel from Guesty (our copy can be minutes old — an action must not be). */
export async function liveRequestState(reservationId: string): Promise<RequestState> {
  const r = await guestyGet<any>(`/reservations/${encodeURIComponent(reservationId)}?fields=status%20source%20integration.platform`)
  const d = r?.data ?? r
  const status = String(d?.status || '')
  const source = String(d?.source || d?.integration?.platform || '')
  const a = actionsFor(status, source)
  return { status, source, can: { preapprove: a.preapprove, approve: a.approve, decline: a.decline }, inGuesty: a.inGuesty }
}

/** Run one action. Throws a sentence a person can read when Guesty refuses. */
export async function runBookingAction(reservationId: string, action: BookingAction, opts: { reason?: string; message?: string } = {}): Promise<{ status: string }> {
  const st = await liveRequestState(reservationId)
  if (!st.can[action]) {
    const what = action === 'preapprove' ? 'pre-approved (only an Airbnb inquiry can be)' : action === 'approve' ? 'accepted (only a booking request waiting on us can be)' : 'declined (only a booking request waiting on us can be)'
    throw new Error(`This booking is “${st.status || 'unknown'}” now, so it can’t be ${what}.`)
  }
  const id = encodeURIComponent(reservationId)
  try {
    if (action === 'preapprove') await guestyWrite(`/reservations-v3/${id}/pre-approve`)
    else if (action === 'approve') await guestyWrite(`/reservations-v3/${id}/approve`)
    else {
      const reason = DECLINE_REASONS.some(r => r.key === opts.reason) ? String(opts.reason) : ''
      if (isAirbnb(st.source) && !reason) throw new Error('Airbnb needs a reason to decline.')
      const body: Record<string, string> = {}
      if (reason) body.reason = reason
      const msg = String(opts.message || '').trim()
      if (msg) body.messageToGuest = msg.slice(0, 2000)
      await guestyWrite(`/reservations-v3/${id}/decline`, body)
    }
  } catch (e: any) {
    const raw = String(e?.message || e)
    if (/DUPLICATE_APPROVE_DECLINE|Duplicate/i.test(raw)) throw new Error('Guesty already has an answer on its way for this booking — give it a minute.')
    if (/INVALID_RESERVATION_STATUS/i.test(raw)) throw new Error('Guesty says this booking is no longer waiting on an answer.')
    throw new Error(raw.replace(/^Guesty \S+ /, 'Guesty said ').slice(0, 300))
  }
  // Guesty works the request in the background; read the booking again after a moment so our copy follows.
  await new Promise(r => setTimeout(r, 3500))
  await pullReservationsByIds([reservationId]).catch(() => 0)
  const after = await liveRequestState(reservationId).catch(() => null)
  return { status: after?.status || st.status }
}

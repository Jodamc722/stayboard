// IS A GUEST IN THIS UNIT? One answer, used everywhere.
//
// Three surfaces decide occupancy — the vacant list on Today in Ops, the 14-day strip in the signal
// panel, and the reschedule day-picker — and they had each grown their OWN status test:
//   vacant list   /confirm|checked/i        (missed 'closed')
//   14-day strip  status IN (confirmed, closed)   (missed 'checked_in')
//   reschedule    /confirm|checked/i        (missed 'closed')
// So the same reservation could read OCCUPIED on one screen and FREE on another. A unit shown free
// while a guest is in it is how a walk-in happens, which makes this the one place in the app where
// disagreeing definitions are genuinely dangerous.
//
// The test is now an EXCLUSION, deliberately: a stay counts as live unless it is positively dead.
// Guesty can add a status tomorrow (reserved, awaiting_payment, checked_in) and an unknown status
// will read as OCCUPIED rather than silently freeing up a unit. Wrong in the safe direction.
//
// Inquiries are NOT bookings — an unconverted inquiry must never hold a unit off the vacant list.

/** Statuses that do NOT hold the unit: nothing to walk in on. */
export const DEAD_STAY = /cancel|declin|expire|denied|inquir|unavailable/i

/** True when this reservation should be treated as holding the unit. */
export function isLiveStay(status: any): boolean {
  const s = String(status || '').trim()
  if (!s) return false
  return !DEAD_STAY.test(s)
}

/** True when a live stay spans 'date' (YYYY-MM-DD): check-in day counts, check-out day does not. */
export function staySpans(res: { check_in?: any; check_out?: any; status?: any }, date: string): boolean {
  if (!isLiveStay(res && res.status)) return false
  const ci = String((res && res.check_in) || '').slice(0, 10)
  const co = String((res && res.check_out) || '').slice(0, 10)
  if (!ci || !co) return false
  return ci <= date && date < co
}

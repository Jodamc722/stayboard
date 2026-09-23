// IS THIS THE SAME PERSON? — one rule, used wherever a checkout and a check-in sit on the same unit.
//
// Jon, 2026-09-23: "if you notice a checkout and a check-in with the same reservation name, you
// should flag it in the scheduler and in the app. For example, Danny books with us, and then the
// same Danny books the same unit for the day of the checkout instead of extending."
//
// Guesty has two reservations; the field has one stay. Nobody leaves, nothing needs stripping, and
// a cleaner sent in walks into an occupied unit. It also usually means money on the table — the
// guest meant to extend and booked again instead, often at a different rate.
//
// IDENTITY, NOT RESEMBLANCE. This rule is lifted verbatim from lib/daysheet.ts, where it has been
// standing cleaners down since August, because two rules would drift and the one that drifted would
// be the one that sends somebody into an occupied unit. Surname + first initial is NOT enough:
// "Jose Garcia" and "Juan Garcia" are two people. Two nameless bookings both normalise to "Guest",
// so a name match needs a real name on both sides.
export function realGuestName(x: unknown): string {
  const n = String(x ?? '').trim()
  return n && n.toLowerCase() !== 'guest' ? n.toLowerCase().replace(/\s+/g, ' ') : ''
}

export function samePhoneNumber(a: unknown, b: unknown): boolean {
  const x = String(a ?? '').replace(/\D/g, ''), y = String(b ?? '').replace(/\D/g, '')
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9)
}

export type GuestRef = { guestId?: string | null; phone?: string | null; name?: string | null }

/** True when the outgoing and incoming reservations are the same human being. */
export function sameGuest(out: GuestRef, arr: GuestRef): boolean {
  if (!out || !arr) return false
  if (out.guestId && arr.guestId && String(out.guestId) === String(arr.guestId)) return true
  if (samePhoneNumber(out.phone, arr.phone)) return true
  const a = realGuestName(out.name)
  return a !== '' && a === realGuestName(arr.name)
}

// WHO IS ON THE ID, AND IS IT THE PERSON WHO BOOKED? (Jon, 2026-10-21: "make sure the ID
// verification and deposit section in Today is working and it's looking at booking details and
// verifying that it matches the reservation name and that it's been added. If photo added but
// unsure flag to check.")
//
// Until now the guest's link marked a stay VERIFIED the moment two photos landed — nobody, and
// nothing, read the ID. Now the photos are read (lib/direct-booking checkId, the same check the
// direct booking page runs) and the name on the ID is held against the name on the booking. Only a
// readable, current ID in the booking's name is "verified"; a photo that is there but cannot be
// vouched for is a CHECK — flagged for a person, never silently green and never silently lost.
//
// Pure functions, no imports, so lib/__tests__/guest-id-match.test.mjs runs them with plain node.

export type NameMatch = 'match' | 'mismatch' | 'unread'
export type IdRead = {
  isId: boolean; readable: boolean; expired: boolean; face: boolean; screen: boolean
  nameOnId: string | null; resembles: 'yes' | 'no' | 'unsure'
}
export type IdVerdict = {
  /** retake — ask the guest again, keep nothing · verified — the booking's own ID · check — a person has to look */
  status: 'verified' | 'check' | 'retake'
  match: NameMatch
  reasons: string[]
  nameOnId: string | null
}

const HONORIFIC = /^(mr|mrs|ms|miss|dr|sr|sra|srta|prof|sir|jr|ii|iii|iv)$/
const COMPANY = /\b(llc|inc|ltd|corp|corporation|company|co|group|holdings|capital|partners|lp|plc|gmbh|sa|sas|srl|bv)\b/i

/** Lowercase, accents off, anything that is not a letter becomes a space: "O'Brien, Patricia" → "o brien patricia". */
export function normName(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim()
}
/** Name words worth comparing: no honorifics, no one-letter initials. */
export function nameTokens(s: string): string[] {
  return normName(s).split(' ').filter(t => t.length > 1 && !HONORIFIC.test(t))
}
/** The booking names a company, not a person — no ID can match it; a person has to look. */
export function looksLikeCompany(s: string): boolean { return COMPANY.test(String(s || '')) }

/** One slip in a long word is the camera, not a different person (RN↔M, 0↔O, a dropped letter). */
function close(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5) return false
  if (Math.abs(a.length - b.length) > 1) return false
  // Levenshtein distance ≤ 1, without the matrix: walk both strings once.
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}
const has = (tokens: string[], t: string) => tokens.some(x => close(x, t))
const startsOne = (tokens: string[], t: string) => tokens.some(x => (t.length >= 3 && x.startsWith(t)) || (x.length >= 3 && t.startsWith(x)))

/**
 * Does the name on the ID belong to the person on the booking? The booking's LAST name must be on
 * the ID, and its FIRST name too — or an unambiguous start of it ("Ale" / "Alejandro", "Pat" /
 * "Patricia"; a nickname is never guessed). Order and middle names are free ("DOE JOHN ROBERT" is
 * John Doe), accents and hyphens do not count, and one letter slipped by the camera in a long name
 * is forgiven. A booking that names a company matches nothing.
 */
export function namesMatch(onId: string, booking: string): boolean {
  const id = nameTokens(onId), bk = nameTokens(booking)
  if (!id.length || !bk.length || looksLikeCompany(booking)) return false
  if (bk.length === 1) return has(id, bk[0])
  const first = bk[0], last = bk[bk.length - 1]
  // The surname is exact (one camera slip allowed) — "Martin" is not "Martinez", full stop. The
  // first name may be a start: IDs print "Alejandro" where the booking says "Ale", and bookings say "Pat".
  if (!has(id, last)) return false
  if (has(id, first) || startsOne(id, first)) return true
  // Swapped order or a double-barrelled given name: every other booking word is on the ID.
  return bk.slice(0, -1).every(t => has(id, t) || startsOne(id, t))
}

/**
 * The verdict for a link submission. `read` is what the model read off the photos (null when the
 * check could not run); `typed` is the name the guest typed in; `booking` is the reservation's guest.
 */
export function decideLink(read: IdRead | null, typed: string, booking: string): IdVerdict {
  const reasons: string[] = []
  if (!read) {
    // The model did not answer: the photos are kept and a person looks. The typed name is the only
    // name there is, and it is the guest's own claim — enough to say what to look for, not to pass.
    const m: NameMatch = namesMatch(typed, booking) ? 'match' : 'mismatch'
    reasons.push('automatic check did not run — look at the photos')
    if (m === 'mismatch' && typed) reasons.push(`typed name "${typed}" is not the booking's "${booking}"`)
    return { status: 'check', match: 'unread', reasons, nameOnId: null }
  }
  if (!read.isId) return { status: 'retake', match: 'unread', reasons: ['The first photo does not look like a government photo ID. Please photograph your driver\'s licence, passport or national ID.'], nameOnId: null }
  if (!read.face) return { status: 'retake', match: 'unread', reasons: ['We could not see your face clearly in the selfie. Retake it facing the camera, in good light.'], nameOnId: null }
  if (read.screen) return { status: 'retake', match: 'unread', reasons: ['The selfie needs to be taken live with your camera, not a photo of a picture or screen.'], nameOnId: null }

  const nameOnId = read.nameOnId ? String(read.nameOnId).trim().slice(0, 120) : null
  let match: NameMatch = 'unread'
  if (nameOnId) match = namesMatch(nameOnId, booking) ? 'match' : 'mismatch'
  if (!read.readable) reasons.push('ID could not be read clearly')
  if (read.expired) reasons.push('ID looks expired')
  if (match === 'unread') reasons.push('name on the ID was not read')
  if (match === 'mismatch') reasons.push(`name on the ID "${nameOnId}" is not the booking's "${booking}"${looksLikeCompany(booking) ? ' (a company booked)' : ''}`)
  if (read.resembles === 'no') reasons.push('selfie may not match the ID photo')
  if (nameOnId && typed && !namesMatch(nameOnId, typed) && match === 'match') reasons.push(`typed "${typed}", ID reads "${nameOnId}"`)
  const pass = read.readable && !read.expired && match === 'match' && read.resembles !== 'no'
  return { status: pass ? 'verified' : 'check', match, reasons: pass ? [] : reasons, nameOnId }
}

// ── THE DEPOSIT, READ OFF THE BOOKING (same ask: "that it's been added") ─────────────────────────
// A security deposit placed through Guesty shows up on the reservation's money.payments. On the
// live bookings (peeked 2026-10-21) it reads: `isSecurityDeposit: true` and a status of
// SECURITY_DEPOSIT_SUCCEEDED once the hold is on the card, with paidAt; a hold Guesty has not placed
// yet is `isAuthorizationHold: true` with status PENDING and a shouldBePaidAt (it places it a day or
// two before arrival). When the team arranged the deposit there, the desk must not ask them to type
// it in again.
export type GuestyHold = {
  amount: number; currency: string
  /** held = on the card now · scheduled = Guesty will place it (shouldBePaidAt) · captured = taken · released = let go · failed */
  status: 'held' | 'scheduled' | 'captured' | 'released' | 'failed'
  at: string | null; due: string | null; ref: string | null; note: string
}

function holdStatus(p: any): GuestyHold['status'] | null {
  const s = String(p?.status || '').toUpperCase()
  if (p?.authorizationHoldCaptured === true || p?.isCaptured === true || /CAPTURED|CHARGED/.test(s)) return 'captured'
  if (/CANCEL|VOID|RELEASE|EXPIRE|REFUND/.test(s) || p?.releasedAt || p?.canceledAt || p?.cancelledAt) return 'released'
  if (/FAIL|DECLIN|ERROR/.test(s)) return 'failed'
  if (/PENDING|SCHEDUL/.test(s)) return 'scheduled'
  if (/SUCCE|AUTHORI|PAID|HELD|HOLD|APPROV/.test(s) || !s) return 'held'
  return null   // the unknown: not a deposit we can vouch for
}
/** Every deposit-shaped payment on the booking: a security deposit, an authorization hold, or a payment Guesty labels a deposit. */
export function depositHoldsFromMoney(money: any): GuestyHold[] {
  const payments: any[] = Array.isArray(money?.payments) ? money.payments : []
  const out: GuestyHold[] = []
  for (const p of payments) {
    const note = String(p?.note || p?.description || p?.paymentType || p?.type || '')
    const st = String(p?.status || '').toUpperCase()
    const isHold = p?.isSecurityDeposit === true || p?.isAuthorizationHold === true || /SECURITY_DEPOSIT|AUTH_HOLD|AUTHORIZATION/.test(st)
      || /\bhold\b|deposit|security/i.test(note) || /HOLD|DEPOSIT/.test(String(p?.type || p?.paymentType || '').toUpperCase())
    if (!isHold) continue
    const amount = Number(p?.amount) || Number(p?.authorizationHold?.amount) || 0
    if (!(amount > 0)) continue
    const status = holdStatus(p)
    if (!status) continue
    out.push({ amount, currency: String(p?.currency || money?.currency || 'USD'), status, at: p?.paidAt || (status === 'scheduled' ? null : p?.createdAt) || null, due: p?.shouldBePaidAt || null, ref: p?._id ? String(p._id) : null, note })
  }
  return out
}
/** The hold that speaks for the deposit now: on the card first, then scheduled, captured, the newest released, failed last. */
export function depositFromMoney(money: any): GuestyHold | null {
  const holds = depositHoldsFromMoney(money)
  if (!holds.length) return null
  const rank: Record<GuestyHold['status'], number> = { held: 0, scheduled: 1, captured: 2, released: 3, failed: 4 }
  return holds.slice().sort((a, b) => rank[a.status] - rank[b.status] || String(b.at || b.due || '').localeCompare(String(a.at || a.due || '')))[0]
}

/** The Guesty "verified" custom field on a reservation, found by its definition id (the reservation's own entries carry no name). */
export function guestyVerifiedFlag(customFields: any, verifiedFieldId: string | null): boolean {
  if (!Array.isArray(customFields)) return false
  const idOf = (c: any) => String((c?.fieldId && c.fieldId._id) || (typeof c?.fieldId === 'string' ? c.fieldId : '') || c?._id || '')
  const nameOf = (c: any) => String(c?.fieldName || c?.name || (c?.fieldId && c.fieldId.name) || '')
  const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|verified|1|x)/i.test(v.trim()))
  return customFields.some(c => ((verifiedFieldId && idOf(c) === verifiedFieldId) || /^(id[ _-]?)?verified$/i.test(nameOf(c).trim())) && truthy(c?.value))
}

// PARKING LINK GATE — who may open /parking/<code> and post to its API.
//
// Three doors, in order:
//   1. a signed-in Lighthouse user — the office opens the same link and skips the passcode
//   2. the link's own passcode — what the vendor was given (per-request POST { pass })
//   3. nothing else. The standing share password that used to be a fallback is gone (2026-09-18:
//      every link has its own passcode); a parking row is REQUIRED to carry one at create time.
//
// Passcodes are scrypt hashes on the row (passcode_hash); the compare is constant-time and
// counted, five wrong in fifteen minutes locks the address (lib/passcode-gate).
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from './access'
import { passcodeMatches, checkRowPasscode } from './passcode-gate'
import { linkUsable } from './share-links'
import { touchLink } from './share-links-server'
import { getParkingLink, logParking, tooManyWrong, LOCKOUT_MINUTES, type ParkingLink } from './parking'

export type Gate =
  | { ok: true; link: ParkingLink; signedIn: boolean; who: string | null; ip: string | null }
  | { ok: false; res: NextResponse }

/** The caller's address, for the lockout counter. Vercel sets x-forwarded-for. */
function ipOf(req: NextRequest): string | null {
  const h = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
  const first = String(h).split(',')[0].trim()
  return first || null
}

export async function parkingGate(req: NextRequest, code: string, pass: string): Promise<Gate> {
  const ip = ipOf(req)
  const link = await getParkingLink(String(code || ''))
  // An unknown or revoked code says nothing about what it used to cover.
  if (!link) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'This parking link is not valid.' }, { status: 404 }) }
  }
  if (!linkUsable(link)) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'This parking link has expired.' }, { status: 410 }) }
  }

  // A LIGHTHOUSE USER, NOT MERELY A SUPABASE ONE. `getUser()` on its own says "this person has a
  // valid session in our Supabase project" — it says nothing about whether they still work here.
  // Every page in the app goes through middleware that checks app_users.status === 'active'; this
  // endpoint is on the open list and gets no middleware at all, so a deactivated employee would
  // have kept the passcode bypass AND the power to move a live gate credential onto another guest.
  // getAccess() is the same check the rest of the app makes.
  let signedIn = false
  let who: string | null = null
  try {
    const access = await getAccess()
    signedIn = !!access.user && !!access.allowed
    who = access.email ? String(access.email) : null
  } catch { signedIn = false }
  if (signedIn) return { ok: true, link, signedIn, who, ip }

  if (await tooManyWrong(link.code, ip)) {
    // DELIBERATELY NOT LOGGED. Writing another `denied` row while already locked out refreshes the
    // rolling window, so one request every fourteen minutes would keep an address locked out
    // forever — and the first thing a locked-out vendor does is retry, which is how the page would
    // have permanently locked the people it is for.
    return {
      ok: false,
      res: NextResponse.json({ ok: false, locked: true, label: link.label, needsPasscode: true,
        error: `Too many wrong passcodes. Try again in ${LOCKOUT_MINUTES} minutes.` }, { status: 429 }),
    }
  }

  // No passcode on the row and not open = shut. (The builder refuses to create a parking link
  // without one, so this is a row edited by hand.)
  const passOk = link.open ? true : (link.passcode_hash ? passcodeMatches(pass, String(link.passcode_hash)) : false)
  if (!passOk) {
    // A wrong attempt is counted; an empty one is just somebody arriving at the page.
    if (pass) await logParking({ code: link.code, action: 'denied', detail: 'wrong passcode', ip })
    return {
      ok: false,
      // Locked, and leaking only the label — never whose units or which building it covers.
      res: NextResponse.json({ ok: false, locked: true, label: link.label, needsPasscode: !link.open,
        error: pass ? 'That passcode did not match — ask Jon for this link’s passcode.' : undefined }, { status: pass ? 403 : 200 }),
    }
  }
  // A legacy plaintext row (migration 101) becomes a hash on the first correct entry.
  if (pass && link.passcode_hash && !/^s1\$/i.test(link.passcode_hash)) await checkRowPasscode(req, link, pass)
  touchLink({ id: link.id, code: link.code })
  return { ok: true, link, signedIn: false, who: null, ip }
}

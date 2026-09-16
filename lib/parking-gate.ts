// THE DOOR ON A PARKING LINK — one implementation, used by every parking endpoint.
//
// The link IS the credential: no login stands behind it, so anyone holding the URL can reach these
// endpoints directly. That is the same contract the scheduler link spells out, and it means the
// check cannot live in the browser. Every route calls this first.
//
// THREE WAYS IN, in the order they are tried:
//   1. a signed-in Lighthouse user — the office opens the same link and skips the passcode
//   2. the link's own passcode — what the vendor was given
//   3. the standing share password cookie — only when the link has no passcode of its own
//
// THE PASSCODE TRAVELS IN A POST BODY, NEVER A URL. A query string lands in server logs, browser
// history and any referrer header the page emits. The generic /share route made that choice and
// wrote down why; a link that hands out garage credentials does not get to be laxer.
//
// WORTH KNOWING, AND WORTH FIXING SEPARATELY: passcodes in `share_links` are stored in PLAINTEXT,
// for every link in the app, not just this one. This adds a wrong-attempt lockout so the code
// cannot be walked digit by digit, but a stolen database row is still a stolen passcode. Hashing
// them is a change to the whole share-link family and belongs in its own pass.
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from './shareAuth'
import { getAccess } from './access'
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

  const shareOk = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value).catch(() => false)
  const passOk = link.passcode ? pass === link.passcode : shareOk
  if (!passOk) {
    // A wrong attempt is counted; an empty one is just somebody arriving at the page.
    if (pass) await logParking({ code: link.code, action: 'denied', detail: 'wrong passcode', ip })
    return {
      ok: false,
      // Locked, and leaking only the label — never whose units or which building it covers.
      res: NextResponse.json({ ok: false, locked: true, label: link.label, needsPasscode: !!link.passcode,
        error: pass ? 'That passcode did not match.' : undefined }, { status: pass ? 403 : 200 }),
    }
  }
  return { ok: true, link, signedIn: false, who: null, ip }
}

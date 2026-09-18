// ONE PASSCODE GATE FOR EVERY SHARE LINK (2026-09-18 audit, P0-5; per-link the same evening).
//
// Six routes each checked a passcode their own way: `pw !== cur` (not constant-time), stored in
// plaintext, no attempt limit, and a cookie that was sha256(prefix + password) — forgeable by
// anyone who learned the password once, with no server secret and no expiry. This file is the one
// place that logic lives now.
//
// THE FOUR RULES:
//   1. LOCKOUT. Wrong attempts are counted in parking_access_log (the parking link's ledger, so it
//      survives a redeploy), keyed by gate and by address: 5 wrong in 15 minutes and the address
//      waits. A busy front desk behind one NAT gets a higher per-gate ceiling, same as parking.
//   2. CONSTANT-TIME COMPARE, whether the stored value is a scrypt hash or a legacy plaintext.
//   3. HASH ON SAVE, UPGRADE ON USE. New passcodes are stored as scrypt ("s1$salt$hash",
//      lib/edit-access). A plaintext row written before this still works — and the first correct
//      entry rewrites it as a hash. Nothing has to be reset for the change to land.
//   4. A SIGNED, EXPIRING COOKIE. `exp.gen.hmac` under the server secret; `gen` is derived from
//      the stored value, so changing the passcode still invalidates every cookie, as before.
//      Thirty days, then the person types it again.
//
// Passcodes travel in a POST body. The `?pass=` query string the field board and scheduler used
// to accept is gone: query strings end up in logs, history and referrers.
//
// PER LINK, NOT PER FAMILY (Jon, 2026-09-18: "should not be team password — individual password
// per link"). The four family passwords in share_settings (1/3/4/7) are retired. Every shareable
// page is now a share_links row with its own passcode_hash; the cookie is `lk_<code>`, and its
// generation is derived from THAT row's hash, so rotating one link's passcode logs out only that
// link's holders. See lib/share-links.ts for the model and migration 101 for the move.
//
// DEPLOY ORDER (review, 2026-09-18): the code ships before Jon runs migration 101. Until it runs,
// getLink() (lib/share-links-server) synthesises the family rows from share_settings and the
// scheduler rows from schedule_links, so every link that opens today keeps opening on the same
// passcode — and a cookie minted then stays valid after the migration, because the row it creates
// carries the same stored value and the cookie generation is derived from that value.
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from './supabase-admin'
import { hashPassword, verifyPassword } from './edit-access'
import { hmacHex, safeEqual, sha256Hex } from './signing'
import { logParking, tooManyWrong, LOCKOUT_MINUTES } from './parking'
import { cookies } from 'next/headers'
import { getAccess } from './access'
import { linkUsable, hintOf, type ShareLinkRow } from './share-links'
import { getLink, touchLink, legacySettingsId, isLegacyLink } from './share-links-server'

export const PASSCODE_COOKIE_DAYS = 30
export { LOCKOUT_MINUTES }

/** Caller address for the lockout counter (Vercel sets x-forwarded-for). */
export function ipOf(req: NextRequest | Request): string | null {
  const h = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
  const first = String(h).split(',')[0].trim()
  return first || null
}

const isHash = (stored: string) => /^s1\$[0-9a-f]+\$[0-9a-f]+$/i.test(String(stored || ''))

/** Does `pw` match `stored` (scrypt hash or legacy plaintext)? Constant-time either way. */
export function passcodeMatches(pw: string, stored: string): boolean {
  if (!pw || !stored) return false
  return isHash(stored) ? verifyPassword(pw, stored) : safeEqual(pw, stored)
}

/** What to write for a NEW passcode: always the hash. */
export function storablePasscode(pw: string): string { return hashPassword(pw) }

// ── Lockout ───────────────────────────────────────────────────────────────────────────────────
// `gate` is the ledger key: 'pw:share', 'pw:marketing', 'link:<code>' …
const WRONG_PER_IP = 5
export async function isLockedOut(gate: string, ip: string | null): Promise<boolean> {
  return tooManyWrong(gate, ip, WRONG_PER_IP)
}
export async function noteWrong(gate: string, ip: string | null, detail = 'wrong passcode'): Promise<void> {
  await logParking({ code: gate, action: 'denied', detail, ip })
}
export function lockedResponse(extra: Record<string, any> = {}): NextResponse {
  return NextResponse.json({ ok: false, locked: true, lockedOut: true, ...extra,
    error: `Too many wrong passcodes. Try again in ${LOCKOUT_MINUTES} minutes.` }, { status: 429 })
}

/**
 * The whole check for a per-link passcode (share_links / schedule_links rows): lockout, compare,
 * count a miss, and optionally upgrade a plaintext row in `table` to a hash.
 * Returns 'ok' | 'wrong' | 'locked'. An EMPTY attempt is 'wrong' without being counted: that is
 * someone arriving at the page, not guessing.
 */
export async function checkLinkPasscode(req: NextRequest | Request, gate: string, pw: string, stored: string,
  upgrade?: { table: string; column?: string; match: Record<string, any> }): Promise<'ok' | 'wrong' | 'locked'> {
  const ip = ipOf(req)
  if (await isLockedOut(gate, ip)) return 'locked'
  if (!passcodeMatches(pw, stored)) {
    if (pw) await noteWrong(gate, ip)
    return 'wrong'
  }
  if (upgrade && !isHash(stored)) await upgradeRow(upgrade.table, upgrade.column || 'passcode', upgrade.match, pw)
  return 'ok'
}

async function upgradeRow(table: string, column: string, match: Record<string, any>, pw: string): Promise<void> {
  try {
    const patch: Record<string, string> = { [column]: hashPassword(pw) }
    if (table === 'share_links' && column === 'passcode_hash') patch.passcode_hint = hintOf(pw)
    let q: any = supabaseAdmin().from(table).update(patch)
    for (const k of Object.keys(match)) q = q.eq(k, match[k])
    await q
  } catch { /* the upgrade is opportunistic; the next correct entry tries again */ }
}

// ── Per-link gates ────────────────────────────────────────────────────────────────────────────

/** Cookie name for one link. Codes are [a-z0-9-]; anything else is stripped so the name is valid. */
export const linkCookieName = (code: string) => 'lk_' + String(code || '').toLowerCase().replace(/[^a-z0-9_-]/g, '')

// cookie = "<expMs>.<gen>.<hmac>"; gen ties the cookie to the CURRENT passcode hash of THAT row.
const linkGen = (code: string, stored: string) => sha256Hex('lkgen:' + code + ':' + stored).slice(0, 16)

export function linkCookieToken(code: string, stored: string): string {
  const payload = String(Date.now() + PASSCODE_COOKIE_DAYS * 86400000) + '.' + linkGen(code, stored)
  return payload + '.' + hmacHex('lkcookie:' + code, payload)
}

/** FAIL CLOSED: no cookie, no passcode on the row, bad signature, expired or stale gen → false. */
export function linkCookieOk(link: Pick<ShareLinkRow, 'code' | 'passcode_hash'>, cookieVal: string | undefined | null): boolean {
  if (!cookieVal || !link.passcode_hash) return false
  const parts = String(cookieVal).split('.')
  if (parts.length !== 3) return false
  const [expStr, gen, sig] = parts
  const exp = Number(expStr)
  if (!exp || exp < Date.now()) return false
  let good = ''
  try { good = hmacHex('lkcookie:' + link.code, expStr + '.' + gen) } catch { return false }
  if (!safeEqual(sig, good)) return false
  return safeEqual(gen, linkGen(link.code, String(link.passcode_hash)))
}

/** A signed-in LIGHTHOUSE user (allowlisted, active) — the office opens any link without its passcode. */
export async function signedInUser(): Promise<{ signedIn: boolean; who: string | null }> {
  try { const a = await getAccess(); return { signedIn: !!a.user && !!a.allowed, who: a.email ? String(a.email) : null } } catch { return { signedIn: false, who: null } }
}

export type LinkGate =
  | { ok: true; link: ShareLinkRow; signedIn: boolean; who: string | null }
  | { ok: false; res: NextResponse; link: ShareLinkRow | null; reason: 'unknown' | 'expired' | 'unset' | 'locked' }

const gone = (msg: string, status = 404) => NextResponse.json({ ok: false, error: msg, gone: true }, { status })

/**
 * THE CHECK for a page that opens on a link row: resolve the code, refuse revoked / expired, let a
 * signed-in user through, otherwise require this link's cookie. Bumps uses / last_used_at on a
 * pass. `needsPassword: true` on the 401 is what every public page already looks for.
 */
export async function linkGate(code: string, opts: { kinds?: string[]; touch?: boolean } = {}): Promise<LinkGate> {
  const link = await getLink(code)
  if (!link || (opts.kinds && opts.kinds.indexOf(String(link.kind)) < 0)) return { ok: false, res: gone('This link is not active.'), link: null, reason: 'unknown' }
  if (!linkUsable(link)) return { ok: false, res: gone(link.revoked_at ? 'This link was turned off.' : 'This link has expired.', 410), link, reason: 'expired' }
  const me = await signedInUser()
  if (me.signedIn) return { ok: true, link, signedIn: true, who: me.who }
  if (link.open) { if (opts.touch !== false) touchLink(link); return { ok: true, link, signedIn: false, who: null } }
  if (!link.passcode_hash) {
    return { ok: false, link, reason: 'unset', res: NextResponse.json({ ok: false, needsPassword: true, unset: true, label: link.title || link.label || 'Shared page',
      error: 'This link has no passcode yet — ask Jon for this link’s passcode.' }, { status: 401 }) }
  }
  let cookieVal: string | undefined
  try { cookieVal = cookies().get(linkCookieName(link.code))?.value } catch { cookieVal = undefined }
  if (!linkCookieOk(link, cookieVal)) {
    // NO HINT HERE: the hint is the passcode's last two characters, for the hub after the reveal.
    // It never goes to an unauthenticated caller.
    return { ok: false, link, reason: 'locked', res: NextResponse.json({ ok: false, needsPassword: true, label: link.title || link.label || 'Shared page', error: 'This link needs its passcode — ask Jon for this link’s passcode.' }, { status: 401 }) }
  }
  if (opts.touch !== false) touchLink(link)
  return { ok: true, link, signedIn: false, who: null }
}

/**
 * For the helper routes a board calls without knowing its own code (banner-set, board-note,
 * board-resync, the Salato rules): pass if ANY live link of these kinds is unlocked in this
 * browser, or the person is signed in.
 */
export async function anyLinkGate(kinds: string[]): Promise<LinkGate> {
  const me = await signedInUser()
  if (me.signedIn) return { ok: true, link: null as any, signedIn: true, who: me.who }
  let all: { name: string; value: string }[] = []
  try { all = cookies().getAll() } catch { all = [] }
  for (const c of all) {
    if (c.name.indexOf('lk_') !== 0) continue
    const link = await getLink(c.name.slice(3))
    if (!link || kinds.indexOf(String(link.kind)) < 0 || !linkUsable(link)) continue
    if (linkCookieOk(link, c.value)) return { ok: true, link, signedIn: false, who: null }
  }
  return { ok: false, link: null, reason: 'locked', res: NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 }) }
}

/** True when the request may act as a holder of one of these link kinds (cookie) or is signed in. */
export async function anyLinkAuthed(kinds: string[]): Promise<boolean> { return (await anyLinkGate(kinds)).ok }

/**
 * POST handler body for a per-link login: resolve → lockout → compare → set this link's cookie.
 * The gate key is 'link:<code>' so five wrong guesses on one link do not lock the others.
 */
export async function linkLogin(req: NextRequest, code: string, pw: string): Promise<NextResponse> {
  const link = await getLink(code)
  if (!link) return NextResponse.json({ ok: false, error: 'This link is not active.' }, { status: 404 })
  if (!linkUsable(link)) return NextResponse.json({ ok: false, error: link.revoked_at ? 'This link was turned off.' : 'This link has expired.' }, { status: 410 })
  if (link.open) { const r = NextResponse.json({ ok: true, open: true }); return r }
  if (!link.passcode_hash) return NextResponse.json({ ok: false, error: 'This link has no passcode yet — ask Jon for this link’s passcode.' }, { status: 503 })
  const gate = 'link:' + link.code
  const ip = ipOf(req)
  if (await isLockedOut(gate, ip)) return lockedResponse()
  if (!passcodeMatches(pw, String(link.passcode_hash))) {
    if (pw) await noteWrong(gate, ip)
    return NextResponse.json({ ok: false, error: 'Wrong passcode — ask Jon for this link’s passcode.' }, { status: 401 })
  }
  let current = String(link.passcode_hash)
  if (!isHash(current)) {
    // A legacy plaintext row (carried over by migration 101) becomes a hash on the first correct
    // entry; the cookie is minted against the NEW value so this login does not invalidate itself.
    // Before the migration has run the "row" is share_settings (lib/share-links-server
    // legacyFamilyLink): the upgrade lands there, and the migration copies the hash across.
    const hashed = hashPassword(pw)
    const settingsId = legacySettingsId(link.id)
    try {
      const { error } = settingsId !== null
        ? await supabaseAdmin().from('share_settings').update({ password: hashed }).eq('id', settingsId)
        : await supabaseAdmin().from('share_links').update({ passcode_hash: hashed, passcode_hint: hintOf(pw) }).eq('id', link.id)
      if (!error) current = hashed
    } catch { /* stays plaintext until the next correct entry */ }
  }
  touchLink(link)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(linkCookieName(link.code), linkCookieToken(link.code, current), { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * PASSCODE_COOKIE_DAYS })
  return res
}

/** Per-request passcode check for a row (field board / scheduler / parking POST { pass }): lockout + compare + hash upgrade. */
export async function checkRowPasscode(req: NextRequest | Request, link: Pick<ShareLinkRow, 'id' | 'code' | 'passcode_hash'>, pw: string): Promise<'ok' | 'wrong' | 'locked'> {
  // A row synthesised before migration 101 (lib/share-links-server) has nothing in share_links to upgrade.
  const upgrade = isLegacyLink(link.id) ? undefined : { table: 'share_links', column: 'passcode_hash', match: { id: link.id } }
  return checkLinkPasscode(req, 'link:' + link.code, pw, String(link.passcode_hash || ''), upgrade)
}

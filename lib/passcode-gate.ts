// ONE PASSCODE GATE FOR EVERY SHARE LINK (2026-09-18 audit, P0-5).
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
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from './supabase-admin'
import { hashPassword, verifyPassword } from './edit-access'
import { hmacHex, safeEqual, sha256Hex } from './signing'
import { logParking, tooManyWrong, LOCKOUT_MINUTES } from './parking'

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
    let q: any = supabaseAdmin().from(table).update({ [column]: hashPassword(pw) })
    for (const k of Object.keys(match)) q = q.eq(k, match[k])
    await q
  } catch { /* the upgrade is opportunistic; the next correct entry tries again */ }
}

// ── Family gates: one password per audience, in share_settings ────────────────────────────────
export type Family = 'share' | 'marketing' | 'audit' | 'botanica'
export const FAMILY: Record<Family, { id: number; cookie: string; label: string }> = {
  share:     { id: 1, cookie: 'share_ok', label: 'share' },
  marketing: { id: 3, cookie: 'mkt_ok',   label: 'marketing' },
  audit:     { id: 4, cookie: 'oa_ok',    label: 'audit' },
  // BOTANICA REPORT (P0-4): the owner money report used to open on the VENDOR password the
  // cleaning crews hold. Its own row, its own cookie.
  botanica:  { id: 7, cookie: 'bot_ok',   label: 'Botanica report' },
}

/** The stored value (hash or legacy plaintext) for a family, '' when unset. */
export async function familyStored(f: Family): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin().from('share_settings').select('password').eq('id', FAMILY[f].id).maybeSingle()
    if (error) { console.error(`share_settings ${f} read`, error.message); return '' }
    return data && (data as any).password ? String((data as any).password) : ''
  } catch (e) { console.error(`share_settings ${f} read`, e); return '' }
}

/** True when the row holds a hash (so the cleartext cannot be shown back in Settings). */
export function isHashedPasscode(stored: string): boolean { return isHash(stored) }

// cookie = "<expMs>.<gen>.<hmac>"; gen ties the cookie to the CURRENT stored value.
const genOf = (f: Family, stored: string) => sha256Hex('pwgen:' + f + ':' + stored).slice(0, 16)

export function familyCookieToken(f: Family, stored: string): string {
  const payload = String(Date.now() + PASSCODE_COOKIE_DAYS * 86400000) + '.' + genOf(f, stored)
  return payload + '.' + hmacHex('pwcookie:' + f, payload)
}

/** FAIL CLOSED: no cookie, no configured passcode, bad signature, expired or stale gen → false. */
export async function familyCookieValid(f: Family, cookieVal: string | undefined | null): Promise<boolean> {
  if (!cookieVal) return false
  const parts = String(cookieVal).split('.')
  if (parts.length !== 3) return false
  const [expStr, gen, sig] = parts
  const exp = Number(expStr)
  if (!exp || exp < Date.now()) return false
  let good = ''
  try { good = hmacHex('pwcookie:' + f, expStr + '.' + gen) } catch { return false }
  if (!safeEqual(sig, good)) return false
  const stored = await familyStored(f)
  if (!stored) return false
  return safeEqual(gen, genOf(f, stored))
}

/**
 * POST handler body for a family login: lockout → compare → upgrade → set cookie.
 * `unsetMsg` is what to say while no passcode is configured (the link stays shut).
 */
export async function familyLogin(req: NextRequest, f: Family, pw: string, unsetMsg: string): Promise<NextResponse> {
  const stored = await familyStored(f)
  if (!stored) return NextResponse.json({ ok: false, error: unsetMsg }, { status: 503 })
  const gate = 'pw:' + f
  const ip = ipOf(req)
  if (await isLockedOut(gate, ip)) return lockedResponse()
  if (!passcodeMatches(pw, stored)) {
    if (pw) await noteWrong(gate, ip)
    return NextResponse.json({ ok: false, error: 'Wrong password' }, { status: 401 })
  }
  let current = stored
  if (!isHash(stored)) {
    // Compare-then-upgrade: the row becomes a hash on the first correct entry. Cookies are minted
    // against the NEW value so this login does not immediately invalidate itself.
    const hashed = hashPassword(pw)
    try {
      const { error } = await supabaseAdmin().from('share_settings').update({ password: hashed }).eq('id', FAMILY[f].id)
      if (!error) current = hashed
    } catch { /* stays plaintext until the next correct entry */ }
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(FAMILY[f].cookie, familyCookieToken(f, current), { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * PASSCODE_COOKIE_DAYS })
  return res
}

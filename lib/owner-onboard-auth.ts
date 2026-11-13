// THE OWNER'S SIGN-IN TO THEIR ONBOARDING LINK (Jon, 2026-11-12: "we should have them add a password. The
// password and link should be sent to their email, magic link").
//   · The team emails the owner a magic link (one use to sign in, good for 7 days). Opening it signs them in and
//     asks them to create a password.
//   · After that the link asks for the password, or emails a fresh magic link to the address on file (30 minutes).
//   · A link made with no owner email stays open by its code until an email or password is added.
// Passwords are stored as scrypt hashes; link tokens as SHA-256 hashes; the session is a signed, http-only cookie.
// Server-only.
import 'server-only'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { sendResendEmail } from './resend-send'
import type { OORecord } from './owner-onboard'
import { stayEmail, escHtml } from './email-layout'

const secret = () => process.env.VAULT_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY || 'stay-owner-onboarding'
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const cookieName = (code: string) => 'oj_' + code
const sessionValue = (r: OORecord) => crypto.createHmac('sha256', secret()).update(r.code + ':' + (r.auth?.ver || 1)).digest('hex')
const blank = (r: OORecord) => (r.auth = r.auth || { tokens: [], sent: [], ver: 1 })

/** Does this link need a sign-in at all? Only once it has an owner email or a password. */
export const isProtected = (r: OORecord) => !!(r.auth?.pass || r.custom.ownerEmail)
export function signedIn(req: NextRequest, r: OORecord): boolean {
  if (!isProtected(r)) return true
  const c = req.cookies.get(cookieName(r.code))?.value || ''
  const want = sessionValue(r)
  return c.length === want.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(want))
}
export function sessionCookie(r: OORecord) {
  return { name: cookieName(r.code), value: sessionValue(r), httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 60 }
}
export function setPassword(r: OORecord, pw: string) {
  const a = blank(r), salt = crypto.randomBytes(16).toString('hex')
  a.pass = { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') }
  if (!a.activatedAt) a.activatedAt = new Date().toISOString()
  a.lastSeenAt = new Date().toISOString()
}
/** The owner just signed in. The caller saves the record. */
export function seen(r: OORecord) { blank(r).lastSeenAt = new Date().toISOString() }
export function clearedCookie(r: OORecord) { return { ...sessionCookie(r), value: '', maxAge: 0 } }
export function checkPassword(r: OORecord, pw: string): boolean {
  const p = r.auth?.pass; if (!p) return false
  const h = crypto.scryptSync(pw, p.salt, 64)
  const want = Buffer.from(p.hash, 'hex')
  return h.length === want.length && crypto.timingSafeEqual(h, want)
}
/** A new one-time link token; the caller saves the record. */
export function newToken(r: OORecord, minutes: number): string {
  const a = blank(r), t = crypto.randomBytes(24).toString('hex'), now = Date.now()
  a.tokens = [...a.tokens.filter(x => x.exp > now).slice(-4), { h: sha(t), exp: now + minutes * 60_000 }]
  return t
}
/** Spend a token: true once, then never again. The caller saves the record. */
export function useToken(r: OORecord, t: string): boolean {
  const a = r.auth; if (!a || !t) return false
  const h = sha(t), now = Date.now()
  const i = a.tokens.findIndex(x => x.h === h && x.exp > now)
  if (i < 0) return false
  a.tokens.splice(i, 1)
  return true
}
/** No more than three emailed links an hour per owner. */
export function canSend(r: OORecord): boolean {
  const a = blank(r), now = Date.now()
  a.sent = a.sent.filter(t => now - t < 3_600_000)
  if (a.sent.length >= 3) return false
  a.sent.push(now); return true
}
export const emailHint = (e: string) => { const [u, d] = String(e || '').split('@'); return u && d ? u.slice(0, 2) + '•••@' + d : '' }

const esc = (s: string) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
export async function emailMagicLink(r: OORecord, origin: string, kind: 'invite' | 'signin' | 'order'): Promise<{ ok: boolean; error?: string }> {
  const to = r.custom.ownerEmail
  if (!to) return { ok: false, error: 'There is no owner email on this link.' }
  const token = newToken(r, kind === 'signin' ? 30 : 60 * 24 * 7)
  const link = origin.replace(/\/$/, '') + '/join/' + r.code + '?k=' + token
  const first = (r.custom.ownerName || '').split(' ')[0] || 'there'
  const gm = r.custom.gm, home = [r.attach.property, r.attach.unitLabel ? 'Unit ' + r.attach.unitLabel : ''].filter(Boolean).join(', ')
  const site = origin.replace(/\/$/, '')
  const portal = site.replace(/^https?:\/\//, '') + '/portal'
  const copy = kind === 'order' ? {
    eyebrow: 'For your review', heading: 'Your order list is ready',
    pre: 'The items we would buy to set your home up, with quantities and prices.',
    paragraphs: [`Hi ${escHtml(first)},`, `Your order list${home ? ' for <b>' + escHtml(home) + '</b>' : ''} is ready. It shows each item we would buy to set the home up, with the quantity and the price.`, 'Please look it over, tell us about anything you already have, and approve it so we can place the order.'],
    cta: 'Review my order list',
  } : kind === 'invite' ? {
    eyebrow: 'Welcome', heading: 'Your owner portal is ready',
    pre: 'Create your password and start your onboarding with Stay Hospitality.',
    paragraphs: [`Hi ${escHtml(first)},`, `Welcome to Stay Hospitality. Your owner portal${home ? ' for <b>' + escHtml(home) + '</b>' : ''} is ready.`, 'It is where you tell us about the home, send your tax and payout details securely, review your order list, and follow each step until you are live and taking bookings.', 'Open it below and create your password. It takes about ten minutes, and it saves as you go.'],
    cta: 'Open my owner portal',
  } : {
    eyebrow: 'Owner portal', heading: 'Your sign-in link',
    pre: 'A one-time link to sign in to your Stay Hospitality owner portal.',
    paragraphs: [`Hi ${escHtml(first)},`, 'Here is the sign-in link you asked for. It opens your owner portal on this device.'],
    cta: 'Sign in',
  }
  const html = stayEmail({
    origin: site, preheader: copy.pre, eyebrow: copy.eyebrow, heading: copy.heading, paragraphs: copy.paragraphs,
    cta: { label: copy.cta, url: link },
    ctaNote: `This link signs you in once and works for ${kind === 'signin' ? '30 minutes' : '7 days'}. After you create your password you can sign in any time at <a href="${escHtml(site)}/portal" style="color:#7A7B80">${escHtml(portal)}</a> with this email address.`,
    note: kind === 'signin' ? 'If you did not ask for this link, you can ignore this email. Nobody can sign in without it.' : 'Your tax ID and bank details are encrypted the moment you send them. We will never ask for them by email.',
    after: kind === 'signin' ? [] : ['If anything is unclear, reply to this email and it comes straight to me.'],
    sign: { name: gm.name, role: gm.role, phone: gm.phone, email: gm.email },
  })
  const res = await sendResendEmail({ to: [to], replyTo: gm.email || undefined, subject: kind === 'order' ? 'Your order list is ready to review · Stay Hospitality' : kind === 'invite' ? 'Your Stay Hospitality owner portal' : 'Your Stay Hospitality sign-in link', html })
  if (res.ok && kind === 'invite') blank(r).invitedAt = new Date().toISOString()
  return { ok: res.ok, error: res.error }
}

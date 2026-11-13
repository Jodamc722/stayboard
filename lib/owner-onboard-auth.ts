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
import { readOOSettings } from './owner-onboard-mail'

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
  const gmFirst = (gm.name || '').split(' ')[0] || 'our team'
  const at = home ? ' at <b>' + escHtml(home) + '</b>' : ''
  const copy: { eyebrow: string; heading: string; pre: string; paragraphs: string[]; list?: string[]; lead?: string[]; cta: string; after: string[]; note: string } = kind === 'order' ? {
    eyebrow: 'For your review', heading: 'Your order list is ready for review',
    pre: 'The items your home needs to be guest-ready, with quantities and prices.',
    paragraphs: [`Hi ${escHtml(first)},`, `We have put together the list of items needed to get your home${at} guest-ready, based on what you told us is already there. Each item shows the quantity and the price, with a link to the exact product.`],
    list: ['Review the list', 'Mark anything you already own, and we will take it off', 'Approve it when you are happy, or tell us what to change'], lead: ['We will place the order as soon as you approve. Linen is quoted separately and is not on this list.'],
    cta: 'Review and approve', after: ['If you have any questions about an item, reply to this email.'],
    note: 'This link is private to you. Please do not forward it.',
  } : kind === 'invite' ? {
    eyebrow: 'Welcome', heading: 'Welcome to Stay Hospitality',
    pre: 'Set up your owner portal: about ten minutes, and it saves as you go.',
    paragraphs: [`Hi ${escHtml(first)},`, `Thank you for trusting us with your home${at}. I am ${escHtml(gm.name)}${gm.role ? ', ' + escHtml(gm.role) : ''}, and my team and I will take it from signed agreement to its first booking.`, 'Your owner portal is where it all happens. In about ten minutes you can:'],
    list: ['Tell us about the home', 'Confirm what is already in it, so we only order what is missing', 'Send your W-9 and payout details securely'],
    lead: ['After that, the portal shows every step, from photography and your listing to your onboarding call and going live, so you always know where things stand.'],
    cta: 'Set up my owner portal', after: [`If you have a question at any point, reply to this email or call me directly. I look forward to working with you.`],
    note: 'Your tax ID and bank details are encrypted the moment you send them, and we will never ask for them by email.',
  } : {
    eyebrow: 'Owner portal', heading: 'Sign in to your owner portal',
    pre: 'Your one-time sign-in link. It works for the next 30 minutes.',
    paragraphs: [`Hi ${escHtml(first)},`, 'Use the button below to sign in to your owner portal. The link works once, for the next 30 minutes.'],
    cta: 'Sign in', after: [],
    note: 'Did not ask for this? You can safely ignore this email. Nobody can sign in without the link.',
  }
  void gmFirst
  const html = stayEmail({
    origin: site, preheader: copy.pre, eyebrow: copy.eyebrow, heading: copy.heading, paragraphs: copy.paragraphs, list: copy.list, lead: copy.lead,
    cta: { label: copy.cta, url: link },
    ctaNote: kind === 'signin' ? `You can also sign in any time at <a href="${escHtml(site)}/portal" style="color:#7A7B80">${escHtml(portal)}</a> with your email and password.` : `This button signs you in once and works for 7 days. You will create a password on your first visit, and after that you can sign in any time at <a href="${escHtml(site)}/portal" style="color:#7A7B80">${escHtml(portal)}</a>.`,
    note: copy.note, after: copy.after,
    sign: { name: gm.name, role: gm.role, phone: gm.phone, email: gm.email },
  })
  const res = await sendResendEmail({ to: [to], replyTo: gm.email || undefined, subject: kind === 'order' ? `Your order list is ready for review${home ? ' · ' + home : ''}` : kind === 'invite' ? 'Welcome to Stay Hospitality: set up your owner portal' : 'Your Stay Hospitality sign-in link', html })
  if (res.ok && kind === 'invite') blank(r).invitedAt = new Date().toISOString()
  // THE TEAM'S COPY (Jon, 2026-11-13: "cc Bernadette, Bethany, Roberto and Karla on all onboarding emails"). They are
  // not put on the owner's own email: its button signs whoever clicks it in AS THE OWNER, tax and bank forms included.
  // So the team gets the same message without that button, and a link to the onboarding in Lighthouse instead.
  if (res.ok && kind !== 'signin') {
    try {
      const st = await readOOSettings()
      const team = st.teamCc.filter(e => e !== to.toLowerCase())
      if (team.length) await sendResendEmail({ to: team, replyTo: gm.email || undefined,
        subject: `[Team copy] ${kind === 'invite' ? 'Portal invite sent to' : 'Order list sent to'} ${r.custom.ownerName || 'the owner'}${home ? ' · ' + home : ''}`,
        html: stayEmail({ origin: site, preheader: 'A copy for the team of what the owner was just sent.', eyebrow: 'Team copy · owner onboarding',
          heading: kind === 'invite' ? `${r.custom.ownerName || 'The owner'} was invited to the owner portal` : `${r.custom.ownerName || 'The owner'} was sent the order list`,
          paragraphs: [`This is a copy of what <b>${escHtml(r.custom.ownerName || 'the owner')}</b> (${escHtml(to)}) was just sent${home ? ' for <b>' + escHtml(home) + '</b>' : ''}. The owner’s private sign-in button is left out of this copy, because it would sign the reader in as the owner.`, '<b>What the owner received:</b>', ...copy.paragraphs.slice(1)],
          list: copy.list, lead: copy.lead, cta: { label: 'Open the onboarding in Lighthouse', url: site + '/owner-onboarding/' + r.code },
          sign: { name: gm.name, role: gm.role, email: gm.email }, footer: 'Sent by Lighthouse for Stay Hospitality · Owner onboarding' }) })
    } catch { /* the owner's email went; the team copy is a courtesy */ }
  }
  return { ok: res.ok, error: res.error }
}

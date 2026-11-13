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
import type { OORecord, OOAuth } from './owner-onboard'
import { gmOf } from './owner-onboard'
import type { RemindKind } from './owner-onboard-remind'
import { stayEmail, escHtml } from './email-layout'
import { readOOSettings, sendOnboardingMail } from './owner-onboard-mail'

const secret = () => process.env.VAULT_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY || 'stay-owner-onboarding'
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const cookieName = (code: string) => 'oj_' + code
// SEVERAL OWNERS, EACH WITH THEIR OWN ACCOUNT (Jon, 2026-11-13). An account is one owner on the link: the first owner
// ('p', kept in custom + auth) or one added later (owners[]). Each has its own invite, password and session; the
// session cookie names the account it belongs to, so removing an owner ends their access at once.
type Acct = { id: string; name: string; email: string; auth: OOAuth | null | undefined }
export function accounts(r: OORecord): Acct[] {
  return [{ id: 'p', name: r.custom.ownerName, email: r.custom.ownerEmail, auth: r.auth }, ...(r.owners || []).map(o => ({ id: o.id, name: o.name, email: o.email, auth: o.auth }))]
}
export const account = (r: OORecord, id: string) => accounts(r).find(a => a.id === id) || null
/** The account's sign-in record, created if it has none yet. */
function authOf(r: OORecord, id: string): OOAuth {
  const mk = (): OOAuth => ({ tokens: [], sent: [], ver: 1 })
  if (id === 'p') return (r.auth = r.auth || mk())
  const o = (r.owners || []).find(x => x.id === id)
  if (!o) throw new Error('No such owner on this link.')
  return (o.auth = o.auth || mk())
}
const sig = (r: OORecord, id: string) => crypto.createHmac('sha256', secret()).update(r.code + ':' + id + ':' + (r.auth?.ver || 1)).digest('hex')
const legacySig = (r: OORecord) => crypto.createHmac('sha256', secret()).update(r.code + ':' + (r.auth?.ver || 1)).digest('hex')
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Does this link need a sign-in at all? Only once an owner on it has an email or a password. */
export const isProtected = (r: OORecord) => accounts(r).some(a => !!(a.auth?.pass || a.email))
/** Which owner is signed in on this browser ('p' = the first), or null. An unprotected link is the first owner's. */
export function whoSignedIn(req: NextRequest, r: OORecord): string | null {
  if (!isProtected(r)) return 'p'
  const c = req.cookies.get(cookieName(r.code))?.value || ''
  if (!c) return null
  const dot = c.indexOf('.')
  if (dot < 0) return same(c, legacySig(r)) ? 'p' : null          // sessions from before owners had their own accounts
  const id = c.slice(0, dot)
  return account(r, id) && same(c.slice(dot + 1), sig(r, id)) ? id : null
}
export const signedIn = (req: NextRequest, r: OORecord): boolean => whoSignedIn(req, r) !== null
export function sessionCookie(r: OORecord, id = 'p') {
  return { name: cookieName(r.code), value: id + '.' + sig(r, id), httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 60 }
}
export function clearedCookie(r: OORecord) { return { ...sessionCookie(r), value: '', maxAge: 0 } }
export function setPassword(r: OORecord, pw: string, id = 'p') {
  const a = authOf(r, id), salt = crypto.randomBytes(16).toString('hex')
  a.pass = { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') }
  if (!a.activatedAt) a.activatedAt = new Date().toISOString()
  a.lastSeenAt = new Date().toISOString()
}
/** The owner just signed in. The caller saves the record. */
export function seen(r: OORecord, id = 'p') { authOf(r, id).lastSeenAt = new Date().toISOString() }
const passOk = (a: OOAuth | null | undefined, pw: string) => { const p = a?.pass; if (!p) return false; const h = crypto.scryptSync(pw, p.salt, 64), want = Buffer.from(p.hash, 'hex'); return h.length === want.length && crypto.timingSafeEqual(h, want) }
/** Whose password is this? With an email, only that owner's is tried; without one (a single-owner link), anyone's. */
export function matchPassword(r: OORecord, pw: string, email?: string): string | null {
  const e = String(email || '').trim().toLowerCase()
  for (const a of accounts(r)) { if (e && a.email.trim().toLowerCase() !== e) continue; if (passOk(a.auth, pw)) return a.id }
  return null
}
/** A new one-time link token for one owner; the caller saves the record. */
export function newToken(r: OORecord, minutes: number, id = 'p'): string {
  const a = authOf(r, id), t = crypto.randomBytes(24).toString('hex'), now = Date.now()
  a.tokens = [...a.tokens.filter(x => x.exp > now).slice(-4), { h: sha(t), exp: now + minutes * 60_000 }]
  return t
}
/** Spend a token: returns whose it was, once, then never again. The caller saves the record. */
export function useToken(r: OORecord, t: string): string | null {
  if (!t) return null
  const h = sha(t), now = Date.now()
  for (const a of accounts(r)) {
    const i = a.auth ? a.auth.tokens.findIndex(x => x.h === h && x.exp > now) : -1
    if (i >= 0) { a.auth!.tokens.splice(i, 1); return a.id }
  }
  return null
}
/** No more than three emailed links an hour per owner. */
export function canSend(r: OORecord, id = 'p'): boolean {
  const a = authOf(r, id), now = Date.now()
  a.sent = a.sent.filter(t => now - t < 3_600_000)
  if (a.sent.length >= 3) return false
  a.sent.push(now); return true
}
export const emailHint = (e: string) => { const [u, d] = String(e || '').split('@'); return u && d ? u.slice(0, 2) + '•••@' + d : '' }

const esc = (s: string) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
export async function emailMagicLink(r: OORecord, origin: string, kind: 'invite' | 'signin' | 'order' | 'remind', id = 'p', remind?: { kind: RemindKind; n: 1 | 2 | 3 }): Promise<{ ok: boolean; error?: string }> {
  const who = account(r, id)
  const to = who?.email || ''
  if (!who || !to) return { ok: false, error: 'There is no email for this owner.' }
  const token = newToken(r, kind === 'signin' ? 30 : 60 * 24 * 7, id)
  const link = origin.replace(/\/$/, '') + '/join/' + r.code + '?k=' + token
  const first = (who.name || '').split(' ')[0] || 'there'
  const gm = gmOf(r.custom.gm), home = [r.attach.property, r.attach.unitLabel ? 'Unit ' + r.attach.unitLabel : ''].filter(Boolean).join(', ')
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
  } : kind === 'remind' && remind ? remindCopy(remind, { first, at, gmPhone: gm.phone }) : kind === 'invite' ? {
    eyebrow: 'Welcome', heading: 'Welcome to Stay Hospitality',
    pre: 'Set up your owner portal: about ten minutes, and it saves as you go.',
    paragraphs: [`Hi ${escHtml(first)},`, `Thank you for trusting us with your home${at}. I am ${escHtml(gm.name)}${gm.role ? ', ' + escHtml(gm.role) : ''}, and my team and I will take it from signed agreement to its first booking.`, 'Your owner portal is where it all happens. In about ten minutes you can:'],
    list: ['Tell us about the home', 'Confirm what is already in it, so we only order what is missing', 'Send your W-9 and payout details securely'],
    lead: ['After that, the portal shows every step, from photography and your listing to your onboarding call and going live, so you always know where things stand.'],
    cta: 'Set up my owner portal', after: [`If you have a question at any point, reply to this email or call me directly${gm.phone ? ' at ' + escHtml(gm.phone) : ''}. I look forward to working with you.`],
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
    ctaNote: kind === 'remind' ? `This button signs you in once and works for 7 days. You can also sign in any time at <a href="${escHtml(site)}/portal" style="color:#7A7B80">${escHtml(portal)}</a>.` : kind === 'signin' ? `You can also sign in any time at <a href="${escHtml(site)}/portal" style="color:#7A7B80">${escHtml(portal)}</a> with your email and password.` : `This button signs you in once and works for 7 days. You will create a password on your first visit, and after that you can sign in any time at <a href="${escHtml(site)}/portal" style="color:#7A7B80">${escHtml(portal)}</a>.`,
    note: copy.note, after: copy.after,
    sign: { name: gm.name, role: gm.role, phone: gm.phone, email: gm.email, photo: gm.photo ? (gm.photo.startsWith('/') ? site + gm.photo : gm.photo) : undefined },
  })
  const res = await sendOnboardingMail({ to: [to], subject: kind === 'remind' && remind ? REMIND_SUBJECT[remind.kind] + (home ? ' · ' + home : '') : kind === 'order' ? `Your order list is ready for review${home ? ' · ' + home : ''}` : kind === 'invite' ? 'Welcome to Stay Hospitality: set up your owner portal' : 'Your Stay Hospitality sign-in link', html })
  if (res.ok && kind === 'invite') authOf(r, id).invitedAt = new Date().toISOString()
  // THE TEAM'S COPY (Jon, 2026-11-13: "cc Bernadette, Bethany, Roberto and Karla on all onboarding emails"). They are
  // not put on the owner's own email: its button signs whoever clicks it in AS THE OWNER, tax and bank forms included.
  // So the team gets the same message without that button, and a link to the onboarding in Lighthouse instead.
  if (res.ok && kind !== 'signin' && kind !== 'remind') {
    try {
      const st = await readOOSettings()
      const team = st.teamCc.filter(e => e !== to.toLowerCase())
      if (team.length) await sendOnboardingMail({ to: team,
        subject: `[Team copy] ${kind === 'invite' ? 'Portal invite sent to' : 'Order list sent to'} ${who.name || 'the owner'}${home ? ' · ' + home : ''}`,
        html: stayEmail({ origin: site, preheader: 'A copy for the team of what the owner was just sent.', eyebrow: 'Team copy · owner onboarding',
          heading: kind === 'invite' ? `${who.name || 'The owner'} was invited to the owner portal` : `${who.name || 'The owner'} was sent the order list`,
          paragraphs: [`This is a copy of what <b>${escHtml(who.name || 'the owner')}</b> (${escHtml(to)}) was just sent${home ? ' for <b>' + escHtml(home) + '</b>' : ''}. The owner’s private sign-in button is left out of this copy, because it would sign the reader in as the owner.`, '<b>What the owner received:</b>', ...copy.paragraphs.slice(1)],
          list: copy.list, lead: copy.lead, cta: { label: 'Open the onboarding in Lighthouse', url: site + '/owner-onboarding/' + r.code },
          sign: { name: gm.name, role: gm.role, email: gm.email }, footer: 'Sent by Lighthouse for Stay Hospitality · Owner onboarding' }) })
    } catch { /* the owner's email went; the team copy is a courtesy */ }
  }
  return { ok: res.ok, error: res.error }
}

// ── REMINDERS (lib/owner-onboard-remind): short, specific, and kinder each time. The third says it is the last. ──
const REMIND_SUBJECT: Record<RemindKind, string> = { start: 'Reminder: set up your Stay Hospitality owner portal', home: 'Reminder: tell us about your home', supplies: 'Reminder: your supplies check', paperwork: 'Reminder: your W-9 and payout details', order: 'Reminder: your order list is waiting for approval' }
function remindCopy(m: { kind: RemindKind; n: 1 | 2 | 3 }, c: { first: string; at: string; gmPhone?: string }) {
  const hi = `Hi ${escHtml(c.first)},`
  const last = m.n === 3 ? [`This is our last reminder. If now is not a good time, or something is holding you up, just reply${c.gmPhone ? ' or call me at ' + escHtml(c.gmPhone) : ''} and we will work around it.`] : ['If you have a question, reply to this email and it comes straight to me.']
  const by: Record<RemindKind, { heading: string; pre: string; paragraphs: string[]; list?: string[]; cta: string; note: string }> = {
    start: { heading: m.n === 1 ? 'Your owner portal is ready when you are' : 'Your owner portal is still waiting', pre: 'It takes about ten minutes and it is the first step to getting your home live.',
      paragraphs: [hi, `A quick reminder that your owner portal${c.at} is ready. Setting it up takes about ten minutes, and it is the first step to getting your home live and earning.`], list: ['Create your password', 'Tell us about the home', 'Send your W-9 and payout details securely'], cta: 'Set up my owner portal',
      note: 'Your tax ID and bank details are encrypted the moment you send them, and we will never ask for them by email.' },
    home: { heading: 'Pick up where you left off', pre: 'A few details about the home and we can get moving.',
      paragraphs: [hi, `Thank you for setting up your portal. The next step is to tell us about your home${c.at}: its size, beds, kitchen and Wi-Fi. It takes a few minutes, and everything after it depends on it.`], cta: 'Tell us about my home',
      note: 'It saves as you go, so you can stop and come back any time.' },
    supplies: { heading: 'One quick step: what is already in the home', pre: 'Tap one answer and you are done; our team confirms the rest.',
      paragraphs: [hi, `We are ready to work out what your home${c.at} needs before guests arrive. Please tell us what is already there. You do not need a perfect count: one tap for "fully stocked" or "nothing bought yet" is enough, and our team walks the home to confirm before anything is ordered.`], cta: 'Do my supplies check',
      note: 'Nothing is ordered without your approval.' },
    paperwork: { heading: 'We still need your W-9 and payout details', pre: 'So we can pay you. It takes about three minutes.',
      paragraphs: [hi, `We are nearly there. To set up your payouts for your home${c.at} we still need two things from you, and they take about three minutes:`], list: ['Your W-9 details', 'The bank account you want your payouts sent to'], cta: 'Finish my paperwork',
      note: 'Your tax ID and bank details are encrypted the moment you send them, and only the last four digits are ever shown again. We will never ask for them by email.' },
    order: { heading: 'Your order list is waiting for your approval', pre: 'We place the order as soon as you approve it.',
      paragraphs: [hi, `Your order list${c.at} is ready, and we are holding the order until you have looked at it. Please review it, mark anything you already own, and approve it or tell us what to change.`], cta: 'Review and approve',
      note: 'Getting the home stocked is usually what decides the go-live date, so an early answer helps.' },
  }
  const x = by[m.kind]
  return { eyebrow: m.n === 3 ? 'Final reminder' : 'A quick reminder', heading: x.heading, pre: x.pre, paragraphs: x.paragraphs, list: x.list, lead: undefined as string[] | undefined, cta: x.cta, after: last, note: x.note }
}

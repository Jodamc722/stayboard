// THE ONBOARDING CALL, BOOKED BY THE OWNER (Jon, 2026-11-20: "Onboarding call, Calendly link will get auto sent once
// everything is completed, once the photos and listing is created. Have it auto send from the owner portal to
// schedule an onboarding call with me. That will need to be about an hour. Allow me to set the parameters… and then
// obviously it needs to look at my current calendar").
//
// When the Photos and Listing steps are both done, the owners get one email with a button to the onboarding-call
// booking link, carrying their onboarding code: the page knows who they are, offers only the host's free times
// (lib/booking reads their Google Calendar), and the booking lands on the onboarding and the owner's timeline.
// It is sent once. The desk can send it again by hand. Length, days, hours, notice and horizon are the booking
// link's own settings, edited on the host's Account page.
import 'server-only'
import type { OORecord } from './owner-onboard'
import { gmOf, ownersOf, callInviteDue } from './owner-onboard'
import { stayEmail, escHtml } from './email-layout'
import { readOOSettings, sendOnboardingMail, withTeam } from './owner-onboard-mail'
import { readBooking, ONBOARDING_CALL } from './booking'

const OKMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/
export const callBookingUrl = (origin: string, code: string) => origin.replace(/\/$/, '') + '/book/' + ONBOARDING_CALL + '?o=' + code

/** Send the booking-link email and record it on the onboarding (the caller saves). */
export async function sendCallInvite(r: OORecord, origin: string, by: string): Promise<{ ok: boolean; error?: string; to: string[] }> {
  const to = Array.from(new Set(ownersOf(r).map(o => String(o.email || '').trim().toLowerCase()).filter(e => OKMAIL.test(e))))
  if (!to.length) return { ok: false, error: 'No owner email on this onboarding.', to }
  const t = (await readBooking()).types.find(x => x.slug === ONBOARDING_CALL && x.on)
  if (!t) return { ok: false, error: 'The Onboarding call booking link is switched off. Switch it on under Account, then send.', to }
  const s = await readOOSettings()
  const gm = gmOf(r.custom.gm)
  // signed by a person only when it leaves from that person's own mailbox; otherwise by the team
  const fromGm = !!s.replyTo && String(gm.email || '').toLowerCase() === s.replyTo.toLowerCase()
  const host = t.hostName || gm.name || 'your General Manager'
  const first = (r.custom.ownerName || '').trim().split(/\s+/)[0] || 'there'
  const where = [r.attach.property, r.attach.unitLabel ? 'unit ' + r.attach.unitLabel : ''].filter(Boolean).join(', ')
  const mins = t.minutes >= 60 ? (t.minutes % 60 ? (t.minutes / 60).toFixed(1) + ' hours' : t.minutes === 60 ? 'an hour' : t.minutes / 60 + ' hours') : t.minutes + ' minutes'
  const html = stayEmail({
    origin, preheader: `Your photos and listing are ready. Pick a time for your onboarding call with ${host}.`,
    eyebrow: 'Owner onboarding', heading: 'Your listing is ready. Book your onboarding call',
    paragraphs: [`Hi ${escHtml(first)},`, `The photos are done and the listing for ${escHtml(where || 'your home')} is written. The last step before your home goes live is your onboarding call with ${escHtml(host)}.`,
      `It takes about ${escHtml(mins)}${t.where === 'meet' ? ', on Google Meet' : t.where === 'phone' ? ', by phone' : ''}. We walk through the listing together, go over the pricing strategy, and answer your questions.`],
    cta: { label: 'Pick a time', url: callBookingUrl(origin, r.code) },
    ctaNote: `You will see ${escHtml(host.split(' ')[0])}’s open times. Choose one and a calendar invitation arrives by email.`,
    lead: ['If none of the times work, reply to this email and we will find one.'],
    sign: fromGm ? { name: gm.name, role: gm.role || 'General Manager', phone: gm.phone || undefined, email: gm.email || undefined } : { name: 'The Stay Hospitality team', role: 'Owner onboarding', email: s.replyTo || undefined },
    footer: 'Sent by Lighthouse for Stay Hospitality · Owner onboarding',
  })
  const res = await sendOnboardingMail({ to, cc: withTeam([], s.teamCc || [], to), subject: 'Your listing is ready: book your onboarding call', html })
  r.callInvite = res.ok ? { at: new Date().toISOString(), to, by } : { at: '', to, by, error: String(res.error || 'not sent').slice(0, 200) }
  return { ok: res.ok, error: res.error, to }
}
/** Photos and listing just became done, no call booked, never sent: send it. Quiet when it is not owed. */
export async function maybeSendCallInvite(r: OORecord, origin: string, by: string): Promise<'sent' | 'failed' | ''> {
  if (!callInviteDue(r)) return ''
  const s = await sendCallInvite(r, origin, by).catch(e => ({ ok: false, error: String(e?.message || e) }))
  return s.ok ? 'sent' : 'failed'
}

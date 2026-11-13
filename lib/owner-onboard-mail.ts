// THE HANDOFF TO ACCOUNTING (Jon, 2026-11-12: "once they're done it'll automatically email from my email to
// Bethany with the unit number, the owner details, the contact stuff, and copy Bernadette… inform her to set up
// the Guesty accounts", "need to copy me", "the agreement can also be sent to Bethany once signed").
// Sent through the app's mail (Resend) with Jon as reply-to and copied. The W-9 and the bank details are NEVER in
// the email: it links to the onboarding page, where a signed-in teammate downloads the filled forms. The signed
// agreement goes as an attachment. Recipients are a setting (app_settings 'oo_settings'). Server-only.
import 'server-only'
import { getSettingFresh, setSetting } from './app-settings'
import { sendResendEmail, type MailAttachment } from './resend-send'
import { sendGmail } from './gmail-send'
import { fileBytes } from './owner-onboard-files'
import type { OORecord, OOItem } from './owner-onboard'
import { stayEmail, escHtml } from './email-layout'

export const OO_SETTINGS = 'oo_settings'
/** teamCc (Jon, 2026-11-13: "add cc Bernadette, Bethany, Roberto and Karla to all onboarding emails"): copied on every
 *  onboarding email. On the owner's own emails they get a team copy WITHOUT the sign-in button, because that button
 *  signs whoever clicks it in as the owner. */
export type OOSettings = { to: string[]; cc: string[]; replyTo: string; vendorTo: string[]; vendorCc: string[]; teamCc: string[]; /** who is asked to walk a new unit and count what is there */ walkTo: string[] }
export const OO_SETTINGS_DEFAULT: OOSettings = { to: ['bethany@stay-hospitality.com'], cc: ['bernadette@stay-hospitality.com', 'jon@stay-hospitality.com'], replyTo: 'jon@stay-hospitality.com', walkTo: ['roberto@stay-hospitality.com', 'karla@stay-hospitality.com'], teamCc: ['bernadette@stay-hospitality.com', 'bethany@stay-hospitality.com', 'roberto@stay-hospitality.com', 'karla@stay-hospitality.com'], vendorTo: [], vendorCc: ['jon@stay-hospitality.com', 'roberto@stay-hospitality.com'] }
const emails = (v: any) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x: any) => String(x || '').trim().toLowerCase()).filter((x: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
export async function readOOSettings(): Promise<OOSettings> {
  const r: any = await getSettingFresh<any>(OO_SETTINGS, null)
  if (!r) return OO_SETTINGS_DEFAULT
  return { to: emails(r.to).length ? emails(r.to) : OO_SETTINGS_DEFAULT.to, cc: emails(r.cc), replyTo: emails([r.replyTo])[0] || OO_SETTINGS_DEFAULT.replyTo, teamCc: r.teamCc == null ? OO_SETTINGS_DEFAULT.teamCc : emails(r.teamCc), walkTo: r.walkTo == null ? OO_SETTINGS_DEFAULT.walkTo : emails(r.walkTo), vendorTo: emails(r.vendorTo), vendorCc: r.vendorCc == null ? OO_SETTINGS_DEFAULT.vendorCc : emails(r.vendorCc) }
}
export async function saveOOSettings(v: any, by: string | null) { const s = { to: emails(v?.to), cc: emails(v?.cc), replyTo: emails([v?.replyTo])[0] || '', vendorTo: emails(v?.vendorTo), vendorCc: emails(v?.vendorCc), teamCc: emails(v?.teamCc), walkTo: emails(v?.walkTo) }; await setSetting(OO_SETTINGS, s, by); return readOOSettings() }

const esc = (s: string) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
/** ONE WAY OUT FOR EVERY ONBOARDING EMAIL: from the connected Google mailbox first (the handoff always went this way),
 *  then the app's own sender. The owner's invite used only the app's sender, which is not set up on production
 *  ("RESEND_API_KEY not set", found sending Jon a test on 2026-11-13), so no invite could ever go out. */
export async function sendOnboardingMail(m: { to: string[]; cc?: string[]; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  const s = await readOOSettings()
  let gErr = ''
  if (s.replyTo) {
    const g: { ok: boolean; error?: string } = await sendGmail({ fromEmail: s.replyTo, to: m.to, cc: m.cc, subject: m.subject, html: m.html, source: 'owner-onboarding' }).catch((e: any) => ({ ok: false, error: String(e?.message || e) }))
    if (g.ok) return { ok: true }
    gErr = g.error || ''
  }
  const res = await sendResendEmail({ to: m.to, cc: m.cc, replyTo: s.replyTo, subject: m.subject, html: m.html })
  return res.ok ? { ok: true } : { ok: false, error: gErr ? `Could not send from ${s.replyTo} (${gErr.slice(0, 140)}), and the backup sender is not set up.` : res.error }
}

/** `cc` plus the team copied on everything, without repeats and without anyone already in `to`. */
export const withTeam = (cc: string[], team: string[], to: string[]) => Array.from(new Set([...cc, ...team])).filter(e => !to.includes(e)).slice(0, 14)
export async function sendHandoff(r: OORecord, origin: string): Promise<{ ok: boolean; error?: string; to: string[]; cc: string[] }> {
  const s0 = await readOOSettings()
  const s = { ...s0, cc: withTeam(s0.cc, s0.teamCc, s0.to) }
  const unit = r.attach.unitLabel || r.home?.unit || ''
  const where = [r.attach.property, unit ? 'unit ' + unit : ''].filter(Boolean).join(', ') || r.home?.address || 'a new home'
  const h = r.home
  const link = origin.replace(/\/$/, '') + '/owner-onboarding/' + r.code
  const rows: [string, string][] = [
    ['Owner', r.custom.ownerName], ['Owner email', r.custom.ownerEmail], ['Owner phone', r.custom.ownerPhone],
    ...(r.owners || []).map((o, i) => ['Owner ' + (i + 2), [o.name, o.email, o.phone].filter(Boolean).join(' · ')] as [string, string]),
    ['Property', r.attach.property], ['Unit', unit], ['Address', h?.address || ''],
    ['Home', h ? [h.bedrooms === 0 ? 'Studio' : h.bedrooms + ' bed', h.bathrooms + ' bath', h.sqft ? h.sqft + ' SF' : '', 'sleeps ' + h.guests].filter(Boolean).join(' · ') : ''],
    ['W-9', r.payout ? 'Received (' + (r.payout.w9.business || r.payout.w9.name) + ', ' + (r.payout.w9.tinType === 'ein' ? 'EIN' : 'SSN') + ' ending ' + r.payout.w9.tinHint.slice(-4) + ')' : 'Not yet'],
    ['ACH', r.payout ? 'Received (' + r.payout.ach.bank + ' ' + (r.payout.ach.ownership ? r.payout.ach.ownership + ' ' : '') + r.payout.ach.accountType + ' ending ' + r.payout.ach.accountHint.slice(-4) + ')' : 'Not yet'],
    ['Agreement', r.agreement ? 'Attached: ' + r.agreement.name : 'Not uploaded yet'],
  ]
  const toName = (s.to[0] || '').split('@')[0].replace(/^./, c => c.toUpperCase())
  const html = stayEmail({
    origin, preheader: `${r.custom.ownerName || 'A new owner'} has completed onboarding for ${where} and is ready for setup.`,
    eyebrow: 'New owner · action needed', heading: 'New owner ready for setup',
    paragraphs: [`Hi ${escHtml(toName)},`, `<b>${escHtml(r.custom.ownerName || 'A new owner')}</b> has completed onboarding for <b>${escHtml(where)}</b> and is ready to be set up. Please:`],
    list: ['Create the owner and the unit in Guesty', 'Set up the owner’s payouts from the ACH authorization', 'File the W-9'], ordered: true,
    lead: ['Everything you need is below. Please let me know once it is done, or if anything is missing.'],
    details: { title: 'Owner and home', rows },
    cta: { label: 'Open the onboarding in Lighthouse', url: link },
    ctaNote: 'Sign in to download the filled W-9 and ACH authorization.',
    note: '<b>For security, the W-9 and bank details are not attached.</b> They are kept encrypted in Lighthouse and filled into the forms only when someone with full access downloads them.' + (r.agreement ? ' The signed management agreement is attached.' : ''),
    sign: { name: 'Jon McGill', role: 'General Manager', email: s.replyTo || undefined },
    footer: 'Sent by Lighthouse for Stay Hospitality · Owner onboarding',
  })
  const attachments: MailAttachment[] = []
  if (r.agreement) { const b = await fileBytes(r.agreement.path).catch(() => null); if (b) attachments.push({ filename: r.agreement.name, content: b, contentType: /\.pdf$/i.test(r.agreement.name) ? 'application/pdf' : undefined }) }
  // FROM JON'S OWN MAILBOX when it is connected (Google, gmail.send); otherwise the app's sender with reply-to.
  const subject = `New owner ready for setup: ${r.custom.ownerName || 'owner'} · ${where}`
  if (s.replyTo) {
    const g = await sendGmail({ fromEmail: s.replyTo, to: s.to, cc: s.cc, subject, html, attachments: attachments.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType || 'application/octet-stream' })) as any, source: 'owner-onboarding' }).catch(() => ({ ok: false }))
    if (g.ok) return { ok: true, to: s.to, cc: s.cc }
  }
  const res = await sendResendEmail({ to: s.to, cc: s.cc, replyTo: s.replyTo, subject, html, attachments })
  return { ok: res.ok, error: res.error, to: s.to, cc: s.cc }
}

/** THE LINEN ORDER TO THE VENDOR (Jon, 2026-11-13: "when the linen quote is approved, we should be able to send
 *  a quote to our vendor, cc myself and Roberto"): quantities per unit and in all, from Jon's mailbox when connected. */
export async function sendLinenToVendor(r: OORecord, items: OOItem[]): Promise<{ ok: boolean; error?: string; to: string[]; cc: string[] }> {
  const s0 = await readOOSettings()
  const s = { ...s0, vendorCc: withTeam(s0.vendorCc, s0.teamCc, s0.vendorTo) }
  if (!s.vendorTo.length) return { ok: false, error: 'Add the linen vendor’s email first (Owner onboarding → Handoff and vendor emails).', to: [], cc: s.vendorCc }
  const linen = items.filter(i => i.linen)
  if (!linen.length) return { ok: false, error: 'There is no linen list yet: fill in the home first.', to: s.vendorTo, cc: s.vendorCc }
  const units = Array.from(new Set(linen.map(i => i.unit))).sort((a, b) => a - b)
  const label = (u: number) => linen.find(i => i.unit === u)?.unitLabel || 'Unit ' + (u + 1)
  const keys = Array.from(new Set(linen.map(i => i.name + '|' + (i.size || ''))))
  const qty = (k: string, u: number) => linen.filter(i => i.unit === u && i.name + '|' + (i.size || '') === k).reduce((a, i) => a + i.qty, 0)
  const where = [r.attach.property, r.home?.address].filter(Boolean).join(' · ')
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'https://lighthouse-stay.vercel.app'
  const multi = units.length > 1
  const total = linen.reduce((a, i) => a + i.qty, 0)
  const html = stayEmail({
    origin, preheader: `Linen quote request for ${where || 'a new home'}: ${total} pieces.`,
    eyebrow: 'Quote request', heading: 'Linen quote request',
    paragraphs: ['Hello,', `We are setting up ${multi ? units.length + ' new vacation rental units' : 'a new vacation rental home'} at <b>${escHtml(where || 'a new property')}</b> and would like a quote for the linen below. The quantities are the full amount needed${multi ? ', shown for each unit and in total' : ''}.`],
    table: { head: ['Item', 'Size', ...(multi ? units.map(u => escHtml(label(u))) : []), 'Total'], alignRight: [...(multi ? units.map((_, i) => i + 2) : []), (multi ? units.length : 0) + 2],
      rows: [...keys.map(k => { const [n, z] = k.split('|'); const per = units.map(u => qty(k, u)); return [escHtml(n), escHtml(z), ...(multi ? per.map(q => (q ? String(q) : '')) : []), String(per.reduce((a, b) => a + b, 0))] }), ['<b>Total pieces</b>', '', ...(multi ? units.map(() => '') : []), String(total)]] },
    note: r.linen?.note ? escHtml(r.linen.note).replace(/\n/g, '<br>') : undefined,
    after: ['Please reply with unit pricing, availability and lead time. If an item is unavailable, we welcome a comparable alternative.', 'Thank you. We look forward to hearing from you.'],
    sign: { name: 'Jon McGill', role: 'General Manager', email: s.replyTo || undefined },
  })
  const subject = `Quote request: linen for ${where || 'a new home'}`
  if (s.replyTo) { const g = await sendGmail({ fromEmail: s.replyTo, to: s.vendorTo, cc: s.vendorCc, subject, html, source: 'owner-onboarding' }).catch(() => ({ ok: false })); if (g.ok) return { ok: true, to: s.vendorTo, cc: s.vendorCc } }
  const res = await sendResendEmail({ to: s.vendorTo, cc: s.vendorCc, replyTo: s.replyTo, subject, html })
  return { ok: res.ok, error: res.error, to: s.vendorTo, cc: s.vendorCc }
}

/** THE WALKTHROUGH REQUEST (Jon, 2026-11-13: "create an email to do the walkthrough with a link for marking yes or no so
 *  we can get the actual count"). To whoever walks units; the link opens the count sheet on a phone, no login. */
export async function sendWalkRequest(r: OORecord, origin: string, to: string[], by: string): Promise<{ ok: boolean; error?: string; to: string[] }> {
  const s = await readOOSettings()
  const list = emails(to).length ? emails(to) : s.walkTo
  if (!list.length) return { ok: false, error: 'Add who walks the unit first (Owner onboarding → Handoff and vendor emails).', to: [] }
  if (!r.walk?.key) return { ok: false, error: 'The walkthrough link is not ready.', to: list }
  const site = origin.replace(/\/$/, '')
  const units = [r.home, ...(r.more || [])].filter(Boolean) as NonNullable<OORecord['home']>[]
  const where = [r.attach.property, units.length === 1 ? (r.attach.unitLabel || units[0].unit ? 'Unit ' + (r.attach.unitLabel || units[0].unit) : '') : units.length + ' units'].filter(Boolean).join(' · ') || 'a new home'
  const said = r.stock === 'full' ? 'The owner says the home is <b>fully stocked</b>.' : r.stock === 'none' ? 'The owner says <b>nothing has been bought yet</b>.' : 'The owner has ticked what they believe is there.'
  const html = stayEmail({
    origin: site, preheader: `Please walk ${where} and count what is there, so we order only what is missing.`,
    eyebrow: 'Walkthrough needed', heading: `Walk ${where} and count the inventory`,
    paragraphs: ['Hello,', `We are onboarding <b>${escHtml(where)}</b>${r.custom.ownerName ? ' for ' + escHtml(r.custom.ownerName) : ''}. ${said} Before we order anything, please walk the unit and record what is actually there.`],
    list: ['Open the count sheet on your phone (no sign-in needed)', 'For each item, enter how many are there, or tap Yes or No for single items', 'Tap Finish when you are done; it saves as you go'], ordered: true,
    cta: { label: 'Start the walkthrough', url: `${site}/join/${r.code}/walk?k=${r.walk.key}` },
    details: { title: 'The home', rows: [['Property', r.attach.property], ...units.map((h, i) => [units.length > 1 ? 'Unit ' + (h.unit || i + 1) : 'Address', [units.length > 1 ? '' : (h.unit ? 'Unit ' + h.unit : ''), h.address, h.access ? 'Access: ' + h.access : ''].filter(Boolean).join(' · ')] as [string, string])] },
    sign: { name: by.split('@')[0].replace(/^./, c => c.toUpperCase()) || 'Stay Hospitality', email: by || undefined }, footer: 'Sent by Lighthouse for Stay Hospitality · Owner onboarding',
  })
  const res = await sendOnboardingMail({ to: list, subject: `Walkthrough needed: ${where}`, html })
  return { ok: res.ok, error: res.error, to: list }
}

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
export type OOSettings = { to: string[]; cc: string[]; replyTo: string; vendorTo: string[]; vendorCc: string[] }
export const OO_SETTINGS_DEFAULT: OOSettings = { to: ['bethany@stay-hospitality.com'], cc: ['bernadette@stay-hospitality.com', 'jon@stay-hospitality.com'], replyTo: 'jon@stay-hospitality.com', vendorTo: [], vendorCc: ['jon@stay-hospitality.com', 'roberto@stay-hospitality.com'] }
const emails = (v: any) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x: any) => String(x || '').trim().toLowerCase()).filter((x: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
export async function readOOSettings(): Promise<OOSettings> {
  const r: any = await getSettingFresh<any>(OO_SETTINGS, null)
  if (!r) return OO_SETTINGS_DEFAULT
  return { to: emails(r.to).length ? emails(r.to) : OO_SETTINGS_DEFAULT.to, cc: emails(r.cc), replyTo: emails([r.replyTo])[0] || OO_SETTINGS_DEFAULT.replyTo, vendorTo: emails(r.vendorTo), vendorCc: r.vendorCc == null ? OO_SETTINGS_DEFAULT.vendorCc : emails(r.vendorCc) }
}
export async function saveOOSettings(v: any, by: string | null) { const s = { to: emails(v?.to), cc: emails(v?.cc), replyTo: emails([v?.replyTo])[0] || '', vendorTo: emails(v?.vendorTo), vendorCc: emails(v?.vendorCc) }; await setSetting(OO_SETTINGS, s, by); return readOOSettings() }

const esc = (s: string) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
export async function sendHandoff(r: OORecord, origin: string): Promise<{ ok: boolean; error?: string; to: string[]; cc: string[] }> {
  const s = await readOOSettings()
  const unit = r.attach.unitLabel || r.home?.unit || ''
  const where = [r.attach.property, unit ? 'unit ' + unit : ''].filter(Boolean).join(', ') || r.home?.address || 'a new home'
  const h = r.home
  const link = origin.replace(/\/$/, '') + '/owner-onboarding/' + r.code
  const rows: [string, string][] = [
    ['Owner', r.custom.ownerName], ['Owner email', r.custom.ownerEmail], ['Owner phone', r.custom.ownerPhone],
    ['Property', r.attach.property], ['Unit', unit], ['Address', h?.address || ''],
    ['Home', h ? [h.bedrooms === 0 ? 'Studio' : h.bedrooms + ' bed', h.bathrooms + ' bath', h.sqft ? h.sqft + ' SF' : '', 'sleeps ' + h.guests].filter(Boolean).join(' · ') : ''],
    ['W-9', r.payout ? 'Received (' + (r.payout.w9.business || r.payout.w9.name) + ', ' + (r.payout.w9.tinType === 'ein' ? 'EIN' : 'SSN') + ' ending ' + r.payout.w9.tinHint.slice(-4) + ')' : 'Not yet'],
    ['ACH', r.payout ? 'Received (' + r.payout.ach.bank + ' ' + (r.payout.ach.ownership ? r.payout.ach.ownership + ' ' : '') + r.payout.ach.accountType + ' ending ' + r.payout.ach.accountHint.slice(-4) + ')' : 'Not yet'],
    ['Agreement', r.agreement ? 'Attached: ' + r.agreement.name : 'Not uploaded yet'],
  ]
  const toName = (s.to[0] || '').split('@')[0].replace(/^./, c => c.toUpperCase())
  const html = stayEmail({
    origin, preheader: `${r.custom.ownerName || 'A new owner'} has finished onboarding for ${where}. Please set up Guesty and payouts.`,
    eyebrow: 'New owner · action needed', heading: `Set up ${r.custom.ownerName || 'a new owner'} in Guesty`,
    paragraphs: [`Hi ${escHtml(toName)},`, `<b>${escHtml(r.custom.ownerName || 'A new owner')}</b> has finished onboarding for <b>${escHtml(where)}</b>. Please set up the Guesty accounts for this owner and unit, and the owner’s payouts.`],
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
  const subject = `New owner: ${r.custom.ownerName || 'owner'} · ${where} · set up Guesty`
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
  const s = await readOOSettings()
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
    paragraphs: ['Hello,', `Please quote the linen below for <b>${escHtml(where || 'a new home')}</b>${multi ? ' (' + units.length + ' units)' : ''}. Quantities are at par.`],
    table: { head: ['Item', 'Size', ...(multi ? units.map(u => escHtml(label(u))) : []), 'Total'], alignRight: [...(multi ? units.map((_, i) => i + 2) : []), (multi ? units.length : 0) + 2],
      rows: [...keys.map(k => { const [n, z] = k.split('|'); const per = units.map(u => qty(k, u)); return [escHtml(n), escHtml(z), ...(multi ? per.map(q => (q ? String(q) : '')) : []), String(per.reduce((a, b) => a + b, 0))] }), ['<b>Total pieces</b>', '', ...(multi ? units.map(() => '') : []), String(total)]] },
    note: r.linen?.note ? escHtml(r.linen.note).replace(/\n/g, '<br>') : undefined,
    after: ['Please reply with pricing and lead time. Thank you.'],
    sign: { name: 'Jon McGill', role: 'General Manager', email: s.replyTo || undefined },
  })
  const subject = `Linen quote request · ${where || r.custom.ownerName || 'new home'}`
  if (s.replyTo) { const g = await sendGmail({ fromEmail: s.replyTo, to: s.vendorTo, cc: s.vendorCc, subject, html, source: 'owner-onboarding' }).catch(() => ({ ok: false })); if (g.ok) return { ok: true, to: s.vendorTo, cc: s.vendorCc } }
  const res = await sendResendEmail({ to: s.vendorTo, cc: s.vendorCc, replyTo: s.replyTo, subject, html })
  return { ok: res.ok, error: res.error, to: s.vendorTo, cc: s.vendorCc }
}

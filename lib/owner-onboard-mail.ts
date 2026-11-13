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
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.5">
<p>Hi ${esc((s.to[0] || '').split('@')[0].replace(/^./, c => c.toUpperCase()))},</p>
<p>${esc(r.custom.ownerName || 'A new owner')} has finished onboarding for <b>${esc(where)}</b>. Please <b>set up the Guesty accounts</b> for this owner and unit, and the owner's payouts.</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:13px">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="color:#666;border-bottom:1px solid #eee">${esc(k)}</td><td style="border-bottom:1px solid #eee">${esc(v)}</td></tr>`).join('')}</table>
<p>The W-9 and ACH forms are filled and kept encrypted in Lighthouse. Download them here (sign in required); they are not attached to this email for security:<br><a href="${esc(link)}">${esc(link)}</a></p>
<p>Thank you,<br>Jon</p></div>`
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
  const td = 'padding:6px 10px;border-bottom:1px solid #eee'
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.5">
<p>Hello,</p>
<p>Please quote the linen below for <b>${esc(where || 'a new home')}</b>${units.length > 1 ? ' (' + units.length + ' units)' : ''}. Quantities are at par.</p>
<table style="border-collapse:collapse;font-size:13px"><tr><th align="left" style="${td}">Item</th><th align="left" style="${td}">Size</th>${units.length > 1 ? units.map(u => `<th align="right" style="${td}">${esc(label(u))}</th>`).join('') : ''}<th align="right" style="${td}">Total</th></tr>
${keys.map(k => { const [n, z] = k.split('|'); const per = units.map(u => qty(k, u)); return `<tr><td style="${td}">${esc(n)}</td><td style="${td}">${esc(z)}</td>${units.length > 1 ? per.map(q => `<td align="right" style="${td}">${q || ''}</td>`).join('') : ''}<td align="right" style="${td}"><b>${per.reduce((a, b) => a + b, 0)}</b></td></tr>` }).join('')}</table>
${r.linen?.note ? `<p>${esc(r.linen.note).replace(/\n/g, '<br>')}</p>` : ''}
<p>Please reply with pricing and lead time. Thank you,<br>Jon McGill<br>Stay Hospitality</p></div>`
  const subject = `Linen quote request · ${where || r.custom.ownerName || 'new home'}`
  if (s.replyTo) { const g = await sendGmail({ fromEmail: s.replyTo, to: s.vendorTo, cc: s.vendorCc, subject, html, source: 'owner-onboarding' }).catch(() => ({ ok: false })); if (g.ok) return { ok: true, to: s.vendorTo, cc: s.vendorCc } }
  const res = await sendResendEmail({ to: s.vendorTo, cc: s.vendorCc, replyTo: s.replyTo, subject, html })
  return { ok: res.ok, error: res.error, to: s.vendorTo, cc: s.vendorCc }
}

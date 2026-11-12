// THE HANDOFF TO ACCOUNTING (Jon, 2026-11-12: "once they're done it'll automatically email from my email to
// Bethany with the unit number, the owner details, the contact stuff, and copy Bernadette… inform her to set up
// the Guesty accounts", "need to copy me", "the agreement can also be sent to Bethany once signed").
// Sent through the app's mail (Resend) with Jon as reply-to and copied. The W-9 and the bank details are NEVER in
// the email: it links to the onboarding page, where a signed-in teammate downloads the filled forms. The signed
// agreement goes as an attachment. Recipients are a setting (app_settings 'oo_settings'). Server-only.
import 'server-only'
import { getSettingFresh, setSetting } from './app-settings'
import { sendResendEmail, type MailAttachment } from './resend-send'
import { fileBytes } from './owner-onboard-files'
import type { OORecord } from './owner-onboard'

export const OO_SETTINGS = 'oo_settings'
export type OOSettings = { to: string[]; cc: string[]; replyTo: string }
export const OO_SETTINGS_DEFAULT: OOSettings = { to: ['bethany@stay-hospitality.com'], cc: ['bernadette@stay-hospitality.com', 'jon@stay-hospitality.com'], replyTo: 'jon@stay-hospitality.com' }
const emails = (v: any) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x: any) => String(x || '').trim().toLowerCase()).filter((x: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
export async function readOOSettings(): Promise<OOSettings> {
  const r: any = await getSettingFresh<any>(OO_SETTINGS, null)
  if (!r) return OO_SETTINGS_DEFAULT
  return { to: emails(r.to).length ? emails(r.to) : OO_SETTINGS_DEFAULT.to, cc: emails(r.cc), replyTo: emails([r.replyTo])[0] || OO_SETTINGS_DEFAULT.replyTo }
}
export async function saveOOSettings(v: any, by: string | null) { const s = { to: emails(v?.to), cc: emails(v?.cc), replyTo: emails([v?.replyTo])[0] || '' }; await setSetting(OO_SETTINGS, s, by); return readOOSettings() }

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
    ['ACH', r.payout ? 'Received (' + r.payout.ach.bank + ' ' + r.payout.ach.accountType + ' ending ' + r.payout.ach.accountHint.slice(-4) + ')' : 'Not yet'],
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
  const res = await sendResendEmail({ to: s.to, cc: s.cc, replyTo: s.replyTo, subject: `New owner: ${r.custom.ownerName || 'owner'} · ${where} · set up Guesty`, html, attachments })
  return { ok: res.ok, error: res.error, to: s.to, cc: s.cc }
}

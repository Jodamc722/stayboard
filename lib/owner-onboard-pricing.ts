// PRICING HANDOFF TO PACER WHEN A HOME GOES LIVE (Jon, 2026-11-23: "when we mark live, send email to Kyle for pricing
// with listing, details etc… cleaning fees etc").
//
// The moment the Live step is marked done, Kyle at Pacer (our pricing account managers) gets one email with what he
// needs to price the unit: the listing and its links (Guesty and each booking site we have a link for), the home
// (bedrooms, baths, beds, sleeps, size), and the fees and rules set in Guesty (base and weekend base, cleaning fee,
// extra guest fee, pet fee, deposit, min and max nights). It goes once, on the change itself; the desk can send it
// again by hand. Nothing about the owner (name, money, payout) is in it.
import 'server-only'
import type { OORecord } from './owner-onboard'
import { escHtml } from './email-layout'
import { sendOnboardingMail } from './owner-onboard-mail'
import { guestyGet } from './guesty'
import { readLive } from './channel-live'

export const PRICING_TO = ['kyle@pacerrev.com']
export const PRICING_CC = ['justin@pacerrev.com', 'jon@stay-hospitality.com']
const CHANNEL_NAME: Record<string, string> = { airbnb2: 'Airbnb', airbnb: 'Airbnb', bookingCom: 'Booking.com', homeaway2: 'Vrbo', homeaway: 'Vrbo', expedia: 'Expedia', googleVr: 'Google', direct: 'Direct site' }
const FIELDS = 'title nickname address propertyType roomType accommodates bedrooms bathrooms beds areaSquareFeet listingRooms prices terms'

export const liveDone = (r: Pick<OORecord, 'steps'>) => r.steps.find(s => s.key === 'live')?.status === 'done'

const money = (v: any, cur = 'USD') => (v == null || v === '' || !isFinite(Number(v)) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 2 }))

/** Build and send the pricing email; records it on the onboarding (the caller saves). */
export async function sendPricingBrief(r: OORecord, by: string): Promise<{ ok: boolean; error?: string; to: string[] }> {
  const id = String(r.attach.listingId || '').trim()
  if (!id) { r.pricingBrief = { at: '', to: PRICING_TO, by, error: 'No Guesty listing is attached to this onboarding yet.' }; return { ok: false, error: r.pricingBrief.error, to: PRICING_TO } }
  let l: any = null
  try { l = await guestyGet<any>(`/listings/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`) } catch (e: any) {
    r.pricingBrief = { at: '', to: PRICING_TO, by, error: 'Could not read the listing from Guesty: ' + String(e?.message || e).slice(0, 140) }
    return { ok: false, error: r.pricingBrief.error, to: PRICING_TO }
  }
  const p = l?.prices || {}, t = l?.terms || {}, cur = p.currency || 'USD'
  const h = r.home
  const unit = r.attach.unitLabel || h?.unit || ''
  const where = [r.attach.property, unit ? 'Unit ' + unit : ''].filter(Boolean).join(', ') || l?.nickname || l?.title || 'New listing'
  const beds = h?.beds ? Object.entries(h.beds).filter(([, n]) => Number(n) > 0).map(([k, n]) => n + ' ' + k).join(', ') : ''
  const live = await readLive().catch(() => null)
  const links = live ? Object.entries(live.items).filter(([k, v]) => k.startsWith(id + ':') && v?.url && v.state !== 'gone').map(([k, v]) => [CHANNEL_NAME[k.split(':')[1]] || k.split(':')[1], v.url] as [string, string]) : []
  const bedrooms = l?.bedrooms ?? h?.bedrooms
  const rows: [string, string][] = [
    ['Listing', String(l?.title || '')], ['Nickname in Guesty', String(l?.nickname || '')],
    ['Address', String(l?.address?.full || h?.address || '')],
    ['Live date', (r.deal as any)?.liveDate || new Date().toISOString().slice(0, 10)],
    ['Type', [l?.propertyType, l?.roomType].filter(Boolean).join(' · ')],
    ['Home', [bedrooms === 0 ? 'Studio' : bedrooms != null ? bedrooms + ' bedroom' + (bedrooms === 1 ? '' : 's') : '', (l?.bathrooms ?? h?.bathrooms) != null ? (l?.bathrooms ?? h?.bathrooms) + ' bath' : '', (l?.accommodates ?? h?.guests) ? 'sleeps ' + (l?.accommodates ?? h?.guests) : '', (l?.areaSquareFeet || h?.sqft) ? (l?.areaSquareFeet || h?.sqft) + ' sq ft' : ''].filter(Boolean).join(' · ')],
    ['Beds', beds || (l?.beds ? l.beds + ' beds' : '')],
    ['Parking', h?.parking || ''], ['Washer and dryer', h ? (h.washer ? 'In unit' : 'No') : ''],
    ['Base price', money(p.basePrice, cur)], ['Weekend base price', money(p.weekendBasePrice, cur)],
    ['Cleaning fee', money(p.cleaningFee, cur)],
    ['Extra guest fee', p.extraPersonFee ? money(p.extraPersonFee, cur) + (p.guestsIncludedInRegularFee ? ' per guest over ' + p.guestsIncludedInRegularFee : '') : ''],
    ['Pet fee', money(p.petFee, cur)], ['Security deposit', money(p.securityDepositFee, cur)],
    ['Minimum nights', t.minNights != null ? String(t.minNights) : ''], ['Maximum nights', t.maxNights != null ? String(t.maxNights) : ''],
    ['Currency', cur],
  ]
  const tr = (k: string, v: string, raw = false) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escHtml(k)}</td><td style="padding:6px 0;color:#111">${raw ? v : escHtml(v)}</td></tr>`
  const a = (href: string, label: string) => `<a href="${escHtml(href)}" style="color:#1f4e46">${escHtml(label)}</a>`
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.45;max-width:640px">
<p>Hi Kyle,</p>
<p><b>${escHtml(where)}</b> is now live. Please set up pricing for it, and let us know once it is done or if you need anything else.</p>
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13.5px;margin:8px 0 14px">
${rows.filter(([, v]) => v).map(([k, v]) => tr(k, v)).join('\n')}
${tr('Guesty', a('https://app.guesty.com/properties/' + encodeURIComponent(id), 'Open the listing in Guesty') + ' &nbsp;<span style="color:#9ca3af">(' + escHtml(id) + ')</span>', true)}
${links.map(([n, u]) => tr(n, a(u, 'View on ' + n), true)).join('\n')}
</table>
<p>Thank you,<br>Stay Hospitality</p>
<p style="font-size:11.5px;color:#9ca3af">Sent by Lighthouse when the listing was marked live.</p></div>`
  const res = await sendOnboardingMail({ to: PRICING_TO, cc: PRICING_CC, subject: `New listing live: ${where} · pricing setup`, html })
  r.pricingBrief = res.ok ? { at: new Date().toISOString(), to: PRICING_TO, by } : { at: '', to: PRICING_TO, by, error: String(res.error || 'not sent').slice(0, 200) }
  return { ok: res.ok, error: res.error, to: PRICING_TO }
}

// BRAND, THE ALLOWED WAY (Jon, 2026-11-09: "any new allowable features … on the OTAs to bring more
// brand awareness").
//
// One copy goes from Lighthouse to Guesty and from there to every channel, so a line written here
// lands on Airbnb too — the strictest. This file separates three things:
//
//   1. EVERYWHERE  lines that build a recognisable Stay listing WITHOUT a company name, a link or a
//                  contact: the same sign-off, the same way of naming the building and the area, the
//                  same caption on every exterior. Recognition comes from consistency.
//   2. DIRECT ONLY lines that carry the company name or a "book direct" message. Those belong on the
//                  direct-booking site, the in-unit guidebook and the flyer — never in booking-site copy.
//   3. NEVER       links, phone numbers, emails, social handles, promo codes, "book direct".
//
// THE RULES ARE WORDED ONCE, in BRAND_CHANNEL_RULES below, so they can be corrected in one place when
// a channel changes its policy. brandLint() is the checker: it runs the same channel lint the copy
// push uses (lib/channel-lint) plus the brand-specific bans.
//
// Pure: no I/O.
import { lintField, type LintHit } from './channel-lint'

export const BRAND_NAME = 'Stay Hospitality'

export type BrandRule = { channel: string; allowed: string; notAllowed: string }
/** THE ONE PLACE the per-channel brand rules are worded. */
export const BRAND_CHANNEL_RULES: BrandRule[] = [
  { channel: 'Airbnb', allowed: 'The brand lives in the host profile (name, photo, about). In the listing: a consistent voice, sign-off, photo order and captions.', notAllowed: 'Company names used as advertising, logos or text on photos, links, contact details, “book direct”.' },
  { channel: 'Vrbo', allowed: 'The property-manager name on the profile. In the listing: the same consistent copy and photos.', notAllowed: 'Links, phone numbers or emails in the description; logos, text or watermarks on photos; promotions outside the structured fields.' },
  { channel: 'Booking.com', allowed: 'The property name and the photo set — Booking.com writes its own description from the facilities.', notAllowed: 'Logos, watermarks, text or contact details on photos.' },
  { channel: 'Direct site, guidebook, flyer, social, email', allowed: 'Everything: the Stay name and logo, “book direct”, links and contact details.', notAllowed: 'Nothing brand-related — these are yours.' },
]

export type BrandLine = {
  id: string
  /** Where in the listing it goes. */
  where: 'Summary or The space — last line' | 'Other notes' | 'Photo caption — exterior, building, pool' | 'Title pattern'
  text: string
  /** One clause on why it builds recognition. */
  why: string
}

const tidy = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim()

/** Lines safe on every booking site: no company name, no contact, no link. Only what is true of this unit should be used. */
export function otaBrandLines(ctx: { building?: string | null; city?: string | null }): BrandLine[] {
  const building = tidy(ctx.building), city = tidy(ctx.city)
  const place = [building, city].filter(Boolean).join(' in ')
  const out: BrandLine[] = [
    { id: 'signoff', where: 'Summary or The space — last line', text: 'Your local hosts are a message away, any time during your stay.', why: 'The same closing promise on every listing — guests who see two of your homes recognise the host.' },
    { id: 'local', where: 'Summary or The space — last line', text: 'Hosted by a South Florida team that looks after every home it lists.', why: 'Says who is behind the home without naming a company.' },
    { id: 'notes', where: 'Other notes', text: 'Questions before booking? Send a message here and a local host will answer.', why: 'Keeps the conversation on the booking site, which the channels reward, and sounds the same on every listing.' },
  ]
  if (building) {
    out.push({ id: 'collection', where: 'Summary or The space — last line', text: `One of several homes we host at ${place}.`, why: 'Names the building the same way every time, so the homes read as a set.' })
    out.push({ id: 'caption', where: 'Photo caption — exterior, building, pool', text: `${building}${city ? ', ' + city : ''}`, why: 'The building named identically on every exterior and amenity photo — captions are read by AI search too.' })
    out.push({ id: 'title', where: 'Title pattern', text: `(your hook) | (beds) at ${building}`, why: 'One title shape across the building. Use it only where the building name is something guests search for — the 50 characters are for the hook first.' })
  }
  return out.filter(l => l.id === 'title' || brandLint(l.text).length === 0)
}

/** Lines for the places Stay owns. Never paste these into booking-site copy. */
export function directBrandLines(ctx: { building?: string | null; city?: string | null }): { id: string; text: string }[] {
  const building = tidy(ctx.building)
  return [
    { id: 'd-host', text: `Hosted by ${BRAND_NAME}, a South Florida hospitality team.` },
    ...(building ? [{ id: 'd-collection', text: `${building} is part of the ${BRAND_NAME} collection.` }] : []),
    { id: 'd-direct', text: `Book direct with ${BRAND_NAME} next time for the best rate.` },
  ]
}

const BRAND_BANS: { re: RegExp; reason: string }[] = [
  { re: /\bbook(?:ing)?\s+(?:with\s+us\s+)?direct(?:ly)?\b/i, reason: '“book direct” wording — the booking sites remove it and can penalise the listing' },
  { re: /\b(?:our|my)\s+(?:web\s?site|site|page)\b/i, reason: 'a pointer to your own website' },
  { re: /\b(?:instagram|facebook|tiktok|whatsapp|telegram)\b|(?:^|\s)@[a-z0-9_.]{3,}/i, reason: 'a social account or handle' },
  { re: /\b(?:promo|coupon|discount)\s?code\b|\buse code\b/i, reason: 'a promo code' },
  { re: /\b(?:call|text|email)\s+(?:us|me)\b/i, reason: 'an invitation to contact you off the booking site' },
  { re: /\bstay\s+hospitality\b/i, reason: 'the company name — keep it for the host profile, the direct site and the guidebook' },
]

/** Why a line should NOT go into booking-site copy. Empty = fine to use everywhere. */
export function brandLint(text: string): string[] {
  const t = tidy(text)
  if (!t) return []
  const out: string[] = []
  for (const b of BRAND_BANS) if (b.re.test(t)) out.push(b.reason)
  const hits: LintHit[] = lintField('space', t)
  for (const h of hits) out.push(h.message)
  return Array.from(new Set(out))
}

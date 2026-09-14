// GUEST CONTACTS — one row per human, built for a mailing list (Jon, 2026-09-14: "guest contact
// list ... first name, last name, email, phone number ... how many times booked, guest reviews
// left ... so we can then connect to api to mailchimp to upload the contact info").
//
// This sits on top of the same aggregation the Guests directory already does, deliberately: a
// contact and a guest profile must be the SAME person, keyed the same way, or the VIP flag and the
// tags Jon keeps in /guests would not follow the contact into Mailchimp.
//
// THE ONE THING THAT MATTERS MOST HERE. Most of the "email addresses" an OTA hands over are not
// email addresses. Airbnb sends a relay like a1b2c3@guest.airbnb.com; Booking sends a masked
// mailbox; Vrbo sends a threaded alias. They forward to the guest only while the booking is live,
// they rot afterwards, and Airbnb's own terms forbid marketing to them. Upload 4,000 of those to
// Mailchimp and you pay for dead contacts, burn your sending reputation on the bounces, and risk
// your Airbnb account. So every address is classified, the relays are kept VISIBLE in the app (the
// front desk still needs to look a guest up by the address the OTA gave) and are NEVER mailable.
import { bucketFor, familyFor, otaGroupFor, type Family } from './marketing'
import { buildingOf, marketOf } from './segments'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))

/** Reservation statuses that mean a real stay happened or is going to. Mirrors /api/guests. */
export const LIVE_STATUS = new Set(['confirmed', 'checked_in', 'checked_out', 'completed'])

// ── ADDRESSES THAT ARE NOT ADDRESSES ────────────────────────────────────────────────────────────
// Domain suffixes an OTA uses for a forwarding alias. Matched on the domain, never on the whole
// string, so a guest whose real address merely CONTAINS "airbnb" is not wrongly binned.
const RELAY_DOMAINS = [
  'guest.airbnb.com', 'reply.airbnb.com', 'airbnb.com',
  'guest.booking.com', 'mchat.booking.com', 'reservations.booking.com', 'booking.com',
  'm.vrbo.com', 'guest.vrbo.com', 'messages.homeaway.com', 'homeaway.com', 'vrbo.com',
  'stay.expedia.com', 'guest.expedia.com', 'expediapartnercentral.com', 'expedia.com',
  'partners.agoda.com', 'agoda.com',
  'tripadvisor.com', 'marriott.com', 'bluegroundnestpick.com',
]
// Addresses that are structurally junk rather than channel relays.
const JUNK_LOCAL = /^(no-?reply|donotreply|do-not-reply|postmaster|mailer-daemon|unknown|guest|test)$/i
const JUNK_DOMAIN = /(^|\.)(example|test|invalid|localhost|none|noemail)(\.|$)/i

export type MailState = 'mailable' | 'relay' | 'invalid' | 'none'

/** Why an address can or cannot be marketed to. The reason is shown to the user, not just the flag. */
export function classifyEmail(raw: string | null | undefined): { email: string | null; state: MailState; reason: string } {
  const e = str(raw).trim().toLowerCase()
  if (!e) return { email: null, state: 'none', reason: 'No email on any booking' }
  // Deliberately loose: real guest addresses come in shapes a strict RFC test rejects.
  const m = /^([^\s@]+)@([^\s@]+\.[^\s@]{2,})$/.exec(e)
  if (!m) return { email: e, state: 'invalid', reason: 'Not a usable address' }
  const local = m[1], domain = m[2]
  for (const d of RELAY_DOMAINS) {
    if (domain === d || domain.endsWith('.' + d)) {
      return { email: e, state: 'relay', reason: otaGroupFor(d.split('.')[d.split('.').length - 2]) + ' forwarding address — expires, and marketing to it breaches the channel terms' }
    }
  }
  if (JUNK_LOCAL.test(local) || JUNK_DOMAIN.test(domain)) return { email: e, state: 'invalid', reason: 'Not a real mailbox' }
  return { email: e, state: 'mailable', reason: '' }
}

// ── NAMES ───────────────────────────────────────────────────────────────────────────────────────
const TITLES = /^(mr|mrs|ms|miss|dr|prof|sir|madam|mx)\.?$/i
const SUFFIXES = /^(jr|sr|ii|iii|iv|phd|md|esq)\.?$/i

/** Split one display name into the two fields a mailing list needs. "Smith, John" works too. */
export function splitName(raw: string | null | undefined): { first: string; last: string; full: string } {
  let s = str(raw).replace(/\s+/g, ' ').trim()
  if (!s) return { first: '', last: '', full: '' }
  // "Last, First" — common out of Booking.com.
  if (s.indexOf(',') > 0 && s.split(',').length === 2) {
    const [a, b] = s.split(',').map(x => x.trim())
    if (a && b) s = b + ' ' + a
  }
  let parts = s.split(' ').filter(Boolean)
  if (parts.length > 1 && TITLES.test(parts[0])) parts = parts.slice(1)
  while (parts.length > 1 && SUFFIXES.test(parts[parts.length - 1])) parts = parts.slice(0, -1)
  if (!parts.length) return { first: '', last: '', full: s }
  // Capitalise only what arrived shouting or whispering; leave "McDonald" and "de Vries" alone.
  const fix = (w: string) => (w === w.toUpperCase() || w === w.toLowerCase())
    ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w
  parts = parts.map(fix)
  if (parts.length === 1) return { first: parts[0], last: '', full: parts[0] }
  return { first: parts[0], last: parts.slice(1).join(' '), full: parts.join(' ') }
}

/** For matching a review's guest_name against a reservation's. Punctuation and case are noise. */
export function nameKey(raw: string | null | undefined): string {
  return str(raw).toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
}

/** Same key the Guests directory uses, so a contact and its profile are one person. */
export function contactKey(email: string, guestId: string, name: string): string {
  const e = str(email).trim().toLowerCase()
  if (e && /@/.test(e)) return 'e:' + e
  if (str(guestId).trim()) return 'g:' + str(guestId).trim()
  return 'n:' + str(name).trim().toLowerCase().replace(/\s+/g, ' ')
}

export type Stay = {
  unit: string; building: string | null; market: string
  checkIn: string; checkOut: string; nights: number; value: number
  source: string; channel: string; family: Family
}

export type Contact = {
  key: string
  first: string; last: string; name: string
  email: string | null; mail: MailState; mailReason: string
  phone: string | null
  // How they book. `channel` is the most recent; `channels` is everything they have ever used, so
  // "has booked direct at least once" is answerable — that is the win-back list.
  channel: string; family: Family; channels: string[]; everDirect: boolean
  stays: number; nights: number; value: number
  firstStay: string; lastStay: string; nextStay: string | null; inHouse: boolean
  units: string[]; buildings: string[]; markets: string[]
  lastUnit: string; lastBuilding: string | null
  reviews: number; reviewAvg: number | null
  vip: boolean; tags: string[]
  history: Stay[]
}

export type ListingLite = { id: string; nickname?: string | null; title?: string | null; building?: string | null; address_city?: string | null; city?: string | null }
export type ReservationLite = {
  listing_id?: string | null; listing_name?: string | null
  guest_id?: string | null; guest_name?: string | null; guest_email?: string | null; guest_phone?: string | null
  check_in?: string | null; check_out?: string | null; nights?: any; status?: string | null
  source?: string | null; money_total?: any
}
export type ReviewLite = { listing_id?: string | null; guest_name?: string | null; rating?: any; created_at?: string | null }
export type ProfileLite = { guest_key?: string | null; name?: string | null; email?: string | null; phone?: string | null; vip?: any; tags?: any; notes?: any }

/** Days after checkout within which a review is still plausibly about that stay. */
const REVIEW_WINDOW_DAYS = 45
/** If two DIFFERENT guests left the same unit within this many days, attribution is a coin toss. */
const AMBIGUOUS_DAYS = 2

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : NaN
}

/**
 * ATTACH REVIEWS TO THE PERSON WHO LEFT THEM.
 *
 * Guesty's review payload carries no email and no reservation id — only a listing, a date, and a
 * reviewer name. The first version of this matched on listing + name, which was the safe rule and
 * also, in this account, a dead one: guesty_reviews.guest_name is null on the rows we hold (the
 * Reviews dashboard prints the literal word "Guest"), so every contact came back with zero reviews.
 *
 * So the stay is the join. A review published for a unit belongs to whoever most recently checked
 * out of that unit before it appeared. Two guards keep that from inventing things:
 *   - the review must fall within REVIEW_WINDOW_DAYS of the checkout, or it is nobody's;
 *   - if a DIFFERENT guest also left that unit within AMBIGUOUS_DAYS of the best candidate, the
 *     review is dropped rather than guessed at. A missing review count is a small wrong; telling
 *     Jon that one guest reviewed another guest's stay is a bigger one.
 * A name on the review, when there is one, still wins outright — it is direct evidence.
 */
function attachReviews(
  m: Record<string, any>,
  stayIx: Record<string, { key: string; nameKey: string; checkOut: string }[]>,
  reviews: ReviewLite[],
) {
  for (const lid of Object.keys(stayIx)) stayIx[lid].sort((a, b) => a.checkOut < b.checkOut ? 1 : -1)

  for (const rv of reviews) {
    const lid = str(rv.listing_id)
    const at = str(rv.created_at).slice(0, 10)
    const stays = stayIx[lid]
    if (!lid || !at || !stays || !stays.length) continue

    let picked: string | null = null

    const nk = nameKey(rv.guest_name)
    if (nk) {
      const byName = stays.filter(s => s.nameKey === nk)
      if (byName.length) picked = byName[0].key
    }

    if (!picked) {
      // stays are newest-first, so the first checkout at or before the review date is the nearest.
      const before = stays.filter(s => s.checkOut <= at && daysBetween(s.checkOut, at) <= REVIEW_WINDOW_DAYS)
      if (before.length) {
        const best = before[0]
        const rival = before.find(s => s.key !== best.key && daysBetween(s.checkOut, best.checkOut) <= AMBIGUOUS_DAYS)
        if (!rival) picked = best.key
      }
    }

    if (!picked) continue
    const c = m[picked]
    if (!c) continue
    c.reviews += 1
    const r = Number(rv.rating)
    if (Number.isFinite(r) && r > 0) {
      c._rated = (c._rated || 0) + 1
      c._sum = (c._sum || 0) + r
    }
  }
}

/**
 * Fold reservations into contacts.
 *
 * Reviews are attached by attachReviews() — see the note there for why the stay, not the name, is
 * the join, and for the two guards that stop it inventing attributions.
 */
export function buildContacts(opts: {
  reservations: ReservationLite[]
  listings: ListingLite[]
  reviews?: ReviewLite[]
  profiles?: ProfileLite[]
  today: string
}): Contact[] {
  const { reservations, listings, today } = opts
  const reviews = opts.reviews || []
  const profiles = opts.profiles || []

  const unitOf: Record<string, { name: string; building: string | null; market: string }> = {}
  for (const l of listings) {
    const name = str(l.nickname || l.title)
    // address_city is what the column is actually called; `city` stays accepted so a caller
    // that already has a mapped shape (the share route) keeps working.
    unitOf[str(l.id)] = { name, building: buildingOf(l.building, name), market: marketOf(l.building, l.address_city ?? l.city, name) }
  }

  // Who stayed where, and when they left. This is what reviews get attached to — see attachReviews.
  const stayIx: Record<string, { key: string; nameKey: string; checkOut: string }[]> = {}

  type Acc = Contact & { _units: Set<string>; _buildings: Set<string>; _markets: Set<string>; _channels: Set<string> }
  const m: Record<string, Acc> = {}

  for (const r of reservations) {
    if (!LIVE_STATUS.has(str(r.status).toLowerCase())) continue
    const rawName = str(r.guest_name)
    const key = contactKey(str(r.guest_email), str(r.guest_id), rawName)
    if (key === 'n:') continue
    const nm = splitName(rawName)
    let c = m[key]
    if (!c) {
      c = m[key] = {
        key, first: nm.first, last: nm.last, name: nm.full || 'Guest',
        email: null, mail: 'none', mailReason: 'No email on any booking', phone: null,
        channel: '', family: 'ota', channels: [], everDirect: false,
        stays: 0, nights: 0, value: 0,
        firstStay: '9999-99-99', lastStay: '', nextStay: null, inHouse: false,
        units: [], buildings: [], markets: [], lastUnit: '', lastBuilding: null,
        reviews: 0, reviewAvg: null, vip: false, tags: [], history: [],
        _units: new Set(), _buildings: new Set(), _markets: new Set(), _channels: new Set(),
      } as Acc
    }
    // A longer name is a better name: "J Smith" on one booking and "Jonathan Smith" on the next.
    if (nm.full.length > c.name.length) { c.first = nm.first; c.last = nm.last; c.name = nm.full }

    const ci = str(r.check_in).slice(0, 10)
    const co = str(r.check_out).slice(0, 10)
    const src = str(r.source)
    const fam = familyFor(bucketFor(src))
    const chan = fam === 'ota' ? otaGroupFor(src) : (fam === 'direct' ? 'Direct' : fam === 'owner' ? 'Owner' : 'Manual')
    const u = unitOf[str(r.listing_id)] || { name: str(r.listing_name), building: null, market: 'Unknown' }

    c.stays += 1
    c.nights += Number(r.nights) || 0
    c.value += Number(r.money_total) || 0
    c._channels.add(chan)
    if (fam === 'direct') c.everDirect = true
    if (u.name) c._units.add(u.name)
    if (u.building) c._buildings.add(u.building)
    if (u.market) c._markets.add(u.market)
    if (ci && ci < c.firstStay) c.firstStay = ci
    // "Most recent" is by check-in, and it decides the channel tag that goes to Mailchimp.
    if (ci && ci >= c.lastStay) {
      c.lastStay = ci; c.channel = chan; c.family = fam
      if (u.name) { c.lastUnit = u.name; c.lastBuilding = u.building }
    }
    if (ci && ci > today && (!c.nextStay || ci < c.nextStay)) c.nextStay = ci
    if (ci && co && ci <= today && co > today) c.inHouse = true

    // Best contact details win: a real address beats a relay, and any address beats none.
    const cand = classifyEmail(r.guest_email)
    const rank: Record<MailState, number> = { mailable: 3, relay: 2, invalid: 1, none: 0 }
    if (cand.email && rank[cand.state] > rank[c.mail]) { c.email = cand.email; c.mail = cand.state; c.mailReason = cand.reason }
    const ph = str(r.guest_phone).trim()
    if (ph && (!c.phone || ph.length > c.phone.length)) c.phone = ph

    if (c.history.length < 40) {
      c.history.push({ unit: u.name || 'Unit', building: u.building, market: u.market, checkIn: ci, checkOut: co, nights: Number(r.nights) || 0, value: Number(r.money_total) || 0, source: src, channel: chan, family: fam })
    }

    const lid = str(r.listing_id)
    if (lid && co) (stayIx[lid] = stayIx[lid] || []).push({ key, nameKey: nameKey(rawName), checkOut: co })
  }

  attachReviews(m, stayIx, reviews)

  const profBy: Record<string, ProfileLite> = {}
  for (const p of profiles) profBy[str(p.guest_key)] = p

  const out: Contact[] = Object.values(m).map(c => {
    const p = profBy[c.key]
    const rated = (c as any)._rated || 0
    const sum = (c as any)._sum || 0
    // _rated/_sum are the running total behind reviewAvg. They are accumulator state, not contact
    // data, and were riding out through ...rest into the API response — strip them here.
    const { _units, _buildings, _markets, _channels, _rated, _sum, ...rest } = c as any
    return {
      ...rest,
      units: Array.from(_units as Set<string>).slice(0, 12),
      buildings: Array.from(_buildings as Set<string>).slice(0, 12),
      markets: Array.from(_markets as Set<string>).slice(0, 6),
      channels: Array.from(_channels as Set<string>).sort(),
      firstStay: c.firstStay === '9999-99-99' ? '' : c.firstStay,
      reviewAvg: rated ? Math.round((sum / rated) * 10) / 10 : null,
      vip: !!(p && p.vip),
      tags: Array.isArray(p && p.tags) ? (p!.tags as any[]).map(t => str(t)).filter(Boolean).slice(0, 12) : [],
    } as Contact
  })

  // A manual profile with no booking yet is still a contact — that is what creating one is for.
  const seen = new Set(out.map(c => c.key))
  for (const p of profiles) {
    const k = str(p.guest_key)
    if (!k || seen.has(k)) continue
    const nm = splitName(p.name)
    const cls = classifyEmail(p.email)
    out.push({
      key: k, first: nm.first, last: nm.last, name: nm.full || 'Guest',
      email: cls.email, mail: cls.state, mailReason: cls.reason, phone: str(p.phone) || null,
      channel: 'Added by hand', family: 'direct', channels: [], everDirect: false,
      stays: 0, nights: 0, value: 0, firstStay: '', lastStay: '', nextStay: null, inHouse: false,
      units: [], buildings: [], markets: [], lastUnit: '', lastBuilding: null,
      reviews: 0, reviewAvg: null,
      vip: !!p.vip, tags: Array.isArray(p.tags) ? (p.tags as any[]).map(t => str(t)).filter(Boolean).slice(0, 12) : [],
      history: [],
    })
  }

  out.sort((a, b) => b.value - a.value || b.stays - a.stays || a.name.localeCompare(b.name))
  return out
}

/** The counts the marketing link is allowed to show. No names, no addresses — shape only. */
export function audienceSummary(contacts: Contact[]) {
  const byChannel: Record<string, number> = {}
  const byBuilding: Record<string, number> = {}
  let mailable = 0, relay = 0, noEmail = 0, withPhone = 0, repeat = 0, everDirect = 0
  for (const c of contacts) {
    if (c.mail === 'mailable') mailable++
    else if (c.mail === 'relay') relay++
    else noEmail++
    if (c.phone) withPhone++
    if (c.stays >= 2) repeat++
    if (c.everDirect) everDirect++
    if (c.channel) byChannel[c.channel] = (byChannel[c.channel] || 0) + 1
    if (c.lastBuilding) byBuilding[c.lastBuilding] = (byBuilding[c.lastBuilding] || 0) + 1
  }
  const top = (o: Record<string, number>, n: number) =>
    Object.entries(o).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, n)
  return {
    contacts: contacts.length,
    mailable, relay, noEmail, withPhone, repeat, everDirect,
    channels: top(byChannel, 10),
    buildings: top(byBuilding, 12),
  }
}

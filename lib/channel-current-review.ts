// A REVIEW COUNTS TOWARD A CHANNEL'S SCORE ONLY IF IT WAS LEFT ON THE LISTING THAT IS LIVE NOW
// (Jon, 2026-11-09: "we recreated listings on Airbnb, so make sure the review score is the current score,
// not what you're pulling from Guesty").
//
// When a listing is recreated on Airbnb it gets a new Airbnb room id and starts over — the old room's
// reviews stay in Guesty (and in guesty_reviews) attached to the same Guesty listing, so averaging
// everything Guesty holds shows a score the guest no longer sees. Each review carries the channel's own
// listing id (Guesty's `externalListingId`, or `rawReview.listing_id` / `listingId` from the channel's
// payload); the live listing carries its id in `raw.integrations[]` (the channel sub-object's `id`, or the
// number in its externalUrl). When both are known and differ, the review belongs to a retired listing and
// is left out of that channel's score. When either is unknown the review is kept — never guess it away.
const CH_KEYS: Record<string, string[]> = {
  Airbnb: ['airbnb2', 'airbnb'],
  Vrbo: ['homeaway2', 'homeaway', 'vrbo'],
  'Booking.com': ['bookingCom', 'booking'],
  Expedia: ['expedia'],
}
const isGuestyId = (s: string) => /^[0-9a-f]{24}$/i.test(s)

/** The channel's own listing id for the live listing, from Guesty's integrations. */
export function liveChannelListingId(listingRaw: any, channel: string): string {
  const ints: any[] = listingRaw && Array.isArray(listingRaw.integrations) ? listingRaw.integrations : []
  const keys = CH_KEYS[channel] || []
  const hit = ints.find(it => it && (keys.includes(String(it.platform)) || keys.some(k => it[k])))
  if (!hit) return ''
  const sub = keys.map(k => hit[k]).find(Boolean)
  const id = sub && sub.id != null ? String(sub.id) : ''
  if (id) return id
  const m = String(hit.externalUrl || '').match(/\/(?:rooms|h)\/(?:plus\/)?(\d{5,})/)
  return m ? m[1] : ''
}

/** The channel listing a review was left on, when the review says. */
export function reviewChannelListingId(reviewRaw: any): string {
  const r = reviewRaw || {}
  const rr = r.rawReview || r.raw || {}
  for (const v of [r.externalListingId, r.external_listing_id, rr.listing_id, rr.listingId, rr.external_listing_id]) {
    const s = v == null ? '' : String(v).trim()
    if (s && !isGuestyId(s)) return s
  }
  return ''
}

/** False when the review was left on a channel listing that has since been replaced. */
export function isCurrentChannelReview(reviewRaw: any, listingRaw: any, channel: string): boolean {
  if (!channel) return true
  const live = liveChannelListingId(listingRaw, channel)
  const was = reviewChannelListingId(reviewRaw)
  return !(live && was && live !== was)
}

// DIRECT LINKS TO THE LIVE LISTING ON EACH CHANNEL (Jon, 2026-09-16: "need the links to Airbnb
// to review the listing").
//
// Guesty's `raw.integrations[]` carries one entry per channel, each shaped:
//   { _id, platform: 'airbnb2', externalUrl: 'https://www.airbnb.com/rooms/154…', airbnb2: { id, … } }
//
// Two rules, learned the hard way:
//
//   1. externalUrl IS THE ANSWER. It is Guesty's own canonical link and it is populated on
//      essentially every live listing — Airbnb 221/221, Vrbo 226/227, Booking.com 230/232.
//      Building a URL from the channel's numeric id only works where the channel's URLs are
//      id-shaped: Booking.com's are a human slug ("17west-1br-apartment-with-balcony-407"),
//      which cannot be derived from an id at all, so an id-built Booking link is always wrong.
//
//   2. MATCH THE PLATFORM KEY EXACTLY, INCLUDING ITS VERSION SUFFIX. Guesty names these
//      'airbnb2' and 'homeaway2'. Code that looked for 'homeaway' or 'vrbo' matched neither, so
//      the Vrbo button silently never rendered on any listing in the account — it looked like we
//      had no Vrbo link when we had 226 of them.
//
// Both call sites (the listing page header and /api/faq) read this, so the links can only be
// wrong in one place.
export type OtaLink = { name: string; url: string }

const CHANNELS: { name: string; keys: string[]; fromId?: (id: string) => string }[] = [
  { name: 'Airbnb', keys: ['airbnb2', 'airbnb'], fromId: id => 'https://www.airbnb.com/rooms/' + id },
  { name: 'Vrbo', keys: ['homeaway2', 'homeaway', 'vrbo'], fromId: id => 'https://www.vrbo.com/' + id },
  // No fromId on purpose — see rule 1.
  { name: 'Booking.com', keys: ['bookingCom', 'booking'] },
  { name: 'Expedia', keys: ['expedia'] },
]

const httpish = (u: any): string => {
  const s = String(u || '').trim()
  return /^https?:\/\//i.test(s) ? s : ''
}

/** Every channel this listing is live on, with a link that opens the real guest-facing page. */
export function otaLinksFrom(raw: any): OtaLink[] {
  const ints: any[] = raw && Array.isArray(raw.integrations) ? raw.integrations : []
  const out: OtaLink[] = []
  for (const ch of CHANNELS) {
    // An integration matches on its `platform` field, or by carrying the channel's own sub-object.
    const hit = ints.find(it => it && (ch.keys.includes(String(it.platform)) || ch.keys.some(k => it[k])))
    if (!hit) continue
    let url = httpish(hit.externalUrl)
    if (!url && ch.fromId) {
      const sub = ch.keys.map(k => hit[k]).find(Boolean)
      const id = sub && sub.id != null ? String(sub.id) : ''
      if (id) url = ch.fromId(id)
    }
    if (url) out.push({ name: ch.name, url })
  }
  return out
}

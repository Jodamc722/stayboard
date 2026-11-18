// LISTING STRATEGY (Jon, 2026-11-18: "do a full revamp and take what was shared as something to consider
// into listing optimization, strategies"). The Optimize score grades what is written on the listing.
// These checks grade what copy cannot fix, and they come BEFORE the copy:
//   1. rating under 4.7     → the booking sites rank and badge on reviews first; fix the stay, then rewrite
//   2. a thin review count  → a unit that is one of many of the same type could share one room-type listing
//   3. a base price far from what nights sell for → the site prints the base as the "from" price
// None of this changes the Optimize score. Pure functions plus two small reads.

export type StrategyFlag = {
  key: 'rating' | 'reviews' | 'price'
  severity: 'bad' | 'warn'
  label: string
  note: string
  action: string
  href: string
}

export const RATING_FLOOR = 4.7
const money = (n: number) => '$' + Math.round(n).toLocaleString()
const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }

export function weightedMedian(rows: { rate: number; nights: number }[]): number | null {
  const list = rows.filter(r => r.rate > 0 && r.nights > 0).sort((a, b) => a.rate - b.rate)
  const total = list.reduce((s, r) => s + r.nights, 0)
  if (!total) return null
  let run = 0
  for (const r of list) { run += r.nights; if (run >= total / 2) return r.rate }
  return list[list.length - 1].rate
}

export type Booked = { rate: number | null; nights: number; stays: { rate: number; nights: number }[] }

/** The median night actually booked per listing over the last 12 months (accommodation fare ÷ nights). */
export async function bookedNightly(sb: any, ids: string[]): Promise<Map<string, Booked>> {
  const out = new Map<string, Booked>()
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  for (let i = 0; i < ids.length; i += 100) {
    for (let page = 0; page < 20; page++) {
      const { data, error } = await sb.from('guesty_reservations')
        .select('listing_id,nights,fare:raw->money->>fareAccommodation')
        .in('listing_id', ids.slice(i, i + 100)).in('status', ['confirmed', 'checked_in', 'checked_out'])
        .gte('check_in', since).gt('nights', 0).order('id').range(page * 1000, page * 1000 + 999)
      if (error) break
      for (const r of (data || []) as any[]) {
        const fare = num(r.fare), n = num(r.nights)
        if (!fare || !n || fare <= 0) continue
        const k = String(r.listing_id)
        const b = out.get(k) || { rate: null, nights: 0, stays: [] }
        b.stays.push({ rate: fare / n, nights: n }); b.nights += n
        out.set(k, b)
      }
      if (!data || data.length < 1000) break
    }
  }
  out.forEach(b => { b.rate = weightedMedian(b.stays) })
  return out
}

/** "Studio" / "1BR" / "2BR / 2.5BA", sleeps N — the first cut of "the same unit on paper". */
export function typeKey(l: any): string {
  return [Number(l?.bedrooms) || 0, Number(l?.bathrooms) || 0, Number(l?.max_occupancy) || 0].join('|')
}
export function typeLabel(l: any, many = false): string {
  const b = Number(l?.bedrooms) || 0, s = Number(l?.max_occupancy) || 0
  const head = b === 0 ? (many ? 'studios' : 'studio') : `${b}-bedroom${many ? 's' : ''}`
  return s ? `${head} sleeping ${s}` : head
}

/** The other live units in the same building with the same bedrooms, baths and sleeps. */
export async function sisterUnits(sb: any, listing: any): Promise<{ count: number; titles: string[] }> {
  const building = String(listing?.building || '').trim()
  if (!building) return { count: 0, titles: [] }
  try {
    const { data } = await sb.from('guesty_listings')
      .select('id,title,bedrooms,bathrooms,max_occupancy,status,active:raw->>active')
      .eq('building', building).limit(300)
    const key = typeKey(listing)
    const rows = ((data || []) as any[]).filter(r => String(r.id) !== String(listing.id) && String(r.active) !== 'false'
      && !/inactive|archiv|deleted|offboard/i.test(String(r.status || '')) && typeKey(r) === key)
    const titles = Array.from(new Set(rows.map(r => String(r.title || '').trim()).filter(Boolean))).slice(0, 6)
    return { count: rows.length, titles }
  } catch { return { count: 0, titles: [] } }
}

export function unitStrategy(i: {
  avgRating: number | null; reviewCount: number
  base: number | null; booked: number | null; bookedNights?: number
  sisters?: number; typeWords?: string
  buildingHref: string; reviewsHref?: string
}): StrategyFlag[] {
  const flags: StrategyFlag[] = []
  const reviewsHref = i.reviewsHref || '/reviews'
  if (i.avgRating != null && i.reviewCount >= 3 && i.avgRating < RATING_FLOOR) {
    flags.push({
      key: 'rating', severity: i.avgRating < 4.5 ? 'bad' : 'warn',
      label: `Rating ${i.avgRating.toFixed(2)} — under ${RATING_FLOOR}`,
      note: 'The booking sites rank and badge on reviews before they read the copy. Fix what the low reviews name first; a rewrite will not lift this.',
      action: 'Read the reviews', href: reviewsHref,
    })
  }
  if (i.reviewCount < 5) {
    const pool = (i.sisters || 0) >= 2
    flags.push({
      key: 'reviews', severity: 'warn',
      label: i.reviewCount === 0 ? 'No reviews yet' : `Only ${i.reviewCount} review${i.reviewCount === 1 ? '' : 's'}`,
      note: pool
        ? `A thin review count ranks low on its own. ${i.sisters} other ${i.typeWords || 'units'} in this building match it on paper: one room-type listing would pool the bookings and reviews.`
        : 'A thin review count ranks low on its own. The first five reviews matter most, so this unit needs the cleanest turns and a review ask on every stay.',
      action: pool ? 'See the building' : 'Read the reviews', href: pool ? i.buildingHref : reviewsHref,
    })
  }
  if (i.base != null && i.booked != null && (i.bookedNights ?? 20) >= 20 && i.booked > 0) {
    const ratio = i.base / i.booked
    if (ratio >= 1.5 || ratio <= 0.6) {
      flags.push({
        key: 'price', severity: ratio >= 3 ? 'bad' : 'warn',
        label: `Base price ${money(i.base)}, nights sell for ${money(i.booked)}`,
        note: ratio >= 1.5
          ? 'The base price is what a booking site prints as the "from" price and what a day falls back to when nothing else has priced it. This one reads far above what guests pay.'
          : 'The base price sits well under what nights sell for, so any day nothing else has priced goes out cheap.',
        action: 'Base prices', href: i.buildingHref,
      })
    }
  }
  return flags
}

export type BuildingStrategy = { key: 'rating' | 'price' | 'types'; label: string; note: string }[]

/** One line each, only when it applies, for the top of a property page. */
export function buildingStrategy(units: {
  avgRating: number | null; reviewCount: number; base: number | null; booked: number | null; bookedNights: number
  bedrooms: any; bathrooms: any; max_occupancy: any
}[]): BuildingStrategy {
  const out: BuildingStrategy = []
  const rated = units.filter(u => u.avgRating != null && u.reviewCount >= 3)
  const low = rated.filter(u => (u.avgRating as number) < RATING_FLOOR)
  if (low.length) {
    const avg = rated.reduce((s, u) => s + (u.avgRating as number), 0) / rated.length
    out.push({
      key: 'rating',
      label: `${low.length} of ${rated.length} rated units are under ${RATING_FLOOR}`,
      note: `Average ${avg.toFixed(2)}. Reviews move rank before copy does, so these need the stay fixed first.`,
    })
  }
  const priced = units.filter(u => u.base != null && u.booked != null && u.bookedNights >= 20)
  const off = priced.filter(u => (u.base as number) / (u.booked as number) >= 1.5 || (u.base as number) / (u.booked as number) <= 0.6)
  if (off.length) {
    const ab = off.reduce((s, u) => s + (u.base as number), 0) / off.length, ak = off.reduce((s, u) => s + (u.booked as number), 0) / off.length
    out.push({
      key: 'price',
      label: `${off.length} base price${off.length === 1 ? ' is' : 's are'} far from what nights sell for`,
      note: `${money(ab)} base against ${money(ak)} booked on average. Review them in Base prices above.`,
    })
  }
  const groups = new Map<string, { n: number; reviews: number; sample: any }>()
  for (const u of units) { const k = typeKey(u); const g = groups.get(k) || { n: 0, reviews: 0, sample: u }; g.n++; g.reviews += u.reviewCount; groups.set(k, g) }
  const big = Array.from(groups.values()).filter(g => g.n >= 5).sort((a, b) => b.n - a.n).slice(0, 3)
  if (big.length) {
    out.push({
      key: 'types',
      label: big.map(g => `${g.n} ${typeLabel(g.sample, true)}`).join(' · '),
      note: `The same on paper, so candidates for one room-type listing each (${big.map(g => g.reviews + ' reviews pooled').join(', ')}). Views and layouts need a look first; reviews do not move onto a new listing.`,
    })
  }
  return out
}

/**
 * THE BUILDING'S HOUSE STYLE (Jon, 2026-11-18: "building should have similar titles, similar look and
 * sound. Nothing should be vastly different."). What the writer is shown before it writes one unit:
 * how the other live units in the building are titled, and the full copy of the one optimized most
 * recently, as the reference to stay close to.
 */
export async function buildingStyle(sb: any, listing: any): Promise<{ otherTitles: string[]; reference: Record<string, string> | null } | null> {
  const building = String(listing?.building || '').trim()
  if (!building) return null
  try {
    const { data } = await sb.from('guesty_listings')
      .select('id,title,status,last_optimized,active:raw->>active,pd:raw->publicDescription')
      .eq('building', building).limit(300)
    const rows = ((data || []) as any[]).filter(r => String(r.id) !== String(listing.id) && String(r.active) !== 'false'
      && !/inactive|archiv|deleted|offboard/i.test(String(r.status || '')) && String(r.title || '').trim())
    if (!rows.length) return null
    const otherTitles = Array.from(new Set(rows.map(r => String(r.title).trim()))).slice(0, 12)
    const ref = rows.filter(r => r.last_optimized && String(r.pd?.summary || '').length > 120)
      .sort((a, b) => String(b.last_optimized).localeCompare(String(a.last_optimized)))[0]
    const cut = (v: any, n: number) => String(v || '').trim().slice(0, n)
    const reference = ref ? {
      title: String(ref.title).trim(), summary: cut(ref.pd?.summary, 700), space: cut(ref.pd?.space, 900),
      access: cut(ref.pd?.access, 900), neighborhood: cut(ref.pd?.neighborhood, 1500), transit: cut(ref.pd?.transit, 900), notes: cut(ref.pd?.notes, 1200),
    } : null
    return { otherTitles, reference }
  } catch { return null }
}

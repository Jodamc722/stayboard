// THE LINEN PACKAGE SLIDE, FROM THE DATA (Jon, 2026-09-30: "This should also populate into the
// onboarding conversation as well as a potential slide").
//
// The owner onboarding deck is generated from Guesty listings; the linen desk keeps its numbers in
// app_settings. This reads both and hands lib/linens.ts linenDeckSection the units, so the arithmetic
// on the slide is the same arithmetic the linen page shows and the test checks.
//
// WHERE A UNIT'S BEDS COME FROM, first hit wins — the onboarding walk beats the listing, as it does for
// the rest of the deck (it is the only place that knows what is actually in the unit):
//   1. beds saved on the linen page for the listing, then for its onboarding link
//   2. the onboarding walk's pre-form (onboarding_units.details)
//   3. Guesty's listing rooms (raw.listingRooms)
//   4. one Queen per bedroom
// Bathrooms and guests: the walk's pre-form, else the listing. The tier highlighted is the one picked
// for the unit's onboarding link (app_settings.linen_quotes).
//
// Returns null — and the deck has no linen slide — when there is no saved standard or no tier has a
// single price: a slide of blank prices tells an owner nothing.
import 'server-only'
import { getSetting } from './app-settings'
import {
  LINEN_STANDARD_KEY, LINEN_UNIT_BEDS_KEY, LINEN_QUOTES_KEY, normLinenStandard, normLinenQuotes, resolveLinenUnit,
  assumedBeds, linenDeckSection, type LinenDeckSection, type LinenTier, type LinenUnit, type BedsSource,
} from './linens'

const pos = (v: any) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0 }

/** `listings`: guesty_listings rows with id, nickname/title, bedrooms, bathrooms, max_occupancy and raw. */
export async function linenDeckFor(db: any, listings: any[]): Promise<LinenDeckSection | null> {
  if (!Array.isArray(listings) || !listings.length) return null
  const ids = listings.map(l => String(l.id))
  const [stdRaw, bedsRaw, quotesRaw, walks] = await Promise.all([
    getSetting<any>(LINEN_STANDARD_KEY, null),
    getSetting<any>(LINEN_UNIT_BEDS_KEY, null),
    getSetting<any>(LINEN_QUOTES_KEY, null),
    // A deck covers a handful of listings, each with at most a walk or two.
    Promise.resolve(db.from('onboarding_units').select('code,details,listing_id,status').in('listing_id', ids).neq('status', 'archived').limit(200))
      .then((r: any) => (r && !r.error && Array.isArray(r.data) ? r.data : []), () => []),
  ])
  if (!stdRaw) return null
  const standard = normLinenStandard(stdRaw)
  const saved: Record<string, any> = bedsRaw && typeof bedsRaw === 'object' && !Array.isArray(bedsRaw) ? bedsRaw : {}
  const quotes = normLinenQuotes(quotesRaw)

  let chosen: LinenTier | null = null
  const units: LinenUnit[] = listings.map(l => {
    const id = String(l.id)
    const walk: any = (walks as any[]).find(w => String(w.listing_id) === id) || null
    const code = walk ? String(walk.code || '').toLowerCase() : ''
    const d = walk && walk.details && typeof walk.details === 'object' ? walk.details : {}
    if (!chosen && code && quotes[code]) chosen = quotes[code].tier
    const u = resolveLinenUnit(walk, l, saved)
    return { ...u, id }
  })
  return linenDeckSection(standard, units, chosen)
}

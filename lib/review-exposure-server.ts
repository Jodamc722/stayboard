// PULLING THE REVIEW FACTS FOR ONE UNIT, ON ONE CHANNEL.
//
// Split from lib/review-exposure.ts so the arithmetic stays client-safe: the training page and the
// scenario library run the same exposureFor() in the browser, and only this half touches the
// database. Same pattern as lib/ota-playbook / lib/ota-playbook-server.
//
// TWO THINGS THIS GETS RIGHT THAT A NAIVE COUNT WOULD NOT:
//
//   1. REMOVED REVIEWS DO NOT COUNT. `excluded_from_score` exists because a channel can pull a
//      review and never tell us (see the 2026-09-22 work on removed reviews). Counting one we know
//      is gone would model damage to a score that no longer includes it.
//   2. THE CHANNEL IS THE UNIT OF EXPOSURE, not the listing. An Airbnb complaint threatens the
//      Airbnb average; the Vrbo reviews on the same unit are irrelevant to it and averaging them
//      together would flatter a fragile Airbnb listing with a pile of healthy Vrbo scores.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { exposureFor, type Exposure, type ReviewFacts } from './review-exposure'

/** Reviews and reservations name the same channel differently ('airbnb2', 'bookingCom', 'Vrbo'). */
function family(v: any): string {
  const s = String(v || '').toLowerCase()
  if (/airbnb/.test(s)) return 'airbnb'
  if (/vrbo|homeaway/.test(s)) return 'vrbo'
  if (/booking/.test(s)) return 'booking'
  if (/expedia|hotels\.com|travelocity|orbitz|egencia|marriott/.test(s)) return 'expedia'
  if (/be-?api|website|direct|manual|owner/.test(s)) return 'direct'
  return s || 'unknown'
}

const YEAR_MS = 365 * 86400000

export async function reviewFactsFor(listingId: string, channel: string): Promise<ReviewFacts> {
  const fam = family(channel)
  const facts: ReviewFacts = { count: 0, average: null, recent: [], lastYear: 0, channel: String(channel || '') }
  const id = String(listingId || '').trim()
  if (!id) return facts
  try {
    const { data } = await supabaseAdmin().from('guesty_reviews')
      .select('rating,channel,created_at,excluded_from_score')
      .eq('listing_id', id)
      .eq('excluded_from_score', false)
      .order('created_at', { ascending: false })
      .limit(600)
    const rows = ((data as any[]) || [])
      .filter(r => family(r.channel) === fam)
      .filter(r => Number.isFinite(Number(r.rating)))
    if (!rows.length) return facts
    const ratings = rows.map(r => Number(r.rating))
    facts.count = ratings.length
    facts.average = Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
    facts.recent = rows.slice(0, 5).map(r => ({ rating: Number(r.rating), at: r.created_at ? String(r.created_at) : null }))
    const cut = Date.now() - YEAR_MS
    facts.lastYear = rows.filter(r => r.created_at && Date.parse(String(r.created_at)) >= cut).length
  } catch { /* no review table, no exposure — the advisor still works, it just says so */ }
  return facts
}

/** The whole thing: facts plus the scored exposure. Null when we cannot say anything honest. */
export async function exposureForListing(listingId: string, channel: string): Promise<{ facts: ReviewFacts; exposure: Exposure } | null> {
  const id = String(listingId || '').trim()
  if (!id) return null
  const facts = await reviewFactsFor(id, channel)
  return { facts, exposure: exposureFor(facts) }
}

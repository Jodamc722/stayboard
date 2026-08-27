// THE FACTS WE ALREADY KNEW AND NEVER TOLD THE COPYWRITER.
//
// Jon, 2026-08-27: "want to do a retrain of the optimize content training and make it better than it
// is." The prompt was not the main problem. The grounding was.
//
// ── THE DIAGNOSIS ───────────────────────────────────────────────────────────────────────────────
// The listing copywriter is given the unit's amenities, its booking settings, a lat/lng, and a city
// name. It is then told, correctly and emphatically, never to invent a distance, a restaurant, or a
// drive time. Those two facts together mean it CANNOT write a specific neighbourhood section — it
// has nothing specific to say and is forbidden from guessing. So it writes the only thing left:
// "moments from world-class dining and pristine beaches." Every unit. Every run.
//
// Meanwhile lib/welcome-call-guide.ts has held, hand-written and human-verified, for thirteen
// buildings: the real area name, the real parking situation, the actual restaurants, the grocery
// store people walk to, and the distance to the beach —
//
//     17 West   "South Beach ~10-min walk east" · "Trader Joe's + Fresh Market on West Ave (walk)"
//     Botanica  "Directly across A1A - beach is steps away"
//     The Elser "The free Metromover loop is right outside" · "Not walkable - South Beach ~15-min drive"
//
// That is exactly the copy the model was told it could never write. It was one import away.
//
// ── WHY THIS IS SAFE ────────────────────────────────────────────────────────────────────────────
// The honesty rule is not being relaxed; it is being GIVEN A SOURCE. The model still may not invent.
// It may now state these things because a human wrote them down and stands behind them. Everything
// here is operator-maintained content, not model output — which is the whole difference between
// grounding and hallucination.
//
// It also fixes a real falsehood. The route carried a blanket rule that no unit has a garage, while
// this same file records a secured garage on site at 17 West and an on-site garage at Botanica. A
// hardcoded, un-editable line was suppressing a genuine booking-driver on two buildings.
import 'server-only'
import { buildingGuideFor, type BuildingGuide } from './welcome-call-guide'
import { getSetting } from './app-settings'

export type BuildingFacts = {
  building: string
  /** The neighbourhood as a person would say it, not as an address parser would. */
  area: string
  parking: string | null
  /** Named places a human has verified. The model may state these specifically. */
  food: string[]
  coffee: string | null
  grocery: string | null
  /** The single most valuable line for conversion: how far the beach actually is. */
  beach: string | null
  /** The "what nobody tells you" line — usually the strongest neighbourhood sentence available. */
  tip: string | null
  /** Building amenities from the guest guidebook: pools, shuttles, gym, e-bikes. */
  amenities: string[]
  /** On-site venues (restaurant, bar, spa) where the guidebook records them. */
  venues: string[]
}

const clean = (v: any): string => String(v || '').replace(/\s+/g, ' ').trim()
// The welcome-call copy is written for a phone call, so it carries instructions to the AGENT
// ("confirm they have the fob", "tell them to pull up to..."). Those are notes to staff, not facts
// about the property, and they must not reach guest-facing copy.
const AGENT_INSTRUCTION = /^(confirm|tell them|walk them|note it|make sure|ask (them|if)|check (they|that)|remind them)\b/i
const factOnly = (v: any): string => {
  // Split into sentences AND on the dash the guide uses for asides, then keep only the clauses that
  // state a fact about the property. Verified live against the real pack: The Elser's parking reads
  // "Valet / on-site garage (paid). Tell them to pull up to the tower entrance." — the dash rule
  // alone left the second sentence in, and "tell them to pull up" would have shipped to Airbnb.
  const parts = clean(v).split(/(?<=\.)\s+|\s*[-–—]\s+/)
  const kept = parts.map(x => clean(x)).filter(x => x && !AGENT_INSTRUCTION.test(x))
  return clean(kept.join(' ')).replace(/[.;,]\s*$/, '')
}

/**
 * The verified fact pack for a listing, or null when we have nothing hand-written for its building.
 *
 * Null is a perfectly good answer: a building nobody has written up gets the old behaviour, and the
 * copy stays general rather than inventing. This must never fall back to guessing.
 */
export async function buildingFactsFor(opts: {
  building?: string | null
  nickname?: string | null
  title?: string | null
}): Promise<BuildingFacts | null> {
  const probe = [opts.building, opts.nickname, opts.title].filter(Boolean).join(' ')
  const g: BuildingGuide | null = buildingGuideFor(probe)
  if (!g) return null

  const out: BuildingFacts = {
    building: clean(g.name),
    area: clean(g.area),
    parking: factOnly(g.parking) || null,
    food: (g.recs?.food || []).map(clean).filter(Boolean).slice(0, 5),
    coffee: clean(g.recs?.coffee) || null,
    grocery: clean(g.recs?.grocery) || null,
    beach: clean(g.recs?.beach) || null,
    tip: clean(g.recs?.tip) || null,
    amenities: [],
    venues: [],
  }

  // The guest guidebook, where one has been written, carries the building's own amenities —
  // "3 outdoor pools", "Complimentary e-bikes", "EV shuttle to the beach". Those are booking
  // drivers that never appear on a unit's Guesty amenity list because they belong to the building.
  try {
    const slug = g.key
    const guide = await getSetting<any>('guide:' + slug, null)
    if (guide && typeof guide === 'object') {
      const chips = Array.isArray(guide.chips) ? guide.chips : []
      out.amenities = chips.map(clean).filter(Boolean).slice(0, 10)
      const venues = Array.isArray(guide.venues) ? guide.venues : []
      out.venues = venues.map((v: any) => clean(typeof v === 'string' ? v : v?.name)).filter(Boolean).slice(0, 8)
    }
  } catch { /* the hand-written pack still stands on its own */ }

  return out
}

/**
 * The fact pack as a prompt block, or '' when there is nothing verified for this building.
 *
 * Written as a permission, not as data. The model has just been told in the strongest terms never to
 * name a place it is not certain of; unless something explicitly lifts that for these lines, it will
 * hedge them into "moments from great dining" exactly as before.
 */
export function factsPrompt(f: BuildingFacts | null): string {
  if (!f) return ''
  const L: string[] = []
  L.push(`VERIFIED BUILDING FACTS — ${f.building}`)
  L.push('These were written and checked by Stay Hospitality staff. Unlike everything else, you MAY state')
  L.push('these specifically, by name and by distance, because a human stands behind them. Use them —')
  L.push('this is what makes the Neighborhood and Getting-around sections worth reading. Do not embellish')
  L.push('them, do not add places that are not listed here, and do not turn a walk into a stroll.')
  if (f.area) L.push(`- Area: ${f.area}`)
  if (f.beach) L.push(`- Beach: ${f.beach}`)
  if (f.parking) L.push(`- Parking: ${f.parking} (describe it accurately — if it says garage, it is a garage)`)
  if (f.food.length) L.push(`- Restaurants guests actually go to: ${f.food.join(', ')}`)
  if (f.coffee) L.push(`- Coffee: ${f.coffee}`)
  if (f.grocery) L.push(`- Grocery: ${f.grocery}`)
  if (f.tip) L.push(`- What locals know: ${f.tip}`)
  if (f.amenities.length) L.push(`- Building amenities: ${f.amenities.join(', ')}`)
  if (f.venues.length) L.push(`- On site: ${f.venues.join(', ')}`)
  return L.join('\n')
}

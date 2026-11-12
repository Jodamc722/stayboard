import type { AreaKey } from './ad-places'
// The marketing calendar behind Ad Studio's "Coming up" (Jon, 2026-11-04: "have a smart calendar feature that is
// aware of upcoming dates and makes suggestions"). Client-safe, no imports.
//
// Each moment carries: when it is, who the piece is for, which look suits it, the headline a flyer opens on, and
// the brief the video writer gets. Dates marked `approx` are the usual window, not a confirmed date — the studio
// says so on the card. Confirmed 2026–27 dates were checked on 2026-11-04 (Art Basel 4–6 Dec 2026; Miami Boat
// Show 10–14 Feb 2027; Ultra 26–28 Mar 2027; Miami Open 14–28 Mar 2027; SOBEWFF 25–28 Feb 2027).

export type Moment = {
  key: string
  name: string
  /** ISO dates, inclusive. */
  start: string
  end: string
  approx?: boolean
  /** Who the piece speaks to. */
  audience: 'guests' | 'owners' | 'both'
  /** Which curated look suits it (LOOKS key). */
  look: string
  /** How far ahead the piece should go out, in days. */
  lead: number
  /** The flyer / post opening line. **gold** marks the accent word. */
  headline: string
  sub: string
  /** The brief the video writer gets (property name is filled in by the studio). */
  brief: string
  /** Photo search words for the library. */
  photo: string
  /** Where it happens — photos come from our listings in these areas first (lib/ad-places). Missing = anywhere. */
  where?: AreaKey[]
  emoji: string
  /** Themed visuals (FX keys) a piece for this moment gets, and a music track that fits. */
  fx?: string[]
  music?: string
  /** Poster style for a flyer/post: dark · gallery · neon · band (otherwise the look decides). */
  poster?: string
  /** A real EVENT (a fair, a festival, a race, a show) rather than a season or holiday — it gets "Make the event ad"
   *  (lib/ad-event: the event · things to do · book your Stay). 2026-11-12. */
  event?: boolean
  /** The event's vibe for its AI images: GENERIC pictures — never the event's name, logo, stage, branding or a real
   *  person (lib/ad-image-prompt adds the rules). First = the opener. */
  vibe?: string[]
  /** Stock-photo search words for the same vibe (used when AI images are off). */
  vibeStock?: string
}

export const MOMENTS: Moment[] = [
  { key: 'thanksgiving', name: 'Thanksgiving week', start: '2026-11-23', end: '2026-11-29', audience: 'guests', look: 'harvest', lead: 21, headline: 'Thanksgiving, **by the water.**', sub: 'A full kitchen, room for everyone, the beach after dinner', brief: 'A guest ad for Thanksgiving week in South Florida: families, a full kitchen, space for everyone, warm weather while it is cold at home. End on Book at stay-hospitality.com.', photo: 'kitchen', emoji: '🍂', fx: ['leaves'], music: 'carefree', poster: 'band' },
  { key: 'basel', event: true, vibe: ['an airy contemporary art fair hall with white walls, large abstract colourful canvases and an original sculpture, a few anonymous visitors softly out of focus, afternoon light through tall windows', 'a stylish beachfront avenue at dusk, palm trees and pastel Art Deco facades glowing, people heading out to dinner'], vibeStock: 'contemporary art gallery', where: ['miami-beach', 'miami'], name: 'Art Basel Miami Beach', start: '2026-12-04', end: '2026-12-06', audience: 'both', look: 'editorial', lead: 35, headline: 'Art Basel, **steps from it all.**', sub: 'Dec 4–6 · Miami Beach and downtown stays', brief: 'A guest ad for Art Basel week (December 4–6) in Miami: downtown and Miami Beach apartments, the city at night, the fairs by day. Editorial, calm. End on Book at stay-hospitality.com.', photo: 'city view', emoji: '🎨', fx: ['frame'], music: 'ultralounge', poster: 'gallery' },
  { key: 'basel-owners', name: 'Priced for the big dates (owners)', start: '2026-11-10', end: '2026-12-06', audience: 'owners', look: 'house', lead: 0, headline: 'The big dates are **priced months ahead.**', sub: 'Art Basel, New Year’s Eve, the boat shows, Formula 1', brief: 'An owner ad about how Stay prices the high-demand dates months ahead — Art Basel, New Year’s Eve, the boat shows, Formula 1 Miami — reviewed every day against the competitive set. End on Nick’s contact card.', photo: 'rooftop pool', emoji: '📈', fx: ['grid'], music: 'crypto', poster: 'band' },
  { key: 'christmas', name: 'Christmas', start: '2026-12-20', end: '2026-12-26', audience: 'both', look: 'holiday', lead: 30, headline: 'Christmas in **the sun.**', sub: 'Pool mornings, warm nights, the whole family in one place', brief: 'A guest ad for Christmas week in South Florida: warm weather, the pool, a real apartment for the whole family, the beach on Christmas morning. Festive but elegant. End on Book at stay-hospitality.com.', photo: 'pool', emoji: '🎄', fx: ['lights', 'tree', 'snow'], music: 'jingle' },
  { key: 'owners-thanks', name: 'Year-end thank-you to owners', start: '2026-12-15', end: '2026-12-31', audience: 'owners', look: 'holiday', lead: 7, headline: 'Thank you for **a great year.**', sub: 'From everyone at Stay Hospitality', brief: 'A short warm year-end thank-you to our owners: the year in numbers (only the house facts), the team, and what is coming in the new year. Ends on Nick’s contact card.', photo: 'lobby', emoji: '🥂', fx: ['tree', 'bokeh'], music: 'sugarplum' },
  { key: 'nye', event: true, vibe: ['fireworks bursting over a bay and a city skyline at midnight, reflections dancing on the water'], vibeStock: 'fireworks city skyline night', where: ['miami', 'miami-beach', 'fort-lauderdale'], name: 'New Year’s Eve', start: '2026-12-31', end: '2027-01-01', audience: 'guests', look: 'champagne', lead: 35, headline: 'Ring it in **on the water.**', sub: 'Fireworks over the bay · Dec 31', brief: 'A guest ad for New Year’s Eve in Miami and Fort Lauderdale: the skyline at night, rooftop pools, fireworks over the bay, then a slow first morning of the year. High energy to calm. End on Book at stay-hospitality.com.', photo: 'skyline night', emoji: '🎆', fx: ['fireworks', 'sparkle'], music: 'glitter' },
  { key: 'winter-sun', name: 'Winter sun season', start: '2026-12-15', end: '2027-03-15', audience: 'guests', look: 'sand', lead: 30, headline: 'Escape **winter.**', sub: 'It is 78° here · December to March', brief: 'A guest ad for winter-sun travellers (December to March): leave the cold, wake up to the pool, the beach and 78 degrees, monthly stays welcome. Calm, warm. End on Book at stay-hospitality.com.', photo: 'beach', emoji: '☀️', fx: ['rays'], music: 'beachfront' },
  { key: 'new-year-owners', name: 'New year, new listing (owners)', start: '2027-01-04', end: '2027-01-31', audience: 'owners', look: 'house', lead: 0, headline: 'New year, **new photos.**', sub: 'Every listing refreshed every three months', brief: 'An owner ad for January: the new year is when we refresh every listing — photos first, copy that sells, amenities audited against every channel. Owners who switch earn more. End on Nick’s contact card.', photo: 'living room', emoji: '✨', fx: ['grid'], music: 'crypto', poster: 'band' },
  { key: 'mlk', name: 'MLK long weekend', start: '2027-01-16', end: '2027-01-18', audience: 'guests', look: 'miami', lead: 21, headline: 'Three days **in the sun.**', sub: 'Jan 16–18 · long-weekend stays', brief: 'A guest ad for the MLK long weekend in South Florida: three days of sun, the pool, the beach, dinner out. Quick and bright. End on Book at stay-hospitality.com.', photo: 'pool', emoji: '🌴', fx: ['rays'], music: 'carefree' },
  { key: 'marathon', event: true, vibe: ['runners at sunrise crossing a long causeway bridge over turquoise water, a city skyline behind, an anonymous crowd seen from behind'], vibeStock: 'marathon runners city sunrise', where: ['miami'], name: 'Miami Marathon', start: '2027-02-07', end: '2027-02-07', approx: true, audience: 'guests', look: 'fresh', lead: 30, headline: 'Run Miami. **Recover here.**', sub: 'Early February · downtown stays near the start', brief: 'A guest ad for Miami Marathon weekend: downtown apartments near the start line, a quiet place to rest, the pool after the race. End on Book at stay-hospitality.com.', photo: 'city view', emoji: '🏃', fx: ['corners'], music: 'cheery', poster: 'band' },
  { key: 'boat-show-miami', event: true, vibe: ['rows of gleaming white luxury yachts moored at a marina in bright sun, turquoise water, palm trees and a city skyline', 'the deck of a sleek motor yacht cruising across a sparkling bay at golden hour, its wake trailing behind'], vibeStock: 'luxury yachts marina', where: ['miami-beach', 'miami'], name: 'Miami International Boat Show', start: '2027-02-10', end: '2027-02-14', audience: 'both', look: 'nautical', lead: 45, headline: 'Boat show week, **on the water.**', sub: 'Feb 10–14 · Miami Beach and downtown', brief: 'A guest ad for the Miami International Boat Show (February 10–14): stays by the marina and downtown, the bay, the boats, dinner on the water. End on Book at stay-hospitality.com.', photo: 'marina', emoji: '⛵', fx: ['rope', 'waves'], music: 'docks' },
  { key: 'valentines', name: 'Valentine’s weekend', start: '2027-02-12', end: '2027-02-14', audience: 'guests', look: 'rose', lead: 21, headline: 'A weekend **for two.**', sub: 'Feb 12–14 · sunsets, rooftops, the beach', brief: 'A guest ad for Valentine’s weekend: a couple’s escape — sunset from the balcony, the rooftop pool, dinner out, a slow morning. Romantic, elegant. End on Book at stay-hospitality.com.', photo: 'sunset', emoji: '❤️', fx: ['hearts', 'bokeh'], music: 'smooth' },
  { key: 'sobewff', event: true, vibe: ['a white-tented tasting event on the beach at golden hour, chef-plated small dishes and glasses of wine on a long table, the ocean behind, anonymous guests out of focus'], vibeStock: 'food wine tasting beach', where: ['miami-beach'], name: 'South Beach Wine & Food Festival', start: '2027-02-25', end: '2027-02-28', audience: 'guests', look: 'editorial', lead: 30, headline: 'Eat your way **through Miami.**', sub: 'Feb 25–28 · stays steps from the tents', brief: 'A guest ad for the South Beach Wine & Food Festival (February 25–28): Miami Beach stays, the restaurants, the beach between events. End on Book at stay-hospitality.com.', photo: 'dining', emoji: '🍷', fx: ['frame'], music: 'bossa', poster: 'gallery' },
  { key: 'spring-break', where: ['miami-beach', 'miami', 'fort-lauderdale'], name: 'Spring break', start: '2027-03-01', end: '2027-04-11', audience: 'guests', look: 'miami', lead: 30, headline: 'Spring break, **done right.**', sub: 'March · the pool, the beach, the city', brief: 'A guest ad for spring break in Miami and Fort Lauderdale: the pool, the beach, the nightlife, a real apartment to come back to. High energy. End on Book at stay-hospitality.com.', photo: 'pool', emoji: '🏖️', fx: ['sparkle'], music: 'pamgaea' },
  { key: 'miami-open', event: true, vibe: ['a professional hard tennis court under bright tropical sun, a player mid-serve seen from behind at a distance, palm trees beyond the stands'], vibeStock: 'tennis court sunny palm trees', where: ['miami', 'miami-beach'], name: 'Miami Open', start: '2027-03-14', end: '2027-03-28', audience: 'guests', look: 'fresh', lead: 30, headline: 'Match point **in Miami.**', sub: 'Mar 14–28 · Hard Rock Stadium', brief: 'A guest ad for the Miami Open (March 14–28): stays across Miami, the tennis by day, the city by night. Clean, bright. End on Book at stay-hospitality.com.', photo: 'city view', emoji: '🎾', fx: ['corners'], music: 'hidden', poster: 'band' },
  { key: 'ultra', event: true, vibe: ['a waterfront electronic music festival at night, lasers and light beams sweeping over the bay, a huge crowd silhouetted with hands in the air, a city skyline lit behind', 'confetti and colourful light over a dancing crowd at night seen from above, energetic and joyful'], vibeStock: 'music festival lasers night crowd', where: ['miami'], name: 'Ultra Music Festival', start: '2027-03-26', end: '2027-03-28', audience: 'guests', look: 'festival', lead: 45, headline: 'Ultra weekend. **Stay downtown.**', sub: 'Mar 26–28 · Bayfront Park · walk to the gates', brief: 'A guest ad for Ultra Music Festival (March 26–28): downtown Miami apartments within walking distance of Bayfront Park, groups welcome, the skyline at night, the pool the morning after. Loud, neon, fast. End on Book at stay-hospitality.com.', photo: 'skyline night', emoji: '🎧', fx: ['eq', 'grid'], music: 'electrodoodle' },
  { key: 'easter', name: 'Easter weekend', start: '2027-03-26', end: '2027-03-29', audience: 'guests', look: 'sand', lead: 21, headline: 'Easter **by the sea.**', sub: 'Mar 26–29 · family stays', brief: 'A guest ad for Easter weekend: families, a full apartment, the beach and the pool. Warm and calm. End on Book at stay-hospitality.com.', photo: 'beach', emoji: '🐣', fx: ['bokeh'], music: 'dreamer' },
  { key: 'f1', event: true, vibe: ['a sleek unbranded open-wheel race car blurring past on a sunny street circuit, strong motion blur, grandstands soft in the background', 'a rooftop pool party at sunset overlooking a city skyline on race weekend, anonymous guests'], vibeStock: 'race car motion blur', where: ['miami', 'miami-beach'], name: 'Formula 1 Miami Grand Prix', start: '2027-05-07', end: '2027-05-09', approx: true, audience: 'both', look: 'festival', lead: 60, headline: 'Race week, **Miami.**', sub: 'Early May · Hard Rock Stadium', brief: 'A guest ad for Formula 1 Miami Grand Prix week (early May): stays across Miami and Fort Lauderdale, the race by day, the city by night. Fast, premium. End on Book at stay-hospitality.com.', photo: 'skyline', emoji: '🏎️', fx: ['scan', 'glowline'], music: 'impact' },
  { key: 'memorial', name: 'Memorial Day weekend', start: '2027-05-29', end: '2027-05-31', audience: 'guests', look: 'miami', lead: 21, headline: 'Summer **starts here.**', sub: 'May 29–31 · long-weekend stays', brief: 'A guest ad for Memorial Day weekend: the first long weekend of summer, the pool, the beach, the boats. Bright. End on Book at stay-hospitality.com.', photo: 'pool', emoji: '🇺🇸', fx: ['waves'], music: 'beachfront' },
  { key: 'july4', event: true, vibe: ['fireworks over a marina and palm trees on a warm summer night, reflections on the water'], vibeStock: 'fireworks marina night', name: 'Fourth of July', start: '2027-07-03', end: '2027-07-05', audience: 'guests', look: 'usa', lead: 21, headline: 'Fireworks **over the bay.**', sub: 'July 4 · waterfront stays', brief: 'A guest ad for the Fourth of July in South Florida: fireworks over the bay, the pool all day, a real apartment for the group. End on Book at stay-hospitality.com.', photo: 'marina', emoji: '🎇', fx: ['fireworks'], music: 'glitter' },
  { key: 'labor', name: 'Labor Day weekend', start: '2027-09-04', end: '2027-09-06', audience: 'guests', look: 'sand', lead: 21, headline: 'One more **summer weekend.**', sub: 'Sep 4–6', brief: 'A guest ad for Labor Day weekend: the last long weekend of summer, the beach, the pool, warm nights. End on Book at stay-hospitality.com.', photo: 'beach', emoji: '🌅', fx: ['waves'], music: 'carefree' },
  { key: 'flibs', event: true, vibe: ['luxury yachts lining a palm-fringed canal and marina in bright sun, turquoise water, waterfront homes behind'], vibeStock: 'yachts marina canal', where: ['fort-lauderdale'], name: 'Fort Lauderdale International Boat Show', start: '2027-10-27', end: '2027-10-31', approx: true, audience: 'both', look: 'nautical', lead: 45, headline: 'Boat show week, **Fort Lauderdale.**', sub: 'Late October · stays by the marina', brief: 'A guest ad for the Fort Lauderdale International Boat Show (late October): stays near the marina and Las Olas, the boats by day, dinner on the water. End on Book at stay-hospitality.com.', photo: 'marina', emoji: '🛥️', fx: ['rope', 'waves'], music: 'docks' },
  { key: 'halloween', where: ['miami', 'miami-beach'], name: 'Halloween weekend', start: '2027-10-29', end: '2027-10-31', audience: 'guests', look: 'spooky', lead: 14, headline: 'Halloween **in the city.**', sub: 'Oct 29–31', brief: 'A guest ad for Halloween weekend in Miami: the city at night, rooftop parties, a place to come back to. Dark, playful. End on Book at stay-hospitality.com.', photo: 'skyline night', emoji: '🎃', fx: ['scan'], music: 'macabre' },
]

const day = (iso: string) => new Date(iso + 'T12:00:00')
const DAY = 86400000

/** What to post now: moments whose posting window (start − lead) has opened and that have not ended, nearest first. */
export function comingUp(today = new Date(), limit = 8): (Moment & { daysTo: number; open: boolean })[] {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime()
  return MOMENTS
    .map(m => { const s = day(m.start).getTime(), e = day(m.end).getTime(); return { ...m, daysTo: Math.round((s - t0) / DAY), open: t0 >= s - m.lead * DAY && t0 <= e } })
    .filter(m => day(m.end).getTime() >= t0)
    .sort((a, b) => (Number(b.open) - Number(a.open)) || a.daysTo - b.daysTo)
    .slice(0, limit)
}

export function whenLabel(m: Moment): string {
  const f = (iso: string) => day(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const same = m.start === m.end
  return (same ? f(m.start) : f(m.start) + ' – ' + f(m.end)) + (m.approx ? ' · dates to confirm' : '')
}

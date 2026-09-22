// WHAT THE GUESTS ACTUALLY SAID, AND WHAT WE ARE GOING TO DO ABOUT IT.
//
// Jon, 2026-09-22: "should show recomdations based on guest feedback and how we can improve that."
//
// The review already had a Guest Voices section, and what it carried were three themes whose
// actions read like "We run departure checklists and pre-arrival inspections on every turn" — true
// sentences about how we always operate, generated once and then repeated. An owner reading that
// learns nothing, and worse, learns that this part of the report is decoration.
//
// So this is built the other way round: from the actual review text, deterministically.
// lib/review-themes already holds the complaint taxonomy the cleaner's task and the inspection
// board share — a regex, an owner and an action per theme — and it already knows how to decide
// whether a mention is a complaint rather than a compliment (looksNegative) and how to pull just
// the sentence that mentions it (sentenceAbout). That taxonomy is the honest source: a theme
// appears on this slide because guests raised it in writing, with a count and a quote behind it.
//
// NO MODEL CALL. The same reasons as the verdict: it runs on every existing report with no
// regeneration, it costs nothing, and it cannot invent a complaint that nobody made.
//
// THE ACTIONS ARE REWRITTEN FOR THE OWNER. review-themes' action text is addressed to whoever is
// standing in the unit holding a phone ("Go slower on surfaces, floors, under and behind
// furniture"). Handing that to an owner as our plan reads like a leaked work order, so each theme
// carries a second line here written in the voice the rest of the report uses.
import 'server-only'
import { pullReviews } from '@/lib/owner-report'
import { THEMES, looksNegative, sentenceAbout } from '@/lib/review-themes'

// THE SAFETY RULE THIS SLIDE HAS TO OBEY TOO.
//
// Every AI-written word in an owner report runs under one standing instruction (see
// app/api/reports/generate and ai-edit): "Never admit fault or liability, never mention
// pests/bed bugs/security incidents, never disparage a guest." This slide is deterministic, so it
// never passes through the model that enforces that — which meant the first version was free to do
// precisely what the paragraph beside it is forbidden from doing.
//
// Two consequences, both deliberate:
//
//   PESTS AND SECURITY ARE OFF THIS SLIDE. Not softened, off. They are handled directly with the
//   owner, not discovered in a performance report. If Jon wants them here, it is a one-line change
//   and a decision he should make knowingly rather than one this code makes for him.
//
//   QUOTES ARE SCREENED. The first live run pulled, verbatim, "I have photo's of a piss stain on
//   the 'clean bed'." That is the single most useful sentence in the whole dataset and it is not
//   something a tool should place in a client document unattended. The theme, the count and the
//   recommendation all survive; the sentence falls back to another guest's, or to none.
// WHO CAUSED IT DECIDES WHETHER IT PRINTS (Jon, 2026-09-22: "you can mention real issue related
// to building, pests are building issues, thats fine, lets not highlight any issue casued by us,
// without my approval").
//
// My first pass had this exactly backwards: it hid pests, which are a BUILDING problem an owner is
// entitled to know about, and printed cleanliness, which is OURS. Those are opposite kinds of fact.
// A building issue is information the owner needs and nobody at Stay has to answer for. A failure
// of our own is a conversation Jon has with the owner in his own words, on his own timing — not
// something a report volunteers on his behalf while he is not in the room.
//
//   building — the building, the street, the neighbours, pests. Prints.
//   asset    — the owner's own furniture and beds wearing out. Prints; it is a spend recommendation.
//   ours     — our cleaning, our stocking, our maintenance, our tech. WITHHELD until Jon says so,
//              per report, from edit mode. He sees them; the owner does not until he includes them.
export type Cause = 'building' | 'asset' | 'ours'
const CAUSE: Record<string, Cause> = {
  pests: 'building',
  noise: 'building',
  bed: 'asset',
  furniture: 'asset',
  cleanliness: 'ours',
  smell: 'ours',
  bathroom: 'ours',
  kitchen: 'ours',
  supplies: 'ours',
  ac: 'ours',
  wifi: 'ours',
  // Door codes are ours, the garage and the lobby are the building's. Mixed goes to 'ours',
  // because the cost of withholding something is a conversation and the cost of publishing
  // something we caused is Jon finding out from the owner.
  access: 'ours',
}
const causeOf = (key: string): Cause => CAUSE[key] || 'ours'
const GRAPHIC = /\b(piss|pissed|shit|fuck\w*|cunt|bastard|urine|feces|faeces|poop|vomit|puke|blood|bloody|semen|needle|cockroach|roaches?|bed ?bugs?)\b/i

/** What we tell an OWNER we are doing, per theme. The crew-facing version stays in review-themes. */
const OWNER_ACTION: Record<string, string> = {
  cleanliness: 'Tightening the departure clean on surfaces, floors and under furniture, and re-inspecting this unit before the next arrival.',
  smell: 'Checking drains, bins, the fridge, the washer gasket and the A/C, and airing the unit between stays.',
  bathroom: 'Deep-cleaning grout, glass and drains, and testing the shower and hot water on every turn.',
  kitchen: 'Resetting the kitchen to a full inventory — cookware, utensils and a cleaned fridge — and checking it on inspection.',
  supplies: 'Restocking to par on every turn: towels, linens, toiletries, paper goods and coffee.',
  bed: 'Assessing the mattress, sofa bed and pillows, and pricing replacements for you where they are worn.',
  ac: 'Servicing the unit and confirming it holds temperature, with filters on a standing schedule.',
  wifi: 'Testing the Wi-Fi and the TV sign-in on every inspection, and upgrading the router where it keeps recurring.',
  access: 'Testing the door code, building entry and garage access ourselves before each arrival.',
  noise: 'Identifying the source. Where it is the building or the street, we set the expectation in the listing before guests book rather than let them find it on arrival.',
  furniture: 'Photographing the worn pieces and bringing you a costed replacement list.',
  pests: 'Treating the unit and putting it on a preventative schedule, and raising it with building management where it is coming from common areas.',
}

export type Recommendation = {
  key: string
  label: string
  /** How many separate guests raised it. */
  mentions: number
  /** How many distinct units it came up in. */
  units: number
  /** The average rating of the reviews that raised it — the cost of the theme, in stars. */
  avgRating: number | null
  /** One guest's own sentence. Evidence, not paraphrase. */
  quote: string
  /** What we are doing about it, in the report's voice. */
  action: string
  /** Who this is on. Decides whether it prints without Jon saying so. */
  cause: Cause
}

export type Recommendations = {
  items: Recommendation[]
  /** Reviews read to produce this. */
  reviews: number
  /** Reviews that raised nothing negative — the honest denominator. */
  clean: number
  avgRating: number | null
  from: string
  to: string
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function reportRecommendations(report: any): Promise<Recommendations | null> {
  const ids: string[] = (Array.isArray(report?.listing_ids) ? report.listing_ids : [])
    .map((x: any) => String(x || '')).filter(Boolean)
  const from = String(report?.period_start || '').slice(0, 10)
  const asOf = String(report?.as_of || report?.period_end || '').slice(0, 10)
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null
  // A single month of reviews is a thin sample — a 26-unit building might get a dozen. Reach back
  // ninety days before the period so a recurring theme is visible as recurring, and say so on the
  // slide rather than implying every quote landed inside the reported month.
  const lookback = addDaysIso(from, -90)

  const reviews = await pullReviews(ids, lookback, asOf).catch(() => [])
  if (!reviews.length) return null

  const rated = reviews.filter(r => Number.isFinite(Number(r.rating)))
  const avgRating = rated.length
    ? Math.round((rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length) * 100) / 100
    : null

  const raisedAnything = new Set<number>()
  const items: Recommendation[] = []

  for (const theme of THEMES) {
    let mentions = 0
    const units = new Set<string>()
    const ratings: number[] = []
    let quote = ''
    reviews.forEach((r, i) => {
      const text = String(r.content || '')
      if (!text || !theme.re.test(text)) return
      const sentence = sentenceAbout(text, theme.re)
      // A theme is only a recommendation when the guest was unhappy about it. "The kitchen was
      // beautifully stocked" matches the kitchen regex and is not a thing to improve.
      if (!looksNegative(sentence, Number(r.rating))) return
      mentions++
      raisedAnything.add(i)
      if (r.listing_id) units.add(String(r.listing_id))
      if (Number.isFinite(Number(r.rating))) ratings.push(Number(r.rating))
      // Keep the sentence from the lowest-rated review — the clearest statement of the problem —
      // but never one that cannot go in front of an owner. A theme with no printable sentence still
      // gets its count and its recommendation; it just makes its case without the quote.
      if (GRAPHIC.test(sentence)) return
      if (!quote || (Number.isFinite(Number(r.rating)) && Number(r.rating) <= Math.min(...ratings))) quote = sentence
    })
    if (!mentions) continue
    items.push({
      key: theme.key,
      label: theme.label,
      mentions,
      units: units.size,
      avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null,
      quote,
      action: OWNER_ACTION[theme.key] || theme.action,
      cause: causeOf(theme.key),
    })
  }

  // Most-raised first; a tie goes to the theme that cost us the most stars.
  items.sort((a, b) => (b.mentions - a.mentions) || ((a.avgRating ?? 5) - (b.avgRating ?? 5)))

  return {
    items,
    reviews: reviews.length,
    clean: reviews.length - raisedAnything.size,
    avgRating,
    from: lookback,
    to: asOf,
  }
}

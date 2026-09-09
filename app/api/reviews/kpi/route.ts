// REVIEW KPIs — reputation as an operating metric, not a vanity number.
//
// Design notes, because the choices here are not obvious:
//
// 1. THE AVERAGE IS A WEAK HEADLINE. On Airbnb the working range is roughly 4.6 to 4.9: a listing
//    at 4.6 is in trouble and one at 4.9 is fine, so a single bad month moves the average about
//    0.05 and nobody notices until the ranking drops. FIVE-STAR SHARE moves visibly and early, so
//    it leads; the average sits next to it.
// 2. SMALL SAMPLES LIE. A unit with two 3-star reviews is not the worst unit in the portfolio. Every
//    ranked average is shrunk toward the portfolio mean (score = (C*m + sum) / (C + n), C = 5), and
//    anything under MIN_N is listed separately as "not enough yet" rather than ranked.
// 3. CHANNELS ARE NOT THE SAME SCALE — AND THAT DECIDES MORE THAN DISPLAY. Booking.com scores 1-10
//    and is halved on ingest, which makes the arithmetic honest and every THRESHOLD wrong: a normal
//    Booking 8/10 stored as 4.0 tripped "below 4.5" everywhere. So five-star and low are judged per
//    channel (lib/review-scale), and everything comparative is judged against PAR — the portfolio's
//    own average on that channel in this window. Par needs no invented conversion factor and moves
//    with the portfolio, so "0.30 below par" means the same thing on Booking as on Airbnb.
// 4. NOT EVERY STAR IS OPS. Airbnb category ratings split cleanly: cleanliness and check-in are the
//    field team's, accuracy and value belong to the listing and the price, location nobody can fix.
//    Ops-controllable is separated from the rest so the sheet points at someone who can act.
// 5. A FAILED READ IS NOT A ZERO. Every read here throws rather than returning a short page, and the
//    route answers 500 with a reason. The old version broke out of its paging loop on error and
//    served a confident "4.7 avg · 0 reviews" — the worst possible failure for a page whose whole
//    job is telling you the truth about where you stand.
//
// FILTERS: market · building · OWNER · channel, all applied to the same review set, so the numbers
// on this page and the feed below it can never disagree (Jon, 2026-09-09: "I should be able to
// select by owner, building etc to see reviews").
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf, buildingOf } from '@/lib/segments'
import { setSetting } from '@/lib/app-settings'
import { ratingToStars } from '@/lib/optimize-score'
import { isBookingChannel, isFiveStarReview, isLowReview } from '@/lib/review-scale'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_N = 5           // reviews needed before a unit is ranked
const SHRINK = 5          // strength of the pull toward the portfolio mean
const MIN_TURNS = 10      // cleans needed before a cleaner appears in the coaching view
const MIN_INSP = 5        // walks needed before an inspector is ranked
/** How far below par a unit has to sit before the board calls it out. */
const BELOW_PAR = 0.15

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)
}
function round(n: number, p = 2) { const f = Math.pow(10, p); return Math.round(n * f) / f }

type Agg = { n: number; sum: number; five: number; low: number; dev: number }
const emptyAgg = (): Agg => ({ n: 0, sum: 0, five: 0, low: 0, dev: 0 })
/**
 * Add one review to a bucket. `channel` decides the five-star and low bands (Booking rates on a
 * different scale, see lib/review-scale) and `par` is the portfolio's average on that channel, so
 * `dev` accumulates "how far off our own normal this review was" — comparable across channels.
 */
function push(a: Agg, rating: number, channel: string, par: number) {
  a.n++; a.sum += rating
  if (isFiveStarReview(rating, channel)) a.five++
  if (isLowReview(rating, channel)) a.low++
  a.dev += rating - par
}
// ── THE LIVE LISTING SCORE ──────────────────────────────────────────────────────────────────────
// Guesty exposes NO OTA-published rating field (checked against the live payload 2026-08-06: the
// integrations array carries platform + externalUrl and nothing else). So the score shown per
// channel is the listing's LIFETIME average of every review that channel sent us — the same basis
// the OTA itself publishes — and each one carries the deep link so it can be checked in one click.
//
// Booking.com publishes out of 10 while Guesty normalises to 5, so it is doubled back for display.
// Showing 3.89 next to a Booking page that says 7.8 is the kind of mismatch that costs trust.
const CHANNEL_SCALE10: Record<string, boolean> = { 'Booking.com': true }
const PLATFORM_TO_CHANNEL: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb',
  bookingcom: 'Booking.com', bookingCom: 'Booking.com', booking: 'Booking.com',
  homeaway: 'Vrbo', homeaway2: 'Vrbo', vrbo: 'Vrbo',
  expedia: 'Expedia',
}
function listingUrls(ints: any): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(ints)) return out
  for (const i of ints) {
    const p = String((i && i.platform) || '')
    const ch = PLATFORM_TO_CHANNEL[p] || PLATFORM_TO_CHANNEL[p.toLowerCase()]
    const url = String((i && i.externalUrl) || '')
    if (ch && url && !out[ch]) out[ch] = url
  }
  return out
}

function summarise(a: Agg, mean: number) {
  if (!a.n) return { n: 0, avg: null, fiveShare: null, lowCount: 0, score: null, vsPar: null }
  return {
    n: a.n,
    avg: round(a.sum / a.n),
    fiveShare: round((a.five / a.n) * 100, 1),
    lowCount: a.low,
    // shrunk toward the portfolio mean so a 2-review unit cannot top or bottom a league table
    score: round((SHRINK * mean + a.sum) / (SHRINK + a.n)),
    // AGAINST OUR OWN NORMAL, per channel, shrunk toward 0 for the same reason. This is the number
    // the board ranks on: it is the only one that reads the same on Booking as on Airbnb.
    vsPar: round(a.dev / (SHRINK + a.n)),
  }
}

// Airbnb hands us per-category ratings with the guest's own comment and machine-readable tags.
// Everything the field team can actually act on lives here.
const OPS_CATEGORIES = new Set(['cleanliness', 'checkin', 'check_in', 'communication'])
function categoriesOf(raw: any): { key: string; rating: number; comment: string; tags: string[] }[] {
  const rr = (raw && (raw.rawReview || raw.raw)) || {}
  const arr = rr.category_ratings || rr.categoryRatings || rr.categories
  if (!Array.isArray(arr)) return []
  const out: any[] = []
  for (const c of arr) {
    const key = str(c && (c.category || c.name)).toLowerCase().replace(/\s+/g, '_')
    const rating = Number(c && (c.rating ?? c.value))
    if (!key || !Number.isFinite(rating)) continue
    out.push({
      key, rating,
      comment: str(c && c.comment).slice(0, 200),
      tags: Array.isArray(c && c.review_category_tags) ? c.review_category_tags.map((t: any) => str(t)) : [],
    })
  }
  return out
}
// A tag reads like GUEST_REVIEW_HOST_NEGATIVE_UNEXPECTED_FEES; nobody should have to decode that.
function humanTag(t: string): string {
  return str(t)
    .replace(/^GUEST_REVIEW_HOST_(NEGATIVE|POSITIVE)_/, '')
    .replace(/^CLEANLINESS_/, 'Cleanliness: ')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^(.)/, (m) => m.toUpperCase())
}
// IS THIS TAG A COMPLAINT OR A COMPLIMENT? (Jon 2026-08-09: "why on the review page are some of
// these positives")
//
// It used to be decided by the CATEGORY SCORE alone — anything scored 4 or less had all of its
// tags filed as complaints. But a guest who scores cleanliness 4/5 and tags CLEANLINESS_FREE_OF_
// CLUTTER is praising the unit, and "Free of clutter" and "Responsive host" were being counted as
// things to fix. Worse, humanTag strips the POSITIVE/NEGATIVE marker off the tag before anything
// looks at it, so the one reliable signal was thrown away first.
//
// Order matters: the tag's own polarity is authoritative, then an explicit list of the sub-tags
// Airbnb ships without a marker (CLEANLINESS_*, ACCURACY_* and friends), then null — and only a
// null falls back to the score. Explicit lists beat clever pattern-matching here because
// NOT_HELPFUL contains "helpful" and DID_NOT_MATCH_PHOTOS contains "match".
const POSITIVE_TAGS = new Set([
  'FREE_OF_CLUTTER', 'SPOTLESS', 'FRESH_LINENS', 'SMELLED_GREAT', 'WELL_MAINTAINED',
  'RESPONSIVE_HOST', 'HELPFUL', 'QUICK_RESPONSES', 'GREAT_COMMUNICATION',
  'AS_DESCRIBED', 'ACCURATE_PHOTOS', 'MATCHED_PHOTOS', 'BETTER_THAN_EXPECTED',
  'EASY_TO_FIND', 'CLEAR_INSTRUCTIONS', 'EASY_CHECK_IN', 'SELF_CHECK_IN', 'SMOOTH_CHECK_IN',
  'GREAT_NEIGHBORHOOD', 'GREAT_LOCATION', 'CONVENIENT', 'QUIET', 'FELT_SAFE', 'WALKABLE',
  'GOOD_VALUE', 'GREAT_VALUE', 'GREAT_AMENITIES', 'COMFORTABLE_BEDS', 'WELCOMING',
])
const NEGATIVE_TAGS = new Set([
  'NOTICEABLE_SMELL', 'DIRTY', 'DIRTY_FLOORS', 'DUSTY_SURFACES', 'MOLD_OR_MILDEW', 'PESTS',
  'TRASH_LEFT_BEHIND', 'DIRTY_LINENS', 'DIRTY_BATHROOM', 'DIRTY_KITCHEN',
  'NOT_HELPFUL', 'SLOW_TO_RESPOND', 'UNRESPONSIVE', 'POOR_COMMUNICATION',
  'DID_NOT_MATCH_PHOTOS', 'SMALLER_THAN_EXPECTED', 'NEEDS_MAINTENANCE', 'MISSING_AMENITIES',
  'INACCURATE_DESCRIPTION', 'DIFFICULT_TO_FIND', 'HARD_TO_FIND', 'CONFUSING_INSTRUCTIONS',
  'LOCKED_OUT', 'NOISY', 'FELT_UNSAFE', 'BAD_NEIGHBORHOOD', 'OVERPRICED', 'UNEXPECTED_FEES',
])

function tagPolarity(rawTag: string): 'positive' | 'negative' | null {
  const t = str(rawTag).toUpperCase()
  // 1. Airbnb's own marker, read BEFORE humanTag strips it.
  if (t.includes('_POSITIVE_')) return 'positive'
  if (t.includes('_NEGATIVE_')) return 'negative'
  // 2. Category sub-tags carry no marker — match on the part after the category prefix.
  const body = t.replace(/^(CLEANLINESS|ACCURACY|COMMUNICATION|CHECK_?IN|LOCATION|VALUE|AMENITIES)_/, '')
  if (NEGATIVE_TAGS.has(body)) return 'negative'
  if (POSITIVE_TAGS.has(body)) return 'positive'
  // 3. Genuinely unknown (CLEANLINESS_OTHER and the like) — the caller uses the score instead.
  return null
}

function replyMinutes(raw: any): number | null {
  const rr = (raw && (raw.rawReview || raw.raw)) || {}
  const a = new Date(str(rr.submitted_at || rr.submittedAt || (raw && raw.createdAt))).getTime()
  const b = new Date(str(rr.responded_at || rr.respondedAt)).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.round((b - a) / 60000)
}

export async function GET(req: NextRequest) {
  try {
    return await build(req)
  } catch (e: any) {
    // Honest failure. The page shows the reason; it does not show a plausible 4.7 out of nothing.
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

async function build(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Cleanliness by cleaner is a coaching tool, not a leaderboard: owner + GM workspaces only.
  const canSeeCleaners = access.role === 'admin' || access.workspace === 'gm' || access.workspace === 'admin'

  const sp = req.nextUrl.searchParams
  const market = str(sp.get('market')) || 'all'
  const building = str(sp.get('building')) || 'all'
  const owner = str(sp.get('owner')) || 'all'
  const channel = str(sp.get('channel')) || 'all'
  const today = ymd(new Date())
  // Either a rolling window (days) or an explicit from/to. The comparison period is always the same
  // length immediately before, so "vs prior" means something whichever way the dates were chosen.
  const isRange = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('from'))) && /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('to')))
  const to = isRange ? str(sp.get('to')) : today
  // The clamp used to apply only to the rolling-days branch, so a hand-typed from-date of 2020 asked
  // for five years of reservations in one sweep and the route died at the page ceiling. Both paths
  // are bounded the same way now.
  const rawFrom = isRange ? str(sp.get('from')) : addDays(today, -Math.min(Math.max(Number(sp.get('days') || 90), 7), 1095))
  const from = daysBetween(rawFrom, to) > 1095 ? addDays(to, -1095) : rawFrom
  const days = Math.max(1, daysBetween(from, to))
  const prevFrom = addDays(from, -days)
  const db = supabaseAdmin()

  // PostgREST caps ANY single request at 1000 rows regardless of .limit(), so both of these are
  // paged. The first version of this route reported exactly 1000 reviews and a 149% review rate —
  // the classic symptom, and the same truncation bug that made the day sheet lie.
  //
  // AN ERROR IS NOT AN EMPTY PAGE. This used to `break` on error and hand the caller a short list
  // with no signal, which is how a statement timeout became "0 reviews, 4.7 average". It throws.
  async function page(table: string, select: string, apply: (q: any) => any, maxPages = 12): Promise<any[]> {
    const out: any[] = []
    const seen = new Set<string>()
    for (let i = 0; i < maxPages; i++) {
      const q = apply(db.from(table).select(select)).range(i * 1000, i * 1000 + 999)
      const { data, error } = await q
      if (error) throw new Error('could not read ' + table + ' — ' + String(error.message || error).slice(0, 140))
      const rows = (data || []) as any[]
      for (const r of rows) {
        // created_at is not unique, so a row can straddle a page boundary. Dedupe on id where the
        // select carries one, or the lifetime channel counts are not reproducible between loads.
        const k = r && r.id != null ? String(r.id) : ''
        if (k) { if (seen.has(k)) continue; seen.add(k) }
        out.push(r)
      }
      if (rows.length < 1000) return out
    }
    throw new Error('the ' + table + ' scan stopped early — more rows than the page budget')
  }
  const [reviewRows, lRes, ownerRows, stayRows, lifeRows] = await Promise.all([
    page('guesty_reviews', 'id,listing_id,rating,content,channel,guest_name,created_at,has_reply,dismissed,excluded_from_score,raw',
      // EXCLUDED MEANS EXCLUDED. A review the app has told the user is "excluded from your average
      // score" (reply/route.ts, when the channel says the listing is not mapped) was still being
      // counted here and nowhere else — so this page disagreed with /buildings, with listing health
      // and with the message the user was shown. Filtered at the source now.
      q => q.eq('excluded_from_score', false)
        .gte('created_at', prevFrom + 'T00:00:00Z').order('created_at', { ascending: false }).order('id')),
    // raw->integrations carries the LIVE listing URL per channel (airbnb2 / bookingCom / homeaway2),
    // which is the only channel-specific thing Guesty actually stores — there is no OTA-published
    // rating field in the API, so the score below is computed and the link is how you verify it.
    // Paged like everything else. A bare .limit(1000) here is the same 1000-row cliff the header
    // warns about, and the failure is invisible: every listing past the cap silently becomes an
    // "unmapped review" and drops out of the score.
    page('guesty_listings', 'id,nickname,title,building,address_city,status,ints:raw->integrations', q => q.order('id'), 6),
    // OWNER is the statement owner from guesty_owners.listing_ids — the same map the owner
    // statements, the audit and billable hours use, so "Sanchez's units" means one thing everywhere.
    page('guesty_owners', 'id,full_name,listing_ids', q => q.order('id'), 6),
    // Review RATE needs a denominator: stays that ENDED early enough to have been reviewed. Guests
    // take up to a fortnight to write one, so the window is shifted back rather than matched exactly.
    page('guesty_reservations', 'id,listing_id,check_out,status',
      q => q.gte('check_out', addDays(from, -14)).lte('check_out', addDays(to, -3)).order('check_out', { ascending: false }).order('id')),
    // THE LISTING SCORE (2026-08-06, Jon). The number a guest sees on the live Airbnb / Booking /
    // Vrbo page is the listing's LIFETIME average on that channel — not our 90-day window. So this
    // pass is deliberately unwindowed: every synced review, ever, per listing per channel.
    page('guesty_reviews', 'id,listing_id,rating,channel,created_at',
      q => q.eq('excluded_from_score', false).order('created_at', { ascending: false }).order('id'), 20),
  ])
  const rRes = { data: reviewRows }
  const resRes = { data: stayRows }

  // listing -> owner. First owner wins, matching lib/billing's ownerMap: a listing on two owner
  // records is a data problem upstream, not something to average over.
  const ownerOf: Record<string, { id: string; name: string }> = {}
  const ownerNames: Record<string, string> = {}
  for (const o of (ownerRows as any[])) {
    const nm = str(o.full_name) || ('Owner ' + str(o.id))
    ownerNames[str(o.id)] = nm
    for (const lid of (Array.isArray(o.listing_ids) ? o.listing_ids : [])) {
      const k = str(lid)
      if (k && !ownerOf[k]) ownerOf[k] = { id: str(o.id), name: nm }
    }
  }

  const lmap: Record<string, any> = {}
  for (const l of (lRes as any[])) {
    const name = l.nickname || l.title || 'Unit'
    // The raw Guesty `building` field is per-listing text and produced 65 "buildings" — unusable
    // as a grouping. buildingOf() is the canonical registry in lib/segments, the same one the
    // markets, briefs and billing boards use, so a unit cannot group one way here and another way
    // there (Jon, 2026-08-10).
    const bld = buildingOf(str(l.building), name) || 'Other'
    const own = ownerOf[String(l.id)]
    lmap[String(l.id)] = {
      name, building: bld,
      market: marketOf(l.building, l.address_city, name),
      active: str(l.status).trim().toLowerCase() === 'active',
      // Waves is excluded from the review feed entirely. It used to still count toward the headline
      // average and carry its own building row here, so the two halves of the same page disagreed.
      waves: bld.toLowerCase() === 'waves',
      ownerId: own ? own.id : '', ownerName: own ? own.name : 'Unassigned',
      urls: listingUrls(l.ints),
    }
  }
  // Can a human actually reply to this review? Mirrors app/api/reviews/route.ts exactly:
  // an inactive/dead listing or a review the channel will not accept a response on is not
  // "awaiting" anything — counting it just manufactures phantom work.
  const replyable = (lid: string, _r: any) => {
    const li = lmap[lid]
    return !!(li && li.active && !li.waves)
  }

  // A review whose listing is not in the sync is not "the Other building" — it is unmapped, and it
  // is counted once, in the open, rather than quietly landing in whichever bucket the filters left.
  let unmappedReviews = 0
  const inScope = (lid: string) => {
    const li = lmap[lid]
    if (!li) return false
    if (li.waves) return false
    if (market !== 'all' && li.market !== market) return false
    if (building !== 'all' && li.building !== building) return false
    if (owner !== 'all' && li.ownerId !== owner) return false
    return true
  }

  const inWindow = (r: any) => { const d = str(r.created_at).slice(0, 10); return d >= from && d <= to }
  const windowed = ((rRes.data || []) as any[]).filter(r => Number.isFinite(Number(r.rating)))
  for (const r of windowed) if (inWindow(r) && !lmap[String(r.listing_id)]) unmappedReviews++
  const all = windowed
    .filter(r => inScope(String(r.listing_id)))
    .filter(r => channel === 'all' || str(r.channel) === channel)
  const cur = all.filter(inWindow)
  const prev = all.filter(r => { const d = str(r.created_at).slice(0, 10); return d >= prevFrom && d < from })

  // ── PAR, PER CHANNEL — AND DELIBERATELY NOT FILTERED ────────────────────────────────────────
  // What a review on this channel normally scores FOR THE WHOLE PORTFOLIO in this window. Every
  // comparative number on the page is measured against it, which is what makes a Booking unit and
  // an Airbnb unit rankable in one list without inventing a conversion between a 10-scale and a
  // 5-scale.
  //
  // IT MUST NOT COME FROM THE FILTERED SET. Par taken from `cur` is circular: filter the page to
  // one building and par becomes that building's own average, every unit in it reads exactly 0.00,
  // "units below par" collapses to zero and the page reports "nothing below par" for the worst
  // building in the portfolio — the single most natural thing a manager does would hide the problem
  // they were looking for. So par is built from every mapped, non-Waves review in the window,
  // whatever the market/building/owner/channel controls say.
  const parBase = windowed.filter(r => {
    const li = lmap[String(r.listing_id)]
    return !!li && !li.waves && inWindow(r)
  })
  const parAgg: Record<string, { n: number; sum: number }> = {}
  for (const r of parBase) {
    const ch = str(r.channel) || 'Other'
    const e = parAgg[ch] = parAgg[ch] || { n: 0, sum: 0 }
    e.n++; e.sum += Number(r.rating)
  }
  // Portfolio mean drives the shrinkage for every ranked list below, and is the fallback par for a
  // channel too thin to have one of its own. Same population as par, for the same reason.
  const mean = parBase.length ? parBase.reduce((s, r) => s + Number(r.rating), 0) / parBase.length
    : (cur.length ? cur.reduce((s, r) => s + Number(r.rating), 0) / cur.length : 4.7)
  const par: Record<string, number> = {}
  for (const ch of Object.keys(parAgg)) {
    // A channel with a handful of reviews has no meaningful par of its own; fall back to the
    // portfolio mean rather than calibrating against three stays.
    par[ch] = parAgg[ch].n >= MIN_N ? parAgg[ch].sum / parAgg[ch].n : mean
  }
  const parOf = (ch: string) => par[ch] ?? mean

  const overall = emptyAgg(), overallPrev = emptyAgg()
  const byUnit: Record<string, Agg> = {}, byBuilding: Record<string, Agg> = {}
  const byOwner: Record<string, Agg> = {}
  const byUnitPrev: Record<string, Agg> = {}, byBuildingPrev: Record<string, Agg> = {}
  const byChannel: Record<string, Agg> = {}
  const byMonth: Record<string, Agg> = {}
  const cat: Record<string, { n: number; sum: number }> = {}
  const tagCount: Record<string, number> = {}
  // DRILL-DOWN DETAIL. A count on its own ("needs maintenance 7") tells nobody where to go. For every
  // theme and every category we also keep WHICH units it came from and a few of the guests' own words,
  // so clicking the number lands on the listings that caused it.
  const tagDetail: Record<string, { byUnit: Record<string, number>; samples: any[] }> = {}
  // Praise is kept in its own pair of accumulators, not as a sign flag on the complaint ones, so a
  // theme can never be double-counted and the two lists sort independently.
  const praiseCount: Record<string, number> = {}
  const praiseDetail: Record<string, { byUnit: Record<string, number>; samples: any[] }> = {}
  const catByUnit: Record<string, Record<string, { n: number; sum: number }>> = {}
  // What this unit's guests complain about most — the one line that turns "4.1, worst in the
  // building" into an instruction for whoever walks it.
  const themeByUnit: Record<string, Record<string, number>> = {}
  // The review that should be read before anyone goes to the unit: worst first, then most recent.
  const worstByUnit: Record<string, any> = {}
  const replyTimes: number[] = []
  let replied = 0, replyableN = 0
  // THE BREAKDOWN (2026-08-06, Jon: "break down of properties, units, etc"). Same numbers the
  // headline uses, kept per unit and per building so the page can show property → unit as a table
  // instead of two flat top-12 lists. `await*` uses the SAME replyable() rule as the headline, so a
  // building's reply queue always adds up to the number at the top of the page.
  const awaitByUnit: Record<string, number> = {}
  const awaitByBuilding: Record<string, number> = {}
  const awaitByOwner: Record<string, number> = {}
  const chByUnit: Record<string, Record<string, Agg>> = {}
  // LIFETIME per-channel — the published listing score. Unwindowed on purpose (see listingUrls
  // above); the date filters on this page move the window numbers, never this one.
  const lifeUnit: Record<string, Record<string, { n: number; sum: number; last: string }>> = {}
  const lifeBld: Record<string, Record<string, { n: number; sum: number; units: Set<string> }>> = {}
  // RECOVERY, without the wall of quotes. A unit is in recovery from its last review of 3 or under
  // (7/10 on Booking) until a genuinely good one lands after it — the same rule the welcome-call
  // desk runs on, computed here from the lifetime pass rather than a second query. It is a flag on
  // the unit row now, not a 57-row section (Jon, 2026-09-09: "get rid of this recovery").
  const lifeByListing: Record<string, { rating: number; channel: string; at: string; ts: string }[]> = {}
  for (const r of (lifeRows as any[])) {
    // Through ratingToStars, like every other consumer of this table: a stray 0-10 or 0-100 row
    // would otherwise clear a unit out of recovery on its own and inflate the listing score.
    const rating = ratingToStars(r.rating)
    if (rating == null || rating <= 0) continue
    const lid = String(r.listing_id)
    const li = lmap[lid]
    if (!li || !inScope(lid)) continue
    const ch = str(r.channel) || 'Other'
    const ts = str(r.created_at)
    const at = ts.slice(0, 10)
    ;(lifeByListing[lid] = lifeByListing[lid] || []).push({ rating, channel: ch, at, ts })
    const u = lifeUnit[lid] = lifeUnit[lid] || {}
    const ue = u[ch] = u[ch] || { n: 0, sum: 0, last: '' }
    ue.n++; ue.sum += rating; if (at > ue.last) ue.last = at
    const b = lifeBld[li.building] = lifeBld[li.building] || {}
    const be = b[ch] = b[ch] || { n: 0, sum: 0, units: new Set<string>() }
    be.n++; be.sum += rating; be.units.add(lid)
  }
  /** Days this unit has been waiting for a good review, or null if it is not in recovery. */
  const recCache: Record<string, { days: number; since: string; rating: number } | null> = {}
  const recoveryOf = (lid: string): { days: number; since: string; rating: number } | null => {
    if (lid in recCache) return recCache[lid]
    return (recCache[lid] = recoveryScan(lid))
  }
  const recoveryScan = (lid: string): { days: number; since: string; rating: number; channel: string } | null => {
    // Newest first, on the FULL timestamp: two reviews on the same day decide whether a unit is in
    // recovery or out of it, and a date-only comparator left that to the sort's tie-breaking.
    const rows = (lifeByListing[lid] || []).slice().sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    for (const r of rows) {
      // A clearly good review clears the unit; a low one opens recovery. Anything in between is
      // neither, so keep walking back.
      if (!isLowReview(r.rating, r.channel) && r.rating >= (isBookingChannel(r.channel) ? 4.3 : 4.5)) return null
      if (isLowReview(r.rating, r.channel)) {
        return { days: Math.max(0, daysBetween(r.at, today)), since: r.at, rating: r.rating, channel: r.channel }
      }
    }
    return null
  }
  // Ordered the way the team talks about them, biggest channel first; unknown channels sort last.
  const CH_ORDER = ['Airbnb', 'Booking.com', 'Vrbo', 'Expedia']
  const chRank = (c: string) => { const i = CH_ORDER.indexOf(c); return i < 0 ? 99 : i }
  const otaFor = (lid: string) => Object.keys(lifeUnit[lid] || {})
    .map(ch => {
      const e = lifeUnit[lid][ch]
      const avg = round(e.sum / e.n)
      return {
        channel: ch, n: e.n, avg, lastAt: e.last || null,
        display: CHANNEL_SCALE10[ch] ? round(avg * 2, 1) : avg,
        scale: CHANNEL_SCALE10[ch] ? 10 : 5,
        url: ((lmap[lid] || {}).urls || {})[ch] || null,
      }
    })
    .sort((a, b) => chRank(a.channel) - chRank(b.channel) || b.n - a.n)
  const otaForBuilding = (bname: string) => Object.keys(lifeBld[bname] || {})
    .map(ch => {
      const e = lifeBld[bname][ch]
      const avg = round(e.sum / e.n)
      return {
        channel: ch, n: e.n, avg, units: e.units.size,
        display: CHANNEL_SCALE10[ch] ? round(avg * 2, 1) : avg,
        scale: CHANNEL_SCALE10[ch] ? 10 : 5,
      }
    })
    .sort((a, b) => chRank(a.channel) - chRank(b.channel) || b.n - a.n)

  for (const r of cur) {
    const rating = Number(r.rating)
    const lid = String(r.listing_id)
    const li = lmap[lid] || { name: 'Unknown unit', building: 'Other', ownerId: '', ownerName: 'Unassigned' }
    const chKey = str(r.channel) || 'Other'
    const p = parOf(chKey)
    push(overall, rating, chKey, p)
    push(byUnit[lid] = byUnit[lid] || emptyAgg(), rating, chKey, p)
    push(byBuilding[li.building] = byBuilding[li.building] || emptyAgg(), rating, chKey, p)
    push(byOwner[li.ownerId] = byOwner[li.ownerId] || emptyAgg(), rating, chKey, p)
    push(byChannel[chKey] = byChannel[chKey] || emptyAgg(), rating, chKey, p)
    push(byMonth[str(r.created_at).slice(0, 7)] = byMonth[str(r.created_at).slice(0, 7)] || emptyAgg(), rating, chKey, p)
    // per-unit channel mix — a unit can be fine on Airbnb and bleeding on Booking.com
    const cu2 = chByUnit[lid] = chByUnit[lid] || {}
    push(cu2[chKey] = cu2[chKey] || emptyAgg(), rating, chKey, p)
    const canReply = replyable(lid, r)
    if (canReply) replyableN++
    if (r.has_reply) { replied++; const m = replyMinutes(r.raw); if (m != null) replyTimes.push(m) }
    else if (!r.dismissed && canReply) {
      awaitByUnit[lid] = (awaitByUnit[lid] || 0) + 1
      awaitByBuilding[li.building] = (awaitByBuilding[li.building] || 0) + 1
      awaitByOwner[li.ownerId] = (awaitByOwner[li.ownerId] || 0) + 1
    }
    // The one review to read before walking the unit. Lowest wins; ties go to the most recent.
    if (isLowReview(rating, chKey)) {
      const w = worstByUnit[lid]
      const at = str(r.created_at).slice(0, 10)
      if (!w || rating < w.rating || (rating === w.rating && at > w.at)) {
        worstByUnit[lid] = {
          reviewId: String(r.id), rating, at, channel: chKey,
          guest: str(r.guest_name) || null, hasReply: !!r.has_reply,
          comment: str(r.content).replace(/\s+/g, ' ').trim().slice(0, 240),
        }
      }
    }
    for (const c of categoriesOf(r.raw)) {
      const k = c.key === 'check_in' ? 'checkin' : c.key
      const e = cat[k] = cat[k] || { n: 0, sum: 0 }
      e.n++; e.sum += c.rating
      const cu = catByUnit[k] = catByUnit[k] || {}
      const cue = cu[lid] = cu[lid] || { n: 0, sum: 0 }
      cue.n++; cue.sum += c.rating
      // Split the tags by what they actually SAY, not by the score they arrived with. The tag's own
      // polarity decides; only an unmarked tag falls back to the category score, and there a 4/5
      // still reads as a gripe (the old rule) while a 5/5 reads as praise.
      for (const t of c.tags) {
        const pol = tagPolarity(t) || (c.rating <= 4 ? 'negative' : 'positive')
        const h = humanTag(t)
        const [count, detail] = pol === 'positive'
          ? [praiseCount, praiseDetail] as const
          : [tagCount, tagDetail] as const
        count[h] = (count[h] || 0) + 1
        const td = detail[h] = detail[h] || { byUnit: {}, samples: [] }
        td.byUnit[lid] = (td.byUnit[lid] || 0) + 1
        if (pol === 'negative') {
          const tu = themeByUnit[lid] = themeByUnit[lid] || {}
          tu[h] = (tu[h] || 0) + 1
        }
        if (td.samples.length < 6) td.samples.push({
          listingId: lid, unit: li.name, at: str(r.created_at).slice(0, 10),
          rating, catRating: c.rating, channel: chKey,
          comment: (c.comment || str(r.content)).slice(0, 220),
        })
      }
    }
  }
  for (const r of prev) {
    const rating = Number(r.rating)
    const lid = String(r.listing_id)
    const li = lmap[lid] || { building: 'Other' }
    const chKey = str(r.channel) || 'Other'
    const p = parOf(chKey)
    push(overallPrev, rating, chKey, p)
    push(byUnitPrev[lid] = byUnitPrev[lid] || emptyAgg(), rating, chKey, p)
    push(byBuildingPrev[li.building] = byBuildingPrev[li.building] || emptyAgg(), rating, chKey, p)
  }

  const delta = (a: Agg, b: Agg) => (a.n && b.n ? round(a.sum / a.n - b.sum / b.n) : null)
  const topThemeOf = (lid: string) => {
    const t = themeByUnit[lid] || {}
    const k = Object.keys(t).sort((a, b) => t[b] - t[a])[0]
    return k ? { tag: k, n: t[k] } : null
  }

  const units = Object.keys(byUnit).map(lid => {
    const li = lmap[lid] || { name: 'Unknown unit', building: 'Other', market: '', ownerId: '', ownerName: 'Unassigned' }
    const s = summarise(byUnit[lid], mean)
    const rec = recoveryOf(lid)
    return {
      listingId: lid, unit: li.name, building: li.building, market: li.market,
      ownerId: li.ownerId, ownerName: li.ownerName, active: !!li.active,
      ...s, change: delta(byUnit[lid], byUnitPrev[lid] || emptyAgg()), ranked: byUnit[lid].n >= MIN_N,
      awaiting: awaitByUnit[lid] || 0,
      recoveryDays: rec ? rec.days : null, recoverySince: rec ? rec.since : null,
      worst: worstByUnit[lid] || null,
      topTheme: topThemeOf(lid),
      channels: Object.keys(chByUnit[lid] || {}).map(c => ({ channel: c, n: chByUnit[lid][c].n, avg: round(chByUnit[lid][c].sum / chByUnit[lid][c].n), low: chByUnit[lid][c].low }))
        .sort((a, b) => b.n - a.n),
      ota: otaFor(lid),
    }
  })
  // THE UNITS NOBODY HAS REVIEWED SINCE THE BAD ONE.
  // A unit that took a 1-star in March and has had no review since is the most burned unit in the
  // portfolio and has no row in `byUnit` — so ranking off the window alone made it invisible, which
  // is the opposite of what this page is for. They are carried here with no window numbers (n 0,
  // avg null) and a `windowless` flag the UI reads, longest-waiting first.
  const recoveryOnly = Object.keys(lifeByListing)
    .filter(lid => !byUnit[lid])
    .map(lid => ({ lid, rec: recoveryOf(lid) }))
    .filter(x => !!x.rec)
    .map(({ lid, rec }) => {
      const li = lmap[lid] || { name: 'Unknown unit', building: 'Other', market: '', ownerId: '', ownerName: 'Unassigned' }
      const r = rec as { days: number; since: string; rating: number; channel: string }
      return {
        listingId: lid, unit: li.name, building: li.building, market: li.market,
        ownerId: li.ownerId, ownerName: li.ownerName, active: !!li.active,
        n: 0, avg: null as number | null, fiveShare: null as number | null, lowCount: 0,
        score: null as number | null, vsPar: null as number | null,
        change: null as number | null, ranked: false, windowless: true,
        awaiting: 0,
        recoveryDays: r.days, recoverySince: r.since,
        worst: { reviewId: '', rating: r.rating, at: r.since, channel: r.channel, guest: null, hasReply: false, comment: '' },
        topTheme: null as any,
        channels: [] as any[],
        ota: otaFor(lid),
      }
    })
    .sort((a, b) => (b.recoveryDays || 0) - (a.recoveryDays || 0))
  // Units per building comes from the LISTING MAP, not the review set: a building with 25 units of
  // which 6 got reviewed should read "6 of 25 reviewed", not "6 units". Silence is data too.
  const unitsTotalByBuilding: Record<string, number> = {}
  const unitsTotalByOwner: Record<string, number> = {}
  const marketByBuilding: Record<string, string> = {}
  for (const l of Object.values(lmap) as any[]) {
    if (!l || l.waves) continue
    if (market !== 'all' && l.market !== market) continue
    if (owner !== 'all' && l.ownerId !== owner) continue
    // The MARKET of a building is a fact about where it stands, so it is recorded for every
    // listing. The UNIT COUNT is "how many we run today", so only active listings are counted —
    // previously both keyed off active, and any building with no live unit lost its market chip.
    if (!marketByBuilding[l.building]) marketByBuilding[l.building] = l.market
    if (!l.active) continue
    unitsTotalByBuilding[l.building] = (unitsTotalByBuilding[l.building] || 0) + 1
    unitsTotalByOwner[l.ownerId] = (unitsTotalByOwner[l.ownerId] || 0) + 1
  }
  // Recovery counts per building and per owner run over every in-scope listing with any review
  // history, not only the ones reviewed inside the window — same reason as recoveryOnly above.
  const recByBuilding: Record<string, number> = {}
  const recByOwner: Record<string, number> = {}
  for (const lid of Object.keys(lifeByListing)) {
    if (!recoveryOf(lid)) continue
    const li = lmap[lid]; if (!li) continue
    recByBuilding[li.building] = (recByBuilding[li.building] || 0) + 1
    recByOwner[li.ownerId] = (recByOwner[li.ownerId] || 0) + 1
  }
  // "x of y reviewed" must never read 31 of 21. unitsTotal counts the units we run TODAY, so the
  // reviewed count has to be drawn from the same pool — a delisted unit's reviews still belong to
  // the building's score, but it is not a unit anyone can go clean. Retired units are surfaced
  // separately rather than silently folded in or silently dropped (Jon, 2026-08-10).
  const buildings = Object.keys(byBuilding).map(b => {
    const reviewedIds = Object.keys(byUnit).filter(lid => (lmap[lid] || {}).building === b)
    const reviewedActive = reviewedIds.filter(lid => (lmap[lid] || {}).active).length
    return {
    building: b, ...summarise(byBuilding[b], mean),
    change: delta(byBuilding[b], byBuildingPrev[b] || emptyAgg()),
    awaiting: awaitByBuilding[b] || 0,
    market: marketByBuilding[b] || '',
    unitsReviewed: reviewedActive,
    unitsRetired: reviewedIds.length - reviewedActive,
    unitsTotal: unitsTotalByBuilding[b] || 0,
    inRecovery: recByBuilding[b] || 0,
    // the published listing score per OTA, all-time — independent of the window controls above
    ota: otaForBuilding(b),
  } }).sort((a, b) => (a.vsPar ?? 9) - (b.vsPar ?? 9))

  // OWNERS. Same numbers, grouped by whoever gets the statement — which is who asks "how is my
  // unit doing" and who a bad score is eventually explained to.
  const owners = Object.keys(byOwner).map(id => {
    const reviewedIds = Object.keys(byUnit).filter(lid => (lmap[lid] || {}).ownerId === id)
    return {
      ownerId: id, ownerName: id ? (ownerNames[id] || 'Owner ' + id) : 'Unassigned',
      ...summarise(byOwner[id], mean),
      awaiting: awaitByOwner[id] || 0,
      unitsReviewed: reviewedIds.filter(lid => (lmap[lid] || {}).active).length,
      unitsTotal: unitsTotalByOwner[id] || 0,
      inRecovery: recByOwner[id] || 0,
      buildings: Array.from(new Set(reviewedIds.map(lid => (lmap[lid] || {}).building).filter(Boolean))).sort(),
    }
  }).sort((a, b) => (a.vsPar ?? 9) - (b.vsPar ?? 9))

  // ---- CLEANLINESS BY CLEANER (gated). review -> reservation -> that day's clean -> assignees.
  let cleaners: any[] = []
  let cleanersNote: string | null = null
  if (canSeeCleaners) {
    try {
      const link: { resId: string; rating: number; unit: string; listingId: string; at: string; comment: string }[] = []
      for (const r of cur) {
        const c = categoriesOf(r.raw).find(x => x.key === 'cleanliness')
        if (!c) continue
        const rid = str((r.raw && (r.raw.reservationId || r.raw.reservation_id)) || '')
        if (!rid) continue
        link.push({
          resId: rid, rating: c.rating, listingId: String(r.listing_id),
          unit: (lmap[String(r.listing_id)] || {}).name || 'Unit',
          at: str(r.created_at).slice(0, 10),
          comment: (c.comment || str(r.content)).slice(0, 220),
        })
      }
      const ids = Array.from(new Set(link.map(l => l.resId)))
      const resById: Record<string, any> = {}
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await db.from('guesty_reservations').select('id,listing_id,check_out').in('id', ids.slice(i, i + 200))
        if (error) throw new Error(error.message)
        for (const x of ((data || []) as any[])) resById[String(x.id)] = x
      }
      const pairs = link.map(l => resById[l.resId]).filter(Boolean)
      const listingIds = Array.from(new Set(pairs.map((p: any) => String(p.listing_id))))
      // The clean is usually scheduled ON the checkout date, but a moved clean lands a day either
      // side. Matching only the exact date found almost nothing, so the window is +/- 1 day and the
      // closest one wins.
      const dateSet = new Set<string>()
      for (const p of pairs as any[]) {
        const d0 = str(p.check_out).slice(0, 10); if (!d0) continue
        dateSet.add(d0); dateSet.add(addDays(d0, -1)); dateSet.add(addDays(d0, 1))
      }
      const dates = Array.from(dateSet).sort()
      const taskByKey: Record<string, any> = {}
      if (listingIds.length && dates.length) {
        // PAGED AND ORDERED. This was one unordered `.limit(1000)` per 40 listings, which for a
        // 90-day window is far more rows than 1000 and — with no order — an unstable arbitrary
        // slice: a cleaner's average moved between reloads for no visible reason. Every clean that
        // fell off the end silently vanished from the coaching numbers.
        for (let i = 0; i < listingIds.length; i += 40) {
          const slice = listingIds.slice(i, i + 40)
          for (let pg = 0; pg < 8; pg++) {
            const { data, error } = await db.from('breezeway_tasks_sync')
              .select('id,reference_property_id,scheduled_date,name,assignees,status')
              .in('reference_property_id', slice)
              .in('scheduled_date', dates)
              .order('id')
              .range(pg * 1000, pg * 1000 + 999)
            if (error) throw new Error(error.message)
            const rows = (data || []) as any[]
            for (const t of rows) {
              const nm = str(t.name)
              if (!/clean/i.test(nm) || /strip|walk-?through|inspect/i.test(nm)) continue
              taskByKey[String(t.reference_property_id) + '|' + str(t.scheduled_date).slice(0, 10)] = t
            }
            if (rows.length < 1000) break
            if (pg === 7) cleanersNote = 'some cleans were not scanned — narrow the window'
          }
        }
      }
      // Per person we keep not just the average but the UNIT BREAKDOWN — the coaching conversation is
      // "you score 4.9 everywhere except 1201, where you're 4.2 across six departures", which needs
      // the per-unit split, not a single number.
      type Person = { n: number; sum: number; worst: any[]; units: Record<string, { n: number; sum: number; low: number; last: string }> }
      const byPerson: Record<string, Person> = {}
      for (const l of link) {
        const res = resById[l.resId]; if (!res) continue
        const d0 = str(res.check_out).slice(0, 10)
        const t = taskByKey[String(res.listing_id) + '|' + d0]
          || taskByKey[String(res.listing_id) + '|' + addDays(d0, 1)]
          || taskByKey[String(res.listing_id) + '|' + addDays(d0, -1)]
        if (!t) continue
        const who = (Array.isArray(t.assignees) ? t.assignees : []).map((p: any) => str(p.name)).filter(Boolean)
        for (const person of who) {
          const e = byPerson[person] = byPerson[person] || { n: 0, sum: 0, worst: [], units: {} }
          e.n++; e.sum += l.rating
          const u = e.units[l.listingId] = e.units[l.listingId] || { n: 0, sum: 0, low: 0, last: '' }
          u.n++; u.sum += l.rating
          if (l.rating <= 4) u.low++
          if (l.at > u.last) u.last = l.at
          if (l.rating <= 4) e.worst.push({ unit: l.unit, listingId: l.listingId, at: l.at, rating: l.rating, comment: l.comment })
        }
      }
      const cMean = Object.values(byPerson).reduce((s, e) => s + e.sum, 0) / Math.max(1, Object.values(byPerson).reduce((s, e) => s + e.n, 0))
      cleaners = Object.keys(byPerson).map(name => {
        const e = byPerson[name]
        const avg = round(e.sum / e.n)
        // Worst units first: that is the order you coach in. `gap` is this person's average on that
        // unit against their own overall — it separates "this unit is hard" from "this person slipped".
        const unitRows = Object.keys(e.units).map(lid => {
          const u = e.units[lid]
          const uAvg = round(u.sum / u.n)
          return {
            listingId: lid, unit: (lmap[lid] || {}).name || 'Unit', building: (lmap[lid] || {}).building || 'Other',
            turns: u.n, avg: uAvg, low: u.low, last: u.last, gap: round(uAvg - avg),
          }
        }).sort((a, b) => a.avg - b.avg)
        return {
          name, turns: e.n, avg,
          score: round((SHRINK * (cMean || 4.7) + e.sum) / (SHRINK + e.n)),
          ranked: e.n >= MIN_TURNS,
          units: unitRows,
          unitCount: unitRows.length,
          lowCount: e.worst.length,
          flagged: e.worst.sort((a, b) => (a.rating - b.rating) || (a.at < b.at ? 1 : -1)).slice(0, 6),
        }
      }).sort((a, b) => a.score - b.score)
    } catch (e: any) {
      // Coaching numbers are a side panel, not the page — a failure here says so instead of
      // rendering an empty list that reads as "nobody has any low scores".
      cleaners = []
      cleanersNote = 'could not be worked out — ' + String(e?.message || e).slice(0, 120)
    }
  }

  // ---- DID THE INSPECTION ACTUALLY WORK? (gated)
  //
  // An inspection is only worth its hour if the next guest does not complain. So each inspection is
  // scored against what happened AFTER it: reviews for that unit in the following AFTER_DAYS.
  //   held   - the unit got reviews and none of them were bad. The walk did its job.
  //   missed - a guest still left a low one. Something was there and it was not caught.
  //   lift   - the unit's review average after the walk minus the average before it.
  // Inspections too recent to have collected a review yet are counted but NOT judged (covered), so
  // nobody's rate is dragged down by work the guests have not reacted to.
  //
  // RUBBER-STAMP is the sharp one: an inspector whose own scores are near-perfect while guests
  // score the same units below the portfolio is passing units that are not passing.
  let inspectors: any[] = []
  let inspectorNote: string | null = null
  let inspectorHoldRate: number | null = null
  if (canSeeCleaners) {
    try {
      const AFTER = 45, BEFORE = 45
      const { data: inspRows, error: inspErr } = await db.from('unit_inspections')
        .select('id,unit,listing_id,inspector,rating,inspected_on,follow_up')
        .gte('inspected_on', addDays(from, -BEFORE)).lte('inspected_on', to)
        .order('inspected_on', { ascending: false }).limit(2000)
      if (inspErr) throw new Error(inspErr.message)

      // THE JOIN WAS THROWING AWAY THE KEY IT HAD. unit_inspections stores listing_id at write time
      // (api/inspections) AND the unit name the coordinator typed. This matched on the typed name
      // alone, lowercased, exact — so "Eden 2203" against a nickname of "Eden 2203 - 1BR" dropped
      // the row on the floor and the panel reported nothing while the walks were being logged.
      const byName: Record<string, string> = {}
      for (const id of Object.keys(lmap)) byName[str(lmap[id].name).trim().toLowerCase()] = id

      const revByListing: Record<string, any[]> = {}
      for (const r of all) { const k = str(r.listing_id); (revByListing[k] = revByListing[k] || []).push(r) }
      for (const k of Object.keys(revByListing)) revByListing[k].sort((a, b) => (str(a.created_at) < str(b.created_at) ? -1 : 1))

      type Insp = { n: number; given: number[]; covered: number; held: number; missed: number; followUps: number; afterSum: number; afterN: number; liftSum: number; liftN: number; misses: any[] }
      const byInspector: Record<string, Insp> = {}
      let unmatched = 0

      for (const ins of ((inspRows || []) as any[])) {
        const who = str(ins.inspector).trim()
        if (!who) continue
        const lid = (str(ins.listing_id) && lmap[str(ins.listing_id)] ? str(ins.listing_id) : '')
          || byName[str(ins.unit).trim().toLowerCase()]
        if (!lid) { unmatched++; continue }
        if (!inScope(lid)) continue
        const d0 = str(ins.inspected_on).slice(0, 10)
        if (!d0) continue

        const e = byInspector[who] = byInspector[who] || { n: 0, given: [], covered: 0, held: 0, missed: 0, followUps: 0, afterSum: 0, afterN: 0, liftSum: 0, liftN: 0, misses: [] }
        e.n++
        const given = Number(ins.rating)
        if (Number.isFinite(given)) e.given.push(given)
        if (ins.follow_up) e.followUps++

        const revs = revByListing[lid] || []
        const afterEnd = addDays(d0, AFTER), beforeStart = addDays(d0, -BEFORE)
        const after = revs.filter(r => { const d = str(r.created_at).slice(0, 10); return d > d0 && d <= afterEnd })
        if (!after.length) continue                 // no guest verdict yet — counted, not judged
        e.covered++
        const aAvg = after.reduce((s, r) => s + Number(r.rating), 0) / after.length
        e.afterSum += aAvg; e.afterN++

        const bad = after.filter(r => isLowReview(Number(r.rating), str(r.channel))).sort((a, b) => Number(a.rating) - Number(b.rating))[0]
        if (bad) {
          e.missed++
          e.misses.push({
            unit: (lmap[lid] || {}).name || 'Unit', listingId: lid, inspected: d0,
            at: str(bad.created_at).slice(0, 10), rating: Number(bad.rating), channel: str(bad.channel),
            given: Number.isFinite(given) ? given : null,
            comment: str(bad.content).replace(/\s+/g, ' ').trim().slice(0, 200),
          })
        } else e.held++

        const before = revs.filter(r => { const d = str(r.created_at).slice(0, 10); return d >= beforeStart && d < d0 })
        if (before.length) {
          const bAvg = before.reduce((s, r) => s + Number(r.rating), 0) / before.length
          e.liftSum += (aAvg - bAvg); e.liftN++
        }
      }

      inspectors = Object.keys(byInspector).map(name => {
        const e = byInspector[name]
        const avgGiven = e.given.length ? round(e.given.reduce((s, x) => s + x, 0) / e.given.length) : null
        const guestAfter = e.afterN ? round(e.afterSum / e.afterN) : null
        return {
          name, inspections: e.n, covered: e.covered, held: e.held, missed: e.missed, followUps: e.followUps,
          holdRate: e.covered ? round((e.held / e.covered) * 100, 1) : null,
          lift: e.liftN ? round(e.liftSum / e.liftN) : null,
          avgGiven, guestAfter,
          rubberStamp: !!(avgGiven != null && guestAfter != null && avgGiven >= 4.8 && guestAfter < mean - 0.15 && e.covered >= 3),
          ranked: e.n >= MIN_INSP,
          misses: e.misses.sort((a, b) => a.rating - b.rating).slice(0, 6),
        }
      }).sort((a, b) => {
        if (a.ranked !== b.ranked) return a.ranked ? -1 : 1
        return (a.holdRate == null ? 101 : a.holdRate) - (b.holdRate == null ? 101 : b.holdRate)
      })
      // Portfolio hold rate — but only when there is a portfolio behind it. "100% held portfolio-
      // wide" printed off two judged walks, next to "0 inspectors with 5+ walks", was the single
      // most misleading number on the old page.
      const cov = inspectors.reduce((s, i) => s + i.covered, 0)
      const hel = inspectors.reduce((s, i) => s + i.held, 0)
      inspectorHoldRate = cov >= MIN_INSP ? round((hel / cov) * 100, 1) : null
      const walks = inspectors.reduce((s, i) => s + i.inspections, 0)
      if (!walks) inspectorNote = 'no walks logged in this window'
      else if (cov < MIN_INSP) inspectorNote = walks + ' walk' + (walks === 1 ? '' : 's') + ' logged, only ' + cov + ' with a guest verdict yet — too few to rate'
      else if (unmatched) inspectorNote = unmatched + ' walk' + (unmatched === 1 ? '' : 's') + ' could not be matched to a unit'
    } catch (e: any) {
      inspectors = []
      inspectorNote = 'could not be worked out — ' + String(e?.message || e).slice(0, 120)
    }
  }

  // PORTFOLIO CATEGORY BENCHMARK, saved for the field.
  // The intel block a cleaner or inspector gets names the ONE category a unit is behind the
  // portfolio on — which needs a portfolio number, and computing that inside a push would mean
  // sweeping every review in the account while somebody waits. This page already has it, so it
  // writes it down. Only from the unfiltered view: a benchmark taken from one building is not a
  // benchmark. Fire-and-forget — a failed write must never affect the dashboard.
  if (market === 'all' && building === 'all' && owner === 'all' && channel === 'all' && overall.n >= 100) {
    const bench: Record<string, number> = {}
    for (const k of Object.keys(cat)) if (cat[k].n >= 20) bench[k] = round(cat[k].sum / cat[k].n)
    if (Object.keys(bench).length) {
      try { await setSetting('review_category_benchmark', bench, 'reviews-kpi') } catch (e) { console.error('kpi: benchmark save failed', e) }
    }
  }

  // Review RATE — a quiet unit is not a happy unit, it is an unmeasured one.
  const stays = ((resRes.data || []) as any[]).filter(r => !/cancel|declin|inquir|expire/i.test(str(r.status)) && inScope(String(r.listing_id)))
  const months = Object.keys(byMonth).sort().slice(-13).map(m => ({ month: m, ...summarise(byMonth[m], mean) }))

  // One builder for both lists — complaints and praise are the same shape, so they can never
  // disagree about how a row is counted or how the drill-down is capped.
  const tagRows = (
    counts: Record<string, number>,
    detail: Record<string, { byUnit: Record<string, number>; samples: any[] }>,
  ) => Object.keys(counts).map(t => {
    const td = detail[t] || { byUnit: {}, samples: [] }
    const uRows = Object.keys(td.byUnit).map(lid => ({
      listingId: lid, unit: (lmap[lid] || {}).name || 'Unknown unit',
      building: (lmap[lid] || {}).building || 'Other', n: td.byUnit[lid],
    })).sort((a, b) => b.n - a.n)
    return { tag: t, n: counts[t], units: uRows.slice(0, 10), unitCount: uRows.length, samples: td.samples.slice(0, 4) }
  }).sort((a, b) => b.n - a.n).slice(0, 12)

  // The tiles must count exactly what the list under them renders. These used to run over every
  // unit including the sub-MIN_N ones, so the headline could read "3 below par" above a list of 2 —
  // or, worse, "9 still waiting for a good review" above the words "nothing to send anyone to".
  const belowPar = units.filter(u => u.ranked && u.vsPar != null && (u.vsPar as number) <= -BELOW_PAR)
  const inRecovery = units.filter(u => u.ranked && u.recoveryDays != null).concat(recoveryOnly as any[])

  return NextResponse.json({
    ok: true, days, from, to, market, building, owner, channel,
    channelList: Array.from(new Set(windowed.map(r => str(r.channel)).filter(Boolean))).sort(),
    markets: Array.from(new Set(Object.values(lmap).filter((l: any) => !l.waves).map((l: any) => l.market).filter(Boolean))).sort(),
    buildingList: Array.from(new Set(Object.values(lmap).filter((l: any) => !l.waves).map((l: any) => l.building).filter(Boolean))).sort(),
    // Only owners with units we actually run, so the picker is a list of people, not of records.
    ownerList: Object.keys(ownerNames).map(id => ({
      id, name: ownerNames[id],
      units: Object.values(lmap).filter((l: any) => l && l.ownerId === id && l.active && !l.waves).length,
    })).filter(o => o.units > 0).sort((a, b) => a.name.localeCompare(b.name)),
    // What a review normally scores for us on each channel, in this window — the yardstick every
    // vsPar number on the page is measured against.
    par: Object.keys(par).map(ch => ({
      channel: ch, par: round(par[ch]), n: parAgg[ch] ? parAgg[ch].n : 0,
      display: CHANNEL_SCALE10[ch] ? round(par[ch] * 2, 1) : round(par[ch]),
      scale: CHANNEL_SCALE10[ch] ? 10 : 5,
    })).sort((a, b) => chRank(a.channel) - chRank(b.channel)),
    headline: {
      ...summarise(overall, mean),
      prevAvg: overallPrev.n ? round(overallPrev.sum / overallPrev.n) : null,
      prevFiveShare: overallPrev.n ? round((overallPrev.five / overallPrev.n) * 100, 1) : null,
      change: delta(overall, overallPrev),
      // Coverage is answered replies over replies that COULD be answered — the same population
      // awaitingReply counts. Dividing by every review meant the tile could read "71% answered ·
      // 0 still waiting", which is not a thing that can be true.
      replyCoverage: replyableN ? round((replied / replyableN) * 100, 1) : null,
      medianReplyHours: replyTimes.length ? round(replyTimes.sort((a, b) => a - b)[Math.floor(replyTimes.length / 2)] / 60, 1) : null,
      // Still waiting excludes reviews the team dismissed ('no reply needed') so this number
      // agrees with the Mission Control tile instead of quietly counting closed-out reviews.
      // AWAITING = work someone can actually do (same rule as the /reviews feed): skip dismissed,
      // skip inactive/unsynced listings, skip Waves, skip channel-unreplyable. Re-applied 2026-08-04
      // after a parallel edit reverted it — if you touch this line, keep the replyable() filter.
      awaitingReply: cur.filter(r => !r.has_reply && !r.dismissed && replyable(String(r.listing_id), r)).length,
      staysEnded: stays.length,
      reviewRate: stays.length && channel === 'all' ? round((overall.n / stays.length) * 100, 1) : null,
      reviewRateNote: 'reviews received in this window against stays that ended in time to be reviewed',
      unitsBelowPar: belowPar.length,
      unitsInRecovery: inRecovery.length,
      unmappedReviews,
    },
    months,
    buildings,
    owners,
    // Ranked units worst-first, then the burned units with nothing in the window at all.
    units: (units.filter(u => u.ranked).sort((a, b) => (a.vsPar ?? 9) - (b.vsPar ?? 9)) as any[]).concat(recoveryOnly),
    unranked: units.filter(u => !u.ranked).sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9)),
    channels: Object.keys(byChannel).map(c => ({ channel: c, ...summarise(byChannel[c], mean) })).sort((a, b) => b.n - a.n),
    categories: Object.keys(cat).map(k => {
      const uRows = Object.keys(catByUnit[k] || {}).map(lid => {
        const u = catByUnit[k][lid]
        return {
          listingId: lid, unit: (lmap[lid] || {}).name || 'Unknown unit',
          building: (lmap[lid] || {}).building || 'Other', n: u.n, avg: round(u.sum / u.n),
        }
      }).sort((a, b) => a.avg - b.avg)
      return {
        key: k, label: k.charAt(0).toUpperCase() + k.slice(1),
        avg: round(cat[k].sum / cat[k].n), n: cat[k].n, ops: OPS_CATEGORIES.has(k),
        units: uRows.slice(0, 10), unitCount: uRows.length,
      }
    }).sort((a, b) => a.avg - b.avg),
    // Category ratings come from Airbnb only (Booking's sub-scores live somewhere else in the raw
    // payload and are not read), so they are compared against the Airbnb average, not the blended
    // headline — otherwise every category looked ~0.1 better than it is.
    categoryBase: round(par['Airbnb'] ?? mean),
    themes: tagRows(tagCount, tagDetail),
    // What guests call out as GOOD. Same shape as themes so the UI renders it with the same
    // component — the only difference is which bucket it came from.
    praise: tagRows(praiseCount, praiseDetail),
    teamVisible: canSeeCleaners,
    cleaners: canSeeCleaners ? cleaners : null,
    cleanersNote,
    inspectors: canSeeCleaners ? inspectors : null,
    inspectorNote,
    inspectorHoldRate: canSeeCleaners ? inspectorHoldRate : null,
    minReviews: MIN_N, minTurns: MIN_TURNS, minInspections: MIN_INSP, inspectionWindow: 45, belowPar: BELOW_PAR,
  })
}

// THE CALLS DESK — what the guest-call team should actually pick up the phone about today.
//
// Three lists, one engine, because they answer three versions of the same question:
//
//   PRE-ARRIVAL   — a guest is arriving; call before they land (the original welcome call).
//   RECOVERY      — this UNIT burned a guest recently and has not proved itself since, so the next
//                   people through the door get a call whether or not anyone feels like making it.
//   POST-CHECKOUT — a guest just left a stay that went sideways; call before they write about it.
//
// ── HOW A UNIT ENTERS AND LEAVES RECOVERY (Jon, 2026-09-08) ─────────────────────────────────────
// "Until we get another positive review in the unit." That is the whole rule, and it is better than
// the fixed 30/60/90-day window I proposed: a calendar has no idea whether the problem was fixed,
// while the next guest's review does. So:
//
//   IN RECOVERY   = the unit's most recent LOW review (<= 3 stars, the same definition the briefs,
//                   the review KPIs and lib/review-themes already use) has NO review of 4.5 stars
//                   or better after it.
//   RECOVERED     = a 4.5+ review landed after that low one. The flag clears itself, silently, the
//                   moment a guest says the place is good again.
//
// There is deliberately NO time limit and no "mark recovered" button. A unit that has been flagged
// for two months is not a stale row to dismiss — it is a unit that has not earned a good review in
// two months, which is the single most useful thing this page can tell you. `openDays` is surfaced
// so that stays visible instead of hiding behind a badge.
//
// Why 4.5 and not 4: a 4-star Airbnb review is a complaint with the volume turned down (the working
// range is 4.6-4.9). Clearing a recovery flag on a 4 would mean calling the problem solved on the
// evidence of a guest who was not quite happy either.
//
// ── WHO GETS A POST-CHECKOUT CALL ───────────────────────────────────────────────────────────────
// ONLY a guest checking out of a unit in recovery (Jon, 2026-09-08 evening: "should be a post call
// for only guest checking out of bad unit for recovery"). Recovery therefore bookends every stay at
// a burned unit: a mandatory welcome call before the guest arrives, and this call when they leave —
// so the complaint is heard on the phone before it is written in a review, and the review that
// clears the unit has the best chance of being the good one.
//
// Earlier the same day the list was wider (glitch during the stay, direct booking, high value).
// Those still show on the card as context — a glitch logged mid-stay is the first thing the caller
// should name — but they no longer put a guest on the list. `reasons` keeps all of them.
import 'server-only'
import { pageRows } from '@/lib/db-page'
import { ratingToStars } from '@/lib/optimize-score'
import { channelOf } from '@/lib/welcome-call-guide'

export const LOW_STARS = 3        // <= this is a bad review (matches ops-brief, review KPIs, review-themes)
export const CLEAR_STARS = 4.5    // a review this good, AFTER the low one, clears the unit
export const HIGH_VALUE = 2500    // a stay worth calling about on money alone

// ── THE WELCOME-CALL WINDOW (Jon, 2026-09-09) ───────────────────────────────────────────────────
// "Make welcome calls today focused and future focused. No 24 hours to complete. Need to complete
// by the day of or 72 hours in advance."
//
// So a welcome call is workable from 72 hours before arrival through the ARRIVAL DAY ITSELF, and
// not a minute longer: the day the guest lands is the last day the call counts, and the nightly
// close-out marks anything still open that night as incomplete. There is no grace day any more —
// the 24-hour "call them once they're in" allowance from 2026-09-08 is gone, because a welcome call
// after the guest has slept in the unit is not a welcome call. The desk therefore never shows an
// arrival in the past: today's arrivals are the deadline, the next three days are the runway.
//
// A missed call is still a fact, not a deletion: it lands on the scoreboard as `incomplete` with a
// tier and a date. It just stops being a card someone could still act on.
//
// Post-checkout calls keep their 48 hours after departure ("departure can give you 48 hours").
//
// These are calendar days in Eastern time, not clock hours. Guesty's check-in times are a listing
// default far more often than the guest's real arrival, so hour-level math here would be spurious
// precision on a number we do not actually have.
export const WELCOME_GRACE_DAYS = 0     // the arrival day is the last day; nothing after it
export const WELCOME_AHEAD_DAYS = 3     // due from 72 hours before arrival
export const POST_GRACE_DAYS = 2        // checkout day + 1 (a 48-hour window)

export type RecoveryUnit = {
  listingId: string
  rating: number            // stars, 0-5, of the low review
  channel: string
  guest: string
  content: string           // what they actually said, trimmed
  at: string                // ISO date of the low review
  openDays: number          // how long this unit has been waiting for a good review
  reviewsSince: number      // reviews at this unit since the low one (none of them 4.5+)
}

function ymdET(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
/** Shift a YYYY-MM-DD by whole days without dragging a timezone into it. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
function daysSince(iso: string): number {
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return 0
  return Math.max(0, Math.round((Date.now() - t) / 86400000))
}

/**
 * Units currently in recovery, keyed by listing_id.
 *
 * Reads every review once, ordered and paged (lib/db-page — an unordered `.limit()` here would
 * silently sample the table and flag the wrong units). Reviews excluded from the score are ignored
 * on both sides: they cannot put a unit into recovery and they cannot clear one.
 */
export async function recoveryUnits(db: any): Promise<Map<string, RecoveryUnit>> {
  const { rows, truncated } = await pageRows<any>((a, b) => db.from('guesty_reviews')
    .select('id,listing_id,rating,content,channel,guest_name,created_at,excluded_from_score')
    .eq('excluded_from_score', false)
    .order('id').range(a, b), 12)
  // A SHORT READ HERE FABRICATES MANDATORY CALLS, so it is a hard failure rather than a silent
  // approximation. pageRows reports `truncated` when a page errored out mid-scan; because the
  // ordering is by id — a Mongo ObjectId, so time-ascending — the rows lost are the NEWEST ones,
  // which are exactly the good reviews that clear a unit's recovery flag. Carrying on would mark
  // recovered units as still burned and turn every arrival there into a mandatory call, on
  // evidence we know is incomplete. Throwing keeps it out of the 5-minute cache too.
  if (truncated) throw new Error('recovery: review scan came back short — refusing to flag units on a partial read')

  // Newest first per listing, so the first low review we meet is the one that matters.
  const byListing = new Map<string, any[]>()
  for (const r of rows) {
    const id = String(r.listing_id || '')
    if (!id || !r.created_at) continue
    if (!byListing.has(id)) byListing.set(id, [])
    byListing.get(id)!.push(r)
  }

  const out = new Map<string, RecoveryUnit>()
  for (const [listingId, revs] of Array.from(byListing.entries())) {
    revs.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
    const idx = revs.findIndex((r: any) => {
      const s = ratingToStars(r.rating)
      return s != null && s <= LOW_STARS
    })
    if (idx < 0) continue                       // no low review at all
    const since = revs.slice(0, idx)            // everything newer than the low one
    if (since.some((r: any) => { const s = ratingToStars(r.rating); return s != null && s >= CLEAR_STARS })) continue // cleared
    const low = revs[idx]
    out.set(listingId, {
      listingId,
      rating: ratingToStars(low.rating) ?? 0,
      channel: String(low.channel || ''),
      guest: String(low.guest_name || ''),
      content: String(low.content || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      at: String(low.created_at).slice(0, 10),
      openDays: daysSince(String(low.created_at)),
      reviewsSince: since.length,
    })
  }
  return out
}

export type StayGlitch = { id: string; overview: string; status: string; at: string }

/**
 * Glitches that could belong to a stay, fetched once for the whole page.
 *
 * `since` must be the EARLIEST CHECK-IN on the page, not the earliest checkout. Anchoring this to
 * the checkout window was wrong in the way that matters: a six-night stay ending yesterday could
 * have had its broken-AC glitch logged on night one, five days before the window opened, so the one
 * stay that most needed a follow-up call was the one that never reached the desk.
 */
export async function glitchesDuringStays(db: any, since: string): Promise<any[]> {
  const { rows } = await pageRows<any>((a, b) => db.from('glitches')
    .select('id,listing_id,unit,overview,status,created_at,incident_date')
    .or(`incident_date.gte.${since},created_at.gte.${since}T00:00:00Z`)
    .order('id').range(a, b), 6)
  return rows
}

/**
 * Attach the UNLINKED glitches — the ones carrying a typed unit string and no listing_id — to a
 * listing name, but only when there is exactly one candidate.
 *
 * app/api/glitches deliberately leaves a glitch unlinked when its typed unit matches more than one
 * listing ("anything ambiguous stays unlinked rather than guessing"), so by definition the glitches
 * that reach here are the ones that already failed a uniqueness test somewhere. Guessing at this
 * point is worse than missing them: a false match makes the desk tell a caller to open with "I know
 * the AC failed during your stay" to a guest for whom it never did. So the same rule applies —
 * ONE candidate or nothing.
 *
 * Returns glitch id -> listing name.
 */
export function assignUnlinkedGlitches(all: any[], listingNames: string[]): Map<string, string> {
  const names = Array.from(new Set(listingNames.filter(Boolean)))
  const tokens = new Map<string, string[]>()
  for (const n of names) tokens.set(n, unitTokens(n))
  const out = new Map<string, string>()
  for (const g of all) {
    if (String(g.listing_id || '')) continue
    const gt = unitTokens(String(g.unit || ''))
    if (!gt.length) continue
    // A unit reference has to carry a number. "Botanica" alone names a building, not a unit, and
    // would otherwise match every apartment in it.
    if (!gt.some(t => /\d/.test(t))) continue
    const hits = names.filter(n => {
      const lt = tokens.get(n) || []
      return gt.every(t => lt.indexOf(t) >= 0)
    })
    if (hits.length === 1) out.set(String(g.id), hits[0])
  }
  return out
}

function unitTokens(name: string): string[] {
  return String(name || '')
    .toLowerCase()
    // Split letter/digit runs apart so "17West 2205" and "17 west 2205" tokenise the same way and a
    // building token can never be mistaken for a unit number.
    .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
}

/**
 * The glitches that happened while this guest was in the unit.
 *
 * Dates come from `incident_date` when the filer supplied one (the glitch form requires it) and only
 * fall back to `created_at`, which is when the report was TYPED. Those differ exactly when it hurts:
 * a guest complains on their last morning, the desk writes it up the next afternoon, and a
 * created_at test puts the incident after checkout and hides it from the checkout call it should
 * have triggered.
 */
export function glitchesFor(all: any[], listingId: string, listingName: string, checkIn: string, checkOut: string, assigned: Map<string, string>): StayGlitch[] {
  return all
    .filter((g: any) => {
      const gl = String(g.listing_id || '')
      // Linked glitches match on the id. Unlinked ones only count when assignUnlinkedGlitches found
      // exactly one listing for them — matching on listing_id alone would drop every hand-typed
      // glitch, and matching loosely would attach one unit's complaint to another unit's guest.
      if (gl) return listingId ? gl === listingId : false
      return !!listingName && assigned.get(String(g.id)) === listingName
    })
    .filter((g: any) => {
      const at = String(g.incident_date || g.created_at || '').slice(0, 10)
      return at && at >= checkIn && at <= checkOut
    })
    .map((g: any) => ({
      id: String(g.id),
      overview: String(g.overview || '').replace(/\s+/g, ' ').trim().slice(0, 180),
      status: String(g.status || ''),
      at: String(g.incident_date || g.created_at || '').slice(0, 10),
    }))
    .slice(0, 4)
}

export type CallReason = 'glitch' | 'recovery' | 'direct' | 'value'
export const REASON_LABEL: Record<CallReason, string> = {
  glitch: 'Issue during stay',
  recovery: 'Unit in recovery',
  direct: 'Direct booking',
  value: 'High-value stay',
}

/** Context for the post-checkout card. Only `recovery` puts the guest on the list (see above). */
export function postCheckoutReasons(opts: { glitches: StayGlitch[]; inRecovery: boolean; source: string; value: number }): CallReason[] {
  const out: CallReason[] = []
  if (opts.glitches.length) out.push('glitch')
  if (opts.inRecovery) out.push('recovery')
  if (channelOf(opts.source) === 'Direct') out.push('direct')
  if (opts.value >= HIGH_VALUE) out.push('value')
  return out
}

export { ymdET }

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE CALL CENTER (Jon, 2026-09-08 evening): "make this a robust call center to manage this well".
//
// Everything below is what the Calls desk page used to compute inline, moved here so the NIGHTLY
// CLOSE-OUT runs the identical engine. If the page and the cron each had their own idea of which
// calls were due, "incomplete" would mean two different things by Friday.
//
// ── TIERS ───────────────────────────────────────────────────────────────────────────────────────
// Every welcome call has a tier, and every tier but `standard` is MANDATORY: it must be completed
// by the end of the arrival day or it closes as incomplete, with a record. Every tier shares the
// same window — 72 hours ahead through the arrival day (Jon, 2026-09-09) — the tier decides how
// hard the miss counts, not when the call is due.
//   lux      — Arya, Nomad, District 225. Jon's list, 2026-09-08. Deliberately NOT lib/segments'
//              Lux tag (which also holds 17WEST, Elser, Amrit): that tag drives revenue segmenting,
//              this one drives who gets a mandatory phone call, and Jon wants them different.
//   recovery — the unit is waiting for a good review (see the top of this file)
//   big      — $1,200+ or 10+ nights (Jon). Either trips it.
//   standard — everyone else: worth doing, not mandatory.
// Order of precedence when several apply: LUX > recovery > big — "lux calls get priority" (Jon).
// A lux unit in recovery keeps the lux tier and carries the recovery FLAG on top (`recovery` is
// set on the row either way), so the card says both and the call opens with both in mind.
//
// ── SAME-DAY CLOSE ──────────────────────────────────────────────────────────────────────────────
// "If calls not completed same day, please close, incomplete." A welcome call is workable from 72h
// before arrival through the arrival day itself; a post-checkout call for 48h after departure. The
// nightly close-out (app/api/cron/calls-closeout) then writes an `incomplete` row for anything left,
// so the miss is a fact in guest_calls with a tier and a date — not a number that evaporates when
// the row scrolls out of the window. That is what makes the scoreboard honest.
import { buildingOf } from '@/lib/segments'
import { isLiveStay } from '@/lib/stay-status'
import { unstable_cache } from 'next/cache'

export const CALL_LUX = ['Arya', 'Nomad', 'District 225']
export const BIG_VALUE = 1200
export const BIG_NIGHTS = 10

export type Tier = 'recovery' | 'lux' | 'big' | 'standard'
export const TIER_LABEL: Record<Tier, string> = { recovery: 'Recovery', lux: 'Luxury', big: 'Big booking', standard: 'Standard' }

export function tierOf(o: { listingName: string; building?: string | null; value: number; nights: number; recovery: boolean }): Tier {
  // The listing's own `building` field first, the name second — a lux unit whose Guesty nickname
  // is just "409" still resolves through the building it belongs to.
  const b = buildingOf(o.building || null, o.listingName)
  if (b && CALL_LUX.some(l => l.toLowerCase() === b.toLowerCase())) return 'lux'
  if (o.recovery) return 'recovery'
  if (o.value >= BIG_VALUE || o.nights >= BIG_NIGHTS) return 'big'
  return 'standard'
}
/** Sort weight inside a day: lux first (Jon), then recovery, big, standard. */
export const TIER_RANK: Record<Tier, number> = { lux: 0, recovery: 1, big: 2, standard: 3 }

/** Outcomes that mean the call HAPPENED. `done` is the pre-outcome legacy value. */
export const COMPLETED = ['done', 'reached', 'voicemail', 'happy', 'issue']
export const isCompleted = (outcome: any) => COMPLETED.indexOf(String(outcome || '')) >= 0

// Guesty's reservation customFields arrive as { fieldId, value } with NO field name, and the
// field-definition name map isn't synced — so we match the "Welcome Call" field by its known id.
export const WELCOME_FIELD_ID = '68d59ad7e34f25001311d85a'
const cfId = (c: any) => String((c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : '') || '')
export const welcomeOf = (cf: any) => Array.isArray(cf) ? cf.find((c: any) => cfId(c) === WELCOME_FIELD_ID || /welcome/i.test(String(c?.fieldName || c?.name || c?.fieldId?.name || ''))) : undefined
export const guestyCalled = (cf: any) => { const w = welcomeOf(cf); return !!w && ((typeof w.value === 'string' && w.value.trim().length > 0) || !!w._by) }

const fieldVal = (cf: any, kw: string) => {
  if (!Array.isArray(cf)) return undefined
  const ff = cf.find((c: any) => String(c?.fieldName || c?.name || c?.fieldId?.name || '').toLowerCase().includes(kw))
  return ff ? ff.value : undefined
}
const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))
const notesOf = (cf: any) => (Array.isArray(cf) ? ((cf.find((c: any) => /reservation[_ ]?notes/i.test(String(c?.fieldName || c?.name || ''))) || {}).value) : '') || ''

function rollupBuilding(raw: any): string {
  const s = String(raw || '').toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('botanica')) return 'Botanica'
  if (s.includes('arya')) return 'Arya'
  if (s.includes('oasis') || /mahogany|royal\s*palm|bougainvillea|bamboo|sapodilla|jasmine/.test(s)) return 'Oasis'
  return String(raw)
}

function moneyStatus(r: any) {
  const m = (r.money && typeof r.money === 'object') ? r.money : {}
  const balance = typeof m.balanceDue === 'number' ? m.balanceDue : (Number(r.money_balance) || 0)
  const total = Number(r.money_total) || 0
  const paidFull = m.isFullyPaid === true || (total > 0 && balance <= 0.01)
  const items = Array.isArray(m.invoiceItems) ? m.invoiceItems : []
  const NOTABLE = /park|pet|resort|early\s*check|late\s*check|crib|baby|amenit|pool\s*heat|extra\s*guest|luggage|transfer|airport/i
  const STD = /accommodation|cleaning|markup|revenue|host channel|management|commission|tourism|tax|booking fee|marketing|length of stay|verify|resolution/i
  const addOns = items
    .map((it: any) => ({ t: String(it.title || it.name || '').trim(), amt: Number(it.amount) || 0 }))
    .filter((x: any) => x.t && NOTABLE.test(x.t) && !STD.test(x.t))
  const parking = addOns.find((x: any) => /park/i.test(x.t)) || null
  return {
    paidFull, balance,
    currency: r.money_currency || 'USD',
    parking: parking ? parking.amt : null,
    addOns: addOns.filter((x: any) => !/park/i.test(x.t)).slice(0, 4),
    nights: Number(r.nights) || Number(r.nightsCount) || 0,
    checkOut: String(r.check_out || '').slice(0, 10),
  }
}

// Which units are in recovery changes when a review lands, which is a few times a day at most —
// but working it out reads every review in the table. Cached for five minutes (and dropped by
// cron/sync-reviews the moment a review arrives) so opening the desk does not re-scan 3,700
// reviews each time. A Map does not survive the cache boundary, so entries cross as an array.
const cachedRecovery = unstable_cache(async () => {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const m = await recoveryUnits(supabaseAdmin())
  return Array.from(m.entries())
}, ['calls-recovery-units-v1'], { revalidate: 300, tags: ['reviews'] })

export const RES_SELECT = 'id,listing_id,guest_name,guest_phone,listing_name,check_in,check_out,nights,status,money_total,money_paid,money_balance,money_currency,custom_fields,source,money:raw->money,guestId:raw->guest->>_id,nightsCount:raw->>nightsCount'

export type CallLog = { reservation_id: string; kind: string; outcome: string; note: string; called_by: string; caller_email: string; called_at: string; attempts: number; tier: string }

export type WelcomeRow = {
  id: string; guest: string; guestId: string; listing: string; listingId: string; building: string; check_in: string
  phone: string; value: number; source: string; notes: string
  status: ReturnType<typeof moneyStatus>
  tier: Tier; mandatory: boolean
  done: boolean; outcome: string; attempts: number
  callValue: string; calledBy: string; calledAt: string
  claimedBy: string; claimedAt: string
  sensitive: boolean
  due: boolean; dueToday: boolean; lastChance: boolean; closed: boolean; incomplete: boolean
  prio: number
  recovery: RecoveryUnit | null
}
export type PostRow = {
  id: string; guest: string; listing: string; listingId: string; building: string; check_in: string; check_out: string
  phone: string; value: number; source: string; nights: number; notes: string
  glitches: StayGlitch[]; recovery: RecoveryUnit | null; reasons: CallReason[]
  done: boolean; outcome: string; attempts: number; calledBy: string; calledAt: string; callNote: string
  claimedBy: string; claimedAt: string
  closed: boolean; incomplete: boolean
}
export type DeskData = {
  today: string
  rows: WelcomeRow[]
  outRows: PostRow[]
  recoveryFailed: boolean
  kpis: Record<string, any>
}

/**
 * Everything the Calls desk shows, from one place.
 *
 * `today` is an Eastern calendar date. The page passes the real one; the nightly close-out passes
 * the same, and simply acts on the rows this reports as `closed && !done`.
 */
export async function loadCallsDesk(sb: any, today: string): Promise<DeskData> {
  const toDate = addDays(today, 14)
  const graceFrom = addDays(today, -WELCOME_GRACE_DAYS)     // the first day a call is still workable (= today)
  // Two days further back, so the nightly close-out — which runs after midnight with the NEW day as
  // `today` — still sees yesterday's arrivals and can mark them incomplete, and the header can say
  // how many closed. They are `closed` rows: the desk never lists them as work.
  const closedFrom = addDays(graceFrom, -2)
  const backDate = addDays(today, -POST_GRACE_DAYS)        // checkouts still inside theirs (48h)
  const postClosedFrom = addDays(backDate, -2)

  const [{ data: arrivals }, { data: departures }, rec] = await Promise.all([
    sb.from('guesty_reservations').select(RES_SELECT).gte('check_in', closedFrom).lte('check_in', toDate).order('check_in').limit(500),
    sb.from('guesty_reservations').select(RES_SELECT).gte('check_out', postClosedFrom).lte('check_out', today).order('check_out', { ascending: false }).limit(500),
    cachedRecovery().then(e => ({ map: new Map<string, RecoveryUnit>(e), failed: false }))
      // recoveryUnits throws rather than flag units on a partial review scan. Falling back to an
      // empty map is right; PRETENDING that means "no unit is in recovery" is not, so the failure
      // travels to the board and is shown instead of a clean bill of health.
      .catch(() => ({ map: new Map<string, RecoveryUnit>(), failed: true })),
  ])
  const recovery = rec.map

  // THE CALL LOG IS JOINED BY RESERVATION ID, not by a snapshotted date (see migration 073).
  const callIds = Array.from(new Set([...(arrivals || []), ...(departures || [])].map((r: any) => String(r.id))))
  const idChunks: string[][] = []
  for (let i = 0; i < callIds.length; i += 200) idChunks.push(callIds.slice(i, i + 200))
  const logs: CallLog[] = (await Promise.all(idChunks.map(chunk => sb.from('guest_calls')
    .select('reservation_id,kind,outcome,note,called_by,caller_email,called_at,attempts,tier')
    .in('reservation_id', chunk).then((r: any) => r.data || [])))).flat()
  const callLog = new Map<string, CallLog>()
  for (const c of logs) callLog.set(String(c.reservation_id) + '|' + String(c.kind), c)
  const logOf = (id: any, kind: 'welcome' | 'post_checkout') => callLog.get(String(id) + '|' + kind) || null

  // Glitches from the EARLIEST CHECK-IN on the departures list, not from the checkout window.
  const earliestStay = (departures || []).reduce((min: string, r: any) => {
    const ci = String(r.check_in || '').slice(0, 10)
    return ci && ci < min ? ci : min
  }, postClosedFrom)
  const glitchRows = await glitchesDuringStays(sb, earliestStay)
  const unlinked = assignUnlinkedGlitches(glitchRows, (departures || []).map((r: any) => String(r.listing_name || '')))

  const dueDate = addDays(today, WELCOME_AHEAD_DAYS)     // 72 hours ahead (Jon, 2026-09-09)
  const recOf = (listingId: any): RecoveryUnit | null => recovery.get(String(listingId || '')) || null

  // The listing's `building` for every unit on the page, so a lux tier never depends on the
  // nickname happening to contain the building's name.
  const listingIds = Array.from(new Set([...(arrivals || []), ...(departures || [])].map((r: any) => String(r.listing_id || '')).filter(Boolean)))
  const buildingOfListing = new Map<string, string>()
  for (let i = 0; i < listingIds.length; i += 200) {
    const { data } = await sb.from('guesty_listings').select('id,building').in('id', listingIds.slice(i, i + 200))
    for (const l of (data || [])) if ((l as any).building) buildingOfListing.set(String((l as any).id), String((l as any).building))
  }

  // ── WELCOME CALLS ─────────────────────────────────────────────────────────────────────────────
  const rows: WelcomeRow[] = (arrivals || []).filter((r: any) => isLiveStay(r.status)).map((r: any) => {
    const listing = String(r.listing_name || '')
    const check_in = String(r.check_in).slice(0, 10)
    const recv = recOf(r.listing_id)
    const value = Number(r.money_total) || 0
    const st = moneyStatus(r)
    const tier = tierOf({ listingName: listing, building: buildingOfListing.get(String(r.listing_id || '')) || null, value, nights: st.nights, recovery: !!recv })
    const mandatory = tier !== 'standard'
    const lg = logOf(r.id, 'welcome')
    const localDone = !!lg && isCompleted(lg.outcome)
    const done = guestyCalled(r.custom_fields) || localDone
    const incomplete = !!lg && lg.outcome === 'incomplete'
    const closed = check_in < graceFrom
    const w: any = welcomeOf(r.custom_fields) || {}
    return {
      id: String(r.id), guest: r.guest_name || '', guestId: String(r.guestId || ''), listing, listingId: String(r.listing_id || ''),
      building: rollupBuilding(listing), check_in,
      phone: r.guest_phone || '', value, source: r.source || '', notes: notesOf(r.custom_fields), status: st,
      tier, mandatory,
      // attempts is a COUNT: a claim writes 0 and 0 must stay 0, or a claim reads as a try.
      done, outcome: lg ? String(lg.outcome) : '', attempts: lg ? (Number(lg.attempts) || 0) : 0,
      callValue: typeof w.value === 'string' ? w.value : '',
      calledBy: (lg && isCompleted(lg.outcome) && lg.called_by) ? String(lg.called_by) : (w._by || ''),
      calledAt: (lg && isCompleted(lg.outcome) && lg.called_at) ? String(lg.called_at) : (w._at || ''),
      claimedBy: (lg && lg.outcome === 'in_progress') ? String(lg.called_by || '') : '',
      claimedAt: (lg && lg.outcome === 'in_progress') ? String(lg.called_at || '') : '',
      sensitive: truthy(fieldVal(r.custom_fields, 'sensitive')),
      // Due = inside the 72-hour window, every tier alike (Jon, 2026-09-09: "complete by the day of
      // or 72 hours in advance"). Beyond the window a mandatory call is still on the 14-day list
      // and still mandatory when its day comes; it is just not today's work yet.
      due: check_in >= graceFrom && check_in <= dueDate,
      dueToday: check_in === today,
      // The arrival day is the last day: an arrival today closes tonight if nobody calls.
      lastChance: check_in === today,
      closed, incomplete,
      prio: mandatory ? 0 : 1,
      recovery: recv,
    }
  })

  // ── POST-CHECKOUT ─────────────────────────────────────────────────────────────────────────────
  const outRows: PostRow[] = (departures || [])
    .filter((r: any) => isLiveStay(r.status))
    .map((r: any) => {
      const listingId = String(r.listing_id || '')
      const checkIn = String(r.check_in || '').slice(0, 10)
      const checkOut = String(r.check_out || '').slice(0, 10)
      const glitches = glitchesFor(glitchRows, listingId, String(r.listing_name || ''), checkIn, checkOut, unlinked)
      // Only a recovery that EXISTED when the guest left. If the low review landed after their
      // checkout, they were never on this list — often they wrote that review — and the nightly
      // close-out must not invent a miss for a call nobody was asked to make.
      const recv0 = recOf(listingId)
      const recv = recv0 && recv0.at <= checkOut ? recv0 : null
      const value = Number(r.money_total) || 0
      const reasons = postCheckoutReasons({ glitches, inRecovery: !!recv, source: r.source || '', value })
      const lg = logOf(r.id, 'post_checkout')
      return {
        id: String(r.id), guest: r.guest_name || '', listing: r.listing_name || '', listingId, building: rollupBuilding(r.listing_name),
        check_in: checkIn, check_out: checkOut, phone: r.guest_phone || '', value, source: r.source || '',
        nights: Number(r.nights) || Number(r.nightsCount) || 0, notes: notesOf(r.custom_fields),
        glitches, recovery: recv, reasons,
        done: !!lg && isCompleted(lg.outcome),
        outcome: lg ? String(lg.outcome) : '', attempts: lg ? (Number(lg.attempts) || 0) : 0,
        calledBy: lg ? String(lg.called_by || '') : '', calledAt: lg ? String(lg.called_at || '') : '', callNote: lg ? String(lg.note || '') : '',
        claimedBy: (lg && lg.outcome === 'in_progress') ? String(lg.called_by || '') : '',
        claimedAt: (lg && lg.outcome === 'in_progress') ? String(lg.called_at || '') : '',
        closed: checkOut < backDate,
        incomplete: !!lg && lg.outcome === 'incomplete',
      }
    })
    .filter((r: PostRow) => !!r.recovery)

  // ── THE NUMBERS AT THE TOP ────────────────────────────────────────────────────────────────────
  const weekAgo = addDays(today, -7)
  const { rows: arrivedAll, truncated: coverageShort } = await pageRows<any>((a, b) => sb.from('guesty_reservations')
    .select('id,status,custom_fields').gte('check_in', weekAgo).lt('check_in', today).order('id').range(a, b), 4)
  const arrivedRows = arrivedAll.filter((r: any) => isLiveStay(r.status))
  // A call logged locally counts even if the Guesty field write lagged.
  const arrivedIds = arrivedRows.map((r: any) => String(r.id))
  const arrivedLogs: any[] = arrivedIds.length ? (await Promise.all(
    Array.from({ length: Math.ceil(arrivedIds.length / 200) }, (_, i) => arrivedIds.slice(i * 200, i * 200 + 200))
      .map(chunk => sb.from('guest_calls').select('reservation_id,outcome').eq('kind', 'welcome').in('reservation_id', chunk).then((r: any) => r.data || []))
  )).flat() : []
  const localCalled = new Set(arrivedLogs.filter((l: any) => isCompleted(l.outcome)).map((l: any) => String(l.reservation_id)))
  const arrivedCalled = arrivedRows.filter((r: any) => guestyCalled(r.custom_fields) || localCalled.has(String(r.id))).length

  const isToday = (iso: string) => !!iso && ymdET(new Date(iso)) === today
  const open = rows.filter(r => !r.done && !r.closed)
  const kpis = {
    dueNow: open.filter(r => r.due).length,
    dueToday: open.filter(r => r.dueToday).length,
    lastChance: open.filter(r => r.lastChance).length,
    mandatoryOpen: open.filter(r => r.mandatory && r.due).length,
    mandatoryDoneToday: rows.filter(r => r.mandatory && r.done && isToday(r.calledAt)).length,
    calledToday: rows.filter(r => r.done && isToday(r.calledAt)).length + outRows.filter(r => r.done && isToday(r.calledAt)).length,
    pending: open.length,
    coverage: (coverageShort || !arrivedRows.length) ? null : Math.round((arrivedCalled / arrivedRows.length) * 100),
    coverageOf: arrivedRows.length,
    coverageMissed: arrivedRows.length - arrivedCalled,
    coverageShort,
    recoveryUnits: recovery.size,
    recoveryCalls: open.filter(r => r.recovery).length,
    postDue: outRows.filter(r => !r.done && !r.closed).length,
    closedOut: rows.filter(r => !r.done && r.closed).length + outRows.filter(r => !r.done && r.closed).length,
    recoveryFailed: rec.failed,
  }

  return { today, rows, outRows, recoveryFailed: rec.failed, kpis }
}

// ── THE RECOVERY BOARD (Reviews page) ───────────────────────────────────────────────────────────
// Jon, 2026-09-09: "move review recovery to review section unless it falls into actual welcome
// call". A unit waiting for a good review is a REPUTATION fact, so the list of them — and who is
// booked there next — lives with the reviews. The Calls desk keeps only the recovery arrivals that
// are inside the welcome-call window (today..72h), where they are just mandatory calls like any
// other; this board shows the rest, so the next arrival at a burned unit is visible weeks out
// without cluttering today's call sheet.
export type RecoveryArrival = {
  id: string; guest: string; check_in: string; nights: number; value: number; source: string
  called: boolean            // welcome call already made (Guesty field or local log)
  onDesk: boolean            // inside the welcome-call window → it is on the Calls desk right now
}
export type RecoveryBoardUnit = RecoveryUnit & {
  listing: string; building: string
  arrivals: RecoveryArrival[]   // next arrivals at this unit, soonest first
}
export type RecoveryBoard = { today: string; units: RecoveryBoardUnit[]; failed: boolean; horizonDays: number }

export const RECOVERY_HORIZON_DAYS = 45

export async function loadRecoveryBoard(sb: any, today: string): Promise<RecoveryBoard> {
  const rec = await cachedRecovery().then(e => ({ map: new Map<string, RecoveryUnit>(e), failed: false }))
    .catch(() => ({ map: new Map<string, RecoveryUnit>(), failed: true }))
  const ids = Array.from(rec.map.keys())
  if (!ids.length) return { today, units: [], failed: rec.failed, horizonDays: RECOVERY_HORIZON_DAYS }

  const toDate = addDays(today, RECOVERY_HORIZON_DAYS)
  const dueDate = addDays(today, WELCOME_AHEAD_DAYS)
  const [listings, arrivals] = await Promise.all([
    (async () => {
      const out: any[] = []
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await sb.from('guesty_listings').select('id,nickname,title,building').in('id', ids.slice(i, i + 200))
        out.push(...(data || []))
      }
      return out
    })(),
    (async () => {
      const out: any[] = []
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await sb.from('guesty_reservations')
          .select('id,listing_id,listing_name,guest_name,check_in,nights,status,money_total,source,custom_fields,nightsCount:raw->>nightsCount')
          .in('listing_id', ids.slice(i, i + 100)).gte('check_in', today).lte('check_in', toDate).order('check_in').limit(400)
        out.push(...(data || []))
      }
      return out.filter((r: any) => isLiveStay(r.status))
    })(),
  ])
  const resIds = arrivals.map((r: any) => String(r.id))
  const logs: any[] = resIds.length ? (await Promise.all(
    Array.from({ length: Math.ceil(resIds.length / 200) }, (_, i) => resIds.slice(i * 200, i * 200 + 200))
      .map(chunk => sb.from('guest_calls').select('reservation_id,outcome').eq('kind', 'welcome').in('reservation_id', chunk).then((r: any) => r.data || []))
  )).flat() : []
  const localCalled = new Set(logs.filter((l: any) => isCompleted(l.outcome)).map((l: any) => String(l.reservation_id)))

  const nameOf = new Map<string, { listing: string; building: string }>()
  for (const l of listings) nameOf.set(String(l.id), { listing: String(l.nickname || l.title || ''), building: String(l.building || '') })
  const byListing = new Map<string, RecoveryArrival[]>()
  for (const r of arrivals) {
    const lid = String(r.listing_id || '')
    if (!nameOf.get(lid)?.listing && r.listing_name) nameOf.set(lid, { listing: String(r.listing_name), building: nameOf.get(lid)?.building || '' })
    const check_in = String(r.check_in).slice(0, 10)
    if (!byListing.has(lid)) byListing.set(lid, [])
    byListing.get(lid)!.push({
      id: String(r.id), guest: String(r.guest_name || ''), check_in,
      nights: Number(r.nights) || Number(r.nightsCount) || 0, value: Number(r.money_total) || 0, source: String(r.source || ''),
      called: guestyCalled(r.custom_fields) || localCalled.has(String(r.id)),
      onDesk: check_in <= dueDate,
    })
  }
  const units: RecoveryBoardUnit[] = ids.map(id => {
    const u = rec.map.get(id)!
    const n = nameOf.get(id)
    const building = rollupBuilding(n?.building || n?.listing || '')
    return { ...u, listing: n?.listing || id, building: building === 'Unknown' ? '' : building, arrivals: byListing.get(id) || [] }
  })
  // Soonest next arrival first — that is the unit whose next review is being decided next — then
  // the units nobody is booked into, longest-waiting first.
  units.sort((a, b) => {
    const an = a.arrivals[0]?.check_in || '9999', bn = b.arrivals[0]?.check_in || '9999'
    return an.localeCompare(bn) || (b.openDays - a.openDays)
  })
  return { today, units, failed: rec.failed, horizonDays: RECOVERY_HORIZON_DAYS }
}

/**
 * NIGHTLY CLOSE-OUT. Every call whose grace period has ended without a completed outcome gets an
 * `incomplete` row — tier, scheduled day, attempts so far — so the miss exists as data.
 *
 * Three rules keep it honest:
 *   · It REFUSES to run when the recovery scan failed. Without recovery it cannot tell a
 *     recovery-tier miss from a standard one, or a post-checkout miss from nothing at all — and an
 *     incomplete row is never rewritten, so a wrong tier would be permanent.
 *   · It only sends the columns it means to change. A Postgres upsert leaves unsent columns as they
 *     were, so the claimer's name, the no-answer note and the listing survive on the closed row.
 *   · It RECONCILES: a call Guesty says was made (field ticked) whose local row is still a claim
 *     or a no-answer — the done-path log write is best-effort and can fail — is upgraded to `done`,
 *     so the scoreboard stops counting it as open forever.
 */
export async function closeOutCalls(sb: any, today: string): Promise<{ welcome: number; post: number; reconciled: number; skipped: number; refused?: string }> {
  const d = await loadCallsDesk(sb, today)
  if (d.recoveryFailed) return { welcome: 0, post: 0, reconciled: 0, skipped: 0, refused: 'recovery scan came back short — not closing anything on a partial read' }
  const at = new Date().toISOString()
  let welcome = 0, post = 0, reconciled = 0, skipped = 0
  const write = async (row: Record<string, any>) => {
    const { error } = await sb.from('guest_calls').upsert(row, { onConflict: 'reservation_id,kind' })
    if (error) { skipped++; return false }
    return true
  }
  for (const r of d.rows) {
    if (r.done) {
      // Guesty says called; local row (if any) does not. Upgrade it — or create it, so a call
      // ticked straight in Guesty still counts on the scoreboard (caller unknown).
      if (!r.outcome || !isCompleted(r.outcome)) {
        if (await write({
          reservation_id: r.id, kind: 'welcome', outcome: 'done', tier: r.tier,
          guest_name: r.guest, listing_id: r.listingId || null, ref_date: r.check_in, scheduled_for: r.check_in,
          ...(r.calledBy ? { called_by: r.calledBy } : {}), ...(r.calledAt ? { called_at: r.calledAt } : {}),
        })) reconciled++
      }
      continue
    }
    if (!r.closed || r.incomplete) continue
    if (await write({
      reservation_id: r.id, kind: 'welcome', outcome: 'incomplete', tier: r.tier,
      attempts: r.attempts || 0, guest_name: r.guest, ref_date: r.check_in,
      scheduled_for: r.check_in, closed_at: at, called_at: at,
      ...(r.listingId ? { listing_id: r.listingId } : {}),
    })) welcome++
  }
  for (const r of d.outRows) {
    if (!r.closed || r.done || r.incomplete) continue
    if (await write({
      reservation_id: r.id, kind: 'post_checkout', outcome: 'incomplete', tier: 'post_checkout',
      attempts: r.attempts || 0, guest_name: r.guest, ref_date: r.check_out,
      scheduled_for: r.check_out, closed_at: at, called_at: at,
      ...(r.listingId ? { listing_id: r.listingId } : {}),
    })) post++
  }
  return { welcome, post, reconciled, skipped }
}

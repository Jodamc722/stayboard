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
// Not everyone (Jon, 2026-09-08: "only stays worth a call"). With 200+ units, every checkout is a
// list nobody works. A stay earns the call when there is a reason to think a review is at risk:
//   · a glitch was logged at that unit DURING the stay,
//   · the unit is in recovery (above),
//   · the booking is direct — no OTA to absorb the complaint, and the guest is ours to keep,
//   · or the stay was worth real money (>= HIGH_VALUE).
// Each row carries `reasons`, so the caller opens knowing why they are calling.
import 'server-only'
import { pageRows } from '@/lib/db-page'
import { ratingToStars } from '@/lib/optimize-score'
import { channelOf } from '@/lib/welcome-call-guide'

export const LOW_STARS = 3        // <= this is a bad review (matches ops-brief, review KPIs, review-themes)
export const CLEAR_STARS = 4.5    // a review this good, AFTER the low one, clears the unit
export const HIGH_VALUE = 2500    // a stay worth calling about on money alone

// ── HOW LONG A MISSED CALL STAYS OPEN (Jon, 2026-09-08) ─────────────────────────────────────────
// "If they are past due, allows you 24 hours to complete after arrival or departure, or closes them
// out for welcome call; departure can give you 48 hours."
//
// A welcome call to a guest who landed yesterday is still worth making — they are in the unit and
// something can still be fixed. A welcome call to a guest three days in is not a welcome call, it is
// an apology, and leaving it on the list forever just teaches people to ignore the list. So a call
// stays workable for one day past arrival (two past departure) and is then CLOSED: off the work
// list, still counted as a miss in coverage. Nothing is deleted and nothing is silently forgiven.
//
// These are calendar days in Eastern time, not clock hours. Guesty's check-in times are a listing
// default far more often than the guest's real arrival, so hour-level math here would be spurious
// precision on a number we do not actually have.
export const WELCOME_GRACE_DAYS = 1     // arrival day + 1
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

/** Why this checkout is worth a call. Empty = it is not; the row does not appear. */
export function postCheckoutReasons(opts: { glitches: StayGlitch[]; inRecovery: boolean; source: string; value: number }): CallReason[] {
  const out: CallReason[] = []
  if (opts.glitches.length) out.push('glitch')
  if (opts.inRecovery) out.push('recovery')
  if (channelOf(opts.source) === 'Direct') out.push('direct')
  if (opts.value >= HIGH_VALUE) out.push('value')
  return out
}

export { ymdET }

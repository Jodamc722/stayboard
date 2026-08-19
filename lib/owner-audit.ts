// OWNER STATEMENT AUDIT ENGINE — the end-of-month statement review, computed live.
//
// This is the monthly "owner statement audit" that used to live in a Google Sheet: before the
// statements go out, every reservation on every generated statement gets checked for the things
// that have burned us before. The checks are the ones the audit skill codified:
//
//   1. NEGATIVE RESERVATIONS   rental income below zero — erroneous refunds, chargebacks,
//                              duplicate reversals, data entry.
//   2. LOW NIGHTLY RATE        effective rate under $60/night — but ONLY on the nights that fall
//                              inside the statement month. A Feb 25 – Mar 3 stay shows a few
//                              hundred dollars on the March statement and that is NORMAL; the
//                              rate is computed on in-month nights before anything is flagged.
//   3. ORPHANED REIMBURSEMENTS reimbursement lines (cleaning fee etc.) on a reservation block
//                              with no rental income — there is no booking to justify them.
//   4. REFUNDS                 any "Guest refund"-looking line, captured with its amount, so it
//                              can be verified as authorized.
//   5. ZERO-REVENUE STAYS      $0 reservations that aren't obviously owner stays.
//
// Data comes from the owner-statement mirror (guesty_owner_statements + guesty_owner_ledger,
// recognized rows only — the recognized slice IS the statement, proven by the account-wide
// audit), joined to guesty_reservations for guest/dates/deep-links. Nothing is stored about the
// numbers; only the human review state persists (owner_audit_reviews).
//
// Sign convention, same as lib/owner-statements: ledger amounts are signed from the PM's side,
// so every figure here is flipped to read as OWNER money — positive = money to the owner.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { MONTH_LABEL, money } from './owner-statements'

export type AuditFlagType =
  | 'negative' | 'low_rate' | 'orphan_reimb' | 'refund' | 'zero_rev'
  | 'passthru' | 'no_reservation' | 'commission_off' | 'off_booking' | 'empty_statement' | 'owner_stay'
export type AuditSeverity = 'high' | 'review' | 'info'
export type AuditFlag = { type: AuditFlagType; severity: AuditSeverity; detail: string; amount?: number }

export type AuditLine = { date: string; label: string; code: string; amount: number }
export type AuditComment = { author: string; body: string; at: string }
// THE REVIEW LADDER. Only three of these are ever stored — 'clear' is computed, never written.
//
//   clear   nothing found on this row and nobody needed to look. NOT an accomplishment, and NOT
//           counted as review work: the old model auto-marked every unflagged row 'done', so the
//           board read "1202 of 1254 completed · 96%" when exactly 18 rows had ever been opened
//           by a human. A number that flatters is worse than no number.
//   review  something was flagged and it is waiting on a person.
//   action  a person looked and it needs fixing in Guesty — still open, deliberately.
//   done    a person made the call and closed it out (approved). The ONLY status that counts as
//           completed work, and the only one that can be reached by clicking.
export type AuditStatus = 'review' | 'action' | 'done' | 'clear'
// What a human is allowed to set. 'clear' is the engine's word for "we found nothing", so it can
// never be written in — otherwise a click would erase the distinction the ladder exists to make.
export const WRITABLE_STATUSES: AuditStatus[] = ['review', 'action', 'done']

export type AuditItem = {
  key: string                    // confirmation code, or line:<code>:<label>
  kind: 'reservation' | 'line'
  ownerId: string
  resCode: string                // '' on grouped non-reservation lines
  guest: string
  checkIn: string
  checkOut: string
  totalNights: number            // whole-stay nights; 0 when the reservation is unmatched
  monthNights: number            // nights that fall inside the statement month
  splitMonth: boolean
  listingId: string
  unit: string
  source: string
  reservationId: string          // guesty_reservations.id — powers the "open in Guesty" link
  resNote: string                // Guesty "Reservation Notes" custom field — prior history on the booking
  benchRate: number | null       // expected $/night for THIS stay's night mix (cohort, this + last month, self excluded)
  benchLabel: string             // which cohort: "Botanica 2BR average", "portfolio average", …
  benchPct: number | null        // this stay's rental as % of the expected night-mix revenue
  benchPrev: number | null       // last month's cohort blended average alone, when it has enough nights
  mixWeekday: number             // in-month weekday nights (Sun–Thu)
  mixWeekend: number             // in-month weekend nights (Fri–Sat)
  leadDays: number | null        // days between booking creation and check-in
  // Guesty books these as TWO different things and the team tracks them as two different things:
  // source 'owner' is the owner in their own unit, 'owner-guest' is somebody the owner sent.
  // Collapsing them into one "Owner stay" tag lost the distinction that decides who gets asked
  // about the cleaning. 'ff' stays in the vocabulary for accounts that tag friends & family.
  stayTag: 'owner' | 'owner_guest' | 'ff' | null
  canceled: boolean              // reservation is canceled — partial payout/cancel fee expected
  statusTag: 'canceled' | 'inquiry' | 'declined' | 'expired' | null   // any non-normal booking status, shown as a tag
  rental: number
  commission: number
  other: number
  net: number
  rate: number | null            // in-month rental / in-month nights (what the statement shows)
  avgRate: number | null         // THE JUDGED RATE: whole-reservation accommodation value / total
                                 // nights (folio-based, immune to partially-posted ledgers)
  lines: AuditLine[]             // capped for payload size — see lineCount
  lineCount: number              // how many statement line items this row REALLY has, so the
                                 // detail never shows a truncated table that quietly fails to add up
  lastPosted: string             // newest line-item date on this row — the heartbeat that lets the
                                 // team work the month WEEKLY: "what posted since I last looked"
                                 // instead of re-reading everything on statement day
  // HOW THE ROW'S TOTAL WAS BUILT, and what the booking itself says — the two numbers the team
  // kept finding side by side without an explanation.
  posted: number                 // everything credited to the owner this month on this booking
  reversed: number               // everything taken back this month (corrections, cancellations)
  resValue: number | null        // the reservation's own total in Guesty (folio), null if unmatched
  flags: AuditFlag[]
  needsReview: boolean           // carries at least one flag above informational
  status: AuditStatus
  touched: boolean               // true when a human explicitly set the status
  note: string
  comments: AuditComment[]
  updatedBy: string | null
  updatedAt: string | null
}

// The formal per-statement sign-off: stored in owner_audit_reviews under the reserved
// item_key '__statement__' so no schema change is needed. Present = signed off.
export type AuditSignOff = { by: string; at: string }

// OWNER PREP — the Expedia fee breakout. Expedia-family bookings (Expedia, Hotels.com,
// Orbitz, Travelocity…) land with their fees lump-summed into the nightly income: in June
// 2026 only 15 of 102 such reservations carried a separate Cleaning-fee line and only 7 an
// RM line. Statement prep = every one gets its fees broken out into Cleaning fee + RM fees
// ON THE RESERVATION IN GUESTY. The app TRACKS the work (deep link to edit, mark done —
// no amounts entered here). The list is pulled from the month's RESERVATIONS, not from
// what happens to already sit on a statement. Done-marks live in owner_audit_reviews under
// item_key 'prep:<code>' with owner_id '-' (owner attribution can change as statements
// generate, the reservation code doesn't).
export const PREP_OWNER = '-'
export type PrepItem = {
  ownerId: string                // owning statement's owner id when known, '' otherwise
  ownerName: string
  resCode: string
  guest: string
  unit: string
  checkIn: string
  checkOut: string
  source: string
  reservationId: string
  onStatement: boolean           // ledger activity for this code exists this month
  rental: number                 // in-month rental on the statement (0 when not on one yet)
  monthNights: number
  cleaningAmt: number | null     // cleaning-fee lines already on the statement (null = none)
  rmAmt: number | null           // RM lines already on the statement (null = none)
  // What the GUEST FOLIO (raw.money.invoiceItems) already shows — the split is normally done
  // there, as separate "Cleaning fee" and "Revenue Fee" items with the lump zeroed out.
  folioClean: number | null      // cleaning-fee folio items (null = folio unavailable)
  folioRm: number | null         // revenue-fee folio items
  folioLump: number | null       // "Additional Fees & Room Fees" lump still on the folio
  splitDone: boolean             // folio carries both Cleaning + Revenue items — already broken out
  noFees: boolean                // folio has NO fee lump and NO fee items — fees never set up (warning)
  saved: { by: string; at: string } | null
  note: string                   // free-form prep note, always visible
}

export type AuditOwner = {
  ownerId: string
  ownerName: string
  hasStatement: boolean
  dueToOwner: number | null
  rental: number
  commission: number
  other: number
  net: number
  paid: number                   // PO total — money that actually moved to the owner
  hasPayout: boolean             // a payout has posted for this statement (PO rows exist)
  ties: boolean                  // earnings match the payout, or the balance when none has posted
  stmtStatus: string             // Guesty's own status: PENDING = still a draft being built
  isDraft: boolean               // PENDING/DRAFT — its balance is provisional and moves
  generatedAt: string            // when Guesty last (re)generated this statement
  items: number                  // count; the items themselves live in the flat list
  open: number                   // items waiting on a person (review + action)
  done: number                   // items a person approved and closed
  clear: number                  // items with nothing flagged — no human decision needed
  high: number                   // items carrying a HIGH flag
  reviewFlags: number            // items carrying a review-severity flag (and no high)
  notes: number                  // items with an audit note
  commentCount: number           // total comments across the owner's items
  signOff: AuditSignOff | null
  stmtNote: string               // statement-level note (stored on the __statement__ row)
}

export type AuditMonthPick = { m: string; label: string; statements: number }

export type AuditData = {
  month: string
  label: string
  owners: AuditOwner[]
  items: AuditItem[]
  totals: {
    owners: number; statements: number; reservations: number
    flagged: number; high: number
    review: number; action: number; done: number; clear: number
    postedThisWeek: number       // rows with line items posted in the last 7 days — the weekly worklist
    signedOff: number
    prepOpen: number
    rental: number; commission: number; net: number; paid: number; dueToOwner: number
  }
  // syncedAt = when the mirror last finished sweeping THIS month from Guesty. Shown on the board:
  // an audit run against stale accounting data is worse than no audit, and a dead sync is invisible
  // unless the page says so out loud.
  coverage: {
    ready: boolean; missing: string[]; syncedAt: string | null
    resScanned: number          // reservations touching the month, scanned for owner / F&F stays
    ownerStaysFound: number     // how many of them matched — 0 means the markers are not where we look
  }
  rules: AuditRules
  prep: PrepItem[]
  resolutions: { claims: ResolutionClaim[]; lines: ResolutionLine[] }
}

// Expedia-family sources whose fees arrive lump-summed and need the prep breakout.
export const EXPEDIA_RE = /expedia|orbitz|travelocity|hotels\.com|hotelscom|\bhotels\b|wotif|ebookers|cheaptickets/i
const PREP_CLEAN_RE = /clean/i
const PREP_RM_RE = /revenue management|\brm\b/i
/** Reserved item_key prefix for prep breakout rows. */
export const PREP_PREFIX = 'prep:'

// ── AIRBNB RESOLUTIONS (prep review) ─────────────────────────────────────────
// Statement prep also reconciles Airbnb Resolution Center money: every resolution decided or
// paid in the month must land on the right owner's statement. Claims come from the /claims
// board; the cross-check is whether a resolution-looking ledger line exists on the same
// reservation code this month.
export const RESOLUTION_RE = /resolution|aircover|damage protection|guest damage/i
export type ResolutionClaim = {
  id: string
  guest: string
  property: string
  unit: string
  resCode: string
  reservationId: string
  stage: string                  // submitted | decided | settle | closed | …
  amountSought: number | null
  amountPaid: number | null
  decidedOn: string
  paidOn: string
  summary: string
  onStatement: boolean           // a resolution ledger line exists for this code this month
  stmtAmount: number | null      // what that ledger line(s) put on the statement
  note: string                   // free-form review note (stored under item_key resl:<id>)
}
export type ResolutionLine = {
  ownerId: string
  ownerName: string
  resCode: string                // '' when the line isn't attached to a reservation
  label: string
  date: string
  amount: number                 // owner effect
  hasClaim: boolean              // a claims-board record matches this code
}

/** Reserved item_key for the per-statement sign-off row. */
export const SIGNOFF_KEY = '__statement__'

// Guesty's "Reservation Notes" custom field — same field lib/claim-note writes.
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'
const cfFieldId = (c: any): string => String((c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : '') || c?._id || '')
export function reservationNoteOf(customFields: any): string {
  if (!Array.isArray(customFields)) return ''
  const f = customFields.find((c: any) => cfFieldId(c) === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || '')))
  return f && typeof f.value === 'string' ? f.value : ''
}

const REFUND_RE = /refund/i
const REIMB_RE = /reimburs|cleaning/i
const OWNERISH_RE = /owner/i
// Guesty's own two source values: 'owner' (the owner staying) and 'owner-guest' (their guest).
const OWNER_GUEST_RE = /owner[-_ ]?guest/i
// Guesty posts owner-side charges as a bare "Owner charge" with no charge code. On an owner stay
// that is nearly always the cleaning fee; anywhere else it is money the owner is paying for
// something, and either way somebody should be able to say what.
const OWNER_CHARGE_RE = /owner\s*charge/i
// A turnover costs $125–150 across this portfolio. Up to this much, a bare owner charge reads as
// the cleaning; past it we say "large owner charge" instead, because Rock Soffer's −$10,051.40 is
// plainly something else and guessing "cleaning" at that size would be worse than saying nothing.
const CLEANING_LIKELY_MAX = 400
export const STAY_LABEL: Record<'owner' | 'owner_guest' | 'ff', string> = {
  owner: 'Owner stay', owner_guest: 'Owner’s guest', ff: 'Friends & family stay',
}
// Friends & family markers — matched against Guesty tags, source and guest name. These stays
// are discounted on purpose, so they get TAGGED and their low-rate reads as informational.
const FF_RE = /friends?\s*(&|and)\s*family|\bf\s*&\s*f\b|\bfnf\b|\bff\b|friends?[-_ ]?family|family[-_ ]?friends?|\bcomp(ed|limentary)?\b/i

// THE owner / friends-&-family test. Exported because this is a business law, not a local detail:
// an owner hold and an F&F comp are inventory decisions, so they must never be read as a pricing
// error (owner audit) OR as a guest walking away (revenue cancel rate). One definition, imported
// everywhere — the audit found this same regex pair silently re-implemented across the app.
export function isOwnerOrFriendsFamily(source: string, tagBlob: string, guestName: string): boolean {
  return FF_RE.test(tagBlob) || FF_RE.test(guestName)
    || OWNERISH_RE.test(source) || OWNERISH_RE.test(tagBlob) || OWNERISH_RE.test(guestName)
}

// ── EDITABLE RULES ────────────────────────────────────────────────────────────
// The thresholds behind the flags are policy, not physics. Stored in app_settings (JSON over
// TEXT, via lib/app-settings) and merged over these defaults, so a missing or mangled setting
// can never change what the audit flags — it just falls back.
//
// LOW RATE has two modes. A flat $/night threshold treats a $500/n three-bedroom and a $70/n
// studio as the same animal — so the default mode is RELATIVE: each reservation's in-month
// rate is compared to the average rate of its cohort this month (same building + same bedroom
// count, falling back to the whole building, then portfolio same-size, then portfolio), with
// the reservation's own nights excluded so a night is judged against the OTHER nights around
// it. A hard floor still catches absurd rates even when a whole cohort is cheap.
// The comparison is NIGHT-MIX AWARE: cohort averages are computed separately for weekday
// nights (Sun–Thu) and weekend nights (Fri–Sat) from the per-night AF lines, and each stay
// is judged against the expected revenue for ITS OWN mix of nights — a midweek booking is
// compared to the cohort's midweek pricing, never punished for missing the weekend premium.
// It is also LEAD-TIME AWARE: last-minute bookings (booked within lastMinDays of check-in)
// get a relaxed bar (lastMinExtra points lower) because rates are cut to fill those nights.
export type LowRateMode = 'relative' | 'absolute'
export type AuditRules = {
  lowRateMode: LowRateMode
  lowRatePct: number                           // relative: flag under this % of the expected night-mix revenue
  lowRateFloor: number                         // relative: always flag under this $/night
  lastMinDays: number                          // booked ≤ this many days before check-in = last-minute
  lastMinExtra: number                         // extra percentage points of slack for last-minute bookings
  lowRate: number                              // absolute mode: flag when in-month $/night falls below this
  passthruLo: number                           // commission/rental band treated as a wash
  passthruHi: number
  commTolerance: number                        // flag when commission % strays this many points from the owner's usual rate
  offBookingMin: number                        // $ from this size up, money with no room revenue behind it needs a look
  enabled: Record<AuditFlagType, boolean>      // per-flag kill switch
}
export const DEFAULT_AUDIT_RULES: AuditRules = {
  lowRateMode: 'relative', lowRatePct: 55, lowRateFloor: 30,
  lastMinDays: 3, lastMinExtra: 20,
  lowRate: 60, passthruLo: 0.9, passthruHi: 1.1,
  commTolerance: 5,
  // $25, not $250. At $250 the board filed a −$160.05 owner charge, a −$112.14 charge and six
  // more under "No issues found" — money moving with no booking behind it, invisible. The team's
  // own spreadsheet caught every one of them.
  offBookingMin: 25,
  enabled: { negative: true, low_rate: true, orphan_reimb: true, refund: true, zero_rev: true, passthru: true, no_reservation: true, commission_off: true, off_booking: true, empty_statement: true, owner_stay: true },
}
export const AUDIT_RULES_KEY = 'owner_audit_rules'

// A cohort average is only trusted when built on at least this many OTHER in-month nights;
// thinner cohorts fall through to the next wider one.
const BENCH_MIN_NIGHTS = 20

const num = (v: any, fb: number) => { const n = Number(v); return Number.isFinite(n) ? n : fb }

function sanitizeRules(s: any, base: AuditRules): AuditRules {
  const enabled: Record<AuditFlagType, boolean> = { ...base.enabled }
  if (s?.enabled && typeof s.enabled === 'object') {
    for (const k of Object.keys(enabled) as AuditFlagType[]) {
      if (typeof s.enabled[k] === 'boolean') enabled[k] = s.enabled[k]
    }
  }
  return {
    lowRateMode: s?.lowRateMode === 'absolute' ? 'absolute' : s?.lowRateMode === 'relative' ? 'relative' : base.lowRateMode,
    lowRatePct: Math.min(95, Math.max(10, num(s?.lowRatePct, base.lowRatePct))),
    lowRateFloor: Math.max(0, num(s?.lowRateFloor, base.lowRateFloor)),
    lastMinDays: Math.min(30, Math.max(0, Math.round(num(s?.lastMinDays, base.lastMinDays)))),
    lastMinExtra: Math.min(40, Math.max(0, num(s?.lastMinExtra, base.lastMinExtra))),
    lowRate: Math.max(0, num(s?.lowRate, base.lowRate)),
    passthruLo: Math.min(1, Math.max(0.5, num(s?.passthruLo, base.passthruLo))),
    passthruHi: Math.max(1, Math.min(2, num(s?.passthruHi, base.passthruHi))),
    commTolerance: Math.min(30, Math.max(1, num(s?.commTolerance, base.commTolerance))),
    offBookingMin: Math.max(0, num(s?.offBookingMin, base.offBookingMin)),
    enabled,
  }
}

export async function auditRules(): Promise<AuditRules> {
  const s = await getSetting<any>(AUDIT_RULES_KEY, null)
  const d: AuditRules = { ...DEFAULT_AUDIT_RULES, enabled: { ...DEFAULT_AUDIT_RULES.enabled } }
  if (!s || typeof s !== 'object') return d
  return sanitizeRules(s, d)
}

export async function saveAuditRules(patch: any, by: string): Promise<AuditRules> {
  const cur = await auditRules()
  const next = sanitizeRules(patch, cur)
  const w = await setSetting(AUDIT_RULES_KEY, next, by)
  if (!w.ok) throw new Error('rules save: ' + (w.error || 'failed'))
  return next
}

type LedgerRow = {
  owner_id: string | null
  listing_id: string | null
  entry_date: string | null
  charge_code: string | null
  amount: number | null
  name?: string | null
  res?: string | null
}

const LEDGER_COLS = "owner_id, listing_id, entry_date, charge_code, amount, name:raw->>name, res:raw->reservationConfirmationCode->>title"
const LEDGER_COLS_PLAIN = 'owner_id, listing_id, entry_date, charge_code, amount'

function monthWindow(month: string): { start: string; endExcl: string; days: number } {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const endExcl = new Date(Date.UTC(y, m, 1))
  return {
    start: start.toISOString().slice(0, 10),
    endExcl: endExcl.toISOString().slice(0, 10),
    days: Math.round((endExcl.getTime() - start.getTime()) / 86400000),
  }
}

// Nights of [checkIn, checkOut) that fall inside [start, endExcl).
function nightsWithin(checkIn: string, checkOut: string, start: string, endExcl: string): number {
  const a = checkIn > start ? checkIn : start
  const b = checkOut < endExcl ? checkOut : endExcl
  if (a >= b) return 0
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000)
}

/**
 * Months for the picker, newest first: every month with generated statements PLUS the
 * current and previous calendar months even when their statements don't exist yet — the
 * PREP work (Expedia fee breakout) starts from reservations before statements generate.
 */
export async function auditMonths(limit = 24): Promise<AuditMonthPick[]> {
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('guesty_owner_statements')
    .select('period_month')
    .not('period_month', 'is', null)
    .order('period_month', { ascending: false })
    .limit(5000)
  if (error) throw new Error('statement months read: ' + error.message)
  const counts: Record<string, number> = {}
  for (const r of (data || []) as any[]) {
    const m = String(r.period_month || '')
    if (m) counts[m] = (counts[m] || 0) + 1
  }
  const now = new Date()
  const cur = now.toISOString().slice(0, 7)
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
  if (counts[cur] === undefined) counts[cur] = 0
  if (counts[prev] === undefined) counts[prev] = 0
  return Object.keys(counts).sort().reverse().slice(0, limit)
    .map(m => ({ m, label: MONTH_LABEL(m), statements: counts[m] }))
}

/**
 * The month the team is actually working: the previous calendar month (month-end review
 * happens after the month closes) — unless newer statements already exist.
 */
export function defaultAuditMonth(months: AuditMonthPick[]): string {
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
  const withStmts = months.filter(x => x.statements > 0).map(x => x.m).sort().reverse()[0] || ''
  const pick = withStmts > prev ? withStmts : prev
  return months.some(x => x.m === pick) ? pick : (months[0]?.m || '')
}

/** Build the whole audit for one statement month. */
export async function buildAudit(month: string): Promise<AuditData> {
  const sb = supabaseAdmin()
  const win = monthWindow(month)
  const rules = await auditRules()

  // 1. The generated statements for this month — the documents being audited.
  //    stmtStatus matters more than it looks: a PENDING statement is a DRAFT that Guesty is still
  //    building, and its dueToOwner is recomputed on every pull (3020 Seville regenerated at
  //    15:54 on 2026-08-12, three minutes after a sync). Comparing our line-item total against a
  //    draft balance and calling the difference "off" is how the board spent a week reporting a
  //    $113k problem that did not exist. Status comes along so the UI can say draft out loud.
  const stmtCols = 'id, owner_id, owner_name, period_month, due_to_owner'
  let { data: stmtRows, error: stErr } = await sb.from('guesty_owner_statements')
    .select(stmtCols + ', stmt_status:raw->>status, stmt_generated_at:raw->>generatedAt')
    .eq('period_month', month)
  if (stErr) {
    // The mirror refused the JSON accessors — never lose the audit over a status label.
    const plain = await sb.from('guesty_owner_statements').select(stmtCols).eq('period_month', month)
    stmtRows = plain.data as any[]
    stErr = plain.error
  }
  if (stErr) throw new Error('statements read: ' + stErr.message)
  const stmts = (stmtRows || []) as any[]
  const stmtByOwner: Record<string, any> = {}
  for (const s of stmts) stmtByOwner[String(s.owner_id || '')] = s

  // 2. Ledger coverage — has the mirror actually swept this month, and how long ago?
  const { data: cov } = await sb.from('guesty_ledger_months').select('month, status, completed_at').eq('month', month)
  const covRows = (cov || []) as any[]
  const covered = covRows.some(r => r.status === 'done')
  const syncedAt = covRows
    .map(r => (r.completed_at ? String(r.completed_at) : ''))
    .filter(Boolean)
    .sort()
    .pop() || null

  // 3. Every recognized ledger row for the month. Scalar selects only (PERF LAW: never pull
  //    whole raw JSONB over thousands of rows); falls back to a plain select if the mirror
  //    refuses the JSON accessors, so the audit is never lost over a label.
  const rows: LedgerRow[] = []
  const PAGE = 1000
  let named = true
  for (let off = 0; off < 200_000; off += PAGE) {
    const run = (cols: string) => sb.from('guesty_owner_ledger').select(cols)
      .eq('recognized', true)
      .eq('entry_month', month)
      .range(off, off + PAGE - 1)
    let { data, error } = await run(named ? LEDGER_COLS : LEDGER_COLS_PLAIN)
    if (error && named) {
      named = false
      ;({ data, error } = await run(LEDGER_COLS_PLAIN))
    }
    if (error) throw new Error('ledger read: ' + error.message)
    const batch = (data || []) as unknown as LedgerRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }

  // 4. Group by owner, then by reservation code (or grouped line for codeless rows).
  type Group = {
    ownerId: string; resCode: string; lineKey: string
    rental: number; commission: number; other: number; paid: number
    posted: number                 // every positive line this month (income + credits)
    reversed: number               // every negative line this month (corrections, fees, reversals)
    lines: AuditLine[]; afDates: Set<string>; afAmtByDate: Record<string, number>
    listingIds: Record<string, number>
  }
  const groups: Record<string, Group> = {}
  const owners: Record<string, AuditOwner> = {}
  const resLedger: ResolutionLine[] = []
  // Per-night rental for the whole month, keyed listing|date — the raw material for the
  // weekday/weekend cohort averages. AF lines are per-night; adjustments on the same night
  // sum into one figure.
  const curPerNight: Record<string, number> = {}

  const ownerOf = (id: string): AuditOwner => owners[id] || (owners[id] = {
    ownerId: id, ownerName: '', hasStatement: !!stmtByOwner[id],
    dueToOwner: stmtByOwner[id] ? (Number(stmtByOwner[id].due_to_owner ?? 0) || 0) : null,
    stmtStatus: String(stmtByOwner[id]?.stmt_status || ''),
    isDraft: /pending|draft/i.test(String(stmtByOwner[id]?.stmt_status || '')),
    generatedAt: String(stmtByOwner[id]?.stmt_generated_at || ''),
    rental: 0, commission: 0, other: 0, net: 0, paid: 0, hasPayout: false, ties: false, items: 0, open: 0,
    done: 0, clear: 0, high: 0, reviewFlags: 0, notes: 0, commentCount: 0, signOff: null, stmtNote: '',
  })

  for (const r of rows) {
    const ownerId = String(r.owner_id || '')
    if (!ownerId) continue                       // unattributable rows can't sit on a statement
    const o = ownerOf(ownerId)
    const code = String(r.charge_code || '')
    const amt = Number(r.amount) || 0
    const eff = money(-amt)                      // owner effect: positive = money to the owner
    if (code === 'PO') { o.paid = money(o.paid + amt); continue }

    const label = String(r.name || '').trim() || code || '(no code)'
    const res = String(r.res || '').trim()
    const lineKey = res ? '' : 'line:' + code + ':' + label.slice(0, 80)
    const gKey = ownerId + '|' + (res || lineKey)
    const g = groups[gKey] || (groups[gKey] = {
      ownerId, resCode: res, lineKey,
      rental: 0, commission: 0, other: 0, paid: 0, posted: 0, reversed: 0,
      lines: [], afDates: new Set(), afAmtByDate: {}, listingIds: {},
    })

    // POSTED vs REVERSED. The month's total for a booking is a running sum, not a single figure:
    // Guesty posts the income and then posts corrections against it (a cancellation books $692.44
    // and then reverses $275.00). The team kept opening a reservation, seeing one number, and
    // finding another on the statement — so both halves are carried through to the row.
    if (eff >= 0) g.posted = money(g.posted + eff)
    else g.reversed = money(g.reversed + eff)

    if (code === 'AF') {
      g.rental = money(g.rental + eff)
      const d = String(r.entry_date || '')
      if (d) {
        g.afDates.add(d)
        g.afAmtByDate[d] = money((g.afAmtByDate[d] || 0) + eff)
        const lid = String(r.listing_id || '')
        if (lid) curPerNight[lid + '|' + d] = money((curPerNight[lid + '|' + d] || 0) + eff)
      }
    }
    else if (code === 'CMS') g.commission = money(g.commission - eff)   // positive = fee taken
    else g.other = money(g.other + eff)
    if (r.listing_id) g.listingIds[String(r.listing_id)] = (g.listingIds[String(r.listing_id)] || 0) + 1
    g.lines.push({ date: String(r.entry_date || ''), label, code, amount: eff })

    // Resolution-looking money on the statement — the reconciliation target for the
    // Airbnb Resolutions review on the Prep tab.
    if (RESOLUTION_RE.test(label)) {
      resLedger.push({ ownerId, ownerName: '', resCode: res, label, date: String(r.entry_date || ''), amount: eff, hasClaim: false })
    }

    if (code === 'AF') o.rental = money(o.rental + eff)
    else if (code === 'CMS') o.commission = money(o.commission - eff)
    else o.other = money(o.other + eff)
    o.net = money(o.net + eff)
  }

  // Owners with a statement but no ledger activity still need a section (blank month, or the
  // ledger sweep missed them) — the reviewer should see them rather than not know they exist.
  for (const s of stmts) ownerOf(String(s.owner_id || ''))

  // 5. Names for owners + listings, and the reservation join.
  const ownerIds = Object.keys(owners)
  const codes = Array.from(new Set(Object.values(groups).map(g => g.resCode).filter(Boolean)))
  const listingIds = new Set<string>()
  for (const g of Object.values(groups)) for (const id of Object.keys(g.listingIds)) listingIds.add(id)

  const resByCode: Record<string, any> = {}
  for (let i = 0; i < codes.length; i += 200) {
    const { data } = await sb.from('guesty_reservations')
      .select("id, confirmation_code, guest_name, check_in, check_out, nights, status, source, listing_id, created_at, money_total, custom_fields, tags:raw->tags, fare:raw->money->>fareAccommodation")
      .in('confirmation_code', codes.slice(i, i + 200))
    for (const r of (data || []) as any[]) {
      const c = String(r.confirmation_code || '')
      // Prefer a confirmed/completed booking if the code somehow appears twice.
      if (!resByCode[c] || String(r.status || '') === 'confirmed') resByCode[c] = r
      if (r.listing_id) listingIds.add(String(r.listing_id))
    }
  }

  // 5a-bis. Every Expedia-family reservation touching the statement month — the PREP list
  // comes from RESERVATIONS, so bookings show up to be worked even before (or without) a
  // generated statement carrying them.
  const expRes: any[] = []
  {
    const { data } = await sb.from('guesty_reservations')
      .select('id, confirmation_code, guest_name, check_in, check_out, status, source, listing_id')
      .gt('check_out', win.start).lt('check_in', win.endExcl)
      .not('status', 'in', '(canceled,cancelled,inquiry,declined,expired)')
      .or('source.ilike.%expedia%,source.ilike.%orbitz%,source.ilike.%travelocity%,source.ilike.%hotels%,source.ilike.%wotif%,source.ilike.%ebookers%,source.ilike.%cheaptickets%')
      .limit(1000)
    // The mirror holds some bookings TWICE (17 duplicate rows found in July 2026 — same code and
    // listing, different mirror ids). Every scan that reads reservations dedupes on the code, or
    // the board shows the same guest twice and every total built from the scan is inflated.
    const seenExp = new Set<string>()
    for (const r of (data || []) as any[]) {
      if (!EXPEDIA_RE.test(String(r.source || ''))) continue
      const k = String(r.confirmation_code || r.id || '')
      if (seenExp.has(k)) continue
      seenExp.add(k)
      expRes.push(r)
      if (r.listing_id) listingIds.add(String(r.listing_id))
    }
  }

  // 5a-ter. OWNER AND FRIENDS-&-FAMILY STAYS COME FROM RESERVATIONS, NOT FROM MONEY.
  // They are the one thing on an owner statement that can be worth $0.00 and still matter: nights
  // taken off the market, a cleaning somebody has to pay for, and occasionally a booking tagged
  // "owner" that nobody authorised. Because they carry no ledger money, they produced no group and
  // no row — the board tagged 0 of 1,292 rows while the team's spreadsheet listed 15 by hand.
  // So they are pulled from the month's reservations and joined in below, statement money or not.
  const ownerStayRes: any[] = []
  const seenOwnerStay = new Set<string>()   // the mirror duplicates bookings — dedupe on the code
  let ownerScanCount = 0
  // PAGED, not limited. A plain .limit() stops at the mirror's 1,000-row ceiling — July touches
  // more reservations than that, so a single call silently scanned part of the month and any owner
  // stay past the cut would have been missed exactly like before.
  for (let off = 0; off < 20_000; off += PAGE) {
    const { data, error } = await sb.from('guesty_reservations')
      .select('id, confirmation_code, guest_name, check_in, check_out, nights, status, source, listing_id, money_total, tags:raw->tags')
      .gt('check_out', win.start).lt('check_in', win.endExcl)
      .range(off, off + PAGE - 1)
    if (error) break
    const batch = (data || []) as any[]
    ownerScanCount += batch.length
    for (const r of batch) {
      const tagBlob = Array.isArray((r as any).tags) ? (r as any).tags.map((t: any) => String(t)).join(' ') : ''
      if (!isOwnerOrFriendsFamily(String(r.source || ''), tagBlob, String(r.guest_name || ''))) continue
      const k = String(r.confirmation_code || r.id || '') + '|' + String(r.listing_id || '')
      if (seenOwnerStay.has(k)) continue
      seenOwnerStay.add(k)
      ownerStayRes.push(r)
      if (r.listing_id) listingIds.add(String(r.listing_id))
    }
    if (batch.length < PAGE) break
  }

  // Guest-folio invoice items — the fee split is normally done HERE ("Cleaning fee" + "Revenue
  // Fee" items, lump zeroed), and it does not surface in the owner ledger. Fetched for the Expedia
  // prep set AND for owner / owner-guest stays, because on an owner stay THE FOLIO IS THE ANSWER:
  // the accommodation revenue may be anything, but the cleaning fee has to be charged to the owner
  // there, and a statement with no CF line does not prove it is missing.
  const folioByRes: Record<string, any[]> = {}
  {
    const ids = Array.from(new Set([...expRes, ...ownerStayRes].map(r => String(r.id || '')).filter(Boolean)))
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await sb.from('guesty_reservations')
        .select('id, inv:raw->money->invoiceItems')
        .in('id', ids.slice(i, i + 100))
      for (const r of (data || []) as any[]) {
        folioByRes[String(r.id)] = Array.isArray((r as any).inv) ? (r as any).inv : []
      }
    }
  }

  // 5b. Last month's AF rows — rate context for the relative low-rate rule. AF lines are
  // per-night, so distinct (listing, date) counts nights without needing the reservation
  // join (two bookings can't occupy the same unit on the same night). Best-effort: a read
  // error here degrades to "no last-month context", never a lost audit.
  const prevMonth = (() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) })()
  const prevPerNight: Record<string, number> = {}               // listing|date -> owner-effect rental
  for (let off = 0; off < 100_000; off += PAGE) {
    const { data, error } = await sb.from('guesty_owner_ledger')
      .select('listing_id, entry_date, amount')
      .eq('recognized', true).eq('entry_month', prevMonth).eq('charge_code', 'AF')
      .range(off, off + PAGE - 1)
    if (error) break
    const batch = (data || []) as any[]
    for (const r of batch) {
      const lid = String(r.listing_id || '')
      const d = String(r.entry_date || '')
      if (!lid || !d) continue
      prevPerNight[lid + '|' + d] = money((prevPerNight[lid + '|' + d] || 0) - (Number(r.amount) || 0))
      listingIds.add(lid)
    }
    if (batch.length < PAGE) break
  }

  const [{ data: ownerRows }, { data: listingRows }] = await Promise.all([
    ownerIds.length
      ? sb.from('guesty_owners').select('id, full_name').in('id', ownerIds)
      : Promise.resolve({ data: [] } as any),
    listingIds.size
      ? sb.from('guesty_listings').select('id, nickname, title, building, unit, bedrooms').in('id', Array.from(listingIds))
      : Promise.resolve({ data: [] } as any),
  ])
  const ownerName: Record<string, string> = {}
  for (const o of (ownerRows || []) as any[]) ownerName[String(o.id)] = String(o.full_name || '')
  const unitOf: Record<string, string> = {}
  const bldgOf: Record<string, string> = {}
  const bedsOf: Record<string, number> = {}
  for (const l of (listingRows || []) as any[]) {
    const id = String(l.id)
    unitOf[id] = String(l.nickname || l.title || (l.building ? l.building + '/' + (l.unit ?? '') : '') || l.id)
    bldgOf[id] = String(l.building || '')
    bedsOf[id] = Number(l.bedrooms) || 0
  }

  // WHAT THE OWNER IS ACTUALLY PAID, AND WHAT WE CAN HONESTLY COMPARE IT TO.
  //
  //   net           earnings built from the statement's own line items (rental − commission + fees)
  //   paid          PO rows: money that actually MOVED to the owner. The real payout.
  //   dueToOwner    the statement's closing BALANCE — not earnings. It carries prior balances and
  //                 statement-level deductions, which is why 28 July owners looked "off by
  //                 +$113,067" (a consistent 19–26% of net) when nothing was wrong: earnings were
  //                 being subtracted from a balance. The account-wide audit found the same thing —
  //                 40 of 59 non-tying months tied exactly against the PO total instead.
  //
  // So the tie is judged against the payout when one has posted, and against the balance only as
  // a fallback. When neither matches we say WHICH comparison failed rather than calling it "off".
  for (const o of Object.values(owners)) {
    o.ownerName = String(stmtByOwner[o.ownerId]?.owner_name || ownerName[o.ownerId] || '(unnamed)')
    o.hasPayout = Math.abs(o.paid) > 0.5
    o.ties = o.hasPayout
      ? Math.abs(o.net - o.paid) < 0.02
      : (o.dueToOwner != null && Math.abs(o.net - o.dueToOwner) < 0.02)
  }

  // 6. Reviews already saved for this month.
  const { data: revRows, error: revErr } = await sb.from('owner_audit_reviews')
    .select('owner_id, item_key, status, note, comments, updated_by, updated_at')
    .eq('month', month)
  // A missing table (migration not run yet) degrades to "no reviews saved", never to a 500.
  const reviews: Record<string, any> = {}
  const prepSaved: Record<string, { by: string; at: string }> = {}
  const prepNote: Record<string, string> = {}
  const reslNote: Record<string, string> = {}
  if (!revErr) for (const r of (revRows || []) as any[]) {
    const key = String(r.item_key)
    if (key.startsWith(PREP_PREFIX)) {
      // Keyed by CODE only — prep rows are stored under owner '-' (older rows may carry a
      // real owner id; the code is what identifies the reservation either way).
      const code = key.slice(PREP_PREFIX.length)
      if (String(r.status) === 'done') prepSaved[code] = { by: String(r.updated_by || ''), at: String(r.updated_at || '') }
      if (r.note) prepNote[code] = String(r.note)
      continue
    }
    if (key.startsWith('resl:')) {
      if (r.note) reslNote[key.slice(5)] = String(r.note)
      continue
    }
    if (key === SIGNOFF_KEY) {
      // Sign-off rows are owner-level, not items. status 'done' = signed off; anything else
      // (a cleared sign-off) reads as not signed. The note rides along either way.
      const o = owners[String(r.owner_id)]
      if (o) {
        if (String(r.status) === 'done') o.signOff = { by: String(r.updated_by || ''), at: String(r.updated_at || '') }
        if (r.note) o.stmtNote = String(r.note)
      }
      continue
    }
    reviews[String(r.owner_id) + '|' + key] = r
  }

  // 7. Items + flags — two passes. Pass A computes each group's dates/nights/rate; the rate
  // cohorts are built from the PER-NIGHT AF lines, split into weekday (Sun–Thu) and weekend
  // (Fri–Sat) nights, so every stay is judged against the expected revenue for ITS OWN mix
  // of nights rather than a blended average that punishes midweek bookings.
  type Pre = {
    g: Group; res: any; bestListing: string
    checkIn: string; checkOut: string; totalNights: number; monthNights: number
    splitMonth: boolean; net: number; rate: number | null
    avgRate: number | null       // whole-reservation value / total nights (the judged rate)
    stayDates: string[]          // in-month night dates (ledger leave-one-out basis)
    mixWeekday: number; mixWeekend: number   // FULL-STAY night mix when dates known
    leadDays: number | null
  }
  const pres: Pre[] = []

  const isWeekendNight = (d: string) => { const dow = new Date(d + 'T00:00:00Z').getUTCDay(); return dow === 5 || dow === 6 }
  const cohortKeys = (lid: string): [string, string][] => {
    const b = bldgOf[lid] || ''
    const bd = bedsOf[lid] || 0
    const out: [string, string][] = []
    if (b) {
      if (bd) out.push(['B|' + b + '|' + bd, b + ' ' + bd + 'BR average'])
      out.push(['B|' + b + '|*', b + ' average'])
    }
    if (bd) out.push(['P|' + bd, 'portfolio ' + bd + 'BR average'])
    out.push(['P|*', 'portfolio average'])
    return out
  }

  type NightC = { wdR: number; wdN: number; weR: number; weN: number }
  const zeroC = (): NightC => ({ wdR: 0, wdN: 0, weR: 0, weN: 0 })
  const curNC: Record<string, NightC> = {}
  const prevNC: Record<string, NightC> = {}
  const feedNC = (m: Record<string, NightC>, perNight: Record<string, number>) => {
    for (const key of Object.keys(perNight)) {
      const amt = perNight[key]
      if (amt <= 0.5) continue                     // refunded/comped nights are not market rate
      const cut = key.indexOf('|')
      const lid = key.slice(0, cut), d = key.slice(cut + 1)
      const we = isWeekendNight(d)
      for (const [k] of cohortKeys(lid)) {
        const c = m[k] || (m[k] = zeroC())
        if (we) { c.weR = money(c.weR + amt); c.weN++ } else { c.wdR = money(c.wdR + amt); c.wdN++ }
      }
    }
  }
  feedNC(curNC, curPerNight)
  feedNC(prevNC, prevPerNight)

  for (const g of Object.values(groups)) {
    const res = g.resCode ? resByCode[g.resCode] : null
    const bestListing = Object.keys(g.listingIds).sort((a, b) => g.listingIds[b] - g.listingIds[a])[0]
      || (res ? String(res.listing_id || '') : '')

    const checkIn = res ? String(res.check_in || '').slice(0, 10) : ''
    const checkOut = res ? String(res.check_out || '').slice(0, 10) : ''
    const totalNights = res ? (Number(res.nights) || 0) : 0
    // In-month night DATES from the real dates when we have them; distinct AF dates as the
    // proxy when we don't (adjustment rows duplicate dates, so the Set already dedupes).
    let stayDates: string[] = []
    if (checkIn && checkOut) {
      const a = checkIn > win.start ? checkIn : win.start
      const b = checkOut < win.endExcl ? checkOut : win.endExcl
      if (a < b) {
        for (let t = new Date(a + 'T00:00:00Z').getTime(), end = new Date(b + 'T00:00:00Z').getTime(), i = 0; t < end && i < 40; t += 86400000, i++) {
          stayDates.push(new Date(t).toISOString().slice(0, 10))
        }
      }
    } else stayDates = Array.from(g.afDates).sort()
    const monthNights = stayDates.length

    // Night mix over the WHOLE stay (the judged rate is whole-stay), falling back to the
    // in-month dates when the reservation is unmatched.
    let mixDates: string[] = stayDates
    if (checkIn && checkOut && checkIn < checkOut) {
      mixDates = []
      for (let t = new Date(checkIn + 'T00:00:00Z').getTime(), end = new Date(checkOut + 'T00:00:00Z').getTime(), i = 0; t < end && i < 60; t += 86400000, i++) {
        mixDates.push(new Date(t).toISOString().slice(0, 10))
      }
    }
    const mixWeekend = mixDates.filter(isWeekendNight).length
    const mixWeekday = mixDates.length - mixWeekend
    const splitMonth = !!(checkIn && checkOut) && (checkIn < win.start || checkOut > win.endExcl)
    const net = money(g.rental - g.commission + g.other)
    const rate = monthNights > 0 ? money(g.rental / monthNights) : null

    // THE JUDGED RATE — total reservation value / total nights (Jon's rule: the statement
    // only carries in-month nights, and a partially-posted ledger makes in-month math lie,
    // e.g. a "$9/night" that never happened). Accommodation fare first (fees excluded),
    // host payout as fallback, in-month math only when the reservation is unmatched.
    const fare = res ? Number((res as any).fare) || 0 : 0
    const payout = res ? Number((res as any).money_total) || 0 : 0
    const avgRate = (totalNights > 0 && fare > 0.5) ? money(fare / totalNights)
      : (totalNights > 0 && payout > 0.5) ? money(payout / totalNights)
        : rate

    // Lead time: how far ahead was this booked? Last-minute bookings get rate cuts on purpose.
    const created = res ? String(res.created_at || '').slice(0, 10) : ''
    const leadDays = (created && checkIn)
      ? Math.max(0, Math.round((new Date(checkIn + 'T00:00:00Z').getTime() - new Date(created + 'T00:00:00Z').getTime()) / 86400000))
      : null

    pres.push({ g, res, bestListing, checkIn, checkOut, totalNights, monthNights, splitMonth, net, rate, avgRate, stayDates, mixWeekday, mixWeekend, leadDays })
  }

  // Expected revenue for one stay's night mix, from the narrowest trustworthy cohort:
  // building + size, then building, then portfolio same-size, then portfolio — this month
  // (minus the stay's own nights) pooled with last month. A night class with too few nights
  // (< 6) borrows the cohort's blended average instead of a noisy class average.
  const benchOf = (pre: Pre): { expected: number; perNight: number; label: string; prevAvg: number | null; wdAvg: number; weAvg: number } | null => {
    if (!pre.bestListing || !pre.stayDates.length) return null
    let sWdR = 0, sWdN = 0, sWeR = 0, sWeN = 0
    for (const d of Object.keys(pre.g.afAmtByDate)) {
      const amt = pre.g.afAmtByDate[d]
      if (amt <= 0.5) continue
      if (isWeekendNight(d)) { sWeR += amt; sWeN++ } else { sWdR += amt; sWdN++ }
    }
    for (const [k, label] of cohortKeys(pre.bestListing)) {
      const c = curNC[k] || zeroC(), p = prevNC[k] || zeroC()
      const wdN = c.wdN + p.wdN - sWdN, wdR = c.wdR + p.wdR - sWdR
      const weN = c.weN + p.weN - sWeN, weR = c.weR + p.weR - sWeR
      const totN = wdN + weN, totR = wdR + weR
      if (totN < BENCH_MIN_NIGHTS || totR <= 0) continue
      const blended = totR / totN
      const wdAvg = wdN >= 6 && wdR > 0 ? wdR / wdN : blended
      const weAvg = weN >= 6 && weR > 0 ? weR / weN : blended
      const mixN = pre.mixWeekday + pre.mixWeekend
      if (mixN <= 0) continue
      const expected = money(pre.mixWeekday * wdAvg + pre.mixWeekend * weAvg)
      if (expected <= 0) continue
      const pN = p.wdN + p.weN, pR = p.wdR + p.weR
      return {
        expected, perNight: money(expected / mixN), label,
        prevAvg: pN >= 5 && pR > 0 ? money(pR / pN) : null,
        wdAvg: money(wdAvg), weAvg: money(weAvg),
      }
    }
    return null
  }

  // THE OWNER'S USUAL COMMISSION RATE — the median commission % across their clean, live
  // bookings this month. Guesty prorates commission with rental perfectly on normal stays
  // (July 2026: zero deviation >5pts across 1,159 live bookings), so any reservation that
  // strays from the owner's own median is a posting error — in practice, canceled bookings
  // where the FULL cancellation fee was taken as commission and the owner got none of it.
  // Median (not mean) so one bad row can't move the yardstick; pass-through owners whose
  // rate is legitimately ~100% get a ~100% median and their rows read as normal.
  const commSamples: Record<string, number[]> = {}
  for (const pre of pres) {
    if (!pre.g.resCode || !pre.res) continue
    if (/cancel/i.test(String(pre.res.status || ''))) continue
    if (pre.g.rental <= 0.5 || pre.g.commission <= 0.5) continue
    ;(commSamples[pre.g.ownerId] = commSamples[pre.g.ownerId] || []).push((pre.g.commission / pre.g.rental) * 100)
  }
  const ownerCommMed: Record<string, number> = {}
  for (const oid of Object.keys(commSamples)) {
    const arr = commSamples[oid]
    if (arr.length < 3) continue // too few clean bookings to know the owner's usual rate
    const s = arr.slice().sort((a, b) => a - b)
    ownerCommMed[oid] = s[Math.floor(s.length / 2)]
  }

  const items: AuditItem[] = []
  const prep: PrepItem[] = []
  for (const pre of pres) {
    const { g, res, bestListing, checkIn, checkOut, totalNights, monthNights, splitMonth, net, rate, avgRate, mixWeekday, mixWeekend, leadDays } = pre
    const bench = g.resCode ? benchOf(pre) : null
    const benchPct = bench && avgRate != null && avgRate > 0 && bench.perNight > 0 ? Math.round((avgRate / bench.perNight) * 100) : null

    // Owner stays and friends & family: tagged from Guesty tags, source and guest name.
    // Their discounts are by design — they stay visible but never read as pricing errors.
    const tagBlob = (res && Array.isArray((res as any).tags) ? (res as any).tags.map((t: any) => String(t)).join(' ') : '')
    const srcStr = res ? String(res.source || '') : ''
    const guestStr = res ? String(res.guest_name || '') : ''
    const stayTag: AuditItem['stayTag'] = !g.resCode ? null
      : OWNER_GUEST_RE.test(srcStr) ? 'owner_guest'
        : (FF_RE.test(tagBlob) || FF_RE.test(guestStr)) ? 'ff'
          : (OWNERISH_RE.test(srcStr) || OWNERISH_RE.test(tagBlob) || OWNERISH_RE.test(guestStr)) ? 'owner'
            : null
    // Non-normal booking statuses still leave money on statements (cancellation fees, partial
    // payouts, stray postings). Their "nightly rate" is meaningless — they get TAGGED so the
    // reviewer knows exactly what's going on, and rate flags read as informational.
    const resStatus = res ? String(res.status || '') : ''
    const statusTag: AuditItem['statusTag'] = /cancel/i.test(resStatus) ? 'canceled'
      : /inquir/i.test(resStatus) ? 'inquiry'
        : /declin/i.test(resStatus) ? 'declined'
          : /expir/i.test(resStatus) ? 'expired'
            : null
    const canceled = statusTag === 'canceled'

    const flags: AuditFlag[] = []
    const on = rules.enabled
    if (g.resCode) {
      const refundAmt = money(g.lines.filter(l => REFUND_RE.test(l.label)).reduce((a, l) => a + l.amount, 0))
      const reimbAmt = money(g.lines.filter(l => REIMB_RE.test(l.label) && l.amount > 0).reduce((a, l) => a + l.amount, 0))
      const isPassthru = g.rental > 1 && g.commission / g.rental >= rules.passthruLo && g.commission / g.rental <= rules.passthruHi

      if (on.negative && g.rental < -0.005) {
        flags.push({ type: 'negative', severity: 'high', amount: g.rental, detail: 'Negative rental income — check for erroneous refund, chargeback or duplicate reversal.' })
      }
      if (on.refund && g.lines.some(l => REFUND_RE.test(l.label))) {
        flags.push({ type: 'refund', severity: 'review', amount: refundAmt, detail: 'Refund on this reservation — verify it was authorized.' })
      }
      if (Math.abs(g.rental) < 0.005 && reimbAmt > 0.005) {
        if (on.orphan_reimb) flags.push({ type: 'orphan_reimb', severity: 'review', amount: reimbAmt, detail: 'Reimbursement with no rental income on the block — no booking justifies it.' })
      } else if (on.zero_rev && Math.abs(g.rental) < 0.005 && !flags.length) {
        // MONEY STILL MOVED. "Canceled, so $0 is expected" is only true when the row really is $0.
        // Keith Dobrolinsky's canceled stay paid the owner $7.60 and barry griggs $8.20 with no room
        // revenue behind either, and both sat in "No issues found" because the flag looked at the
        // status instead of the money. A cancellation explains a low figure; it does not explain a
        // payment. Anything at or above the threshold goes to a person regardless of status.
        // A DOLLAR, not the owner-charge threshold. The team's own sheet flags $7.60 and $3.80 of
        // reimbursement on canceled stays, and they are right to: the amount is small, the question
        // ("why did this pay out at all?") is not. Only rounding dust stays quiet.
        const moved = Math.abs(net) >= 1
        if (moved) {
          flags.push({
            type: 'zero_rev', severity: 'review', amount: net,
            detail: (net > 0 ? 'The owner is paid $' + net.toFixed(2) : 'The owner is charged $' + Math.abs(net).toFixed(2))
              + ' on a booking with no room revenue'
              + (statusTag === 'canceled' ? ' — the booking is canceled, so confirm this is a cancellation fee or a cost that belongs to them.'
                : stayTag ? ' — ' + (stayTag === 'ff' ? 'a friends & family stay' : 'an owner stay') + ' carries no revenue by design, but this money still needs a reason.'
                  : '.'),
          })
        } else
        flags.push({ type: 'zero_rev', severity: (stayTag || statusTag) ? 'info' : 'review',
          detail: statusTag === 'canceled' ? 'Canceled reservation — $0 net is expected.'
            : statusTag === 'inquiry' ? 'Inquiry — never a confirmed booking; check why it has statement line items.'
              : statusTag ? statusTag.charAt(0).toUpperCase() + statusTag.slice(1) + ' reservation — $0 net is expected.'
                : stayTag === 'ff' ? 'Friends & family stay — $0 revenue by design; note any associated costs.'
                  : stayTag === 'owner' ? 'Owner stay — $0 revenue by design; note any associated costs.'
                    : '$0 revenue and not an owner stay, friends & family, or a canceled/inquiry booking.' })
      }
      // LOW RATE — judged on the WHOLE-RESERVATION average (total value / total nights, the
      // folio's nightly rate), NEVER on in-month ledger math: the statement only carries
      // in-month nights, and a partially-posted ledger yields impossible rates ("$9/night").
      // Night-mix aware (midweek stays vs midweek pricing) and lead-time aware (last-minute
      // bookings get a relaxed bar, because those rates are cut on purpose).
      if (on.low_rate && g.rental > 0.005 && avgRate != null && avgRate > 0) {
        const stayTxt = (totalNights > 0 ? totalNights + '-night stay' : monthNights + ' night' + (monthNights === 1 ? '' : 's'))
          + ' (' + mixWeekday + ' midweek · ' + mixWeekend + ' weekend)'
          + (splitMonth ? ', ' + monthNights + 'n on this statement' : '')
        const lastMin = leadDays != null && leadDays <= rules.lastMinDays
        const effPct = lastMin ? Math.max(10, rules.lowRatePct - rules.lastMinExtra) : rules.lowRatePct
        // Owner / F&F stays are discounted on purpose: the low rate stays VISIBLE but reads
        // as informational, never as a pricing error to chase.
        const lrSev: AuditSeverity = (stayTag || statusTag) ? 'info' : 'review'
        const lrTagNote = statusTag === 'canceled' ? ' Canceled reservation — cancellation fee / partial payout, a low nightly figure is expected.'
          : statusTag === 'inquiry' ? ' Inquiry — never a confirmed booking; worth checking WHY it carries statement line items at all.'
            : statusTag ? ' ' + statusTag.charAt(0).toUpperCase() + statusTag.slice(1) + ' reservation — the nightly figure is not meaningful.'
              : stayTag === 'ff' ? ' Friends & family stay — discounted by design.'
                : stayTag === 'owner' ? ' Owner stay — discounted by design.' : ''
        if (rules.lowRateMode === 'absolute') {
          if (avgRate < rules.lowRate) {
            flags.push({ type: 'low_rate', severity: lrSev, amount: avgRate, detail: 'Whole-stay average $' + avgRate.toFixed(2) + '/night on a ' + stayTxt + ' — under the $' + rules.lowRate + ' threshold.' + lrTagNote })
          }
        } else if (avgRate < rules.lowRateFloor) {
          flags.push({ type: 'low_rate', severity: lrSev, amount: avgRate, detail: 'Whole-stay average $' + avgRate.toFixed(2) + '/night on a ' + stayTxt + ' — under the $' + rules.lowRateFloor + ' hard floor.' + lrTagNote })
        } else if (bench && benchPct != null && benchPct < effPct) {
          flags.push({
            type: 'low_rate', severity: lrSev, amount: avgRate,
            detail: 'Whole-stay average $' + avgRate.toFixed(2) + '/night is ' + benchPct + '% of the expected ≈$'
              + bench.perNight.toFixed(0) + '/night for a ' + stayTxt + ', per the ' + bench.label
              + ' (midweek ≈$' + bench.wdAvg.toFixed(0) + '/n · weekend ≈$' + bench.weAvg.toFixed(0) + '/n, this + last month'
              + (bench.prevAvg != null ? '; last month blended $' + bench.prevAvg.toFixed(0) + '/n' : '') + ')'
              + (lastMin ? '. Booked ' + leadDays + 'd before check-in — still short even with the last-minute bar of ' + effPct + '%.' : '.') + lrTagNote,
          })
        }
      }
      // COMMISSION OFF — this reservation's commission % vs the owner's own usual rate.
      // Normal stays track the owner's rate to the point (proration included), so a gap
      // bigger than the tolerance is a money error, most often a canceled booking whose
      // whole cancellation fee went to commission. Canceled does NOT soften this one —
      // wrong money is wrong money.
      // A WASH IS NOT A COMMISSION GRAB. Guesty books some bookings — cancellations especially —
      // as a matched pair on the same date: AF +$692.44 and CMS −$692.44, then AF −$275 / CMS +$275.
      // The legs cancel, the owner's payout on the row is exactly $0.00, and no money is missing;
      // the account-wide statement audit proved this pattern out (see the PASS-THROUGH block in
      // lib/owner-statements.ts). Reading "commission = 100% of revenue" off those rows and calling
      // it an error produced 8 false alarms in July 2026 — the money had never been the owner's.
      // So: a wash is informational, and a commission flag has to show the owner actually LOSING.
      const isWash = isPassthru && Math.abs(net) < 1
      if (on.commission_off && !isWash) {
        const usual = ownerCommMed[g.ownerId]
        const commPct = g.rental > 0.5 ? (g.commission / g.rental) * 100 : null
        if (g.commission > 0.5 && g.rental <= 0.5) {
          flags.push({
            type: 'commission_off', severity: net < -0.5 ? 'high' : 'review', amount: g.commission,
            detail: 'Commission of $' + g.commission.toFixed(2) + ' charged with no room revenue on this statement — nothing to take a commission on.'
              + (net < -0.5 ? ' The owner ends up ' + money(Math.abs(net)).toFixed(2) + ' out of pocket on this booking.' : '')
              + (canceled ? ' Canceled booking: check whether this commission should be reversed.' : ''),
          })
        } else if (commPct != null && g.commission > 0.5 && commPct > rules.passthruHi * 100) {
          // More commission than there was revenue, and the legs do not cancel — the owner pays
          // us out of their own pocket for this booking. Always worth a person's eyes.
          flags.push({
            type: 'commission_off', severity: 'high', amount: g.commission,
            detail: 'Commission $' + g.commission.toFixed(2) + ' is ' + Math.round(commPct) + '% of the $'
              + g.rental.toFixed(2) + ' of room revenue on this booking'
              + (net < -0.5 ? ', leaving the owner $' + money(Math.abs(net)).toFixed(2) + ' out of pocket' : '')
              + (usual != null ? ' — this owner’s usual rate is ~' + Math.round(usual) + '%.' : '.'),
          })
        } else if (usual != null && commPct != null && Math.abs(commPct - usual) > rules.commTolerance) {
          flags.push({
            type: 'commission_off', severity: 'review', amount: g.commission,
            detail: 'Commission $' + g.commission.toFixed(2) + ' is ' + Math.round(commPct) + '% of room revenue — this owner’s usual rate is ~' + Math.round(usual) + '%. '
              + (commPct > usual ? 'The owner was charged more than their usual rate — verify.' : 'The owner was charged less than their usual rate — verify.'),
          })
        }
      }
      if (on.passthru && isPassthru && !flags.some(f => f.type === 'commission_off')) {
        flags.push({
          type: 'passthru', severity: 'info',
          detail: isWash
            ? 'Matched pair: the fee cancels the rental line for line, so this booking pays the owner exactly $0.00 — nothing is missing.'
            : 'Commission fully offsets rental (pass-through wash) — owner nets zero on it by design.',
        })
      }
      // OWNER STAYS AND F&F GET FLAGGED, NOT HIDDEN. The discount is by design, so these never read
      // as pricing errors — but the stay itself is a decision the owner review is supposed to see:
      // nights taken off the market, cleaning and costs that still have to land somewhere, and the
      // occasional booking tagged "owner" that nobody authorised. Tagging alone left them sitting in
      // "No issues found", which is where the team's spreadsheet listed 15 of them by hand instead.
      if (on.owner_stay && stayTag) {
        const nightsTxt = totalNights > 0 ? totalNights + ' night' + (totalNights === 1 ? '' : 's') : monthNights + ' night' + (monthNights === 1 ? '' : 's')
        // THE CLEANING FEE IS THE POINT. An owner stay may carry accommodation revenue or none —
        // that part varies. What must be true every time is that the owner was charged for the
        // turnover, and that charge lives on the GUEST FOLIO. The statement's CF line is only a
        // second look; a folio with no cleaning item is the finding.
        const folio = res ? (folioByRes[String(res.id || '')] || []) : []
        const folioClean = money(folio.filter((x: any) => PREP_CLEAN_RE.test(String(x?.title || x?.name || ''))).reduce((a: number, x: any) => a + (Number(x?.amount) || 0), 0))
        const stmtClean = g.lines.some(l => l.code === 'CF' || PREP_CLEAN_RE.test(l.label))
        // JON'S RULE: a charge to the owner on an owner stay is almost certainly the cleaning fee.
        // Guesty posts them as a bare "Owner charge" with no code and no label, so nothing in the
        // data says "cleaning" — but $125–150 against an owner who just used their own unit is the
        // turnover. Read it that way and ask for the label, rather than reporting nothing charged.
        const ownerCharge = money(g.lines.filter(l => OWNER_CHARGE_RE.test(l.label) && l.amount < 0)
          .reduce((a, l) => a + Math.abs(l.amount), 0))
        const likelyCleaning = !folioClean && !stmtClean && ownerCharge > 0.005 && ownerCharge <= CLEANING_LIKELY_MAX
        flags.push({
          type: 'owner_stay', severity: (folioClean > 0.005 || stmtClean || likelyCleaning) ? 'review' : 'high', amount: net,
          detail: STAY_LABEL[stayTag] + ' — ' + nightsTxt
            + (net > 0.5 ? ', paying the owner $' + net.toFixed(2)
              : net < -0.5 ? ', costing the owner $' + Math.abs(net).toFixed(2)
                : ' at no revenue')
            + (folioClean > 0.005 ? '. Cleaning fee of $' + folioClean.toFixed(2) + ' is on the folio.'
              : stmtClean ? '. A cleaning fee is on the statement but NOT on the guest folio — check the booking.'
                : likelyCleaning ? '. $' + ownerCharge.toFixed(2) + ' is charged to the owner as a bare "Owner charge" — almost certainly the cleaning fee. Confirm, and label it as cleaning so it reads properly on the statement.'
                  : '. NO CLEANING FEE ON THE FOLIO — the owner has not been charged for the turnover.'),
        })
      }
      if (on.no_reservation && !res) {
        flags.push({ type: 'no_reservation', severity: 'info', detail: 'Code not found in the reservations mirror — dates and the Guesty link are unavailable.' })
      }
    } else {
      // Grouped non-reservation lines: informational unless they look like refunds.
      if (on.refund && g.lines.some(l => REFUND_RE.test(l.label))) {
        const amt = money(g.lines.filter(l => REFUND_RE.test(l.label)).reduce((a, l) => a + l.amount, 0))
        flags.push({ type: 'refund', severity: 'review', amount: amt, detail: 'Refund-looking line outside any reservation — verify.' })
      }
      // MONEY THAT BELONGS TO NO BOOKING. Management fees, owner charges, one-off adjustments:
      // real money moving on the owner's statement with no reservation to explain it, and until
      // now it carried no flag at all — July 2026 hid a −$1,430 "Revenue Management Fee" on Rock
      // Soffer's statement in the completed pile. Small housekeeping amounts stay informational.
      if (on.off_booking && !flags.some(f => f.severity !== 'info') && Math.abs(net) > 0.005) {
        const big = Math.abs(net) >= rules.offBookingMin
        const isOwnerCharge = g.lines.some(l => OWNER_CHARGE_RE.test(l.label))
        flags.push({
          type: 'off_booking', severity: big ? 'review' : 'info', amount: net,
          detail: (net < 0 ? 'The owner is charged $' + Math.abs(net).toFixed(2) : 'The owner is credited $' + net.toFixed(2))
            + ' on a statement line with no booking behind it'
            // Same rule as on the stays themselves: a bare owner charge is usually the cleaning.
            + (isOwnerCharge && net < 0 && Math.abs(net) <= CLEANING_LIKELY_MAX
              ? ' — posted as a bare "Owner charge" and small enough to be the cleaning fee for an owner stay. Confirm what it covers and label it.'
              : isOwnerCharge && net < 0
                ? ' — posted as a bare "Owner charge", too large to be a turnover. Confirm what it covers and label it.'
                : big ? ' — confirm it is meant to be on this statement.' : ' (small housekeeping amount).'),
        })
      }
    }

    const worst: AuditSeverity = flags.some(f => f.severity === 'high') ? 'high'
      : flags.some(f => f.severity === 'review') ? 'review' : 'info'
    const key = g.resCode || g.lineKey
    const saved = reviews[g.ownerId + '|' + key]
    // A row nobody needs to look at is CLEAR, not "done" — see the AuditStatus ladder. Only a
    // human click can produce 'done', so the completed count means what it says.
    const needsReview = worst !== 'info'
    const defaultStatus: AuditStatus = needsReview ? 'review' : 'clear'
    const savedStatus = saved ? String(saved.status) : ''
    const comments: AuditComment[] = Array.isArray(saved?.comments) ? saved.comments : []

    items.push({
      key,
      kind: g.resCode ? 'reservation' : 'line',
      ownerId: g.ownerId,
      resCode: g.resCode,
      guest: res ? String(res.guest_name || '') : (g.resCode ? '' : g.lines[0]?.label || ''),
      checkIn, checkOut, totalNights, monthNights, splitMonth,
      listingId: bestListing,
      unit: unitOf[bestListing] || '',
      source: res ? String(res.source || '') : '',
      reservationId: res ? String(res.id || '') : '',
      resNote: res ? reservationNoteOf(res.custom_fields) : '',
      benchRate: bench ? bench.perNight : null,
      benchLabel: bench ? bench.label : '',
      benchPct,
      benchPrev: bench ? bench.prevAvg : null,
      mixWeekday, mixWeekend, leadDays, stayTag, canceled, statusTag,
      rental: g.rental, commission: g.commission, other: g.other, net,
      rate, avgRate,
      lines: g.lines.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 60),
      lineCount: g.lines.length,
      lastPosted: g.lines.reduce((m, l) => (l.date > m ? l.date : m), ''),
      posted: g.posted,
      reversed: g.reversed,
      resValue: res ? (Number((res as any).money_total) || Number((res as any).fare) || null) : null,
      flags,
      needsReview,
      // Stored statuses win, but only the ones a human can actually set. Rows saved as 'done'
      // under the old auto-complete behaviour stay done — those were real clicks.
      status: (savedStatus && WRITABLE_STATUSES.includes(savedStatus as AuditStatus))
        ? (savedStatus as AuditStatus) : defaultStatus,
      touched: !!saved,
      note: saved ? String(saved.note || '') : '',
      comments,
      updatedBy: saved ? (saved.updated_by || null) : null,
      updatedAt: saved ? (saved.updated_at || null) : null,
    })
  }

  // Owner / F&F stays that never reached the statement — one row each, so a $0 owner stay is
  // still something the reviewer sees, notes and closes out.
  if (rules.enabled.owner_stay) {
    const haveCode = new Set(items.filter(i => i.resCode).map(i => i.resCode))
    const listingOwner: Record<string, string> = {}
    for (const it of items) if (it.listingId && it.ownerId) listingOwner[it.listingId] = it.ownerId
    for (const r of ownerStayRes) {
      const code = String(r.confirmation_code || '')
      if (code && haveCode.has(code)) continue          // already on the statement, already flagged
      const lid = String(r.listing_id || '')
      const oid = listingOwner[lid] || ''
      if (!oid) continue                                 // unit not on any statement this month
      const tagBlob = Array.isArray((r as any).tags) ? (r as any).tags.map((t: any) => String(t)).join(' ') : ''
      const kind: 'owner' | 'owner_guest' | 'ff' = OWNER_GUEST_RE.test(String(r.source || '')) ? 'owner_guest'
        : (FF_RE.test(tagBlob) || FF_RE.test(String(r.guest_name || ''))) ? 'ff' : 'owner'
      const key = 'line:ownerstay:' + (code || String(r.id || ''))
      const saved = reviews[oid + '|' + key]
      const savedStatus = saved ? String(saved.status) : ''
      const nights = Number(r.nights) || 0
      items.push({
        key, kind: 'reservation', ownerId: oid, resCode: code,
        guest: String(r.guest_name || ''),
        checkIn: String(r.check_in || '').slice(0, 10), checkOut: String(r.check_out || '').slice(0, 10),
        totalNights: nights, monthNights: 0, splitMonth: false,
        listingId: lid, unit: unitOf[lid] || '', source: String(r.source || ''),
        reservationId: String(r.id || ''), resNote: '',
        benchRate: null, benchLabel: '', benchPct: null, benchPrev: null,
        mixWeekday: 0, mixWeekend: 0, leadDays: null,
        stayTag: kind, canceled: /cancel/i.test(String(r.status || '')),
        statusTag: /cancel/i.test(String(r.status || '')) ? 'canceled' : null,
        rental: 0, commission: 0, other: 0, net: 0, rate: null, avgRate: null,
        lines: [], lineCount: 0, lastPosted: String(r.check_in || '').slice(0, 10), posted: 0, reversed: 0,
        resValue: Number(r.money_total) || null,
        flags: [(() => {
          const folio = folioByRes[String(r.id || '')] || []
          const folioClean = money(folio.filter((x: any) => PREP_CLEAN_RE.test(String(x?.title || x?.name || ''))).reduce((a: number, x: any) => a + (Number(x?.amount) || 0), 0))
          const canceledStay = /cancel/i.test(String(r.status || ''))
          return {
            type: 'owner_stay' as AuditFlagType,
            severity: (folioClean > 0.005 || canceledStay ? 'review' : 'high') as AuditSeverity,
            detail: STAY_LABEL[kind] + ' — ' + (nights || '?') + ' night' + (nights === 1 ? '' : 's')
              + (canceledStay ? ', canceled' : ' held off the market')
              + ', nothing for it on this statement. '
              + (folioClean > 0.005
                ? 'Cleaning fee of $' + folioClean.toFixed(2) + ' is on the folio.'
                : 'NO CLEANING FEE ON THE FOLIO — the owner has not been charged for the turnover.'),
          }
        })()],
        needsReview: true,
        status: (savedStatus && WRITABLE_STATUSES.includes(savedStatus as AuditStatus)) ? (savedStatus as AuditStatus) : 'review',
        touched: !!saved,
        note: saved ? String(saved.note || '') : '',
        comments: Array.isArray(saved?.comments) ? saved.comments : [],
        updatedBy: saved ? (saved.updated_by || null) : null,
        updatedAt: saved ? (saved.updated_at || null) : null,
      })
    }
  }

  // A STATEMENT WITH NOTHING ON IT is itself a finding — usually a listing that never got mapped
  // to the owner, so a month of real bookings landed nowhere. The board used to render those
  // owners as an empty shell with no row to click and nothing to explain them; the team's own
  // spreadsheet listed all eight. One synthetic row per empty statement puts them in the worklist
  // where they can be looked at, noted and closed out like anything else.
  if (rules.enabled.empty_statement) {
    const withRows = new Set(items.map(i => i.ownerId))
    for (const s of stmts) {
      const oid = String(s.owner_id || '')
      if (!oid || withRows.has(oid)) continue
      const o = ownerOf(oid)
      const key = 'line:__empty__'
      const saved = reviews[oid + '|' + key]
      const savedStatus = saved ? String(saved.status) : ''
      items.push({
        key, kind: 'line', ownerId: oid, resCode: '',
        guest: 'Statement generated with nothing on it',
        checkIn: '', checkOut: '', totalNights: 0, monthNights: 0, splitMonth: false,
        listingId: '', unit: '', source: '', reservationId: '', resNote: '',
        benchRate: null, benchLabel: '', benchPct: null, benchPrev: null,
        mixWeekday: 0, mixWeekend: 0, leadDays: null, stayTag: null, canceled: false, statusTag: null,
        rental: 0, commission: 0, other: 0, net: 0, rate: null, avgRate: null,
        lines: [], lineCount: 0, lastPosted: '', posted: 0, reversed: 0, resValue: null,
        flags: [{
          type: 'empty_statement', severity: 'review',
          detail: 'Guesty generated a ' + MONTH_LABEL(month) + ' statement for this owner with no line items at all'
            + (o.dueToOwner ? ', and a balance of $' + o.dueToOwner.toFixed(2) : '')
            + '. Usually a listing that is not mapped to the owner — check their properties in Guesty before the statement goes out.',
        }],
        needsReview: true,
        status: (savedStatus && WRITABLE_STATUSES.includes(savedStatus as AuditStatus)) ? (savedStatus as AuditStatus) : 'review',
        touched: !!saved,
        note: saved ? String(saved.note || '') : '',
        comments: Array.isArray(saved?.comments) ? saved.comments : [],
        updatedBy: saved ? (saved.updated_by || null) : null,
        updatedAt: saved ? (saved.updated_at || null) : null,
      })
    }
  }

  // Order: worst first inside each owner, owners by name.
  const sevRank = (it: AuditItem) => it.flags.some(f => f.severity === 'high') ? 0
    : it.flags.some(f => f.severity === 'review') ? 1 : it.kind === 'reservation' ? 2 : 3
  items.sort((a, b) => a.ownerId.localeCompare(b.ownerId) || sevRank(a) - sevRank(b) || b.rental - a.rental)

  for (const it of items) {
    const o = owners[it.ownerId]
    if (!o) continue
    o.items++
    // OPEN = waiting on a person. Rows with nothing wrong are not work and never were:
    // counting them made every statement look 96% done and un-signable at the same time.
    if (it.status === 'review' || it.status === 'action') o.open++
    else if (it.status === 'done') o.done++
    else o.clear++
    if (it.flags.some(f => f.severity === 'high')) o.high++
    else if (it.flags.some(f => f.severity === 'review')) o.reviewFlags++
    if (it.note) o.notes++
    o.commentCount += it.comments.length
  }

  // A statement with open rows again is no longer "signed off" — the signature only stands
  // while everything under it is completed. (The stored row remains; it re-surfaces if the
  // rows are completed again, which keeps the who/when honest.)
  for (const o of Object.values(owners)) if (o.open > 0) o.signOff = null

  // PREP assembly — one entry per Expedia-family reservation touching the month, enriched
  // with whatever its statement (if any) already shows for cleaning/RM lines.
  const codeGroup: Record<string, Group> = {}
  for (const g of Object.values(groups)) if (g.resCode && !codeGroup[g.resCode]) codeGroup[g.resCode] = g
  const invTitle = (x: any) => String(x?.title || x?.name || '')
  const invAmt = (x: any) => Number(x?.amount) || 0
  const FOLIO_RM_RE = /revenue|\brm\b/i
  const FOLIO_LUMP_RE = /additional fees|room fees/i
  for (const r of expRes) {
    const code = String(r.confirmation_code || '')
    if (!code) continue
    const g = codeGroup[code]
    const lines = g ? g.lines : []
    const hasClean = lines.some(l => l.code === 'CF' || PREP_CLEAN_RE.test(l.label))
    const hasRm = lines.some(l => PREP_RM_RE.test(l.label))
    const ci = String(r.check_in || '').slice(0, 10)
    const co = String(r.check_out || '').slice(0, 10)

    const inv = folioByRes[String(r.id || '')] || []
    const fClean = money(inv.filter(x => PREP_CLEAN_RE.test(invTitle(x))).reduce((a, x) => a + invAmt(x), 0))
    const fRm = money(inv.filter(x => !PREP_CLEAN_RE.test(invTitle(x)) && FOLIO_RM_RE.test(invTitle(x))).reduce((a, x) => a + invAmt(x), 0))
    const fLump = money(inv.filter(x => FOLIO_LUMP_RE.test(invTitle(x))).reduce((a, x) => a + invAmt(x), 0))
    const splitDone = inv.length > 0 && fClean > 0.5 && fRm > 0.5
    const noFees = inv.length > 0 && !splitDone && fClean <= 0.5 && fRm <= 0.5 && fLump <= 0.5

    prep.push({
      ownerId: g ? g.ownerId : '',
      ownerName: g ? (owners[g.ownerId]?.ownerName || '') : '',
      resCode: code,
      guest: String(r.guest_name || ''),
      unit: unitOf[String(r.listing_id || '')] || '',
      checkIn: ci, checkOut: co,
      source: String(r.source || ''),
      reservationId: String(r.id || ''),
      onStatement: !!g,
      rental: g ? g.rental : 0,
      monthNights: (ci && co) ? nightsWithin(ci, co, win.start, win.endExcl) : 0,
      cleaningAmt: g && hasClean ? money(lines.filter(l => l.code === 'CF' || PREP_CLEAN_RE.test(l.label)).reduce((a, l) => a + l.amount, 0)) : null,
      rmAmt: g && hasRm ? money(lines.filter(l => PREP_RM_RE.test(l.label)).reduce((a, l) => a + l.amount, 0)) : null,
      folioClean: inv.length ? fClean : null,
      folioRm: inv.length ? fRm : null,
      folioLump: inv.length ? fLump : null,
      splitDone, noFees,
      saved: prepSaved[code] || null,
      note: prepNote[code] || '',
    })
  }

  // AIRBNB RESOLUTIONS — every Resolution Center case decided or paid in this month (plus,
  // for the month currently being prepped, everything still pending with Airbnb), each
  // reconciled against resolution-looking ledger lines. Best-effort: a missing claims
  // table degrades to the ledger lines alone.
  for (const l of resLedger) l.ownerName = owners[l.ownerId]?.ownerName || ownerName[l.ownerId] || ''
  const stmtResByCode: Record<string, number> = {}
  for (const l of resLedger) if (l.resCode) stmtResByCode[l.resCode] = money((stmtResByCode[l.resCode] || 0) + l.amount)
  let resolutionClaims: ResolutionClaim[] = []
  try {
    const nowD = new Date()
    const prevCal = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
    const isPrepMonth = month >= prevCal
    const { data: clRows, error: clErr } = await sb.from('claims')
      .select('id, guest_name, property, unit_no, channel, confirmation_code, reservation_id, stage, amount_sought, amount_paid, decided_on, paid_on, summary')
      .is('deleted_at', null)
      .ilike('channel', '%airbnb%')
      .limit(500)
    if (!clErr) {
      const inMonth = (d: any) => String(d || '').slice(0, 7) === month
      resolutionClaims = ((clRows || []) as any[])
        .filter(c => inMonth(c.paid_on) || inMonth(c.decided_on)
          || (isPrepMonth && ['submitted', 'decided', 'settle'].includes(String(c.stage || ''))))
        .map(c => {
          const code = String(c.confirmation_code || '')
          return {
            id: String(c.id || ''),
            guest: String(c.guest_name || ''),
            property: String(c.property || ''),
            unit: String(c.unit_no || ''),
            resCode: code,
            reservationId: String(c.reservation_id || ''),
            stage: String(c.stage || ''),
            amountSought: c.amount_sought == null ? null : Number(c.amount_sought) || 0,
            amountPaid: c.amount_paid == null ? null : Number(c.amount_paid) || 0,
            decidedOn: String(c.decided_on || '').slice(0, 10),
            paidOn: String(c.paid_on || '').slice(0, 10),
            summary: String(c.summary || ''),
            onStatement: !!code && stmtResByCode[code] !== undefined,
            stmtAmount: code && stmtResByCode[code] !== undefined ? stmtResByCode[code] : null,
            note: reslNote[String(c.id || '')] || '',
          }
        })
        .sort((a, b) => Number(!!b.paidOn) - Number(!!a.paidOn) === 0
          ? a.guest.localeCompare(b.guest)
          : Number(!!a.paidOn || !!a.decidedOn) - Number(!!b.paidOn || !!b.decidedOn))
      const claimCodes = new Set(resolutionClaims.map(c => c.resCode).filter(Boolean))
      for (const l of resLedger) l.hasClaim = !!l.resCode && claimCodes.has(l.resCode)
    }
  } catch { /* claims board unavailable — show ledger lines only */ }

  const t = {
    owners: Object.keys(owners).length,
    statements: stmts.length,
    reservations: items.filter(i => i.kind === 'reservation').length,
    flagged: items.filter(i => i.flags.some(f => f.severity !== 'info')).length,
    high: items.filter(i => i.flags.some(f => f.severity === 'high')).length,
    review: items.filter(i => i.status === 'review').length,
    action: items.filter(i => i.status === 'action').length,
    done: items.filter(i => i.status === 'done').length,
    clear: items.filter(i => i.status === 'clear').length,
    postedThisWeek: (() => {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
      return items.filter(i => i.lastPosted && i.lastPosted >= weekAgo).length
    })(),
    signedOff: Object.values(owners).filter(o => o.signOff).length,
    prepOpen: prep.filter(p => !prepResolved(p)).length,
    rental: money(Object.values(owners).reduce((a, o) => a + o.rental, 0)),
    commission: money(Object.values(owners).reduce((a, o) => a + o.commission, 0)),
    net: money(Object.values(owners).reduce((a, o) => a + o.net, 0)),
    paid: money(Object.values(owners).reduce((a, o) => a + o.paid, 0)),
    dueToOwner: money(stmts.reduce((a, s) => a + (Number(s.due_to_owner ?? 0) || 0), 0)),
  }

  return {
    month,
    label: MONTH_LABEL(month),
    owners: Object.values(owners).sort((a, b) => a.ownerName.localeCompare(b.ownerName)),
    items,
    totals: t,
    coverage: { ready: covered, missing: covered ? [] : [month], syncedAt, resScanned: ownerScanCount, ownerStaysFound: ownerStayRes.length },
    rules,
    prep: prep.sort((a, b) =>
      Number(prepResolved(a)) - Number(prepResolved(b))
      || a.ownerName.localeCompare(b.ownerName) || a.checkIn.localeCompare(b.checkIn)),
    resolutions: { claims: resolutionClaims, lines: resLedger },
  }
}

/**
 * A prep item is resolved when the split is visible somewhere, or a human marked it done.
 * A folio with NO fees at all is NOT resolved — on an Expedia-family booking that means the
 * fees were never set up, which is its own warning to fix.
 */
export function prepResolved(p: PrepItem): boolean {
  return p.splitDone || (p.cleaningAmt != null && p.rmAmt != null) || !!p.saved
}

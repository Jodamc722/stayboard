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
  | 'passthru' | 'no_reservation'
export type AuditSeverity = 'high' | 'review' | 'info'
export type AuditFlag = { type: AuditFlagType; severity: AuditSeverity; detail: string; amount?: number }

export type AuditLine = { date: string; label: string; code: string; amount: number }
export type AuditComment = { author: string; body: string; at: string }
export type AuditStatus = 'review' | 'action' | 'done'

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
  rental: number
  commission: number
  other: number
  net: number
  rate: number | null            // rental / monthNights, null when nights are unknown
  lines: AuditLine[]
  flags: AuditFlag[]
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
// Orbitz, Travelocity…) land on the statement with their fees lump-summed into the nightly
// income: in June 2026 only 15 of 102 such reservations carried a separate Cleaning-fee
// line and only 7 an RM line. Statement prep = every one of those reservations gets its
// fees broken out into Cleaning fee + RM fees before the statement goes to the owner.
// The saved split lives in owner_audit_reviews under item_key 'prep:<code>' (note = JSON).
export type PrepItem = {
  ownerId: string
  resCode: string
  guest: string
  unit: string
  checkIn: string
  checkOut: string
  source: string
  reservationId: string
  rental: number                 // in-month rental on the statement
  monthNights: number
  cleaningAmt: number | null     // cleaning-fee lines already on the statement (null = none)
  rmAmt: number | null           // RM lines already on the statement (null = none)
  saved: { cleaning: number; rm: number; by: string; at: string } | null
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
  paid: number
  ties: boolean
  items: number                  // count; the items themselves live in the flat list
  open: number                   // items still at review/action
  done: number                   // items completed
  high: number                   // items carrying a HIGH flag
  reviewFlags: number            // items carrying a review-severity flag (and no high)
  notes: number                  // items with an audit note
  commentCount: number           // total comments across the owner's items
  signOff: AuditSignOff | null
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
    review: number; action: number; done: number
    signedOff: number
    prepOpen: number
    rental: number; commission: number; net: number; paid: number; dueToOwner: number
  }
  coverage: { ready: boolean; missing: string[] }
  rules: AuditRules
  prep: PrepItem[]
}

// Expedia-family sources whose fees arrive lump-summed and need the prep breakout.
export const EXPEDIA_RE = /expedia|orbitz|travelocity|hotels\.com|hotelscom|\bhotels\b|wotif|ebookers|cheaptickets/i
const PREP_CLEAN_RE = /clean/i
const PREP_RM_RE = /revenue management|\brm\b/i
/** Reserved item_key prefix for prep breakout rows. */
export const PREP_PREFIX = 'prep:'

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
  enabled: Record<AuditFlagType, boolean>      // per-flag kill switch
}
export const DEFAULT_AUDIT_RULES: AuditRules = {
  lowRateMode: 'relative', lowRatePct: 55, lowRateFloor: 30,
  lastMinDays: 3, lastMinExtra: 20,
  lowRate: 60, passthruLo: 0.9, passthruHi: 1.1,
  enabled: { negative: true, low_rate: true, orphan_reimb: true, refund: true, zero_rev: true, passthru: true, no_reservation: true },
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

/** Months that have generated statements, newest first — the picker feed. */
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
  return Object.keys(counts).sort().reverse().slice(0, limit)
    .map(m => ({ m, label: MONTH_LABEL(m), statements: counts[m] }))
}

/** Build the whole audit for one statement month. */
export async function buildAudit(month: string): Promise<AuditData> {
  const sb = supabaseAdmin()
  const win = monthWindow(month)
  const rules = await auditRules()

  // 1. The generated statements for this month — the documents being audited.
  const { data: stmtRows, error: stErr } = await sb.from('guesty_owner_statements')
    .select('id, owner_id, owner_name, period_month, due_to_owner')
    .eq('period_month', month)
  if (stErr) throw new Error('statements read: ' + stErr.message)
  const stmts = (stmtRows || []) as any[]
  const stmtByOwner: Record<string, any> = {}
  for (const s of stmts) stmtByOwner[String(s.owner_id || '')] = s

  // 2. Ledger coverage — has the mirror actually swept this month?
  const { data: cov } = await sb.from('guesty_ledger_months').select('month, status').eq('month', month)
  const covered = ((cov || []) as any[]).some(r => r.status === 'done')

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
    lines: AuditLine[]; afDates: Set<string>; afAmtByDate: Record<string, number>
    listingIds: Record<string, number>
  }
  const groups: Record<string, Group> = {}
  const owners: Record<string, AuditOwner> = {}
  // Per-night rental for the whole month, keyed listing|date — the raw material for the
  // weekday/weekend cohort averages. AF lines are per-night; adjustments on the same night
  // sum into one figure.
  const curPerNight: Record<string, number> = {}

  const ownerOf = (id: string): AuditOwner => owners[id] || (owners[id] = {
    ownerId: id, ownerName: '', hasStatement: !!stmtByOwner[id],
    dueToOwner: stmtByOwner[id] ? (Number(stmtByOwner[id].due_to_owner ?? 0) || 0) : null,
    rental: 0, commission: 0, other: 0, net: 0, paid: 0, ties: false, items: 0, open: 0,
    done: 0, high: 0, reviewFlags: 0, notes: 0, commentCount: 0, signOff: null,
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
      rental: 0, commission: 0, other: 0, paid: 0,
      lines: [], afDates: new Set(), afAmtByDate: {}, listingIds: {},
    })

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
      .select('id, confirmation_code, guest_name, check_in, check_out, nights, status, source, listing_id, created_at, custom_fields')
      .in('confirmation_code', codes.slice(i, i + 200))
    for (const r of (data || []) as any[]) {
      const c = String(r.confirmation_code || '')
      // Prefer a confirmed/completed booking if the code somehow appears twice.
      if (!resByCode[c] || String(r.status || '') === 'confirmed') resByCode[c] = r
      if (r.listing_id) listingIds.add(String(r.listing_id))
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

  for (const o of Object.values(owners)) {
    o.ownerName = String(stmtByOwner[o.ownerId]?.owner_name || ownerName[o.ownerId] || '(unnamed)')
    o.ties = o.dueToOwner == null
      ? false
      : Math.abs(o.net - o.dueToOwner) < 0.02 || Math.abs(o.net - o.paid) < 0.02
  }

  // 6. Reviews already saved for this month.
  const { data: revRows, error: revErr } = await sb.from('owner_audit_reviews')
    .select('owner_id, item_key, status, note, comments, updated_by, updated_at')
    .eq('month', month)
  // A missing table (migration not run yet) degrades to "no reviews saved", never to a 500.
  const reviews: Record<string, any> = {}
  const prepSaved: Record<string, { cleaning: number; rm: number; by: string; at: string }> = {}
  if (!revErr) for (const r of (revRows || []) as any[]) {
    const key = String(r.item_key)
    if (key.startsWith(PREP_PREFIX)) {
      if (String(r.status) === 'done') {
        let j: any = null
        try { j = JSON.parse(String(r.note || '')) } catch { /* unreadable split — treat as unsaved */ }
        if (j) prepSaved[String(r.owner_id) + '|' + key.slice(PREP_PREFIX.length)] = {
          cleaning: Number(j.cleaning) || 0, rm: Number(j.rm) || 0,
          by: String(r.updated_by || ''), at: String(r.updated_at || ''),
        }
      }
      continue
    }
    if (key === SIGNOFF_KEY) {
      // Sign-off rows are owner-level, not items. status 'done' = signed off; anything else
      // (a cleared sign-off) reads as not signed.
      const o = owners[String(r.owner_id)]
      if (o && String(r.status) === 'done') o.signOff = { by: String(r.updated_by || ''), at: String(r.updated_at || '') }
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
    stayDates: string[]; mixWeekday: number; mixWeekend: number
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
    const mixWeekend = stayDates.filter(isWeekendNight).length
    const mixWeekday = monthNights - mixWeekend
    const splitMonth = !!(checkIn && checkOut) && (checkIn < win.start || checkOut > win.endExcl)
    const net = money(g.rental - g.commission + g.other)
    const rate = monthNights > 0 ? money(g.rental / monthNights) : null

    // Lead time: how far ahead was this booked? Last-minute bookings get rate cuts on purpose.
    const created = res ? String(res.created_at || '').slice(0, 10) : ''
    const leadDays = (created && checkIn)
      ? Math.max(0, Math.round((new Date(checkIn + 'T00:00:00Z').getTime() - new Date(created + 'T00:00:00Z').getTime()) / 86400000))
      : null

    pres.push({ g, res, bestListing, checkIn, checkOut, totalNights, monthNights, splitMonth, net, rate, stayDates, mixWeekday, mixWeekend, leadDays })
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
      const expected = money(pre.mixWeekday * wdAvg + pre.mixWeekend * weAvg)
      if (expected <= 0) continue
      const pN = p.wdN + p.weN, pR = p.wdR + p.weR
      return {
        expected, perNight: money(expected / pre.stayDates.length), label,
        prevAvg: pN >= 5 && pR > 0 ? money(pR / pN) : null,
        wdAvg: money(wdAvg), weAvg: money(weAvg),
      }
    }
    return null
  }

  const items: AuditItem[] = []
  const prep: PrepItem[] = []
  for (const pre of pres) {
    const { g, res, bestListing, checkIn, checkOut, totalNights, monthNights, splitMonth, net, rate, mixWeekday, mixWeekend, leadDays } = pre
    const bench = g.resCode ? benchOf(pre) : null
    const benchPct = bench && g.rental > 0.005 && bench.expected > 0 ? Math.round((g.rental / bench.expected) * 100) : null

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
        const ownerish = OWNERISH_RE.test(String(res?.source || '')) || OWNERISH_RE.test(String(res?.guest_name || ''))
        flags.push({ type: 'zero_rev', severity: ownerish ? 'info' : 'review',
          detail: ownerish ? 'Owner stay — $0 revenue by design; note any associated costs.' : '$0 revenue and not obviously an owner stay.' })
      }
      // LOW RATE — always on in-month nights only, so split-month stays are never flagged
      // for looking small on this month's statement. Night-mix aware (midweek stays are
      // judged against midweek pricing) and lead-time aware (last-minute bookings get a
      // relaxed bar, because those rates are cut on purpose).
      if (on.low_rate && g.rental > 0.005 && rate != null && monthNights > 0) {
        const mixTxt = monthNights + ' in-month night' + (monthNights === 1 ? '' : 's')
          + ' (' + mixWeekday + ' midweek · ' + mixWeekend + ' weekend)'
          + (splitMonth ? ', split-month stay' : '')
        const lastMin = leadDays != null && leadDays <= rules.lastMinDays
        const effPct = lastMin ? Math.max(10, rules.lowRatePct - rules.lastMinExtra) : rules.lowRatePct
        if (rules.lowRateMode === 'absolute') {
          if (rate < rules.lowRate) {
            flags.push({ type: 'low_rate', severity: 'review', amount: rate, detail: 'Effective rate $' + rate.toFixed(2) + '/night on ' + mixTxt + ' — under the $' + rules.lowRate + ' threshold.' })
          }
        } else if (rate < rules.lowRateFloor) {
          flags.push({ type: 'low_rate', severity: 'review', amount: rate, detail: 'Effective rate $' + rate.toFixed(2) + '/night on ' + mixTxt + ' — under the $' + rules.lowRateFloor + ' hard floor.' })
        } else if (bench && benchPct != null && benchPct < effPct) {
          flags.push({
            type: 'low_rate', severity: 'review', amount: rate,
            detail: 'Brought in ' + benchPct + '% of the expected revenue for this night mix — $' + rate.toFixed(2) + '/night vs the expected ≈$'
              + bench.perNight.toFixed(0) + '/night on ' + mixTxt + ', per the ' + bench.label
              + ' (midweek ≈$' + bench.wdAvg.toFixed(0) + '/n · weekend ≈$' + bench.weAvg.toFixed(0) + '/n, this + last month'
              + (bench.prevAvg != null ? '; last month blended $' + bench.prevAvg.toFixed(0) + '/n' : '') + ')'
              + (lastMin ? '. Booked ' + leadDays + 'd before check-in — still short even with the last-minute bar of ' + effPct + '%.' : '.'),
          })
        }
      }
      if (on.passthru && isPassthru) {
        flags.push({ type: 'passthru', severity: 'info', detail: 'Commission fully offsets rental (pass-through wash) — owner nets zero on it by design.' })
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
    }

    const worst: AuditSeverity = flags.some(f => f.severity === 'high') ? 'high'
      : flags.some(f => f.severity === 'review') ? 'review' : 'info'
    const key = g.resCode || g.lineKey
    const saved = reviews[g.ownerId + '|' + key]
    const defaultStatus: AuditStatus = worst === 'info' ? 'done' : 'review'
    const comments: AuditComment[] = Array.isArray(saved?.comments) ? saved.comments : []

    // OWNER PREP: Expedia-family reservations need their fees broken out.
    if (g.resCode && res && EXPEDIA_RE.test(String(res.source || ''))) {
      const cleanAmt = g.lines.filter(l => l.code === 'CF' || PREP_CLEAN_RE.test(l.label)).reduce((a, l) => a + l.amount, 0)
      const rmAmt = g.lines.filter(l => PREP_RM_RE.test(l.label)).reduce((a, l) => a + l.amount, 0)
      const hasClean = g.lines.some(l => l.code === 'CF' || PREP_CLEAN_RE.test(l.label))
      const hasRm = g.lines.some(l => PREP_RM_RE.test(l.label))
      prep.push({
        ownerId: g.ownerId, resCode: g.resCode,
        guest: res ? String(res.guest_name || '') : '',
        unit: unitOf[bestListing] || '',
        checkIn, checkOut,
        source: String(res.source || ''),
        reservationId: res ? String(res.id || '') : '',
        rental: g.rental, monthNights,
        cleaningAmt: hasClean ? money(cleanAmt) : null,
        rmAmt: hasRm ? money(rmAmt) : null,
        saved: prepSaved[g.ownerId + '|' + g.resCode] || null,
      })
    }

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
      mixWeekday, mixWeekend, leadDays,
      rental: g.rental, commission: g.commission, other: g.other, net,
      rate,
      lines: g.lines.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 60),
      flags,
      status: saved ? (String(saved.status) as AuditStatus) : defaultStatus,
      touched: !!saved,
      note: saved ? String(saved.note || '') : '',
      comments,
      updatedBy: saved ? (saved.updated_by || null) : null,
      updatedAt: saved ? (saved.updated_at || null) : null,
    })
  }

  // Order: worst first inside each owner, owners by name.
  const sevRank = (it: AuditItem) => it.flags.some(f => f.severity === 'high') ? 0
    : it.flags.some(f => f.severity === 'review') ? 1 : it.kind === 'reservation' ? 2 : 3
  items.sort((a, b) => a.ownerId.localeCompare(b.ownerId) || sevRank(a) - sevRank(b) || b.rental - a.rental)

  for (const it of items) {
    const o = owners[it.ownerId]
    if (!o) continue
    o.items++
    if (it.status !== 'done') o.open++
    else o.done++
    if (it.flags.some(f => f.severity === 'high')) o.high++
    else if (it.flags.some(f => f.severity === 'review')) o.reviewFlags++
    if (it.note) o.notes++
    o.commentCount += it.comments.length
  }

  // A statement with open rows again is no longer "signed off" — the signature only stands
  // while everything under it is completed. (The stored row remains; it re-surfaces if the
  // rows are completed again, which keeps the who/when honest.)
  for (const o of Object.values(owners)) if (o.open > 0) o.signOff = null

  const t = {
    owners: Object.keys(owners).length,
    statements: stmts.length,
    reservations: items.filter(i => i.kind === 'reservation').length,
    flagged: items.filter(i => i.flags.some(f => f.severity !== 'info')).length,
    high: items.filter(i => i.flags.some(f => f.severity === 'high')).length,
    review: items.filter(i => i.status === 'review').length,
    action: items.filter(i => i.status === 'action').length,
    done: items.filter(i => i.status === 'done').length,
    signedOff: Object.values(owners).filter(o => o.signOff).length,
    prepOpen: prep.filter(p => (p.cleaningAmt == null || p.rmAmt == null) && !p.saved).length,
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
    coverage: { ready: covered, missing: covered ? [] : [month] },
    rules,
    prep: prep.sort((a, b) =>
      Number(!!a.saved || (a.cleaningAmt != null && a.rmAmt != null)) - Number(!!b.saved || (b.cleaningAmt != null && b.rmAmt != null))
      || a.ownerId.localeCompare(b.ownerId) || a.checkIn.localeCompare(b.checkIn)),
  }
}

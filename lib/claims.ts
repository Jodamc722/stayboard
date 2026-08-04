// CLAIMS — shared vocabulary for the board, the wizard and the API.
// Isomorphic on purpose (no server-only imports) so the client board and the route handlers agree
// on stages, gates and deadline maths instead of each inventing their own.

export type Stage = 'draft' | 'review' | 'ready' | 'submitted' | 'decided' | 'settle' | 'closed'

export const STAGES: { key: Stage; label: string; blurb: string }[] = [
  { key: 'draft',     label: 'Draft',          blurb: 'Being built — evidence still going in' },
  { key: 'review',    label: "Jon's review",   blurb: 'Complete, waiting on approval to file' },
  { key: 'ready',     label: 'Ready to file',  blurb: 'Approved — file it before the clock runs out' },
  { key: 'submitted', label: 'Submitted',      blurb: 'With the channel' },
  { key: 'decided',   label: 'Decided',        blurb: 'They answered — won, partial or denied' },
  { key: 'settle',    label: 'Money & owner',  blurb: 'Verify the payment landed, then adjust the owner' },
  { key: 'closed',    label: 'Closed',         blurb: 'Done' },
]

export const STAGE_LABEL: Record<string, string> = STAGES.reduce((m, s) => { m[s.key] = s.label; return m }, {} as Record<string, string>)

export type Outcome = 'won' | 'partial' | 'denied' | 'withdrawn' | 'duplicate'
export const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: 'won',       label: 'Paid in full' },
  { key: 'partial',   label: 'Partially paid' },
  { key: 'denied',    label: 'Denied' },
  { key: 'withdrawn', label: 'Withdrawn' },
  { key: 'duplicate', label: 'Duplicate' },
]

export type WaitingOn = 'channel' | 'guest' | 'escalated'
export const WAITING: { key: WaitingOn; label: string }[] = [
  { key: 'channel',   label: 'Awaiting channel' },
  { key: 'guest',     label: 'Awaiting guest reply' },
  { key: 'escalated', label: 'Escalated' },
]

export const CHANNELS = ['Airbnb', 'VRBO', 'Booking.com', 'Expedia', 'Direct', 'Other']
export const CONDITIONS = ['New', 'Like new', 'Good', 'Fair', 'Worn']

export type ClaimItem = {
  id?: string
  position?: number
  description?: string | null
  condition_prior?: string | null
  age_text?: string | null
  cost?: number | null
  replacement_url?: string | null
  receipt_url?: string | null
  photo_urls?: string[]
  police_report?: boolean
}

export type Claim = {
  id: string
  stage: Stage
  outcome?: Outcome | null
  waiting_on?: WaitingOn | null
  reservation_id?: string | null
  listing_id?: string | null
  property?: string | null
  unit_no?: string | null
  guest_name?: string | null
  channel?: string | null
  confirmation_code?: string | null
  check_in?: string | null
  check_out?: string | null
  discovered_on?: string | null
  deadline_on?: string | null
  due_on?: string | null
  due_source?: string | null
  due_reason?: string | null
  next_check_in?: string | null
  nudged_on?: string | null
  deposit_held?: number | null
  submitted_on?: string | null
  decided_on?: string | null
  paid_on?: string | null
  amount_sought?: number | null
  amount_paid?: number | null
  summary?: string | null
  notes?: string | null
  guest_called?: boolean
  police_report?: boolean
  payment_verified?: boolean
  owner_adjusted?: boolean
  guesty_url?: string | null
  breezeway_url?: string | null
  channel_case_id?: string | null
  note_synced_at?: string | null
  note_sync_error?: string | null
  assignee_email?: string | null
  created_by?: string | null
  created_at?: string
  updated_at?: string
  history?: any[]
  items?: ClaimItem[]
}

// ── the clock ──────────────────────────────────────────────────────────────
// TWO DATES, NOT ONE.
//
//   deadline_on  the channel's HARD cutoff. Miss it and the claim is worth nothing.
//   due_on       the date WE intend to file. This is what the board counts down to, because a
//                board that only shows the hard deadline looks fine right up until it doesn't.
//
// The per-channel targets below are not arbitrary:
//   Airbnb       AirCover / Resolution Center. 14 days from the responsible guest's checkout.
//                We file by day 13 so a claim is never lost to a timezone argument.
//   Vrbo         Refundable damage deposit; Vrbo's own help gives the host 14 days after checkout
//                to file. BUT the platform releases the deposit back to the guest in up to 14 days
//                — so filing on day 13 can mean filing at money that is already gone. Target 7.
//   Expedia      Expedia Group (Expedia / Hotels.com / Vrbo are one group) offers card-on-file, an
//                upfront refundable deposit, or damage protection, and points back at Vrbo's
//                deposit mechanics. Same shape, same reason to be early. Target 7.
//   Booking.com  Damage Programme: report within 14 days of checkout. Recovery is capped around
//                €250 regardless of what you set, so a large claim needs another route.
//   Direct       No platform, no window — we hold the card. The only clock is how fresh the charge
//                looks to the bank, so this one moves fastest.
//
// Dates are plain YYYY-MM-DD strings throughout — no Date parsing of a bare date string, which
// silently shifts a day in a UTC-behind timezone.
export const FILING_WINDOW_DAYS = 13

export type ChannelPolicy = {
  /** Hard cutoff in days after checkout. null = the channel imposes none (direct bookings). */
  windowDays: number | null
  /** Days after checkout by which WE intend to file. Always <= windowDays. */
  targetDays: number
  /** Refundable deposit we hold on this channel, if any. */
  deposit: number | null
  /** Practical ceiling on what this channel will actually recover, if there is one. */
  capNote?: string
  /** Where the claim is actually filed. */
  route: string
  note?: string
}

export const DEFAULT_CHANNEL_POLICY: Record<string, ChannelPolicy> = {
  'Airbnb': {
    windowDays: 14, targetDays: 13, deposit: null,
    route: 'AirCover — Resolution Center',
    note: 'Call the guest before filing. 14 days from the responsible guest’s checkout.',
  },
  'VRBO': {
    windowDays: 14, targetDays: 7, deposit: 350,
    route: 'Damage deposit claim',
    note: 'The deposit is released back to the guest in up to 14 days — claim well before that.',
  },
  'Expedia': {
    windowDays: 14, targetDays: 7, deposit: 350,
    route: 'Deposit / card on file',
    note: 'Expedia Group points back to Vrbo’s deposit mechanics. Same release risk.',
  },
  'Booking.com': {
    windowDays: 14, targetDays: 10, deposit: null,
    capNote: 'Damage Programme recovery is capped around €250 (~$270) whatever you set.',
    route: 'Damage Programme',
    note: 'Anything above the cap needs a different route — the card, or the guest directly.',
  },
  'Direct': {
    windowDays: null, targetDays: 3, deposit: 350,
    route: 'Charge the card on file',
    note: 'No platform window. Charge while the stay is fresh — an old charge is a disputed charge.',
  },
  'Other': {
    windowDays: 14, targetDays: 10, deposit: null,
    route: 'Card / guest directly',
  },
}

/** Look up a channel, tolerating case and the odd slug. Falls back to 'Other'. */
export function policyFor(channel: any, overrides?: Record<string, ChannelPolicy> | null): ChannelPolicy {
  const table = (overrides && typeof overrides === 'object' && Object.keys(overrides).length)
    ? { ...DEFAULT_CHANNEL_POLICY, ...overrides }
    : DEFAULT_CHANNEL_POLICY
  const raw = String(channel || '').trim()
  const keys = Object.keys(table)
  for (let i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === raw.toLowerCase()) return table[keys[i]]
  const s = raw.toLowerCase()
  if (/airbnb/.test(s)) return table['Airbnb'] || DEFAULT_CHANNEL_POLICY['Airbnb']
  if (/vrbo|homeaway/.test(s)) return table['VRBO'] || DEFAULT_CHANNEL_POLICY['VRBO']
  if (/expedia|orbitz|travelocity/.test(s)) return table['Expedia'] || DEFAULT_CHANNEL_POLICY['Expedia']
  if (/booking/.test(s)) return table['Booking.com'] || DEFAULT_CHANNEL_POLICY['Booking.com']
  if (/direct|manual|website/.test(s)) return table['Direct'] || DEFAULT_CHANNEL_POLICY['Direct']
  return table['Other'] || DEFAULT_CHANNEL_POLICY['Other']
}

export function addDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''))
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function ymdOf(v: any): string | null {
  const s = String(v || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * The channel's HARD cutoff. Null when the channel imposes none (direct bookings) — that is a
 * real answer, not a missing one, and the UI says so rather than inventing a date.
 * We take one day of margin off the published window so a claim is never lost to a timezone.
 */
export function deadlineFor(checkOut?: string | null, channel?: any, overrides?: Record<string, ChannelPolicy> | null): string | null {
  const s = ymdOf(checkOut)
  if (!s) return null
  const p = policyFor(channel, overrides)
  if (p.windowDays === null) return null
  return addDays(s, Math.max(0, p.windowDays - 1))
}

/** The date WE intend to file: the channel's target, measured from checkout. */
export function dueDateFor(checkOut?: string | null, channel?: any, overrides?: Record<string, ChannelPolicy> | null): string | null {
  const s = ymdOf(checkOut)
  if (!s) return null
  return addDays(s, Math.max(0, policyFor(channel, overrides).targetDays))
}

/**
 * WHEN THE EVIDENCE DISAPPEARS.
 *
 * The channel's window is not the only clock. Once the unit is turned and the next guest walks in,
 * the damage cannot be photographed, re-inspected or attributed — "the last guest did it" stops
 * being a fact and becomes a claim. So if somebody is arriving before the channel target, the file
 * has to be built before they do.
 *
 * This deliberately moves OUR due date and never `deadline_on`: Airbnb's published rule is 14 days
 * from checkout, and inventing a shorter platform cutoff would be misstating someone else's policy.
 * Returns the date and why it is that date.
 */
export function dueWithTurnover(
  checkOut?: string | null,
  channel?: any,
  nextCheckIn?: string | null,
  overrides?: Record<string, ChannelPolicy> | null,
): { due: string | null; reason: 'policy' | 'turnover' } {
  const policyDue = dueDateFor(checkOut, channel, overrides)
  const arrival = ymdOf(nextCheckIn)
  if (!policyDue || !arrival) return { due: policyDue, reason: 'policy' }
  // File the day BEFORE they arrive — on the arrival day itself the room is already being turned.
  const beforeArrival = addDays(arrival, -1)
  if (beforeArrival && beforeArrival < policyDue) return { due: beforeArrival, reason: 'turnover' }
  return { due: policyDue, reason: 'policy' }
}

/** True while the next guest has not yet arrived — i.e. the evidence is still there to photograph. */
export function evidenceStillThere(claim: { next_check_in?: string | null }): boolean | null {
  const d = daysUntil(claim.next_check_in)
  return d === null ? null : d > 0
}

/** Today in Eastern time — the business runs on ET, and UTC "today" is wrong after 8pm. */
export function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

export function daysUntil(ymd?: string | null, from?: string): number | null {
  const s = String(ymd || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const a = Date.parse(s + 'T00:00:00Z')
  const b = Date.parse((from || todayET()) + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((a - b) / 86400000)
}

/** Stages where the filing clock still matters. Once it is filed the deadline is history. */
export function clockRunning(stage: string): boolean {
  return stage === 'draft' || stage === 'review' || stage === 'ready'
}

export type Urgency = 'expired' | 'critical' | 'soon' | 'ok' | 'none'

function urgencyOfDate(ymd: string | null | undefined, stage: any): Urgency {
  if (!clockRunning(String(stage || ''))) return 'none'
  const d = daysUntil(ymd)
  if (d === null) return 'none'
  if (d < 0) return 'expired'
  if (d <= 2) return 'critical'
  if (d <= 5) return 'soon'
  return 'ok'
}

/**
 * The board counts down to OUR due date, not the platform's cutoff — a board that only shows the
 * hard deadline reads as calm until the day it doesn't. Falls back to the hard deadline for claims
 * created before due dates existed.
 */
export function urgencyOf(claim: { stage?: string; due_on?: string | null; deadline_on?: string | null }): Urgency {
  return urgencyOfDate(claim.due_on || claim.deadline_on, claim.stage)
}

/** The separate, quieter alarm: how close the channel's hard cutoff is. */
export function hardUrgencyOf(claim: { stage?: string; deadline_on?: string | null }): Urgency {
  return urgencyOfDate(claim.deadline_on, claim.stage)
}

/** True when the hard cutoff deserves its own red line next to the due-date countdown. */
export function hardDeadlineBiting(claim: { stage?: string; due_on?: string | null; deadline_on?: string | null }): boolean {
  if (!claim.deadline_on) return false
  const h = hardUrgencyOf(claim)
  if (h === 'expired' || h === 'critical') return true
  // Also shout when the due date has already slipped past the point of comfort.
  const dueGone = (daysUntil(claim.due_on) ?? 1) < 0
  return dueGone && (h === 'soon')
}

// ── money ──────────────────────────────────────────────────────────────────
export function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function itemsTotal(items?: ClaimItem[] | null): number {
  if (!Array.isArray(items)) return 0
  let t = 0
  for (let i = 0; i < items.length; i++) t += num(items[i].cost) || 0
  return Math.round(t * 100) / 100
}

export function money(v: any): string {
  const n = num(v)
  if (n === null) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })
}

// ── the gates ──────────────────────────────────────────────────────────────
// What a claim needs before it can be filed. This is the whole point of a guided process: the
// reason claims get denied is a missing receipt or a photo nobody attached, and finding that out
// from the channel three weeks later is finding it out too late.
export type Gate = { key: string; label: string; ok: boolean; detail?: string }

export function gatesFor(claim: Claim, items: ClaimItem[]): Gate[] {
  const list = Array.isArray(items) ? items : []
  const missingPhotos = list.filter(i => !(Array.isArray(i.photo_urls) && i.photo_urls.length > 0)).length
  const missingCost = list.filter(i => !(num(i.cost) && (num(i.cost) as number) > 0)).length
  const missingLink = list.filter(i => !String(i.replacement_url || '').trim()).length
  const missingCond = list.filter(i => !String(i.condition_prior || '').trim() || !String(i.age_text || '').trim()).length
  const d = daysUntil(claim.deadline_on)
  return [
    { key: 'reservation', label: 'Attached to a reservation', ok: !!String(claim.reservation_id || '').trim(),
      detail: 'Guest, channel, dates and confirmation code all come from the booking.' },
    { key: 'items', label: 'At least one item logged', ok: list.length > 0,
      detail: 'Each damaged item is evidenced separately — that is how the channels read a claim.' },
    { key: 'photos', label: 'Every item has a damage photo', ok: list.length > 0 && missingPhotos === 0,
      detail: missingPhotos > 0 ? missingPhotos + ' item(s) with no photo' : undefined },
    { key: 'cost', label: 'Every item has a real cost', ok: list.length > 0 && missingCost === 0,
      detail: missingCost > 0 ? missingCost + ' item(s) with no cost — no placeholders' : undefined },
    { key: 'link', label: 'Every item has a like-kind replacement link', ok: list.length > 0 && missingLink === 0,
      detail: missingLink > 0 ? missingLink + ' item(s) with no link' : undefined },
    { key: 'condition', label: 'Condition and age recorded', ok: list.length > 0 && missingCond === 0,
      detail: missingCond > 0 ? missingCond + ' item(s) missing condition or age' : undefined },
    { key: 'summary', label: 'Summary written', ok: String(claim.summary || '').trim().length >= 40,
      detail: 'Most significant issue first. Professional and objective — no personal attacks.' },
    { key: 'called', label: 'Guest was called', ok: !!claim.guest_called,
      detail: 'Airbnb requires the guest to be contacted before the claim is filed.' },
    { key: 'deadline', label: 'Still inside the filing window', ok: d === null ? true : d >= 0,
      detail: d === null
        ? (claim.check_out ? 'This channel sets no filing window — the only clock is how fresh the charge looks.' : 'No checkout date on the booking.')
        : (d < 0 ? 'The window closed ' + Math.abs(d) + ' day(s) ago.' : d + ' day(s) left.') },
  ]
}

export function readyToFile(claim: Claim, items: ClaimItem[]): boolean {
  return gatesFor(claim, items).every(g => g.ok)
}

// ── the note that lands on the reservation ─────────────────────────────────
// Short, factual, and stamped, because it is read months later by someone reconciling an owner
// statement who was not in the room when any of this happened.
export function claimNoteLine(claim: Claim, event: 'submitted' | 'decided' | 'paid' | 'closed', items?: ClaimItem[]): string {
  const stamp = todayET()
  const n = Array.isArray(items) ? items.length : 0
  const what = n ? ' (' + n + ' item' + (n === 1 ? '' : 's') + ')' : ''
  const ch = String(claim.channel || 'the channel')
  if (event === 'submitted') {
    return '[' + stamp + '] DAMAGE CLAIM SUBMITTED to ' + ch + ' for ' + money(claim.amount_sought) + what
      + (claim.channel_case_id ? ' · case ' + claim.channel_case_id : '') + '.'
  }
  if (event === 'decided') {
    const o = String(claim.outcome || '')
    const label = o === 'won' ? 'APPROVED IN FULL' : o === 'partial' ? 'PARTIALLY APPROVED' : o === 'denied' ? 'DENIED' : o.toUpperCase()
    return '[' + stamp + '] DAMAGE CLAIM ' + label + ' by ' + ch
      + (claim.amount_paid != null ? ' — ' + money(claim.amount_paid) + ' of ' + money(claim.amount_sought) : '') + '.'
  }
  if (event === 'paid') {
    return '[' + stamp + '] DAMAGE CLAIM PAID — ' + money(claim.amount_paid) + ' received from ' + ch + '.'
  }
  return '[' + stamp + '] DAMAGE CLAIM CLOSED — ' + (claim.outcome ? String(claim.outcome) : 'no further action') + '.'
}

/** Card title in the shape the Asana board used: property, unit, guest, code. */
export function claimTitle(c: Claim): string {
  const bits = [c.property, c.unit_no, c.guest_name, c.confirmation_code]
    .map(x => String(x || '').trim()).filter(Boolean)
  return bits.length ? bits.join(', ') : 'Untitled claim'
}

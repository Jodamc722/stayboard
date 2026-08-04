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
// Airbnb's window closes 14 days after checkout. We file by day 13 so a claim is never lost to a
// timezone argument. Dates are handled as plain YYYY-MM-DD strings — no Date parsing of a bare
// date string, which silently shifts a day in a UTC-behind timezone.
export const FILING_WINDOW_DAYS = 13

export function addDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''))
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function deadlineFor(checkOut?: string | null): string | null {
  const s = String(checkOut || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? addDays(s, FILING_WINDOW_DAYS) : null
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
export function urgencyOf(claim: { stage?: string; deadline_on?: string | null }): Urgency {
  if (!clockRunning(String(claim.stage || ''))) return 'none'
  const d = daysUntil(claim.deadline_on)
  if (d === null) return 'none'
  if (d < 0) return 'expired'
  if (d <= 2) return 'critical'
  if (d <= 5) return 'soon'
  return 'ok'
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
      detail: d === null ? 'No checkout date on the booking.' : (d < 0 ? 'The window closed ' + Math.abs(d) + ' day(s) ago.' : d + ' day(s) left.') },
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

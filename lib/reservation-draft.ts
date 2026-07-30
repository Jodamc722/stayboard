// Building the actual email from a notice + its property config.
//
// Split from lib/reservation-emails.ts (which owns the CONFIG) so the desk, the API and later the
// Gmail sender all compose a draft the same way. If two places built the subject line separately
// they would drift, and a building would start getting two different-looking emails from us.
//
// PURE MODULE: no server imports, no DB.
import { renderTemplate, renderBody, type PropertyEmail, type TokenValues } from './reservation-emails'

export type Notice = {
  id?: string
  property_id: string
  listing_id?: string | null
  unit_no: string
  guest_name: string
  guest_phone?: string | null
  guest_email?: string | null
  arrival_date: string
  departure_date?: string | null
  booking_date?: string | null
  eta?: string | null
  adults?: number | null
  children?: number | null
  pets?: string | null
  pet_breed?: string | null
  confirmation_code?: string | null
  channel?: string | null
  reservation_id?: string | null
  sent_at?: string | null
  doc_path?: string | null
  doc_name?: string | null
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Dates render the way a front desk reads them, never ISO. */
export function prettyDate(d?: string | null): string {
  if (!d) return ''
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(d)
  return MON[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1]
}

/** Whole nights between arrival and departure, or '' when we can't say. */
export function nightsBetween(a?: string | null, b?: string | null): number | '' {
  if (!a || !b) return ''
  const t1 = Date.parse(String(a).slice(0, 10) + 'T12:00:00')
  const t2 = Date.parse(String(b).slice(0, 10) + 'T12:00:00')
  if (!isFinite(t1) || !isFinite(t2)) return ''
  const n = Math.round((t2 - t1) / 86400000)
  return n > 0 ? n : ''
}

export const AGENT = {
  name: 'Jon - Stay Hospitality',
  phone: '+19545268998',
  email: 'Support@stay-hospitality.com',
}

/** Everything a subject or body template may reference, for one notice. */
export function tokensForNotice(p: PropertyEmail, n: Notice, extra?: { shareLink?: string }): TokenValues {
  return {
    guest_name: n.guest_name || '',
    unit_no: n.unit_no || '',
    arrival_date: prettyDate(n.arrival_date),
    departure_date: prettyDate(n.departure_date),
    eta: n.eta || '',
    nights: nightsBetween(n.arrival_date, n.departure_date),
    guest_phone: n.guest_phone || '',
    guest_email: n.guest_email || '',
    adults: n.adults ?? '',
    children: n.children ?? '',
    pets: n.pets || '',
    pet_breed: n.pet_breed || '',
    confirmation_code: n.confirmation_code || '',
    property_name: p.name,
    share_link: (extra && extra.shareLink) || '',
    agent_name: AGENT.name,
    agent_phone: AGENT.phone,
    agent_email: AGENT.email,
  }
}

export type Draft = {
  to: string
  cc: string
  subject: string
  body: string
  mailto: string
  attach: boolean
  attachName: string
}

/**
 * The draft for one notice.
 *
 * NOTE ON `mailto`: a mailto: URL is a URL — it CANNOT carry a file attachment. For a property with
 * attachPdf on, the PDF has to be attached by the person sending, or by the Gmail draft path once
 * that lands. `attach` and `attachName` are returned so the UI can say so out loud rather than
 * letting someone send an Elser notice with the registration form missing.
 */
export function buildDraft(p: PropertyEmail, n: Notice, extra?: { shareLink?: string }): Draft {
  const vars = tokensForNotice(p, n, extra)
  const subject = renderTemplate(p.subject, vars)
  const body = renderBody(p, vars)
  const to = (p.to || '').trim()
  const cc = (p.cc || '').trim()
  const q: string[] = []
  if (cc) q.push('cc=' + encodeURIComponent(cc))
  q.push('subject=' + encodeURIComponent(subject))
  q.push('body=' + encodeURIComponent(body))
  return {
    to, cc, subject, body,
    // Addresses go in RAW. Percent-encoding them turns '@' into '%40', which several desktop mail
    // clients paste literally into the To field and then refuse to send. Only whitespace is stripped.
    mailto: 'mailto:' + to.replace(/\s+/g, '') + '?' + q.join('&'),
    attach: !!p.attachPdf,
    attachName: 'Reservation Report - ' + (n.guest_name || 'Guest') + ' - ' + (n.unit_no || 'Unit') + '.pdf',
  }
}

/** Stable key for the hand-typed path, where there is no Guesty reservation id to dedupe on. */
export function dupeKeyFor(n: Pick<Notice, 'property_id' | 'unit_no' | 'arrival_date' | 'departure_date'>): string {
  return [n.property_id, n.unit_no, String(n.arrival_date || '').slice(0, 10), String(n.departure_date || '').slice(0, 10)]
    .map(s => String(s || '').toLowerCase().trim()).join('|')
}

/**
 * How a notice is doing against its building's lead time.
 *
 * 'sent'     — done.
 * 'late'     — check-in has started and nothing went out. This is the state that costs a guest
 *              their check-in, so the desk shows it in red.
 * 'due'      — the send-by cutoff has passed, so the building's lead time is already breached,
 *              but the guest has not arrived yet. Amber: still recoverable, send it now.
 * 'upcoming' — further out than the lead time. Nothing to do.
 * `now` is injected rather than read here so the server and the browser agree.
 */
export type NoticeUrgency = 'sent' | 'late' | 'due' | 'upcoming'

export function urgencyOf(n: Notice, leadHours: number, now: Date): NoticeUrgency {
  if (n.sent_at) return 'sent'
  if (!n.arrival_date) return 'upcoming'
  // No check-in clock is stored per building, so assume the rental period starts at 15:00 local —
  // the check-in time Elser's own form states. Erring early is the safe direction: it can make a
  // notice look due sooner than it is, never later.
  const start = Date.parse(String(n.arrival_date).slice(0, 10) + 'T15:00:00')
  if (!isFinite(start)) return 'upcoming'
  const cutoff = start - Math.max(0, leadHours) * 3600_000
  const t = now.getTime()
  if (t >= cutoff) return t >= start ? 'late' : 'due'
  return 'upcoming'
}

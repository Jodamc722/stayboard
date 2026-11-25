// BOOKING LINKS — the rules that need no network, so plain node can test them
// (lib/__tests__/booking-rules.test.mjs). The calendar reading and the booking itself are lib/booking.ts.
//
// Jon, 2026-11-24, after an owner booked an onboarding call on Thanksgiving Day and the links offered
// the whole week he was off: "Why did you have Thanksgiving open. Also please make sure I get email of
// confirmation of a time booked."
//
// Three things, all here:
//  1. HOLIDAYS. No booking link offers a time on a major US holiday, whatever its days and hours say.
//  2. DAYS OFF. An all-day "Out of office" on the host's calendar closes those days even when Google has
//     it marked Free. Google marks every new all-day event Free, so free/busy alone never sees it: that
//     is exactly how his week off (on the calendar since Nov 11) was still being offered.
//  3. THE HOST'S CONFIRMATION. One email to the host for every booking: who, what, when, where.

// ── 1. Holidays ─────────────────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()
/** The nth (1-based) given weekday of a month; n = -1 is the last one. */
function nth(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) { const first = dow(y, m, 1); return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7 }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(), ld = dow(y, m, last)
  return last - ((ld - weekday + 7) % 7)
}
/**
 * The name of the US holiday on this day (YYYY-MM-DD), or ''. The six a hospitality office is closed
 * for meetings on: New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas
 * Day, plus Christmas Eve. The Friday after Thanksgiving and the smaller federal holidays stay open;
 * a host who is off those days blocks them on the calendar.
 */
export function usHoliday(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  if (!m) return ''
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo === 1 && d === 1) return "New Year's Day"
  if (mo === 5 && d === nth(y, 5, 1, -1)) return 'Memorial Day'
  if (mo === 7 && d === 4) return 'Independence Day'
  if (mo === 9 && d === nth(y, 9, 1, 1)) return 'Labor Day'
  if (mo === 11 && d === nth(y, 11, 4, 4)) return 'Thanksgiving'
  if (mo === 12 && d === 24) return 'Christmas Eve'
  if (mo === 12 && d === 25) return 'Christmas Day'
  return ''
}

// ── 2. Days off on the calendar ─────────────────────────────────────────────────────────────────
/** The few fields of a Google Calendar event this reads. */
export type CalEvent = { summary?: string; status?: string; eventType?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }
const OFF_WORDS = /\b(out of (the )?office|ooo|vacation|pto|time off|days? off|off work|on leave|not bookable|no bookings?|office closed)\b/i
/** Does this title say the host is away? "Google Meet", "Send out expenses" and the like do not. */
export const saysOff = (summary: string) => OFF_WORDS.test(String(summary || ''))
const addDay = (ymd: string, n: number) => { const t = new Date(ymd + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()) }
/**
 * The days (YYYY-MM-DD) the host is off, from the events on the calendar: every day of an all-day
 * event whose title says so, and every day an Out-of-office event (Google's own type) covers from
 * start to finish. Whether Google has it marked Free or Busy makes no difference.
 */
export function offDays(events: CalEvent[]): Set<string> {
  const out = new Set<string>()
  for (const e of events || []) {
    if (!e || e.status === 'cancelled') continue
    const s = e.start?.date, en = e.end?.date
    if (s && en && /^\d{4}-\d{2}-\d{2}$/.test(s) && /^\d{4}-\d{2}-\d{2}$/.test(en)) {
      if (!saysOff(e.summary || '') && e.eventType !== 'outOfOffice') continue
      // an all-day event's end date is the morning after its last day
      for (let d = s, i = 0; d < en && i < 120; d = addDay(d, 1), i++) out.add(d)
    }
  }
  return out
}

// ── 3. The host's confirmation ──────────────────────────────────────────────────────────────────
export type BookedMail = { title: string; guest: string; email: string; phone?: string; note?: string; day: string; time: string; minutes: number; where: 'meet' | 'phone' | 'in-person'; link?: string; place?: string; eventUrl?: string; moved?: boolean; ownerUrl?: string }
const esc = (v: unknown) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const safeUrl = (u?: string) => (u && /^https:\/\//.test(u) ? u : '')
const clock = (hm: string) => { const [h, m] = hm.split(':').map(Number); return ((h % 12) || 12) + ':' + pad(m) + (h < 12 ? ' AM' : ' PM') }
/** "Thursday, November 26" */
export const longDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const shortDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
/** "11:00 AM to 12:00 PM" */
export function span(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number), end = h * 60 + m + minutes
  return clock(time) + ' to ' + clock(pad(Math.floor(end / 60) % 24) + ':' + pad(end % 60))
}
export const bookedSubject = (b: BookedMail) => `${b.moved ? 'Moved' : 'Booked'}: ${b.title} with ${b.guest} · ${shortDay(b.day)}, ${clock(b.time)}`
const F = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`
const INK = '#161614', MUTED = '#6f6d66', LINE = '#e7e4dc', SOFT = '#f6f4ee'
/** The email the host gets. Everything a guest typed is escaped: it is text, never markup. */
export function bookedHtml(b: BookedMail): string {
  const where = b.where === 'meet' ? (safeUrl(b.link) ? `<a href="${esc(b.link)}" style="color:${INK}">Google Meet</a>` : 'Google Meet') : b.where === 'phone' ? 'By phone' + (b.phone ? ', ' + esc(b.phone) : '') : esc(b.place || 'At the home')
  const row = (k: string, v: string) => v ? `<tr><td valign="top" width="72" style="padding:0 0 8px;font:12.5px/1.5 ${F};color:${MUTED}">${k}</td><td valign="top" style="padding:0 0 8px;font:14.5px/1.5 ${F};color:${INK}">${v}</td></tr>` : ''
  const links = [safeUrl(b.eventUrl) ? `<a href="${esc(b.eventUrl)}" style="color:${INK}">Open in Google Calendar</a>` : '', safeUrl(b.ownerUrl) ? `<a href="${esc(b.ownerUrl)}" style="color:${INK}">Open their onboarding</a>` : ''].filter(Boolean).join(' &middot; ')
  return `<div style="background:#f1efe8;padding:24px 10px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:14px;border-collapse:separate">`
    + `<tr><td style="padding:24px 24px 0"><div style="font:700 11px/1.3 ${F};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin:0 0 10px">${b.moved ? 'Booking moved' : 'New booking'}</div>`
    + `<div style="font:700 21px/1.25 ${F};color:${INK}">${esc(b.title)} with ${esc(b.guest)}</div></td></tr>`
    + `<tr><td style="padding:16px 24px 0"><div style="background:${SOFT};border-radius:12px;padding:16px 18px"><div style="font:700 17px/1.3 ${F};color:${INK}">${esc(longDay(b.day))}</div><div style="font:15px/1.5 ${F};color:${INK};margin-top:2px">${esc(span(b.time, b.minutes))} Eastern</div></div></td></tr>`
    + `<tr><td style="padding:18px 24px 0"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">`
    + row('Who', `${esc(b.guest)}<br><span style="color:${MUTED}">${esc(b.email)}${b.phone && b.where !== 'phone' ? ' &middot; ' + esc(b.phone) : ''}</span>`)
    + row('Where', where)
    + row('Note', b.note ? esc(b.note) : '')
    + `</table></td></tr>`
    + `<tr><td style="padding:14px 24px 24px"><div style="border-top:1px solid ${LINE};padding-top:14px;font:12.5px/1.5 ${F};color:${MUTED}">${links ? links + '<br>' : ''}It is on your calendar and ${esc(b.guest)} has the invitation from Google. Sent by Lighthouse when someone books through one of your links.</div></td></tr>`
    + `</table></div>`
}

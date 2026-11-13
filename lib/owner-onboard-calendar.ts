// THE ONBOARDING CALL ON THE CALENDAR (Jon, 2026-11-13: "attach my calendar, also have it create a Google
// meeting if I select a date for the call"). Uses the Google connection the app already holds for a teammate's
// mailbox (google_tokens), with the calendar permissions added to the same consent:
//   busyOn(host, day)        → that person's busy blocks for a day, so a free time is picked
//   createCall(r, …)         → a calendar event on the host's calendar with a Google Meet link, the owner (and
//                              the salesperson) invited; Google emails the invitations
// Times are Eastern (America/New_York), as typed. Server-only.
import 'server-only'
import { accessTokenFor } from './gmail-send'
import type { OORecord } from './owner-onboard'

const TZ = 'America/New_York'
const RECONNECT = 'Connect Google again to add the calendar permission: open /api/google/auth?mailbox='
const api = async (token: string, url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init?.headers || {}) }, cache: 'no-store' })
  const d: any = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, d }
}
const scopeErr = (host: string, status: number, d: any) => (status === 403 || /insufficient|scope/i.test(JSON.stringify(d?.error || '')) ? RECONNECT + encodeURIComponent(host) : String(d?.error?.message || 'Google Calendar said no (' + status + ').').slice(0, 200))

/** UTC instant of a wall-clock time in Eastern (handles daylight saving). */
function eastern(day: string, hm: string): Date {
  const guess = new Date(day + 'T' + hm + ':00Z')
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: TZ })), utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(guess.getTime() + (utc.getTime() - shown.getTime()))
}
const hm = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })

export async function busyOn(host: string, day: string): Promise<{ ok: boolean; error?: string; busy: { from: string; to: string }[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Pick a date.', busy: [] }
  const t = await accessTokenFor(host)
  if (!t.token) return { ok: false, error: t.error || 'Google is not connected for ' + host + '.', busy: [] }
  const r = await api(t.token, 'https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', body: JSON.stringify({ timeMin: eastern(day, '00:00').toISOString(), timeMax: eastern(day, '23:59').toISOString(), timeZone: TZ, items: [{ id: 'primary' }] }) })
  if (!r.ok) return { ok: false, error: scopeErr(host, r.status, r.d), busy: [] }
  const list: any[] = r.d?.calendars?.primary?.busy || []
  return { ok: true, busy: list.map(b => ({ from: hm(new Date(b.start)), to: hm(new Date(b.end)) })) }
}

export async function createCall(r: OORecord, o: { host: string; day: string; time: string; minutes: number; agenda: string }): Promise<{ ok: boolean; error?: string; link?: string; eventId?: string; eventUrl?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.day) || !/^\d{2}:\d{2}$/.test(o.time)) return { ok: false, error: 'Pick a date and a time.' }
  const t = await accessTokenFor(o.host)
  if (!t.token) return { ok: false, error: t.error || 'Google is not connected for ' + o.host + '.' }
  const start = eastern(o.day, o.time), end = new Date(start.getTime() + Math.max(15, Math.min(180, o.minutes || 30)) * 60_000)
  const where = [r.attach.property, r.attach.unitLabel ? 'unit ' + r.attach.unitLabel : ''].filter(Boolean).join(', ')
  const attendees = Array.from(new Set([r.custom.ownerEmail, r.custom.from === 'sales' ? r.custom.sales.email : '', r.custom.gm.email].map(e => String(e || '').trim().toLowerCase()).filter(e => /@/.test(e) && e !== o.host.toLowerCase()))).map(email => ({ email }))
  const body = {
    summary: `Stay Hospitality onboarding call${r.custom.ownerName ? ' · ' + r.custom.ownerName : ''}${where ? ' · ' + where : ''}`,
    description: (o.agenda || 'A walk through your listing and the pricing strategy.') + '\n\nStay Hospitality',
    start: { dateTime: start.toISOString(), timeZone: TZ }, end: { dateTime: end.toISOString(), timeZone: TZ },
    attendees, reminders: { useDefault: true },
    conferenceData: { createRequest: { requestId: r.code + '-' + Date.now().toString(36), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
  }
  // an earlier event for this call is moved, not duplicated
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
  const res = r.call?.eventId
    ? await api(t.token, base + '/' + encodeURIComponent(r.call.eventId) + '?conferenceDataVersion=1&sendUpdates=all', { method: 'PATCH', body: JSON.stringify({ ...body, conferenceData: undefined }) })
    : await api(t.token, base + '?conferenceDataVersion=1&sendUpdates=all', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) return { ok: false, error: scopeErr(o.host, res.status, res.d) }
  const link = String(res.d?.hangoutLink || (res.d?.conferenceData?.entryPoints || []).find((e: any) => e.entryPointType === 'video')?.uri || r.call?.link || '')
  return { ok: true, link, eventId: String(res.d?.id || ''), eventUrl: String(res.d?.htmlLink || '') }
}

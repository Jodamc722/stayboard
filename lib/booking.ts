// A BOOKING LINK, LIKE CALENDLY, IN LIGHTHOUSE (Jon, 2026-11-19: "create a link where it can function like a
// Calendly in my app. So when we share a link they can book a timeslot for onboarding call, or onboarding meeting
// etc. That way I can share the link after they complete the onboarding forms").
//
// A BOOKING TYPE is one kind of meeting: its name, how long, where (Google Meet, by phone, at the home), whose
// calendar, and the hours it can be booked in. Each has a public page, /book/<slug>. Add ?o=<the owner's onboarding
// code> and the page knows who is booking: no name or email to type, and the booking lands on that owner's
// onboarding (their timeline and the desk).
//
// WHAT IS OFFERED. Times inside the type's hours on its days, Eastern, that do not touch anything on the host's
// Google Calendar (with a buffer either side), not sooner than the notice, not further out than the horizon. One
// free/busy read covers the whole horizon. The slot is checked again at the moment of booking.
//
// WHAT A BOOKING DOES. An event on the host's calendar, the guest invited by Google (so they get the invitation and
// the reminders from Google itself), a Meet link when the type is a video call. For an owner's onboarding call the
// existing call record is used, so a second booking MOVES the event rather than adding another.
//
// A PUBLIC FORM THAT SENDS INVITATIONS is a way to spam someone, so: a hidden trap field, at most a few bookings an
// hour from one address, and a ceiling on bookings a day. Owner links (?o=) invite only the owner on file.
import 'server-only'
import { getSettingFresh, setSetting } from './app-settings'
import { accessTokenFor, forgetToken } from './gmail-send'
import { eastern } from './owner-onboard-calendar'

export const BOOKING_KEY = 'booking_links'
const TZ = 'America/New_York'
export type BookingWhere = 'meet' | 'phone' | 'in-person'
export type BookingType = {
  slug: string; title: string; blurb: string; minutes: number; where: BookingWhere
  /** Whose Google Calendar it reads and books on. */ host: string; hostName: string
  /** 0 Sunday … 6 Saturday */ days: number[]; from: string; to: string
  noticeHours: number; horizonDays: number; bufferMin: number; on: boolean
}
export type BookingLog = { at: string; slug: string; day: string; time: string; name: string; email: string; code?: string; eventUrl?: string }
export type BookingSettings = { types: BookingType[]; log: BookingLog[]; hits?: Record<string, number[]> }

const DEFAULTS: BookingType[] = [
  { slug: 'onboarding-call', title: 'Onboarding call', blurb: 'A walk through your listing and the pricing strategy, on Google Meet.', minutes: 30, where: 'meet', host: 'jon@stay-hospitality.com', hostName: 'Jon McGill', days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00', noticeHours: 24, horizonDays: 21, bufferMin: 15, on: true },
  { slug: 'onboarding-meeting', title: 'Onboarding meeting at the home', blurb: 'We meet you at the home to walk it together.', minutes: 60, where: 'in-person', host: 'jon@stay-hospitality.com', hostName: 'Jon McGill', days: [1, 2, 3, 4, 5], from: '10:00', to: '16:00', noticeHours: 48, horizonDays: 21, bufferMin: 30, on: true },
]
const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const clamp = (n: any, lo: number, hi: number, d: number) => { const x = Math.round(Number(n)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d }
export function cleanType(t: any): BookingType | null {
  const slug = String(t?.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const title = String(t?.title || '').trim().slice(0, 80)
  if (!slug || !title) return null
  const from = HM.test(String(t?.from)) ? String(t.from) : '09:00', to = HM.test(String(t?.to)) && String(t.to) > from ? String(t.to) : '17:00'
  return { slug, title, blurb: String(t?.blurb || '').trim().slice(0, 300), minutes: clamp(t?.minutes, 15, 180, 30), where: t?.where === 'phone' || t?.where === 'in-person' ? t.where : 'meet',
    host: String(t?.host || DEFAULTS[0].host).trim().toLowerCase().slice(0, 120), hostName: String(t?.hostName || '').trim().slice(0, 80),
    days: Array.from(new Set((Array.isArray(t?.days) ? t.days : [1, 2, 3, 4, 5]).map((d: any) => Number(d)).filter((d: number) => d >= 0 && d <= 6))).sort() as number[],
    from, to, noticeHours: clamp(t?.noticeHours, 0, 336, 24), horizonDays: clamp(t?.horizonDays, 1, 60, 21), bufferMin: clamp(t?.bufferMin, 0, 120, 15), on: t?.on !== false }
}
export async function readBooking(): Promise<BookingSettings> {
  const v = await getSettingFresh<any>(BOOKING_KEY, null)
  const types = (Array.isArray(v?.types) ? v.types : DEFAULTS).map(cleanType).filter(Boolean) as BookingType[]
  return { types: types.length ? types : DEFAULTS, log: Array.isArray(v?.log) ? v.log.slice(0, 200) : [], hits: v?.hits && typeof v.hits === 'object' ? v.hits : {} }
}
export async function saveBookingTypes(list: any[], by: string | null): Promise<{ ok: boolean; error?: string; types?: BookingType[] }> {
  const types = (Array.isArray(list) ? list : []).map(cleanType).filter(Boolean) as BookingType[]
  if (!types.length) return { ok: false, error: 'Keep at least one booking type.' }
  if (new Set(types.map(t => t.slug)).size !== types.length) return { ok: false, error: 'Two booking types have the same link name.' }
  const cur = await readBooking()
  const w = await setSetting(BOOKING_KEY, { ...cur, types: types.slice(0, 60) }, by)
  return w.ok ? { ok: true, types } : { ok: false, error: w.error }
}

/**
 * MY OWN LINKS (Jon, 2026-11-20: "allow users to create own Calendly link… he can also set up his cal links").
 * Anyone signed in keeps booking links on their own Google Calendar. This replaces the caller's links and touches
 * nobody else's: the host is always the caller, whatever was sent. A link name already used by someone else is refused.
 */
export async function saveMyTypes(list: any[], me: string, by: string | null): Promise<{ ok: boolean; error?: string; types?: BookingType[] }> {
  const host = String(me || '').trim().toLowerCase()
  if (!/@/.test(host)) return { ok: false, error: 'Sign in first.' }
  const mine = (Array.isArray(list) ? list : []).slice(0, 8).map(t => cleanType({ ...t, host })).filter(Boolean) as BookingType[]
  if (new Set(mine.map(t => t.slug)).size !== mine.length) return { ok: false, error: 'Two of your links have the same link name.' }
  const cur = await readBooking()
  const others = cur.types.filter(t => t.host !== host)
  const clash = mine.find(t => others.some(o => o.slug === t.slug))
  if (clash) return { ok: false, error: `The link name “${clash.slug}” is already in use. Pick another, for example ${host.split('@')[0].replace(/[^a-z0-9]+/g, '-')}-${clash.slug}.` }
  const types = [...others, ...mine]
  if (!types.length) return { ok: false, error: 'Keep at least one booking link in the app.' }
  const w = await setSetting(BOOKING_KEY, { ...cur, types: types.slice(0, 60) }, by)
  return w.ok ? { ok: true, types: mine } : { ok: false, error: w.error }
}

const ymdET = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const label = (hm: string) => { const [h, m] = hm.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM') }
export async function busyBlocks(host: string, from: Date, to: Date): Promise<{ ok: boolean; error?: string; busy: { s: number; e: number }[] }> {
  const ask = async () => {
    const t = await accessTokenFor(host)
    if (!t.token) return { noToken: t.error || 'Google is not connected for ' + host + '.' }
    const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer ' + t.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: TZ, items: [{ id: 'primary' }] }) })
    return { r, d: await r.json().catch(() => ({})) as any }
  }
  let a = await ask()
  // a token minted before the calendar permission was granted: forget it and ask once more
  if (a.r && (a.r.status === 401 || a.r.status === 403)) { forgetToken(host); a = await ask() }
  if (a.noToken || !a.r) return { ok: false, error: a.noToken, busy: [] }
  const r = a.r, d = a.d
  if (!r.ok) return { ok: false, error: String(d?.error?.message || 'Google Calendar said no (' + r.status + ').').slice(0, 200), busy: [] }
  return { ok: true, busy: ((d?.calendars?.primary?.busy || []) as any[]).map(b => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() })) }
}
export type DaySlots = { day: string; label: string; times: { time: string; label: string }[] }
/** Every bookable time for a type, from now to its horizon. Days with nothing free are left out. */
export async function openSlots(t: BookingType, only?: string): Promise<{ ok: boolean; error?: string; days: DaySlots[] }> {
  const now = Date.now(), earliest = now + t.noticeHours * 3600_000
  const first = only || ymdET(new Date(earliest)), days: string[] = []
  if (only) days.push(only)
  else for (let i = 0; i <= t.horizonDays + 1 && days.length <= t.horizonDays; i++) days.push(ymdET(new Date(earliest + i * 86400_000)))
  const b = await busyBlocks(t.host, eastern(first, '00:00'), new Date(eastern(days[days.length - 1], '23:59').getTime() + 60_000))
  if (!b.ok) return { ok: false, error: b.error, days: [] }
  const out: DaySlots[] = []
  const [fh, fm] = t.from.split(':').map(Number), [th, tm] = t.to.split(':').map(Number)
  for (const day of Array.from(new Set(days))) {
    const dow = new Date(day + 'T12:00:00Z').getUTCDay()
    if (t.days.indexOf(dow) < 0) continue
    const times: DaySlots['times'] = []
    for (let m = fh * 60 + fm; m + t.minutes <= th * 60 + tm; m += 30) {
      const hm = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
      const s = eastern(day, hm).getTime(), e = s + t.minutes * 60_000
      if (s < earliest || s > now + (t.horizonDays + 1) * 86400_000) continue
      const pad = t.bufferMin * 60_000
      if (b.busy.some(x => x.s < e + pad && x.e > s - pad)) continue
      times.push({ time: hm, label: label(hm) })
    }
    if (times.length) out.push({ day, label: new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }), times })
  }
  return { ok: true, days: out }
}

/** Too many bookings from one address, or in one day: refuse. Returns the reason, or '' and records the hit. */
export function rateCheck(st: BookingSettings, ip: string): string {
  const now = Date.now(), hits = st.hits || (st.hits = {})
  for (const k of Object.keys(hits)) { hits[k] = (hits[k] || []).filter(t => now - t < 86400_000); if (!hits[k].length) delete hits[k] }
  const mine = hits[ip] || []
  if (mine.filter(t => now - t < 3600_000).length >= 4) return 'That is a lot of bookings in an hour. Please try again later, or reply to your Stay contact.'
  if (Object.values(hits).reduce((s, a) => s + a.length, 0) >= 60) return 'Online booking is paused for today. Please reply to your Stay contact to set a time.'
  hits[ip] = [...mine, now]
  return ''
}

export type BookedEvent = { ok: boolean; error?: string; link?: string; eventId?: string; eventUrl?: string }
/** The calendar event for a booking. `moveEventId` moves an earlier event instead of adding one. */
export async function createBookingEvent(t: BookingType, o: { day: string; time: string; name: string; email: string; phone?: string; note?: string; place?: string; also?: string[]; moveEventId?: string; ref: string }): Promise<BookedEvent> {
  const tok = await accessTokenFor(t.host)
  if (!tok.token) return { ok: false, error: 'The calendar is not connected right now. Please reply to your Stay contact to set a time.' }
  const start = eastern(o.day, o.time), end = new Date(start.getTime() + t.minutes * 60_000)
  const attendees = Array.from(new Set([o.email, ...(o.also || [])].map(e => String(e || '').trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e !== t.host))).map(email => ({ email }))
  const body: any = {
    summary: `Stay Hospitality · ${t.title} · ${o.name}`,
    description: [t.blurb, o.phone ? 'Phone: ' + o.phone : '', o.note ? 'From ' + o.name + ': ' + o.note : '', 'Booked through the Stay Hospitality booking link.'].filter(Boolean).join('\n\n'),
    start: { dateTime: start.toISOString(), timeZone: TZ }, end: { dateTime: end.toISOString(), timeZone: TZ },
    attendees, reminders: { useDefault: true },
    ...(t.where === 'in-person' && o.place ? { location: o.place } : {}),
    ...(t.where === 'meet' ? { conferenceData: { createRequest: { requestId: o.ref + '-' + Date.now().toString(36), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  }
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
  const go = (token: string) => { const snd = (url: string, method: string, b: any) => fetch(url, { method, cache: 'no-store', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) as any })); return o.moveEventId
    ? snd(base + '/' + encodeURIComponent(o.moveEventId) + '?conferenceDataVersion=1&sendUpdates=all', 'PATCH', { ...body, conferenceData: undefined })
    : snd(base + '?conferenceDataVersion=1&sendUpdates=all', 'POST', body) }
  let res = await go(tok.token)
  if (res.status === 401 || res.status === 403) { forgetToken(t.host); const again = await accessTokenFor(t.host); if (again.token) res = await go(again.token) }
  if (!res.ok) return { ok: false, error: 'The calendar would not take the booking. Please reply to your Stay contact to set a time.' }
  return { ok: true, link: String(res.d?.hangoutLink || (res.d?.conferenceData?.entryPoints || []).find((e: any) => e.entryPointType === 'video')?.uri || ''), eventId: String(res.d?.id || ''), eventUrl: String(res.d?.htmlLink || '') }
}
/** What a guest may know about a type. */
export const publicType = (t: BookingType) => ({ slug: t.slug, title: t.title, blurb: t.blurb, minutes: t.minutes, where: t.where, hostName: t.hostName })

// THE NIGHTLY REPORT (Jon, 2026-11-24: "a report that matches the Botanica shareable report we share
// with Margaux each week … broken out by whole property, Garden, etc. Make it exactly the way the
// Botanica report is"). One row per night — rooms, nights sold, revenue, cleaning — for each of the
// three sides, in the same shape /report/botanica reads (Day), so the page can be laid out the same.
//
// Same counting as the Revenue page (lib/garden/segments): a stay sits on the side that sold it (Guesty → Botanica, Cloudbeds → Garden),
// revenue is rent plus cleaning before taxes (ADR includes cleaning, as on the Botanica report), and
// a stay crossing a night boundary is split night by night. Arrivals carry the whole stay's length
// and how far ahead it was booked, for average length of stay and booking window.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { loadStays, narrow, leadDays, type Scope } from './segments'
import { channelName } from './revenue'

export type NightlyDay = { date: string; dow: string; inv: number; rns: number; rev: number; cleaning: number; arr: number; arrNights: number; arrLead: number; arrLeadCnt: number }
const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const ms = (ymd: string) => Date.parse(ymd + 'T00:00:00Z')
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const D = /^\d{4}-\d{2}-\d{2}$/

// BOTANICA'S UNITS LIVE, as the Botanica report (app/api/public/botanica-report) divides: 32 from May 4 2026, and from
// June 17 the units that are Botanica's today — Guesty's Botanica listings less the ones the hotel keeps and sells
// itself (lib/garden/botanica-active). Both reports use the same count, so occupancy is one number.
const BOTANICA_OPENING: [string, number][] = [['2026-05-04', 32]]
const BOTANICA_FULL_FROM = '2026-06-17'
const botanicaUnits = (date: string, now: number) => { if (date >= BOTANICA_FULL_FROM) return now; let u = 0; for (const [from, n] of BOTANICA_OPENING) if (date >= from) u = n; return u }

export async function gardenNightly(opts: { from?: string; to?: string } = {}) {
  const db = supabaseAdmin()
  const today = todayET()
  // Seven months back to four months ahead unless asked otherwise: enough for "last month" and "upcoming".
  const from = opts.from && D.test(opts.from) ? opts.from : iso(ms(today) - 210 * DAY)
  const to = opts.to && D.test(opts.to) && opts.to >= from ? opts.to : iso(ms(today) + 120 * DAY)
  const all = await loadStays(from, to)
  const lo = ms(from), hi = ms(to) + DAY
  const days: Record<string, NightlyDay[]> = {}, rooms: Record<string, number> = {}
  for (const scope of ['all', 'garden', 'botanica'] as Scope[]) {
    const N = narrow(all, scope, null, channelName)
    rooms[scope] = N.rooms.length
    const by: Record<string, NightlyDay> = {}
    for (let t = lo; t < hi; t += DAY) { const d = iso(t); by[d] = { date: d, dow: DOW[new Date(t).getUTCDay()], inv: scope === 'botanica' ? botanicaUnits(d, N.rooms.length) : N.rooms.length, rns: 0, rev: 0, cleaning: 0, arr: 0, arrNights: 0, arrLead: 0, arrLeadCnt: 0 } }
    for (const x of N.stays) {
      if (x.status === 'canceled' || x.status === 'no_show') continue
      const perNight = x.total / x.nights, cleanNight = x.fees / x.nights
      for (let t = Math.max(lo, ms(x.checkIn)); t < Math.min(hi, ms(x.checkOut)); t += DAY) { const d = by[iso(t)]; if (!d) continue; d.rns += x.parts.length; d.rev += perNight; d.cleaning += cleanNight }
      const a = by[x.checkIn]
      if (a) { a.arr++; a.arrNights += x.nights; const L = leadDays(x); if (L != null) { a.arrLead += L; a.arrLeadCnt++ } }
    }
    days[scope] = Object.values(by).map(d => ({ ...d, rev: Math.round(d.rev * 100) / 100, cleaning: Math.round(d.cleaning * 100) / 100 }))
  }
  // Where the hotel's own bookings start in Lighthouse: nights before it have Botanica's Guesty stays only.
  const [{ data: cov }, { data: sync }] = await Promise.all([
    db.from('garden_reservations').select('check_out').lt('nights', 30).order('check_out').limit(1),
    db.from('garden_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle(),
  ])
  return { today, from, through: to, rooms, days, coverageFrom: ((cov || []) as any[])[0]?.check_out || null, lastSync: (sync as any)?.last_sync_at || null, partial: !!all.partial }
}

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

// BOTANICA'S UNITS LIVE, the same phases the Botanica report (app/api/public/botanica-report) divides by, so occupancy
// here and there is one number: 32 from May 4, 50 from June 17 2026. Guesty lists 53 Botanica units, but three have
// sold almost nothing (2203 and 2207 never, 2107 once). When a phase is added there, add it here.
const BOTANICA_PHASES: [string, number][] = [['2026-05-04', 32], ['2026-06-17', 50]]
const botanicaUnits = (date: string) => { let u = 0; for (const [from, n] of BOTANICA_PHASES) if (date >= from) u = n; return u }

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
    rooms[scope] = scope === 'botanica' ? botanicaUnits(today) : N.rooms.length
    const by: Record<string, NightlyDay> = {}
    for (let t = lo; t < hi; t += DAY) { const d = iso(t); by[d] = { date: d, dow: DOW[new Date(t).getUTCDay()], inv: scope === 'botanica' ? botanicaUnits(d) : N.rooms.length, rns: 0, rev: 0, cleaning: 0, arr: 0, arrNights: 0, arrLead: 0, arrLeadCnt: 0 } }
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

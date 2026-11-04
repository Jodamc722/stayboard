// GARDEN REVENUE & DISTRIBUTION (Jon, 2026-11-04: "understand rev, distributions"). Three reads:
//
//   on the books    reservations staying in the window: room nights, revenue, ADR, occupancy,
//                   by channel and by stay month — exact once bookings exist in Cloudbeds
//   forward         the next N days from the multi-calendar: units left to sell per date (→ the
//                   occupancy Cloudbeds itself implies), the rate on the shelf, closed dates — works
//                   with zero bookings, which is where the hotel is today
//   distribution    the 27 channels Cloudbeds sells through, and how bookings split across them:
//                   share, revenue, ADR, lead time, length of stay, cancellations
// Plus today's numbers straight from Cloudbeds' dashboard, and money collected (garden_payments).
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { cbGet, cloudbedsConfigured } from './cloudbeds'

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s + 'T12:00:00Z') + n * 86400000))
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const num = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v))

/** The booking channel, in a few names a person recognises. */
export function channelName(src: string | null | undefined): string {
  const s = String(src || '').toLowerCase()
  if (!s) return 'Direct'
  if (/airbnb/.test(s)) return 'Airbnb'
  if (/booking\.?com|booking/.test(s)) return 'Booking.com'
  if (/expedia|hotels\.com|orbitz|travelocity|hotwire/.test(s)) return 'Expedia group'
  if (/vrbo|homeaway/.test(s)) return 'Vrbo'
  if (/google/.test(s)) return 'Google'
  if (/agoda/.test(s)) return 'Agoda'
  if (/hostel/.test(s)) return 'Hostelworld'
  if (/walk|front ?desk|phone|email/.test(s)) return 'Walk-in / phone'
  if (/website|booking engine|direct|own/.test(s)) return 'Website / direct'
  return src as string
}

export async function gardenRevenue(opts: { from?: string; to?: string; ahead?: number } = {}) {
  const db = supabaseAdmin()
  const t0 = todayET()
  const from = opts.from || addDays(t0, -29), to = opts.to || addDays(t0, 60)
  const ahead = Math.min(120, Math.max(7, opts.ahead || 60))
  const fEnd = addDays(t0, ahead - 1)

  const [{ data: res }, { data: cal }, { data: chans }, { data: pays }, roomsQ] = await Promise.all([
    db.from('garden_reservations').select('id,status,check_in,check_out,nights,total,balance,source,room_ids,booked_at').lte('check_in', to).gte('check_out', from).limit(5000),
    db.from('garden_calendar').select('room_type_id,room_type,date,available,total,rate,min_stay,closed').gte('date', t0).lte('date', fEnd).limit(30000),
    db.from('garden_channels').select('id,name,kind,status').order('name'),
    db.from('garden_payments').select('kind,amount,paid_at').gte('paid_at', new Date(Date.now() - 30 * 86400000).toISOString()),
    db.from('garden_rooms').select('id,room_type_id,virtual:raw->isVirtual'),
  ])
  // Sellable rooms per type: the physical (non-virtual) rooms Cloudbeds lists under it. The
  // calendar carries what is left per night, not the type's size, so the size comes from here.
  const RM = ((roomsQ.data || []) as any[]).filter(r => r.virtual !== true && r.virtual !== 'true')
  const rooms = RM.length
  const unitsOf: Record<string, number> = {}
  for (const r of RM) unitsOf[String(r.room_type_id)] = (unitsOf[String(r.room_type_id)] || 0) + 1

  // ── On the books ────────────────────────────────────────────────────────────────────────────
  const R = ((res || []) as any[])
  const live = R.filter(r => r.status !== 'canceled' && r.status !== 'no_show')
  const cancelled = R.filter(r => r.status === 'canceled' || r.status === 'no_show')
  const lo = Date.parse(from + 'T00:00:00Z'), hi = Date.parse(to + 'T00:00:00Z') + 86400000
  type Ch = { channel: string; bookings: number; nights: number; revenue: number; leadSum: number; leadN: number; losSum: number; cancelled: number }
  const ch: Record<string, Ch> = {}
  const month: Record<string, { nights: number; revenue: number }> = {}
  let nights = 0, revenue = 0
  for (const r of live) {
    const units = Math.max(1, (r.room_ids || []).length)
    const stayN = Math.max(1, num(r.nights) || Math.round((Date.parse(r.check_out) - Date.parse(r.check_in)) / 86400000))
    const perNight = num(r.total) / (stayN * units)
    const c = ch[channelName(r.source)] = ch[channelName(r.source)] || { channel: channelName(r.source), bookings: 0, nights: 0, revenue: 0, leadSum: 0, leadN: 0, losSum: 0, cancelled: 0 }
    c.bookings++; c.losSum += stayN
    if (r.booked_at) { const lead = Math.round((Date.parse(r.check_in) - Date.parse(String(r.booked_at).slice(0, 10))) / 86400000); if (lead >= 0) { c.leadSum += lead; c.leadN++ } }
    // Nights and revenue counted only inside the window, night by night (a stay crossing the edge is split).
    for (let d = Date.parse(r.check_in + 'T00:00:00Z'); d < Date.parse(r.check_out + 'T00:00:00Z'); d += 86400000) {
      if (d < lo || d >= hi) continue
      const m = new Date(d).toISOString().slice(0, 7)
      const mm = month[m] = month[m] || { nights: 0, revenue: 0 }
      mm.nights += units; mm.revenue += perNight * units
      c.nights += units; c.revenue += perNight * units
      nights += units; revenue += perNight * units
    }
  }
  for (const r of cancelled) { const k = channelName(r.source); (ch[k] = ch[k] || { channel: k, bookings: 0, nights: 0, revenue: 0, leadSum: 0, leadN: 0, losSum: 0, cancelled: 0 }).cancelled++ }
  const windowDays = Math.round((hi - lo) / 86400000)
  const byChannel = Object.values(ch).sort((a, b) => b.revenue - a.revenue).map(c => ({
    channel: c.channel, bookings: c.bookings, nights: c.nights, revenue: Math.round(c.revenue),
    share: revenue ? Math.round((c.revenue / revenue) * 100) : 0, adr: c.nights ? Math.round(c.revenue / c.nights) : null,
    lead: c.leadN ? Math.round(c.leadSum / c.leadN) : null, los: c.bookings ? Math.round((c.losSum / c.bookings) * 10) / 10 : null,
    cancelRate: c.bookings + c.cancelled ? Math.round((c.cancelled / (c.bookings + c.cancelled)) * 100) : 0,
  }))
  const pickup7 = live.filter(r => r.booked_at && Date.now() - Date.parse(r.booked_at) < 7 * 86400000)

  // ── Forward, from the multi-calendar ────────────────────────────────────────────────────────
  const C = ((cal || []) as any[])
  const byDate: Record<string, { units: number; left: number; rateW: number; rateUnits: number; closed: number; types: number }> = {}
  const byType: Record<string, { id: string; name: string; units: number; rates: number[]; closed: number; minStay: number[] }> = {}
  for (const c of C) {
    const units = num(c.total) || unitsOf[String(c.room_type_id)] || 0, left = num(c.available)
    const d = byDate[c.date] = byDate[c.date] || { units: 0, left: 0, rateW: 0, rateUnits: 0, closed: 0, types: 0 }
    d.units += units; d.left += Math.min(left, units || left); d.types++
    if (c.closed) d.closed++
    if (c.rate != null && units) { d.rateW += num(c.rate) * units; d.rateUnits += units }
    const t = byType[c.room_type_id] = byType[c.room_type_id] || { id: c.room_type_id, name: c.room_type || c.room_type_id, units, rates: [], closed: 0, minStay: [] }
    t.units = Math.max(t.units, units)
    if (c.rate != null) t.rates.push(num(c.rate))
    if (c.closed) t.closed++
    if (c.min_stay) t.minStay.push(num(c.min_stay))
  }
  const forward = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({
    date, units: d.units, left: d.left, sold: Math.max(0, d.units - d.left),
    occupancy: d.units ? Math.round(((d.units - d.left) / d.units) * 100) : null,
    rate: d.rateUnits ? Math.round(d.rateW / d.rateUnits) : null, closedTypes: d.closed,
  }))
  const types = Object.values(byType).map(t => {
    const r = t.rates.slice().sort((a, b) => a - b)
    return { id: t.id, name: t.name, units: t.units, rateLow: r.length ? Math.round(r[0]) : null, rateHigh: r.length ? Math.round(r[r.length - 1]) : null, rateAvg: r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null, closedDays: t.closed, minStay: t.minStay.length ? Math.max(...t.minStay) : null }
  }).sort((a, b) => b.units - a.units || String(a.name).localeCompare(String(b.name)))

  // ── Distribution: channels Cloudbeds sells through, joined to what they booked ─────────────
  const booked = new Map(byChannel.map(c => [c.channel, c]))
  const channels = ((chans || []) as any[]).map(c => ({ id: c.id, name: c.name, group: channelName(c.name), kind: c.kind, on: c.status !== 'off', bookings: booked.get(channelName(c.name))?.bookings || 0 }))

  // ── Money collected, last 30 days ──────────────────────────────────────────────────────────
  const P = ((pays || []) as any[])
  const collected = { charges: Math.round(P.filter(p => p.kind === 'charge' || p.kind === 'deposit').reduce((a, p) => a + num(p.amount), 0)), refunds: Math.round(P.filter(p => p.kind === 'refund').reduce((a, p) => a + num(p.amount), 0)), count: P.length }

  // ── Cloudbeds' own today (live) ─────────────────────────────────────────────────────────────
  let today: any = null
  if (cloudbedsConfigured()) {
    try { const { data } = await cbGet<any>('getDashboard'); const d = Array.isArray(data) ? data[0] : data; today = d ? { occupied: num(d.roomsOccupied), occupancy: num(d.percentageOccupied), arrivals: num(d.arrivals), departures: num(d.departures), inHouse: num(d.inHouse), guests: num(d.guestsInHouse), bookings: num(d.bookings), cancellations: num(d.cancellations), blocked: num(d.roomsBlocked), capacity: num(d.capacity) } : null } catch { today = null }
  }

  const fwdUnits = forward.reduce((a, d) => a + d.units, 0), fwdSold = forward.reduce((a, d) => a + d.sold, 0)
  return {
    from, to, ahead, rooms, today, collected,
    books: { bookings: live.length, cancelled: cancelled.length, nights, revenue: Math.round(revenue), adr: nights ? Math.round(revenue / nights) : null, occupancy: rooms ? Math.round((nights / (rooms * windowDays)) * 100) : null, revpar: rooms ? Math.round(revenue / (rooms * windowDays)) : null, pickup7: { bookings: pickup7.length, revenue: Math.round(pickup7.reduce((a, r) => a + num(r.total), 0)) } },
    byChannel, byMonth: Object.entries(month).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({ month: m, nights: v.nights, revenue: Math.round(v.revenue), adr: v.nights ? Math.round(v.revenue / v.nights) : null })),
    forward, forwardSummary: { occupancy: fwdUnits ? Math.round((fwdSold / fwdUnits) * 100) : null, rate: forward.length ? Math.round(forward.filter(d => d.rate).reduce((a, d) => a + (d.rate || 0), 0) / Math.max(1, forward.filter(d => d.rate).length)) : null },
    types, channels,
  }
}

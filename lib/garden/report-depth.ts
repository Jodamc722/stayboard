// THE IN-DEPTH REPORT (Jon, 2026-11-23: "create an in-depth report … separate Botanica units vs Garden
// and whole data"). One period, three columns — Whole property, Garden, Botanica — and then the chosen
// scope broken down every way the data allows: by month, by day of the week, by wing, by room type, by
// room, by channel, by length of stay, by how far ahead it was booked, cancellations and balances owed.
// Everything is counted night by night per room from lib/garden/segments (a stay crossing the edge of
// the period, or sitting in rooms on both sides, is split), so the three columns always add up.
import 'server-only'
import { loadStays, narrow, leadDays, filterActive, type Scope, type SegRoom, type SegStay, type StayFilter, SEGMENT_LABEL } from './segments'
import { channelName } from './revenue'

const DAY = 86400000
const r0 = (n: number) => Math.round(n)
const r1 = (n: number) => Math.round(n * 10) / 10
const ms = (ymd: string) => Date.parse(ymd + 'T00:00:00Z')
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const isLive = (s: SegStay) => s.status !== 'canceled' && s.status !== 'no_show'

type Agg = { nights: number; revenue: number; stays: number }
const agg = (): Agg => ({ nights: 0, revenue: 0, stays: 0 })
const line = (a: Agg, rooms: number, days: number) => ({ nights: a.nights, revenue: r0(a.revenue), stays: a.stays, adr: a.nights ? r0(a.revenue / a.nights) : null, occupancy: rooms && days ? r1((a.nights / (rooms * days)) * 100) : null, revpar: rooms && days ? r0(a.revenue / (rooms * days)) : null })

function summary(all: { rooms: SegRoom[]; stays: SegStay[] }, scope: Scope, from: string, to: string, f: StayFilter | null) {
  const N = narrow(all, scope, f, channelName)
  const lo = ms(from), hi = ms(to) + DAY, days = Math.round((hi - lo) / DAY)
  const R = N.rooms
  const a = agg(); let cancelled = 0, lost = 0, owed = 0, owedN = 0, arrivals = 0
  for (const x of N.stays) {
    if (!isLive(x)) { if (x.checkIn <= to && x.checkOut > from) { cancelled++; lost += x.total } continue }
    const n = Math.max(0, Math.round((Math.min(hi, ms(x.checkOut)) - Math.max(lo, ms(x.checkIn))) / DAY))
    if (n <= 0) continue
    a.stays++; a.nights += n * x.parts.length; a.revenue += (x.total / x.nights) * n
    if (x.checkIn >= from && x.checkIn <= to) arrivals++
    if ((x.balance || 0) > 0) { owed += x.balance || 0; owedN++ }
  }
  return { scope, label: SEGMENT_LABEL[scope], rooms: R.length, blocked: R.filter(r => r.blocked).length, days, ...line(a, R.length, days), arrivals, cancelled, cancelRate: a.stays + cancelled ? r0((cancelled / (a.stays + cancelled)) * 100) : 0, lostRevenue: r0(lost), owed: r0(owed), owedStays: owedN, avgStay: a.stays ? r1(a.nights / a.stays) : null }
}

export async function gardenDepth(from: string, to: string, scope: Scope = 'all', filter?: StayFilter | null) {
  const f = filterActive(filter) ? filter! : null
  const all = await loadStays(from, to)
  const { rooms } = all
  const N = narrow(all, scope, f, channelName)
  const lo = ms(from), hi = ms(to) + DAY, days = Math.round((hi - lo) / DAY)
  const R = N.rooms
  const roomBy: Record<string, SegRoom> = {}; for (const r of rooms) roomBy[r.name] = r
  const S = N.stays
  const live = S.filter(isLive)

  const month: Record<string, Agg> = {}, dow: Agg[] = Array.from({ length: 7 }, agg), dowDays = [0, 0, 0, 0, 0, 0, 0]
  const wing: Record<string, Agg> = {}, type: Record<string, Agg> = {}, room: Record<string, Agg> = {}, chan: Record<string, Agg & { lead: number; leadN: number; cancelled: number }> = {}
  const LOS = ['1 night', '2 nights', '3 nights', '4–6 nights', '7–13 nights', '14–29 nights', '30+ nights'], LEAD = ['Same day', '1–3 days', '4–7 days', '8–14 days', '15–30 days', '31–60 days', '61+ days']
  const los = LOS.map(agg), lead = LEAD.map(agg)
  const bucket = (n: number, edges: number[]) => { let i = 0; while (i < edges.length && n > edges[i]) i++; return i }
  for (let t = lo; t < hi; t += DAY) dowDays[new Date(t).getUTCDay()]++
  const monthDays: Record<string, number> = {}; for (let t = lo; t < hi; t += DAY) { const m = iso(t).slice(0, 7); monthDays[m] = (monthDays[m] || 0) + 1 }

  for (const x of live) {
    const a = Math.max(lo, ms(x.checkIn)), b = Math.min(hi, ms(x.checkOut))
    const n = Math.max(0, Math.round((b - a) / DAY)); if (n <= 0) continue
    const k = channelName(x.source)
    const c = chan[k] = chan[k] || { ...agg(), lead: 0, leadN: 0, cancelled: 0 }
    const inWin = (x.total / x.nights) * n
    c.stays++; c.nights += n * x.parts.length; c.revenue += inWin
    const L = los[bucket(x.nights, [1, 2, 3, 6, 13, 29])]; L.stays++; L.nights += n * x.parts.length; L.revenue += inWin
    if (x.bookedAt) { const d = Math.round((ms(x.checkIn) - ms(String(x.bookedAt).slice(0, 10))) / DAY); if (d >= 0) { c.lead += d; c.leadN++; const B = lead[bucket(d, [0, 3, 7, 14, 30, 60])]; B.stays++; B.nights += n * x.parts.length; B.revenue += inWin } }
    for (const p of x.parts) {
      const perNight = p.total / x.nights, rm = roomBy[p.room]
      const wk = rm?.wing || 'No room yet', tk = rm?.type || 'No room yet', rk = p.room || 'No room yet'
      const W = wing[wk] = wing[wk] || agg(), T = type[tk] = type[tk] || agg(), Rm = room[rk] = room[rk] || agg()
      W.stays++; T.stays++; Rm.stays++
      for (let t = a; t < b; t += DAY) {
        const m = iso(t).slice(0, 7), M = month[m] = month[m] || agg(), D = dow[new Date(t).getUTCDay()]
        M.nights++; M.revenue += perNight; D.nights++; D.revenue += perNight
        W.nights++; W.revenue += perNight; T.nights++; T.revenue += perNight; Rm.nights++; Rm.revenue += perNight
      }
    }
  }
  for (const x of S) if (!isLive(x) && x.checkIn <= to && x.checkOut > from) { const k = channelName(x.source); (chan[k] = chan[k] || { ...agg(), lead: 0, leadN: 0, cancelled: 0 }).cancelled++ }

  const totalRev = live.reduce((s2, x) => { const n = Math.max(0, Math.round((Math.min(hi, ms(x.checkOut)) - Math.max(lo, ms(x.checkIn))) / DAY)); return s2 + (x.total / x.nights) * n }, 0)
  const countBy = (f: (r: SegRoom) => string) => { const o: Record<string, number> = {}; for (const r of R) o[f(r)] = (o[f(r)] || 0) + 1; return o }
  const wingN = countBy(r => r.wing), typeN = countBy(r => r.type)
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const owedList = live.filter(x => (x.balance || 0) > 0 && x.checkOut >= from).sort((a, b) => (b.balance || 0) - (a.balance || 0)).slice(0, 40)
    .map(x => ({ id: x.id, guest: x.guest || 'Guest', rooms: x.rooms, checkIn: x.checkIn, checkOut: x.checkOut, channel: channelName(x.source), total: r0(x.total), balance: r0(x.balance || 0), origin: x.origin }))

  return {
    from, to, days, scope, label: SEGMENT_LABEL[scope],
    split: (['all', 'garden', 'botanica'] as Scope[]).map(sc => summary(all, sc, from, to, f)),
    byMonth: Object.keys(monthDays).sort().map(m => ({ month: m, ...line(month[m] || agg(), R.length, monthDays[m]) })),
    byDow: [1, 2, 3, 4, 5, 6, 0].map(i => ({ day: DOW[i], ...line(dow[i], R.length, dowDays[i]) })),
    byWing: Object.keys(wingN).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(w => ({ wing: w, rooms: wingN[w], segment: R.find(r => r.wing === w)?.segment || 'garden', ...line(wing[w] || agg(), wingN[w], days) })),
    byType: Object.keys(typeN).map(t => ({ type: t, rooms: typeN[t], ...line(type[t] || agg(), typeN[t], days) })).sort((a, b) => b.revenue - a.revenue),
    byRoom: R.map(r => ({ room: r.name, type: r.type, segment: r.segment, blocked: r.blocked, ...line(room[r.name] || agg(), 1, days) })).sort((a, b) => b.revenue - a.revenue || a.room.localeCompare(b.room, undefined, { numeric: true })),
    unassigned: room['No room yet'] ? line(room['No room yet'], 0, days) : null,
    byChannel: Object.entries(chan).map(([channel, c]) => ({ channel, ...line(c, 0, 0), share: totalRev ? r0((c.revenue / totalRev) * 100) : 0, lead: c.leadN ? r0(c.lead / c.leadN) : null, cancelled: c.cancelled, cancelRate: c.stays + c.cancelled ? r0((c.cancelled / (c.stays + c.cancelled)) * 100) : 0 })).sort((a, b) => b.revenue - a.revenue),
    byLos: LOS.map((label, i) => ({ label, ...line(los[i], 0, 0) })), byLead: LEAD.map((label, i) => ({ label, ...line(lead[i], 0, 0) })),
    owed: owedList,
    partial: !!all.partial, filter: f || {},
    // THE CUBE (Jon, 2026-11-23: "multiple ways of viewing data, booking window, LOS, etc"): one line per
    // stay per room with its nights and revenue INSIDE the period, and what it can be grouped by. The page
    // groups it any way asked (components/GardenViews). No guest name on it.
    //   c channel · l nights of the whole stay · d days booked ahead (null unknown) · a arrival · b booked on
    //   s side · w wing · t room type · n nights in the period · r revenue in the period · x 1 = cancelled / no-show
    //   k share of one stay this line is (1 / rooms on the stay), so stays add up to whole numbers
    cube: S.flatMap(x => {
      const a = Math.max(lo, ms(x.checkIn)), b = Math.min(hi, ms(x.checkOut)), n = Math.max(0, Math.round((b - a) / DAY))
      if (n <= 0) return []
      const dead = !isLive(x), d = leadDays(x)
      return x.parts.map(p => { const rm = roomBy[p.room]; return { c: channelName(x.source), l: x.nights, d, a: x.checkIn, b: x.bookedAt ? String(x.bookedAt).slice(0, 10) : null, s: p.segment, w: rm?.wing || 'No room yet', t: rm?.type || 'No room yet', n, r: Math.round((p.total / x.nights) * n * 100) / 100, x: dead ? 1 : 0, k: Math.round((1 / x.parts.length) * 1000) / 1000 } })
    }),
  }
}

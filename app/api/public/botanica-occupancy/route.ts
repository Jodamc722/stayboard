// BOTANICA ROOM-BY-ROOM OCCUPANCY EXPORT — for the hotel's labor-vs-occupancy audit.
//
// Jon, 2026-09-23: hotel ownership is auditing labor against occupancy and carries our rooms as
// "out of order" in Mews, so they cannot see which of them were actually slept in. They asked for
// "a night-by-night record of which rooms were occupied, with check-in and check-out dates, plus the
// list of rooms currently in Airbnb use", for Botanica from the beginning.
//
// Same gate as the Botanica report (share_links row 'botanica-report', or a signed-in Lighthouse
// user) — the people who read that report are the people this is for. NO GUEST PII: room, dates,
// channel and the booking's confirmation code only. The code lets the hotel reconcile a disputed
// night against us without us handing over a name.
//
// The SAME status test and the SAME listing filter as /api/public/botanica-report, so the nightly
// totals here tie to the report to the night. If one changes, change both.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD           (defaults: opening → yesterday)
//     &view=summary|rooms|stays|nights|daily|grid   (default summary = everything as JSON)
//     &format=json|csv                            (csv needs a view other than summary)
//
// Views:
//   rooms   one row per Botanica room: live?, stays + nights in range, in-house today, next arrival
//   stays   one row per reservation touching the range: room, channel, check-in, check-out, nights
//   nights  one row per occupied room-night (the literal night-by-night record)
//   daily   one row per date: rooms live, occupied, arrivals, departures, stayovers, occ %
//   grid    rooms down, dates across, channel code in each occupied cell (the wall-chart view)
//   raw     one row per Guesty reservation (confirmed, plus cancellations that collected money), every money field
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { linkGate } from '@/lib/passcode-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CONFIRMED = ['confirmed', 'checked_in', 'checked_out']
const OPEN_DATE = '2026-05-01'
// Keep in step with /api/public/botanica-report PHASES.
const PHASES: { from: string; units: number }[] = [
  { from: '2026-05-04', units: 32 },
  { from: '2026-06-17', units: 50 },
]
function unitsOn(date: string): number { let u = 0; for (const p of PHASES) { if (date >= p.from) u = p.units } return u }

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function dow(iso: string) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) }
function r2(n: number) { return Math.round(n * 100) / 100 }
function isoOk(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) }
function daysBetween(a: string, b: string) { return Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000) }

/** "Botanica 1109 - King w/ Kitchenette" -> { room: '1109', type: 'King w/ Kitchenette' } */
function roomOf(name: string): { room: string; type: string } {
  const m = name.match(/(\d{3,4}(?:\s*\/\s*\d{3,4})?)/)
  const room = m ? m[1].replace(/\s+/g, '') : name
  const dash = name.indexOf(' - ')
  return { room, type: dash >= 0 ? name.slice(dash + 3).trim() : '' }
}

/** Guesty `source` -> a plain channel name. */
function channelOf(src: string): string {
  const s = src.toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('vrbo') || s.includes('homeaway')) return 'Vrbo'
  if (s.includes('booking')) return 'Booking.com'
  if (s.includes('expedia')) return 'Expedia'
  if (s.includes('hotels.com')) return 'Hotels.com'
  if (s.includes('travelocity')) return 'Travelocity'
  if (s.includes('marriott')) return 'Marriott'
  if (s.includes('blueground')) return 'Blueground'
  if (s.includes('direct') || s.includes('website') || s.includes('manual') || s.includes('owner') || s.includes('homerunner')) return 'Direct'
  return src
}
const CHANNEL_CODE: Record<string, string> = { 'Hotels.com': 'H', Travelocity: 'T', Airbnb: 'A', Vrbo: 'V', 'Booking.com': 'B', Expedia: 'E', Marriott: 'M', Blueground: 'G', Direct: 'D', Unknown: '?' }

function csvCell(v: any): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function toCsv(header: string[], rows: any[][]): string {
  return [header.map(csvCell).join(',')].concat(rows.map(r => r.map(csvCell).join(','))).join('\n')
}

export async function GET(req: NextRequest) {
  const gate = await linkGate('botanica-report', { kinds: ['botanica'] })
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const today = ymd(new Date())
  let from = str(sp.get('from')).trim(); if (!isoOk(from)) from = OPEN_DATE
  let to = str(sp.get('to')).trim(); if (!isoOk(to)) to = addDays(today, -1)
  if (from < OPEN_DATE) from = OPEN_DATE
  if (to < from) { const t = from; from = to < OPEN_DATE ? OPEN_DATE : to; to = t }
  if (daysBetween(from, to) > 800) to = addDays(from, 800)
  const view = str(sp.get('view') || 'summary').toLowerCase()
  const format = str(sp.get('format') || 'json').toLowerCase()

  try {
    const db = supabaseAdmin()
    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building,status,active:raw->>active')
    type Room = { listingId: string; name: string; room: string; type: string; listed: boolean; combo: boolean }
    const rooms: Room[] = []
    for (const l of (listings || []) as any[]) {
      const name = str(l.nickname || l.title)
      if (!/botanica/i.test(str(l.building)) && !/botanica/i.test(name)) continue
      const retired = /inactive|disabled|archived|deleted/i.test(str(l.status)) || str(l.active) === 'false'
      const combo = /\bfull\b/i.test(name) || /\b\d{3,4}\s*\/\s*\d{3,4}\b/.test(name)
      const r = roomOf(name)
      rooms.push({ listingId: String(l.id), name, room: r.room, type: r.type, listed: !retired, combo })
    }
    if (!rooms.length) return NextResponse.json({ ok: false, error: 'No Botanica listings found' }, { status: 500 })
    rooms.sort((a, b) => a.room.localeCompare(b.room, 'en', { numeric: true }) || a.name.localeCompare(b.name))
    const byId: Record<string, Room> = {}
    for (const r of rooms) byId[r.listingId] = r
    const ids = rooms.map(r => r.listingId)

    // Every reservation on these listings that touches [from, today+60] — any status, so the
    // meta can say honestly what was left out (cancelled, inquiries) and why.
    const horizon = addDays(today, 60) > to ? addDays(today, 60) : to
    let resv: any[] = []
    for (let i = 0; i < 20; i++) {
      const { data, error } = await db
        .from('guesty_reservations')
        .select('id,listing_id,check_in,check_out,nights,status,source,confirmation_code,created_at,guests:raw->>guestsCount,integration:raw->integration->>platform,money:raw->money,gc:raw->guestsCount,nog:raw->numberOfGuests,canceledAt:raw->>canceledAt,guest_name,gfirst:raw->guest->>firstName,glast:raw->guest->>lastName')
        .in('listing_id', ids)
        .gt('check_out', from)
        .lte('check_in', horizon)
        .order('check_in', { ascending: true })
        .range(i * 1000, i * 1000 + 999)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      resv = resv.concat(data)
      if (data.length < 1000) break
    }

    const statusCounts: Record<string, number> = {}
    type Stay = { confirmation: string; reservationId: string; listingId: string; room: string; roomName: string; combo: boolean; channel: string; status: string; checkIn: string; checkOut: string; nights: number; nightsInRange: number; guests: number | null; bookedOn: string; accommodation: number; cleaning: number; revenue: number; perNight: number; revenueInRange: number }
    const stays: Stay[] = []
    // The mirror can hold the SAME booking twice under two reservation ids (seen 2026-09-23:
    // 1104 · HMJDFM5BHP · Jul 9-11 twice). One booking, one room, one set of nights — key on
    // listing + confirmation + dates so a duplicate row never becomes a phantom occupied night.
    const seen: Record<string, boolean> = {}
    let duplicatesDropped = 0
    for (const r of resv) {
      const st = str(r.status)
      statusCounts[st || '(blank)'] = (statusCounts[st || '(blank)'] || 0) + 1
      if (CONFIRMED.indexOf(st) < 0) continue
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      if (!ci || !co || co <= ci) continue
      const rm = byId[String(r.listing_id)]
      if (!rm) continue
      const dk = rm.listingId + '|' + (str(r.confirmation_code) || String(r.id)) + '|' + ci + '|' + co
      if (seen[dk]) { duplicatesDropped++; continue }
      seen[dk] = true
      const a = ci > from ? ci : from
      const b = co <= addDays(to, 1) ? co : addDays(to, 1)
      const inRange = b > a ? daysBetween(a, b) : 0
      const src = str(r.source) || str(r.integration)
      // REVENUE — the SAME money as /api/public/botanica-report (the Margaux report): net
      // accommodation (fareAccommodationAdjusted, else fareAccommodation) + cleaning fee, spread
      // evenly across the stay's nights. Botanica's cleaning fee is room revenue by contract.
      const nightsTotal = Math.max(1, num(r.nights) || daysBetween(ci, co))
      const m: any = r.money || {}
      const accommodation = num(m.fareAccommodationAdjusted ?? m.fareAccommodation)
      const cleaning = num(m.fareCleaning)
      const revenue = accommodation + cleaning
      stays.push({
        accommodation: r2(accommodation), cleaning: r2(cleaning), revenue: r2(revenue), perNight: r2(revenue / nightsTotal), revenueInRange: r2((revenue / nightsTotal) * inRange),
        confirmation: str(r.confirmation_code), reservationId: String(r.id), listingId: rm.listingId, room: rm.room, roomName: rm.name, combo: rm.combo,
        channel: channelOf(src), status: st, checkIn: ci, checkOut: co, nights: num(r.nights) || daysBetween(ci, co), nightsInRange: inRange,
        guests: r.guests == null || r.guests === '' ? null : num(r.guests), bookedOn: str(r.created_at).slice(0, 10),
      })
    }
    const staysInRange = stays.filter(s => s.nightsInRange > 0)

    // Night ledger + daily roll-up + grid, all from the same walk.
    const dates: string[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)
    type Night = { date: string; dow: string; room: string; roomName: string; channel: string; confirmation: string; checkIn: string; checkOut: string; night: number; of: number; combo: boolean; revenue: number; accommodation: number; cleaning: number; stayRevenue: number }
    const nights: Night[] = []
    const grid: Record<string, Record<string, string>> = {}
    const occ: Record<string, number> = {}, arr: Record<string, number> = {}, dep: Record<string, number> = {}
    const chanNights: Record<string, number> = {}
    const rev: Record<string, number> = {}
    for (const s of stays) {
      if (s.checkIn >= from && s.checkIn <= to) arr[s.checkIn] = (arr[s.checkIn] || 0) + 1
      if (s.checkOut >= from && s.checkOut <= to) dep[s.checkOut] = (dep[s.checkOut] || 0) + 1
      let k = 0
      for (let d = s.checkIn; d < s.checkOut; d = addDays(d, 1)) {
        k++
        if (d < from || d > to) continue
        nights.push({ date: d, dow: dow(d), room: s.room, roomName: s.roomName, channel: s.channel, confirmation: s.confirmation, checkIn: s.checkIn, checkOut: s.checkOut, night: k, of: s.nights, combo: s.combo, revenue: s.perNight, accommodation: r2(s.accommodation / Math.max(1, s.nights)), cleaning: r2(s.cleaning / Math.max(1, s.nights)), stayRevenue: s.revenue })
        rev[d] = (rev[d] || 0) + s.revenue / Math.max(1, s.nights)
        occ[d] = (occ[d] || 0) + 1
        chanNights[s.channel] = (chanNights[s.channel] || 0) + 1
        const g = grid[s.listingId] || (grid[s.listingId] = {})
        g[d] = g[d] ? g[d] + '+' : (CHANNEL_CODE[s.channel] || '?')
      }
    }
    nights.sort((a, b) => a.date.localeCompare(b.date) || a.room.localeCompare(b.room, 'en', { numeric: true }))
    const daily = dates.map(d => {
      const live = unitsOn(d), o = occ[d] || 0, a = arr[d] || 0, dp = dep[d] || 0
      return { date: d, dow: dow(d), roomsLive: live, occupied: o, vacant: Math.max(0, live - o), arrivals: a, departures: dp, stayovers: Math.max(0, o - a), occPct: live > 0 ? Math.round((o / live) * 1000) / 10 : null, revenue: r2(rev[d] || 0), adr: o > 0 ? r2((rev[d] || 0) / o) : null }
    })

    // Per-room roll-up, plus who is in the room right now and who is next.
    const roomRows = rooms.map(r => {
      const mine = stays.filter(s => s.listingId === r.listingId)
      const inRange = mine.filter(s => s.nightsInRange > 0)
      const nightsIn = inRange.reduce((t, s) => t + s.nightsInRange, 0)
      const inHouse = mine.find(s => s.checkIn <= today && s.checkOut > today)
      const next = mine.filter(s => s.checkIn > today).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]
      const everNights = mine.map(s => s.checkIn).sort()
      return {
        room: r.room, roomName: r.name, roomType: r.type, listingId: r.listingId, listedInGuesty: r.listed, comboListing: r.combo,
        stays: inRange.length, nightsOccupied: nightsIn, revenueInRange: r2(inRange.reduce((t, s) => t + s.revenueInRange, 0)), nightsInRange: dates.length, occPct: dates.length ? Math.round((nightsIn / dates.length) * 1000) / 10 : 0,
        firstArrivalOnRecord: everNights[0] || '', inHouseToday: inHouse ? 'Yes' : 'No', inHouseCheckOut: inHouse ? inHouse.checkOut : '',
        nextArrival: next ? next.checkIn : '',
      }
    })

    const totalNights = nights.length
    const meta = {
      ok: true, property: 'Botanica (The Garden Hotel & Resort)', from, to, days: dates.length, today, generatedAt: new Date().toISOString(),
      roomsInGuesty: rooms.filter(r => r.listed && !r.combo).length,
      occupiedRoomNights: totalNights, revenue: r2(daily.reduce((t, d) => t + d.revenue, 0)), availableRoomNights: daily.reduce((t, d) => t + d.roomsLive, 0),
      staysTouchingRange: staysInRange.length, nightsByChannel: chanNights,
      statusesSeen: statusCounts, countedStatuses: CONFIRMED, duplicatesDropped,
      inventoryPhases: PHASES,
      method: 'A room is occupied on a night when a confirmed, checked-in or checked-out Guesty reservation includes that night (check-in night counts, check-out morning does not). Cancelled, declined, expired and inquiry reservations are excluded. Source: Guesty, the system of record for every channel (Airbnb, Booking.com, Vrbo, Expedia, direct).',
    }

    // RAW RESERVATIONS (Jon, 2026-09-23: "just need a raw reservations report as well").
    // One row per Guesty reservation touching the range, EVERY status (confirmed, cancelled,
    // inquiry, declined...), no occupancy logic, and every scalar money field Guesty sends as its
    // own column (union across rows, so nothing is hidden). A duplicate mirror row is kept and
    // flagged, not dropped — raw means raw. Still no guest names or contact details.
    if (view === 'raw') {
      const moneyKeys: Record<string, boolean> = {}
      const seenRaw: Record<string, boolean> = {}
      // Jon, 2026-09-23: inquiries out, and cancelled/declined/closed stays out unless money was
      // actually collected (a cancellation fee is still revenue, so that row stays).
      const keepRaw = (r: any): boolean => {
        const st = str(r.status)
        if (CONFIRMED.indexOf(st) >= 0) return true
        if (/inquir/i.test(st)) return false
        const mm: any = r.money || {}
        return num(mm.totalPaid) > 0.009
      }
      const rawRows = resv.filter((r: any) => str(r.check_in).slice(0, 10) <= to && keepRaw(r)).map((r: any) => {
        const m: any = r.money && typeof r.money === 'object' ? r.money : {}
        const flat: Record<string, any> = {}
        for (const k of Object.keys(m)) {
          const v = m[k]
          if (v == null || typeof v === 'object') continue
          flat[k] = v; moneyKeys[k] = true
        }
        const rm = byId[String(r.listing_id)]
        const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
        const dk = String(r.listing_id) + '|' + (str(r.confirmation_code) || String(r.id)) + '|' + ci + '|' + co
        const dup = !!seenRaw[dk]; seenRaw[dk] = true
        const nog: any = r.nog && typeof r.nog === 'object' ? r.nog : null
        const guests = r.gc != null && r.gc !== '' ? num(r.gc) : (nog ? num(nog.numberOfAdults) + num(nog.numberOfChildren) : '')
        // Guest name ONLY for a signed-in Lighthouse user (Jon, 2026-09-23). Someone who opened the
        // hotel's share link gets the report without names, exactly as before.
        let first = '', last = ''
        if (gate.signedIn) {
          first = str(r.gfirst).trim(); last = str(r.glast).trim()
          if (!first && !last) { const parts = str(r.guest_name).trim().split(/\s+/); first = parts.shift() || ''; last = parts.join(' ') }
        }
        const bal = num(m.balanceDue), stt = str(r.status)
        const balNote = Math.abs(bal) < 0.01 ? '' : /inquir/i.test(stt) ? 'Inquiry quote, never booked (nothing owed)'
          : /cancel|declin/i.test(stt) ? 'Cancelled, leftover quote (nothing owed)'
          : bal < 0 ? 'Overpaid / refund pending' : (m.isNightlyRateInExternalCollection ? 'Channel collects; payment not recorded in Guesty' : 'Open balance on a confirmed stay')
        return { base: [str(r.id), str(r.confirmation_code), first, last, rm ? rm.room : '', rm ? rm.name : '', channelOf(str(r.source) || str(r.integration)), str(r.source), str(r.integration), str(r.status), ci, co, num(r.nights) || (ci && co ? daysBetween(ci, co) : ''), str(r.created_at).slice(0, 10), str(r.canceledAt).slice(0, 10), guests === 0 ? '' : guests, dup ? 'Yes' : '', balNote], money: flat }
      })
      const PREFERRED = ['currency', 'fareAccommodation', 'fareAccommodationAdjusted', 'fareAccommodationDiscount', 'fareCleaning', 'totalFees', 'subTotalPrice', 'totalTaxes', 'hostServiceFee', 'hostServiceFeeTax', 'hostServiceFeeIncTax', 'hostPayout', 'netIncome', 'commission', 'totalPrice', 'totalPaid', 'balanceDue']
      const keys = PREFERRED.filter(k => moneyKeys[k]).concat(Object.keys(moneyKeys).filter(k => PREFERRED.indexOf(k) < 0).sort())
      const header = ['Reservation id', 'Confirmation', 'Guest first name', 'Guest last name', 'Room', 'Guesty listing', 'Channel', 'Source (Guesty)', 'Platform (Guesty)', 'Status', 'Check-in', 'Check-out', 'Nights', 'Booked on', 'Cancelled on', 'Guests', 'Duplicate mirror row', 'Balance due note'].concat(keys.map(k => 'money.' + k))
      rawRows.sort((a, b) => String(a.base[10]).localeCompare(String(b.base[10])) || String(a.base[4]).localeCompare(String(b.base[4]), 'en', { numeric: true }))
      const rows = rawRows.map(x => x.base.concat(keys.map(k => x.money[k] == null ? '' : x.money[k])))
      if (format === 'csv') {
        const fname = 'botanica-raw-reservations-' + from + '-to-' + to + '.csv'
        return new NextResponse(toCsv(header, rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + fname + '"', 'Cache-Control': 'no-store' } })
      }
      return NextResponse.json({ ...meta, header, rows })
    }

    if (format === 'csv' && view !== 'summary') {
      let csv = ''
      if (view === 'rooms') csv = toCsv(['Room', 'Guesty listing', 'Room type', 'Listed in Guesty', 'Combo listing', 'Stays in range', 'Nights occupied', 'Nights in range', 'Occ %', 'Revenue in range', 'First arrival on record', 'In house today', 'In-house check-out', 'Next arrival'],
        roomRows.map(r => [r.room, r.roomName, r.roomType, r.listedInGuesty ? 'Yes' : 'No', r.comboListing ? 'Yes' : 'No', r.stays, r.nightsOccupied, r.nightsInRange, r.occPct, r.revenueInRange, r.firstArrivalOnRecord, r.inHouseToday, r.inHouseCheckOut, r.nextArrival]))
      else if (view === 'stays') csv = toCsv(['Room', 'Guesty listing', 'Channel', 'Confirmation', 'Status', 'Check-in', 'Check-out', 'Total nights', 'Nights in range', 'Booked on', 'Accommodation', 'Cleaning fee', 'Stay revenue (accom + cleaning)', 'Revenue per night', 'Revenue in range'],
        staysInRange.map(s => [s.room, s.roomName, s.channel, s.confirmation, s.status, s.checkIn, s.checkOut, s.nights, s.nightsInRange, s.bookedOn, s.accommodation, s.cleaning, s.revenue, s.perNight, s.revenueInRange]))
      else if (view === 'nights') csv = toCsv(['Night of', 'Day', 'Room', 'Guesty listing', 'Channel', 'Confirmation', 'Check-in', 'Check-out', 'Night #', 'Of', 'Night revenue', 'Night accommodation', 'Night cleaning', 'Stay revenue'],
        nights.map(n => [n.date, n.dow, n.room, n.roomName, n.channel, n.confirmation, n.checkIn, n.checkOut, n.night, n.of, n.revenue, n.accommodation, n.cleaning, n.stayRevenue]))
      else if (view === 'daily') csv = toCsv(['Date', 'Day', 'Rooms live', 'Occupied', 'Vacant', 'Arrivals', 'Departures', 'Stayovers', 'Occ %', 'Revenue', 'ADR'],
        daily.map(d => [d.date, d.dow, d.roomsLive, d.occupied, d.vacant, d.arrivals, d.departures, d.stayovers, d.occPct == null ? '' : d.occPct, d.revenue, d.adr == null ? '' : d.adr]))
      else if (view === 'grid') csv = toCsv(['Room', 'Guesty listing', 'Nights'].concat(dates),
        roomRows.map(r => [r.room, r.roomName, r.nightsOccupied].concat(dates.map(d => (grid[r.listingId] || {})[d] || ''))))
      else return NextResponse.json({ ok: false, error: 'Unknown view' }, { status: 400 })
      const fname = 'botanica-' + view + '-' + from + '-to-' + to + '.csv'
      return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + fname + '"', 'Cache-Control': 'no-store' } })
    }

    if (view === 'rooms') return NextResponse.json({ ...meta, rooms: roomRows })
    if (view === 'stays') return NextResponse.json({ ...meta, stays: staysInRange })
    if (view === 'nights') return NextResponse.json({ ...meta, nights })
    if (view === 'daily') return NextResponse.json({ ...meta, daily })
    if (view === 'grid') return NextResponse.json({ ...meta, dates, grid: roomRows.map(r => ({ room: r.room, cells: dates.map(d => (grid[r.listingId] || {})[d] || '') })) })
    return NextResponse.json({ ...meta, rooms: roomRows, stays: staysInRange, daily, nights })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

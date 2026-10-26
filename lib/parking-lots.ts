// PARKING LOTS WE RUN OURSELVES (Jon, 2026-10-26) — the engine behind the Parking tab (/lots), the
// staff link (/lot/<code>) and the tow cron.
//
// Jon's brief, in his words: "we have 10 spots, it's $30 per day, and we need to be able to track
// make and model and the parking spot they reserved, so we can enforce and tow … calendar view …
// 3 extra for space and for our staff, never sell … a link we can share with our staff to check /
// scan car plates and flag unregistered cars … once each car is scanned, all non-cars get flagged
// and it creates a guest message we can send to all guests, they get 1 hour or the car will be
// towed. It then drafts a message via email to our tow company."
//
// WHAT THIS FILE KNOWS
//   · A lot is a building's spots and its price. A booking is one car in one spot for a run of
//     nights; the PLATE is what everything matches on (lib/plate normalises it).
//   · Held spots are never sold: a guest booking on one is refused here, not merely discouraged in
//     the form. Staff cars live on them as staff bookings, so the sweep knows them too.
//   · The sweep is saved check by check. Finishing it turns every car that should not be there into
//     an INCIDENT, and the incident carries the chain: notice to every in-house guest → the hour →
//     the tow email drafted in the notice mailbox (a person presses send) → towed.
//   · Guesty is written once, best-effort: a parking line on the reservation's notes, so the team
//     sees the spot in Guesty too. A Guesty outage never fails a booking.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildingOf, KNOWN_BUILDINGS } from './segments'
import { isLiveStay } from './stay-status'
import { normalizePlate, tidyPlate, platesClose, carLabel, nightsBetween, rangesOverlap, isYmd, cents, addDays } from './plate'

const TZ = 'America/New_York'
export const ymdET = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const clean = (v: any, max = 200) => str(v).replace(/\s+/g, ' ').trim().slice(0, max) || null
const timeET = (iso: string | Date) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const dayET = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const stampET = (iso: string | Date) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// ── Types ───────────────────────────────────────────────────────────────────────────────────────
export type Lot = {
  id: string; building: string; name: string; rateCents: number; currency: string
  address: string | null; towCompany: string | null; towEmail: string | null; towPhone: string | null
  rules: string | null; noticeMinutes: number; shareCode: string; hasPasscode: boolean; active: boolean
}
export type Spot = { id: string; lotId: string; label: string; kind: 'sell' | 'hold'; sort: number; active: boolean; note: string | null }
export type BookingKind = 'guest' | 'staff' | 'owner' | 'vendor' | 'block'
export type BookingStatus = 'reserved' | 'parked' | 'left' | 'cancelled' | 'no_show'
export type Paid = 'unpaid' | 'paid' | 'comped' | 'na'
export type Booking = {
  id: string; lotId: string; spotId: string; kind: BookingKind
  reservationId: string | null; listingId: string | null; unit: string | null; guestName: string | null; guestPhone: string | null
  startsOn: string; endsOn: string; nights: number
  plate: string | null; plateNorm: string | null; plateState: string | null; make: string | null; model: string | null; color: string | null
  rateCents: number; amountCents: number; paid: Paid; paidVia: string | null; paidAt: string | null; paidBy: string | null
  status: BookingStatus; notes: string | null; createdBy: string | null; createdAt: string; updatedAt: string
}
export type IncidentKind = 'unregistered' | 'wrong_spot' | 'staff_in_sell' | 'blocking' | 'other'
export type IncidentStatus = 'open' | 'notified' | 'tow_drafted' | 'towed' | 'resolved' | 'dismissed'
export type Incident = {
  id: string; lotId: string; spotId: string | null; spotLabel: string | null; sweepId: string | null; kind: IncidentKind; bookingId: string | null
  plate: string | null; plateNorm: string | null; plateState: string | null; make: string | null; model: string | null; color: string | null
  photoPath: string | null; photoUrl?: string | null
  seenAt: string; seenBy: string | null; status: IncidentStatus
  noticeText: string | null; noticeSentAt: string | null; noticeSentN: number; noticeSentBy: string | null; noticeLog: any[]
  towDueAt: string | null; towDraftId: string | null; towDraftedAt: string | null; towDraftError: string | null; towTo: string | null
  towedAt: string | null; towedBy: string | null; resolvedAt: string | null; resolvedBy: string | null; resolution: string | null
  notes: string | null; createdAt: string
}
export type SweepCheck = {
  spotId: string | null; label: string | null
  result: 'match' | 'empty' | 'other' | 'extra'      // extra = a car outside any marked spot
  plate: string | null; plateNorm: string | null; make: string | null; model: string | null; color: string | null
  verdict: 'ok' | 'empty' | 'wrong_spot' | 'unregistered' | 'staff_in_sell' | 'leaving_today'
  bookingId: string | null; belongsIn: string | null; photoPath: string | null; at: string
}
export type Sweep = { id: string; lotId: string; sweepDate: string; startedAt: string; finishedAt: string | null; byName: string | null; checks: SweepCheck[]; nChecked: number; nMatched: number; nEmpty: number; nFlagged: number }

// ── Row mappers ─────────────────────────────────────────────────────────────────────────────────
const lotOf = (r: any): Lot => ({
  id: str(r.id), building: str(r.building), name: str(r.name), rateCents: num(r.rate_cents), currency: str(r.currency || 'USD'),
  address: r.address ?? null, towCompany: r.tow_company ?? null, towEmail: r.tow_email ?? null, towPhone: r.tow_phone ?? null,
  rules: r.rules ?? null, noticeMinutes: num(r.notice_minutes, 60) || 60, shareCode: str(r.share_code), hasPasscode: !!str(r.share_passcode), active: r.active !== false,
})
const spotOf = (r: any): Spot => ({ id: str(r.id), lotId: str(r.lot_id), label: str(r.label), kind: r.kind === 'hold' ? 'hold' : 'sell', sort: num(r.sort), active: r.active !== false, note: r.note ?? null })
const bookingOf = (r: any): Booking => ({
  id: str(r.id), lotId: str(r.lot_id), spotId: str(r.spot_id), kind: (r.kind || 'guest') as BookingKind,
  reservationId: r.reservation_id ?? null, listingId: r.listing_id ?? null, unit: r.unit ?? null, guestName: r.guest_name ?? null, guestPhone: r.guest_phone ?? null,
  startsOn: str(r.starts_on).slice(0, 10), endsOn: str(r.ends_on).slice(0, 10), nights: nightsBetween(str(r.starts_on).slice(0, 10), str(r.ends_on).slice(0, 10)),
  plate: r.plate ?? null, plateNorm: r.plate_norm ?? null, plateState: r.plate_state ?? null, make: r.make ?? null, model: r.model ?? null, color: r.color ?? null,
  rateCents: num(r.rate_cents), amountCents: num(r.amount_cents), paid: (r.paid || 'unpaid') as Paid, paidVia: r.paid_via ?? null, paidAt: r.paid_at ?? null, paidBy: r.paid_by ?? null,
  status: (r.status || 'reserved') as BookingStatus, notes: r.notes ?? null, createdBy: r.created_by ?? null, createdAt: str(r.created_at), updatedAt: str(r.updated_at),
})
const incidentOf = (r: any): Incident => ({
  id: str(r.id), lotId: str(r.lot_id), spotId: r.spot_id ?? null, spotLabel: r.spot_label ?? null, sweepId: r.sweep_id ?? null, kind: (r.kind || 'unregistered') as IncidentKind, bookingId: r.booking_id ?? null,
  plate: r.plate ?? null, plateNorm: r.plate_norm ?? null, plateState: r.plate_state ?? null, make: r.make ?? null, model: r.model ?? null, color: r.color ?? null,
  photoPath: r.photo_path ?? null, seenAt: str(r.seen_at), seenBy: r.seen_by ?? null, status: (r.status || 'open') as IncidentStatus,
  noticeText: r.notice_text ?? null, noticeSentAt: r.notice_sent_at ?? null, noticeSentN: num(r.notice_sent_n), noticeSentBy: r.notice_sent_by ?? null, noticeLog: Array.isArray(r.notice_log) ? r.notice_log : [],
  towDueAt: r.tow_due_at ?? null, towDraftId: r.tow_draft_id ?? null, towDraftedAt: r.tow_drafted_at ?? null, towDraftError: r.tow_draft_error ?? null, towTo: r.tow_to ?? null,
  towedAt: r.towed_at ?? null, towedBy: r.towed_by ?? null, resolvedAt: r.resolved_at ?? null, resolvedBy: r.resolved_by ?? null, resolution: r.resolution ?? null,
  notes: r.notes ?? null, createdAt: str(r.created_at),
})
const sweepOf = (r: any): Sweep => ({
  id: str(r.id), lotId: str(r.lot_id), sweepDate: str(r.sweep_date).slice(0, 10), startedAt: str(r.started_at), finishedAt: r.finished_at ?? null, byName: r.by_name ?? null,
  checks: Array.isArray(r.checks) ? r.checks : [], nChecked: num(r.n_checked), nMatched: num(r.n_matched), nEmpty: num(r.n_empty), nFlagged: num(r.n_flagged),
})

export const PHOTO_BUCKET = 'parking-photos'
const LIVE_BOOKING = ['reserved', 'parked']
const OPEN_INCIDENT = ['open', 'notified', 'tow_drafted']

// ── Lots & spots ────────────────────────────────────────────────────────────────────────────────
export async function listLots(): Promise<Lot[]> {
  const { data } = await supabaseAdmin().from('parking_lots').select('*').eq('active', true).order('name')
  return (data || []).map(lotOf)
}
export async function lotById(id: string): Promise<Lot | null> {
  if (!id) return null
  const { data } = await supabaseAdmin().from('parking_lots').select('*').eq('id', id).maybeSingle()
  return data ? lotOf(data) : null
}
/** The staff link resolves here. Inactive lots do not answer. */
export async function lotByCode(code: string): Promise<(Lot & { passcode: string | null }) | null> {
  const c = str(code).trim()
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(c)) return null
  const { data } = await supabaseAdmin().from('parking_lots').select('*').eq('share_code', c).eq('active', true).maybeSingle()
  return data ? { ...lotOf(data), passcode: str((data as any).share_passcode) || null } : null
}
export async function spotsFor(lotId: string, includeInactive = false): Promise<Spot[]> {
  let q = supabaseAdmin().from('parking_spots').select('*').eq('lot_id', lotId).order('sort').order('label')
  if (!includeInactive) q = q.eq('active', true)
  const { data } = await q
  return (data || []).map(spotOf)
}

const newCode = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 14; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

/** The buildings a new lot can be made for — every known building that has no active lot yet. */
export async function buildingsWithoutLot(): Promise<string[]> {
  const lots = await listLots()
  const taken = lots.map(l => l.building.toLowerCase())
  return KNOWN_BUILDINGS.map(b => b.label).filter(b => taken.indexOf(b.toLowerCase()) < 0)
}

export async function createLot(inp: { building: string; name?: string; sell: number; hold: number; rateCents: number; by: string }): Promise<{ ok: true; lot: Lot } | { ok: false; error: string }> {
  const building = buildingOf(inp.building, inp.building) || clean(inp.building, 60)
  if (!building) return { ok: false, error: 'Which building?' }
  const sell = Math.max(0, Math.min(200, Math.floor(num(inp.sell))))
  const hold = Math.max(0, Math.min(50, Math.floor(num(inp.hold))))
  if (sell + hold === 0) return { ok: false, error: 'A lot needs at least one spot.' }
  const db = supabaseAdmin()
  const { data: dup } = await db.from('parking_lots').select('id').eq('active', true).ilike('building', building).maybeSingle()
  if (dup) return { ok: false, error: `${building} already has a lot.` }
  const { data, error } = await db.from('parking_lots').insert({
    building, name: clean(inp.name, 80) || `${building} parking`, rate_cents: Math.max(0, Math.round(num(inp.rateCents, 3000))),
    share_code: newCode(), created_by: inp.by,
    rules: `Parking is ${cents(Math.max(0, Math.round(num(inp.rateCents, 3000))))} per night, one space per reservation, in the spot you were given. Unregistered vehicles are towed at the owner's expense.`,
  }).select('*').single()
  if (error || !data) return { ok: false, error: error?.message || 'Could not create the lot.' }
  const rows: any[] = []
  for (let i = 1; i <= sell; i++) rows.push({ lot_id: data.id, label: String(i), kind: 'sell', sort: i })
  for (let i = 1; i <= hold; i++) rows.push({ lot_id: data.id, label: 'S' + i, kind: 'hold', sort: 100 + i, note: 'Staff & buffer — never sold' })
  if (rows.length) await db.from('parking_spots').insert(rows)
  return { ok: true, lot: lotOf(data) }
}

export async function updateLot(id: string, patch: Record<string, any>, _by: string): Promise<{ ok: boolean; error?: string; lot?: Lot }> {
  const up: Record<string, any> = { updated_at: new Date().toISOString() }
  if ('name' in patch) up.name = clean(patch.name, 80) || undefined
  if ('rateCents' in patch) up.rate_cents = Math.max(0, Math.round(num(patch.rateCents)))
  if ('address' in patch) up.address = clean(patch.address, 300)
  if ('towCompany' in patch) up.tow_company = clean(patch.towCompany, 120)
  if ('towEmail' in patch) { const e = clean(patch.towEmail, 200); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: 'That tow email does not look right.' }; up.tow_email = e }
  if ('towPhone' in patch) up.tow_phone = clean(patch.towPhone, 40)
  if ('rules' in patch) up.rules = clean(patch.rules, 1000)
  if ('noticeMinutes' in patch) up.notice_minutes = Math.max(5, Math.min(24 * 60, Math.round(num(patch.noticeMinutes, 60)) || 60))
  if ('sharePasscode' in patch) up.share_passcode = clean(patch.sharePasscode, 40)
  if (patch.regenerateCode === true) up.share_code = newCode()
  if ('active' in patch) up.active = !!patch.active
  const { data, error } = await supabaseAdmin().from('parking_lots').update(up).eq('id', id).select('*').single()
  if (error || !data) return { ok: false, error: error?.message || 'Could not save the lot.' }
  return { ok: true, lot: lotOf(data) }
}

export async function updateSpot(id: string, patch: Record<string, any>): Promise<{ ok: boolean; error?: string; spot?: Spot }> {
  const up: Record<string, any> = {}
  if ('label' in patch) { const l = clean(patch.label, 12); if (!l) return { ok: false, error: 'A spot needs a label.' }; up.label = l }
  if ('kind' in patch) up.kind = patch.kind === 'hold' ? 'hold' : 'sell'
  if ('note' in patch) up.note = clean(patch.note, 120)
  if ('active' in patch) up.active = !!patch.active
  if ('sort' in patch) up.sort = Math.round(num(patch.sort))
  const { data, error } = await supabaseAdmin().from('parking_spots').update(up).eq('id', id).select('*').single()
  if (error || !data) return { ok: false, error: error?.message || 'Could not save the spot.' }
  return { ok: true, spot: spotOf(data) }
}
export async function addSpot(lotId: string, kind: 'sell' | 'hold', label?: string): Promise<{ ok: boolean; error?: string; spot?: Spot }> {
  const spots = await spotsFor(lotId, true)
  const same = spots.filter(s => s.kind === kind)
  const nextSort = same.length ? Math.max.apply(null, same.map(s => s.sort)) + 1 : (kind === 'hold' ? 101 : 1)
  const lbl = clean(label, 12) || (kind === 'hold' ? 'S' + (same.length + 1) : String(same.length + 1))
  const { data, error } = await supabaseAdmin().from('parking_spots').insert({ lot_id: lotId, label: lbl, kind, sort: nextSort, note: kind === 'hold' ? 'Staff & buffer — never sold' : null }).select('*').single()
  if (error || !data) return { ok: false, error: error?.message || 'Could not add the spot.' }
  return { ok: true, spot: spotOf(data) }
}

// ── The building's stays (Guesty mirror) ────────────────────────────────────────────────────────
export type Stay = {
  id: string; guest: string; phone: string | null; email: string | null; unit: string; listingId: string
  checkIn: string; checkOut: string; nights: number; status: string; source: string; conversationId: string | null; confirmationCode: string | null
}
async function listingsOfBuilding(building: string): Promise<Record<string, string>> {
  // id -> unit label. Canonicalised through lib/segments so "Eden 1203" and "EDEN-1203" both count.
  const { data } = await supabaseAdmin().from('guesty_listings').select('id, nickname, title, building').limit(3000)
  const out: Record<string, string> = {}
  const want = building.toLowerCase()
  for (const l of (data || []) as any[]) {
    const b = buildingOf(l.building, l.nickname || l.title)
    if (b && b.toLowerCase() === want) out[str(l.id)] = str(l.nickname || l.title || l.id)
  }
  return out
}
const stayOf = (r: any, units: Record<string, string>): Stay => ({
  id: str(r.id), guest: str(r.guest_name || 'Guest'), phone: r.guest_phone ?? null, email: r.guest_email ?? null,
  unit: units[str(r.listing_id)] || str(r.listing_name), listingId: str(r.listing_id),
  checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), nights: num(r.nights) || nightsBetween(str(r.check_in).slice(0, 10), str(r.check_out).slice(0, 10)),
  status: str(r.status), source: str(r.source), conversationId: r.conversation_id ?? null, confirmationCode: r.confirmation_code ?? null,
})

/** Stays at the lot's building that touch [from, to]: who could want a spot, or who is in house. */
export async function staysForBuilding(building: string, from: string, to: string, q = ''): Promise<Stay[]> {
  const units = await listingsOfBuilding(building)
  const ids = Object.keys(units)
  if (!ids.length) return []
  const db = supabaseAdmin()
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from('guesty_reservations')
      .select('id, listing_id, listing_name, guest_name, guest_email, guest_phone, check_in, check_out, nights, status, source, confirmation_code, conversation_id')
      .in('listing_id', ids.slice(i, i + 150)).lte('check_in', to).gte('check_out', from).limit(2000)
    for (const r of data || []) out.push(r)
  }
  const needle = str(q).trim().toLowerCase()
  const stays = out.filter(r => isLiveStay(r.status)).map(r => stayOf(r, units))
    .filter(s => !needle || [s.guest, s.unit, s.confirmationCode || '', s.phone || ''].join(' ').toLowerCase().indexOf(needle) >= 0)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
  // THE BOOKING ROW OFTEN HAS NO conversation_id (first live run: 21 in house, 0 threads). The
  // conversation mirror links back by reservation_id — the same fallback lib/reservation-360 uses.
  const missing = stays.filter(s => !s.conversationId).map(s => s.id)
  for (let i = 0; i < missing.length; i += 150) {
    const { data: cs } = await db.from('guesty_conversations').select('id, reservation_id, last_message_at').in('reservation_id', missing.slice(i, i + 150)).order('last_message_at', { ascending: false })
    for (const c of (cs || []) as any[]) {
      const s = stays.find(x => x.id === str(c.reservation_id))
      if (s && !s.conversationId) s.conversationId = str(c.id)
    }
  }
  return stays
}

/** Everyone who could own a car in the lot right now: stays spanning `date`, checkout day included. */
export async function inHouseStays(building: string, date: string): Promise<Stay[]> {
  const all = await staysForBuilding(building, date, date)
  return all.filter(s => s.checkIn <= date && date <= s.checkOut)
}

// ── Bookings ────────────────────────────────────────────────────────────────────────────────────
export async function bookingsFor(lotId: string, from: string, to: string, opts: { all?: boolean } = {}): Promise<Booking[]> {
  // Nights that touch the window — a car leaving on `from` is still included (it is in the lot that
  // morning; the sweep must know it), so the calendar clips zero-night bars itself.
  let q = supabaseAdmin().from('parking_bookings').select('*').eq('lot_id', lotId).lt('starts_on', addDays(to, 1)).gte('ends_on', from).order('starts_on')
  if (!opts.all) q = q.in('status', LIVE_BOOKING.concat(['left']))
  const { data } = await q.limit(2000)
  return (data || []).map(bookingOf)
}
export async function bookingById(id: string): Promise<Booking | null> {
  const { data } = await supabaseAdmin().from('parking_bookings').select('*').eq('id', id).maybeSingle()
  return data ? bookingOf(data) : null
}

async function conflictFor(spotId: string, startsOn: string, endsOn: string, exceptId?: string): Promise<Booking | null> {
  let q = supabaseAdmin().from('parking_bookings').select('*').eq('spot_id', spotId).in('status', LIVE_BOOKING).lt('starts_on', endsOn).gt('ends_on', startsOn)
  if (exceptId) q = q.neq('id', exceptId)
  const { data } = await q.limit(1)
  return data && data[0] ? bookingOf(data[0]) : null
}

export type BookingInput = {
  lotId: string; spotId?: string | null; kind?: BookingKind
  reservationId?: string | null; listingId?: string | null; unit?: string | null; guestName?: string | null; guestPhone?: string | null
  startsOn: string; endsOn: string
  plate?: string | null; plateState?: string | null; make?: string | null; model?: string | null; color?: string | null
  amountCents?: number | null; paid?: Paid; paidVia?: string | null; notes?: string | null; status?: BookingStatus
}

/** The first spot free for the whole run, sellable first for guests, held first for our own cars. */
export async function suggestSpot(lotId: string, startsOn: string, endsOn: string, kind: BookingKind, exceptId?: string): Promise<Spot | null> {
  const spots = await spotsFor(lotId)
  const ordered = spots.slice().sort((a, b) => {
    const pa = kind === 'guest' ? (a.kind === 'sell' ? 0 : 1) : (a.kind === 'hold' ? 0 : 1)
    const pb = kind === 'guest' ? (b.kind === 'sell' ? 0 : 1) : (b.kind === 'hold' ? 0 : 1)
    return pa - pb || a.sort - b.sort
  }).filter(s => kind !== 'guest' || s.kind === 'sell')
  const busy = await bookingsFor(lotId, startsOn, addDays(endsOn, -1))
  for (const s of ordered) {
    const taken = busy.some(b => b.spotId === s.id && LIVE_BOOKING.indexOf(b.status) >= 0 && b.id !== exceptId && rangesOverlap(b.startsOn, b.endsOn, startsOn, endsOn))
    if (!taken) return s
  }
  return null
}

export async function createBooking(inp: BookingInput, by: string): Promise<{ ok: true; booking: Booking; guestyNote: string | null } | { ok: false; error: string; conflict?: Booking }> {
  const lot = await lotById(inp.lotId)
  if (!lot) return { ok: false, error: 'That lot does not exist.' }
  const kind: BookingKind = (['guest', 'staff', 'owner', 'vendor', 'block'] as BookingKind[]).indexOf(inp.kind as BookingKind) >= 0 ? (inp.kind as BookingKind) : 'guest'
  const startsOn = str(inp.startsOn).slice(0, 10), endsOn = str(inp.endsOn).slice(0, 10)
  if (!isYmd(startsOn) || !isYmd(endsOn)) return { ok: false, error: 'Pick the first and last night.' }
  if (nightsBetween(startsOn, endsOn) < 1) return { ok: false, error: 'The car has to stay at least one night — the leave date must be after the arrive date.' }
  if (nightsBetween(startsOn, endsOn) > 400) return { ok: false, error: 'That is more than a year — split it.' }
  const spots = await spotsFor(lot.id, true)
  let spot = spots.find(s => s.id === str(inp.spotId)) || null
  if (!spot) {
    spot = await suggestSpot(lot.id, startsOn, endsOn, kind)
    if (!spot) return { ok: false, error: kind === 'guest' ? 'No sellable spot is free for every night of that run.' : 'No spot is free for every night of that run.' }
  }
  if (!spot.active) return { ok: false, error: `Spot ${spot.label} is switched off.` }
  // HELD SPOTS ARE NEVER SOLD (Jon). The rule lives here so no form, import or Eve action can break it.
  if (kind === 'guest' && spot.kind === 'hold') return { ok: false, error: `Spot ${spot.label} is held for staff and manoeuvring — it is never sold. Pick a numbered spot.` }
  const conflict = await conflictFor(spot.id, startsOn, endsOn)
  if (conflict) return { ok: false, error: `Spot ${spot.label} already has ${conflict.guestName || conflict.plate || 'a car'} ${dayET(conflict.startsOn)} → ${dayET(conflict.endsOn)}.`, conflict }
  const nights = nightsBetween(startsOn, endsOn)
  const rate = kind === 'guest' ? lot.rateCents : 0
  const amount = inp.amountCents == null || !Number.isFinite(Number(inp.amountCents)) ? nights * rate : Math.max(0, Math.round(Number(inp.amountCents)))
  const paid: Paid = kind === 'guest' ? ((['unpaid', 'paid', 'comped'] as Paid[]).indexOf(inp.paid as Paid) >= 0 ? (inp.paid as Paid) : 'unpaid') : 'na'
  const plate = tidyPlate(inp.plate) || null
  const row = {
    lot_id: lot.id, spot_id: spot.id, kind,
    reservation_id: clean(inp.reservationId, 80), listing_id: clean(inp.listingId, 80), unit: clean(inp.unit, 80), guest_name: clean(inp.guestName, 120), guest_phone: clean(inp.guestPhone, 40),
    starts_on: startsOn, ends_on: endsOn,
    plate, plate_norm: plate ? normalizePlate(plate) || null : null, plate_state: clean(inp.plateState, 20)?.toUpperCase() || null,
    make: clean(inp.make, 60), model: clean(inp.model, 60), color: clean(inp.color, 40),
    rate_cents: rate, amount_cents: amount, paid, paid_via: paid === 'paid' ? clean(inp.paidVia, 20) : null, paid_at: paid === 'paid' ? new Date().toISOString() : null, paid_by: paid === 'paid' ? by : null,
    status: inp.status === 'parked' ? 'parked' : 'reserved', notes: clean(inp.notes, 1000), created_by: by,
  }
  const { data, error } = await supabaseAdmin().from('parking_bookings').insert(row).select('*').single()
  if (error || !data) {
    if (/parking_bookings_no_overlap|exclusion/i.test(str(error?.message))) return { ok: false, error: `Spot ${spot.label} was taken for one of those nights a moment ago — pick another.` }
    return { ok: false, error: error?.message || 'Could not save the booking.' }
  }
  const booking = bookingOf(data)
  const guestyNote = booking.reservationId ? await noteOnGuesty(booking, lot, by, 'Parking') : null
  return { ok: true, booking, guestyNote }
}

export async function updateBooking(id: string, patch: Record<string, any>, by: string): Promise<{ ok: true; booking: Booking; guestyNote: string | null } | { ok: false; error: string; conflict?: Booking }> {
  const cur = await bookingById(id)
  if (!cur) return { ok: false, error: 'That booking is gone.' }
  const lot = await lotById(cur.lotId)
  if (!lot) return { ok: false, error: 'That lot does not exist.' }
  const up: Record<string, any> = { updated_at: new Date().toISOString() }
  const startsOn = 'startsOn' in patch ? str(patch.startsOn).slice(0, 10) : cur.startsOn
  const endsOn = 'endsOn' in patch ? str(patch.endsOn).slice(0, 10) : cur.endsOn
  if (!isYmd(startsOn) || !isYmd(endsOn) || nightsBetween(startsOn, endsOn) < 1) return { ok: false, error: 'The leave date must be after the arrive date.' }
  const spotId = 'spotId' in patch && patch.spotId ? str(patch.spotId) : cur.spotId
  const kind: BookingKind = 'kind' in patch && (['guest', 'staff', 'owner', 'vendor', 'block'] as string[]).indexOf(patch.kind) >= 0 ? patch.kind : cur.kind
  const status: BookingStatus = 'status' in patch && (['reserved', 'parked', 'left', 'cancelled', 'no_show'] as string[]).indexOf(patch.status) >= 0 ? patch.status : cur.status
  if (spotId !== cur.spotId || startsOn !== cur.startsOn || endsOn !== cur.endsOn || kind !== cur.kind || (LIVE_BOOKING.indexOf(status) >= 0 && LIVE_BOOKING.indexOf(cur.status) < 0)) {
    const spots = await spotsFor(cur.lotId, true)
    const spot = spots.find(s => s.id === spotId)
    if (!spot) return { ok: false, error: 'That spot does not exist.' }
    if (kind === 'guest' && spot.kind === 'hold') return { ok: false, error: `Spot ${spot.label} is held for staff and manoeuvring — it is never sold.` }
    if (LIVE_BOOKING.indexOf(status) >= 0) {
      const conflict = await conflictFor(spotId, startsOn, endsOn, cur.id)
      if (conflict) return { ok: false, error: `Spot ${spot.label} already has ${conflict.guestName || conflict.plate || 'a car'} ${dayET(conflict.startsOn)} → ${dayET(conflict.endsOn)}.`, conflict }
    }
    up.spot_id = spotId; up.starts_on = startsOn; up.ends_on = endsOn; up.kind = kind
    if (kind !== 'guest') { up.paid = 'na'; up.rate_cents = 0 }
    else if (cur.kind !== 'guest') { up.rate_cents = lot.rateCents; up.paid = 'unpaid' }
    if (!('amountCents' in patch) && kind === 'guest' && (startsOn !== cur.startsOn || endsOn !== cur.endsOn || cur.kind !== 'guest')) up.amount_cents = nightsBetween(startsOn, endsOn) * (kind === 'guest' ? (cur.kind === 'guest' ? cur.rateCents : lot.rateCents) : 0)
  }
  up.status = status
  for (const k of ['reservationId', 'listingId', 'unit', 'guestName', 'guestPhone', 'make', 'model', 'color', 'notes']) {
    if (k in patch) up[k.replace(/[A-Z]/g, m => '_' + m.toLowerCase())] = clean(patch[k], k === 'notes' ? 1000 : 120)
  }
  if ('plate' in patch) { const p = tidyPlate(patch.plate) || null; up.plate = p; up.plate_norm = p ? normalizePlate(p) || null : null }
  if ('plateState' in patch) up.plate_state = clean(patch.plateState, 20)?.toUpperCase() || null
  if ('amountCents' in patch) up.amount_cents = Math.max(0, Math.round(num(patch.amountCents)))
  if ('paid' in patch && kind === 'guest') {
    const p: Paid = (['unpaid', 'paid', 'comped'] as Paid[]).indexOf(patch.paid) >= 0 ? patch.paid : 'unpaid'
    up.paid = p
    up.paid_via = p === 'paid' ? clean(patch.paidVia, 20) || cur.paidVia : null
    up.paid_at = p === 'paid' ? (cur.paid === 'paid' && cur.paidAt ? cur.paidAt : new Date().toISOString()) : null
    up.paid_by = p === 'paid' ? (cur.paid === 'paid' && cur.paidBy ? cur.paidBy : by) : null
  }
  const { data, error } = await supabaseAdmin().from('parking_bookings').update(up).eq('id', id).select('*').single()
  if (error || !data) {
    if (/parking_bookings_no_overlap|exclusion/i.test(str(error?.message))) return { ok: false, error: 'That spot was taken for one of those nights a moment ago — pick another.' }
    return { ok: false, error: error?.message || 'Could not save the booking.' }
  }
  const booking = bookingOf(data)
  const changedForGuesty = booking.reservationId && (up.spot_id || up.starts_on || up.ends_on || 'plate' in patch || status !== cur.status || ('paid' in patch && up.paid !== cur.paid))
  const guestyNote = changedForGuesty ? await noteOnGuesty(booking, lot, by, status === 'cancelled' ? 'Parking cancelled' : 'Parking updated') : null
  return { ok: true, booking, guestyNote }
}

export async function deleteBooking(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin().from('parking_bookings').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** One dated line on the reservation's notes in Guesty, so the spot shows where the team already looks. Best-effort. */
async function noteOnGuesty(b: Booking, lot: Lot, by: string, label: string): Promise<string | null> {
  if (!b.reservationId) return null
  try {
    const [{ getToken }, { appendReservationNote }] = await Promise.all([import('./guesty'), import('./guesty-res-notes')])
    const token = await getToken()
    if (!token) return 'Guesty not configured'
    const db = supabaseAdmin()
    const { data: res } = await db.from('guesty_reservations').select('custom_fields, raw').eq('id', b.reservationId).maybeSingle()
    const raw: any = (res as any)?.raw || {}
    const current: any[] = Array.isArray((res as any)?.custom_fields) ? (res as any).custom_fields : (Array.isArray(raw.customFields) ? raw.customFields : [])
    const spots = await spotsFor(lot.id, true)
    const spot = spots.find(s => s.id === b.spotId)
    const money = b.kind === 'guest' ? ` · ${cents(b.amountCents, lot.currency)} ${b.paid}` : ''
    const line = `${lot.name}: spot ${spot?.label || '?'} · ${carLabel(b)}${b.plate ? ' · ' + b.plate : ''} · ${dayET(b.startsOn)} → ${dayET(b.endsOn)} (${b.nights}n)${money}${b.status !== 'reserved' ? ' · ' + b.status : ''}`
    const wr = await appendReservationNote({ reservationId: b.reservationId, token, current, label, by, note: line })
    if (wr.ok && Array.isArray(wr.fields)) await db.from('guesty_reservations').update({ custom_fields: wr.fields }).eq('id', b.reservationId)
    return wr.ok ? 'ok' : (wr.note || 'write failed')
  } catch (e: any) { return str(e?.message || e) }
}

// ── Plates: who is this car? ────────────────────────────────────────────────────────────────────
export type PlateVerdict = {
  plate: string; plateNorm: string
  verdict: SweepCheck['verdict']
  booking: Booking | null              // the exact match, when there is one
  belongsIn: Spot | null               // where the exact match should be
  near: { booking: Booking; spot: Spot | null }[]   // "did you mean" — one honest mistake away
  note: string
}
/**
 * Judge a plate seen in `spotId` (or none) on `date`. Exact plate match on a booking covering that
 * night (checkout morning counts) is ok in its own spot, wrong_spot elsewhere (staff_in_sell when a
 * staff car sits in a sellable spot). No exact match → unregistered, with near matches offered.
 */
export async function judgePlate(lotId: string, plateIn: string, spotId: string | null, date: string): Promise<PlateVerdict> {
  const plate = tidyPlate(plateIn)
  const plateNorm = normalizePlate(plate)
  const [spots, live] = await Promise.all([spotsFor(lotId, true), bookingsFor(lotId, date, date)])
  const covering = live.filter(b => LIVE_BOOKING.indexOf(b.status) >= 0 && b.startsOn <= date && date <= b.endsOn && b.plateNorm)
  const spotById = (id: string | null) => (id ? spots.find(s => s.id === id) || null : null)
  const empty: PlateVerdict = { plate, plateNorm, verdict: 'unregistered', booking: null, belongsIn: null, near: [], note: '' }
  if (!plateNorm) return { ...empty, note: 'No plate to check.' }
  const exact = covering.filter(b => b.plateNorm === plateNorm)
  // Prefer the booking whose spot is the one we are standing in; otherwise the first.
  const hit = exact.find(b => spotId && b.spotId === spotId) || exact[0] || null
  if (hit) {
    const home = spotById(hit.spotId)
    const here = spotById(spotId)
    const leaving = hit.endsOn === date
    if (!spotId || hit.spotId === spotId) return { ...empty, verdict: leaving ? 'leaving_today' : 'ok', booking: hit, belongsIn: home, note: leaving ? `Registered here — leaving today (${hit.guestName || hit.kind}).` : `Registered here — ${hit.guestName || hit.kind}${hit.unit ? ', ' + hit.unit : ''} through ${dayET(hit.endsOn)}.` }
    const staffInSell = hit.kind !== 'guest' && here?.kind === 'sell'
    return { ...empty, verdict: staffInSell ? 'staff_in_sell' : 'wrong_spot', booking: hit, belongsIn: home, note: staffInSell ? `Our car (${hit.guestName || hit.kind}) in a sellable spot — it belongs in ${home?.label || '?'}.` : `Registered, but in the wrong spot — ${hit.guestName || hit.plate} belongs in ${home?.label || '?'}.` }
  }
  const near = covering.filter(b => b.plateNorm && platesClose(b.plateNorm, plateNorm)).map(b => ({ booking: b, spot: spotById(b.spotId) }))
  return { ...empty, near, note: near.length ? `Not registered as typed — close to ${near.map(n => (n.booking.plate || '') + (n.spot ? ' in ' + n.spot.label : '')).join(', ')}.` : 'Not registered in this lot tonight.' }
}

// ── Sweeps ──────────────────────────────────────────────────────────────────────────────────────
export async function startSweep(lotId: string, byName: string): Promise<Sweep | null> {
  const { data, error } = await supabaseAdmin().from('parking_sweeps').insert({ lot_id: lotId, sweep_date: ymdET(), by_name: clean(byName, 80) }).select('*').single()
  return error || !data ? null : sweepOf(data)
}
export async function sweepById(id: string): Promise<Sweep | null> {
  const { data } = await supabaseAdmin().from('parking_sweeps').select('*').eq('id', id).maybeSingle()
  return data ? sweepOf(data) : null
}
export async function lastSweep(lotId: string): Promise<Sweep | null> {
  const { data } = await supabaseAdmin().from('parking_sweeps').select('*').eq('lot_id', lotId).order('started_at', { ascending: false }).limit(1)
  return data && data[0] ? sweepOf(data[0]) : null
}
/** Save one spot's result. A spot checked twice keeps the latest answer. */
export async function recordCheck(sweepId: string, check: Omit<SweepCheck, 'at'>): Promise<Sweep | null> {
  const sw = await sweepById(sweepId)
  if (!sw || sw.finishedAt) return null
  const entry: SweepCheck = { ...check, at: new Date().toISOString() }
  const checks = sw.checks.filter(c => !(check.spotId && c.spotId === check.spotId) && !(check.result === 'extra' && c.result === 'extra' && c.plateNorm && c.plateNorm === check.plateNorm))
  checks.push(entry)
  const counts = tally(checks)
  const { data, error } = await supabaseAdmin().from('parking_sweeps').update({ checks, ...counts }).eq('id', sweepId).select('*').single()
  return error || !data ? null : sweepOf(data)
}
const tally = (checks: SweepCheck[]) => ({
  n_checked: checks.length,
  n_matched: checks.filter(c => c.verdict === 'ok' || c.verdict === 'leaving_today').length,
  n_empty: checks.filter(c => c.verdict === 'empty').length,
  n_flagged: checks.filter(c => c.verdict === 'unregistered' || c.verdict === 'wrong_spot' || c.verdict === 'staff_in_sell').length,
})

/** Close the sweep: every flagged check becomes an incident (one per plate — a car seen in two sweeps today is one incident). */
export async function finishSweep(sweepId: string, byName: string): Promise<{ sweep: Sweep; incidents: Incident[] } | null> {
  const sw = await sweepById(sweepId)
  if (!sw) return null
  const db = supabaseAdmin()
  const flagged = sw.checks.filter(c => c.verdict === 'unregistered' || c.verdict === 'wrong_spot' || c.verdict === 'staff_in_sell')
  const made: Incident[] = []
  for (const c of flagged) {
    const inc = await openIncident({
      lotId: sw.lotId, spotId: c.spotId, spotLabel: c.label, sweepId: sw.id,
      kind: c.verdict === 'wrong_spot' ? 'wrong_spot' : c.verdict === 'staff_in_sell' ? 'staff_in_sell' : 'unregistered',
      bookingId: c.bookingId, plate: c.plate, make: c.make, model: c.model, color: c.color, photoPath: c.photoPath, seenBy: byName,
    })
    if (inc) made.push(inc)
  }
  const { data } = await db.from('parking_sweeps').update({ finished_at: new Date().toISOString(), by_name: clean(byName, 80) || sw.byName, ...tally(sw.checks) }).eq('id', sweepId).select('*').single()
  return { sweep: data ? sweepOf(data) : sw, incidents: made }
}

// ── Incidents ───────────────────────────────────────────────────────────────────────────────────
export async function openIncident(inp: { lotId: string; spotId?: string | null; spotLabel?: string | null; sweepId?: string | null; kind: IncidentKind; bookingId?: string | null; plate?: string | null; plateState?: string | null; make?: string | null; model?: string | null; color?: string | null; photoPath?: string | null; seenBy?: string | null; notes?: string | null }): Promise<Incident | null> {
  const db = supabaseAdmin()
  const plate = tidyPlate(inp.plate) || null
  const plateNorm = plate ? normalizePlate(plate) || null : null
  // The same car flagged twice in a day is ONE incident — the second sighting updates where it was seen.
  if (plateNorm) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data: dup } = await db.from('parking_incidents').select('*').eq('lot_id', inp.lotId).eq('plate_norm', plateNorm).in('status', OPEN_INCIDENT).gte('seen_at', since).order('seen_at', { ascending: false }).limit(1)
    if (dup && dup[0]) {
      const { data } = await db.from('parking_incidents').update({ spot_id: inp.spotId ?? dup[0].spot_id, spot_label: inp.spotLabel ?? dup[0].spot_label, sweep_id: inp.sweepId ?? dup[0].sweep_id, photo_path: inp.photoPath || dup[0].photo_path, updated_at: new Date().toISOString() }).eq('id', dup[0].id).select('*').single()
      return data ? incidentOf(data) : incidentOf(dup[0])
    }
  }
  const { data, error } = await db.from('parking_incidents').insert({
    lot_id: inp.lotId, spot_id: inp.spotId || null, spot_label: clean(inp.spotLabel, 12), sweep_id: inp.sweepId || null, kind: inp.kind, booking_id: inp.bookingId || null,
    plate, plate_norm: plateNorm, plate_state: clean(inp.plateState, 20)?.toUpperCase() || null, make: clean(inp.make, 60), model: clean(inp.model, 60), color: clean(inp.color, 40),
    photo_path: inp.photoPath || null, seen_by: clean(inp.seenBy, 80), notes: clean(inp.notes, 1000),
  }).select('*').single()
  return error || !data ? null : incidentOf(data)
}
export async function incidentById(id: string): Promise<Incident | null> {
  const { data } = await supabaseAdmin().from('parking_incidents').select('*').eq('id', id).maybeSingle()
  return data ? incidentOf(data) : null
}
export async function incidentsFor(lotId: string, opts: { openOnly?: boolean; limit?: number } = {}): Promise<Incident[]> {
  let q = supabaseAdmin().from('parking_incidents').select('*').eq('lot_id', lotId).order('seen_at', { ascending: false }).limit(opts.limit || 60)
  if (opts.openOnly) q = q.in('status', OPEN_INCIDENT)
  const { data } = await q
  return (data || []).map(incidentOf)
}

/** The 1-hour notice as it goes to every in-house guest. Editable before sending. */
export function noticeTextFor(lot: Lot, inc: Pick<Incident, 'plate' | 'make' | 'model' | 'color' | 'spotLabel' | 'kind'>, dueAt: Date): string {
  const car = carLabel(inc)
  const where = inc.spotLabel ? `in spot ${inc.spotLabel}` : 'in our parking lot'
  const mins = lot.noticeMinutes
  const by = timeET(dueAt)
  const why = inc.kind === 'wrong_spot' ? 'in a spot that is not the one it was registered for' : 'without a parking registration'
  return `Parking notice — ${lot.building}\n\nA ${car}${inc.plate ? `, plate ${inc.plate},` : ''} is parked ${where} ${why}. If this is your vehicle, please move it or register it with us within ${mins === 60 ? '1 hour' : mins + ' minutes'} (by ${by}). Vehicles still unregistered after that are towed at the owner's expense.\n\nParking is ${cents(lot.rateCents, lot.currency)} per night, one space per reservation, in the spot you are given. Reply to this message with your make, model and plate to register.`
}

/** Send the notice to every stay in house at the lot's building right now. */
export async function sendNotice(incidentId: string, text: string, by: string): Promise<{ ok: boolean; error?: string; sent: number; failed: number; recipients: number; incident?: Incident }> {
  const inc = await incidentById(incidentId)
  if (!inc) return { ok: false, error: 'That flag is gone.', sent: 0, failed: 0, recipients: 0 }
  const lot = await lotById(inc.lotId)
  if (!lot) return { ok: false, error: 'That lot does not exist.', sent: 0, failed: 0, recipients: 0 }
  const body = str(text).trim()
  if (!body) return { ok: false, error: 'The notice is empty.', sent: 0, failed: 0, recipients: 0 }
  const stays = await inHouseStays(lot.building, ymdET())
  const withThread = stays.filter(s => s.conversationId)
  if (!withThread.length) return { ok: false, error: `Nobody in house at ${lot.building} has a message thread to send to.`, sent: 0, failed: 0, recipients: stays.length }
  const { sendGuestMessage } = await import('./guesty')
  const log: any[] = []
  let sent = 0, failed = 0
  // Four at a time: a building of 25 units finishes well inside the route's budget.
  for (let i = 0; i < withThread.length; i += 4) {
    const batch = withThread.slice(i, i + 4)
    const results = await Promise.all(batch.map(async s => {
      try {
        const r = await sendGuestMessage(s.conversationId as string, body)
        return { reservationId: s.id, guest: s.guest, unit: s.unit, ok: !!r.ok, error: r.ok ? null : str((r as any).error || 'failed') }
      } catch (e: any) { return { reservationId: s.id, guest: s.guest, unit: s.unit, ok: false, error: str(e?.message || e) } }
    }))
    for (const r of results) { log.push(r); if (r.ok) sent++; else failed++ }
  }
  const now = new Date()
  const due = new Date(now.getTime() + lot.noticeMinutes * 60000)
  const up: Record<string, any> = {
    notice_text: body, notice_sent_n: inc.noticeSentN + sent, notice_sent_by: by, notice_log: inc.noticeLog.concat(log), updated_at: now.toISOString(),
  }
  if (sent > 0) { up.notice_sent_at = inc.noticeSentAt || now.toISOString(); up.tow_due_at = inc.towDueAt || due.toISOString(); if (inc.status === 'open') up.status = 'notified' }
  const { data } = await supabaseAdmin().from('parking_incidents').update(up).eq('id', inc.id).select('*').single()
  return { ok: sent > 0, error: sent > 0 ? undefined : `Could not send to anyone (${log[0]?.error || 'no detail'}).`, sent, failed, recipients: withThread.length, incident: data ? incidentOf(data) : inc }
}

const esc = (s: any) => str(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

/** The email to the tow company, as a DRAFT in the notice mailbox — a person reads it and presses send. */
export async function draftTowEmail(incidentId: string, by: string): Promise<{ ok: boolean; error?: string; draftId?: string; incident?: Incident; preview: { to: string; subject: string; text: string } }> {
  const inc = await incidentById(incidentId)
  const lot = inc ? await lotById(inc.lotId) : null
  const empty = { to: '', subject: '', text: '' }
  if (!inc || !lot) return { ok: false, error: 'That flag is gone.', preview: empty }
  const car = carLabel(inc)
  const subject = `Tow request — ${lot.name}: ${inc.plate || car}${inc.plate ? ` (${car})` : ''}`
  const photo = inc.photoPath ? await signedPhotoUrl(inc.photoPath, 7 * 24 * 3600) : null
  const lines: string[] = [
    `Hello${lot.towCompany ? ' ' + lot.towCompany : ''},`,
    ``,
    `Please tow the following vehicle from our lot at ${lot.name}${lot.address ? ', ' + lot.address : ''}. It is parked ${inc.kind === 'wrong_spot' ? 'in a spot it is not registered for' : 'without authorization'} and the posted notice period has passed.`,
    ``,
    `Vehicle: ${car}`,
    `Plate: ${inc.plate || 'not readable'}${inc.plateState ? ' (' + inc.plateState + ')' : ''}`,
    `Location: ${inc.spotLabel ? 'spot ' + inc.spotLabel : 'in the lot'}`,
    `First seen: ${stampET(inc.seenAt)}${inc.seenBy ? ' by ' + inc.seenBy : ''}`,
    inc.noticeSentAt ? `Notice to guests: ${stampET(inc.noticeSentAt)} (${inc.noticeSentN} guests), deadline ${inc.towDueAt ? stampET(inc.towDueAt) : '—'}` : `Notice to guests: not sent`,
    photo ? `Photo: ${photo}` : '',
    ``,
    `Tow at the owner's expense per the posted lot rules${lot.rules ? ': "' + lot.rules + '"' : '.'}`,
    ``,
    `Authorized by ${by}, ${lot.building} — please confirm the pickup time by reply.`,
  ].filter(l => l !== undefined)
  const text = lines.join('\n')
  const preview = { to: lot.towEmail || '', subject, text }
  if (!lot.towEmail) return { ok: false, error: `Add the tow company's email on the lot's Settings first.`, preview, incident: inc }
  try {
    const [{ draftGmail }, { getTaskAutomation }] = await Promise.all([import('./gmail-send'), import('./auto-inspections')])
    const cfg = await getTaskAutomation()
    const fromEmail = str(cfg?.noticeDrafts?.fromEmail) || 'support@stay-hospitality.com'
    const html = `<div style="font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B1A17">${lines.map(l => l ? `<p style="margin:0 0 4px">${esc(l).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>` : '<p style="margin:0 0 10px"></p>').join('')}</div>`
    const r = await draftGmail({ fromEmail, to: [lot.towEmail], subject, html })
    const now = new Date().toISOString()
    if (!r.ok) {
      await supabaseAdmin().from('parking_incidents').update({ tow_draft_error: str(r.error).slice(0, 500), updated_at: now }).eq('id', inc.id)
      return { ok: false, error: r.error || 'Gmail refused the draft.', preview, incident: { ...inc, towDraftError: r.error || null } }
    }
    const { data } = await supabaseAdmin().from('parking_incidents').update({ status: inc.status === 'towed' || inc.status === 'resolved' || inc.status === 'dismissed' ? inc.status : 'tow_drafted', tow_draft_id: r.draftId || null, tow_drafted_at: now, tow_draft_error: null, tow_to: lot.towEmail, updated_at: now }).eq('id', inc.id).select('*').single()
    return { ok: true, draftId: r.draftId, incident: data ? incidentOf(data) : inc, preview }
  } catch (e: any) {
    return { ok: false, error: str(e?.message || e), preview, incident: inc }
  }
}

export async function closeIncident(id: string, how: 'towed' | 'resolved' | 'dismissed' | 'reopen', by: string, resolution?: string): Promise<Incident | null> {
  const now = new Date().toISOString()
  const up: Record<string, any> = { updated_at: now }
  if (how === 'towed') { up.status = 'towed'; up.towed_at = now; up.towed_by = by }
  else if (how === 'reopen') { up.status = 'open'; up.resolved_at = null; up.resolved_by = null; up.resolution = null; up.towed_at = null; up.towed_by = null }
  else { up.status = how; up.resolved_at = now; up.resolved_by = by; up.resolution = clean(resolution, 200) }
  const { data } = await supabaseAdmin().from('parking_incidents').update(up).eq('id', id).select('*').single()
  return data ? incidentOf(data) : null
}
export async function noteIncident(id: string, notes: string): Promise<Incident | null> {
  const { data } = await supabaseAdmin().from('parking_incidents').update({ notes: clean(notes, 1000), updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  return data ? incidentOf(data) : null
}

/** THE HOUR IS UP (cron + lazy on every lot load): draft the tow email for every notified car past its deadline. */
export async function processDueTows(lotId?: string): Promise<{ checked: number; drafted: number; errors: string[] }> {
  let q = supabaseAdmin().from('parking_incidents').select('id').eq('status', 'notified').is('tow_draft_id', null).lte('tow_due_at', new Date().toISOString()).limit(20)
  if (lotId) q = q.eq('lot_id', lotId)
  const { data } = await q
  const out = { checked: (data || []).length, drafted: 0, errors: [] as string[] }
  for (const row of data || []) {
    const r = await draftTowEmail(str((row as any).id), 'Lighthouse (the notice period ended)')
    if (r.ok) out.drafted++; else out.errors.push(str(r.error))
  }
  return out
}

// ── Photos ──────────────────────────────────────────────────────────────────────────────────────
export async function storePhoto(lotId: string, base64: string, mime: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const m = /^image\/(jpeg|jpg|png|webp|heic)$/i.exec(str(mime)) ? str(mime).toLowerCase() : 'image/jpeg'
  let bytes: Buffer
  try { bytes = Buffer.from(str(base64).replace(/^data:[^,]+,/, ''), 'base64') } catch { return { ok: false, error: 'Bad image data.' } }
  if (!bytes.length) return { ok: false, error: 'Empty image.' }
  if (bytes.length > 6 * 1024 * 1024) return { ok: false, error: 'That photo is too big (6 MB max).' }
  const ext = m.indexOf('png') >= 0 ? 'png' : m.indexOf('webp') >= 0 ? 'webp' : 'jpg'
  const path = `lots/${lotId}/${ymdET()}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up = await supabaseAdmin().storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: m, upsert: false })
  if (up.error) return { ok: false, error: up.error.message }
  return { ok: true, path }
}
export async function signedPhotoUrl(path: string, seconds = 600): Promise<string | null> {
  if (!path) return null
  const r = await supabaseAdmin().storage.from(PHOTO_BUCKET).createSignedUrl(path, seconds)
  return r.data?.signedUrl || null
}

// ── Reading a plate off a photo (the "scan") ────────────────────────────────────────────────────
export type PlateRead = { plate: string | null; state: string | null; make: string | null; model: string | null; color: string | null; confidence: number; note: string | null }
const READ_SYSTEM = `You read one photograph of a parked vehicle for a parking attendant. Return ONLY a JSON object:
{"plate": "<characters on the license plate, upper-case, no spaces or dashes, or null if none is legible>",
 "state": "<US state or country on the plate, 2-letter code when clear, else null>",
 "make": "<manufacturer, e.g. Toyota, or null>", "model": "<model, e.g. Camry, or null>", "color": "<one word, or null>",
 "confidence": <0 to 1 — how sure you are of the PLATE characters>,
 "note": "<one short line if something matters: plate partly hidden, two cars in frame, a 0/O or 8/B you are unsure of; else null>"}
Read what is actually visible. Never guess hidden characters. If the plate is unreadable set plate to null and confidence to 0.`
export async function readPlateFromPhoto(base64: string, mime: string): Promise<{ ok: boolean; read?: PlateRead; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY || ''
  if (!key) return { ok: false, error: 'No AI key is set — type the plate instead.' }
  const data = str(base64).replace(/^data:[^,]+,/, '')
  if (!data) return { ok: false, error: 'No photo.' }
  const media = /^image\/(jpeg|png|webp|gif)$/i.exec(str(mime)) ? str(mime).toLowerCase() : 'image/jpeg'
  try {
    const [{ modelPairFor }, { anthropicMessages, textOf }] = await Promise.all([import('./ai-models'), import('./anthropic-call')])
    const { model, fallback } = await modelPairFor('eve-vision')
    const r = await anthropicMessages(key, {
      model, max_tokens: 300, system: READ_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: media, data } }, { type: 'text', text: 'Read this vehicle. JSON only.' }] }],
    }, fallback, 'eve-vision')
    if (!r.ok) return { ok: false, error: r.status === 429 ? 'The AI budget for today is used up — type the plate.' : `The photo could not be read (${r.status}) — type the plate.` }
    const text = textOf(r.data)
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return { ok: false, error: 'The photo could not be read — type the plate.' }
    const j: any = JSON.parse(m[0])
    const plate = j?.plate ? tidyPlate(j.plate) : null
    return { ok: true, read: { plate: plate && normalizePlate(plate) ? plate : null, state: clean(j?.state, 20)?.toUpperCase() || null, make: clean(j?.make, 40), model: clean(j?.model, 40), color: clean(j?.color, 30), confidence: Math.max(0, Math.min(1, num(j?.confidence))), note: clean(j?.note, 160) } }
  } catch (e: any) { return { ok: false, error: str(e?.message || e) } }
}

// ── The bundle the Parking tab opens with ───────────────────────────────────────────────────────
export async function lotBundle(lotId: string, from: string, to: string): Promise<{ lot: Lot; spots: Spot[]; bookings: Booking[]; incidents: Incident[]; lastSweep: Sweep | null; today: string } | null> {
  const lot = await lotById(lotId)
  if (!lot) return null
  // Lazy tow drafts: anyone opening the lot after the hour gets the email drafted (idempotent).
  processDueTows(lot.id).catch(() => null)
  const [spots, bookings, incidents, sweep] = await Promise.all([spotsFor(lot.id, true), bookingsFor(lot.id, from, to, { all: true }), incidentsFor(lot.id, { limit: 80 }), lastSweep(lot.id)])
  const withPhotos = await Promise.all(incidents.map(async i => (i.photoPath && OPEN_INCIDENT.indexOf(i.status) >= 0 ? { ...i, photoUrl: await signedPhotoUrl(i.photoPath, 900) } : i)))
  return { lot, spots, bookings, incidents: withPhotos, lastSweep: sweep, today: ymdET() }
}

/** A stay as the field team's phone sees it: enough to register a car, no contact details. */
export type FieldStay = { id: string; guest: string; unit: string; checkIn: string; checkOut: string; nights: number; inHouse: boolean; arrivesToday: boolean; hasSpot: string | null }

/**
 * What the staff page shows (Jon, 2026-10-26: "show active parking reservations so our field team
 * can manage and scan licence plate numbers"): today's lot spot by spot with the car expected in
 * each, the cars arriving tomorrow, and the stays a car can be registered to — in house first, then
 * arrivals over the next week. No phone numbers or emails leave through this door.
 */
export async function lotToday(lot: Lot, date: string): Promise<{ date: string; spots: (Spot & { expected: Booking[] })[]; arriving: Booking[]; stays: FieldStay[]; incidents: Incident[]; sweep: Sweep | null }> {
  processDueTows(lot.id).catch(() => null)
  const tomorrow = addDays(date, 1)
  const [spots, bookings, incidents, sweep, stays] = await Promise.all([
    spotsFor(lot.id), bookingsFor(lot.id, date, addDays(date, 8)), incidentsFor(lot.id, { openOnly: true, limit: 30 }), lastSweep(lot.id),
    staysForBuilding(lot.building, date, addDays(date, 7)).catch(() => [] as Stay[]),
  ])
  const live = bookings.filter(b => LIVE_BOOKING.indexOf(b.status) >= 0 && b.startsOn <= date && date <= b.endsOn)
  const arriving = bookings.filter(b => b.status === 'reserved' && b.startsOn === tomorrow)
  const spotLabel = (id: string) => spots.find(s => s.id === id)?.label || null
  const upcoming = bookings.filter(b => LIVE_BOOKING.indexOf(b.status) >= 0 && b.reservationId)
  return {
    date,
    spots: spots.map(s => ({ ...s, expected: live.filter(b => b.spotId === s.id).sort((a, b) => (a.endsOn === date ? 1 : 0) - (b.endsOn === date ? 1 : 0)) })),
    arriving,
    stays: stays
      .filter(s => s.checkOut >= date)
      .map(s => ({ id: s.id, guest: s.guest, unit: s.unit, checkIn: s.checkIn, checkOut: s.checkOut, nights: s.nights, inHouse: s.checkIn <= date && date < s.checkOut, arrivesToday: s.checkIn === date, hasSpot: (() => { const b = upcoming.find(x => x.reservationId === s.id); return b ? spotLabel(b.spotId) : null })() }))
      .sort((a, b) => (b.inHouse ? 1 : 0) - (a.inHouse ? 1 : 0) || a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit)),
    incidents: await Promise.all(incidents.map(async i => (i.photoPath ? { ...i, photoUrl: await signedPhotoUrl(i.photoPath, 900) } : i))),
    sweep: sweep && sweep.sweepDate === date ? sweep : null,
  }
}

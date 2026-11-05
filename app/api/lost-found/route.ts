// LOST & FOUND (Jon, 2026-11-04: "views lost and found items, assign to reservation and manage this").
//   GET                         → every item, newest find first (?status=held|open|resolved|all, ?q=)
//   GET ?stays=1&listing=&date= → the reservations that were in THAT unit around THAT date (the
//                                 picker's first guess at whose it is), plus ?guest= name search
//   POST                        → log a find
//   PATCH                       → attach a stay / change status / add a note / shipping details
// Table: lost_found_items (172_lost_found.sql). Every change appends to `history`.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { requireLevel } from '@/lib/access'
import { unitLabel } from '@/lib/unit-label'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const STATUSES = ['held', 'contacted', 'claimed', 'shipping', 'returned', 'donated', 'discarded'] as const
const CATEGORIES = ['clothing', 'electronics', 'documents', 'jewelry', 'toiletries', 'toys', 'keys_cards', 'other'] as const
const RESOLVED = ['returned', 'donated', 'discarded']
// Hold window (how long we keep an unclaimed item before it may be donated/discarded). The page
// shows a "hold ends" tag from this; nothing is thrown out automatically.
const HOLD_DAYS = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function num(v: any): number | null { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function isDate(s: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00').getTime()) }
function shiftDate(iso: string, days: number): string { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }

async function listingMap(db: any): Promise<Record<string, { name: string; market: string }>> {
  const { data } = await db.from('guesty_listings').select('id,nickname,title,building,address_city')
  const m: Record<string, { name: string; market: string }> = {}
  for (const l of (data || []) as any[]) { const name = unitLabel(l); m[String(l.id)] = { name, market: marketOf(l.building, l.address_city, name) } }
  return m
}

function shapeStay(r: any, lmap: Record<string, { name: string; market: string }>) {
  const li = lmap[String(r.listing_id)]
  return {
    reservationId: String(r.id), listingId: String(r.listing_id),
    unit: li ? li.name : 'Unknown unit', market: li ? li.market : 'Other',
    guestName: r.guest_name || '', guestPhone: r.guest_phone || null, guestEmail: r.guest_email || null,
    checkIn: r.check_in, checkOut: r.check_out, channel: r.source || null,
    confirmationCode: r.confirmation_code || null,
    guestyUrl: 'https://app.guesty.com/reservations/' + String(r.id) + '/summary',
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('lost-found', 'view')
  if (!gate.ok) return gate.res
  const p = req.nextUrl.searchParams
  try {
    const db = supabaseAdmin()

    // ---- Stay picker: who was in this unit when the item turned up? ----
    if (str(p.get('stays')) === '1' || str(p.get('guest')).trim()) {
      const lmap = await listingMap(db)
      const listing = str(p.get('listing')).trim()
      const date = isDate(str(p.get('date'))) ? str(p.get('date')) : todayET()
      const guest = str(p.get('guest')).trim()
      let qy = db.from('guesty_reservations')
        .select('id,listing_id,guest_name,guest_phone,guest_email,check_in,check_out,status,source,confirmation_code')
        .in('status', ['confirmed', 'closed'])
      if (guest) {
        qy = qy.ilike('guest_name', '%' + guest + '%')
      } else if (listing) {
        // Stays that checked out in the 45 days up to the find (the one that just left is first), plus
        // the stay in-house that day — a guest sometimes reports a loss while still there.
        qy = qy.eq('listing_id', listing).lte('check_in', date).gte('check_out', shiftDate(date, -45))
      } else {
        return NextResponse.json({ ok: true, stays: [] })
      }
      const { data: rows, error } = await qy.order('check_out', { ascending: false }).limit(12)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      const stays = ((rows || []) as any[]).filter(r => !/cancel|inquiry/i.test(str(r.status))).map(r => shapeStay(r, lmap))
      return NextResponse.json({ ok: true, stays })
    }

    // ---- The list ----
    const status = str(p.get('status')) || 'open'
    let qy = db.from('lost_found_items').select('*')
    if (status === 'open') qy = qy.not('status', 'in', '(' + RESOLVED.join(',') + ')')
    else if (status === 'resolved') qy = qy.in('status', RESOLVED)
    else if (status !== 'all' && (STATUSES as readonly string[]).includes(status)) qy = qy.eq('status', status)
    const { data, error } = await qy.order('found_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    const needle = str(p.get('q')).trim().toLowerCase()
    let items = (data || []) as any[]
    if (needle) items = items.filter(i => [i.unit, i.item, i.description, i.guest_name, i.found_by, i.storage_location].some(v => str(v).toLowerCase().includes(needle)))
    const today = todayET()
    const counts: Record<string, number> = {}
    for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1
    return NextResponse.json({ ok: true, today, holdDays: HOLD_DAYS, count: items.length, counts, items })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

function entry(who: string, what: string, note?: string) {
  return { at: new Date().toISOString(), who, what, ...(note ? { note } : {}) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('lost-found', 'edit')
  if (!gate.ok) return gate.res
  const who = gate.access.email || 'unknown'
  try {
    const b = await req.json().catch(() => ({} as any))
    const item = str(b.item).trim().slice(0, 160)
    const unit = str(b.unit).trim().slice(0, 120)
    if (!item) return NextResponse.json({ ok: false, error: 'What was found?' }, { status: 400 })
    if (!unit) return NextResponse.json({ ok: false, error: 'Which unit?' }, { status: 400 })
    const foundDate = isDate(str(b.foundDate)) ? str(b.foundDate) : todayET()
    const category = (CATEGORIES as readonly string[]).includes(str(b.category)) ? str(b.category) : 'other'
    const db = supabaseAdmin()
    let market = str(b.market) || null
    if (!market && b.listingId) { const lmap = await listingMap(db); market = lmap[str(b.listingId)]?.market || null }
    const row: any = {
      listing_id: str(b.listingId) || null, unit, market, item,
      description: str(b.description).trim().slice(0, 2000) || null,
      category, found_where: str(b.foundWhere).trim().slice(0, 200) || null,
      found_date: foundDate, found_by: str(b.foundBy).trim().slice(0, 120) || null,
      storage_location: str(b.storageLocation).trim().slice(0, 200) || null,
      photos: Array.isArray(b.photos) ? b.photos.filter((x: any) => typeof x === 'string').slice(0, 12) : [],
      status: 'held', created_by: who,
      history: [entry(who, 'logged', 'Found in ' + unit + (b.foundWhere ? ' — ' + str(b.foundWhere) : ''))],
    }
    // The stay can be attached at logging time (the form offers the picker right away).
    if (b.stay && typeof b.stay === 'object') Object.assign(row, stayCols(b.stay), { history: [...row.history, entry(who, 'attached', stayLine(b.stay))] })
    const { data, error } = await db.from('lost_found_items').insert(row).select('*').single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, item: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

function stayCols(s: any) {
  return {
    reservation_id: str(s.reservationId) || null, guest_name: str(s.guestName) || null,
    guest_phone: str(s.guestPhone) || null, guest_email: str(s.guestEmail) || null,
    check_in: isDate(str(s.checkIn)) ? str(s.checkIn) : null, check_out: isDate(str(s.checkOut)) ? str(s.checkOut) : null,
  }
}
function stayLine(s: any) { return 'Attached to ' + (str(s.guestName) || 'a stay') + (s.checkIn ? ' (' + str(s.checkIn) + ' → ' + str(s.checkOut) + ')' : '') }

export async function PATCH(req: NextRequest) {
  const gate = await requireLevel('lost-found', 'edit')
  if (!gate.ok) return gate.res
  const who = gate.access.email || 'unknown'
  try {
    const b = await req.json().catch(() => ({} as any))
    const id = str(b.id).trim()
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 })
    const db = supabaseAdmin()
    const { data: cur, error: e0 } = await db.from('lost_found_items').select('*').eq('id', id).single()
    if (e0 || !cur) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    const history: any[] = Array.isArray(cur.history) ? cur.history.slice() : []
    const upd: any = {}

    if (b.stay === null) { // detach
      Object.assign(upd, { reservation_id: null, guest_name: null, guest_phone: null, guest_email: null, check_in: null, check_out: null })
      history.push(entry(who, 'detached', 'Stay removed'))
    } else if (b.stay && typeof b.stay === 'object') {
      Object.assign(upd, stayCols(b.stay)); history.push(entry(who, 'attached', stayLine(b.stay)))
    }
    if (b.status !== undefined) {
      const s = str(b.status)
      if (!(STATUSES as readonly string[]).includes(s)) return NextResponse.json({ ok: false, error: 'Bad status' }, { status: 400 })
      if (s !== cur.status) {
        upd.status = s
        if (s === 'contacted' && !cur.contacted_at) upd.contacted_at = new Date().toISOString()
        upd.resolved_at = RESOLVED.includes(s) ? new Date().toISOString() : null
        history.push(entry(who, 'status', cur.status + ' → ' + s + (b.note ? ': ' + str(b.note).trim().slice(0, 500) : '')))
      }
    }
    if (b.note && b.status === undefined) history.push(entry(who, 'note', str(b.note).trim().slice(0, 1000)))
    for (const [k, col, max] of [['contactNote', 'contact_note', 1000], ['shippingCarrier', 'shipping_carrier', 60], ['tracking', 'tracking', 120], ['storageLocation', 'storage_location', 200], ['description', 'description', 2000], ['foundWhere', 'found_where', 200], ['foundBy', 'found_by', 120], ['notes', 'notes', 4000], ['item', 'item', 160]] as [string, string, number][]) {
      if (b[k] !== undefined) upd[col] = str(b[k]).trim().slice(0, max) || null
    }
    if (b.category !== undefined && (CATEGORIES as readonly string[]).includes(str(b.category))) upd.category = str(b.category)
    if (b.shippingCost !== undefined) upd.shipping_cost = num(b.shippingCost)
    if (b.shippingPaid !== undefined) upd.shipping_paid = !!b.shippingPaid
    if (Array.isArray(b.addPhotos)) upd.photos = [...(Array.isArray(cur.photos) ? cur.photos : []), ...b.addPhotos.filter((x: any) => typeof x === 'string')].slice(0, 12)
    if (Object.keys(upd).length === 0 && history.length === (Array.isArray(cur.history) ? cur.history.length : 0)) return NextResponse.json({ ok: true, item: cur })
    upd.history = history.slice(-60); upd.updated_at = new Date().toISOString()
    const { data, error } = await db.from('lost_found_items').update(upd).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, item: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

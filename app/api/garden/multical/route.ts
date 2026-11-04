// GARDEN MULTI-CALENDAR (Jon, 2026-11-04: "Should have a multi calendar view"). One read for the
// Rooms view on /garden/calendar: every room under its room type, the type's availability and rate
// per night (garden_calendar), the reservations and room blocks overlapping the window.
//
//   GET ?from=YYYY-MM-DD&days=N   (from defaults to today in the hotel's zone; days 1–62, default 14)
//   → { ok, from, to, dates, today, types, rooms, reservations, blocks, channels, status, warnings }
//
// Select defensively: the rooms' housekeeping columns (170) and garden_room_blocks may not exist on
// every database yet — a missing piece becomes a warning, never a failed page.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireGarden } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

const TZ = 'America/New_York'
const isYmd = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'))
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const arr = (v: any): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v ? (v.startsWith('{') ? v.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')).filter(Boolean) : [v]) : []
const num = (v: any) => v == null || v === '' || isNaN(Number(v)) ? null : Number(v)
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(String(e?.message || e || ''))

/** Room type(s) a reservation was booked into, from Cloudbeds' raw rooms / unassigned lists. */
function typesOf(rooms: any, unassigned: any, rawType: any): string[] {
  const out = new Set<string>()
  for (const list of [rooms, unassigned]) if (Array.isArray(list)) for (const r of list) { const t = r?.roomTypeID ?? r?.roomTypeId; if (t != null && t !== '') out.add(String(t)) }
  if (rawType != null && rawType !== '') out.add(String(rawType))
  return Array.from(out)
}

export async function GET(req: NextRequest) {
  const gate = await requireGarden('calendar', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const from = isYmd(sp.get('from')) ? sp.get('from')! : today
  const days = Math.min(62, Math.max(1, Math.round(Number(sp.get('days')) || 14)))
  const to = addDays(from, days - 1)
  const dates: string[] = []; for (let i = 0; i < days; i++) dates.push(addDays(from, i))
  const db = supabaseAdmin()
  const warnings: string[] = []

  try {
    // ROOMS — try the 170 columns, fall back to the 115 ones.
    let rooms: any[] = []
    {
      const full = await db.from('garden_rooms').select('id,name,room_type_id,room_type,hk_status,occupied,status,housekeeper,blocked,floor').or('raw->>isVirtual.is.null,raw->>isVirtual.eq.false').limit(2000)
      if (full.error) {
        const base = await db.from('garden_rooms').select('id,name,room_type_id,room_type,hk_status,occupied,status').or('raw->>isVirtual.is.null,raw->>isVirtual.eq.false').limit(2000)
        if (base.error) throw base.error
        rooms = (base.data || []) as any[]
      } else rooms = (full.data || []) as any[]
    }

    // CALENDAR — one row per room type × night.
    const cal = await db.from('garden_calendar').select('room_type_id,room_type,date,available,total,rate,rate_plan,min_stay,closed').gte('date', from).lte('date', to).limit(20000)
    if (cal.error) { if (missing(cal.error)) warnings.push('garden_calendar is missing — run migration 118_garden_unit.sql.'); else throw cal.error }

    // RESERVATIONS overlapping [from, to]: arrive on or before the last night, leave after the first.
    // Paged past PostgREST's 1,000-row cap. Only the room lists come out of raw, not the whole blob.
    const resRows: any[] = []
    let withRaw = true
    for (let page = 0; page < 10; page++) {
      const cols = 'id,status,guest_name,check_in,check_out,nights,room_ids,room_names,source,total,balance,adults,children' + (withRaw ? ',raw_rooms:raw->rooms,raw_unassigned:raw->unassigned,raw_type:raw->roomTypeID' : '')
      const q = await db.from('garden_reservations').select(cols).lte('check_in', to).gt('check_out', from).neq('status', 'canceled').order('check_in').range(page * 1000, page * 1000 + 999)
      if (q.error) {
        if (withRaw && page === 0) { withRaw = false; page = -1; continue }
        throw q.error
      }
      const got = (q.data || []) as any[]
      resRows.push(...got)
      if (got.length < 1000) break
    }
    const reservations = resRows
      .filter(r => String(r.status || '').toLowerCase() !== 'cancelled')
      .map(r => {
        const nights = num(r.nights) ?? (r.check_in && r.check_out ? Math.max(0, Math.round((Date.parse(r.check_out) - Date.parse(r.check_in)) / 864e5)) : null)
        return {
          id: String(r.id), status: String(r.status || 'confirmed').toLowerCase(), guest_name: r.guest_name || null,
          check_in: r.check_in, check_out: r.check_out, nights,
          room_ids: arr(r.room_ids), room_names: arr(r.room_names),
          room_type_ids: typesOf(r.raw_rooms, r.raw_unassigned, r.raw_type),
          source: r.source || null, total: num(r.total), balance: num(r.balance), adults: num(r.adults), children: num(r.children),
        }
      })

    // BLOCKS (migration 170) — optional.
    let blocks: any[] = []
    {
      const b = await db.from('garden_room_blocks').select('id,room_ids,room_names,kind,reason,start_date,end_date').lte('start_date', to).gte('end_date', from).limit(5000)
      if (b.error) { if (!missing(b.error)) warnings.push('Room blocks: ' + b.error.message) }
      else blocks = (b.data || []).map((x: any) => ({ id: String(x.id), room_ids: arr(x.room_ids), room_names: arr(x.room_names), kind: x.kind || null, reason: x.reason || null, start_date: x.start_date, end_date: x.end_date || x.start_date }))
    }

    // ROOM TYPES — every type a room or a calendar row names, with its nights in the window.
    const types = new Map<string, { id: string; name: string; units: number; total: number | null; days: Record<string, { available: number | null; rate: number | null; closed: boolean; min_stay: number | null }> }>()
    const typeOf = (id: string, name?: string | null) => {
      let t = types.get(id)
      if (!t) { t = { id, name: name || id, units: 0, total: null, days: {} }; types.set(id, t) }
      else if (name && t.name === id) t.name = name
      return t
    }
    for (const r of rooms) typeOf(String(r.room_type_id ?? '—'), r.room_type || (r.room_type_id ? null : 'No room type')).units++
    for (const c of (cal.data || []) as any[]) {
      const t = typeOf(String(c.room_type_id), c.room_type)
      if (c.total != null) t.total = Number(c.total)
      t.days[c.date] = { available: num(c.available), rate: num(c.rate), closed: !!c.closed, min_stay: num(c.min_stay) }
    }

    const [{ data: channels }, { data: status }] = await Promise.all([
      db.from('garden_channels').select('name,status').order('name'),
      db.from('garden_sync_status').select('*').in('entity', ['rooms', 'reservations', 'calendar', 'blocks']),
    ])
    const channelNames = Array.from(new Set([...((channels || []) as any[]).map(c => String(c.name || '')), ...reservations.map(r => r.source || '')].filter(Boolean))).sort((a, b) => a.localeCompare(b))

    const coll = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' })
    return NextResponse.json({
      ok: true, from, to, today, days, dates,
      types: Array.from(types.values()).sort((a, b) => coll.compare(a.name, b.name)),
      rooms: rooms.map(r => ({
        id: String(r.id), name: String(r.name || r.id), room_type_id: String(r.room_type_id ?? '—'), room_type: r.room_type || null,
        hk_status: r.hk_status || null, occupied: r.occupied ?? null, status: r.status || null,
        housekeeper: r.housekeeper ?? null, blocked: r.blocked ?? null, floor: r.floor ?? null,
      })).sort((a, b) => coll.compare(a.name, b.name)),
      reservations, blocks, channels: channelNames, status: status || [], warnings,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) })
  }
}

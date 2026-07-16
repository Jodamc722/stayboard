// Salato front-desk view — arrivals (check-in prep), departure cleans, and active in-house guests
// for the Salato building, with rich Guesty reservation detail (ETA, car, guest info, notes) plus a
// TEAM NOTES section the front desk can append to. Internal (auth-gated) because it exposes guest PII.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SALATO = /salato/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
const LIVE = /confirm|checked/i

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const start = addDays(today, -1)
    const end = addDays(today, 14)
    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building')
    const match: Record<string, string> = {}
    for (const l of (listings || []) as any[]) { const name = l.nickname || l.title || 'Unit'; if (SALATO.test(str(l.building)) || SALATO.test(name)) match[String(l.id)] = name }
    const ids = Object.keys(match)
    if (!ids.length) return NextResponse.json({ ok: true, today, arrivals: [], departures: [], active: [], note: 'No Salato listings matched.' })
    const { data: res } = await db.from('guesty_reservations').select('id,listing_id,guest_name,check_in,check_out,nights,status,source,raw').in('listing_id', ids).lte('check_in', end).gte('check_out', start).limit(600)
    // team notes for these reservations (best-effort; table may not exist yet)
    const notesByRes: Record<string, any[]> = {}
    try {
      const resIds = ((res || []) as any[]).map(r => String(r.id))
      if (resIds.length) {
        const { data: tn } = await db.from('salato_notes').select('id,reservation_id,author,body,created_at').in('reservation_id', resIds).order('created_at', { ascending: true })
        for (const n of (tn || []) as any[]) { const k = String(n.reservation_id); (notesByRes[k] = notesByRes[k] || []).push({ id: String(n.id), author: n.author || 'Team', body: n.body || '', at: n.created_at }) }
      }
    } catch (e) { console.error('salato notes fetch', e) }
    function detail(r: any) {
      const raw = r.raw || {}
      const guest = raw.guest || {}
      const cf = Array.isArray(raw.customFields) ? raw.customFields : []
      const custom: any[] = []
      for (const c of cf) { const val = c?.value; if (val == null || val === '') continue; const fld = (c.fieldId && typeof c.fieldId === 'object') ? (c.fieldId.displayName || c.fieldId.name || c.fieldId.key) : null; custom.push({ field: fld || 'Field', value: String(val) }) }
      const gnotes: string[] = []
      if (raw.notes) { if (typeof raw.notes === 'string') gnotes.push(raw.notes); else if (typeof raw.notes === 'object') { for (const k of Object.keys(raw.notes)) { const nv = raw.notes[k]; if (nv && typeof nv === 'string' && nv.trim()) gnotes.push(nv.trim()) } } }
      const guests = raw.guestsCount ?? raw.numberOfGuests ?? (raw.guests && typeof raw.guests === 'object' ? (Number(raw.guests.adults || 0) + Number(raw.guests.children || 0)) || null : null)
      return {
        id: String(r.id), unit: match[String(r.listing_id)] || 'Unit', listingId: String(r.listing_id),
        guest: r.guest_name || raw.guestName || guest.fullName || [guest.firstName, guest.lastName].filter(Boolean).join(' ') || null,
        phone: guest.phone || raw.phone || null, email: guest.email || null,
        checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), nights: r.nights ?? null,
        checkInTime: raw.checkInDateLocalized ? String(raw.checkInDateLocalized).slice(11, 16) : null,
        plannedArrival: raw.plannedArrival || null,
        guests, source: r.source || raw.source || (raw.integration && raw.integration.platform) || null,
        confirmationCode: raw.confirmationCode || null,
        createdAt: raw.createdAt || raw.lastUpdatedAt || null,
        guestNotes: gnotes, custom, teamNotes: notesByRes[String(r.id)] || [], status: r.status,
      }
    }
    const all = ((res || []) as any[]).filter(r => LIVE.test(str(r.status))).map(detail)
    const arrivals = all.filter(r => r.checkIn >= today && r.checkIn <= end).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
    const departures = all.filter(r => r.checkOut >= today && r.checkOut <= end).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.unit.localeCompare(b.unit))
    const active = all.filter(r => r.checkIn <= today && r.checkOut > today).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.unit.localeCompare(b.unit))
    return NextResponse.json({ ok: true, today, start, end, unitCount: ids.length, arrivals, departures, active })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// Add a team note to a reservation.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const reservationId = str(body.reservationId).trim()
    const text = str(body.body).trim().slice(0, 2000)
    if (!reservationId || !text) return NextResponse.json({ error: 'reservationId and body required' }, { status: 400 })
    const author = str(body.author).trim() || user.email || 'Team'
    const db = supabaseAdmin()
    const { data, error } = await db.from('salato_notes').insert({ reservation_id: reservationId, unit: str(body.unit).slice(0, 120) || null, author, body: text }).select('id,reservation_id,author,body,created_at').single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, note: { id: String(data.id), author: data.author, body: data.body, at: data.created_at } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// PUBLIC, PII-SAFE Salato board data (sendable link like the vendor links).
// No guest names / phone / email / notes / plates — only unit, dates, times, guest count, source, SDT.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SALATO = /salato/i
const LIVE = /confirm|checked/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const start = addDays(today, -1)
    const end = addDays(today, 14)
    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building')
    const match: Record<string, string> = {}
    for (const l of (listings || []) as any[]) { const name = l.nickname || l.title || 'Unit'; if (SALATO.test(str(l.building)) || SALATO.test(name)) match[String(l.id)] = name }
    const ids = Object.keys(match)
    if (!ids.length) return NextResponse.json({ ok: true, today, arrivals: [], departures: [], active: [] })
    const { data: res } = await db.from('guesty_reservations').select('id,listing_id,check_in,check_out,nights,status,source,raw').in('listing_id', ids).lte('check_in', end).gte('check_out', start).limit(600)
    const toRow = (r: any) => {
      const raw = r.raw || {}
      const checkInTime = raw.checkInDateLocalized ? String(raw.checkInDateLocalized).slice(11, 16) : (raw.plannedArrival ? String(raw.plannedArrival) : null)
      const checkOutTime = raw.checkOutDateLocalized ? String(raw.checkOutDateLocalized).slice(11, 16) : null
      const guests = raw.guestsCount ?? raw.numberOfGuests ?? null
      return { unit: match[String(r.listing_id)] || 'Unit', checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), nights: r.nights ?? null, checkInTime, checkOutTime, guests, source: r.source || raw.source || null, sameDayTurn: false }
    }
    const rows = ((res || []) as any[]).filter(r => LIVE.test(str(r.status))).map(toRow)
    const arrivals = rows.filter(r => r.checkIn >= today && r.checkIn <= end).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
    const departures = rows.filter(r => r.checkOut >= today && r.checkOut <= end).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.unit.localeCompare(b.unit))
    const active = rows.filter(r => r.checkIn <= today && r.checkOut > today).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.unit.localeCompare(b.unit))
    const arrKey = new Set(arrivals.map(a => a.unit + '|' + a.checkIn))
    for (const d of departures) d.sameDayTurn = arrKey.has(d.unit + '|' + d.checkOut)
    return NextResponse.json({ ok: true, today, start, end, unitCount: ids.length, arrivals, departures, active })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

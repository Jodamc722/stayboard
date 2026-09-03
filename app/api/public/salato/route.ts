// PUBLIC, PII-SAFE Salato board data (sendable link like the vendor links).
// No guest names / phone / email / notes / plates — only unit, dates, times, guest count, source, SDT.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { salatoListings } from '@/lib/salato-units'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LIVE = /confirm|checked/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  // GATED (2026-09-03). This feed is fifteen days of unit-level occupancy — which units are empty
  // tonight — and it answered anyone who had the URL. Same team share password + cookie as the
  // vendor boards and the ID viewer on this very page. Fail closed.
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const start = addDays(today, -1)
    const end = addDays(today, 14)
    // WHICH units are Salato is an editable set (lib/salato-units) — the team adds new buildings
    // at /salato → Units without a code change; unset = the old name rule.
    const { match, ids } = await salatoListings(db)
    if (!ids.length) return NextResponse.json({ ok: true, today, arrivals: [], departures: [], active: [] })
    // Only the raw fields this board reads — the full `raw` for 600 bookings was megabytes on a phone.
    const { data: res } = await db.from('guesty_reservations')
      .select('id,listing_id,check_in,check_out,nights,status,source,ciLocal:raw->>checkInDateLocalized,coLocal:raw->>checkOutDateLocalized,planned:raw->>plannedArrival,g1:raw->>guestsCount,g2:raw->>numberOfGuests,rawSource:raw->>source')
      .in('listing_id', ids).lte('check_in', end).gte('check_out', start).order('id').limit(1000)
    const toRow = (r: any) => {
      const checkInTime = r.ciLocal ? String(r.ciLocal).slice(11, 16) : (r.planned ? String(r.planned) : null)
      const checkOutTime = r.coLocal ? String(r.coLocal).slice(11, 16) : null
      const gRaw = r.g1 ?? r.g2
      const guests = gRaw == null || gRaw === '' ? null : Number(gRaw)
      return { id: String(r.id), unit: match[String(r.listing_id)] || 'Unit', checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), nights: r.nights ?? null, checkInTime, checkOutTime, guests, source: r.source || r.rawSource || null, sameDayTurn: false, verified: false, verifiedAt: null as string | null }
    }
    const rows = ((res || []) as any[]).filter(r => LIVE.test(str(r.status))).map(toRow)
    const arrivals = rows.filter(r => r.checkIn >= today && r.checkIn <= end).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
    const departures = rows.filter(r => r.checkOut >= today && r.checkOut <= end).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.unit.localeCompare(b.unit))
    const active = rows.filter(r => r.checkIn <= today && r.checkOut > today).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.unit.localeCompare(b.unit))
    const arrKey = new Set(arrivals.map(a => a.unit + '|' + a.checkIn))
    for (const d of departures) d.sameDayTurn = arrKey.has(d.unit + '|' + d.checkOut)
    // Verification status (from app_settings key sv:<reservationId>) for the rows a front desk verifies:
    // arrivals (before/at check-in) and in-house guests. Status only — no photos on this public endpoint.
    const wantIds: string[] = []
    for (const r of arrivals) if (wantIds.indexOf(r.id) < 0) wantIds.push(r.id)
    for (const r of active) if (wantIds.indexOf(r.id) < 0) wantIds.push(r.id)
    if (wantIds.length) {
      const keys = wantIds.map(id => 'sv:' + id)
      const { data: sv } = await db.from('app_settings').select('key,value').in('key', keys)
      const vmap: Record<string, string> = {}
      for (const rowv of (sv || []) as any[]) { const id = String(rowv.key).slice(3); if (rowv.value) { try { const j = JSON.parse(rowv.value); if (j && j.status === 'verified') vmap[id] = str(j.signedAt) } catch {} } }
      for (const r of arrivals) { if (vmap[r.id] !== undefined) { r.verified = true; r.verifiedAt = vmap[r.id] || null } }
      for (const r of active) { if (vmap[r.id] !== undefined) { r.verified = true; r.verifiedAt = vmap[r.id] || null } }
    }
    return NextResponse.json({ ok: true, today, start, end, unitCount: ids.length, arrivals, departures, active })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

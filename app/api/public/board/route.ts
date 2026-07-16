// PUBLIC, PII-SAFE weekly board for vendors + Salato front desk.
// Arrivals / Departure cleans / Active reservations for one scope's listings.
// No guest names / phone / email / notes — unit, dates, times, bedrooms, door code, guest count, source.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SCOPES: Record<string, { label: string; re: RegExp }> = {
  botanica: { label: 'Botanica', re: /botanica/i },
  pt: { label: 'Park Towers', re: /park\s*towers?|\bpt\b/i },
  'amrit-capri-lucerne': { label: 'Amrit / Capri / Lucerne', re: /amrit|capri|lucerne/i },
  salato: { label: 'Salato', re: /salato/i },
}
const LIVE = /confirm|checked/i
const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'
// Per-reservation access code (changes per stay) — this is the code valid on that day.
const RES_CODE_FIELD = '693adec2ab73940025856e56'
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function hhmm(v: any): string { const s = v ? String(v) : ''; return s.length >= 16 ? s.slice(11, 16) : '' }
function timeET(iso: any): string { if (!iso) return ''; const d = new Date(String(iso)); if (isNaN(d.getTime())) return ''; return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) }
function cfValue(raw: any, fieldId: string): string | null {
  const arr = Array.isArray(raw?.customFields) ? raw.customFields : []
  for (const c of arr) { const fid = typeof c?.fieldId === 'object' ? c?.fieldId?._id : c?.fieldId; if (String(fid) === fieldId) return c?.value != null ? String(c.value) : null }
  return null
}

export async function GET(req: NextRequest) {
  const v = String(new URL(req.url).searchParams.get('v') || '').toLowerCase()
  const scope = SCOPES[v]
  if (!scope) return NextResponse.json({ ok: false, error: 'Unknown link' }, { status: 404 })
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const start = addDays(today, -1)
    const end = addDays(today, 6)
    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building,bedrooms,cfRaw:raw->customFields,coRaw:raw->>defaultCheckOutTime,ciRaw:raw->>defaultCheckInTime')
    const match: Record<string, { name: string; bedrooms: number | null; doorCode: string | null; checkOutTime: string | null; checkInTime: string | null }> = {}
    for (const l of (listings || []) as any[]) {
      const name = l.nickname || l.title || 'Unit'
      if (scope.re.test(str(l.building)) || scope.re.test(name)) {
        match[String(l.id)] = { name, bedrooms: l.bedrooms ?? null, doorCode: cfValue({ customFields: l.cfRaw }, DOOR_CODE_FIELD), checkOutTime: l.coRaw || null, checkInTime: l.ciRaw || null }
      }
    }
    const ids = Object.keys(match)
    if (!ids.length) return NextResponse.json({ ok: true, label: scope.label, today, start, end, unitCount: 0, arrivals: [], departures: [], active: [] })
    const { data: res } = await db.from('guesty_reservations').select('id,listing_id,guest_name,guest_phone,check_in,check_out,nights,status,source,confirmation_code,notes,custom_fields,raw').in('listing_id', ids).lte('check_in', end).gte('check_out', start).limit(1000)
    const live = ((res || []) as any[]).filter(r => LIVE.test(str(r.status)))
    const arrKey: Record<string, boolean> = {}
    for (const r of live) arrKey[String(r.listing_id) + '|' + str(r.check_in).slice(0, 10)] = true
    const row = (r: any) => {
      const m = match[String(r.listing_id)]
      const raw = r.raw || {}
      const ci = str(r.check_in).slice(0, 10)
      const co = str(r.check_out).slice(0, 10)
      // Code valid on THIS stay's day: the reservation's own access code, else the listing's static code.
      const resCode = cfValue({ customFields: Array.isArray(r.custom_fields) && r.custom_fields.length ? r.custom_fields : raw.customFields }, RES_CODE_FIELD)
      return {
        listingId: String(r.listing_id), extended: false, extendedTo: null as string | null,
        unit: m ? m.name : 'Unit', checkIn: ci, checkOut: co, nights: r.nights ?? null,
        bedrooms: m ? m.bedrooms : null, doorCode: resCode || (m ? m.doorCode : null),
        guestName: r.guest_name || null, phone: r.guest_phone || null,
        confirmationCode: r.confirmation_code || null,
        notes: r.notes ? String(r.notes) : null,
        checkInTime: hhmm(raw.checkInDateLocalized) || timeET(raw.checkIn) || (m && m.checkInTime) || null,
        checkOutTime: hhmm(raw.checkOutDateLocalized) || timeET(raw.checkOut) || (m && m.checkOutTime) || '11:00',
        guests: raw.guestsCount ?? raw.numberOfGuests ?? null,
        source: r.source || raw.source || null,
        sameDayTurn: !!arrKey[String(r.listing_id) + '|' + co],
      }
    }
    const all = live.map(row)
    const byUnitDate = (a: any, b: any) => a.unit.localeCompare(b.unit)
    const arrivals = all.filter(r => r.checkIn >= today && r.checkIn <= end).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || byUnitDate(a, b))
    const seen: Record<string, boolean> = {}
    const departures = all.filter(r => {
      if (!(r.checkOut >= today && r.checkOut <= end)) return false
      const k = r.unit + '|' + r.checkOut
      if (seen[k]) return false
      seen[k] = true
      return true
    }).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || byUnitDate(a, b))
    const active = all.filter(r => r.checkIn <= today && r.checkOut > today).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || byUnitDate(a, b))
    // EXTENSION GUARD (walk-in prevention): Breezeway still has a clean scheduled on a day, but the
    // guest's stay now runs past it — i.e. they extended. Surface it so nobody cleans an occupied unit.
    const depSet: Record<string, boolean> = {}
    for (const dp of departures) depSet[dp.listingId + '|' + dp.checkOut] = true
    const { data: bz } = await db.from('breezeway_tasks_sync').select('reference_property_id,scheduled_date,status').eq('type_department', 'housekeeping').in('reference_property_id', ids).gte('scheduled_date', today).lte('scheduled_date', end).limit(1000)
    for (const t of (bz || []) as any[]) {
      const lid = String(t.reference_property_id)
      const dd = str(t.scheduled_date).slice(0, 10)
      if (!match[lid] || !dd) continue
      if (depSet[lid + '|' + dd]) continue
      if (/complete|cancel/i.test(str(t.status))) continue
      // guest still in-house on the day the clean is scheduled => the stay was extended past it
      const stay = live.find((r: any) => String(r.listing_id) === lid && str(r.check_in).slice(0, 10) <= dd && str(r.check_out).slice(0, 10) > dd)
      if (!stay) continue
      const base = row(stay)
      departures.push(Object.assign({}, base, { checkOut: dd, sameDayTurn: false, extended: true, extendedTo: str(stay.check_out).slice(0, 10) }))
      depSet[lid + '|' + dd] = true
    }
    departures.sort((a, b) => a.checkOut.localeCompare(b.checkOut) || (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || a.unit.localeCompare(b.unit))
    return NextResponse.json({ ok: true, label: scope.label, today, start, end, unitCount: ids.length, arrivals, departures, active })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// PUBLIC, PII-SAFE weekly board for vendors + Salato front desk.
// Arrivals / Departure cleans / Active reservations for one scope's listings.
// No guest names / phone / email / notes — unit, dates, times, bedrooms, door code, guest count, source.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { customFieldNameMap } from '@/lib/custom-fields'

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
// Two-way notes live in Guesty's "reservation_notes" custom field (welcome-call writes it too).
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'
// Any custom field whose NAME contains "code" is an access secret — never dumped in the generic list.
const isCodeField = (name: string) => /code/i.test(name)
// Internal/tracking fields (QC flags, OTA ids, sync markers) — not useful to a vendor, kept off the board.
const isInternalField = (name: string) => /sensitive|verified|booking_call|welcome|_id$|confirmation_number|_email_sent|added_to_app|date_of_last|asana|breezeway|glitch/i.test(name)
function prettyLabel(s: string): string { return String(s || '').replace(/[_/]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim() }
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
    const farEnd = addDays(today, 30)
    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building,bedrooms,pictures,cfRaw:raw->customFields,coRaw:raw->>defaultCheckOutTime,ciRaw:raw->>defaultCheckInTime')
    const match: Record<string, { name: string; bedrooms: number | null; doorCode: string | null; checkOutTime: string | null; checkInTime: string | null }> = {}
    const bannerCands: { name: string; url: string; count: number; full: boolean }[] = []
    for (const l of (listings || []) as any[]) {
      const name = l.nickname || l.title || 'Unit'
      if (scope.re.test(str(l.building)) || scope.re.test(name)) {
        match[String(l.id)] = { name, bedrooms: l.bedrooms ?? null, doorCode: cfValue({ customFields: l.cfRaw }, DOOR_CODE_FIELD), checkOutTime: l.coRaw || null, checkInTime: l.ciRaw || null }
        // Photos live on the mirror as an array of URL strings (see lib/guesty pictures map).
        const pics = Array.isArray(l.pictures) ? l.pictures.filter((p: any) => typeof p === 'string' && p.indexOf('https://') === 0) : []
        if (pics.length) bannerCands.push({ name, url: str(pics[0]), count: pics.length, full: /\bfull\b/i.test(name) })
      }
    }
    // Banner photo for this scope: prefer a "Full"/building hero, then the listing with the most photos.
    bannerCands.sort((a, b) => (a.full === b.full ? 0 : a.full ? -1 : 1) || b.count - a.count)
    const autoBanner = bannerCands.length ? bannerCands[0].url : null
    const seenBanner = new Set<string>()
    const bannerOptions: { name: string; url: string }[] = []
    for (const c of bannerCands) { if (seenBanner.has(c.url)) continue; seenBanner.add(c.url); bannerOptions.push({ name: c.name, url: c.url }); if (bannerOptions.length >= 12) break }
    // A saved pick (app_settings key 'banner_overrides') wins over the auto-pick, for everyone on the link.
    let bannerOverride: string | null = null
    try {
      const { data: bo } = await db.from('app_settings').select('value').eq('key', 'banner_overrides').limit(1)
      const row: any = Array.isArray(bo) ? bo[0] : null
      if (row && row.value) { const j = JSON.parse(row.value); const u = j && typeof j === 'object' ? j['board:' + v] : null; if (typeof u === 'string' && u) bannerOverride = u }
    } catch {}
    const bannerImage = bannerOverride || autoBanner
    const ids = Object.keys(match)
    if (!ids.length) return NextResponse.json({ ok: true, label: scope.label, today, start, end, unitCount: 0, bannerImage, bannerOverride, bannerOptions, arrivals: [], departures: [], active: [], upcoming: [] })
    // custom-field id -> human name (for the parking / details list). Resolves from the table first,
    // falls back to Guesty's live definitions, cached 1h — so names work even if the table is unpopulated.
    const cfNameById = await customFieldNameMap()
    // Pull reservations touching [start, farEnd] (a 30-day horizon so we can also show what's upcoming),
    // paged to clear the 1000-row cap on bigger scopes.
    let resAll: any[] = []
    for (let p = 0; p < 6; p++) {
      const { data } = await db.from('guesty_reservations').select('id,listing_id,guest_name,guest_phone,check_in,check_out,nights,status,source,confirmation_code,notes,custom_fields,raw').in('listing_id', ids).lte('check_in', farEnd).gte('check_out', start).range(p * 1000, p * 1000 + 999)
      if (!data || !data.length) break
      resAll = resAll.concat(data)
      if (data.length < 1000) break
    }
    const live = resAll.filter(r => LIVE.test(str(r.status)))
    const arrKey: Record<string, boolean> = {}
    for (const r of live) arrKey[String(r.listing_id) + '|' + str(r.check_in).slice(0, 10)] = true
    const row = (r: any) => {
      const m = match[String(r.listing_id)]
      const raw = r.raw || {}
      const ci = str(r.check_in).slice(0, 10)
      const co = str(r.check_out).slice(0, 10)
      // Code valid on THIS stay's day: the reservation's own access code, else the listing's static code.
      const resCode = cfValue({ customFields: Array.isArray(r.custom_fields) && r.custom_fields.length ? r.custom_fields : raw.customFields }, RES_CODE_FIELD)
      // All non-secret custom fields (parking, plate, amenities, etc.) + the two-way reservation_notes value.
      const cfArr: any[] = Array.isArray(r.custom_fields) && r.custom_fields.length ? r.custom_fields : (Array.isArray(raw.customFields) ? raw.customFields : [])
      const customFields: { label: string; value: string }[] = []
      let resNotes = ''
      for (const c of cfArr) {
        const fid = typeof c?.fieldId === 'object' ? c?.fieldId?._id : c?.fieldId
        const val = c?.value == null ? '' : String(c.value)
        if (!val) continue
        const nm = cfNameById[String(fid)] || String(c?.fieldName || '')
        if (String(fid) === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(nm)) { resNotes = val; continue }
        if (!nm || isCodeField(nm) || isInternalField(nm) || String(fid) === DOOR_CODE_FIELD || String(fid) === RES_CODE_FIELD) continue
        customFields.push({ label: prettyLabel(nm), value: val })
      }
      return {
        id: String(r.id), customFields, resNotes,
        listingId: String(r.listing_id), extended: false, extendedTo: null as string | null, cleanDay: null as string | null,
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
      // ALL upcoming departure cleans (today out to the 30-day horizon), not just this week —
      // otherwise a checkout a day past the week (e.g. Salato Briana 07-29) silently disappears.
      if (!(r.checkOut >= today && r.checkOut <= farEnd)) return false
      const k = r.unit + '|' + r.checkOut
      if (seen[k]) return false
      seen[k] = true
      return true
    }).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || byUnitDate(a, b))
    const active = all.filter(r => r.checkIn <= today && r.checkOut > today).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || byUnitDate(a, b))
    // Future arrivals beyond this week, out to the 30-day horizon (front desk wants to see what's coming).
    const upcoming = all.filter(r => r.checkIn > end && r.checkIn <= farEnd).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || byUnitDate(a, b))
    // EXTENSION GUARD (walk-in prevention): Breezeway still has a clean scheduled on a day, but the
    // guest's stay now runs past it — i.e. they extended. Surface it so nobody cleans an occupied unit.
    const depSet: Record<string, boolean> = {}
    for (const dp of departures) depSet[dp.listingId + '|' + (dp.cleanDay || dp.checkOut)] = true
    // Reservation identity (confirmation code, else listing+dates). Only ONE extended row per
    // reservation: if several stale cleans overlap one extended stay we flag the first and skip the rest,
    // so a guest can never pile up as 3+ rows. (Real departure + a single extension row IS intended.)
    const resKeyOf = (r: any) => String(r.confirmation_code || '') || (String(r.listing_id) + '|' + str(r.check_in).slice(0, 10) + '|' + str(r.check_out).slice(0, 10))
    const extAdded = new Set()
    const { data: bz } = await db.from('breezeway_tasks_sync').select('reference_property_id,scheduled_date,status').eq('type_department', 'housekeeping').in('reference_property_id', ids).gte('scheduled_date', today).lte('scheduled_date', end).limit(1000)
    for (const t of (bz || []) as any[]) {
      const lid = String(t.reference_property_id)
      const dd = str(t.scheduled_date).slice(0, 10)
      if (!match[lid] || !dd) continue
      if (depSet[lid + '|' + dd]) continue
      if (/complete|cancel/i.test(str(t.status))) continue
      // guest still in-house on the day the clean is scheduled => the stay was extended past it
      const stay = live.find((r: any) => String(r.listing_id) === lid && str(r.check_in).slice(0, 10) < dd && str(r.check_out).slice(0, 10) > dd)
      if (!stay) continue
      // at most one extended row per reservation, even if several stale cleans overlap the stay
      if (extAdded.has(resKeyOf(stay))) continue
      const base = row(stay)
      // keep checkIn/checkOut/nights as the ACTUAL (extended) reservation; cleanDay is only where it groups
      departures.push(Object.assign({}, base, { cleanDay: dd, sameDayTurn: false, extended: true, extendedTo: str(stay.check_out).slice(0, 10) }))
      depSet[lid + '|' + dd] = true
      extAdded.add(resKeyOf(stay))
    }
    departures.sort((a, b) => (a.cleanDay || a.checkOut).localeCompare(b.cleanDay || b.checkOut) || (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || a.unit.localeCompare(b.unit))
    // ACCESS-CODE POLICY: a code is only revealed on the day of that unit's departure clean.
    // Vendors must never hold codes ahead of time, so we strip them server-side (not just in the
    // UI) — otherwise they'd still leak via this JSON and the CSV export. Extended = occupied,
    // nobody should be going in, so no code there either.
    for (const r of arrivals) r.doorCode = null
    for (const r of active) r.doorCode = null
    for (const r of upcoming) r.doorCode = null
    for (const r of departures) { if ((r.cleanDay || r.checkOut) !== today || r.extended) r.doorCode = null }

    // when the reservation mirror was last pulled from Guesty (drives 'last synced' + the 30-min resync throttle)
    const { data: syncSt } = await db.from('guesty_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle()
    const lastSync = syncSt && syncSt.last_sync_at ? String(syncSt.last_sync_at) : null
    return NextResponse.json({ ok: true, label: scope.label, today, start, end, farEnd, unitCount: ids.length, bannerImage, bannerOverride, bannerOptions, lastSync, arrivals, departures, active, upcoming })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

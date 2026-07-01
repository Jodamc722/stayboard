// Turnover schedule — cleaning plan from CONFIRMED Guesty checkouts (each checkout = the departure
// clean Breezeway auto-creates). Day view (rich table) + weekly view (Sun-Saturday), grouped by
// market (Miami / Broward / North). Adds per clean: hub/building, bedrooms, check-in/out times,
// nights, same-day-turn, current DOOR CODE + a suggested NEW 4-digit code (blank for 17West, whose
// codes are managed elsewhere), and cleaning time. Read-only; assignment via /api/schedule/assign.
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf, type Market } from '@/lib/segments'
import { breezewayConfigured, listBreezewayPeople, listPropertyHousekeeping, pickDepartureClean } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Guesty custom-field IDs (customFields are {fieldId,value}; definitions aren't synced, so match by id).
const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'
const CLEANING_TIME_FIELD = '69977f98e346440013af2462'

const DEAD = /cancel|declin|inquir|expire|denied/i
const IS_17WEST = (s: string) => /17\s*west/i.test(s)
const VENDOR_OF = (s: string) => /botanica/i.test(s) ? 'Botanica' : null  // Botanica is cleaned by hotel staff (vendor), not our team
const NO_CODE = (s: string) => IS_17WEST(s) || /elser/i.test(s)  // 17West + Elser door codes are managed elsewhere — don't generate a new code
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function weekStartSunday(iso: string) { const d = new Date(iso + 'T12:00:00'); const dow = d.getDay(); d.setDate(d.getDate() - dow); return d.toISOString().slice(0, 10) }
const DAYLABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
// Deterministic suggested NEW 4-digit code (stable per unit+date so it doesn't change on refresh).
function newCode(seed: string): string { let h = 5381; for (let i = 0; i < seed.length; i++) h = ((h * 33) + seed.charCodeAt(i)) >>> 0; return String(1000 + (h % 9000)) }
function cfValue(raw: any, fieldId: string): string | null {
  const arr = Array.isArray(raw?.customFields) ? raw.customFields : []
  for (const c of arr) { const fid = typeof c?.fieldId === 'object' ? c?.fieldId?._id : c?.fieldId; if (String(fid) === fieldId) return c?.value != null ? String(c.value) : null }
  return null
}
// Roll a building name up to a hub label (Botanica 6102 -> Botanica, etc.).
function hubOf(building: string): string {
  const s = String(building || '').trim()
  if (!s) return 'Other'
  const m = s.match(/^([A-Za-z0-9'’.-]+(?:\s+[A-Za-z'’.-]+)?)/)
  const first = s.split(/\s+/)[0]
  if (/^\d/.test(first)) return s
  return first
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const view = sp.get('view') === 'week' ? 'week' : 'day'
  const today = ymd(new Date())
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') || '') ? sp.get('date')! : today
  const start = view === 'day' ? anchor : weekStartSunday(anchor)
  const end = view === 'day' ? anchor : addDays(start, 6)

  const compute = unstable_cache(async (view: string, start: string, end: string, today: string) => {
  const db = supabaseAdmin()
  const [{ data: outs }, { data: ins }, { data: listings }] = await Promise.all([
    db.from('guesty_reservations').select('listing_id,listing_name,guest_name,check_out,check_in,status,nights,source').gte('check_out', start).lte('check_out', end).limit(4000),
    db.from('guesty_reservations').select('listing_id,check_in,status').gte('check_in', start).lte('check_in', addDays(end, 30)).limit(8000),
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status,bedrooms,raw'),
  ])

  type Meta = { name: string; market: Market; hub: string; bedrooms: number | null; doorCode: string | null; cleaningTime: string | null; checkIn: string | null; checkOut: string | null; is17: boolean; noCode: boolean; vendor: string | null }
  const meta: Record<string, Meta> = {}
  for (const l of (listings || [])) {
    const id = String((l as any).id)
    const raw = (l as any).raw || {}
    const building = str((l as any).building)
    const name = (l as any).nickname || (l as any).title || 'Unit'
    meta[id] = {
      name,
      market: marketOf(building, (l as any).address_city, name),
      hub: hubOf(building) || 'Other',
      bedrooms: (l as any).bedrooms ?? null,
      doorCode: cfValue(raw, DOOR_CODE_FIELD),
      cleaningTime: cfValue(raw, CLEANING_TIME_FIELD),
      checkIn: raw?.defaultCheckInTime || null,
      checkOut: raw?.defaultCheckOutTime || null,
      is17: IS_17WEST(building) || IS_17WEST(name),
      noCode: NO_CODE(building) || NO_CODE(name),
      vendor: VENDOR_OF(building) || VENDOR_OF(name),
    }
  }

  const arrivalsByListing: Record<string, string[]> = {}
  for (const r of (ins || [])) {
    if (DEAD.test(str((r as any).status))) continue
    const id = String((r as any).listing_id); const ci = str((r as any).check_in).slice(0, 10)
    if (!ci) continue; (arrivalsByListing[id] ||= []).push(ci)
  }
  for (const k of Object.keys(arrivalsByListing)) arrivalsByListing[k].sort()

  type Clean = { listingId: string; unit: string; market: Market; hub: string; date: string; guestOut: string | null; nights: number | null; bedrooms: number | null; checkInTime: string | null; checkOutTime: string | null; sameDayTurn: boolean; nextArrival: string | null; doorCode: string | null; newDoorCode: string | null; cleaningTime: string | null; vendor: string | null; assignedIds: number[]; assignedNames: string[] }
  const cleans: Clean[] = []
  const seenClean = new Set<string>()
  for (const r of (outs || [])) {
    if (DEAD.test(str((r as any).status))) continue
    const id = String((r as any).listing_id)
    const date = str((r as any).check_out).slice(0, 10)
    if (!date) continue
    const dedupKey = `${id}__${date}`
    if (seenClean.has(dedupKey)) continue
    seenClean.add(dedupKey)
    const m = meta[id]
    const arrivals = arrivalsByListing[id] || []
    const sameDayTurn = arrivals.includes(date)
    const nextArrival = arrivals.find(a => a >= date) || null
    cleans.push({
      listingId: id,
      unit: m?.name || (r as any).listing_name || 'Unit',
      market: m?.market || 'Miami',
      hub: m?.hub || 'Other',
      date,
      guestOut: (r as any).guest_name || null,
      nights: (r as any).nights ?? null,
      bedrooms: m?.bedrooms ?? null,
      checkInTime: m?.checkIn || null,
      checkOutTime: m?.checkOut || null,
      sameDayTurn,
      nextArrival,
      doorCode: m?.doorCode || null,
      newDoorCode: m?.noCode ? null : newCode(id + date),
      cleaningTime: m?.cleaningTime || null,
      vendor: m?.vendor || null,
      assignedIds: [],
      assignedNames: [],
    })
  }

  // DAY view: look up each clean's CURRENT Breezeway departure-task assignee so the board shows who is
  // already assigned (not just who we stage). Bounded parallelism; skipped for week view (too many calls).
  if (view === 'day' && breezewayConfigured() && cleans.length) {
    const CONC = 8
    for (let i = 0; i < cleans.length; i += CONC) {
      await Promise.all(cleans.slice(i, i + CONC).map(async c => {
        try {
          const tasks = await listPropertyHousekeeping(c.listingId, c.date, c.date)
          const clean = pickDepartureClean(tasks, c.date)
          const ppl = (clean as any)?.assignees as { id: number | null; name: string | null }[] | undefined
          if (ppl && ppl.length) {
            c.assignedIds = ppl.map(p => Number(p.id)).filter(n => Number.isFinite(n))
            c.assignedNames = ppl.map(p => String(p.name || '')).filter(Boolean)
          }
        } catch { /* leave unassigned */ }
      }))
    }
  }

  const MARKETS: Market[] = ['Miami', 'Broward', 'North']
  const dayList: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) dayList.push(d)
  const days = dayList.map(date => {
    const dayCleans = cleans.filter(c => c.date === date).sort((a, b) => (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || a.hub.localeCompare(b.hub) || a.unit.localeCompare(b.unit))
    const markets: Record<string, Clean[]> = {}
    for (const m of MARKETS) markets[m] = dayCleans.filter(c => c.market === m)
    const d = new Date(date + 'T12:00:00')
    return { date, dow: DAYLABEL[d.getDay()], count: dayCleans.length, markets }
  })

  let housekeepers: { id: number; name: string; region: string | null }[] = []
  if (breezewayConfigured()) {
    try {
      const people = await listBreezewayPeople()
      housekeepers = people.filter(p => p.departments.length === 0 || p.departments.includes('housekeeping')).map(p => ({ id: p.id, name: p.name, region: p.region })).sort((a, b) => a.name.localeCompare(b.name))
    } catch { /* empty */ }
  }

    return {
      ok: true, view, today, weekStart: start, weekEnd: end,
      prev: view === 'day' ? addDays(start, -1) : addDays(start, -7),
      next: view === 'day' ? addDays(start, 1) : addDays(start, 7),
      totals: { cleans: cleans.length, byMarket: MARKETS.map(m => ({ market: m, count: cleans.filter(c => c.market === m).length })) },
      days, housekeepers, breezeway: breezewayConfigured(),
      syncedAt: new Date().toISOString(),
    }
  }, ['schedule-v1'], { tags: ['schedule'], revalidate: 86400 })

  const payload = await compute(view, start, end, today)
  return NextResponse.json(payload)
}

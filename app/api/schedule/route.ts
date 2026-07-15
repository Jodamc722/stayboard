// Turnover schedule — cleaning plan from CONFIRMED Guesty checkouts (each checkout = the departure
// clean Breezeway auto-creates). Day view (rich table) + weekly view (Sun-Saturday), grouped by
// market (Miami / Broward / North). Adds per clean: hub/building, bedrooms, check-in/out times,
// nights, same-day-turn, current DOOR CODE, and cleaning time. Read-only; assignment via /api/schedule/assign.
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache, revalidateTag } from 'next/cache'
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
const LIVE = /confirm|checked/i // ONLY confirmed/checked stays make cleans. NOT inquiry/reserved (holds) and NOT 'closed' (Guesty closed = released/replaced - verified with the Cindy/Rustic-18 phantom)
const IS_17WEST = (s: string) => /17\s*west/i.test(s)
const VENDOR_RE = /botanica|park\s*towers?|\bpt\b|amrit|capri|lucerne/i // vendor-cleaned buildings (hotel/vendor staff, not our team) - mirrors forecast API + ForecastBoard
const VENDOR_OF = (s: string) => { if (!VENDOR_RE.test(s)) return null; if (/botanica/i.test(s)) return 'Botanica'; if (/park\s*towers?|\bpt\b/i.test(s)) return 'Park Towers'; if (/amrit/i.test(s)) return 'Amrit'; if (/capri/i.test(s)) return 'Capri'; return 'Lucerne' }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const DAYLABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function cfValue(raw: any, fieldId: string): string | null {
const arr = Array.isArray(raw?.customFields) ? raw.customFields : []
for (const c of arr) { const fid = typeof c?.fieldId === 'object' ? c?.fieldId?._id : c?.fieldId; if (String(fid) === fieldId) return c?.value != null ? String(c.value) : null }
return null
}
// Roll a building name up to a hub label (Botanica 6102 -> Botanica, etc.).
function hubOf(building: string): string {
const s = String(building || '').trim()
if (!s) return 'Other'
const m = s.match(/^([A-Za-z0-9''.-]+(?:\s+[A-Za-z''.-]+)?)/)
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
const start = anchor // week = rolling next-7-days from the anchor (today on load)
const end = view === 'day' ? anchor : addDays(start, 6)

const compute = unstable_cache(async (view: string, start: string, end: string, today: string) => {
const db = supabaseAdmin()
const [{ data: outs }, { data: ins }, { data: listings }] = await Promise.all([
db.from('guesty_reservations').select('id,listing_id,listing_name,guest_name,check_out,check_in,status,nights,source').gte('check_out', start).lte('check_out', end).limit(4000),
db.from('guesty_reservations').select('listing_id,check_in,status').gte('check_in', start).lte('check_in', addDays(end, 30)).limit(8000),
// PERF: pull ONLY the raw sub-fields this route uses (customFields for door/cleaning codes +
// check-in/out times) instead of the full multi-MB raw blob for every listing.
db.from('guesty_listings').select('id,nickname,title,building,address_city,status,bedrooms,cfRaw:raw->customFields,ciRaw:raw->>defaultCheckInTime,coRaw:raw->>defaultCheckOutTime'),
])

// HARD GUARD: if the listings query hiccups, ABORT instead of caching a garbage snapshot
// (rows would render with hub 'Other', no bedrooms/door codes - worse than an error).
if (!listings || !listings.length) throw new Error('Listing data unavailable - hit Sync to retry.')

type Meta = { name: string; market: Market; hub: string; bedrooms: number | null; doorCode: string | null; cleaningTime: string | null; checkIn: string | null; checkOut: string | null; is17: boolean; vendor: string | null }
const meta: Record<string, Meta> = {}
const units: { id: string; name: string }[] = []
for (const l of (listings || [])) {
const id = String((l as any).id)
const raw = { customFields: (l as any).cfRaw, defaultCheckInTime: (l as any).ciRaw, defaultCheckOutTime: (l as any).coRaw }
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
vendor: VENDOR_OF(building) || VENDOR_OF(name),
}
if (!/inactive|disabled|archived|deleted/i.test(str((l as any).status))) units.push({ id, name })
}
units.sort((a, b) => a.name.localeCompare(b.name))

const arrivalsByListing: Record<string, string[]> = {}
for (const r of (ins || [])) {
if (!LIVE.test(str((r as any).status))) continue
const id = String((r as any).listing_id); const ci = str((r as any).check_in).slice(0, 10)
if (!ci) continue; (arrivalsByListing[id] ||= []).push(ci)
}
for (const k of Object.keys(arrivalsByListing)) arrivalsByListing[k].sort()

type Clean = { listingId: string; unit: string; market: Market; hub: string; date: string; guestOut: string | null; nights: number | null; bedrooms: number | null; checkInTime: string | null; checkOutTime: string | null; sameDayTurn: boolean; nextArrival: string | null; doorCode: string | null; cleaningTime: string | null; vendor: string | null; assignedIds: number[]; assignedNames: string[] ; reservationId?: string | null; syncStatus?: 'synced' | 'guesty-only'; breezewayTaskId?: string | null; breezewayReportUrl?: string | null; taskStatus?: 'created' | 'in_progress' | 'completed'; manual?: boolean; bzOnly?: boolean; taskDate?: string | null; movedTo?: string | null; movedFrom?: string | null; extended?: boolean; extendedFrom?: string | null; ghost?: boolean; blocked?: boolean; blockedFrom?: string | null; blockedUntil?: string | null; missing?: boolean; walkInRisk?: boolean; cleanMinutes?: number | null }
const cleans: Clean[] = []
const seenClean = new Set<string>()
for (const r of (outs || [])) {
if (!LIVE.test(str((r as any).status))) continue
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
guestOut: (r as any).guest_name || null, reservationId: String((r as any).id || '') || null,
nights: (r as any).nights ?? null,
bedrooms: m?.bedrooms ?? null,
checkInTime: m?.checkIn || null,
checkOutTime: m?.checkOut || null,
sameDayTurn,
nextArrival,
doorCode: m?.doorCode || null,
cleaningTime: m?.cleaningTime || null,
vendor: m?.vendor || null,
assignedIds: [],
assignedNames: [],
})
}

// PERF: fetch the webhook-live Breezeway mirror ONCE up front. Same-day matches enrich the board
// with zero live API calls; the live API is only consulted for day-view rows the mirror misses.
let mirror: any[] = []
try {
const { data: bzTasks } = await db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,started_at,finished_at,total_minutes,report_url,linked_reservation_id').eq('type_department', 'housekeeping').gte('scheduled_date', addDays(start, -3)).lte('scheduled_date', addDays(end, 3)).limit(3000)
mirror = (bzTasks || []).filter((t: any) => /depart|clean|turn/i.test(String(t.name || '')) && !/cancel|delet/i.test(String(t.status || '')))
} catch (e) { console.error('schedule: mirror pull failed', e) }

let enrichedOk = 0
// MIRROR-FIRST (both views): same-day task match from breezeway_tasks_sync — instant, no API.
if (mirror.length && cleans.length) {
for (const c of cleans) {
const mt = mirror.find((t: any) => String(t.reference_property_id) === c.listingId && String(t.scheduled_date).slice(0, 10) === c.date)
if (!mt) continue
c.syncStatus = 'synced'
c.breezewayTaskId = String(mt.id)
c.breezewayReportUrl = mt.report_url ? String(mt.report_url) : null
c.taskStatus = mt.finished_at ? 'completed' : mt.started_at ? 'in_progress' : 'created'
        c.cleanMinutes = (mt.total_minutes != null && Number.isFinite(Number(mt.total_minutes)) && Number(mt.total_minutes) > 0) ? Number(mt.total_minutes) : null
const ppl = Array.isArray(mt.assignees) ? mt.assignees : []
if (ppl.length) { c.assignedIds = ppl.map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n)); c.assignedNames = ppl.map((p: any) => String(p.name || '')).filter(Boolean) }
enrichedOk++
}
}
// DAY view: live-API lookup ONLY for cleans the mirror didn't cover (usually a handful, not all 30+).
if (view === 'day' && breezewayConfigured() && cleans.length) {
const pending = cleans.filter(c => c.syncStatus === undefined && c.date === anchor)
const CONC = 8
for (let i = 0; i < pending.length; i += CONC) {
await Promise.all(pending.slice(i, i + CONC).map(async c => {
try {
// One retry per row - a transient API/token blip must never blank an assignee on the board.
let tasks: Awaited<ReturnType<typeof listPropertyHousekeeping>> = []
try { tasks = await listPropertyHousekeeping(c.listingId, c.date, c.date) } catch { await new Promise(res => setTimeout(res, 600)); tasks = await listPropertyHousekeeping(c.listingId, c.date, c.date) }
const clean = pickDepartureClean(tasks, c.date)
              c.syncStatus = clean ? 'synced' : 'guesty-only'
c.breezewayTaskId = clean && clean.id ? String(clean.id) : null
c.breezewayReportUrl = clean && (clean as any).report_url ? String((clean as any).report_url) : null
if (clean) c.taskStatus = (clean as any).finished_at ? 'completed' : (clean as any).started_at ? 'in_progress' : 'created'
if (clean) { const _tm = Number((clean as any).total_minutes); c.cleanMinutes = (Number.isFinite(_tm) && _tm > 0) ? _tm : null }
enrichedOk++
const ppl = (clean as any)?.assignees as { id: number | null; name: string | null }[] | undefined
if (ppl && ppl.length) {
c.assignedIds = ppl.map(p => Number(p.id)).filter(n => Number.isFinite(n))
c.assignedNames = ppl.map(p => String(p.name || '')).filter(Boolean)
}
} catch (e) { console.error('schedule: live task lookup failed', e) }
}))
}
}

// If EVERY Breezeway lookup failed (token rate-limited on a cold lambda), this snapshot has no
// assignees/sync badges - self-bust the cache tag so the very next load recomputes enriched.
if (view === 'day' && breezewayConfigured() && cleans.length && enrichedOk === 0) { try { revalidateTag('schedule') } catch {} }

// Block-aware: reflect cleans a user moved to the next day (schedule_blocks: listing_id, orig_date, blocked_until).
    try {
      const { data: blocks } = await db.from('schedule_blocks').select('listing_id,orig_date,blocked_until').lte('orig_date', end).gte('blocked_until', start)
      const blk = (blocks || []) as any[]
      if (blk.length) {
        for (let i = cleans.length - 1; i >= 0; i--) {
          const c = cleans[i]
          const b = blk.find(x => String(x.listing_id) === c.listingId && String(x.orig_date) === c.date)
          if (b) {
            const bu = String(b.blocked_until)
            if (bu >= start && bu <= end) { c.blockedFrom = c.date; c.date = bu; c.blocked = true; c.sameDayTurn = false }
            else { cleans.splice(i, 1) }
          }
        }
        const incoming = blk.filter(b => { const bu = String(b.blocked_until); return bu >= start && bu <= end && !cleans.some(c => c.blocked && c.listingId === String(b.listing_id) && c.date === bu) })
        if (incoming.length) {
          const ids = Array.from(new Set(incoming.map(b => String(b.listing_id))))
          let minD = incoming[0].orig_date, maxD = incoming[0].orig_date
          for (const b of incoming) { if (b.orig_date < minD) minD = b.orig_date; if (b.orig_date > maxD) maxD = b.orig_date }
          const { data: srcRes } = await db.from('guesty_reservations').select('listing_id,listing_name,guest_name,check_out,nights,status').in('listing_id', ids).gte('check_out', minD).lt('check_out', addDays(String(maxD), 1))
          for (const b of incoming) {
            const oid = String(b.orig_date)
            const r: any = (srcRes || []).find((x: any) => String(x.listing_id) === String(b.listing_id) && String(x.check_out).slice(0, 10) === oid)
            const id = String(b.listing_id); const m = meta[id]
            cleans.push({
              listingId: id, unit: m?.name || r?.listing_name || 'Unit', market: m?.market || 'Miami', hub: m?.hub || 'Other',
              date: String(b.blocked_until), guestOut: r?.guest_name || null, nights: r?.nights ?? null, bedrooms: m?.bedrooms ?? null,
              checkInTime: m?.checkIn || null, checkOutTime: m?.checkOut || null, sameDayTurn: false, nextArrival: null,
              doorCode: m?.doorCode || null, cleaningTime: m?.cleaningTime || null,
              vendor: m?.vendor || null, assignedIds: [], assignedNames: [], blocked: true, blockedFrom: oid,
            })
          }
        }
      }
    } catch (e) { console.error('schedule: blocks pass failed', e) }

    // BLOCKED/MOVED rows are built AFTER the mirror pass above, so they always rendered with empty
    // assignees even when the Breezeway task (moved to the new date) was assigned. Re-match them
    // against the mirror on their NEW date so the clean keeps its task + cleaner.
    if (mirror.length) {
      for (const c of cleans) {
        if (!c.blocked || c.breezewayTaskId) continue
        const mt = mirror.find((t: any) => String(t.reference_property_id) === c.listingId && String(t.scheduled_date).slice(0, 10) === c.date)
        if (!mt) continue
        c.syncStatus = 'synced'
        c.breezewayTaskId = String(mt.id)
        c.breezewayReportUrl = mt.report_url ? String(mt.report_url) : null
        c.taskStatus = mt.finished_at ? 'completed' : mt.started_at ? 'in_progress' : 'created'
        c.cleanMinutes = (mt.total_minutes != null && Number.isFinite(Number(mt.total_minutes)) && Number(mt.total_minutes) > 0) ? Number(mt.total_minutes) : null
        const ppl = Array.isArray(mt.assignees) ? mt.assignees : []
        if (ppl.length) { c.assignedIds = ppl.map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n)); c.assignedNames = ppl.map((p: any) => String(p.name || '')).filter(Boolean) }
      }
    }

    // MOVED CLEANS (Jon's rule): departure cleans get moved between days (Block button or edits in
// Breezeway), so a day's real workload = what Breezeway actually has scheduled. Reconcile BOTH ways
// against the breezeway_tasks_sync mirror (kept live by webhooks):
// (a) a 'guesty-only' row whose task lives on ANOTHER day -> mark synced + taskDate + assignee;
// (b) a task scheduled on a day with no matching checkout -> add it as a row on its real day.
try {
const extendedTaskIds = new Set<string>()
      const movedIns: Clean[] = []
for (const c of cleans) {
if (c.syncStatus !== 'guesty-only') continue
const _cands = mirror.filter((t: any) => String(t.reference_property_id) === c.listingId && String(t.scheduled_date).slice(0, 10) !== c.date && !t.finished_at)
const _byRes = c.reservationId ? _cands.find((t: any) => String(t.linked_reservation_id || '') === String(c.reservationId)) : null; const mv = _byRes || (_cands.length ? _cands.reduce((a: any, b: any) => Math.abs(+new Date(String(b.scheduled_date).slice(0, 10)) - +new Date(c.date)) < Math.abs(+new Date(String(a.scheduled_date).slice(0, 10)) - +new Date(c.date)) ? b : a) : null)
if (!mv) continue
const mvDate = String(mv.scheduled_date).slice(0, 10)
const ppl = Array.isArray(mv.assignees) ? mv.assignees : []
const mvIds = ppl.map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n))
const mvNames = ppl.map((p: any) => String(p.name || '')).filter(Boolean)
if (mvDate < c.date) {
          c.extended = true
          c.extendedFrom = mvDate
          c.syncStatus = 'synced'
          c.breezewayTaskId = String(mv.id)
          c.breezewayReportUrl = mv.report_url ? String(mv.report_url) : null
          c.cleanMinutes = (mv.total_minutes != null && Number(mv.total_minutes) > 0) ? Number(mv.total_minutes) : null
          if (mvIds.length) c.assignedIds = mvIds
          if (mvNames.length) c.assignedNames = mvNames
          extendedTaskIds.add(String(mv.id))
          continue
        }
        const mvStatus: any = mv.finished_at ? 'completed' : mv.started_at ? 'in_progress' : 'created'
const mvReport = mv.report_url ? String(mv.report_url) : null
const mvTaskId = String(mv.id)
c.syncStatus = 'synced'
c.taskDate = mvDate
c.breezewayTaskId = mvTaskId
c.taskStatus = mvStatus
c.breezewayReportUrl = mvReport
c.movedTo = mvDate
c.cleanMinutes = (mv.total_minutes != null && Number(mv.total_minutes) > 0) ? Number(mv.total_minutes) : null
movedIns.push({ ...c, date: mvDate, movedTo: null, movedFrom: c.date, ghost: false, syncStatus: 'synced', breezewayTaskId: mvTaskId, taskStatus: mvStatus, breezewayReportUrl: mvReport, assignedIds: mvIds.length ? mvIds : c.assignedIds, assignedNames: mvNames.length ? mvNames : c.assignedNames })
}
cleans.push(...movedIns)
let _resById: Record<string, { guest: string | null; checkout: string }> = {}
try {
const _rids = Array.from(new Set(mirror.map((t: any) => t.linked_reservation_id).filter(Boolean).map((x: any) => String(x))))
if (_rids.length) {
const { data: _rr } = await db.from('guesty_reservations').select('id,guest_name,check_out').in('id', _rids)
for (const _r of (_rr || []) as any[]) _resById[String(_r.id)] = { guest: _r.guest_name || null, checkout: String(_r.check_out || '').slice(0, 10) }
}
} catch (e) { console.error('schedule: reservation hydrate failed', e) }
for (const t of mirror) {
      if (extendedTaskIds.has(String(t.id))) continue
const d = String(t.scheduled_date).slice(0, 10)
if (d < start || d > end) continue
if (t.finished_at && d > today) continue
const id = String(t.reference_property_id || '')
if (!id || cleans.some(c => c.listingId === id && (c.date === d || c.taskDate === d))) continue
const m2 = meta[id]
if (!m2) continue
const ppl = Array.isArray(t.assignees) ? t.assignees : []
const _lr: any = t.linked_reservation_id ? _resById[String(t.linked_reservation_id)] : null
cleans.push({ listingId: id, unit: m2.name, market: m2.market, hub: m2.hub, date: d, guestOut: _lr ? _lr.guest : null, movedFrom: (_lr && _lr.checkout && _lr.checkout !== d) ? _lr.checkout : null, nights: null, bedrooms: m2.bedrooms ?? null, checkInTime: m2.checkIn || null, checkOutTime: m2.checkOut || null, sameDayTurn: false, nextArrival: null, doorCode: m2.doorCode || null, cleaningTime: m2.cleaningTime || null, vendor: m2.vendor || null, assignedIds: ppl.map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n)), assignedNames: ppl.map((p: any) => String(p.name || '')).filter(Boolean), syncStatus: 'synced', breezewayTaskId: String(t.id), breezewayReportUrl: t.report_url ? String(t.report_url) : null, taskStatus: t.finished_at ? 'completed' : t.started_at ? 'in_progress' : 'created', cleanMinutes: (t.total_minutes != null && Number(t.total_minutes) > 0) ? Number(t.total_minutes) : null, bzOnly: !_lr })
}
} catch (e) { console.error('schedule: moved-reconcile failed', e) }

// MANUAL CLEANS: tasks added from the board (create-clean logs them). Breezeway is a co-source
// of truth, so board-added tasks show on the calendar even without a Guesty checkout.
try {
const { data: manual } = await db.from('schedule_manual_cleans').select('listing_id,date,breezeway_task_id').gte('date', start).lte('date', end)
for (const mr of (manual || []) as any[]) {
const id = String(mr.listing_id); const d = String(mr.date).slice(0, 10)
if (cleans.some(c => c.listingId === id && c.date === d)) continue
const m = meta[id]
cleans.push({ listingId: id, unit: m?.name || 'Unit', market: m?.market || 'Miami', hub: m?.hub || 'Other', date: d, guestOut: null, nights: null, bedrooms: m?.bedrooms ?? null, checkInTime: m?.checkIn || null, checkOutTime: m?.checkOut || null, sameDayTurn: false, nextArrival: null, doorCode: m?.doorCode || null, cleaningTime: m?.cleaningTime || null, vendor: m?.vendor || null, assignedIds: [], assignedNames: [], syncStatus: 'synced', breezewayTaskId: mr.breezeway_task_id ? String(mr.breezeway_task_id) : null, manual: true })
}
} catch (e) { console.error('schedule: manual cleans pass failed', e) }
// MISSING CLEAN: a confirmed Guesty checkout with NO Breezeway departure task on any
// day (same-day + cross-day matching both failed) = the clean was never scheduled.
for (const c of cleans) { if (c.syncStatus === 'guesty-only' && c.guestOut && !c.vendor && c.date >= today && c.date <= addDays(today, 14)) c.missing = true }
// WALK-IN RISK: departure clean scheduled while a confirmed guest is still in-house
// through that day (arrived before, checks out after) = cleaning an occupied unit.
for (const c of cleans) { if (!c.date || c.vendor) continue; const occ = (outs || []).some((r: any) => { const st = String(r.status || '').toLowerCase(); if (!(st.includes('confirm') || st.includes('check'))) return false; if (String(r.listing_id) !== c.listingId) return false; const ci = String(r.check_in || '').slice(0, 10); const co = String(r.check_out || '').slice(0, 10); return !!ci && !!co && ci < c.date && co > c.date; }); if (occ) c.walkInRisk = true }

const MARKETS: Market[] = ['Miami', 'Broward', 'North']
const dayList: string[] = []
for (let d = start; d <= end; d = addDays(d, 1)) dayList.push(d)
const days = dayList.map(date => {
const dayCleans = cleans.filter(c => c.date === date).sort((a, b) => (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || a.hub.localeCompare(b.hub) || a.unit.localeCompare(b.unit))
const markets: Record<string, Clean[]> = {}
for (const m of MARKETS) markets[m] = dayCleans.filter(c => c.market === m)
const d = new Date(date + 'T12:00:00')
return { date, dow: DAYLABEL[d.getDay()], count: dayCleans.filter((c) => !c.movedTo).length, additional: mirror.filter((t: any) => String(t.scheduled_date || '').slice(0, 10) === date && !String(t.name || '').toLowerCase().includes('departure')).length, markets }
})

let housekeepers: { id: number; name: string; region: string | null }[] = []
if (breezewayConfigured()) {
try {
const people = await listBreezewayPeople()
housekeepers = people.filter(p => p.departments.length === 0 || p.departments.includes('housekeeping')).map(p => ({ id: p.id, name: p.name, region: p.region })).sort((a, b) => a.name.localeCompare(b.name))
} catch (e) { console.error('schedule: people list failed', e) }
}

return {
ok: true, view, today, weekStart: start, weekEnd: end,
prev: view === 'day' ? addDays(start, -1) : addDays(start, -7),
next: view === 'day' ? addDays(start, 1) : addDays(start, 7),
totals: { cleans: cleans.filter((c) => !c.movedTo).length, byMarket: MARKETS.map(m => ({ market: m, count: cleans.filter(c => c.market === m && !c.movedTo && !c.vendor).length })) },
days, housekeepers, units, breezeway: breezewayConfigured(),
syncedAt: new Date().toISOString(),
}
}, ['schedule-v2'], { tags: ['schedule'], revalidate: 86400 })

const payload = await compute(view, start, end, today)
// LIVE staged-assignment overlay (uncached): server-saved cleaner picks survive refresh/tab-switch
  try {
    const sdb = supabaseAdmin()
    const { data: staged } = await sdb.from('schedule_staged').select('listing_id,date,cleaner_id,cleaner_name').gte('date', start).lte('date', end)
    if (staged && staged.length && payload && Array.isArray((payload as any).days)) {
      const smap = new Map<string, any>()
      for (const r of staged) { if (r && r.cleaner_id != null) smap.set(String(r.listing_id) + '|' + String(r.date).slice(0, 10), r) }
      if (smap.size) {
        for (const day of (payload as any).days) {
          const mk = day && day.markets
          if (!mk) continue
          for (const key of Object.keys(mk)) {
            for (const c of ((mk[key] || []) as any[])) {
              const hit = smap.get(String(c.listingId) + '|' + String(c.date).slice(0, 10))
              if (hit) { c.assignedIds = [Number(hit.cleaner_id)]; c.assignedNames = hit.cleaner_name ? [String(hit.cleaner_name)] : c.assignedNames; c.staged = true }
            }
          }
        }
      }
    }
  } catch (e) { console.error('schedule: staged overlay failed', e) }
  return NextResponse.json(payload)
}

// Turnover schedule — cleaning plan from CONFIRMED Guesty checkouts (each checkout = the departure
// clean Breezeway auto-creates). Day view (rich table) + weekly view (Sun-Saturday), grouped by
// market (Miami / Broward / North). Adds per clean: hub/building, bedrooms, check-in/out times,
// nights, same-day-turn, current DOOR CODE + a suggested NEW 4-digit code (blank for 17West, whose
// codes are managed elsewhere), and cleaning time. Read-only; assignment via /api/schedule/assign.
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
const VENDOR_OF = (s: string) => /botanica/i.test(s) ? 'Botanica' : null // Botanica is cleaned by hotel staff (vendor), not our team
const NO_CODE = (s: string) => IS_17WEST(s) || /elser/i.test(s) // 17West + Elser door codes are managed elsewhere — don't generate a new code
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
db.from('guesty_reservations').select('listing_id,listing_name,guest_name,check_out,check_in,status,nights,source').gte('check_out', start).lte('check_out', end).limit(4000),
db.from('guesty_reservations').select('listing_id,check_in,status').gte('check_in', start).lte('check_in', addDays(end, 30)).limit(8000),
db.from('guesty_listings').select('id,nickname,title,building,address_city,status,bedrooms,raw'),
])

// HARD GUARD: if the listings query hiccups, ABORT instead of caching a garbage snapshot
// (rows would render with hub 'Other', no bedrooms/door codes - worse than an error).
if (!listings || !listings.length) throw new Error('Listing data unavailable - hit Sync to retry.')

type Meta = { name: string; market: Market; hub: string; bedrooms: number | null; doorCode: string | null; cleaningTime: string | null; checkIn: string | null; checkOut: string | null; is17: boolean; noCode: boolean; vendor: string | null }
const meta: Record<string, Meta> = {}
const units: { id: string; name: string }[] = []
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

type Clean = { listingId: string; unit: string; market: Market; hub: string; date: string; guestOut: string | null; nights: number | null; bedrooms: number | null; checkInTime: string | null; checkOutTime: string | null; sameDayTurn: boolean; nextArrival: string | null; doorCode: string | null; newDoorCode: string | null; cleaningTime: string | null; vendor: string | null; assignedIds: number[]; assignedNames: string[] ; syncStatus?: 'synced' | 'guesty-only'; breezewayTaskId?: string | null; breezewayReportUrl?: string | null; taskStatus?: 'created' | 'in_progress' | 'completed'; manual?: boolean; bzOnly?: boolean; taskDate?: string | null; blocked?: boolean; blockedFrom?: string | null; blockedUntil?: string | null }
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

let enrichedOk = 0
// DAY view: look up each clean's CURRENT Breezeway departure-task assignee so the board shows who is
// already assigned (not just who we stage). Bounded parallelism; skipped for week view (too many calls).
if (view === 'day' && breezewayConfigured() && cleans.length) {
const CONC = 8
for (let i = 0; i < cleans.length; i += CONC) {
await Promise.all(cleans.slice(i, i + CONC).map(async c => {
try {
// One retry per row - a transient API/token blip must never blank an assignee on the board.
let tasks: Awaited<ReturnType<typeof listPropertyHousekeeping>> = []
try { tasks = await listPropertyHousekeeping(c.listingId, c.date, c.date) } catch { await new Promise(res => setTimeout(res, 600)); tasks = await listPropertyHousekeeping(c.listingId, c.date, c.date) }
const clean = pickDepartureClean(tasks, c.date)
              c.syncStatus = clean ? 'synced' : 'guesty-only'
c.breezewayTaskId = clean && clean.id ? String(clean.id) : null
c.breezewayReportUrl = clean && (clean as any).report_url ? String((clean as any).report_url) : null
if (clean) c.taskStatus = (clean as any).finished_at ? 'completed' : (clean as any).started_at ? 'in_progress' : 'created'
enrichedOk++
const ppl = (clean as any)?.assignees as { id: number | null; name: string | null }[] | undefined
if (ppl && ppl.length) {
c.assignedIds = ppl.map(p => Number(p.id)).filter(n => Number.isFinite(n))
c.assignedNames = ppl.map(p => String(p.name || '')).filter(Boolean)
}
} catch { /* leave unassigned */ }
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
              doorCode: m?.doorCode || null, newDoorCode: m?.noCode ? null : newCode(id + oid), cleaningTime: m?.cleaningTime || null,
              vendor: m?.vendor || null, assignedIds: [], assignedNames: [], blocked: true, blockedFrom: oid,
            })
          }
        }
      }
    } catch { /* schedule_blocks not present yet — ignore */ }

    // MOVED CLEANS (Jon's rule): departure cleans get moved between days (Block button or edits in
// Breezeway), so a day's real workload = what Breezeway actually has scheduled. Reconcile BOTH ways
// against the breezeway_tasks_sync mirror (kept live by webhooks):
// (a) a 'guesty-only' row whose task lives on ANOTHER day -> mark synced + taskDate + assignee;
// (b) a task scheduled on a day with no matching checkout -> add it as a row on its real day.
try {
const { data: bzTasks } = await db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,started_at,finished_at,report_url').eq('type_department', 'housekeeping').gte('scheduled_date', addDays(start, -3)).lte('scheduled_date', addDays(end, 3)).limit(3000)
const mirror = (bzTasks || []).filter((t: any) => /depart|clean|turn/i.test(String(t.name || '')) && !/cancel|delet/i.test(String(t.status || '')))
for (const c of cleans) {
if (c.syncStatus !== 'guesty-only') continue
const mv = mirror.find((t: any) => String(t.reference_property_id) === c.listingId && String(t.scheduled_date).slice(0, 10) !== c.date && !t.finished_at)
if (!mv) continue
c.syncStatus = 'synced'
c.breezewayTaskId = String(mv.id)
c.taskDate = String(mv.scheduled_date).slice(0, 10)
c.breezewayReportUrl = mv.report_url ? String(mv.report_url) : null
c.taskStatus = mv.finished_at ? 'completed' : mv.started_at ? 'in_progress' : 'created'
const ppl = Array.isArray(mv.assignees) ? mv.assignees : []
if (ppl.length && !c.assignedIds.length) { c.assignedIds = ppl.map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n)); c.assignedNames = ppl.map((p: any) => String(p.name || '')).filter(Boolean) }
}
for (const t of mirror) {
const d = String(t.scheduled_date).slice(0, 10)
if (d < start || d > end) continue
if (t.finished_at && d > today) continue
const id = String(t.reference_property_id || '')
if (!id || cleans.some(c => c.listingId === id && (c.date === d || c.taskDate === d))) continue
const m2 = meta[id]
if (!m2) continue
const ppl = Array.isArray(t.assignees) ? t.assignees : []
cleans.push({ listingId: id, unit: m2.name, market: m2.market, hub: m2.hub, date: d, guestOut: null, nights: null, bedrooms: m2.bedrooms ?? null, checkInTime: m2.checkIn || null, checkOutTime: m2.checkOut || null, sameDayTurn: false, nextArrival: null, doorCode: m2.doorCode || null, newDoorCode: null, cleaningTime: m2.cleaningTime || null, vendor: m2.vendor || null, assignedIds: ppl.map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n)), assignedNames: ppl.map((p: any) => String(p.name || '')).filter(Boolean), syncStatus: 'synced', breezewayTaskId: String(t.id), breezewayReportUrl: t.report_url ? String(t.report_url) : null, taskStatus: t.finished_at ? 'completed' : t.started_at ? 'in_progress' : 'created', bzOnly: true })
}
} catch { /* mirror table optional */ }

// MANUAL CLEANS: tasks added from the board (create-clean logs them). Breezeway is a co-source
// of truth, so board-added tasks show on the calendar even without a Guesty checkout.
try {
const { data: manual } = await db.from('schedule_manual_cleans').select('listing_id,date,breezeway_task_id').gte('date', start).lte('date', end)
for (const mr of (manual || []) as any[]) {
const id = String(mr.listing_id); const d = String(mr.date).slice(0, 10)
if (cleans.some(c => c.listingId === id && c.date === d)) continue
const m = meta[id]
cleans.push({ listingId: id, unit: m?.name || 'Unit', market: m?.market || 'Miami', hub: m?.hub || 'Other', date: d, guestOut: null, nights: null, bedrooms: m?.bedrooms ?? null, checkInTime: m?.checkIn || null, checkOutTime: m?.checkOut || null, sameDayTurn: false, nextArrival: null, doorCode: m?.doorCode || null, newDoorCode: null, cleaningTime: m?.cleaningTime || null, vendor: m?.vendor || null, assignedIds: [], assignedNames: [], syncStatus: 'synced', breezewayTaskId: mr.breezeway_task_id ? String(mr.breezeway_task_id) : null, manual: true })
}
} catch { /* schedule_manual_cleans not created yet - run the SQL */ }

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
days, housekeepers, units, breezeway: breezewayConfigured(),
syncedAt: new Date().toISOString(),
}
}, ['schedule-v2'], { tags: ['schedule'], revalidate: 86400 })

const payload = await compute(view, start, end, today)
return NextResponse.json(payload)
}

// DAY SHEET BUILDER — one source of truth for the ops day, used by BOTH the in-app sheets and the
// password-protected share link. If these ever diverged, the paper and the phone would disagree,
// which is exactly the failure this whole feature exists to prevent.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex, vendorNameOf } from '@/lib/ops-presets'
import { isLiveStay, staySpans } from '@/lib/stay-status'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
// Occupancy uses the ONE shared rule (lib/stay-status). The sheet used to carry its own
// /confirm|check/ regex, which quietly dropped statuses like 'closed' — a unit reading free while
// a guest is in it is exactly how a walk-in happens.
const isLive = (s: string) => isLiveStay(s)
const isDone = (s: string) => /complete|finish|close|approv/.test(str(s).toLowerCase())
const isGone = (s: string) => /delete|cancel/.test(str(s).toLowerCase())
// Jon asked for 12-hour time everywhere. Guesty stores check-in as "16:00"; nobody reading a sheet
// at speed parses that as four in the afternoon.
function fmt12(v: any): string | null {
  const t = str(v).trim()
  if (!t) return null
  if (/[ap]\.?m\.?$/i.test(t)) return t.toUpperCase().replace(/\s*([AP])\.?M\.?$/i, ' $1M')
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return t
  let h = Number(m[1]); const mm = m[2]
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12; if (h === 0) h = 12
  return h + ':' + mm + ' ' + ap
}
// Breezeway task names carry the crew's instructions after a slash:
//   "Departure Clean Checklist / bring extra amenities / long stay arrival on friday"
// The JOB is the first part; the rest is instruction. Printing the raw string reads like noise,
// which is exactly what made the exceptions sheet hard to follow.
function taskLabel(name: string): string { return (str(name).split('/')[0] || '').trim() || str(name).trim() }
function taskNotes(name: string): string { return str(name).split('/').slice(1).map(x => x.trim()).filter(Boolean).join(' · ') }
// A timestamptz sliced to 10 chars is a UTC date. Anything finished or booked after 8pm ET would
// land on tomorrow. Always convert through the ET formatter first.
function etDate(ts: any): string { const d = new Date(str(ts)); return isNaN(d.getTime()) ? '' : ymd(d) }
const hhmm = (iso: any) => { const d = new Date(str(iso)); return isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d) }

// OWNER STAY detection, all three signals Jon asked for:
//   1. Guesty source is an owner booking ('owner', 'owner-guest')
//   2. Guesty source is 'manual' (staff-created block / comp stay)
//   3. the guest name matches the OWNER on file for that listing (guesty_owners.listing_ids)
// Door code lives in a Guesty custom field — the same one the scheduler reads.
const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'
function doorCodeOf(cf: any): string | null {
  const arr = Array.isArray(cf) ? cf : []
  for (const f of arr) {
    const id = (f && f.fieldId && (f.fieldId._id || f.fieldId)) || (f && f._id)
    if (String(id) === DOOR_CODE_FIELD) { const v = String(f.value ?? '').trim(); return v || null }
  }
  return null
}

const OWNER_SRC = /^owner/i
const MANUAL_SRC = /^manual$/i
function normName(s: string): string { return str(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim() }
function nameMatches(a: string, b: string): boolean {
  const x = normName(a), y = normName(b)
  if (!x || !y) return false
  if (x === y) return true
  const xs = x.split(' ').filter(w => w.length > 2), ys = y.split(' ').filter(w => w.length > 2)
  if (!xs.length || !ys.length) return false
  // last name + first initial is enough ("Michael J Hutnik" vs "Michael Hutnik")
  const lastSame = xs[xs.length - 1] === ys[ys.length - 1]
  return lastSame && xs[0][0] === ys[0][0]
}


// WAS ANYONE PHYSICALLY IN THIS UNIT, AND WHAT DID THEY DO?
// "Last cleaned" alone under-reports the truth: an inspection, a unit check, a quality audit or a
// maintenance visit all mean somebody stood in the unit and would have seen a problem. Order
// matters — the first pattern that matches wins.
const TOUCH_KINDS: { kind: string; re: RegExp; clean: boolean }[] = [
  { kind: 'Deep clean',      re: /deep clean/i, clean: true },
  { kind: 'Departure clean', re: /departure clean|turnover clean|check-?out clean|move-?out clean/i, clean: true },
  { kind: 'Mid-stay clean',  re: /mid-?stay|refresh clean|touch-?up|linen (change|swap)|towel (change|swap)/i, clean: true },
  { kind: 'Clean',           re: /(^|\W)clean|limpieza|housekeep/i, clean: true },
  { kind: 'Strip',           re: /strip/i, clean: true },
  { kind: 'Quality audit',   re: /audit/i, clean: false },
  { kind: 'Inspection',      re: /inspect|unit check|walk-?through|walkthrough|\bqc\b|quality check/i, clean: false },
  { kind: 'Maintenance',     re: /maint|repair|\bfix\b|install|replace|preventative|preventive|batter|filter|leak|paint/i, clean: false },
]
function classifyTouch(name: string, dept: string): { kind: string; clean: boolean } {
  for (const t of TOUCH_KINDS) if (t.re.test(name)) return { kind: t.kind, clean: t.clean }
  const d = str(dept).toLowerCase()
  if (/housekeep|clean/.test(d)) return { kind: 'Clean', clean: true }
  if (/inspect/.test(d)) return { kind: 'Inspection', clean: false }
  if (/maint/.test(d)) return { kind: 'Maintenance', clean: false }
  return { kind: 'Visit', clean: false }
}
// WHAT TIME IS IT, AND HAS THIS ALREADY HAPPENED?
// Jon: "the team knows when checkouts happen. If we pull the sheet at 9am and they check out at 11,
// that should not be on the exception sheet." A cleaner cannot start a clean while the guest is
// still in bed, so anything that reads as a failure BEFORE its own deadline is a false alarm — and a
// sheet that cries wolf at 9am gets ignored by 10.
function minutesOfDay(v: any): number | null {
  const t = str(v).trim(); if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i)
  if (!m) return null
  let h = Number(m[1]); const mm = Number(m[2]); const ap = (m[3] || '').toLowerCase()
  if (ap.startsWith('p') && h < 12) h += 12
  if (ap.startsWith('a') && h === 12) h = 0
  return h * 60 + mm
}
function nowMinutesET(): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const h = Number(p.find(x => x.type === 'hour')?.value || 0)
  const mi = Number(p.find(x => x.type === 'minute')?.value || 0)
  return h * 60 + mi
}
function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / 86400000)
}

// WHAT IS *THE* CLEAN? lib/breezeway.ts already ruled on this: a strip, a walkthrough or an
// inspection is NOT the departure clean. The day sheet used to count them as one, which produced
// two harms at once — a unit with only a strip booked looked covered, and a unit with a real clean
// PLUS a strip raised a bogus "two cleans, one is probably a duplicate" alarm.
const NOT_THE_CLEAN = /strip|walk-?through|inspect|unit check/i
const IS_THE_CLEAN = /departure clean|turnover clean|check-?out clean|move-?out clean|deep clean|limpieza/i
function isDepartureClean(name: string, dept: string): boolean {
  const nm = str(name)
  if (NOT_THE_CLEAN.test(nm)) return false
  if (IS_THE_CLEAN.test(nm)) return true
  return /housekeep|clean/i.test(str(dept)) && /clean/i.test(nm)
}
// Prep work that happens around a checkout but is not the clean itself.
const IS_PREP = /strip|walk-?through/i

export async function buildDaySheet(dateIn?: string, marketIn?: string): Promise<any> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(dateIn)) ? str(dateIn) : ymd(new Date())
  const marketQ = str(marketIn) || 'all'
    const db = supabaseAdmin()
    const presets = await getOpsPresets()
    const VENDOR_RE = vendorRegex(presets.vendorBuildings)

    const [lRes, tRes, rRes, oRes, gRes, sRes, fRes, gsRes, iRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city,address_full,status,bedrooms:raw->>bedrooms,checkIn:raw->>defaultCheckInTime,checkOut:raw->>defaultCheckOutTime,cf:raw->customFields,lat:raw->address->>lat,lng:raw->address->>lng'),
      db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,started_at,finished_at,type_department,report_url').eq('scheduled_date', date).order('reference_property_id', { ascending: true }).limit(3000),
      db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status,guest_id,guest_name,guest_phone,nights,source,notes,money_total,created_at')
        .lte('check_in', addDays(date, 1)).gte('check_out', date).order('check_in', { ascending: true }).limit(3000),
      db.from('guesty_owners').select('id,full_name,listing_ids').limit(2000),
      db.from('glitches').select('id,unit,listing_id,overview,status,created_at,breezeway_task_id').not('status', 'in', '("done","resolved","closed")').order('created_at', { ascending: false }).limit(300),
      db.from('breezeway_tasks_sync').select('synced_at').order('synced_at', { ascending: false }).limit(1),
      // NEXT ARRIVAL — a separate forward look. The day window above stops at tomorrow, so the
      // vacant list used to sort on a next-arrival it could not actually see.
      db.from('guesty_reservations').select('listing_id,check_in,status')
        // ordered so that if the cap is ever reached it drops the FURTHEST-OUT arrivals, which are
        // the ones nobody is planning around today.
        .gt('check_in', date).lte('check_in', addDays(date, 45)).order('check_in', { ascending: true }).limit(4000),
      // How fresh is the RESERVATION feed? Breezeway freshness alone says nothing about whether a
      // booking made an hour ago is on this sheet.
      // All feeds, not just reservations: when one cron silently stops, the fastest way to see it is
      // a list of every feed and when it last actually ran. Seven rows, so this stays free.
      db.from('guesty_sync_status').select('entity,last_sync_at,last_error').limit(50),
      // The coordinator's own notes from walking units today. The table only exists after migration
      // 014, so a failure here must never take the day sheet down with it.
      db.from('unit_inspections').select('id,unit,cleaner,rating,notes,follow_up,inspector')
        .eq('inspected_on', date).order('created_at', { ascending: false }).limit(200),
    ])

    const lmap: Record<string, any> = {}
    for (const l of ((lRes.data || []) as any[])) {
      const name = l.nickname || l.title || 'Unit'
      const isVendor = VENDOR_RE.test(str(l.building)) || VENDOR_RE.test(name)
      lmap[String(l.id)] = {
        name, building: str(l.building),
        market: isVendor ? 'Vendor' : marketOf(l.building, l.address_city, name),
        vendor: vendorNameOf(presets.vendorBuildings, str(l.building)) || vendorNameOf(presets.vendorBuildings, name),
        active: str(l.status).trim().toLowerCase() === 'active',
        bedrooms: l.bedrooms != null ? Number(l.bedrooms) : null,
        checkIn: l.checkIn || null, checkOut: l.checkOut || null,
        address: l.address_full || null,
        doorCode: doorCodeOf(l.cf),
        lat: Number.isFinite(Number(l.lat)) ? Number(l.lat) : null,
        lng: Number.isFinite(Number(l.lng)) ? Number(l.lng) : null,
      }
    }
    // listing -> owner name
    const ownerOf: Record<string, string> = {}
    for (const o of ((oRes.data || []) as any[])) {
      const nm = str(o.full_name)
      for (const id of (Array.isArray(o.listing_ids) ? o.listing_ids : [])) if (nm) ownerOf[String(id)] = nm
    }

    const inMarket = (lid: string) => marketQ === 'all' || (lmap[lid] && lmap[lid].market === marketQ)

    // ---- HOW FRESH IS THIS SHEET? Two independent feeds, reported separately, because they fail
    // separately: Breezeway decides what work exists, Guesty decides who is arriving.
    const syncRows = ((gsRes as any).data || []) as any[]
    const resSyncRow: any = syncRows.find(r => str(r.entity) === 'reservations') || null
    const bzSyncAt = ((sRes.data || []) as any[])[0]?.synced_at || null
    const resSyncAt = resSyncRow ? str(resSyncRow.last_sync_at) || null : null
    const ageMin = (iso: any) => { const t = new Date(str(iso)).getTime(); return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null }
    const bzAge = ageMin(bzSyncAt), resAge = ageMin(resSyncAt)
    // Per-feed thresholds, sized to each cron. Reservations pull every 10 min, so 35 minutes means
    // three runs in a row were missed. Breezeway tasks pull every 30 min.
    const RES_STALE_MIN = 35, BZ_STALE_MIN = 75
    const resErr = resSyncRow ? (str(resSyncRow.last_error) || null) : null
    const sync = {
      breezewayAt: bzSyncAt, breezewayAgeMin: bzAge,
      reservationsAt: resSyncAt, reservationsAgeMin: resAge,
      reservationsError: resErr,
      // An ERRORING sync still stamps its timestamp, so "4 minutes ago" can be a lie. A recorded
      // error counts as stale on its own — that was the whole failure this block exists to catch.
      stale: (bzAge == null || bzAge > BZ_STALE_MIN) || (resAge == null || resAge > RES_STALE_MIN) || !!resErr,
      // every feed, oldest first, so a cron that quietly died is visible at a glance
      feeds: syncRows
        .map(r => ({ entity: str(r.entity), at: str(r.last_sync_at) || null, ageMin: ageMin(r.last_sync_at), error: str(r.last_error) || null }))
        .sort((a, b) => (b.ageMin ?? 1e9) - (a.ageMin ?? 1e9)),
      staleReason: [
        bzAge == null ? 'Breezeway sync time unknown' : bzAge > BZ_STALE_MIN ? 'Breezeway tasks last synced ' + bzAge + ' min ago' : '',
        resAge == null ? 'Booking sync time unknown' : resAge > RES_STALE_MIN ? 'Bookings last synced ' + resAge + ' min ago' : '',
        resErr ? 'The booking sync is FAILING: ' + resErr.slice(0, 120) : '',
      ].filter(Boolean).join(' · ') || null,
    }
    // A booking made after the last reservation sync CANNOT be on this sheet. Say so out loud.
    const cutoffIso = resSyncAt || null

    // Time gating only applies to TODAY. A sheet for yesterday or for a future date is judged on the
    // whole day, otherwise last week's sheet would look like everything was fine at 9am.
    const isToday = date === ymd(new Date())
    const nowMin = isToday ? nowMinutesET() : 24 * 60
    const GRACE = 30   // minutes after checkout before "not started" means anything

    // ---- tasks for the day, split into cleans vs everything else
    const tasks = ((tRes.data || []) as any[]).filter(t => !isGone(t.status))
    const cleanByListing: Record<string, any> = {}
    const dupCleans: { unit: string; a: string; b: string }[] = []
    // strip / walkthrough — real work, but not the clean. Shown ON the departure row, not as a
    // separate mystery line in the work orders.
    const prepByListing: Record<string, any[]> = {}
    const work: any[] = []
    for (const t of tasks) {
      const lid = String(t.reference_property_id)
      if (!inMarket(lid)) continue
      const nm = str(t.name)
      const li = lmap[lid] || {}
      const who = (Array.isArray(t.assignees) ? t.assignees : []).map((p: any) => str(p.name)).filter(Boolean)
      const row = {
        id: str(t.id), listingId: lid, unit: li.name || 'Unknown unit', market: li.market || '',
        name: nm, label: taskLabel(nm), instructions: taskNotes(nm),
        dept: str(t.type_department), assignees: who,
        status: isDone(t.status) ? 'done' : (t.started_at ? 'in progress' : 'not started'),
        startedAt: hhmm(t.started_at), finishedAt: hhmm(t.finished_at), reportUrl: t.report_url || null,
      }
      if (isDepartureClean(nm, row.dept)) {
        // Two REAL cleans on one unit on one day is a data problem, not a plan. Keep the one that is
        // furthest along so the sheet never reports "not started" while a clean is finished, and
        // record the collision once per unit so it surfaces in the exceptions block.
        const cur = cleanByListing[lid]
        const rank = (x: any) => (x.status === 'done' ? 2 : x.status === 'in progress' ? 1 : 0)
        if (!cur) cleanByListing[lid] = row
        else {
          if (!dupCleans.some(x => x.unit === row.unit)) dupCleans.push({ unit: row.unit, a: taskLabel(cur.name), b: taskLabel(row.name) })
          if (rank(row) > rank(cur)) cleanByListing[lid] = row
        }
      }
      else if (IS_PREP.test(nm)) (prepByListing[lid] = prepByListing[lid] || []).push(row)
      else work.push(row)
    }
    work.sort((a, b) => (a.dept || '').localeCompare(b.dept || '') || a.unit.localeCompare(b.unit))

    // ---- reservations for the day
    const arrivals: any[] = []
    const departures: any[] = []
    const ownerStays: any[] = []
    const occupied: Record<string, boolean> = {}
    const nextArrivalOf: Record<string, string> = {}
    const checkoutIds = new Set<string>()
    const unknownListings = new Set<string>()
    for (const r of ((fRes.data || []) as any[])) {
      if (!isLive(r.status)) continue
      const lid = String(r.listing_id), ci = str(r.check_in).slice(0, 10)
      if (ci && (!nextArrivalOf[lid] || ci < nextArrivalOf[lid])) nextArrivalOf[lid] = ci
    }
    for (const r of ((rRes.data || []) as any[])) {
      if (!isLive(r.status)) continue
      const lid = String(r.listing_id)
      const li = lmap[lid] || {}
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      // staySpans is the shared rule and it guards against missing dates: a reservation with a null
      // check-in used to satisfy ('' <= date) and silently hold a unit off the vacant list.
      if (staySpans(r, date)) occupied[lid] = true
      if (ci > date && (!nextArrivalOf[lid] || ci < nextArrivalOf[lid])) nextArrivalOf[lid] = ci
      if (co === date) checkoutIds.add(lid)
      if (!lmap[lid]) unknownListings.add(lid)
      if (!inMarket(lid)) continue
      const src = str(r.source)
      const ownerName = ownerOf[lid] || ''
      const ownerFlag = OWNER_SRC.test(src) ? 'owner booking' : MANUAL_SRC.test(src) ? 'manual / block' : (ownerName && nameMatches(r.guest_name, ownerName) ? 'name matches owner' : '')
      const base: any = {
        listingId: lid, reservationId: str(r.id) || null, unit: li.name || 'Unknown unit', market: li.market || '', building: li.building || '',
        guest: str(r.guest_name) || 'Guest', guestId: str(r.guest_id) || null, phone: str(r.guest_phone), nights: r.nights != null ? Number(r.nights) : null,
        source: src, checkIn: ci, checkOut: co, ownerFlag, owner: ownerName || null,
        notes: str(r.notes).slice(0, 160), vendor: li.vendor || null,
        bookedAt: str(r.created_at) || null,
        // WALK-IN WATCH: a stay booked today (or booked after the last sync) is the one the field
        // team has not heard about. These are the arrivals that break a day.
        bookedToday: !!r.created_at && etDate(r.created_at) === ymd(new Date()),
        bookedAfterSync: !!(cutoffIso && r.created_at && new Date(str(r.created_at)).getTime() > new Date(cutoffIso).getTime()),
        lateBooking: !!(r.created_at && ci && daysBetween(etDate(r.created_at), ci) <= 1),
        checkInTime: fmt12(li.checkIn), checkOutTime: fmt12(li.checkOut), bedrooms: li.bedrooms ?? null,
        address: li.address || null, doorCode: li.doorCode || null, lat: li.lat ?? null, lng: li.lng ?? null,
      }
      if (ci === date) arrivals.push(base)
      if (co === date) departures.push(base)
      if (ownerFlag && ci <= date && co > date) ownerStays.push(base)
    }
    // ---- LAST CHECKED / CLEANED ------------------------------------------------------------
    // The question the ops manager is really asking about a unit nobody is cleaning today is
    // "when was somebody last IN there, and what did they do?" — a clean, an inspection, a unit
    // check, a quality audit or a maintenance visit all count as eyes on the unit.
    //
    // THIS QUERY USED TO LIE. It asked for 60 days of tasks across ALL 232 listings with
    // limit(6000) and no ORDER BY, so PostgREST returned an arbitrary 6000 rows and whole
    // buildings fell off the end — which is why 17WEST, Elser, Oasis and Pelican all printed
    // "no record" while Eden printed real dates. It is now scoped to the handful of units that
    // actually appear on the sheet, ordered newest-first, and reaches back far enough that a real
    // "never logged" answer is trustworthy.
    // Vacant ids are needed before the touch lookup so an empty unit with a guest coming can also
    // report when somebody was last inside it.
    const vacantIds = Object.keys(lmap).filter(id => lmap[id].active && !occupied[id] && inMarket(id))
    const lastTouchOf: Record<string, any> = {}
    const lastCleanOf: Record<string, any> = {}
    let touchLookupOk = true
    const take = (k: string, when: string, nm: string, dept: string, assignees: any) => {
      if (!k || !when) return
      const { kind, clean } = classifyTouch(nm, dept)
      const who = (Array.isArray(assignees) ? assignees : []).map((p: any) => str(p.name)).filter(Boolean)
      const row = { at: when, kind, name: taskLabel(nm).slice(0, 80), who, daysAgo: daysBetween(when, date) }
      if (!lastTouchOf[k] || when > lastTouchOf[k].at) lastTouchOf[k] = row
      if (clean && (!lastCleanOf[k] || when > lastCleanOf[k].at)) lastCleanOf[k] = row
    }
    try {
      const needIds = Array.from(new Set([
        ...arrivals.map(a => a.listingId),
        ...departures.map(d => d.listingId),
        ...vacantIds,
      ])).filter(Boolean)
      // 25 units x 400 days stays comfortably under the row cap, so nothing is silently truncated.
      const CHUNK = 25
      for (let i = 0; i < needIds.length; i += CHUNK) {
        const slice = needIds.slice(i, i + CHUNK)
        if (!slice.length) continue
        const { data: prior, error } = await db.from('breezeway_tasks_sync')
          .select('reference_property_id,name,scheduled_date,finished_at,status,assignees,type_department')
          .in('reference_property_id', slice)
          .lt('scheduled_date', date)
          .gte('scheduled_date', addDays(date, -400))
          .order('scheduled_date', { ascending: false })
          .limit(5000)
        if (error) { touchLookupOk = false; continue }
        for (const t of ((prior || []) as any[])) {
          const st = str(t.status).toLowerCase()
          if (isGone(st)) continue
          // it only counts if it actually HAPPENED
          if (!t.finished_at && !isDone(st)) continue
          // finished_at is a UTC timestamp: anything finished after 8pm ET reads as tomorrow unless
          // it is converted first.
          const when = t.finished_at ? etDate(t.finished_at) : str(t.scheduled_date).slice(0, 10)
          if (!when) continue
          take(str(t.reference_property_id), when, str(t.name), str(t.type_department), t.assignees)
        }
      }
      // Work FINISHED TODAY counts too — a unit inspected at 9am with a 4pm arrival was reporting a
      // touch from days ago, and could even raise a "never checked" alarm.
      for (const t of tasks) {
        const st = str(t.status).toLowerCase()
        if (isGone(st)) continue
        if (!t.finished_at && !isDone(st)) continue
        take(str(t.reference_property_id), t.finished_at ? etDate(t.finished_at) : date, str(t.name), str(t.type_department), t.assignees)
      }
    } catch { touchLookupOk = false }

    // enrich departures with the clean and the next arrival
    for (const d of departures) {
      const lid = d.listingId
      const c = cleanByListing[lid]
      d.clean = c ? { id: c.id, status: c.status, assignees: c.assignees, name: c.name, label: c.label, instructions: c.instructions } : null
      // strip / walkthrough booked on the same unit — real work, shown here rather than dumped into
      // the work-order sheet where it looked like a mystery duplicate clean.
      d.prep = (prepByListing[lid] || []).map((x: any) => ({ id: x.id, label: x.label, instructions: x.instructions, status: x.status, assignees: x.assignees }))
      d.nextArrival = nextArrivalOf[lid] || null
      const arr = arrivals.find(a => a.listingId === lid)
      // EXTENSION, NOT A TURNOVER. When the same guest checks out and straight back in on the same
      // day, Guesty has two reservations but the field sees one stay: the guest and their luggage
      // never leave. Calling that a same-day turn sends a cleaner in to strip an occupied unit.
      const samePhone = (a: any, b: any) => {
        const x = str(a).replace(/\D/g, ''), y = str(b).replace(/\D/g, '')
        return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9)
      }
      // IDENTITY, NOT RESEMBLANCE. The first version matched on surname + first initial, which makes
      // "Jose Garcia" out and "Juan Garcia" in the same person — and two bookings with no guest name
      // both normalise to "Guest", so every nameless pair looked like an extension. Getting this
      // wrong stands a cleaner down on a real turnover, so it now needs a hard identifier.
      const realName = (x: any) => { const n = str(x).trim(); return n && n.toLowerCase() !== 'guest' ? n.toLowerCase().replace(/\s+/g, ' ') : '' }
      d.extension = !!(arr && (
        (d.guestId && arr.guestId && d.guestId === arr.guestId) ||
        samePhone(d.phone, arr.phone) ||
        (realName(d.guest) !== '' && realName(d.guest) === realName(arr.guest))
      ))
      if (arr) arr.extension = d.extension
      d.sameDayTurn = !!arr
      d.sameDayGuest = arr ? arr.guest : null
      d.sameDayIn = arr ? (arr.checkInTime || '4:00 PM') : null
      d.sameDayNights = arr ? arr.nights : null
      d.lastTouch = lastTouchOf[lid] || null
    }
    for (const a of arrivals) {
      const dep = departures.find(d => d.listingId === a.listingId)
      a.sameDayTurn = !!dep
      // The question that matters on the arrivals sheet: is anyone touching this unit today?
      // Read the clean directly: a unit can have a clean booked today with no checkout today (the
      // guest left yesterday), and that arrival was being sent to the "nobody is cleaning this" list.
      const ct = cleanByListing[a.listingId]
      a.cleanToday = ct ? { status: ct.status, assignees: ct.assignees, label: ct.label } : null
      const touch = lastTouchOf[a.listingId] || null
      const cl = lastCleanOf[a.listingId] || null
      a.lastTouch = touch                                  // anybody in the unit, of any kind
      a.lastClean = cl                                     // the last actual clean
      a.lastCleanedAt = cl ? cl.at : null                  // kept for older callers
      // Why is there no answer? An honest reason beats a blank.
      a.lastTouchReason = touch ? null
        : a.vendor ? 'vendor'                              // vendor cleans it, nothing lands in Breezeway
        : !touchLookupOk ? 'lookup-failed'                 // say so rather than imply neglect
        : 'never-logged'
    }

    const sortUnit = (a: any, b: any) => (a.market || '').localeCompare(b.market || '') || a.unit.localeCompare(b.unit)
    arrivals.sort(sortUnit); departures.sort(sortUnit); ownerStays.sort(sortUnit)

    // ---- vacant units (active, nobody in-house on the date)
    // NEXT ARRIVAL is the whole point of this list — an empty unit with a guest coming Friday is a
    // different job from one empty for a month. It used to read from a query that stopped at
    // tomorrow, so almost every row printed a blank; it now looks 45 days ahead.
    const vacants = vacantIds
      .map(id => {
        const na = nextArrivalOf[id] || null
        const touch = lastTouchOf[id] || null
        return {
          listingId: id, unit: lmap[id].name, market: lmap[id].market, bedrooms: lmap[id].bedrooms,
          nextArrival: na, daysUntilArrival: na ? daysBetween(date, na) : null,
          arrivingSoon: !!(na && daysBetween(date, na) <= 3),
          departedToday: checkoutIds.has(id),
          lastTouch: touch, lastTouchAt: touch ? touch.at : null,
          idleDays: touch ? touch.daysAgo : null,
          vendor: lmap[id].vendor || null, address: lmap[id].address || null,
          lat: lmap[id].lat ?? null, lng: lmap[id].lng ?? null,
        }
      })
      .sort((a, b) => (a.nextArrival || '9999-12-31').localeCompare(b.nextArrival || '9999-12-31') || a.unit.localeCompare(b.unit))

    // ---- open glitches (guest-reported issues still live)
    const glitches = ((gRes.data || []) as any[])
      .map(g => ({ id: str(g.id), unit: str(g.unit), overview: str(g.overview).slice(0, 140), status: str(g.status), at: str(g.created_at).slice(0, 10), taskId: g.breezeway_task_id ? str(g.breezeway_task_id) : null }))
      .sort((a, b) => a.at.localeCompare(b.at))

    // EXCEPTIONS — the cross-checks that decide whether the day is under control.
    // Jon: "it needs to be easy to understand." So every row is now plain English and split in two:
    // PROBLEM says what is wrong, ACTION says what to do about it. No task jargon, no raw Breezeway
    // strings, no "confirm in Breezeway" hand-waving.
    type Exc = { kind: string; unit: string; detail: string; action: string; severity: 'high' | 'med' }
    const exceptions: Exc[] = []
    const add = (severity: 'high' | 'med', kind: string, unit: string, detail: string, action: string) =>
      exceptions.push({ kind, unit, detail, action, severity })

    const extensionListings = new Set(departures.filter(d => d.extension).map(d => d.listingId))

    for (const d of departures) {
      // The extension warning sits ABOVE the vendor skip on purpose: a vendor crew stripping a unit
      // the guest never left is the same incident, and Botanica is exactly where it showed up.
      if (d.extension) add('high', 'Guest is staying on', d.unit,
        d.guest + ' checks out and books straight back in today, so nobody actually leaves.',
        'Do not strip the unit. Ask ' + d.guest + ' whether they want a clean, then book one if they say yes.')
      if (d.nights != null && d.nights >= 10) add('med', 'Long stay ending', d.unit,
        d.guest + ' was here ' + d.nights + ' nights.',
        'Allow extra time — laundry, fridge, kitchen and bins all take longer after a long stay.')
      if (d.vendor) continue
      // Has this guest actually left yet?
      const outMin = minutesOfDay(d.checkOutTime) ?? 11 * 60
      const inMin = minutesOfDay(d.sameDayIn) ?? 16 * 60
      const gone = nowMin >= outMin + GRACE

      if (!d.clean) {
        // A missing clean is a PLANNING failure and worth raising whatever the hour — but before the
        // guest has left it is a "book it" note, not an alarm, unless someone arrives today.
        if (d.sameDayTurn) add('high', 'No clean booked', d.unit,
          d.guest + ' checks out at ' + (d.checkOutTime || '11:00 AM') + ' and a guest arrives at ' + (d.sameDayIn || '4:00 PM') + ' — nothing is on the board to clean it.',
          'Book a clean and put a name on it now.')
        else add(gone ? 'high' : 'med', 'No clean booked', d.unit,
          d.guest + (gone ? ' has checked out' : ' checks out at ' + (d.checkOutTime || '11:00 AM')) + ' and nothing is on the board to clean it.',
          'Book a clean in Breezeway.')
      }
      else if (!(d.clean.assignees || []).length && d.clean.status !== 'done') add('high', 'Nobody assigned', d.unit,
        'The ' + (d.clean.label || 'departure clean').toLowerCase() + ' has no cleaner on it.',
        'Assign a cleaner in the scheduler.')

      // NOT STARTED IS ONLY LATE ONCE THE UNIT IS EMPTY. Before checkout the cleaner is not allowed
      // in, so flagging it just trains people to ignore the sheet.
      if (!d.extension && d.sameDayTurn && d.clean && d.clean.status !== 'done') {
        if (d.clean.status === 'in progress') {
          // running, but is there enough runway before the arrival?
          if (nowMin > inMin - 90) add('high', 'Same-day turn running late', d.unit,
            'A guest arrives at ' + (d.sameDayIn || '4:00 PM') + ' and the clean is still in progress.',
            'Check with the cleaner — it needs to be finished and inspected before they arrive.')
        } else if (gone) {
          add('high', 'Clean not started', d.unit,
            d.guest + ' left at ' + (d.checkOutTime || '11:00 AM') + ', a guest arrives at ' + (d.sameDayIn || '4:00 PM') + ', and nobody has started.',
            'Get someone into the unit now.')
        }
        // before checkout + grace: not an exception. The guest is still in the unit.
      }
    }

    // A clean booked on a unit with no checkout today used to appear on no sheet at all — the
    // cleaner would be standing in a unit Roberto's paper never mentioned.
    for (const lid of Object.keys(cleanByListing)) {
      if (departures.some(d => d.listingId === lid)) continue
      const c = cleanByListing[lid]
      add('med', 'Clean with no checkout', c.unit === 'Unit' ? 'Unknown unit' : c.unit,
        'A ' + (c.label || 'clean').toLowerCase() + ' is booked today but nobody checked out of this unit.',
        'Either it was moved from another day, or it is on the wrong unit — check before sending anyone.')
    }

    for (const a of arrivals) {
      if (a.nights != null && a.nights >= 10) add('med', 'Long booking arriving', a.unit,
        a.guest + ' is booked for ' + a.nights + ' nights, arriving ' + (a.checkInTime || '4:00 PM') + '.',
        'Walk the unit properly — a long stay notices everything.')
      if (a.bookedAfterSync || a.bookedToday) add('high', 'Booked today (walk-in)', a.unit,
        a.guest + ' booked this stay TODAY (' + (a.nights || '?') + ' nights, in at ' + (a.checkInTime || '4:00 PM') + ').',
        'Nobody planned for this one. Check the unit is clean and someone is covering it.')
      // No clean today, and not an extension, so the only assurance is when somebody was last inside.
      if (a.cleanToday || a.vendor || a.extension) continue
      if (!a.lastTouch) add('high', 'Nobody has been in this unit', a.unit,
        'No clean, inspection or visit on record, and nothing booked today.',
        'Walk it before ' + (a.checkInTime || '4:00 PM') + '.')
      else if (a.lastTouch.daysAgo >= 14) add('med', 'Empty for ' + a.lastTouch.daysAgo + ' days', a.unit,
        'Last touched ' + a.lastTouch.daysAgo + ' days ago (' + a.lastTouch.kind.toLowerCase() + ').',
        'Run the water, check the A/C and dust before ' + (a.checkInTime || 'check-in') + '.')
    }

    for (const dc of dupCleans) add('med', 'Two cleans booked', dc.unit,
      'Two separate cleans are on this unit today: ' + dc.a + ' and ' + dc.b + '.',
      'One is probably a duplicate — cancel the extra so two cleaners are not sent.')

    // A background feed that quietly stopped is invisible until something looks wrong on the floor.
    const deadFeeds = (sync.feeds || []).filter((f: any) => f.entity !== 'auth' && (f.ageMin == null || f.ageMin > 24 * 60))
    if (deadFeeds.length) add('med', 'A background sync has stopped', '—',
      deadFeeds.map((f: any) => f.entity + ' (' + (f.ageMin == null ? 'never' : Math.round(f.ageMin / 60) + 'h ago') + ')').join(', ') + '.',
      'Bookings and tasks are still current, but unit names, door codes and reviews may be out of date. Tell Jon.')
    for (const ins of (((iRes as any).data || []) as any[])) {
      if (!ins.follow_up) continue
      add('med', 'Inspection needs a follow-up', str(ins.unit),
        str(ins.inspector || 'The coordinator') + ' flagged this after walking the unit' + (ins.cleaner ? ' (cleaned by ' + str(ins.cleaner) + ')' : '') + ': ' + str(ins.notes).slice(0, 160),
        'Decide whether it needs a task, a re-clean, or a word with the cleaner.')
    }
    if (unknownListings.size) add('high', 'Booking on an unknown unit', '—',
      unknownListings.size + ' booking' + (unknownListings.size === 1 ? '' : 's') + ' point at a listing that is not in our listing list, so the unit name, door code and address are missing.',
      'Re-sync listings from Guesty; if it persists the listing was deleted or renamed.')
    if (sync.stale) add('high', 'This sheet may be out of date', '—',
      sync.staleReason || 'One of the feeds is behind.',
      'Press Refresh. Anything booked or changed since then is NOT on this sheet.')

    // One row per unit rather than one per task: a unit with four open jobs was printing four
    // near-identical "guest in house" lines.
    const guestInHouse: Record<string, { unit: string; jobs: string[] }> = {}
    const unassigned: Record<string, { unit: string; jobs: string[] }> = {}
    const occupiedNow = new Set(Object.keys(occupied))
    for (const w of work) {
      const lid = w.listingId
      if (!w.assignees.length && w.status !== 'done') {
        (unassigned[lid] = unassigned[lid] || { unit: w.unit, jobs: [] }).jobs.push(w.label || w.name)
      }
      // An extension keeps the guest in the unit all day even though there IS a checkout on paper,
      // so the checkout no longer cancels this warning.
      // Only warn about work that still has to happen. A job finished at 2:45pm needs no
      // "call the guest before entering" note — that is yesterday's problem, printed as today's.
      // If the unit has a checkout today and that hour has passed, the guest is gone and the
      // "call before entering" warning is noise.
      const dep = departures.find(x => x.listingId === lid)
      const guestLeft = !!dep && !dep.extension && nowMin >= (minutesOfDay(dep.checkOutTime) ?? 11 * 60) + GRACE
      if (w.status !== 'done' && !guestLeft && lid && occupiedNow.has(lid) && (!checkoutIds.has(lid) || extensionListings.has(lid))) {
        (guestInHouse[lid] = guestInHouse[lid] || { unit: w.unit, jobs: [] }).jobs.push(w.label || w.name)
      }
    }
    const jobList = (j: string[]) => j.slice(0, 4).join(', ') + (j.length > 4 ? ' and ' + (j.length - 4) + ' more' : '')
    for (const k of Object.keys(guestInHouse)) {
      const g = guestInHouse[k]
      add('high', 'Guest is still in the unit', g.unit,
        g.jobs.length + (g.jobs.length === 1 ? ' job is' : ' jobs are') + ' booked while the guest is in house: ' + jobList(g.jobs) + '.',
        'Call or message the guest before anyone enters.')
    }
    for (const k of Object.keys(unassigned)) {
      const u = unassigned[k]
      add('med', 'Nobody assigned', u.unit,
        u.jobs.length + (u.jobs.length === 1 ? ' job has' : ' jobs have') + ' no name on them: ' + jobList(u.jobs) + '.',
        'Assign someone or move it to another day.')
    }

    const sevRank = (s: string) => (s === 'high' ? 0 : 1)
    exceptions.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.unit.localeCompare(b.unit))

    // Independent recount straight off the raw reservation rows.
    const recountIds = new Set<string>()
    for (const r of ((rRes.data || []) as any[])) {
      const lid = String(r.listing_id)
      if (!lmap[lid] || !lmap[lid].active || !inMarket(lid)) continue
      if (staySpans(r, date)) recountIds.add(lid)
    }
    const recountOccupied = recountIds.size
    // If a query came back at its cap we cannot promise the list is complete — say so out loud.
    const reservationsTruncated = ((rRes.data || []) as any[]).length >= 3000
    const futureTruncated = ((fRes.data || []) as any[]).length >= 4000
    if (reservationsTruncated || futureTruncated) add('high', 'Booking list may be incomplete', '—',
      'The sheet hit its limit while reading bookings, so some may be missing.',
      'Tell Jon — this needs a code change, do not plan the day off this sheet alone.')

    const lastSync = bzSyncAt
    const markets = Array.from(new Set(Object.keys(lmap).map(k => lmap[k].market).filter(Boolean))).sort()
    return ({
      ok: true, date, market: marketQ, markets, generatedAt: new Date().toISOString(),
      counts: {
        arrivals: arrivals.length, departures: departures.length, ownerStays: ownerStays.length,
        work: work.length, vacants: vacants.length, glitches: glitches.length, exceptions: exceptions.length,
        walkIns: arrivals.filter(a => a.bookedToday || a.bookedAfterSync).length,
        neverChecked: arrivals.filter(a => !a.cleanToday && !a.vendor && !a.lastTouch).length,
        sameDayTurns: departures.filter(d => d.sameDayTurn && !d.extension).length,
        extensions: departures.filter(d => d.extension).length,
        cleansDone: Object.values(cleanByListing).filter((c: any) => c.status === 'done').length,
        cleansTotal: Object.keys(cleanByListing).length,
      },
      arrivals, departures, ownerStays, work, vacants, glitches, exceptions, lastSync, sync,
      inspections: ((iRes as any).data || []).map((r: any) => ({
        id: str(r.id), unit: str(r.unit), cleaner: str(r.cleaner) || null,
        rating: r.rating == null ? null : Number(r.rating), notes: str(r.notes),
        followUp: !!r.follow_up, inspector: str(r.inspector) || null,
      })),
      // walk-in watch, surfaced as its own number so it can be read at a glance
      walkIns: arrivals.filter(a => a.bookedToday || a.bookedAfterSync).length,
      // SELF-AUDIT: the sheet shows its own arithmetic so a wrong number is visible, not hidden.
      // active listings = occupied tonight + vacant tonight, always.
      audit: {
        activeListings: Object.keys(lmap).filter(id => lmap[id].active && inMarket(id)).length,
        occupiedTonight: Object.keys(lmap).filter(id => lmap[id].active && occupied[id] && inMarket(id)).length,
        vacantTonight: vacants.length,
        // A REAL cross-check, not arithmetic that cannot fail. `occupied` is built inside the
        // reservation loop; this recounts occupancy from the raw rows through the shared staySpans
        // rule and from a separate truncation guard. If those disagree, the vacant list is wrong and
        // the sheet says so instead of printing a reassuring tick.
        balances: recountOccupied === Object.keys(lmap).filter(id => lmap[id].active && occupied[id] && inMarket(id)).length
          && !reservationsTruncated && !futureTruncated,
        recountOccupied, reservationsTruncated, futureTruncated,
        vacantsWithArrivalWithin7: vacants.filter(v => v.daysUntilArrival != null && v.daysUntilArrival <= 7).length,
        vacantsNoFutureBooking: vacants.filter(v => !v.nextArrival).length,
        reservationsRead: ((rRes.data || []) as any[]).length,
        futureReservationsRead: ((fRes.data || []) as any[]).length,
        touchLookupOk,
      },
    })

}

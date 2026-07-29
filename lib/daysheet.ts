// DAY SHEET BUILDER — one source of truth for the ops day, used by BOTH the in-app sheets and the
// password-protected share link. If these ever diverged, the paper and the phone would disagree,
// which is exactly the failure this whole feature exists to prevent.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex, vendorNameOf } from '@/lib/ops-presets'
import { isLiveStay } from '@/lib/stay-status'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
// Occupancy uses the ONE shared rule (lib/stay-status). The sheet used to carry its own
// /confirm|check/ regex, which quietly dropped statuses like 'closed' — a unit reading free while
// a guest is in it is exactly how a walk-in happens.
const isLive = (s: string) => isLiveStay(s)
const isDone = (s: string) => /complete|finish|close|approv/.test(str(s).toLowerCase())
const isGone = (s: string) => /delete|cancel/.test(str(s).toLowerCase())
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
function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / 86400000)
}

export async function buildDaySheet(dateIn?: string, marketIn?: string): Promise<any> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(dateIn)) ? str(dateIn) : ymd(new Date())
  const marketQ = str(marketIn) || 'all'
    const db = supabaseAdmin()
    const presets = await getOpsPresets()
    const VENDOR_RE = vendorRegex(presets.vendorBuildings)

    const [lRes, tRes, rRes, oRes, gRes, sRes, fRes, gsRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city,address_full,status,bedrooms:raw->>bedrooms,checkIn:raw->>defaultCheckInTime,checkOut:raw->>defaultCheckOutTime,cf:raw->customFields,lat:raw->address->>lat,lng:raw->address->>lng'),
      db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,started_at,finished_at,type_department,report_url').eq('scheduled_date', date).limit(3000),
      db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status,guest_name,guest_phone,nights,source,notes,money_total,created_at')
        .lte('check_in', addDays(date, 1)).gte('check_out', date).limit(3000),
      db.from('guesty_owners').select('id,full_name,listing_ids').limit(2000),
      db.from('glitches').select('id,unit,listing_id,overview,status,created_at,breezeway_task_id').not('status', 'in', '("done","resolved","closed")').limit(300),
      db.from('breezeway_tasks_sync').select('synced_at').order('synced_at', { ascending: false }).limit(1),
      // NEXT ARRIVAL — a separate forward look. The day window above stops at tomorrow, so the
      // vacant list used to sort on a next-arrival it could not actually see.
      db.from('guesty_reservations').select('listing_id,check_in,status')
        .gt('check_in', date).lte('check_in', addDays(date, 45)).limit(4000),
      // How fresh is the RESERVATION feed? Breezeway freshness alone says nothing about whether a
      // booking made an hour ago is on this sheet.
      db.from('guesty_sync_status').select('entity,last_sync_at,last_error').limit(20),
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
    const syncRows = ((gsRes.data || []) as any[])
    const resSyncRow = syncRows.find(r => str(r.entity) === 'reservations')
    const bzSyncAt = ((sRes.data || []) as any[])[0]?.synced_at || null
    const resSyncAt = resSyncRow ? str(resSyncRow.last_sync_at) || null : null
    const ageMin = (iso: any) => { const t = new Date(str(iso)).getTime(); return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null }
    const bzAge = ageMin(bzSyncAt), resAge = ageMin(resSyncAt)
    const STALE_MIN = 150   // the Breezeway cron runs every 2h; 2.5h means a run was missed
    const sync = {
      breezewayAt: bzSyncAt, breezewayAgeMin: bzAge,
      reservationsAt: resSyncAt, reservationsAgeMin: resAge,
      reservationsError: resSyncRow ? (str(resSyncRow.last_error) || null) : null,
      stale: (bzAge == null || bzAge > STALE_MIN) || (resAge == null || resAge > STALE_MIN),
      staleReason: [
        bzAge == null ? 'Breezeway sync time unknown' : bzAge > STALE_MIN ? 'Breezeway last synced ' + bzAge + ' min ago' : '',
        resAge == null ? 'Reservation sync time unknown' : resAge > STALE_MIN ? 'Guesty reservations last synced ' + resAge + ' min ago' : '',
        resSyncRow && str(resSyncRow.last_error) ? 'Reservation sync error: ' + str(resSyncRow.last_error).slice(0, 120) : '',
      ].filter(Boolean).join(' · ') || null,
    }
    // A booking made after the last reservation sync CANNOT be on this sheet. Say so out loud.
    const cutoffIso = resSyncAt || null

    // ---- tasks for the day, split into cleans vs everything else
    const tasks = ((tRes.data || []) as any[]).filter(t => !isGone(t.status))
    const cleanByListing: Record<string, any> = {}
    const dupCleans: { unit: string; a: string; b: string }[] = []
    const work: any[] = []
    for (const t of tasks) {
      const lid = String(t.reference_property_id)
      if (!inMarket(lid)) continue
      const nm = str(t.name)
      const li = lmap[lid] || {}
      const who = (Array.isArray(t.assignees) ? t.assignees : []).map((p: any) => str(p.name)).filter(Boolean)
      const row = {
        id: str(t.id), listingId: lid, unit: li.name || 'Unit', market: li.market || '', name: nm,
        dept: str(t.type_department), assignees: who,
        status: isDone(t.status) ? 'done' : (t.started_at ? 'in progress' : 'not started'),
        startedAt: hhmm(t.started_at), finishedAt: hhmm(t.finished_at), reportUrl: t.report_url || null,
      }
      if (/departure clean|turnover clean|strip|walkthrough/i.test(nm)) {
        // Two cleans on one unit on one day is a data problem, not a plan. Keep the one that is
        // furthest along so the sheet never reports "not started" while a clean is finished, and
        // record the collision so it surfaces in the exceptions block.
        const cur = cleanByListing[lid]
        const rank = (x: any) => (x.status === 'done' ? 2 : x.status === 'in progress' ? 1 : 0)
        if (!cur) cleanByListing[lid] = row
        else { dupCleans.push({ unit: row.unit, a: cur.name, b: row.name }); if (rank(row) > rank(cur)) cleanByListing[lid] = row }
      }
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
      if (ci <= date && co > date) occupied[lid] = true
      if (ci > date && (!nextArrivalOf[lid] || ci < nextArrivalOf[lid])) nextArrivalOf[lid] = ci
      if (co === date) checkoutIds.add(lid)
      if (!inMarket(lid)) continue
      const src = str(r.source)
      const ownerName = ownerOf[lid] || ''
      const ownerFlag = OWNER_SRC.test(src) ? 'owner booking' : MANUAL_SRC.test(src) ? 'manual / block' : (ownerName && nameMatches(r.guest_name, ownerName) ? 'name matches owner' : '')
      const base: any = {
        listingId: lid, reservationId: str(r.id) || null, unit: li.name || 'Unit', market: li.market || '', building: li.building || '',
        guest: str(r.guest_name) || 'Guest', phone: str(r.guest_phone), nights: r.nights != null ? Number(r.nights) : null,
        source: src, checkIn: ci, checkOut: co, ownerFlag, owner: ownerName || null,
        notes: str(r.notes).slice(0, 160), vendor: li.vendor || null,
        bookedAt: str(r.created_at) || null,
        // WALK-IN WATCH: a stay booked today (or booked after the last sync) is the one the field
        // team has not heard about. These are the arrivals that break a day.
        bookedToday: str(r.created_at).slice(0, 10) === ymd(new Date()),
        bookedAfterSync: !!(cutoffIso && r.created_at && new Date(str(r.created_at)).getTime() > new Date(cutoffIso).getTime()),
        lateBooking: !!(r.created_at && ci && daysBetween(str(r.created_at).slice(0, 10), ci) <= 1),
        checkInTime: li.checkIn || null, checkOutTime: li.checkOut || null, bedrooms: li.bedrooms ?? null,
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
          const when = str(t.finished_at || t.scheduled_date).slice(0, 10)
          if (!when) continue
          const k = str(t.reference_property_id)
          const nm = str(t.name)
          const { kind, clean } = classifyTouch(nm, str(t.type_department))
          const who = (Array.isArray(t.assignees) ? t.assignees : []).map((p: any) => str(p.name)).filter(Boolean)
          const row = { at: when, kind, name: nm.slice(0, 80), who, daysAgo: daysBetween(when, date) }
          if (!lastTouchOf[k] || when > lastTouchOf[k].at) lastTouchOf[k] = row
          if (clean && (!lastCleanOf[k] || when > lastCleanOf[k].at)) lastCleanOf[k] = row
        }
      }
    } catch { touchLookupOk = false }

    // enrich departures with the clean and the next arrival
    for (const d of departures) {
      const lid = d.listingId
      const c = cleanByListing[lid]
      d.clean = c ? { id: c.id, status: c.status, assignees: c.assignees, name: c.name } : null
      d.nextArrival = nextArrivalOf[lid] || null
      const arr = arrivals.find(a => a.listingId === lid)
      // EXTENSION, NOT A TURNOVER. When the same guest checks out and straight back in on the same
      // day, Guesty has two reservations but the field sees one stay: the guest and their luggage
      // never leave. Calling that a same-day turn sends a cleaner in to strip an occupied unit.
      const samePhone = (a: any, b: any) => {
        const x = str(a).replace(/\D/g, ''), y = str(b).replace(/\D/g, '')
        return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9)
      }
      d.extension = !!(arr && (nameMatches(d.guest, arr.guest) || samePhone(d.phone, arr.phone)))
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
      a.cleanToday = dep && dep.clean ? { status: dep.clean.status, assignees: dep.clean.assignees } : null
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

    // EXCEPTIONS — the cross-checks that decide whether the day is actually under control.
    // Computed here (one source) so the paper and the screen can never disagree.
    const exceptions: { kind: string; unit: string; detail: string; severity: 'high' | 'med' }[] = []
    for (const d of departures) {
      if (d.vendor) continue
      if (!d.clean) exceptions.push({ kind: 'No clean on the board', unit: d.unit, detail: 'Guest ' + d.guest + ' checks out today and there is no departure clean scheduled', severity: 'high' })
      else if (!(d.clean.assignees || []).length && d.clean.status !== 'done') exceptions.push({ kind: 'Clean unassigned', unit: d.unit, detail: (d.clean.name || 'Departure clean') + ' has nobody on it', severity: 'high' })
      if (d.extension) exceptions.push({ kind: 'Extension — same guest re-booked', unit: d.unit, detail: d.guest + ' books straight back in today, so the guest never leaves. Do NOT strip the unit — ASK THE GUEST whether they want a clean, then schedule it if they do', severity: 'high' })
      else if (d.sameDayTurn && d.clean && d.clean.status !== 'done') exceptions.push({ kind: 'Same-day turn not done', unit: d.unit, detail: 'Guest arrives today; clean is ' + d.clean.status, severity: 'high' })
      if (d.nights != null && d.nights >= 10) exceptions.push({ kind: 'Long stay out', unit: d.unit, detail: d.nights + '-night stay ended — heavier clean, allow extra time', severity: 'med' })
    }
    for (const a of arrivals) {
      if (a.nights != null && a.nights >= 10) exceptions.push({ kind: 'Long booking arriving', unit: a.unit, detail: a.nights + ' nights' + (a.guest ? ' (' + a.guest + ')' : '') + ' — check the unit is fully ready', severity: 'med' })
    }
    for (const a of arrivals) {
      // Nobody is cleaning it today — so the only assurance the unit is fit for a guest is when
      // somebody was last in it. Nothing in 400 days, or an old touch, is a walk-the-unit order.
      if (a.cleanToday || a.vendor) continue
      if (!a.lastTouch) {
        exceptions.push({ kind: 'Never checked', unit: a.unit, detail: 'No clean, inspection or visit on record and no clean today — walk it before ' + (a.checkInTime || '4:00 PM'), severity: 'high' })
      } else if (a.lastTouch.daysAgo >= 14) {
        exceptions.push({ kind: 'Unit sat idle', unit: a.unit, detail: 'Last touched ' + a.lastTouch.daysAgo + ' days ago (' + a.lastTouch.kind.toLowerCase() + ') — dust, water, A/C before ' + (a.checkInTime || 'check-in'), severity: 'med' })
      }
    }
    for (const a of arrivals) {
      if (a.bookedAfterSync || a.bookedToday) {
        exceptions.push({ kind: 'Booked today', unit: a.unit, detail: 'Walk-in / same-day booking (' + a.guest + ', ' + (a.nights || '?') + ' nt) — confirm the unit is ready and staffed', severity: 'high' })
      }
    }
    for (const dc of dupCleans) {
      exceptions.push({ kind: 'Two cleans on one unit', unit: dc.unit, detail: dc.a + ' + ' + dc.b + ' — one is probably a duplicate, confirm in Breezeway', severity: 'med' })
    }
    if (sync.stale) {
      exceptions.push({ kind: 'Data may be stale', unit: '—', detail: (sync.staleReason || 'a feed is behind') + ' — anything booked or changed since then is NOT on this sheet', severity: 'high' })
    }
    for (const w of work) {
      if (!w.assignees.length && w.status !== 'done') exceptions.push({ kind: 'Work unassigned', unit: w.unit, detail: w.name, severity: 'med' })
    }
    // work scheduled into an occupied night (nobody should walk in on a guest)
    const occupiedNow = new Set(Object.keys(occupied))
    for (const w of work) {
      const lid = w.listingId
      if (lid && occupiedNow.has(lid) && !checkoutIds.has(lid)) {
        exceptions.push({ kind: 'Guest in house', unit: w.unit, detail: w.name + ' — guest is still in the unit, confirm before entering', severity: 'high' })
      }
    }
    const sevRank = (s: string) => (s === 'high' ? 0 : 1)
    exceptions.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.unit.localeCompare(b.unit))

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
      // walk-in watch, surfaced as its own number so it can be read at a glance
      walkIns: arrivals.filter(a => a.bookedToday || a.bookedAfterSync).length,
      // SELF-AUDIT: the sheet shows its own arithmetic so a wrong number is visible, not hidden.
      // active listings = occupied tonight + vacant tonight, always.
      audit: {
        activeListings: Object.keys(lmap).filter(id => lmap[id].active && inMarket(id)).length,
        occupiedTonight: Object.keys(lmap).filter(id => lmap[id].active && occupied[id] && inMarket(id)).length,
        vacantTonight: vacants.length,
        balances: Object.keys(lmap).filter(id => lmap[id].active && inMarket(id)).length ===
          Object.keys(lmap).filter(id => lmap[id].active && occupied[id] && inMarket(id)).length + vacants.length,
        vacantsWithArrivalWithin7: vacants.filter(v => v.daysUntilArrival != null && v.daysUntilArrival <= 7).length,
        vacantsNoFutureBooking: vacants.filter(v => !v.nextArrival).length,
        reservationsRead: ((rRes.data || []) as any[]).length,
        futureReservationsRead: ((fRes.data || []) as any[]).length,
        touchLookupOk,
      },
    })

}

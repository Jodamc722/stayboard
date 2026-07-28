// DAY SHEET — everything happening on one day, in one payload, built for PRINT.
// The ops manager walks out with this in hand: arrivals, departures, owner stays, maintenance and
// inspections, open glitches, and every vacant unit. Read-only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex, vendorNameOf } from '@/lib/ops-presets'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
const isLive = (s: string) => /confirm|check/i.test(str(s))
const isDone = (s: string) => /complete|finish|close|approv/.test(str(s).toLowerCase())
const isGone = (s: string) => /delete|cancel/.test(str(s).toLowerCase())
const hhmm = (iso: any) => { const d = new Date(str(iso)); return isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d) }

// OWNER STAY detection, all three signals Jon asked for:
//   1. Guesty source is an owner booking ('owner', 'owner-guest')
//   2. Guesty source is 'manual' (staff-created block / comp stay)
//   3. the guest name matches the OWNER on file for that listing (guesty_owners.listing_ids)
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

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const presets = await getOpsPresets()
    const VENDOR_RE = vendorRegex(presets.vendorBuildings)
    const qd = str(req.nextUrl.searchParams.get('date'))
    const date = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : ymd(new Date())
    const marketQ = str(req.nextUrl.searchParams.get('market')) || 'all'

    const [lRes, tRes, rRes, oRes, gRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city,status,bedrooms:raw->>bedrooms,checkIn:raw->>defaultCheckInTime,checkOut:raw->>defaultCheckOutTime'),
      db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,started_at,finished_at,type_department,report_url').eq('scheduled_date', date).limit(3000),
      db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status,guest_name,guest_phone,nights,source,notes,money_total')
        .lte('check_in', addDays(date, 1)).gte('check_out', date).limit(3000),
      db.from('guesty_owners').select('id,full_name,listing_ids').limit(2000),
      db.from('glitches').select('id,unit,listing_id,overview,status,created_at,breezeway_task_id').not('status', 'in', '("done","resolved","closed")').limit(300),
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
      }
    }
    // listing -> owner name
    const ownerOf: Record<string, string> = {}
    for (const o of ((oRes.data || []) as any[])) {
      const nm = str(o.full_name)
      for (const id of (Array.isArray(o.listing_ids) ? o.listing_ids : [])) if (nm) ownerOf[String(id)] = nm
    }

    const inMarket = (lid: string) => marketQ === 'all' || (lmap[lid] && lmap[lid].market === marketQ)

    // ---- tasks for the day, split into cleans vs everything else
    const tasks = ((tRes.data || []) as any[]).filter(t => !isGone(t.status))
    const cleanByListing: Record<string, any> = {}
    const work: any[] = []
    for (const t of tasks) {
      const lid = String(t.reference_property_id)
      if (!inMarket(lid)) continue
      const nm = str(t.name)
      const li = lmap[lid] || {}
      const who = (Array.isArray(t.assignees) ? t.assignees : []).map((p: any) => str(p.name)).filter(Boolean)
      const row = {
        id: str(t.id), unit: li.name || 'Unit', market: li.market || '', name: nm,
        dept: str(t.type_department), assignees: who,
        status: isDone(t.status) ? 'done' : (t.started_at ? 'in progress' : 'not started'),
        startedAt: hhmm(t.started_at), finishedAt: hhmm(t.finished_at), reportUrl: t.report_url || null,
      }
      if (/departure clean|turnover clean|strip|walkthrough/i.test(nm)) cleanByListing[lid] = row
      else work.push(row)
    }
    work.sort((a, b) => (a.dept || '').localeCompare(b.dept || '') || a.unit.localeCompare(b.unit))

    // ---- reservations for the day
    const arrivals: any[] = []
    const departures: any[] = []
    const ownerStays: any[] = []
    const occupied: Record<string, boolean> = {}
    const nextArrivalOf: Record<string, string> = {}
    for (const r of ((rRes.data || []) as any[])) {
      if (!isLive(r.status)) continue
      const lid = String(r.listing_id)
      const li = lmap[lid] || {}
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      if (ci <= date && co > date) occupied[lid] = true
      if (ci > date && (!nextArrivalOf[lid] || ci < nextArrivalOf[lid])) nextArrivalOf[lid] = ci
      if (!inMarket(lid)) continue
      const src = str(r.source)
      const ownerName = ownerOf[lid] || ''
      const ownerFlag = OWNER_SRC.test(src) ? 'owner booking' : MANUAL_SRC.test(src) ? 'manual / block' : (ownerName && nameMatches(r.guest_name, ownerName) ? 'name matches owner' : '')
      const base: any = {
        listingId: lid, unit: li.name || 'Unit', market: li.market || '', building: li.building || '',
        guest: str(r.guest_name) || 'Guest', phone: str(r.guest_phone), nights: r.nights != null ? Number(r.nights) : null,
        source: src, checkIn: ci, checkOut: co, ownerFlag, owner: ownerName || null,
        notes: str(r.notes).slice(0, 160), vendor: li.vendor || null,
        checkInTime: li.checkIn || null, checkOutTime: li.checkOut || null, bedrooms: li.bedrooms ?? null,
      }
      if (ci === date) arrivals.push(base)
      if (co === date) departures.push(base)
      if (ownerFlag && ci <= date && co > date) ownerStays.push(base)
    }
    // enrich departures with the clean and the next arrival
    for (const d of departures) {
      const lid = d.listingId
      const c = cleanByListing[lid]
      d.clean = c ? { status: c.status, assignees: c.assignees, name: c.name } : null
      d.nextArrival = nextArrivalOf[lid] || null
      d.sameDayTurn = !!arrivals.find(a => a.listingId === lid)
    }
    for (const a of arrivals) a.sameDayTurn = !!departures.find(d => d.listingId === a.listingId)

    const sortUnit = (a: any, b: any) => (a.market || '').localeCompare(b.market || '') || a.unit.localeCompare(b.unit)
    arrivals.sort(sortUnit); departures.sort(sortUnit); ownerStays.sort(sortUnit)

    // ---- vacant units (active, nobody in-house on the date)
    const vacants = Object.keys(lmap)
      .filter(id => lmap[id].active && !occupied[id] && inMarket(id))
      .map(id => ({ unit: lmap[id].name, market: lmap[id].market, bedrooms: lmap[id].bedrooms, nextArrival: nextArrivalOf[id] || null, vendor: lmap[id].vendor || null }))
      .sort((a, b) => (a.nextArrival || '9999').localeCompare(b.nextArrival || '9999') || a.unit.localeCompare(b.unit))

    // ---- open glitches (guest-reported issues still live)
    const glitches = ((gRes.data || []) as any[])
      .map(g => ({ id: str(g.id), unit: str(g.unit), overview: str(g.overview).slice(0, 140), status: str(g.status), at: str(g.created_at).slice(0, 10), taskId: g.breezeway_task_id ? str(g.breezeway_task_id) : null }))
      .sort((a, b) => a.at.localeCompare(b.at))

    const markets = Array.from(new Set(Object.keys(lmap).map(k => lmap[k].market).filter(Boolean))).sort()
    return NextResponse.json({
      ok: true, date, market: marketQ, markets, generatedAt: new Date().toISOString(),
      counts: {
        arrivals: arrivals.length, departures: departures.length, ownerStays: ownerStays.length,
        work: work.length, vacants: vacants.length, glitches: glitches.length,
        sameDayTurns: departures.filter(d => d.sameDayTurn).length,
        cleansDone: Object.values(cleanByListing).filter((c: any) => c.status === 'done').length,
        cleansTotal: Object.keys(cleanByListing).length,
      },
      arrivals, departures, ownerStays, work, vacants, glitches,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

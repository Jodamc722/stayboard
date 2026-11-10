// THE BRAIN PAGE'S READS (admin / owner, read-only). One section per call so the page loads its
// summary first and each list only when it is opened:
//
//   ?section=summary   bands today, repeat failures, owners, what needs a person — the header
//   ?section=units     today's health rows, worst first, with owner + building + market for filters
//   ?section=repeats   unit × system with a strict repeat in 90 days, and every event of that pair
//                      in 180 days, newest first
//   ?section=owners    owner_month over the last 3 and 12 months
//   ?section=quality   table freshness, people to confirm, unknown buildings, units with no
//                      Breezeway home / no owner, the top "other" maintenance titles
//
// Fails open before migration 178: { ok: true, ready: false }.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { brainTables, BRAIN_TABLES, pageRead, todayET, addDays, round2, str } from '@/lib/brain/shared'
import { loadUnits, type DimUnit } from '@/lib/brain/spine'
import { recentMonths } from '@/lib/brain/rollups'
import { HEALTH_FORMULA } from '@/lib/brain/health'
import { SYSTEM_LABEL } from '@/lib/task-categories'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const H_COLS = 'physical_unit_id,listing_id,nickname,building_id,market,score,band,drivers,review_avg_live,review_n,low_reviews_90d,'
  + 'occupied_nights_90d,glitches_90d,glitches_per_100_nights,repeat_systems,pm_overdue_count,pm_max_days_late,last_inspection_pass,'
  + 'net_revenue_90d,upkeep_billed_90d,upkeep_cost_pct_rev,partial'

async function healthDay(): Promise<string | null> {
  const { data } = await supabaseAdmin().from('unit_health_daily').select('day').order('day', { ascending: false }).limit(1)
  const d = ((data || []) as any[])[0]?.day
  return d ? String(d).slice(0, 10) : null
}

async function ownerNames(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const r = await pageRead<any>((a, b) => supabaseAdmin().from('guesty_owners').select('id,full_name').order('id').range(a, b), 3)
  for (const o of r.rows) out[str(o.id)] = str(o.full_name)
  return out
}

async function buildingLabels(): Promise<Record<string, { label: string; known: boolean; units: number; market: string | null }>> {
  const out: Record<string, { label: string; known: boolean; units: number; market: string | null }> = {}
  const { data } = await supabaseAdmin().from('dim_building').select('id,label,known,units,market').limit(200) // deliberate cap: one row per building (~30)
  for (const b of ((data || []) as any[])) out[str(b.id)] = { label: str(b.label), known: b.known !== false, units: Number(b.units) || 0, market: b.market ? str(b.market) : null }
  return out
}

/** The owner of an apartment: the owner of the listing it is shown under, else any listing in it. */
function ownerOfPhysical(units: DimUnit[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const u of units) if (u.owner_id && (!out[u.physical_unit_id] || u.is_parent)) out[u.physical_unit_id] = u.owner_id
  return out
}

async function summary() {
  const db = supabaseAdmin()
  const day = await healthDay()
  const bands: Record<string, number> = {}
  let partialRows = 0
  if (day) {
    const r = await pageRead<any>((a, b) => db.from('unit_health_daily').select('physical_unit_id,band,partial').eq('day', day).order('physical_unit_id').range(a, b), 2)
    for (const h of r.rows) { bands[str(h.band)] = (bands[str(h.band)] || 0) + 1; if (h.partial === true) partialRows++ }
  }
  const since = addDays(todayET(), -90) + 'T00:00:00Z'
  const rep = await pageRead<any>((a, b) => db.from('fact_maintenance_event').select('event_id,physical_unit_id,system')
    .eq('is_repeat', true).gte('opened_at', since).order('opened_at').order('event_id').range(a, b), 3)
  const pairs: Record<string, boolean> = {}
  for (const e of rep.rows) pairs[str(e.physical_unit_id) + '|' + str(e.system)] = true
  const [toConfirm, unknownB] = await Promise.all([
    db.from('person_xref').select('person_id', { count: 'exact', head: true }).eq('confirmed', false),
    db.from('dim_building').select('id', { count: 'exact', head: true }).eq('known', false).gt('units', 0),
  ])
  return {
    day, bands, partialRows, repeatPairs: Object.keys(pairs).length,
    peopleToConfirm: typeof toConfirm.count === 'number' ? toConfirm.count : null,
    unknownBuildings: typeof unknownB.count === 'number' ? unknownB.count : null,
    formula: HEALTH_FORMULA,
  }
}

async function unitsSection() {
  const db = supabaseAdmin()
  const day = await healthDay()
  if (!day) return { day: null, rows: [] }
  const [h, { units }, owners, blds] = await Promise.all([
    pageRead<any>((a, b) => db.from('unit_health_daily').select(H_COLS).eq('day', day).order('physical_unit_id').range(a, b), 2),
    loadUnits(),
    ownerNames(),
    buildingLabels(),
  ])
  const ownerOf = ownerOfPhysical(units)
  const rows = h.rows.map((r: any) => {
    const ownerId = ownerOf[str(r.physical_unit_id)] || null
    const drivers = (Array.isArray(r.drivers) ? r.drivers : []) as any[]
    return {
      id: str(r.physical_unit_id), listingId: str(r.listing_id), unit: str(r.nickname) || str(r.listing_id),
      buildingId: str(r.building_id), building: (blds[str(r.building_id)] && blds[str(r.building_id)].label) || str(r.building_id),
      market: str(r.market), ownerId, owner: ownerId ? (owners[ownerId] || 'Owner ' + ownerId.slice(-4)) : null,
      score: r.score == null ? null : Number(r.score), band: str(r.band) || 'unrated',
      drivers: drivers.filter(d => Number(d && d.points) < 0).slice(0, 3).map(d => ({ key: str(d.key), points: Number(d.points), why: str(d.why) })),
      looseRepeats: (drivers.find(d => d && d.key === 'repeats_loose') || {}).systems || [],
      repeats: Array.isArray(r.repeat_systems) ? r.repeat_systems.map(String) : [],
      reviewAvg: r.review_avg_live == null ? null : Number(r.review_avg_live), reviewN: Number(r.review_n) || 0,
      glitches: Number(r.glitches_90d) || 0, nights: Number(r.occupied_nights_90d) || 0,
      pmOverdue: Number(r.pm_overdue_count) || 0,
      net90: r.net_revenue_90d == null ? null : Number(r.net_revenue_90d),
      billed90: r.upkeep_billed_90d == null ? null : Number(r.upkeep_billed_90d),
      upkeepPct: r.upkeep_cost_pct_rev == null ? null : Number(r.upkeep_cost_pct_rev),
      partial: r.partial === true,
    }
  })
  const rank: Record<string, number> = { critical: 0, risk: 1, watch: 2, healthy: 3, unrated: 4 }
  rows.sort((a, b) => (rank[a.band] ?? 5) - (rank[b.band] ?? 5) || (a.score ?? 999) - (b.score ?? 999) || a.unit.localeCompare(b.unit))
  return { day, rows, short: h.truncated }
}

async function repeatsSection() {
  const db = supabaseAdmin()
  const today = todayET()
  const d90 = addDays(today, -90) + 'T00:00:00Z'
  const ev = await pageRead<any>((a, b) => db.from('fact_maintenance_event')
    .select('event_id,source,physical_unit_id,listing_id,system,title,opened_at,closed_at,is_open,hours_to_close,is_repeat,prior_event_id,billed_owner,person_name,vendor_key')
    .gte('opened_at', addDays(today, -180) + 'T00:00:00Z').not('physical_unit_id', 'is', null).not('system', 'in', '(other,cleaning)')
    .order('opened_at', { ascending: false }).order('event_id').range(a, b), 8)
  const { units } = await loadUnits()
  const name: Record<string, string> = {}
  for (const u of units) if (u.status !== 'inactive' && (!name[u.physical_unit_id] || u.is_parent)) name[u.physical_unit_id] = str(u.nickname) || u.listing_id
  const shownListing: Record<string, string> = {}
  for (const u of units) if (u.status !== 'inactive' && (!shownListing[u.physical_unit_id] || u.is_parent)) shownListing[u.physical_unit_id] = u.listing_id
  const groups: Record<string, any[]> = {}
  for (const e of ev.rows) { const k = str(e.physical_unit_id) + '|' + str(e.system); (groups[k] = groups[k] || []).push(e) }
  const out = Object.keys(groups).map(k => {
    const list = groups[k]
    const recent = list.filter(e => e.is_repeat === true && str(e.opened_at) >= d90)
    if (!recent.length) return null
    const cut = k.indexOf('|')
    const pid = k.slice(0, cut), system = k.slice(cut + 1)
    return {
      key: k, physicalUnitId: pid, unit: name[pid] || pid, listingId: shownListing[pid] || str(list[0].listing_id), system, systemLabel: SYSTEM_LABEL[system] || system,
      repeats90: recent.length, events180: list.length, lastAt: str(list[0].opened_at),
      billed180: round2(list.reduce((s: number, e: any) => s + (Number(e.billed_owner) || 0), 0)),
      events: list.map((e: any) => ({
        id: str(e.event_id), source: str(e.source), title: str(e.title), openedAt: str(e.opened_at), closedAt: e.closed_at ? str(e.closed_at) : null,
        open: e.is_open === true, hours: e.hours_to_close == null ? null : Number(e.hours_to_close), repeat: e.is_repeat === true,
        billed: e.billed_owner == null ? null : Number(e.billed_owner), who: str(e.vendor_key) || str(e.person_name) || null,
      })),
    }
  }).filter(Boolean) as any[]
  out.sort((a, b) => b.repeats90 - a.repeats90 || (a.lastAt < b.lastAt ? 1 : -1))
  return { rows: out, short: ev.truncated }
}

async function ownersSection() {
  const db = supabaseAdmin()
  const months12 = recentMonths(12)
  const months3 = months12.slice(0, 3)
  const r = await pageRead<any>((a, b) => db.from('owner_month').select('*').in('month', months12).order('month').order('owner_id').range(a, b), 5)
  type A = { units: number; avail: number; occ: number; own: number; net: number; billed: number; issues: number; repeats: number; events: number; rSum: number; rN: number; months: number }
  const blank = (): A => ({ units: 0, avail: 0, occ: 0, own: 0, net: 0, billed: 0, issues: 0, repeats: 0, events: 0, rSum: 0, rN: 0, months: 0 })
  const acc: Record<string, { name: string; m3: A; m12: A }> = {}
  for (const row of r.rows) {
    const id = str(row.owner_id)
    const o = acc[id] = acc[id] || { name: str(row.owner_name), m3: blank(), m12: blank() }
    if (!o.name && row.owner_name) o.name = str(row.owner_name)
    const targets = months3.indexOf(str(row.month)) >= 0 ? [o.m3, o.m12] : [o.m12]
    for (const t of targets) {
      t.units = Math.max(t.units, Number(row.units) || 0)
      t.avail += Number(row.available_nights) || 0; t.occ += Number(row.occupied_nights) || 0; t.own += Number(row.owner_nights) || 0
      t.net += Number(row.net_accom) || 0; t.billed += Number(row.billed_owner) || 0
      t.issues += Number(row.glitches) || 0; t.repeats += Number(row.repeat_events) || 0; t.events += Number(row.maint_events) || 0
      const n = Number(row.review_n) || 0
      if (n && row.review_avg != null) { t.rSum += Number(row.review_avg) * n; t.rN += n }
      t.months += 1
    }
  }
  const view = (a: A) => ({
    units: a.units, nights: a.occ, ownerNights: a.own,
    occupancy: a.avail - a.own > 0 ? round2((a.occ / (a.avail - a.own)) * 100) : null,
    net: round2(a.net), billed: round2(a.billed), issues: a.issues, repeats: a.repeats, events: a.events,
    reviewAvg: a.rN ? round2(a.rSum / a.rN) : null, reviewN: a.rN, months: a.months,
  })
  const rows = Object.keys(acc).map(id => ({ ownerId: id, name: acc[id].name || 'Owner ' + id.slice(-4), m3: view(acc[id].m3), m12: view(acc[id].m12) }))
  rows.sort((a, b) => b.m12.net - a.m12.net)
  return {
    rows, short: r.truncated,
    thin: 'Thin by design: no labour cost, claims or statement lines yet, and a unit\'s whole history sits under its current owner.',
    monthsBuilt: Array.from(new Set(r.rows.map((x: any) => str(x.month)))).sort(),
  }
}

async function qualitySection() {
  const db = supabaseAdmin()
  const presence = await brainTables()
  const fresh = await Promise.all(presence.present.map(async (t) => {
    let lastBuiltAt: string | null = null, rows: number | null = null
    try {
      const { data } = await db.from(t).select('built_at').order('built_at', { ascending: false }).limit(1)
      lastBuiltAt = ((data || []) as any[])[0]?.built_at ? String((data as any[])[0].built_at) : null
    } catch { lastBuiltAt = null }
    try {
      const c = await db.from(t).select('built_at', { count: 'exact', head: true })
      rows = typeof c.count === 'number' ? c.count : null
    } catch { rows = null }
    return { table: t, rows, lastBuiltAt }
  }))
  const order = (t: string) => BRAIN_TABLES.indexOf(t as any)
  fresh.sort((a, b) => order(a.table) - order(b.table))

  const people = await pageRead<any>((a, b) => db.from('person_xref').select('person_id,name,email,homebase_id,breezeway_id,dept,sources')
    .eq('confirmed', false).order('name').order('person_id').range(a, b), 2)
  const [{ units }, blds] = await Promise.all([loadUnits(), buildingLabels()])
  const live = units.filter(u => u.status !== 'inactive')
  const unknownBuildings = Object.keys(blds).filter(id => !blds[id].known && blds[id].units > 0).map(id => ({ id, label: blds[id].label, units: blds[id].units }))
  const lite = (u: DimUnit) => ({ listingId: u.listing_id, unit: str(u.nickname) || u.listing_id, building: (blds[str(u.building_id)] && blds[str(u.building_id)].label) || str(u.building_id) })
  // A vendor building Breezeway does not hold (Botanica) is not a gap: it is cleaned from Guesty.
  const noHome = live.filter(u => u.bz_home_id == null).map(lite)
  const noOwner = live.filter(u => !u.owner_id).map(lite)

  const other = await pageRead<any>((a, b) => db.from('fact_maintenance_event').select('event_id,title')
    .eq('system', 'other').gte('opened_at', addDays(todayET(), -180) + 'T00:00:00Z').order('opened_at').order('event_id').range(a, b), 5)
  const titles: Record<string, { title: string; n: number }> = {}
  for (const e of other.rows) {
    const t = str(e.title).replace(/\s+/g, ' ').trim()
    if (!t) continue
    // Group spellings that differ only by a unit number or punctuation.
    const k = t.toLowerCase().replace(/\b\d+[a-z]?(\/\d+)?\b/g, '#').replace(/[^a-z#]+/g, ' ').trim()
    const g = titles[k] = titles[k] || { title: t, n: 0 }
    g.n += 1
  }
  const topOther = Object.values(titles).sort((a, b) => b.n - a.n || a.title.localeCompare(b.title)).slice(0, 20)

  let vendorsToConfirm: number | null = null
  try {
    const c = await db.from('vendor_xref').select('vendor_key', { count: 'exact', head: true }).eq('confirmed', false)
    vendorsToConfirm = typeof c.count === 'number' ? c.count : null
  } catch { vendorsToConfirm = null }

  return {
    missing: presence.missing, fresh,
    people: people.rows.map((p: any) => ({
      id: str(p.person_id), name: str(p.name), email: p.email ? str(p.email) : null, dept: p.dept ? str(p.dept) : null,
      breezewayId: p.breezeway_id ? str(p.breezeway_id) : null, homebaseId: p.homebase_id ? str(p.homebase_id) : null,
      sources: Array.isArray(p.sources) ? p.sources.map(String) : [],
    })),
    peopleShort: people.truncated,
    unknownBuildings, noHome, noOwner, topOther, otherEvents: other.rows.length, vendorsToConfirm,
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const section = String(req.nextUrl.searchParams.get('section') || 'summary')
  try {
    const presence = await brainTables()
    if (presence.missing.length) return NextResponse.json({ ok: true, ready: false, missing: presence.missing })
    // requireAdmin admits admins and the owner only, so whoever reads this may also confirm people.
    const isAdmin = true
    const body = section === 'units' ? await unitsSection()
      : section === 'repeats' ? await repeatsSection()
        : section === 'owners' ? await ownersSection()
          : section === 'quality' ? await qualitySection()
            : await summary()
    return NextResponse.json({ ok: true, ready: true, section, canEdit: isAdmin, ...body }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

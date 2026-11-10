// THE ENTITY SPINE — one row per building, per listing, per person (migration 178).
//
// Every other table in the brain joins through these, so "which apartment is this" and "which
// building is it in" are answered once a night instead of by a different regex on every page.
//
//   dim_building  lib/segments KNOWN_BUILDINGS, plus any building a listing resolved to that the
//                 registry does not carry (known = false — a first-word guess, worth a look).
//   dim_unit      one row per Guesty listing. physical_unit_id is the APARTMENT: a listing sold whole
//                 and in parts ("3316 Full" + "3316/1" + "3316/2") shares one id (lib/linked-units —
//                 the same rule the blocked-units report and the PM ledger use). Standalone listings
//                 are their own physical unit.
//   person_xref   staff / Breezeway people / Homebase employees joined BY NAME (lib/person-name).
//                 Name matching is a suggestion, so every seeded row is confirmed = false and a row a
//                 person has confirmed is never rewritten.
//   vendor_xref / entity_alias  the spellings each vendor / building / unit is known by.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { buildingOf, marketOf, isLux, isVendorManaged, KNOWN_BUILDINGS } from '@/lib/segments'
import { linkedSets } from '@/lib/linked-units'
import { unitLabel, unitNumber } from '@/lib/unit-label'
import { getSetting, getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { nameMatches, personKey, bestSpelling } from '@/lib/person-name'
import { LIVE_STAY_STATUSES } from '@/lib/basis'
import { str, dOf, slug, aliasKey, numOrNull, upsertBatches, isMissing, type BuildResult } from './shared'

const DEAD_LISTING = /inactive|disabled|archived|deleted/i

export type DimUnit = {
  listing_id: string
  physical_unit_id: string
  parent_listing_id: string | null
  is_parent: boolean
  building_id: string | null
  market: string | null
  nickname: string | null
  unit_label: string | null
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  ac_type: string | null
  vendor_cleaned: boolean
  bz_home_id: number | null
  owner_id: string | null
  active_from: string | null
  active_to: string | null
  status: string | null
}

/** dim_unit as the other builders read it. Empty + partial when the table is missing or short. */
export async function loadUnits(): Promise<{ units: DimUnit[]; byId: Record<string, DimUnit>; partial: boolean }> {
  const db = supabaseAdmin()
  const { rows, truncated } = await pageRows<any>((a, b) => db.from('dim_unit')
    .select('listing_id,physical_unit_id,parent_listing_id,is_parent,building_id,market,nickname,unit_label,bedrooms,bathrooms,sqft,ac_type,vendor_cleaned,bz_home_id,owner_id,active_from,active_to,status')
    .order('listing_id').range(a, b), 4)
  const units: DimUnit[] = []
  const byId: Record<string, DimUnit> = {}
  for (const r of rows) {
    const u: DimUnit = {
      listing_id: str(r.listing_id), physical_unit_id: str(r.physical_unit_id) || str(r.listing_id),
      parent_listing_id: r.parent_listing_id ? str(r.parent_listing_id) : null, is_parent: r.is_parent === true,
      building_id: r.building_id ? str(r.building_id) : null, market: r.market ? str(r.market) : null,
      nickname: r.nickname ? str(r.nickname) : null, unit_label: r.unit_label ? str(r.unit_label) : null,
      bedrooms: numOrNull(r.bedrooms), bathrooms: numOrNull(r.bathrooms), sqft: numOrNull(r.sqft),
      ac_type: r.ac_type ? str(r.ac_type) : null, vendor_cleaned: r.vendor_cleaned === true,
      bz_home_id: numOrNull(r.bz_home_id), owner_id: r.owner_id ? str(r.owner_id) : null,
      active_from: r.active_from ? dOf(r.active_from) : null, active_to: r.active_to ? dOf(r.active_to) : null,
      status: r.status ? str(r.status) : null,
    }
    if (!u.listing_id) continue
    units.push(u); byId[u.listing_id] = u
  }
  return { units, byId, partial: truncated }
}

/** First live check-in / last live check-out for a handful of listings. One small read each. */
async function edgeDates(ids: string[], which: 'first' | 'last', deadline: number): Promise<Record<string, string>> {
  const db = supabaseAdmin()
  const out: Record<string, string> = {}
  const todo = ids.slice(0, 160)
  const CONC = 6
  for (let i = 0; i < todo.length; i += CONC) {
    if (Date.now() > deadline) break
    await Promise.all(todo.slice(i, i + CONC).map(async (id) => {
      try {
        const col = which === 'first' ? 'check_in' : 'check_out'
        const { data } = await db.from('guesty_reservations').select(col)
          .eq('listing_id', id).in('status', LIVE_STAY_STATUSES).not(col, 'is', null)
          .order(col, { ascending: which === 'first' }).limit(1)
        const v = dOf(((data || []) as any[])[0]?.[col])
        if (v) out[id] = v
      } catch { /* stays unknown */ }
    }))
  }
  return out
}

export async function buildSpine(deadline: number): Promise<{ dim_building: BuildResult; dim_unit: BuildResult; entity_alias: BuildResult }> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  let partial = false

  const listingRead = await pageRows<any>((a, b) => db.from('guesty_listings')
    .select('id,nickname,title,building,status,address_city,bedrooms,bathrooms,created:raw->>createdAt,sqft:raw->>areaSquareFeet')
    .order('id').range(a, b), 4)
  if (listingRead.truncated) partial = true
  const listings = listingRead.rows
  if (!listings.length) {
    const empty: BuildResult = { rows: 0, partial: true, error: 'no listings read' }
    return { dim_building: empty, dim_unit: empty, entity_alias: empty }
  }

  // Breezeway home per Guesty listing, and the statement owner per listing.
  const homeOf: Record<string, number> = {}
  try {
    const { rows, truncated } = await pageRows<any>((a, b) => db.from('breezeway_properties')
      .select('home_id,reference_property_id').not('reference_property_id', 'is', null).order('home_id').range(a, b), 3)
    if (truncated) partial = true
    for (const p of rows) { const ref = str(p.reference_property_id); const h = Number(p.home_id); if (ref && Number.isFinite(h)) homeOf[ref] = h }
  } catch { partial = true }
  const ownerOf: Record<string, string> = {}
  try {
    const { rows, truncated } = await pageRows<any>((a, b) => db.from('guesty_owners')
      .select('id,listing_ids').order('id').range(a, b), 3)
    if (truncated) partial = true
    for (const o of rows) for (const lid of (Array.isArray(o.listing_ids) ? o.listing_ids : [])) { if (!ownerOf[str(lid)]) ownerOf[str(lid)] = str(o.id) }
  } catch { partial = true }

  // A/C type: only what a person has SET (app_settings unit_equipment). The inferred type is a
  // heavy read of listing text and guest messages (lib/unit-equipment) and is not repeated here.
  let acSet: Record<string, any> = {}
  try { const v = await getSetting<any>('unit_equipment', null); acSet = v && typeof v === 'object' && v.ac && typeof v.ac === 'object' ? v.ac : {} } catch { acSet = {} }
  let vendorRe: RegExp | null = null
  try { vendorRe = vendorRegex((await getOpsPresets()).vendorBuildings) } catch { vendorRe = null }

  // Canonical building per listing (lib/segments — the one registry).
  type L = { id: string; nick: string; label: string; rawBuilding: string; dead: boolean; row: any }
  const ls: L[] = listings.map((l: any) => {
    const nick = unitLabel({ nickname: l.nickname, title: l.title })
    return { id: str(l.id), nick, label: buildingOf(l.building, nick) || 'Unassigned', rawBuilding: str(l.building).trim(), dead: DEAD_LISTING.test(str(l.status)), row: l }
  }).filter((l: L) => !!l.id)

  // Whole-and-parts sets are worked out over LIVE listings only: a retired "Full" listing must not
  // turn two live halves into one apartment.
  const sets = linkedSets(ls.filter(l => !l.dead).map(l => ({ listingId: l.id, unit: l.nick, building: l.label })))

  // active_from: the listing's created date, else its first live check-in. active_to: the last live
  // check-out, only for a listing that is inactive now.
  const needFirst = ls.filter(l => !dOf(l.row.created)).map(l => l.id)
  const firstIn = needFirst.length ? await edgeDates(needFirst, 'first', deadline) : {}
  const lastOut = await edgeDates(ls.filter(l => l.dead).map(l => l.id), 'last', deadline)

  const unitRows: Record<string, any>[] = []
  const bAliases: Record<string, Set<string>> = {}
  const bUnits: Record<string, number> = {}
  const bMeta: Record<string, { label: string; market: string | null; lux: boolean; vendor: boolean }> = {}
  for (const l of ls) {
    const r = l.row
    const bid = slug(l.label) || 'unassigned'
    const market = marketOf(r.building, r.address_city, l.nick)
    const vendor = isVendorManaged(r.building, l.nick) || (!!vendorRe && vendorRe.test(l.label + ' ' + l.nick))
    if (!bMeta[bid]) bMeta[bid] = { label: l.label, market, lux: isLux(r.building, l.nick), vendor }
    if (l.rawBuilding) (bAliases[bid] = bAliases[bid] || new Set<string>()).add(l.rawBuilding)
    if (!l.dead) bUnits[bid] = (bUnits[bid] || 0) + 1
    const parents = sets.parentsOf[l.id] || []
    const ac = acSet[l.id] && typeof acSet[l.id] === 'object' ? str(acSet[l.id].ac) : ''
    const sqft = numOrNull(r.sqft)
    unitRows.push({
      listing_id: l.id,
      physical_unit_id: sets.spaceOf[l.id] || l.id,
      parent_listing_id: parents[0] || null,
      is_parent: sets.isRedundantParent[l.id] === true,
      building_id: bid,
      market,
      nickname: l.nick,
      unit_label: unitNumber({ nickname: r.nickname, unit: null }),
      bedrooms: numOrNull(r.bedrooms) == null ? null : Math.round(Number(r.bedrooms)),
      bathrooms: numOrNull(r.bathrooms),
      sqft: sqft != null && sqft > 0 ? Math.round(sqft) : null,
      ac_type: ac || null,
      vendor_cleaned: vendor,
      bz_home_id: homeOf[l.id] ?? null,
      owner_id: ownerOf[l.id] || null,
      active_from: dOf(r.created) || firstIn[l.id] || null,
      active_to: l.dead ? (lastOut[l.id] || null) : null,
      status: l.dead ? 'inactive' : 'active',
      built_at: now,
      partial,
    })
  }

  const known: Record<string, boolean> = {}
  const buildingRows: Record<string, any>[] = []
  for (const k of KNOWN_BUILDINGS) {
    const id = slug(k.label)
    known[id] = true
    buildingRows.push({
      id, label: k.label, market: k.market, lux: k.lux, vendor_cleaned: k.vendor || !!(bMeta[id] && bMeta[id].vendor),
      aliases: Array.from(bAliases[id] || []).sort(), known: true, units: bUnits[id] || 0, built_at: now, partial,
    })
  }
  for (const id of Object.keys(bMeta)) {
    if (known[id]) continue
    const m = bMeta[id]
    buildingRows.push({
      id, label: m.label, market: m.market, lux: m.lux, vendor_cleaned: m.vendor,
      aliases: Array.from(bAliases[id] || []).sort(), known: false, units: bUnits[id] || 0, built_at: now, partial,
    })
  }

  const aliasRows: Record<string, any>[] = []
  for (const b of buildingRows) {
    for (const a of [b.label, b.id].concat(b.aliases as string[])) { const k = aliasKey(a); if (k) aliasRows.push({ kind: 'building', alias: k, id: b.id, built_at: now }) }
  }
  // A live listing's nickname wins over a retired one that happened to carry the same name.
  for (const dead of [true, false]) {
    for (const l of ls) { if (l.dead !== dead) continue; const k = aliasKey(l.nick); if (k) aliasRows.push({ kind: 'unit', alias: k, id: l.id, built_at: now }) }
  }

  const b = await upsertBatches('dim_building', buildingRows, 'id', { deadline })
  const u = await upsertBatches('dim_unit', unitRows, 'listing_id', { deadline })
  const a = await upsertBatches('entity_alias', aliasRows, 'kind,alias', { deadline })
  return {
    dim_building: { rows: b.written, partial: partial || b.stoppedEarly, ...(b.error ? { error: b.error } : {}) },
    dim_unit: { rows: u.written, partial: partial || u.stoppedEarly, ...(u.error ? { error: u.error } : {}), note: sets.sets + ' whole-and-parts set(s) rolled up' },
    entity_alias: { rows: a.written, partial: partial || a.stoppedEarly, ...(a.error ? { error: a.error } : {}) },
  }
}

// ── PEOPLE ──────────────────────────────────────────────────────────────────────────────────────
// (Vendors moved to lib/brain/vendors, 2026-11-10: they are built before the events now.)
//
// "NOT THE SAME PERSON" (/brain → Data quality). A seeded row joins several sources by name; when a
// person says the join is wrong, its person_id is kept in app_settings (PERSON_REJECTS_KEY) and from
// then on that person is written as one row PER SOURCE ('<key> #staff', '<key> #breezeway', …),
// each holding only that source's ids. The merged row itself is removed by the API at that moment.
export const PERSON_REJECTS_KEY = 'brain_person_rejects'
type Part = { source: string; name: string; email: string | null; homebase_id: string | null; breezeway_id: string | null; dept: string | null }
type Person = { name: string; email: string | null; homebase_id: string | null; breezeway_id: string | null; dept: string | null; sources: string[]; parts: Part[] }

export async function buildPeople(deadline: number): Promise<{ person_xref: BuildResult }> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  let partial = false
  const people: Person[] = []
  const find = (name: string) => people.find(p => nameMatches(p.name, name)) || null
  const add = (name: string, patch: Partial<Person>, source: string) => {
    const n = str(name).replace(/\s+/g, ' ').trim()
    if (!n || !personKey(n)) return
    let p = find(n)
    if (!p) { p = { name: n, email: null, homebase_id: null, breezeway_id: null, dept: null, sources: [], parts: [] }; people.push(p) }
    else p.name = bestSpelling(p.name, n)
    p.parts.push({ source, name: n, email: patch.email || null, homebase_id: patch.homebase_id || null, breezeway_id: patch.breezeway_id || null, dept: patch.dept || null })
    if (patch.email && !p.email) p.email = patch.email
    if (patch.homebase_id && !p.homebase_id) p.homebase_id = patch.homebase_id
    if (patch.breezeway_id && !p.breezeway_id) p.breezeway_id = patch.breezeway_id
    if (patch.dept && !p.dept) p.dept = patch.dept
    if (p.sources.indexOf(source) < 0) p.sources.push(source)
  }

  // 1. Our own staff table — the declared roster (name is its key).
  try {
    const { data, error } = await db.from('staff').select('name,dept,role').limit(1000) // deliberate cap: one row per person
    if (error) partial = true
    for (const s of ((data || []) as any[])) add(str(s.name), { dept: str(s.dept) || str(s.role) || null }, 'staff')
  } catch { partial = true }

  // 2. Breezeway — the people list when the API answers, else the assignees seen on recent tasks.
  const bzPeople: { id: string; name: string }[] = []
  try {
    const { listBreezewayPeople, breezewayConfigured } = await import('@/lib/breezeway')
    if (breezewayConfigured() && Date.now() < deadline) {
      for (const p of await listBreezewayPeople()) bzPeople.push({ id: String(p.id), name: p.name })
    }
  } catch { /* fall through to the mirror */ }
  if (!bzPeople.length) {
    try {
      const since = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
      const { rows, truncated } = await pageRows<any>((a, b) => db.from('breezeway_tasks_sync')
        .select('id,assignee_id,assignee_name').gte('scheduled_date', since).not('assignee_id', 'is', null)
        .order('id').range(a, b), 8)
      if (truncated) partial = true
      const seen: Record<string, boolean> = {}
      for (const t of rows) { const id = str(t.assignee_id), nm = str(t.assignee_name); if (id && nm && !seen[id]) { seen[id] = true; bzPeople.push({ id, name: nm }) } }
    } catch { partial = true }
  }
  for (const p of bzPeople) add(p.name, { breezeway_id: p.id }, 'breezeway')

  // 3. Homebase — one roster call. Unreachable is not an error here: the rows just carry no id.
  try {
    if (Date.now() < deadline) {
      const { getEmployees } = await import('@/lib/homebase')
      for (const e of await getEmployees()) add(e.name, { homebase_id: e.id || null, email: e.email || null, dept: e.department || e.role || null }, 'homebase')
    }
  } catch { partial = true }

  // A row a person has confirmed is theirs: never rewritten, and a seeded name that matches one is
  // not added again under a second id.
  const confirmedNames: string[] = []
  const confirmedIds: Record<string, boolean> = {}
  try {
    const { data, error } = await db.from('person_xref').select('person_id,name').eq('confirmed', true).limit(1000) // deliberate cap: one row per person
    if (error && !isMissing(error)) partial = true
    for (const r of ((data || []) as any[])) { confirmedIds[str(r.person_id)] = true; confirmedNames.push(str(r.name)) }
  } catch { partial = true }

  let rejects: Record<string, any> = {}
  try { const v = await getSetting<any>(PERSON_REJECTS_KEY, null); rejects = v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { rejects = {} }

  const rows: Record<string, any>[] = []
  const usedIds: Record<string, boolean> = {}
  let split = 0
  for (const p of people) {
    if (confirmedNames.some(n => nameMatches(n, p.name))) continue
    let id = personKey(p.name)
    if (!id || confirmedIds[id]) continue
    if (rejects[id]) {
      // A person said these sources are NOT one human: one row per source, never merged again.
      const bySource: Record<string, Part> = {}
      for (const part of p.parts) {
        const have = bySource[part.source]
        if (!have) { bySource[part.source] = { ...part }; continue }
        if (!have.email && part.email) have.email = part.email
        if (!have.homebase_id && part.homebase_id) have.homebase_id = part.homebase_id
        if (!have.breezeway_id && part.breezeway_id) have.breezeway_id = part.breezeway_id
        if (!have.dept && part.dept) have.dept = part.dept
      }
      for (const src of Object.keys(bySource).sort()) {
        const part = bySource[src]
        const pid = id + ' #' + src
        if (confirmedIds[pid] || usedIds[pid]) continue
        usedIds[pid] = true
        rows.push({ person_id: pid, name: part.name, email: part.email, homebase_id: part.homebase_id, breezeway_id: part.breezeway_id, dept: part.dept, sources: [src], built_at: now, updated_at: now })
      }
      split++
      continue
    }
    // Two different humans whose names normalise the same would share a key; keep them apart.
    if (usedIds[id]) id = id + ' #' + (p.breezeway_id || p.homebase_id || String(rows.length))
    usedIds[id] = true
    // slack_id and confirmed are deliberately not sent: an upsert only touches the columns it names,
    // so a Slack id somebody typed onto an unconfirmed row survives the nightly rebuild.
    rows.push({ person_id: id, name: p.name, email: p.email, homebase_id: p.homebase_id, breezeway_id: p.breezeway_id, dept: p.dept, sources: p.sources.slice().sort(), built_at: now, updated_at: now })
  }
  const px = await upsertBatches('person_xref', rows, 'person_id', { deadline })

  return {
    person_xref: { rows: px.written, partial: partial || px.stoppedEarly, ...(px.error ? { error: px.error } : {}), note: 'name-matched; every seeded row is confirmed = false' + (split ? '; ' + split + ' person(s) kept apart by source (marked not the same person)' : '') },
  }
}

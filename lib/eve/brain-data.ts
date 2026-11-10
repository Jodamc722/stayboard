// THE BUSINESS BRAIN, AS EVE READS IT (2026-11-10).
//
// Migration 178 added a nightly-built layer (lib/brain/*): one row per listing per night
// (fact_unit_day), one row per thing that broke or was fixed (fact_maintenance_event), a daily
// upkeep-aware health score per apartment (unit_health_daily) and two thin roll-ups (owner_month,
// vendor_month), all joined to one spine (dim_unit, dim_building). This file is the ONE place Eve's
// tools read it from, so a number has one definition whichever tool quotes it:
//   brainFresh / freshAll   is the table there, filled, and built in the last 36 hours?
//   brainDims               the spine, once per request
//   resolveBrainScope       unit / building / market / owner / portfolio → listing ids (a whole-and-
//                           parts apartment is ALL its listings — physical_unit_id)
//   readUnitDays / readEvents   paged reads (PostgREST stops at 1,000 rows), filters in the query
//   Acc / addDayRow / perfOf    the sums, done in JS
//
// FAIL OPEN. A table that is missing, empty or older than 36 hours is never answered from silently:
// the tools return { stale: true, note } and say which live tool to use instead; the 360s fall back to
// their live readers on their own.
//
// NIGHTS, STATED ONCE. A whole-and-parts set ("3316 Full" and its halves) is one apartment, so above
// the single-listing grain a night is counted ONCE per apartment: available = apartment-nights the
// listings were active, occupied = apartment-nights with a guest stay on any listing, owner = an
// owner / friends-and-family stay and no guest. ADR divides by guest LISTING-nights (two halves sold
// the same night are two stays). occupancy = occupied ÷ (available − owner nights); RevPAR = net ÷
// available. owner_month counts listing-nights, so its night counts can run a little higher.
import 'server-only'
import { isMissing, etDay } from '@/lib/brain/shared'
import { NET_BASIS_NOTE } from '@/lib/basis'
import type { EveCtx } from './ctx'
import { lc, num, shiftDay, pageRows, chunk, resolveListing, scopeIds, toolMeta } from './ctx'
import { resolveEntity } from './entity'

export const STALE_HOURS = 36
export const BRAIN_SOURCE = 'business brain (nightly build)'
export const BILLED_NOTE = 'billed to owner, not true cost'
export const BRAIN_NIGHTS_BASIS = `${NET_BASIS_NOTE}; real stays only, spread evenly over their nights. Nights counted once per apartment (a whole-and-parts set is one apartment); occupancy = guest nights ÷ (available − owner nights); ADR = net ÷ guest listing-nights; RevPAR = net ÷ available nights. Blocked nights read as vacant (the calendar is not stored in v1).`

export type BrainTable = 'fact_unit_day' | 'fact_maintenance_event' | 'unit_health_daily' | 'owner_month' | 'vendor_month' | 'dim_unit' | 'dim_building'

export type Fresh =
  | { ok: true; table: BrainTable; built_at: string; as_of: string; hours_old: number }
  | { ok: false; table: BrainTable; reason: 'missing' | 'empty' | 'old' | 'error'; note: string; built_at?: string }

export const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const toSet = (ids: string[]): Record<string, true> => { const o: Record<string, true> = {}; for (const id of ids) o[id] = true; return o }
export const guarded = (ctx: EveCtx): boolean => ctx.tier === 'vendor' || !!ctx.guestSafe

/** A timestamp as "Nov 10, 2:53 AM ET" — the as-of a brain number carries (when it was BUILT). */
export function etStamp(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return str(iso)
  return new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
}

// The two big tables are filtered to recent days before sorting by built_at, so the freshness probe
// rides the primary-key index instead of sorting 77,000 rows.
const RECENT_DAY_COL: Partial<Record<BrainTable, string>> = { fact_unit_day: 'day', unit_health_daily: 'day' }

async function readFresh(ctx: EveCtx, table: BrainTable): Promise<Fresh> {
  try {
    let q = ctx.db.from(table).select('built_at')
    const dcol = RECENT_DAY_COL[table]
    if (dcol) q = q.gte(dcol, shiftDay(ctx.today, -3))
    const { data, error } = await q.order('built_at', { ascending: false }).limit(1)
    if (error) {
      if (isMissing(error)) return { ok: false, table, reason: 'missing', note: `The ${table} table is not there yet (migration 178 has not run).` }
      return { ok: false, table, reason: 'error', note: `${table} could not be read (${str(error.message).slice(0, 100)}).` }
    }
    const row: any = ((data as any[]) || [])[0]
    if (!row || !row.built_at) {
      return { ok: false, table, reason: 'empty', note: dcol ? `${table} has no rows for the last three days — the nightly business-brain build has not run lately.` : `${table} is empty — the nightly business-brain build has not filled it yet.` }
    }
    const t = Date.parse(str(row.built_at))
    const hours = Number.isFinite(t) ? (Date.now() - t) / 3600_000 : Infinity
    const as_of = etStamp(str(row.built_at))
    if (!(hours <= STALE_HOURS)) {
      return { ok: false, table, reason: 'old', built_at: str(row.built_at), note: `${table} was last built ${as_of}${Number.isFinite(hours) ? ` (${Math.round(hours)} hours ago)` : ''} — older than ${STALE_HOURS} hours, so the nightly build has not landed since.` }
    }
    return { ok: true, table, built_at: str(row.built_at), as_of, hours_old: Math.round(hours * 10) / 10 }
  } catch (e: any) {
    return { ok: false, table, reason: 'error', note: `${table} could not be read (${str(e?.message || e).slice(0, 100)}).` }
  }
}

const _fresh = new WeakMap<object, Record<string, Promise<Fresh>>>()
/** Is this brain table there, filled and built in the last 36 hours? Asked once per table per request. */
export function brainFresh(ctx: EveCtx, table: BrainTable): Promise<Fresh> {
  let m = _fresh.get(ctx)
  if (!m) { m = {}; _fresh.set(ctx, m) }
  if (!m[table]) m[table] = readFresh(ctx, table)
  return m[table]
}

export type FreshAll = { ok: true; as_of: string; built_at: string } | { ok: false; note: string; reasons: string[] }
/** Every table fresh, or the first notes of the ones that are not. as_of = the OLDEST build among them. */
export async function freshAll(ctx: EveCtx, tables: BrainTable[]): Promise<FreshAll> {
  const got = await Promise.all(tables.map(t => brainFresh(ctx, t)))
  const bad = got.filter(f => !f.ok) as Extract<Fresh, { ok: false }>[]
  if (bad.length) return { ok: false, note: bad.map(b => b.note).join(' '), reasons: bad.map(b => b.reason) }
  const good = got as Extract<Fresh, { ok: true }>[]
  const oldest = good.slice().sort((a, b) => a.built_at.localeCompare(b.built_at))[0]
  return { ok: true, as_of: oldest.as_of, built_at: oldest.built_at }
}

/** What a brain tool returns instead of an answer when its table cannot be trusted. */
export function staleOut(note: string, live: string): any {
  return { stale: true, note: `${note} Nothing here is answered from the business brain. ${live}`.trim() }
}

/** The `_meta` block for a brain read: as_of is when the table was BUILT. */
export function brainMeta(m: { source: string; window?: string | null; n?: number | null; truncated?: boolean; basis?: string | null; as_of: string }): any {
  return toolMeta({ source: m.source, window: m.window, n: m.n, truncated: m.truncated, basis: m.basis, as_of: m.as_of })
}

// ───────────────────────────────────────────────────────────── the spine
export type DimUnit = {
  listing_id: string; physical_unit_id: string; parent_listing_id: string | null; is_parent: boolean
  building_id: string | null; market: string | null; nickname: string | null; unit_label: string | null
  owner_id: string | null; status: string | null; bedrooms: number | null; ac_type: string | null; active_from: string | null
}
export type DimBuilding = { id: string; label: string; market: string | null; aliases: string[]; units: number }
export type Dims = {
  units: DimUnit[]; byListing: Record<string, DimUnit>; byPhys: Record<string, DimUnit[]>
  buildings: DimBuilding[]; buildingById: Record<string, DimBuilding>; markets: string[]; truncated: boolean
}

async function readDims(ctx: EveCtx): Promise<Dims> {
  const [u, b] = await Promise.all([
    pageRows<any>((x, y) => ctx.db.from('dim_unit').select('listing_id,physical_unit_id,parent_listing_id,is_parent,building_id,market,nickname,unit_label,owner_id,status,bedrooms,ac_type,active_from').order('listing_id').range(x, y), 3),
    pageRows<any>((x, y) => ctx.db.from('dim_building').select('id,label,market,aliases,units').order('id').range(x, y), 2),
  ])
  const units: DimUnit[] = u.rows.map(r => ({
    listing_id: str(r.listing_id), physical_unit_id: str(r.physical_unit_id) || str(r.listing_id),
    parent_listing_id: r.parent_listing_id ? str(r.parent_listing_id) : null, is_parent: r.is_parent === true,
    building_id: r.building_id ? str(r.building_id) : null, market: r.market ? str(r.market) : null,
    nickname: r.nickname ? str(r.nickname) : null, unit_label: r.unit_label ? str(r.unit_label) : null,
    owner_id: r.owner_id ? str(r.owner_id) : null, status: r.status ? str(r.status) : null,
    bedrooms: r.bedrooms == null ? null : num(r.bedrooms), ac_type: r.ac_type ? str(r.ac_type) : null,
    active_from: r.active_from ? str(r.active_from).slice(0, 10) : null,
  }))
  const byListing: Record<string, DimUnit> = {}
  const byPhys: Record<string, DimUnit[]> = {}
  for (const x of units) { byListing[x.listing_id] = x; (byPhys[x.physical_unit_id] = byPhys[x.physical_unit_id] || []).push(x) }
  const buildings: DimBuilding[] = b.rows.map(r => ({ id: str(r.id), label: str(r.label) || str(r.id), market: r.market ? str(r.market) : null, aliases: Array.isArray(r.aliases) ? r.aliases.map((a: any) => lc(a)) : [], units: num(r.units) }))
  const buildingById: Record<string, DimBuilding> = {}
  for (const x of buildings) buildingById[x.id] = x
  const mk: Record<string, true> = {}
  for (const x of units) if (x.market) mk[x.market] = true
  return { units, byListing, byPhys, buildings, buildingById, markets: Object.keys(mk).sort(), truncated: u.truncated || b.truncated }
}

const _dims = new WeakMap<object, Promise<Dims>>()
export function brainDims(ctx: EveCtx): Promise<Dims> {
  let p = _dims.get(ctx)
  if (!p) { p = readDims(ctx); _dims.set(ctx, p) }
  return p
}

/** The name an apartment goes by: its whole ("Full") listing when it has one, else its first live listing. */
export function physName(ctx: EveCtx, d: Dims, pid: string): string {
  const list = d.byPhys[pid] || []
  if (!list.length) return ctx.listingMeta[pid] ? ctx.listingMeta[pid].name : pid
  const live = list.filter(x => x.status !== 'inactive')
  const pool = live.length ? live : list
  const shown = pool.find(x => x.is_parent) || pool.slice().sort((a, b) => str(a.nickname).localeCompare(str(b.nickname)))[0]
  return shown.nickname || ctx.nameOf(shown.listing_id)
}
export function buildingLabel(d: Dims, id: any): string {
  const k = str(id)
  return k ? (d.buildingById[k] ? d.buildingById[k].label : k) : 'Unassigned'
}

// ───────────────────────────────────────────────────────────── scope
export type Scope = {
  kind: 'portfolio' | 'unit' | 'building' | 'market' | 'owner'
  label: string
  /** null = every listing (the whole portfolio, unscoped room). An empty list = nothing to read. */
  listingIds: string[] | null
  physId?: string
  ownerId?: string
  buildingIds?: string[]
  market?: string
  /** The listings a whole-and-parts apartment rolled together, when there was more than one. */
  rolled?: string[]
}
export type ScopeResult = { ok: true; scope: Scope } | { ok: false; out: any }

function matchBuildings(d: Dims, ctx: EveCtx, text: string): { ids: string[]; ambiguous: DimBuilding[] | null } {
  const t = lc(text).replace(/\s+/g, ' ').trim()
  if (!t) return { ids: [], ambiguous: null }
  const sl = t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const scored: { b: DimBuilding; s: number }[] = []
  for (const b of d.buildings) {
    const label = lc(b.label)
    let s = 0
    if (lc(b.id) === t || label === t || b.id === sl || b.aliases.indexOf(t) >= 0) s = 100
    else if (label.includes(t) || b.aliases.some(a => a.includes(t))) s = 70
    else if (label.length >= 4 && t.includes(label)) s = 50
    if (s) scored.push({ b, s })
  }
  if (scored.length) {
    const top = Math.max(...scored.map(x => x.s))
    const best = scored.filter(x => x.s === top).map(x => x.b)
    if (best.length > 1) return { ids: [], ambiguous: best }
    return { ids: [best[0].id], ambiguous: null }
  }
  // The registry's own building match (rolled-up names), mapped to the spine's building ids.
  const ids: Record<string, true> = {}
  for (const lid of ctx.idsForBuilding(text)) { const u = d.byListing[lid]; if (u && u.building_id) ids[u.building_id] = true }
  return { ids: Object.keys(ids), ambiguous: null }
}

/**
 * The listings a question is about. Accepts unit / id / building / market / owner, or `scope` as
 * "building:Eden", "unit:Arya 1705", "owner:Smith", "market:Miami", "portfolio" or a bare name. A unit
 * is its whole apartment (every listing sharing its physical_unit_id). A scoped room (a vendor's) is
 * always narrowed to its own units.
 */
export async function resolveBrainScope(ctx: EveCtx, d: Dims, input: any): Promise<ScopeResult> {
  let unit = str(input?.unit).trim(), building = str(input?.building).trim(), market = str(input?.market).trim(), owner = str(input?.owner).trim()
  const id = str(input?.id).trim()
  const s = str(input?.scope).trim()
  if (s && !unit && !id && !building && !market && !owner) {
    const m = s.match(/^(unit|building|market|owner|portfolio)\s*[:=]\s*(.*)$/i)
    if (m) {
      const k = lc(m[1]), v = m[2].trim()
      if (k === 'unit') unit = v
      else if (k === 'building') building = v
      else if (k === 'market') market = v
      else if (k === 'owner') owner = v
    } else if (/^(portfolio|all|everything|whole portfolio|company)$/i.test(s)) {
      // the whole portfolio
    } else if (d.markets.some(x => lc(x) === lc(s))) market = s
    else {
      const mb = matchBuildings(d, ctx, s)
      if (mb.ids.length || mb.ambiguous) building = s
      else unit = s
    }
  }
  const room = scopeIds(ctx)
  const roomSet = room ? toSet(room) : null
  const narrow = (ids: string[]): string[] => (roomSet ? ids.filter(x => roomSet[x]) : ids)

  if (unit || id) {
    const hit = resolveListing(ctx, { id, name: unit, building })   // throws AmbiguousUnit on a tie — the registry asks "which one?"
    if (!hit) return { ok: false, out: { error: `No unit matches "${unit || id}".`, note: 'Give the unit as building AND number, or use resolve. That is not the same as "no data".' } }
    const du = d.byListing[hit.id]
    const pid = du ? du.physical_unit_id : hit.id
    const sibs = (d.byPhys[pid] || []).map(x => x.listing_id)
    const ids = narrow(sibs.length ? sibs : [hit.id])
    return { ok: true, scope: { kind: 'unit', label: du ? physName(ctx, d, pid) : hit.meta.name, listingIds: ids, physId: pid, rolled: ids.length > 1 ? ids.map(x => ctx.nameOf(x)) : undefined } }
  }
  if (building) {
    const mb = matchBuildings(d, ctx, building)
    if (mb.ambiguous) return { ok: false, out: { ambiguous: true, question: `Which building? "${building}" fits ${mb.ambiguous.length}.`, candidates: mb.ambiguous.map(b => ({ building: b.label, id: b.id, market: b.market })), note: 'Do not pick one yourself — ask, or call again with the exact name.' } }
    if (!mb.ids.length) return { ok: false, out: { error: `No building matches "${building}".`, note: 'Check the name, or use resolve with kind "building".' } }
    const set = toSet(mb.ids)
    const ids = narrow(d.units.filter(u => u.building_id && set[u.building_id]).map(u => u.listing_id))
    return { ok: true, scope: { kind: 'building', label: mb.ids.map(x => buildingLabel(d, x)).join(' + '), listingIds: ids, buildingIds: mb.ids } }
  }
  if (market) {
    const mk = d.markets.find(x => lc(x) === lc(market)) || d.markets.find(x => lc(x).includes(lc(market)))
    if (!mk) return { ok: false, out: { error: `No market matches "${market}".`, markets: d.markets } }
    return { ok: true, scope: { kind: 'market', label: mk, listingIds: narrow(d.units.filter(u => u.market === mk).map(u => u.listing_id)), market: mk } }
  }
  if (owner) {
    if (guarded(ctx)) return { ok: false, out: { error: 'Owners are not read out in this room.' } }
    const r = await resolveEntity(ctx, owner, 'owner')
    const cands = r.candidates.filter(c => c.kind === 'owner')
    if (!cands.length) return { ok: false, out: { error: `No owner matches "${owner}".`, note: r.unavailable.length ? 'The owner list could not be read.' : 'Check the spelling, or use resolve with kind "owner".' } }
    const top = cands[0].score
    const best = cands.filter(c => c.score === top)
    if (best.length > 1) return { ok: false, out: { ambiguous: true, question: `Which owner? "${owner}" fits ${best.length}.`, candidates: best.slice(0, 10).map(c => ({ owner: c.name, detail: c.detail })), note: 'Do not pick one yourself — ask.' } }
    const oid = best[0].id
    return { ok: true, scope: { kind: 'owner', label: best[0].name, listingIds: narrow(d.units.filter(u => u.owner_id === oid).map(u => u.listing_id)), ownerId: oid } }
  }
  return { ok: true, scope: { kind: 'portfolio', label: room ? 'this room\'s buildings' : 'whole portfolio', listingIds: room ? room.slice() : null } }
}

// ───────────────────────────────────────────────────────────── paged reads
/** Run async jobs a few at a time (the Supabase pool is shared with every other request). */
export async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let i = 0
  const worker = async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k]() } }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, jobs.length)) }, () => worker()))
  return out
}

export const UD_COLS = 'day,listing_id,physical_unit_id,building_id,market,owner_id,state,net_accom,gross_accom,cleaning_rev,glitches_opened,refunds,maint_cost_billed,partial'

/**
 * fact_unit_day rows for [from, to] (inclusive), optionally for some listings. Read in month slices
 * and id chunks, four at a time, each paged to completion and ordered by its primary key.
 */
export async function readUnitDays(ctx: EveCtx, from: string, to: string, listingIds: string[] | null, cols: string = UD_COLS): Promise<{ rows: any[]; truncated: boolean }> {
  if ((listingIds && !listingIds.length) || to < from) return { rows: [], truncated: false }
  const slices: [string, string][] = []
  for (let a = from; a <= to && slices.length < 20;) {
    const b0 = shiftDay(a, 30)
    const b = b0 < to ? b0 : to
    slices.push([a, b])
    a = shiftDay(b, 1)
  }
  const parts: (string[] | null)[] = listingIds ? chunk(listingIds, 100) : [null]
  const jobs: (() => Promise<{ rows: any[]; truncated: boolean }>)[] = []
  for (const sl of slices) {
    for (const part of parts) {
      jobs.push(() => pageRows<any>((x, y) => {
        let q = ctx.db.from('fact_unit_day').select(cols).gte('day', sl[0]).lte('day', sl[1])
        if (part) q = q.in('listing_id', part)
        return q.order('day').order('listing_id').range(x, y)
      }, 15))
    }
  }
  const got = await pool(jobs, 4)
  const rows: any[] = []
  let truncated = slices.length >= 20 && slices[slices.length - 1][1] < to
  for (const g of got) { for (const r of g.rows) rows.push(r); if (g.truncated) truncated = true }
  return { rows, truncated }
}

export const EV_COLS = 'event_id,source,listing_id,physical_unit_id,building_id,market,system,title,root_cause,resolution,part,opened_at,closed_at,hours_to_close,is_open,guest_impacting,vendor_key,billed_owner,refund,repeat_n_90d,is_repeat,prior_event_id,partial'

/** fact_maintenance_event rows opened in [sinceDay, untilDay] (Eastern days, inclusive), filtered in the query. */
export async function readEvents(ctx: EveCtx, o: { sinceDay: string; untilDay?: string | null; listingIds?: string[] | null; physId?: string | null; system?: string | null; vendorKey?: string | null; cols?: string }): Promise<{ rows: any[]; truncated: boolean }> {
  if (o.listingIds && !o.listingIds.length) return { rows: [], truncated: false }
  const cols = o.cols || EV_COLS
  // opened_at is a timestamp; the day edges are widened by one in UTC and trimmed to Eastern days below.
  const sinceIso = shiftDay(o.sinceDay, -1) + 'T00:00:00Z'
  const untilIso = o.untilDay ? shiftDay(o.untilDay, 2) + 'T00:00:00Z' : null
  const parts: (string[] | null)[] = o.listingIds && !o.physId ? chunk(o.listingIds, 100) : [null]
  const got = await pool(parts.map(part => () => pageRows<any>((x, y) => {
    let q = ctx.db.from('fact_maintenance_event').select(cols).gte('opened_at', sinceIso)
    if (untilIso) q = q.lt('opened_at', untilIso)
    if (o.physId) q = q.eq('physical_unit_id', o.physId)
    if (part) q = q.in('listing_id', part)
    if (o.system) q = q.eq('system', o.system)
    if (o.vendorKey) q = q.eq('vendor_key', o.vendorKey)
    return q.order('opened_at').order('event_id').range(x, y)
  }, 10)), 3)
  const rows: any[] = []
  let truncated = false
  for (const g of got) {
    if (g.truncated) truncated = true
    for (const r of g.rows) {
      const day = etDay(r.opened_at)
      if (day && (day < o.sinceDay || (o.untilDay && day > o.untilDay))) continue
      rows.push(r)
    }
  }
  return { rows, truncated }
}

/** The newest unit_health_daily day, and its rows (optionally for some apartments). */
export async function readHealthLatest(ctx: EveCtx, physIds: string[] | null): Promise<{ day: string | null; rows: any[]; truncated: boolean }> {
  const { data, error } = await ctx.db.from('unit_health_daily').select('day').order('day', { ascending: false }).limit(1)
  if (error) throw error
  const day = ((data as any[]) || [])[0]?.day ? str(((data as any[]) || [])[0].day).slice(0, 10) : null
  if (!day) return { day: null, rows: [], truncated: false }
  if (physIds && !physIds.length) return { day, rows: [], truncated: false }
  const cols = 'day,physical_unit_id,listing_id,nickname,building_id,market,review_avg_live,review_n,low_reviews_90d,occupied_nights_90d,glitches_90d,glitches_per_100_nights,repeat_systems,pm_overdue_count,pm_max_days_late,last_inspection_pass,last_inspection_at,net_revenue_90d,upkeep_billed_90d,upkeep_cost_pct_rev,score,band,drivers,formula,partial'
  const parts: (string[] | null)[] = physIds ? chunk(physIds, 100) : [null]
  const rows: any[] = []
  let truncated = false
  for (const part of parts) {
    const g = await pageRows<any>((x, y) => {
      let q = ctx.db.from('unit_health_daily').select(cols).eq('day', day)
      if (part) q = q.in('physical_unit_id', part)
      return q.order('physical_unit_id').range(x, y)
    }, 3)
    for (const r of g.rows) rows.push(r)
    if (g.truncated) truncated = true
  }
  return { day, rows, truncated }
}

// ───────────────────────────────────────────────────────────── the sums
export type Acc = {
  /** apartment|day → 3 occupied · 2 owner stay · 1 vacant (the highest state any listing in the set had) */
  aptDay: Record<string, number>
  guestNights: number
  net: number; gross: number; clean: number; glitches: number; refunds: number; billed: number
  events: number
  rows: number; partialRows: number
}
export function newAcc(): Acc {
  return { aptDay: {}, guestNights: 0, net: 0, gross: 0, clean: 0, glitches: 0, refunds: 0, billed: 0, events: 0, rows: 0, partialRows: 0 }
}
export function addDayRow(a: Acc, r: any, aptKey: string): void {
  const k = aptKey + '|' + str(r.day).slice(0, 10)
  const st = str(r.state)
  const rank = st === 'occupied' ? 3 : st === 'owner_stay' ? 2 : 1
  const prev = a.aptDay[k]
  if (prev === undefined || prev < rank) a.aptDay[k] = rank
  if (st === 'occupied') a.guestNights++
  a.net += num(r.net_accom); a.gross += num(r.gross_accom); a.clean += num(r.cleaning_rev)
  a.glitches += num(r.glitches_opened); a.refunds += num(r.refunds); a.billed += num(r.maint_cost_billed)
  a.rows++
  if (r.partial === true) a.partialRows++
}
export function mergeAcc(into: Acc, from: Acc): void {
  for (const k of Object.keys(from.aptDay)) { const prev = into.aptDay[k]; if (prev === undefined || prev < from.aptDay[k]) into.aptDay[k] = from.aptDay[k] }
  into.guestNights += from.guestNights; into.net += from.net; into.gross += from.gross; into.clean += from.clean
  into.glitches += from.glitches; into.refunds += from.refunds; into.billed += from.billed; into.events += from.events
  into.rows += from.rows; into.partialRows += from.partialRows
}
export function nightsOf(a: Acc): { available: number; occupied: number; owner: number } {
  let available = 0, occupied = 0, owner = 0
  for (const k of Object.keys(a.aptDay)) { available++; const v = a.aptDay[k]; if (v === 3) occupied++; else if (v === 2) owner++ }
  return { available, occupied, owner }
}
/** The performance block every brain-backed answer uses (one definition: see the header). */
export function perfOf(a: Acc): { net_revenue: number; adr: number | null; revpar: number | null; occupancy_pct: number | null; nights_booked: number; guest_listing_nights: number; nights_available: number; owner_nights: number } {
  const n = nightsOf(a)
  const sellable = n.available - n.owner
  return {
    net_revenue: Math.round(a.net),
    adr: a.guestNights > 0 ? Math.round(a.net / a.guestNights) : null,
    revpar: n.available > 0 ? Math.round(a.net / n.available) : null,
    occupancy_pct: sellable > 0 ? Math.round((n.occupied / sellable) * 1000) / 10 : null,
    nights_booked: n.occupied, guest_listing_nights: a.guestNights, nights_available: n.available, owner_nights: n.owner,
  }
}

/** Whole days from a to b (b − a), on Eastern dates. */
export function daysBetween(a: string, b: string): number {
  const x = Date.parse(a.slice(0, 10) + 'T12:00:00Z'), y = Date.parse(b.slice(0, 10) + 'T12:00:00Z')
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86400_000) : 0
}

/** The earliest night fact_unit_day holds — older windows are not in the brain. Read once per request. */
const _first = new WeakMap<object, Promise<string | null>>()
export function firstFactDay(ctx: EveCtx): Promise<string | null> {
  let p = _first.get(ctx)
  if (!p) {
    p = (async () => {
      try {
        const { data, error } = await ctx.db.from('fact_unit_day').select('day').order('day', { ascending: true }).limit(1)
        if (error) return null
        const r: any = ((data as any[]) || [])[0]
        return r && r.day ? str(r.day).slice(0, 10) : null
      } catch { return null }
    })()
    _first.set(ctx, p)
  }
  return p
}

// ───────────────────────────────────────────────────────────── systems
export const SYSTEMS = ['hvac', 'plumbing', 'appliance', 'lock_access', 'electrical', 'pest', 'wifi_tv', 'furniture', 'cleaning', 'other']
/** A system as a person says it ("A/C", "the fridge", "door lock") → the brain's key, or null. */
export function systemKey(v: any): string | null {
  const t = lc(v).trim()
  if (!t) return null
  if (SYSTEMS.indexOf(t) >= 0) return t
  if (/\b(a\/?c|ac|air|hvac|cool|heat|thermostat|mini-?split|compressor|condens|aire)\b/.test(t)) return 'hvac'
  if (/(plumb|leak|toilet|drain|water heater|faucet|shower|pipe|clog|sink|agua)/.test(t)) return 'plumbing'
  if (/(applian|fridge|refrigerat|washer|dryer|dishwasher|oven|stove|microwave|ice maker|range)/.test(t)) return 'appliance'
  if (/(lock|door|key|access|salto|keypad|cerradura)/.test(t)) return 'lock_access'
  if (/(electr|outlet|breaker|light|power|switch)/.test(t)) return 'electrical'
  if (/(pest|roach|ant|bug|rodent|mouse|rat|termite)/.test(t)) return 'pest'
  if (/(wi-?fi|internet|tv|television|router|cable|streaming)/.test(t)) return 'wifi_tv'
  if (/(furnit|sofa|couch|bed|mattress|chair|table|blind|curtain)/.test(t)) return 'furniture'
  if (/(clean|limpi)/.test(t)) return 'cleaning'
  return null
}

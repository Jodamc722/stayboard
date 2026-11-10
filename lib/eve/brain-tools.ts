// MEASURE AND QUERY — the business brain's numbers, on one definition (2026-11-10).
//
//   measure   one named measure over fact_unit_day (or fact_maintenance_event for maint_events), at a
//             grain (unit · apartment · building · market · owner · portfolio) × (day · week · month ·
//             total), optionally against the window before or the same window a year ago, optionally
//             ranked. The sums are done here, in JS, from paged reads with the filters in the query —
//             never from raw reservation rows.
//   query     a guarded look into seven brain tables: per-table column allow-lists, only eq / in /
//             range filters, optional group-by with count / sum / avg / min / max, at most 200 rows.
//             No free SQL. Money columns are left out for anyone who may not see money.
//
// Both fail open: a brain table that is missing, empty or older than 36 hours answers
// { stale: true, note } and names the live tool to use instead (lib/eve/brain-data.ts).
import 'server-only'
import type { EveTool } from './types'
import { obj, S } from './types'
import type { EveCtx } from './ctx'
import { lc, round2, shiftDay, pageRows, chunk, scopeIds, clampLimit } from './ctx'
import {
  BRAIN_SOURCE, BRAIN_NIGHTS_BASIS, BILLED_NOTE, str, toSet, guarded, freshAll, staleOut, brainMeta, brainDims,
  resolveBrainScope, readUnitDays, readEvents, newAcc, addDayRow, mergeAcc, nightsOf, physName, buildingLabel,
  firstFactDay, daysBetween, type Acc, type Dims, type Scope, type BrainTable,
} from './brain-data'
import { etDay } from '@/lib/brain/shared'

const LIVE_TOOLS = 'For revenue use kpi / unit_360 / building_360; for upkeep use upkeep_due and glitches — and say the nightly numbers were not available.'

// ───────────────────────────────────────────────────────────── measure
const MEASURES = ['net_accom', 'gross_accom', 'occupied_nights', 'available_nights', 'occupancy', 'adr', 'revpar', 'owner_nights', 'cleaning_rev', 'glitches', 'refunds', 'maint_events', 'billed_upkeep']
const MONEY_MEASURES = toSet(['net_accom', 'gross_accom', 'adr', 'revpar', 'cleaning_rev', 'refunds', 'billed_upkeep'])
const MEASURE_ALIAS: Record<string, string> = {
  revenue: 'net_accom', net: 'net_accom', net_revenue: 'net_accom', net_accommodation: 'net_accom', gross: 'gross_accom', gross_revenue: 'gross_accom',
  nights: 'occupied_nights', booked_nights: 'occupied_nights', guest_nights: 'occupied_nights', available: 'available_nights',
  occ: 'occupancy', occupancy_pct: 'occupancy', cleaning: 'cleaning_rev', cleaning_fees: 'cleaning_rev', cleaning_revenue: 'cleaning_rev',
  guest_issues: 'glitches', issues: 'glitches', glitches_opened: 'glitches', maintenance: 'maint_events', maint: 'maint_events', events: 'maint_events',
  upkeep: 'billed_upkeep', billed: 'billed_upkeep', maint_cost_billed: 'billed_upkeep', upkeep_billed: 'billed_upkeep', owner_stays: 'owner_nights',
}
const MEASURE_BASIS: Record<string, string> = {
  net_accom: BRAIN_NIGHTS_BASIS, gross_accom: 'Accommodation before the channel fee, real stays only, spread evenly over their nights; no cleaning.',
  occupied_nights: BRAIN_NIGHTS_BASIS, available_nights: BRAIN_NIGHTS_BASIS, occupancy: BRAIN_NIGHTS_BASIS, adr: BRAIN_NIGHTS_BASIS, revpar: BRAIN_NIGHTS_BASIS, owner_nights: BRAIN_NIGHTS_BASIS,
  cleaning_rev: 'The departing stay\'s cleaning fee, on its check-out day.',
  glitches: 'Guest issues filed that day on the glitch board.',
  refunds: 'Refunds approved on guest issues filed that day.',
  maint_events: 'Things that broke or were fixed, opened that day: guest issues, non-routine Breezeway maintenance tasks, work orders (a glitch and the task pushed from it are one event; routine PM, filters and deep cleans are left out).',
  billed_upkeep: `Breezeway maintenance tasks finished that day: cost + billable supply lines — ${BILLED_NOTE}.`,
}
const BY_KEYS = ['unit', 'physical_unit', 'building', 'market', 'owner', 'portfolio']
const PERIODS = ['day', 'week', 'month', 'total']

const isDay = (v: any): boolean => /^\d{4}-\d{2}-\d{2}$/.test(str(v).trim())
const mondayOf = (day: string): string => { const wd = (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7; return shiftDay(day, -wd) }
const yearBack = (day: string): string => { const y = Number(day.slice(0, 4)) - 1; const md = day.slice(5) === '02-29' ? '02-28' : day.slice(5); return y + '-' + md }

function parseGrain(grain: any, period: any): { by: string; period: string } {
  const toks = lc(grain).replace(/physical[\s_-]+unit/g, 'physical_unit').split(/[^a-z_]+/).filter(Boolean)
  let by = 'portfolio', per = ''
  for (const t0 of toks) {
    const t = t0 === 'apartment' || t0 === 'apartments' || t0 === 'physical' ? 'physical_unit' : t0 === 'listing' || t0 === 'units' || t0 === 'listings' ? 'unit' : t0 === 'buildings' ? 'building' : t0 === 'owners' ? 'owner' : t0 === 'markets' ? 'market' : t0 === 'weekly' ? 'week' : t0 === 'monthly' ? 'month' : t0 === 'daily' ? 'day' : t0
    if (BY_KEYS.indexOf(t) >= 0 && by === 'portfolio') by = t
    else if (PERIODS.indexOf(t) >= 0 && !per) per = t
  }
  const p = lc(period).trim()
  if (PERIODS.indexOf(p) >= 0) per = p
  return { by, period: per || 'total' }
}

function parseRank(v: any): { dir: 'top' | 'bottom'; n: number } | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v) && v !== 0) return { dir: v > 0 ? 'top' : 'bottom', n: Math.min(Math.abs(Math.round(v)), 50) }
  const s = lc(v)
  const n = Number((s.match(/\d+/) || ['10'])[0])
  return { dir: /bottom|worst|lowest|least/.test(s) ? 'bottom' : 'top', n: Math.min(Math.max(n || 10, 1), 50) }
}

function valueOf(m: string, a: Acc): number | null {
  const n = nightsOf(a)
  const sellable = n.available - n.owner
  switch (m) {
    case 'net_accom': return Math.round(a.net)
    case 'gross_accom': return Math.round(a.gross)
    case 'occupied_nights': return n.occupied
    case 'available_nights': return n.available
    case 'owner_nights': return n.owner
    case 'occupancy': return sellable > 0 ? Math.round((n.occupied / sellable) * 1000) / 10 : null
    case 'adr': return a.guestNights > 0 ? round2(a.net / a.guestNights) : null
    case 'revpar': return n.available > 0 ? round2(a.net / n.available) : null
    case 'cleaning_rev': return Math.round(a.clean)
    case 'glitches': return a.glitches
    case 'refunds': return round2(a.refunds)
    case 'maint_events': return a.events
    case 'billed_upkeep': return round2(a.billed)
    default: return null
  }
}
/** The numerator / denominator behind a ratio, so the answer can show its sample. */
function partsOf(m: string, a: Acc): any {
  if (m === 'occupancy') { const n = nightsOf(a); return { guest_nights: n.occupied, sellable_nights: n.available - n.owner } }
  if (m === 'adr') return { guest_listing_nights: a.guestNights }
  if (m === 'revpar') return { available_nights: nightsOf(a).available }
  return undefined
}

type Grouped = { groups: Record<string, Record<string, Acc>>; overall: Acc; truncated: boolean; n: number }

async function accumulate(ctx: EveCtx, d: Dims, scope: Scope, m: string, by: string, period: string, from: string, to: string): Promise<Grouped> {
  const groups: Record<string, Record<string, Acc>> = {}
  const overall = newAcc()
  const keyOf = (r: any): string => {
    if (by === 'unit') return str(r.listing_id) || '(no listing)'
    if (by === 'physical_unit') return str(r.physical_unit_id) || str(r.listing_id) || '(no unit)'
    if (by === 'building') return str(r.building_id) || 'unassigned'
    if (by === 'market') return str(r.market) || 'unknown'
    if (by === 'owner') return str(r.owner_id) || '(no owner)'
    return 'portfolio'
  }
  const bucketOf = (day: string): string => (period === 'day' ? day : period === 'week' ? mondayOf(day) : period === 'month' ? day.slice(0, 7) : 'total')
  const slot = (k: string, b: string): Acc => { const g = (groups[k] = groups[k] || {}); return (g[b] = g[b] || newAcc()) }
  if (m === 'maint_events') {
    const ev = await readEvents(ctx, { sinceDay: from, untilDay: to, listingIds: scope.listingIds, cols: 'event_id,listing_id,physical_unit_id,building_id,market,opened_at' })
    for (const e of ev.rows) {
      const du = d.byListing[str(e.listing_id)]
      const r = { listing_id: e.listing_id, physical_unit_id: e.physical_unit_id || (du ? du.physical_unit_id : null), building_id: e.building_id || (du ? du.building_id : null), market: e.market || (du ? du.market : null), owner_id: du ? du.owner_id : null }
      const day = etDay(e.opened_at)
      if (!day) continue
      slot(keyOf(r), bucketOf(day)).events++
      overall.events++
    }
    return { groups, overall, truncated: ev.truncated, n: ev.rows.length }
  }
  const ud = await readUnitDays(ctx, from, to, scope.listingIds)
  for (const r of ud.rows) {
    const day = str(r.day).slice(0, 10)
    const apt = by === 'unit' ? str(r.listing_id) : (str(r.physical_unit_id) || str(r.listing_id))
    addDayRow(slot(keyOf(r), bucketOf(day)), r, apt)
    addDayRow(overall, r, apt)
  }
  return { groups, overall, truncated: ud.truncated, n: ud.rows.length }
}

async function ownerNames(ctx: EveCtx, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const want = ids.filter(x => x && x !== '(no owner)')
  if (!want.length || guarded(ctx)) return out
  try {
    for (const part of chunk(want, 100)) {
      const { data, error } = await ctx.db.from('guesty_owners').select('id,full_name').in('id', part).order('id')
      if (error) break
      for (const o of ((data as any[]) || [])) out[str(o.id)] = str(o.full_name)
    }
  } catch { /* names stay as ids */ }
  return out
}

function groupName(ctx: EveCtx, d: Dims, by: string, key: string, scope: Scope, owners: Record<string, string>): string {
  if (by === 'unit') return d.byListing[key]?.nickname || ctx.nameOf(key)
  if (by === 'physical_unit') return physName(ctx, d, key)
  if (by === 'building') return buildingLabel(d, key === 'unassigned' ? '' : key)
  if (by === 'owner') return guarded(ctx) ? 'an owner' : (owners[key] || key)
  if (by === 'portfolio') return scope.label
  return key
}

const MEASURE: EveTool = {
  name: 'measure',
  money: true,
  description: 'THE ONE DEFINITION OF A BUSINESS NUMBER, from the nightly business brain (one row per listing per night). Use it FIRST for revenue, occupancy, ADR, RevPAR, owner nights, cleaning revenue, guest issues, refunds, maintenance events or billed upkeep over any window — never add up reservation rows when this exists. Params: name (net_accom | gross_accom | occupied_nights | available_nights | occupancy | adr | revpar | owner_nights | cleaning_rev | glitches | refunds | maint_events | billed_upkeep), grain ("<by> <period>": by = unit | physical_unit | building | market | owner | portfolio; period = day | week | month | total — e.g. "building month"), scope (optional: building / unit / owner / market, or "building:Eden"), from / to (YYYY-MM-DD, default the last 30 nights to yesterday), compare ("prior" = the window before, "yoy" = same dates a year earlier), rank ("top 10" / "bottom 5"). Returns rows, overall, total_rows, truncated, basis and as_of (when the brain was built). billed_upkeep is billed to owner, not true cost.',
  input_schema: obj({ name: S.str, grain: S.str, period: S.str, scope: S.str, building: S.str, unit: S.str, owner: S.str, market: S.str, from: S.str, to: S.str, compare: S.str, rank: S.str, limit: S.num }, ['name']),
  run: async (input, ctx) => {
    const raw = lc(input?.name).trim().replace(/[\s-]+/g, '_')
    const m = MEASURES.indexOf(raw) >= 0 ? raw : MEASURE_ALIAS[raw] || ''
    if (!m) return { error: `Unknown measure "${input?.name}".`, measures: MEASURES }
    const { by, period } = parseGrain(input?.grain, input?.period)
    if (MONEY_MEASURES[m] && !ctx.canMoney) {
      return { money_hidden: true, measure: m, note: `${m} is a dollar figure and dollar amounts are hidden for this user. occupancy, occupied_nights, available_nights, owner_nights, glitches and maint_events still answer.` }
    }
    const tables: BrainTable[] = m === 'maint_events' ? ['fact_maintenance_event', 'dim_unit'] : ['fact_unit_day', 'dim_unit']
    const fresh = await freshAll(ctx, tables)
    if (!fresh.ok) return staleOut(fresh.note, LIVE_TOOLS)
    let to = isDay(input?.to) ? str(input.to).trim() : shiftDay(ctx.today, -1)
    let from = isDay(input?.from) ? str(input.from).trim() : shiftDay(to, -29)
    if (from > to) { const t = from; from = to; to = t }
    const notes: string[] = []
    if (daysBetween(from, to) > 399) { from = shiftDay(to, -399); notes.push(`The window was cut to 400 nights (${from} → ${to}).`) }
    const span = daysBetween(from, to) + 1
    const cmp = lc(input?.compare).trim()
    const compare = /yoy|year/.test(cmp) ? 'yoy' : /prior|prev|before|last/.test(cmp) ? 'prior' : 'none'

    const d = await brainDims(ctx)
    const sr = await resolveBrainScope(ctx, d, input)
    if (!sr.ok) return sr.out
    const scope = sr.scope
    if (scope.listingIds && !scope.listingIds.length) return { measure: m, scope: scope.label, note: 'No units in that scope (or none this room may see).', rows: [], total_rows: 0, truncated: false }
    if (by === 'owner' && guarded(ctx)) return { error: 'Owners are not read out in this room.' }

    const cur = await accumulate(ctx, d, scope, m, by, period, from, to)
    const first = await firstFactDay(ctx)
    if (first && from < first && m !== 'maint_events') notes.push(`The brain holds nights from ${first}; nothing before that is counted.`)

    // Group totals (all buckets together) decide the ranking and carry the comparison.
    const gTot: Record<string, Acc> = {}
    for (const k of Object.keys(cur.groups)) { const a = newAcc(); for (const b of Object.keys(cur.groups[k])) mergeAcc(a, cur.groups[k][b]); gTot[k] = a }
    const rank = parseRank(input?.rank)
    let keys = Object.keys(gTot)
    const v = (k: string): number | null => valueOf(m, gTot[k])
    keys.sort((a, b) => {
      const x = v(a), y = v(b)
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return rank && rank.dir === 'bottom' ? x - y : y - x
    })
    const groupCap = rank ? rank.n : period === 'total' ? clampLimit(input?.limit, 40, 100) : clampLimit(input?.limit, 12, 40)
    const allGroups = keys.length
    if (rank) keys = keys.filter(k => v(k) != null)
    const shownKeys = keys.slice(0, groupCap)

    let cmpG: Grouped | null = null
    let cmpWin = ''
    if (compare !== 'none') {
      const cTo = compare === 'prior' ? shiftDay(from, -1) : yearBack(to)
      const cFrom = compare === 'prior' ? shiftDay(cTo, -(span - 1)) : yearBack(from)
      cmpWin = `${cFrom} → ${cTo}`
      cmpG = await accumulate(ctx, d, scope, m, by, 'total', cFrom, cTo)
      if (first && cFrom < first && m !== 'maint_events') notes.push(`The comparison window starts before the brain's first night (${first}) — the comparison is partial; say so.`)
    }
    const cmpVal = (k: string | null): number | null => {
      if (!cmpG) return null
      if (k == null) return valueOf(m, cmpG.overall)
      const g = cmpG.groups[k]
      return g && g.total ? valueOf(m, g.total) : null
    }
    const delta = (a: number | null, b: number | null) => (a == null || b == null ? {} : { change: round2(a - b), change_pct: b !== 0 ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null })

    const owners: Record<string, string> = by === 'owner' ? await ownerNames(ctx, shownKeys) : {}
    const rows: any[] = []
    let totalRows = 0
    for (const k of keys) totalRows += Object.keys(cur.groups[k]).length
    for (const k of shownKeys) {
      const name = groupName(ctx, d, by, k, scope, owners)
      const buckets = Object.keys(cur.groups[k]).sort()
      for (const b of buckets) {
        const a = cur.groups[k][b]
        const row: any = { name, value: valueOf(m, a) }
        if (period !== 'total') row.period = b
        const parts = partsOf(m, a)
        if (parts) row.sample = parts
        if (period === 'total' && cmpG) { const c = cmpVal(k); row.compare_value = c; Object.assign(row, delta(row.value, c)) }
        rows.push(row)
      }
    }
    const compareByGroup = cmpG && period !== 'total'
      ? shownKeys.map(k => { const val = v(k); const c = cmpVal(k); return { name: groupName(ctx, d, by, k, scope, owners), value: val, compare_value: c, ...delta(val, c) } })
      : undefined
    const overallVal = valueOf(m, cur.overall)
    const overall: any = { value: overallVal, sample: partsOf(m, cur.overall) }
    if (cmpG) { const c = cmpVal(null); overall.compare_value = c; Object.assign(overall, delta(overallVal, c)) }
    if (cur.overall.partialRows) notes.push(`${cur.overall.partialRows} of the nights read were built from a short read upstream (partial) — treat the figure as a floor.`)
    if (by === 'owner') notes.push('A unit\'s owner is today\'s owner for its whole history.')
    if (m === 'adr' || m === 'revpar' || m === 'net_accom') notes.push('Owner and friends-and-family stays earn nothing here and are kept out of guest nights.')
    const truncated = cur.truncated || (cmpG ? cmpG.truncated : false)
    if (truncated) notes.push('A read stopped early — the figures are floors, not exact. Say so, or narrow the scope or window.')
    const shownRows = rows.length
    return {
      measure: m, grain: { by, period }, scope: scope.label, rolled_together: scope.rolled,
      window: `${from} → ${to} (${span} nights)`,
      compare: cmpG ? { kind: compare, window: cmpWin } : undefined,
      ranked: rank ? `${rank.dir} ${rank.n} by ${m}` : `largest ${m} first`,
      overall, rows, compare_by_group: compareByGroup,
      groups: allGroups, total_rows: totalRows, rows_shown: shownRows, truncated: truncated || shownRows < totalRows,
      basis: MEASURE_BASIS[m],
      note: notes.length ? notes.join(' ') : undefined,
      _meta: brainMeta({ source: m === 'maint_events' ? 'fact_maintenance_event (' + BRAIN_SOURCE + ')' : 'fact_unit_day (' + BRAIN_SOURCE + ')', window: `${from} → ${to}`, n: cur.n, truncated: truncated || shownRows < totalRows, basis: MEASURE_BASIS[m].slice(0, 100), as_of: fresh.as_of }),
    }
  },
}

// ───────────────────────────────────────────────────────────── query
type Spec = { cols: string[]; money: string[]; numeric: string[]; pk: string[]; listing: boolean; hideGuarded: string[]; note?: string }
const SPECS: Record<string, Spec> = {
  fact_unit_day: {
    cols: ['day', 'listing_id', 'physical_unit_id', 'building_id', 'market', 'owner_id', 'state', 'reservation_id', 'channel', 'gross_accom', 'channel_fee', 'net_accom', 'cleaning_rev', 'is_arrival', 'is_departure', 'clean_minutes', 'clean_done_by', 'clean_late', 'glitches_opened', 'refunds', 'maint_tasks_done', 'maint_cost_billed', 'partial', 'built_at'],
    money: ['gross_accom', 'channel_fee', 'net_accom', 'cleaning_rev', 'refunds', 'maint_cost_billed'],
    numeric: ['gross_accom', 'channel_fee', 'net_accom', 'cleaning_rev', 'clean_minutes', 'glitches_opened', 'refunds', 'maint_tasks_done', 'maint_cost_billed'],
    pk: ['day', 'listing_id'], listing: true, hideGuarded: ['reservation_id', 'clean_done_by', 'owner_id'],
    note: 'One row per listing per night. maint_cost_billed is billed to owner, not true cost.',
  },
  fact_maintenance_event: {
    cols: ['event_id', 'source', 'listing_id', 'physical_unit_id', 'building_id', 'market', 'system', 'system_source', 'title', 'root_cause', 'resolution', 'part', 'opened_at', 'closed_at', 'hours_to_close', 'is_open', 'guest_impacting', 'reservation_id', 'person_name', 'vendor_key', 'bz_task_id', 'labor_minutes', 'billed_owner', 'refund', 'repeat_n_90d', 'is_repeat', 'prior_event_id', 'partial', 'built_at'],
    money: ['billed_owner', 'refund'],
    numeric: ['hours_to_close', 'labor_minutes', 'billed_owner', 'refund', 'repeat_n_90d'],
    pk: ['event_id'], listing: true, hideGuarded: ['reservation_id', 'person_name', 'vendor_key'],
    note: 'One row per thing that broke or was fixed. billed_owner is billed to owner, not true cost; true cost columns are not captured yet.',
  },
  unit_health_daily: {
    cols: ['day', 'physical_unit_id', 'listing_id', 'nickname', 'building_id', 'market', 'review_avg_live', 'review_n', 'low_reviews_90d', 'occupied_nights_90d', 'glitches_90d', 'glitches_per_100_nights', 'repeat_systems', 'pm_overdue_count', 'pm_max_days_late', 'last_inspection_pass', 'last_inspection_at', 'net_revenue_90d', 'upkeep_billed_90d', 'upkeep_cost_pct_rev', 'score', 'band', 'drivers', 'partial', 'built_at'],
    money: ['net_revenue_90d', 'upkeep_billed_90d'],
    numeric: ['review_avg_live', 'review_n', 'low_reviews_90d', 'occupied_nights_90d', 'glitches_90d', 'glitches_per_100_nights', 'pm_overdue_count', 'pm_max_days_late', 'last_inspection_pass', 'net_revenue_90d', 'upkeep_billed_90d', 'upkeep_cost_pct_rev', 'score'],
    pk: ['day', 'physical_unit_id'], listing: true, hideGuarded: [],
    note: 'One row per apartment per day built. For today\'s ranking use unit_health.',
  },
  owner_month: {
    cols: ['month', 'owner_id', 'owner_name', 'units', 'available_nights', 'occupied_nights', 'owner_nights', 'occupancy', 'net_accom', 'gross_accom', 'cleaning_rev', 'revpar', 'mgmt_fee', 'billed_owner', 'refunds', 'glitches', 'repeat_events', 'maint_events', 'review_avg', 'review_n', 'partial', 'built_at'],
    money: ['net_accom', 'gross_accom', 'cleaning_rev', 'revpar', 'mgmt_fee', 'billed_owner', 'refunds'],
    numeric: ['units', 'available_nights', 'occupied_nights', 'owner_nights', 'occupancy', 'net_accom', 'gross_accom', 'cleaning_rev', 'revpar', 'mgmt_fee', 'billed_owner', 'refunds', 'glitches', 'repeat_events', 'maint_events', 'review_avg', 'review_n'],
    pk: ['month', 'owner_id'], listing: false, hideGuarded: ['owner_id', 'owner_name'],
    note: 'Partial by design in v1: no labour cost, claims or statement lines, so no margin. Nights are listing-nights.',
  },
  vendor_month: {
    cols: ['month', 'vendor_key', 'vendor_label', 'jobs', 'jobs_closed', 'median_hours_to_close', 'repeat_visits', 'billed_owner', 'invoices_total', 'invoices_n', 'partial', 'built_at'],
    money: ['billed_owner', 'invoices_total'],
    numeric: ['jobs', 'jobs_closed', 'median_hours_to_close', 'repeat_visits', 'billed_owner', 'invoices_total', 'invoices_n'],
    pk: ['month', 'vendor_key'], listing: false, hideGuarded: [],
    note: 'Only work that carries a vendor (glitches with a vendor picked) — thin in v1.',
  },
  dim_unit: {
    cols: ['listing_id', 'physical_unit_id', 'parent_listing_id', 'is_parent', 'building_id', 'market', 'nickname', 'unit_label', 'bedrooms', 'bathrooms', 'sqft', 'ac_type', 'vendor_cleaned', 'bz_home_id', 'owner_id', 'active_from', 'active_to', 'status', 'partial', 'built_at'],
    money: [], numeric: ['bedrooms', 'bathrooms', 'sqft'],
    pk: ['listing_id'], listing: true, hideGuarded: ['owner_id'],
  },
  dim_building: {
    cols: ['id', 'label', 'market', 'lux', 'vendor_cleaned', 'aliases', 'known', 'units', 'partial', 'built_at'],
    money: [], numeric: ['units'],
    pk: ['id'], listing: false, hideGuarded: [],
  },
}
const prim = (v: any): boolean => v === null || ['string', 'number', 'boolean'].indexOf(typeof v) >= 0

type Filter = { col: string; op: 'eq' | 'is' | 'in' | 'range'; val?: any; vals?: any[]; gte?: any; lte?: any; gt?: any; lt?: any }

const QUERY: EveTool = {
  name: 'query',
  money: true,
  description: 'A GUARDED LOOK INTO THE BUSINESS BRAIN when measure, unit_health, repeat_failures or the 360s do not already answer it. table: fact_unit_day | fact_maintenance_event | unit_health_daily | owner_month | vendor_month | dim_unit | dim_building. filters: {column: value} for equals, {column: [v1, v2]} for one-of, {column: {gte, lte}} (or from / to / gt / lt) for a range — nothing else. group_by: up to 3 columns; agg: ["count", "sum:net_accom", "avg:score", "min:col", "max:col"]; order: "column" or "-column" (descending; for grouped results an agg such as "-sum:billed_owner"); columns: which to return (ungrouped); limit ≤ 200 (default 50). Always returns total_rows / truncated / as_of. Money columns are hidden for users without money. Prefer measure for any revenue / occupancy / upkeep total.',
  input_schema: obj({ table: S.str, filters: { type: 'object' }, group_by: { type: 'array', items: S.str }, agg: { type: 'array', items: S.str }, order: S.str, columns: { type: 'array', items: S.str }, limit: S.num }, ['table']),
  run: async (input, ctx) => {
    const table = lc(input?.table).trim()
    const spec = SPECS[table]
    if (!spec) return { error: `Not a table I can query: "${input?.table}".`, tables: Object.keys(SPECS) }
    const fresh = await freshAll(ctx, [table as BrainTable])
    if (!fresh.ok) {
      if (table === 'vendor_month' && fresh.reasons.indexOf('empty') >= 0) return { stale: true, note: 'Not enough vendor-tagged work yet: vendor_month is empty, because only guest issues with a vendor picked carry a vendor so far. Use vendor_work for a vendor\'s open and finished work and invoices.' }
      return staleOut(fresh.note, LIVE_TOOLS)
    }
    const room = scopeIds(ctx)
    if (room && !spec.listing) return { error: `${table} is not read in this room (it is not tied to units this room can see).` }
    const hidden: string[] = []
    const visible = spec.cols.filter(c => {
      if (guarded(ctx) && spec.hideGuarded.indexOf(c) >= 0) { hidden.push(c); return false }
      if (!ctx.canMoney && spec.money.indexOf(c) >= 0) { hidden.push(c); return false }
      return true
    })
    const okCol = (c: string) => visible.indexOf(c) >= 0
    const badCol = (c: string) => ({ error: `Column "${c}" is not available on ${table}${hidden.indexOf(c) >= 0 ? ' for this user / room' : ''}.`, columns: visible })

    // filters
    const filters: Filter[] = []
    const fin = input?.filters && typeof input.filters === 'object' && !Array.isArray(input.filters) ? input.filters : {}
    for (const col of Object.keys(fin)) {
      if (!okCol(col)) return badCol(col)
      const v = fin[col]
      if (v === null) filters.push({ col, op: 'is' })
      else if (Array.isArray(v)) {
        if (!v.length || v.length > 200 || !v.every(prim)) return { error: `Filter ${col}: a list must hold 1–200 plain values.` }
        filters.push({ col, op: 'in', vals: v })
      } else if (typeof v === 'object') {
        const f: Filter = { col, op: 'range' }
        const pick = (x: any) => (prim(x) && x !== null ? x : undefined)
        f.gte = pick(v.gte ?? v.from); f.lte = pick(v.lte ?? v.to); f.gt = pick(v.gt); f.lt = pick(v.lt)
        if (f.gte === undefined && f.lte === undefined && f.gt === undefined && f.lt === undefined) return { error: `Filter ${col}: a range takes gte / lte / gt / lt (or from / to).` }
        filters.push(f)
      } else filters.push({ col, op: 'eq', val: v })
    }
    const apply = (q: any): any => {
      for (const f of filters) {
        if (f.op === 'is') q = q.is(f.col, null)
        else if (f.op === 'eq') q = q.eq(f.col, f.val)
        else if (f.op === 'in') q = q.in(f.col, f.vals as any[])
        else {
          if (f.gte !== undefined) q = q.gte(f.col, f.gte)
          if (f.lte !== undefined) q = q.lte(f.col, f.lte)
          if (f.gt !== undefined) q = q.gt(f.col, f.gt)
          if (f.lt !== undefined) q = q.lt(f.col, f.lt)
        }
      }
      if (room) q = q.in('listing_id', room.length ? room.slice(0, 400) : ['__none__'])
      return q
    }
    const lim = clampLimit(input?.limit, 50, 200)
    const groupBy: string[] = Array.isArray(input?.group_by) ? input.group_by.map((x: any) => str(x).trim()).filter(Boolean).slice(0, 3) : []
    for (const g of groupBy) { if (!okCol(g)) return badCol(g); if (spec.money.indexOf(g) >= 0) return { error: `Cannot group by a money column (${g}).` } }
    const orderRaw = str(input?.order).trim()
    const desc = orderRaw.startsWith('-') || / desc$/i.test(orderRaw)
    const orderKey = orderRaw.replace(/^-/, '').replace(/\s+(asc|desc)$/i, '').trim()
    const metaBase = { source: `${table} (${BRAIN_SOURCE})`, as_of: fresh.as_of }

    if (!groupBy.length && !(Array.isArray(input?.agg) && input.agg.length)) {
      const want: string[] = Array.isArray(input?.columns) && input.columns.length ? input.columns.map((x: any) => str(x).trim()).filter(Boolean) : visible
      for (const c of want) if (!okCol(c)) return badCol(c)
      if (orderKey && !okCol(orderKey)) return badCol(orderKey)
      let q = apply(ctx.db.from(table).select(want.join(','), { count: 'exact' }))
      if (orderKey) q = q.order(orderKey, { ascending: !desc, nullsFirst: false })
      for (const k of spec.pk) if (k !== orderKey) q = q.order(k)
      const { data, error, count } = await q.limit(lim)
      if (error) return { error: `${table} could not be read: ${str(error.message).slice(0, 160)}` }
      const rows: any[] = (data as any[]) || []
      const total = typeof count === 'number' ? count : null
      const cut = total != null ? total > rows.length : rows.length >= lim
      return {
        table, rows, count: rows.length, total_rows: total, truncated: cut,
        hidden_columns: hidden.length ? hidden : undefined,
        note: [spec.note || '', cut ? `Showing ${rows.length} of ${total ?? 'more'} — say it is partial, or group / narrow.` : ''].filter(Boolean).join(' ') || undefined,
        _meta: brainMeta({ ...metaBase, window: filters.length ? filters.map(f => f.col).join(', ') + ' filtered' : 'all rows', n: total ?? rows.length, truncated: cut }),
      }
    }

    // grouped
    const aggs: { fn: string; col: string | null; key: string }[] = []
    const aggIn: string[] = Array.isArray(input?.agg) && input.agg.length ? input.agg.map((x: any) => lc(x).trim()) : ['count']
    for (const a of aggIn.slice(0, 6)) {
      if (a === 'count') { aggs.push({ fn: 'count', col: null, key: 'count' }); continue }
      const mm = a.match(/^(sum|avg|min|max)\s*[:(]\s*([a-z0-9_]+)\s*\)?$/)
      if (!mm) return { error: `agg "${a}" — use count, sum:col, avg:col, min:col or max:col.` }
      if (!okCol(mm[2])) return badCol(mm[2])
      if (spec.numeric.indexOf(mm[2]) < 0) return { error: `${mm[2]} is not a number column.`, numeric_columns: spec.numeric.filter(okCol) }
      aggs.push({ fn: mm[1], col: mm[2], key: mm[1] + ':' + mm[2] })
    }
    if (!aggs.some(a => a.fn === 'count')) aggs.unshift({ fn: 'count', col: null, key: 'count' })
    const needCols = Array.from(new Set(groupBy.concat(aggs.map(a => a.col).filter((c): c is string => !!c)).concat(spec.pk)))
    const got = await pageRows<any>((x, y) => {
      let q = apply(ctx.db.from(table).select(needCols.join(',')))
      for (const k of spec.pk) q = q.order(k)
      return q.range(x, y)
    }, 60)
    if (got.truncated && !got.rows.length) return { error: `${table} could not be read.` }
    type G = { key: Record<string, any>; n: number; sum: Record<string, number>; cnt: Record<string, number>; min: Record<string, number>; max: Record<string, number> }
    const gs: Record<string, G> = {}
    for (const r of got.rows) {
      const k = groupBy.map(c => JSON.stringify(r[c] ?? null)).join('|')
      let g = gs[k]
      if (!g) { g = gs[k] = { key: {}, n: 0, sum: {}, cnt: {}, min: {}, max: {} }; for (const c of groupBy) g.key[c] = r[c] ?? null }
      g.n++
      for (const a of aggs) {
        if (!a.col || r[a.col] == null || r[a.col] === '') continue
        const x = Number(r[a.col])
        if (!Number.isFinite(x)) continue
        g.sum[a.col] = (g.sum[a.col] || 0) + x
        g.cnt[a.col] = (g.cnt[a.col] || 0) + 1
        if (g.min[a.col] === undefined || x < g.min[a.col]) g.min[a.col] = x
        if (g.max[a.col] === undefined || x > g.max[a.col]) g.max[a.col] = x
      }
    }
    const out = Object.keys(gs).map(k => {
      const g = gs[k]
      const row: any = { ...g.key }
      for (const a of aggs) {
        if (a.fn === 'count') row.count = g.n
        else if (a.col) {
          const c = g.cnt[a.col] || 0
          row[a.key] = !c ? null : a.fn === 'sum' ? round2(g.sum[a.col]) : a.fn === 'avg' ? round2(g.sum[a.col] / c) : a.fn === 'min' ? g.min[a.col] : g.max[a.col]
        }
      }
      return row
    })
    const sortKey = orderKey ? (orderKey === 'count' || aggs.some(a => a.key === orderKey) || groupBy.indexOf(orderKey) >= 0 ? orderKey : '') : 'count'
    if (orderKey && !sortKey) return { error: `order "${orderRaw}" — order by a group column or an agg (${aggs.map(a => a.key).join(', ')}).` }
    const descending = orderKey ? desc : true
    out.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return descending ? -c : c
    })
    const cut = got.truncated || out.length > lim
    return {
      table, group_by: groupBy, agg: aggs.map(a => a.key),
      groups: out.slice(0, lim), groups_found: out.length, total_rows: got.rows.length, truncated: cut,
      hidden_columns: hidden.length ? hidden : undefined,
      note: [spec.note || '', got.truncated ? 'The read stopped at 60,000 rows — the groups are floors. Narrow the filters (a day range) and say it is partial.' : '', out.length > lim ? `Showing ${lim} of ${out.length} groups.` : ''].filter(Boolean).join(' ') || undefined,
      _meta: brainMeta({ ...metaBase, window: filters.length ? filters.map(f => f.col).join(', ') + ' filtered' : 'all rows', n: got.rows.length, truncated: cut }),
    }
  },
}

export const BRAIN_MONEY_TOOLS: EveTool[] = [MEASURE, QUERY]

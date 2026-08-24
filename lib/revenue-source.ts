// REVENUE SOURCE — the one accessor every money surface will call, so the switch from our own
// Guesty math to the boss's Revenue App is a flag, not a rewrite.
//
// THE FLAG: app_settings 'revenue_source' = { source: 'lighthouse' | 'revenue_app', maxStaleHours }.
// Default 'lighthouse' — nothing changes until an owner flips it. While it is 'lighthouse', the
// mirror still fills every hour and /revenue/reconcile compares the two side by side. Flip only
// when a full month's deltas are explained.
//
// THE FALLBACK IS LABELLED, NEVER SILENT. When the Revenue App is the source but its mirror is
// stale (older than maxStaleHours) or has no row for a unit-month, the accessor returns OUR number
// and says so in `source`/`note`. A blended number with no label is exactly the failure this file
// exists to prevent (feedback-alerts-must-name-things).
//
// BASIS MAPPING (his columns → lib/basis.ts):
//   his gross_accom  (before OTA commission)  = our 'netota'
//   his net_accom    (after  OTA commission)  = our 'net'
//   our 'gross'      = his gross_accom + his cleaning (gross_cleaning, else net_cleaning)
// ADR/RevPAR are recomputed from those so they follow the same basis rules as everything else.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { unitRevenue, type UnitRevenue } from '@/lib/unit-revenue'
import type { Basis } from '@/lib/basis'

export const REVENUE_SOURCE_KEY = 'revenue_source'
export type RevenueSourceName = 'lighthouse' | 'revenue_app'
export type RevenueSourceSetting = { source: RevenueSourceName; maxStaleHours: number }
export const DEFAULT_REVENUE_SOURCE: RevenueSourceSetting = { source: 'lighthouse', maxStaleHours: 6 }

export async function getRevenueSourceSetting(): Promise<RevenueSourceSetting> {
  const s = await getSetting<any>(REVENUE_SOURCE_KEY, null)
  const source: RevenueSourceName = s?.source === 'revenue_app' ? 'revenue_app' : 'lighthouse'
  const maxStaleHours = Number(s?.maxStaleHours) > 0 ? Number(s.maxStaleHours) : DEFAULT_REVENUE_SOURCE.maxStaleHours
  return { source, maxStaleHours }
}

export type RevUnitMonthRow = {
  guesty_listing_id: string; month: string; kind: string; unit_name: string | null; building: string | null; owner_name: string | null
  nights_available: number | null; nights_sold: number | null; occupancy: number | null
  gross_accom: number | null; net_accom: number | null; gross_cleaning: number | null; net_cleaning: number | null
  mgmt_fee: number | null; other_revenue: number | null; stay_revenue: number | null; as_of: string | null; synced_at: string
}

/** The Revenue App's rows for one month: eom (closed) beats live (open). Null when the mirror has nothing. */
export async function revenueAppUnitMonth(month: string): Promise<{ rows: Record<string, RevUnitMonthRow>; syncedAt: string | null; kind: 'eom' | 'live' | null }> {
  const db = supabaseAdmin()
  const out: Record<string, RevUnitMonthRow> = {}
  let syncedAt: string | null = null
  let kind: 'eom' | 'live' | null = null
  for (const k of ['eom', 'live'] as const) {
    const { data, error } = await db.from('rev_unit_month').select('*').eq('month', month).eq('kind', k).limit(2000)
    if (error || !data?.length) continue
    for (const r of data as RevUnitMonthRow[]) { out[r.guesty_listing_id] = r; if (!syncedAt || r.synced_at > syncedAt) syncedAt = r.synced_at }
    kind = k
    break
  }
  return { rows: out, syncedAt, kind }
}

function triple(rev: number, occ: number, avail: number) {
  return { revenue: Math.round(rev), adr: occ > 0 ? Math.round(rev / occ) : 0, revpar: avail > 0 ? Math.round(rev / avail) : 0 }
}

export function unitRevenueFromRevenueApp(r: RevUnitMonthRow, basis: Basis): UnitRevenue | null {
  const gross = r.gross_accom, net = r.net_accom
  const cleaning = r.gross_cleaning ?? r.net_cleaning ?? 0
  const rev = basis === 'gross' ? (gross == null ? null : gross + cleaning) : basis === 'netota' ? gross : net
  if (rev == null) return null
  const occ = r.nights_sold ?? 0, avail = r.nights_available ?? 0
  const t = triple(rev, occ, avail)
  return { ...t, nights: occ, available: avail, occupancy: r.occupancy ?? (avail ? Math.round((occ / avail) * 1000) / 10 : 0) }
}

export type SourcedUnitRevenue = {
  source: RevenueSourceName          // which numbers you are actually looking at
  requested: RevenueSourceName       // what the flag asked for
  stale: boolean
  note: string | null                // human line for the UI when source ≠ requested or data is partial
  syncedAt: string | null
  data: Record<string, UnitRevenue>
  fallbackUnits: string[]            // listing ids that came from Lighthouse because his mirror had no row
}

const isWholeMonth = (from: string, to: string) => from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && (() => {
  const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7), 0)); return to === d.toISOString().slice(0, 10)
})()

/**
 * Drop-in for lib/unit-revenue.unitRevenue() that honours the flag. Same shape, plus provenance.
 * Whole calendar months come from the Revenue App when it is the source; any other window falls
 * back to Lighthouse math (his feeds are month-grained) and says so.
 */
export async function sourcedUnitRevenue(from: string, to: string, basis: Basis = 'gross'): Promise<SourcedUnitRevenue> {
  const setting = await getRevenueSourceSetting()
  const ours = () => unitRevenue(from, to, basis)
  if (setting.source !== 'revenue_app') {
    return { source: 'lighthouse', requested: 'lighthouse', stale: false, note: null, syncedAt: null, data: await ours(), fallbackUnits: [] }
  }
  if (!isWholeMonth(from, to)) {
    return { source: 'lighthouse', requested: 'revenue_app', stale: false, syncedAt: null, fallbackUnits: [],
      note: 'Lighthouse estimate — the Revenue App reports whole months only; this window is ' + from + ' → ' + to, data: await ours() }
  }
  const month = from.slice(0, 7)
  const his = await revenueAppUnitMonth(month)
  const ageH = his.syncedAt ? (Date.now() - new Date(his.syncedAt).getTime()) / 3_600_000 : Infinity
  const stale = ageH > setting.maxStaleHours
  if (!Object.keys(his.rows).length || stale) {
    return { source: 'lighthouse', requested: 'revenue_app', stale, syncedAt: his.syncedAt, fallbackUnits: [],
      note: !Object.keys(his.rows).length
        ? `Lighthouse estimate — the Revenue App has no numbers for ${month} yet`
        : `Lighthouse estimate — the Revenue App mirror is ${Math.round(ageH)}h old (limit ${setting.maxStaleHours}h)`,
      data: await ours() }
  }
  // His numbers, with per-unit fallback for units he does not carry.
  const mine = await ours()
  const data: Record<string, UnitRevenue> = {}
  const fallbackUnits: string[] = []
  for (const id of Array.from(new Set(Object.keys(mine).concat(Object.keys(his.rows))))) {
    const h = his.rows[id] ? unitRevenueFromRevenueApp(his.rows[id], basis) : null
    if (h) data[id] = h
    else if (mine[id]) { data[id] = mine[id]; fallbackUnits.push(id) }
  }
  return {
    source: 'revenue_app', requested: 'revenue_app', stale: false, syncedAt: his.syncedAt, data, fallbackUnits,
    note: fallbackUnits.length ? `${fallbackUnits.length} unit${fallbackUnits.length === 1 ? '' : 's'} shown as Lighthouse estimates — no Revenue App row for ${month}` : (his.kind === 'live' ? `Revenue App live view of ${month} (not closed yet)` : null),
  }
}

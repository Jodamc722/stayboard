// REVENUE SOURCE — the one accessor every money surface will call, so the switch from our own
// Guesty math to the boss's Revenue App is a flag, not a rewrite.
//
// (2026-09-29) That per-unit accessor, sourcedUnitRevenue, and the column mapping below were never
// called — lib/money-source (resolveRevenue / applyMoneyOverride) does this job — and were removed.
// What remains here is the flag and the mirror read (revenueAppUnitMonth).
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

export const REVENUE_SOURCE_KEY = 'revenue_source'
export type RevenueSourceName = 'lighthouse' | 'revenue_app'
export type RevenueSourceSetting = { source: RevenueSourceName; maxStaleHours: number }
export const DEFAULT_REVENUE_SOURCE: RevenueSourceSetting = { source: 'lighthouse', maxStaleHours: 6 }

// ONE SWITCH, NOT TWO (2026-08-26). This started as its own `revenue_source` flag; a day later
// `money_domains` arrived with a switch per domain, and two controls for one behaviour is the exact
// failure Jon named in the three-Eves incident — the one you are not looking at wins silently.
// `money_domains.revenue` is now the truth; this key survives only as the fallback for an install
// where migration 056 has not run yet.
export async function getRevenueSourceSetting(): Promise<RevenueSourceSetting> {
  const dom = await getSetting<any>('money_domains', null)
  if (dom && typeof dom === 'object' && 'revenue' in dom) {
    const stale = Number(dom.maxStaleHours)
    return {
      source: (dom.revenue === true || dom.revenue === 'true') ? 'revenue_app' : 'lighthouse',
      maxStaleHours: stale > 0 ? stale : DEFAULT_REVENUE_SOURCE.maxStaleHours,
    }
  }
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
    const { data, error } = await db.from('rev_unit_month').select('*').eq('month', month).eq('kind', k).limit(1000) // deliberate cap: one row per unit for one month and kind (~290)
    if (error || !data?.length) continue
    for (const r of data as RevUnitMonthRow[]) { out[r.guesty_listing_id] = r; if (!syncedAt || r.synced_at > syncedAt) syncedAt = r.synced_at }
    kind = k
    break
  }
  return { rows: out, syncedAt, kind }
}

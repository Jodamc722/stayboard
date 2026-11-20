// SIGNAL (Jon, 2026-11-20: "the most important things that need to be completed vs busy work"; "delineate a low-income property versus a high-income property, priority bookings versus non-priority").
//
// THE PROPERTY TIER, ONCE. Each building's realised nightly rate over the trailing 12 months, its
// tier and WHY it has that tier (the rate decided, the lux flag placed it, or an override). Every
// page that says "High" reads this one function, so a building cannot be High on the Glitches board
// and Standard in a brief.
//
//   the rule     lib/signal.ts tierFor — High at $150 a night or more once 100 nights were sold;
//                otherwise the existing `lux` flag (lib/segments) can place a building High;
//                Botanica is Partner; a unit takes its building's tier (a new unit inherits it).
//   the override the `property_tiers` app setting: { overrides: { "Park Towers": "high" } }.
//                Applied AFTER the cache, so a change shows on the next read, not an hour later.
//   the read     guesty_reservations with a narrow select (raw->money->>fareAccommodation, never the
//                whole raw blob), confirmed stays that checked in during the last 365 days, at
//                listings that are active today. The same read reproduces the $6.58M / 265 units the
//                design was tested on.
//
// `lux` STAYS AS IT IS: it is service style (linens, catalogues, the welcome call guide), the tier
// is money. NOT DONE IN THIS PASS: the lux list still exists twice (lib/segments BUILDINGS and
// DEFAULT_GROUPS.lux in lib/ops-presets) — they should become one.
import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { buildingOf, isLux } from './segments'
import { getSetting } from './app-settings'
import { tierFor, TIER_RULES, type BuildingTier, type Tier } from './signal'

export const PROPERTY_TIERS_KEY = 'property_tiers'
export const PROPERTY_TIER_TAG = 'property-tier'
/** A building with no name to go on (the listings called "2023/1"). */
export const NO_BUILDING = 'Unassigned'

const str = (v: any) => (v == null ? '' : String(v)).trim()
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

type BuildingRate = { building: string; revenue: number; nights: number; units: number; lux: boolean }
type RateRead = { at: string; from: string; to: string; buildings: BuildingRate[]; byListing: Record<string, string>; unitWeekly: Record<string, number> }

/** The raw read: fare and nights per building, and which building each live listing belongs to. */
async function readRates(): Promise<RateRead> {
  const db = supabaseAdmin()
  const to = ymd(new Date())
  const from = ymd(new Date(Date.now() - TIER_RULES.windowDays * 86400000))
  const { data: ls, error: lErr } = await db.from('guesty_listings').select('id,nickname,title,building,status').limit(1000) // deliberate cap: one row per Guesty listing (~320, inactive included)
  if (lErr) throw new Error('property-tier: listings read failed: ' + lErr.message)
  const byListing: Record<string, string> = {}
  const acc: Record<string, BuildingRate> = {}
  for (const l of (ls || []) as any[]) {
    if (str(l.status).toLowerCase() !== 'active') continue
    const name = str(l.nickname) || str(l.title)
    const b = buildingOf(l.building, name) || NO_BUILDING
    byListing[str(l.id)] = b
    const row = acc[b] || (acc[b] = { building: b, revenue: 0, nights: 0, units: 0, lux: false })
    row.units++
    if (isLux(l.building, name)) row.lux = true
  }
  // ~9,000 confirmed stays a year: paged, ordered, three narrow columns.
  const { rows, truncated } = await pageRows<any>((a, b) => db.from('guesty_reservations')
    .select('id,listing_id,nights,fare:raw->money->>fareAccommodation')
    .eq('status', 'confirmed').gte('check_in', from).lt('check_in', to)
    .order('id').range(a, b), 20)
  // A short read would understate every rate and could drop a building out of High. Throwing keeps
  // the half-read out of the cache; callers fall back to the lux flag (see getTiers).
  if (truncated) throw new Error('property-tier: reservations read stopped early')
  const unitRev: Record<string, number> = {}
  for (const r of rows) {
    const lid = str(r.listing_id)
    const b = byListing[lid]
    if (!b) continue
    const fare = Number(r.fare)
    const nights = Number(r.nights)
    if (Number.isFinite(fare)) { acc[b].revenue += fare; unitRev[lid] = (unitRev[lid] || 0) + fare }
    if (Number.isFinite(nights) && nights > 0) acc[b].nights += nights
  }
  // What a unit earns in a week: its own trailing year / 52, or its building's average when it has
  // no history yet (a new unit inherits its building here too).
  const unitWeekly: Record<string, number> = {}
  for (const lid of Object.keys(byListing)) {
    const b = acc[byListing[lid]]
    const own = unitRev[lid] || 0
    unitWeekly[lid] = Math.round((own > 0 ? own : (b.units ? b.revenue / b.units : 0)) / 52)
  }
  return { at: new Date().toISOString(), from, to, buildings: Object.values(acc), byListing, unitWeekly }
}

const cachedRates = unstable_cache(readRates, ['property-tier-rates-v1'], { tags: [PROPERTY_TIER_TAG], revalidate: 3600 })

export type PropertyTiers = {
  /** When the rates were read (cached about an hour). Null when the read failed and the flags stand in. */
  at: string | null
  window: { from: string; to: string } | null
  /** Highest nightly rate first; buildings with no rate last. */
  buildings: BuildingTier[]
  byBuilding: Record<string, BuildingTier>
  /** listing id → canonical building, for live listings. */
  byListing: Record<string, string>
  /** listing id → what the unit earns a week (trailing year / 52; its building's average when new). */
  unitWeekly: Record<string, number>
  overrides: Record<string, Tier>
  /** True when the rate read failed: every tier here is the lux flag or an override, no rate. */
  degraded: boolean
}

/** The stored overrides, cleaned: { "Park Towers": "high" }. */
export async function getTierOverrides(): Promise<Record<string, Tier>> {
  const raw = await getSetting<any>(PROPERTY_TIERS_KEY, null)
  const src = raw && typeof raw === 'object' ? (raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : raw) : {}
  const out: Record<string, Tier> = {}
  for (const k of Object.keys(src || {})) {
    const v = str(src[k]).toLowerCase()
    if (k !== 'overrides' && (v === 'high' || v === 'standard' || v === 'partner')) out[k] = v
  }
  return out
}

/** Every building's nightly rate, tier and source. Never throws: a failed read falls back to the flags. */
export async function getTiers(): Promise<PropertyTiers> {
  const overrides = await getTierOverrides().catch(() => ({} as Record<string, Tier>))
  let read: RateRead | null = null
  try { read = await cachedRates() } catch (e: any) {
    // Outside a request (a script) unstable_cache has no store; read straight through.
    try { read = await readRates() } catch (e2: any) { console.error('[property-tier] ' + String(e2?.message || e2 || e).slice(0, 160)) }
  }
  const buildings = (read ? read.buildings : []).map(b => tierFor({ ...b, overrides }))
  buildings.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.building.localeCompare(b.building))
  const byBuilding: Record<string, BuildingTier> = {}
  for (const b of buildings) byBuilding[b.building] = b
  return {
    at: read ? read.at : null, window: read ? { from: read.from, to: read.to } : null,
    buildings, byBuilding, byListing: read ? read.byListing : {}, unitWeekly: read ? read.unitWeekly : {},
    overrides, degraded: !read,
  }
}

/**
 * One building's tier from a loaded map — by canonical label, by raw Guesty building text or by the
 * listing name ("17WEST - 510 - 2BR"). A building the read has never seen (brand new, or the read
 * failed) is placed by the same rule with no history: override → partner → lux flag → Standard.
 */
export function tierOfBuilding(t: PropertyTiers | null | undefined, building?: string | null, name?: string | null): BuildingTier {
  const label = buildingOf(building || null, name || null) || str(building) || NO_BUILDING
  const hit = t && (t.byBuilding[label] || t.byBuilding[str(building)])
  if (hit) return hit
  return tierFor({ building: label, revenue: 0, nights: 0, units: 0, lux: isLux(building || null, name || null), overrides: t ? t.overrides : null })
}

/** A unit's tier: its building's (a new unit inherits it). */
export function tierOfListing(t: PropertyTiers | null | undefined, listingId?: string | null, building?: string | null, name?: string | null): BuildingTier {
  const b = t && listingId ? t.byListing[str(listingId)] : ''
  if (b && t && t.byBuilding[b]) return t.byBuilding[b]
  return tierOfBuilding(t, building, name)
}

/** The buildings that are High today — what "must call" and the "High" tag read. */
export function highBuildings(t: PropertyTiers | null | undefined): string[] {
  return (t ? t.buildings : []).filter(b => b.tier === 'high').map(b => b.building)
}

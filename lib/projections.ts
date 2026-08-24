// OWNER PROJECTIONS — next season's net owner revenue, per unit, per building, combined.
//
// Jon, 2026-08-21: "create a owner report where we can do a projections, this should look at
// historical, due a deep research on market trends ... scan Airbnb for similar listing and help
// us project the future booking, for next season. We should be able to edit per month basis,
// LOS, the goal is to show net owner rev per unit and per building and combined."
//
// HOW THE NUMBER IS BUILT, in reading order:
//   1. HISTORY — the same month LAST YEAR, from guesty_reservations: nights sold, net ADR
//      (fareAccommodationAdjusted — already net of the channel's cut), average LOS, occupancy.
//   2. MARKET — an uplift per market, seeded from researched market data (2026-08-21):
//        · Miami STR: ADR ~$319, occ ~44-53%, revenue +4.7% YoY, supply +30% YoY (AirROI/Rabbu)
//        · Fort Lauderdale: ADR ~$391, occ ~44%, revenue +2.0% YoY, supply +21.5% YoY (AirROI)
//        · 2027 outlook (FIU/Chaplin): domestic budget segment flat-to-down (Spirit's FLL
//          shutdown thinned cheap seats), international + group spend up; Miami-Dade hotels ran
//          ~80% occ at $293 ADR through May 2026.
//      Defaults: Miami ADR +3% / occ −1pt, Broward ADR +2% / occ −2pts — editable on the page.
//   3. OVERRIDES — whatever the team types per unit per month (occ %, ADR, LOS) wins. Stored in
//      app_settings 'owner_projections_v1', so no migration is needed and every edit is shared.
//   4. NET OWNER — projected accommodation revenue × (1 − management fee %). The fee defaults
//      to the setting below (20% until changed) with per-building overrides. Cleaning fees are
//      a guest pass-through and stay out of owner revenue on purpose.
//
// Airbnb comps: there is no public Airbnb API and scraping per unit is not dependable, so the
// market layer carries the researched comp benchmarks (by market and bedroom count) and every
// number stays editable — paste a comp ADR straight into the month cells it should apply to.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { rollupBuilding } from '@/lib/optimize-score'
import { getSetting } from '@/lib/app-settings'

export const SETTINGS_KEY = 'owner_projections_v1'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number => { const n = parseFloat(str(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const DEAD_LISTING = ['inactive', 'disabled', 'archived', 'deleted']
const LIVE_RES = ['confirmed', 'checked_in', 'checked_out', 'closed']
const isCancelled = (s: any) => /cancel|declin|expir|denied|inquiry/i.test(str(s))

function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function daysInMonth(m: string): number { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate() }
function addMonths(m: string, n: number): string {
  const y = Number(m.slice(0, 4)); const mo = Number(m.slice(5, 7)) - 1 + n
  return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7)
}

/** The next high season: November through April. Standing anywhere in a calendar year, the
 *  season being planned is the one starting THIS year's November — in February that is the
 *  season after the one you are in (a projection of the season you are standing in is a report,
 *  not a plan). */
export function nextSeasonMonths(today = todayET()): string[] {
  const start = today.slice(0, 4) + '-11'
  const out: string[] = []
  for (let i = 0; i < 6; i++) out.push(addMonths(start, i))
  return out
}

// Researched market defaults (2026-08-21). ADR is NET-of-channel-equivalent guidance — market
// reports quote gross ADR, so these act as fallbacks only when a unit has no history at all.
export const MARKET_DEFAULTS: Record<string, { occPct: number; adr: Record<string, number>; upliftAdrPct: number; upliftOccPts: number }> = {
  miami: { occPct: 53, adr: { '0': 156, '1': 169, '2': 281, '3': 368, '4': 514 }, upliftAdrPct: 3, upliftOccPts: -1 },
  broward: { occPct: 50, adr: { '0': 170, '1': 190, '2': 300, '3': 391, '4': 520 }, upliftAdrPct: 2, upliftOccPts: -2 },
  north: { occPct: 48, adr: { '0': 150, '1': 170, '2': 260, '3': 340, '4': 460 }, upliftAdrPct: 2, upliftOccPts: -1 },
}

export type MonthCell = {
  month: string
  days: number
  // last year, measured
  histNights: number | null; histOcc: number | null; histAdr: number | null; histLos: number | null; histNet: number | null
  // suggested = history × market uplift (or market default when no history)
  sugOcc: number; sugAdr: number; sugLos: number
  // what the projection actually uses (override ?? suggested)
  occ: number; adr: number; los: number
  edited: boolean
  nights: number; stays: number; grossAccom: number; netOwner: number
}
export type UnitProjection = {
  id: string; name: string; building: string; market: string; bedrooms: number | null
  mgmtPct: number
  months: MonthCell[]
  seasonNet: number; seasonGross: number; seasonNights: number
}
export type ProjectionsPayload = {
  ok: true
  season: string[]
  histSeason: string[]
  mgmtPct: number
  buildingPct: Record<string, number>
  uplift: Record<string, { adrPct: number; occPts: number }>
  units: UnitProjection[]
  buildings: { building: string; units: number; net: number; gross: number; nights: number; byMonth: Record<string, number> }[]
  combined: { net: number; gross: number; nights: number; byMonth: Record<string, number> }
  updatedAt: string | null; updatedBy: string | null
}

export type Overrides = Record<string, Record<string, { occ?: number; adr?: number; los?: number }>>
export type ProjSettings = {
  mgmtPct?: number
  buildingPct?: Record<string, number>
  uplift?: Record<string, { adrPct?: number; occPts?: number }>
  overrides?: Overrides
  updatedAt?: string; updatedBy?: string
}

async function pageAll(build: (from: number, to: number) => any, maxPages = 14): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await build(i * 1000, i * 1000 + 999)
    if (error) break
    const rows = (data || []) as any[]
    out.push.apply(out, rows)
    if (rows.length < 1000) break
  }
  return out
}

export async function buildProjections(): Promise<ProjectionsPayload> {
  const db = supabaseAdmin()
  const season = nextSeasonMonths()
  const histSeason = season.map(m => addMonths(m, -12))
  const cfg = await getSetting<ProjSettings>(SETTINGS_KEY, {}).catch(() => ({} as ProjSettings))
  const mgmtPct = Number.isFinite(Number(cfg?.mgmtPct)) && Number(cfg?.mgmtPct) >= 0 && Number(cfg?.mgmtPct) < 60 ? Number(cfg!.mgmtPct) : 20
  const buildingPct: Record<string, number> = {}
  for (const k of Object.keys(cfg?.buildingPct || {})) {
    const v = Number((cfg!.buildingPct as any)[k])
    if (Number.isFinite(v) && v >= 0 && v < 60) buildingPct[k] = v
  }
  const uplift: Record<string, { adrPct: number; occPts: number }> = {}
  for (const mk of Object.keys(MARKET_DEFAULTS)) {
    const u = (cfg?.uplift || {})[mk] || {}
    uplift[mk] = {
      adrPct: Number.isFinite(Number(u.adrPct)) ? Number(u.adrPct) : MARKET_DEFAULTS[mk].upliftAdrPct,
      occPts: Number.isFinite(Number(u.occPts)) ? Number(u.occPts) : MARKET_DEFAULTS[mk].upliftOccPts,
    }
  }
  const overrides: Overrides = (cfg?.overrides && typeof cfg.overrides === 'object') ? cfg.overrides : {}

  // ---- listings ----
  const listingRows = await pageAll((a, b) =>
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status,bedrooms').order('id').range(a, b), 3)
  type Li = { id: string; name: string; building: string; market: string; bedrooms: number | null }
  const lmap: Record<string, Li> = {}
  for (const l of listingRows) {
    if (DEAD_LISTING.includes(str(l.status).toLowerCase())) continue
    const name = l.nickname || l.title || 'Unit'
    lmap[String(l.id)] = {
      id: String(l.id), name,
      building: rollupBuilding(l.building, name) || 'Unassigned',
      market: str(marketOf(l.building, l.address_city, name) || 'Miami').toLowerCase(),
      bedrooms: l.bedrooms != null && Number.isFinite(Number(l.bedrooms)) ? Number(l.bedrooms) : null,
    }
  }

  // ---- last season's reservations (whole hist window, one paged read) ----
  const histFrom = histSeason[0] + '-01'
  const histTo = histSeason[histSeason.length - 1] + '-' + daysInMonth(histSeason[histSeason.length - 1])
  const reservations = await pageAll((a, b) => db.from('guesty_reservations')
    .select('listing_id,check_in,check_out,nights,status,fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,money_total')
    .gte('check_out', histFrom).lte('check_in', histTo).order('check_out').range(a, b))

  // nights + fare share per unit per month; LOS from stays STARTING in the month
  type H = { nights: number; fare: number; losN: number; losSum: number }
  const hist: Record<string, Record<string, H>> = {}
  const bump = (lid: string, m: string): H => {
    hist[lid] = hist[lid] || {}
    return (hist[lid][m] = hist[lid][m] || { nights: 0, fare: 0, losN: 0, losSum: 0 })
  }
  for (const r of reservations) {
    if (isCancelled(r.status) || LIVE_RES.indexOf(str(r.status).toLowerCase()) < 0) continue
    const lid = String(r.listing_id)
    if (!lmap[lid]) continue
    const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
    if (!ci || !co || co <= ci) continue
    const totalNights = Math.max(1, Number(r.nights) || Math.round((Date.parse(co) - Date.parse(ci)) / 86400000) || 1)
    const fare = num(r.fare) || num(r.fareBase) || num(r.money_total)
    // walk the stay night by night into its months (stays are short; this is cheap)
    let d = ci
    while (d < co) {
      const m = d.slice(0, 7)
      if (histSeason.indexOf(m) >= 0) {
        const h = bump(lid, m)
        h.nights += 1
        h.fare += fare / totalNights
      }
      d = new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
    }
    const startM = ci.slice(0, 7)
    if (histSeason.indexOf(startM) >= 0) { const h = bump(lid, startM); h.losN += 1; h.losSum += totalNights }
  }

  // building-average fallback for units with no history in a month
  const bldAvg: Record<string, Record<string, { occ: number; adr: number; n: number }>> = {}

  const unitIds = Object.keys(lmap)
  const prelim: Record<string, Record<string, { occ: number | null; adr: number | null; los: number | null; nights: number; net: number }>> = {}
  for (const lid of unitIds) {
    prelim[lid] = {}
    for (let i = 0; i < season.length; i++) {
      const hm = histSeason[i]
      const days = daysInMonth(hm)
      const h = (hist[lid] || {})[hm]
      const nights = h ? h.nights : 0
      const adr = h && h.nights > 0 ? h.fare / h.nights : null
      const occ = h ? (nights / days) * 100 : null
      const los = h && h.losN > 0 ? h.losSum / h.losN : null
      prelim[lid][season[i]] = { occ, adr, los, nights, net: h ? h.fare : 0 }
      if (adr != null && occ != null) {
        const b = lmap[lid].building
        bldAvg[b] = bldAvg[b] || {}
        const e = (bldAvg[b][season[i]] = bldAvg[b][season[i]] || { occ: 0, adr: 0, n: 0 })
        e.occ += occ; e.adr += adr; e.n += 1
      }
    }
  }

  const units: UnitProjection[] = []
  for (const lid of unitIds) {
    const li = lmap[lid]
    const mk = MARKET_DEFAULTS[li.market] ? li.market : 'miami'
    const up = uplift[mk]
    const md = MARKET_DEFAULTS[mk]
    const pct = buildingPct[li.building] != null ? buildingPct[li.building] : mgmtPct
    const months: MonthCell[] = []
    let seasonNet = 0, seasonGross = 0, seasonNights = 0
    for (let i = 0; i < season.length; i++) {
      const m = season[i]
      const days = daysInMonth(m)
      const p = prelim[lid][m]
      const avg = (bldAvg[li.building] || {})[m]
      const bedsKey = String(Math.min(4, Math.max(0, li.bedrooms == null ? 1 : li.bedrooms)))
      // suggested occupancy / ADR: history first, building average second, market research last
      const baseOcc = p.occ != null ? p.occ : avg && avg.n > 0 ? avg.occ / avg.n : md.occPct
      const baseAdr = p.adr != null ? p.adr : avg && avg.n > 0 ? avg.adr / avg.n : (md.adr[bedsKey] || md.adr['1'])
      const sugOcc = Math.min(100, Math.max(0, r1(baseOcc + up.occPts)))
      const sugAdr = r2(baseAdr * (1 + up.adrPct / 100))
      const sugLos = p.los != null ? r1(p.los) : 4
      const o = ((overrides[lid] || {})[m]) || {}
      const occ = o.occ != null && Number.isFinite(Number(o.occ)) ? Math.min(100, Math.max(0, Number(o.occ))) : sugOcc
      const adr = o.adr != null && Number.isFinite(Number(o.adr)) && Number(o.adr) >= 0 ? Number(o.adr) : sugAdr
      const los = o.los != null && Number.isFinite(Number(o.los)) && Number(o.los) > 0 ? Number(o.los) : sugLos
      const nights = Math.round((occ / 100) * days)
      const grossAccom = r2(nights * adr)
      const netOwner = r2(grossAccom * (1 - pct / 100))
      seasonNet += netOwner; seasonGross += grossAccom; seasonNights += nights
      months.push({
        month: m, days,
        histNights: p.occ != null ? p.nights : null,
        histOcc: p.occ != null ? r1(p.occ) : null,
        histAdr: p.adr != null ? r2(p.adr) : null,
        histLos: p.los != null ? r1(p.los) : null,
        histNet: p.occ != null ? r2(p.net * (1 - pct / 100)) : null,
        sugOcc, sugAdr, sugLos,
        occ: r1(occ), adr: r2(adr), los: r1(los),
        edited: o.occ != null || o.adr != null || o.los != null,
        nights, stays: los > 0 ? Math.round((nights / los) * 10) / 10 : 0,
        grossAccom, netOwner,
      })
    }
    units.push({
      id: lid, name: li.name, building: li.building, market: li.market, bedrooms: li.bedrooms,
      mgmtPct: pct, months,
      seasonNet: r2(seasonNet), seasonGross: r2(seasonGross), seasonNights,
    })
  }
  units.sort((a, b) => a.building.localeCompare(b.building) || a.name.localeCompare(b.name))

  const bmap: Record<string, { building: string; units: number; net: number; gross: number; nights: number; byMonth: Record<string, number> }> = {}
  const combined = { net: 0, gross: 0, nights: 0, byMonth: {} as Record<string, number> }
  for (const u of units) {
    const b = (bmap[u.building] = bmap[u.building] || { building: u.building, units: 0, net: 0, gross: 0, nights: 0, byMonth: {} })
    b.units += 1; b.net = r2(b.net + u.seasonNet); b.gross = r2(b.gross + u.seasonGross); b.nights += u.seasonNights
    combined.net = r2(combined.net + u.seasonNet); combined.gross = r2(combined.gross + u.seasonGross); combined.nights += u.seasonNights
    for (const c of u.months) {
      b.byMonth[c.month] = r2((b.byMonth[c.month] || 0) + c.netOwner)
      combined.byMonth[c.month] = r2((combined.byMonth[c.month] || 0) + c.netOwner)
    }
  }
  const buildings = Object.keys(bmap).map(k => bmap[k]).sort((a, b) => b.net - a.net)

  return {
    ok: true, season, histSeason, mgmtPct, buildingPct, uplift,
    units, buildings, combined,
    updatedAt: cfg?.updatedAt || null, updatedBy: cfg?.updatedBy || null,
  }
}

// ---------------------------------------------------------------------------
// OWNER-REPORT SECTION (Jon, 2026-08-22: "create a owner report with the owner report tab based
// on this"). A compact, scope-filtered slice of the projection, frozen into the report content
// at generation time — the same numbers the Projections board shows for those units, so the
// report and the board can never disagree on the day the report is made.
// ---------------------------------------------------------------------------
export type ProjectionSection = {
  headline: string; subtitle: string
  monthLabels: string[]
  units: { name: string; months: number[]; total: number }[]
  byMonth: number[]
  total: number; nights: number; mgmtPct: number
  note: string
}

export async function projectionSectionFor(listingIds: string[]): Promise<ProjectionSection | null> {
  const want = new Set((listingIds || []).map(String))
  if (!want.size) return null
  const all = await buildProjections()
  const units = all.units.filter(u => want.has(u.id))
  if (!units.length) return null
  const monthLabels = all.season.map(m =>
    new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).toUpperCase())
  const byMonth = all.season.map((m, i) => r2(units.reduce((a, u) => a + (u.months[i] ? u.months[i].netOwner : 0), 0)))
  const total = r2(byMonth.reduce((a, b) => a + b, 0))
  const nights = units.reduce((a, u) => a + u.seasonNights, 0)
  const pcts = Array.from(new Set(units.map(u => u.mgmtPct)))
  const seasonTxt = monthLabels[0] + ' – ' + monthLabels[monthLabels.length - 1]
  return {
    headline: 'Projected net owner revenue for next season.',
    subtitle: seasonTxt + '  ·  same month last season, adjusted for the market outlook  ·  net of channel and management fee',
    monthLabels,
    units: units.map(u => ({ name: u.name, months: u.months.map(c => Math.round(c.netOwner)), total: Math.round(u.seasonNet) })),
    byMonth: byMonth.map(v => Math.round(v)),
    total: Math.round(total), nights,
    mgmtPct: pcts.length === 1 ? pcts[0] : all.mgmtPct,
    note: 'Projection basis: last season’s measured occupancy, net ADR and length of stay per unit, adjusted for the researched market outlook (Miami revenue +4.7% YoY with ~30% more supply; Fort Lauderdale +2.0% with budget-airlift headwinds; international and group demand carrying 2027 spend). Cleaning fees are a guest pass-through and are not owner revenue. These figures are a planning estimate, not a guarantee.',
  }
}

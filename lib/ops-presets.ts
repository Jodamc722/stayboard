// OPS PRESETS — the operating rules a GM should be able to change without a developer.
//
// Everything in here used to be a hardcoded constant scattered across the app (the vendor-cleaning
// rule alone was copy-pasted into 6 files and had already drifted out of sync). It now lives in one
// place, with the DB (app_settings key 'ops_presets') able to override any part of it.
//
// SAFETY CONTRACT: the DEFAULTS below are byte-for-byte today's behaviour. Every consumer merges
// stored settings over these defaults, so a missing/corrupt/unreadable settings row changes nothing.
// This file is ISOMORPHIC (no server-only imports) — client components use the same helpers.

// ---------------------------------------------------------------- vendor cleaning

// A building whose cleans are done by an outside vendor/hotel staff rather than our own team.
// Set enabled=false to bring it IN HOUSE: its cleans then count toward our cleaner demand, its
// cleaning fees come back into revenue, and it sits in its geographic market again.
export type VendorBuilding = {
  id: string            // stable key, never shown
  label: string         // vendor display name, e.g. "Park Towers"
  terms: string[]       // substring matches against building/unit name (spaces = flexible whitespace)
  wordTerms?: string[]  // whole-word matches, for short ambiguous codes like "pt"
  enabled: boolean      // true = vendor-cleaned. false = we clean it (in house).
  untracked?: boolean   // vendor does NOT close Breezeway tasks -> no 4pm deadline / no at-risk alarm
  noBreezeway?: boolean // building is NOT in Breezeway at all -> boards build its day from GUESTY
}

export const DEFAULT_VENDOR_BUILDINGS: VendorBuilding[] = [
  // Botanica's vendor never closes the Breezeway task, so its cleans sit at 'not started' forever.
  // Tracking them against the 4pm deadline produced 11 false 'at risk' alerts out of 17.
  // Botanica was removed from Breezeway entirely (2026-07), so there are no tasks to read: its
  // checkouts come straight from Guesty and no Breezeway action is offered on them.
  { id: 'botanica',    label: 'Botanica',    terms: ['botanica'],            enabled: true, untracked: true, noBreezeway: true },
  { id: 'park-towers', label: 'Park Towers', terms: ['park tower'],          wordTerms: ['pt'], enabled: true },
  { id: 'amrit',       label: 'Amrit',       terms: ['amrit'],               enabled: true },
  { id: 'capri',       label: 'Capri',       terms: ['capri'],               enabled: true },
  { id: 'lucerne',     label: 'Lucerne',     terms: ['lucerne', 'lucenre'],  enabled: true },  // 'lucenre' = common misspelling
]

function esc(s: string): string { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
// "park tower" -> "park\s*tower" so it also matches "parktowers" / "park  towers".
function termRe(t: string): string { return esc(t.trim()).replace(/\\?\s+/g, '\\s*') }

function patternsFor(v: VendorBuilding): string[] {
  const out = (v.terms || []).filter(Boolean).map(termRe)
  for (const w of (v.wordTerms || []).filter(Boolean)) out.push(`\\b${esc(w.trim())}\\b`)
  return out
}

/** Regex matching any ENABLED vendor building. Never matches when the list is empty. */
export function vendorRegex(list: VendorBuilding[]): RegExp {
  const pats = (list || []).filter(v => v && v.enabled).flatMap(patternsFor)
  return pats.length ? new RegExp(pats.join('|'), 'i') : /(?!)/
}

/** Regex matching enabled vendor buildings whose vendor doesn't close Breezeway tasks. */
export function untrackedRegex(list: VendorBuilding[]): RegExp {
  const pats = (list || []).filter(v => v && v.enabled && v.untracked).flatMap(patternsFor)
  return pats.length ? new RegExp(pats.join('|'), 'i') : /(?!)/
}

/** Regex matching enabled vendor buildings that do not exist in Breezeway at all (Guesty-only). */
export function noBreezewayRegex(list: VendorBuilding[]): RegExp {
  const pats = (list || []).filter(v => v && v.enabled && v.noBreezeway).flatMap(patternsFor)
  return pats.length ? new RegExp(pats.join('|'), 'i') : /(?!)/
}

/** Vendor display name for a unit/building string, or null when we clean it ourselves. */
export function vendorNameOf(list: VendorBuilding[], s: string): string | null {
  const hay = String(s || '')
  for (const v of (list || [])) {
    if (!v || !v.enabled) continue
    const pats = patternsFor(v)
    if (pats.length && new RegExp(pats.join('|'), 'i').test(hay)) return v.label
  }
  return null
}

// ---------------------------------------------------------------- roster & staffing

export type Roster = {
  teams: Record<string, string[]>          // market -> cleaner first names (seeds the weekly sheet)
  nonCleaners: Record<string, string>      // name -> role; on the roster but NOT counted as a cleaner
  rate: Record<string, number>             // market -> cleans per cleaner per day
  growth: number                           // % buffer added on top of projected cleaner need
}

export const DEFAULT_ROSTER: Roster = {
  teams: {
    Miami: ['Roberto', 'Yoslenis', 'Ernesto', 'George', 'Maraly', 'Abel', 'Elyani', 'Monica', 'Yaribel', 'Alejandro', 'Dayrene', 'Michael', 'Shaany', 'Helem', 'Yunisleydis', 'Yaneisis', 'Mileydis', 'Fernanda'],
    Broward: ['Roberto', 'Guillermo', 'Maribel', 'Vilma', 'Miriam', 'Kenia', 'Paola', 'Yessica', 'Maryurie', 'Eber', 'Leydi'],
    North: [],
  },
  nonCleaners: { Guillermo: 'supervisor', Roberto: 'ops', Yoslenis: 'supervisor', George: 'handyman', Ernesto: 'handyman' },
  rate: { Miami: 5, Broward: 4, North: 4 },
  growth: 10,
}

// ---------------------------------------------------------------- timing rules

export type Timing = {
  deadlineMin: number        // minutes past ET midnight the unit must be clean by (960 = 4:00pm)
  atRiskMin: number          // flag a not-started clean when fewer than this many minutes remain
  auditDueDays: number       // how often every unit gets audited
  longStayNights: number     // a stay at or over this many nights is a LONG STAY: more mess on the
                             // way out, and a bigger booking to have ready on the way in
  areaRadiusKm: number       // how close two buildings must be to belong to the same runner's area
  cleanMinutes: { studio: number; two: number; threePlus: number; unknown: number }  // benchmark per clean
}

export const DEFAULT_TIMING: Timing = {
  deadlineMin: 16 * 60,
  atRiskMin: 2 * 60,
  auditDueDays: 365,
  longStayNights: 10,
  areaRadiusKm: 4,
  cleanMinutes: { studio: 90, two: 120, threePlus: 180, unknown: 120 },
}

/** Benchmark minutes for a clean, by bedroom count (null/undefined = unknown). */
export function benchmarkMinutes(t: Timing, bedrooms: number | null | undefined): number {
  const c = t?.cleanMinutes || DEFAULT_TIMING.cleanMinutes
  if (bedrooms == null) return c.unknown
  if (bedrooms <= 1) return c.studio
  if (bedrooms === 2) return c.two
  return c.threePlus
}

// ---------------------------------------------------------------- building groups & tiers

export type Groups = {
  parents: string[]              // buildings that roll their units up (Botanica 2206 -> Botanica)
  oasisUnits: string[]           // Oasis is named by unit, not number — these roll up to Oasis
  aliases: Record<string, string>// odd unit name -> building
  lux: string[]                  // lux tier — prioritised in ops planning and welcome calls
  north: string[]                // the northern market cluster
  skip: string[]                 // buildings excluded from health scoring and ops plans
}

export const DEFAULT_GROUPS: Groups = {
  parents: ['Botanica', 'Oasis', 'Arya', '3316', 'Salato'],
  oasisUnits: ['mahogany', 'royal palm', 'bougainvillea', 'bamboo', 'sapodilla', 'jasmine'],
  aliases: { '101': 'Lucerne' },
  lux: ['elser', 'amrit', 'nomad', 'arya', '17 west', '17west', 'district 225', 'district225', 'dist 225'],
  north: ['capri', 'lucerne', 'lucenre', 'amrit'],
  skip: ['waves'],
}

// ---------------------------------------------------------------- the whole preset

export type OpsPresets = {
  vendorBuildings: VendorBuilding[]
  roster: Roster
  timing: Timing
  groups: Groups
}

export const DEFAULT_PRESETS: OpsPresets = {
  vendorBuildings: DEFAULT_VENDOR_BUILDINGS,
  roster: DEFAULT_ROSTER,
  timing: DEFAULT_TIMING,
  groups: DEFAULT_GROUPS,
}

const arr = (v: any, fb: any[]) => (Array.isArray(v) ? v : fb)
const num = (v: any, fb: number) => (typeof v === 'number' && isFinite(v) ? v : fb)
const obj = (v: any, fb: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : fb)

/**
 * Merge a stored (possibly partial, possibly junk) settings blob over the defaults.
 * Anything missing or the wrong shape falls back to today's hardcoded behaviour.
 */
// Settings saved BEFORE a flag existed in code must not silently lose it: unknown/undefined flags
// fall back to the code default for that building id. Explicit false always wins.
const DEFAULT_VENDOR_BY_ID: Record<string, VendorBuilding> = {}
for (const d of DEFAULT_VENDOR_BUILDINGS) DEFAULT_VENDOR_BY_ID[d.id] = d
function flag(v: any, key: 'untracked' | 'noBreezeway'): boolean {
  if (v && v[key] === true) return true
  if (v && v[key] === false) return false
  const d = DEFAULT_VENDOR_BY_ID[String(v && v.id)]
  return !!(d && d[key])
}

export function mergePresets(stored: any): OpsPresets {
  const s = obj(stored, {})
  const r = obj(s.roster, {})
  const t = obj(s.timing, {})
  const g = obj(s.groups, {})
  const cm = obj(t.cleanMinutes, {})
  return {
    vendorBuildings: arr(s.vendorBuildings, DEFAULT_VENDOR_BUILDINGS)
      .filter((v: any) => v && typeof v.id === 'string')
      .map((v: any) => ({
        id: String(v.id),
        label: String(v.label || v.id),
        terms: arr(v.terms, []).map((x: any) => String(x)).filter(Boolean),
        wordTerms: arr(v.wordTerms, []).map((x: any) => String(x)).filter(Boolean),
        enabled: v.enabled !== false,
        untracked: flag(v, 'untracked'),
        noBreezeway: flag(v, 'noBreezeway'),
      })),
    roster: {
      teams: obj(r.teams, DEFAULT_ROSTER.teams),
      nonCleaners: obj(r.nonCleaners, DEFAULT_ROSTER.nonCleaners),
      rate: obj(r.rate, DEFAULT_ROSTER.rate),
      growth: num(r.growth, DEFAULT_ROSTER.growth),
    },
    timing: {
      deadlineMin: num(t.deadlineMin, DEFAULT_TIMING.deadlineMin),
      atRiskMin: num(t.atRiskMin, DEFAULT_TIMING.atRiskMin),
      auditDueDays: num(t.auditDueDays, DEFAULT_TIMING.auditDueDays),
      longStayNights: num(t.longStayNights, DEFAULT_TIMING.longStayNights),
      areaRadiusKm: num(t.areaRadiusKm, DEFAULT_TIMING.areaRadiusKm),
      cleanMinutes: {
        studio: num(cm.studio, DEFAULT_TIMING.cleanMinutes.studio),
        two: num(cm.two, DEFAULT_TIMING.cleanMinutes.two),
        threePlus: num(cm.threePlus, DEFAULT_TIMING.cleanMinutes.threePlus),
        unknown: num(cm.unknown, DEFAULT_TIMING.cleanMinutes.unknown),
      },
    },
    groups: {
      parents: arr(g.parents, DEFAULT_GROUPS.parents).map((x: any) => String(x)).filter(Boolean),
      oasisUnits: arr(g.oasisUnits, DEFAULT_GROUPS.oasisUnits).map((x: any) => String(x)).filter(Boolean),
      aliases: obj(g.aliases, DEFAULT_GROUPS.aliases),
      lux: arr(g.lux, DEFAULT_GROUPS.lux).map((x: any) => String(x)).filter(Boolean),
      north: arr(g.north, DEFAULT_GROUPS.north).map((x: any) => String(x)).filter(Boolean),
      skip: arr(g.skip, DEFAULT_GROUPS.skip).map((x: any) => String(x)).filter(Boolean),
    },
  }
}

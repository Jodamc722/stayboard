// PREVENTATIVE CADENCES — the jobs that come due on a clock, not on a checkout.
//
// Jon, 2026-08-26: "Next big thing we want to do is push suggestions per day of tasks that should
// be done, battery changes, deep clean ac, filter change, Deep Cleaning (every 6 months), etc.
// This suggestion should be based on staff working, based on the locations they are at, vacancies,
// checkouts, etc." And then the constraint that decides the whole design:
//
//   "we cant have 200 tasks just auto populate, you get that right?"
//
// Yes. There are ~200 units and a handful of cadences each, so on any given morning several hundred
// jobs are technically due. A list of several hundred is a list nobody works — we already have one
// of those (see lib/vacant-work), and it does not get worked. So this file answers ONLY the first
// of the three questions the engine asks:
//
//   1. WHAT IS DUE          — here. Per unit, per cadence, from real completion history.
//   2. WHAT IS POSSIBLE TODAY — lib/suggestions.ts (vacancy, arrival, the window it needs).
//   3. WHO COULD ACTUALLY DO IT — lib/suggestions.ts (who is already working in that building).
//
// Being due earns a job nothing on its own. It earns a place in the ranking.
//
// ── WHERE "LAST DONE" COMES FROM ────────────────────────────────────────────────────────────────
// Nowhere new. A completed Breezeway task whose name matches the cadence's `match` pattern IS the
// record that the job was done. That means the ledger is the same one the field team already keeps
// by closing their tasks — there is no second system to maintain, and a cadence starts working the
// day somebody names a task sensibly. It also means a cadence with a careless pattern will read
// the wrong history, which is why `match` is editable and testable in settings rather than buried.
//
// ── OVERRIDE OVER DEFAULTS ──────────────────────────────────────────────────────────────────────
// Same contract as lib/nav-layout.ts and lib/task-categories.ts: the CODE owns the defaults, the
// stored value is an override, and they are merged on read. A cadence added in code appears without
// anyone editing settings; clearing the override restores exactly what shipped.
export const CADENCE_KEY = 'preventative_cadences'

export type CadenceDef = {
  key: string
  /** What the created task is called. Also what people read in the suggestion. */
  label: string
  /** How often it comes due, in days. */
  everyDays: number
  /** Breezeway department the task is filed under. */
  dept: 'maintenance' | 'housekeeping' | 'inspection'
  /** Regex (source, case-insensitive) matched against task names to find when it was last done. */
  match: string
  /** Can this be done with a guest in the unit? Most cannot. */
  needsVacant: boolean
  /** Clear days the job realistically needs. A one-night gap is not a deep clean. */
  needsDays: number
  /** Rough duration, minutes — used to stop one person being handed six hours of extras. */
  minutes: number
  /** 'off' = ignore entirely. 'suggest' = propose it. 'auto' = create it without asking. */
  mode: 'off' | 'suggest' | 'auto'
  /** A unit never before recorded as having had this done: treat as due, or leave alone? */
  seedIfNever: boolean
}

export type CadenceCfg = {
  /** Master switch. Off until somebody turns it on — same contract as task automation. */
  enabled: boolean
  /** Hard ceiling on suggestions produced in a day, across every cadence and unit. THE cap. */
  dailyCap: number
  /** Never suggest more than this many jobs against one unit on one day. */
  perUnitCap: number
  /** Never pile more than this many extra minutes onto one person's day. */
  perPersonMinutes: number
  /**
   * Only suggest work in a building where somebody from that department is already working today.
   * This is the proximity rule, and it is the difference between a plan and a wish: a filter change
   * in a building nobody is visiting is a drive, not a spare twenty minutes.
   */
  requireStaffOnSite: boolean
  /** How overdue a job must be before it may break the proximity rule. 0 disables the escape. */
  escapeAfterDays: number
  cadences: CadenceDef[]
  updatedAt?: string
  updatedBy?: string | null
}

// ── THE SHIPPED CADENCES ────────────────────────────────────────────────────────────────────────
// Intervals Jon named directly are commented as such; the rest are ordinary trade practice and are
// meant to be argued with in settings, which is where they can now be changed.
export const DEFAULT_CADENCES: CadenceDef[] = [
  {
    key: 'ac_deep', label: 'A/C deep clean', everyDays: 182, dept: 'maintenance',
    // Jon, 2026-08-26: "Ac deep cleans should be every 6 months."
    match: '(a\\/?c|air ?con|hvac|mini ?split).*(deep|coil|blower|sanit)|deep clean.*(a\\/?c|hvac|split)',
    needsVacant: true, needsDays: 1, minutes: 120, mode: 'suggest', seedIfNever: true,
  },
  {
    key: 'ac_filter', label: 'A/C filter change', everyDays: 90, dept: 'maintenance',
    match: 'filter',
    // A filter is fifteen minutes and a step stool. It does not need an empty unit, but it is far
    // less awkward in one, so it is ranked below the jobs that genuinely need the window.
    needsVacant: false, needsDays: 0, minutes: 15, mode: 'suggest', seedIfNever: true,
  },
  {
    key: 'batteries', label: 'Lock & smoke batteries', everyDays: 365, dept: 'maintenance',
    match: 'batter(y|ies)',
    // The one job whose failure locks a guest out at midnight. Doable around a guest at a pinch.
    needsVacant: false, needsDays: 0, minutes: 20, mode: 'suggest', seedIfNever: true,
  },
  {
    key: 'deep_clean', label: 'Deep clean', everyDays: 182, dept: 'housekeeping',
    // Deliberately NOT matching 'departure clean' — the turnover is not a deep clean.
    match: '(deep|detail|spring) clean',
    needsVacant: true, needsDays: 2, minutes: 240, mode: 'suggest', seedIfNever: true,
  },
  {
    key: 'dryer_vent', label: 'Dryer vent clean', everyDays: 365, dept: 'maintenance',
    match: 'dryer (vent|duct)|lint',
    needsVacant: true, needsDays: 1, minutes: 45, mode: 'suggest', seedIfNever: false,
  },
  {
    key: 'water_heater', label: 'Water heater flush', everyDays: 365, dept: 'maintenance',
    match: 'water heater|hot water tank|anode',
    needsVacant: true, needsDays: 1, minutes: 60, mode: 'suggest', seedIfNever: false,
  },
]

export const CADENCE_DEFAULTS: CadenceCfg = {
  enabled: false,
  // SIX. Not sixty, and not "however many are due". A coordinator can look at six extra jobs, decide
  // on them in a minute, and still run the day. This is the number that keeps the promise.
  dailyCap: 6,
  perUnitCap: 1,
  perPersonMinutes: 90,
  requireStaffOnSite: true,
  escapeAfterDays: 60,
  cadences: DEFAULT_CADENCES,
}

const isObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: any, fb: number, lo: number, hi: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fb
}
const txt = (v: any, fb: string, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fb

/** A pattern that does not compile is worse than no pattern — it would read every task as a match. */
export function cadenceRe(src: string): RegExp | null {
  try { return new RegExp(src, 'i') } catch { return null }
}
export function patternOk(src: string): boolean {
  return !!src && !!cadenceRe(src)
}

/**
 * Merge a stored override over the shipped defaults.
 *
 * Cadences are matched BY KEY. A shipped cadence the override does not mention keeps its shipped
 * settings; a shipped cadence the override edits takes the edits; a cadence the operator invented
 * is kept as-is; a stored key that no longer exists in code is dropped rather than resurrected.
 */
export function resolveCadences(raw: any): CadenceCfg {
  const d = CADENCE_DEFAULTS
  if (!isObj(raw)) return { ...d, cadences: DEFAULT_CADENCES.map(c => ({ ...c })) }

  const stored: Record<string, any> = {}
  const invented: any[] = []
  if (Array.isArray(raw.cadences)) {
    const shipped = new Set(DEFAULT_CADENCES.map(c => c.key))
    for (const c of raw.cadences.slice(0, 40)) {
      if (!isObj(c)) continue
      const key = txt(c.key, '', 32).toLowerCase().replace(/[^a-z0-9_]/g, '')
      if (!key) continue
      if (shipped.has(key)) stored[key] = c
      else invented.push({ ...c, key })
    }
  }

  const one = (base: CadenceDef, o: any): CadenceDef => {
    const match = txt(o?.match, base.match, 200)
    return {
      key: base.key,
      label: txt(o?.label, base.label, 60),
      everyDays: num(o?.everyDays, base.everyDays, 1, 3650),
      dept: /housekeep|clean/.test(String(o?.dept || '')) ? 'housekeeping'
        : /inspect/.test(String(o?.dept || '')) ? 'inspection'
          : /maint/.test(String(o?.dept || '')) ? 'maintenance' : base.dept,
      // A broken pattern falls back to the shipped one rather than matching everything.
      match: patternOk(match) ? match : base.match,
      needsVacant: o?.needsVacant == null ? base.needsVacant : o.needsVacant === true,
      needsDays: num(o?.needsDays, base.needsDays, 0, 30),
      minutes: num(o?.minutes, base.minutes, 5, 600),
      mode: o?.mode === 'off' ? 'off' : o?.mode === 'auto' ? 'auto' : o?.mode === 'suggest' ? 'suggest' : base.mode,
      seedIfNever: o?.seedIfNever == null ? base.seedIfNever : o.seedIfNever === true,
    }
  }

  const cadences = DEFAULT_CADENCES.map(base => one(base, stored[base.key]))
  for (const inv of invented) {
    const blank: CadenceDef = {
      key: inv.key, label: inv.key, everyDays: 180, dept: 'maintenance', match: inv.key,
      needsVacant: true, needsDays: 1, minutes: 60, mode: 'suggest', seedIfNever: false,
    }
    // An invented cadence with an uncompilable pattern is dropped, not silently made to match all.
    const c = one(blank, inv)
    if (patternOk(txt(inv.match, '', 200))) cadences.push(c)
  }

  return {
    enabled: raw.enabled === true,
    dailyCap: num(raw.dailyCap, d.dailyCap, 1, 40),
    perUnitCap: num(raw.perUnitCap, d.perUnitCap, 1, 6),
    perPersonMinutes: num(raw.perPersonMinutes, d.perPersonMinutes, 15, 480),
    requireStaffOnSite: raw.requireStaffOnSite !== false,
    escapeAfterDays: num(raw.escapeAfterDays, d.escapeAfterDays, 0, 365),
    cadences,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
  }
}

/** Days between two YYYY-MM-DD dates, positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  const x = Date.parse(a + 'T12:00:00Z'), y = Date.parse(b + 'T12:00:00Z')
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86400000) : 0
}

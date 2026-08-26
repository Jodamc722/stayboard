// lib/salary.ts — WHO IS ON SALARY, AND WHAT THAT SALARY COSTS IN A WINDOW.
//
// Jon, 2026-08-25: "We also need to track Yoslenis, she is salary 29 per hour 40 hours a week.
// Guillermo is also salary, 22 per hour 40 hours a week. George Paz, 40 hours per week 25 per
// hour." And on how it should read: "It should be separate but then combined to get a sense of
// cost per clean."
//
// WHY THIS IS ITS OWN FILE, AND WHY IT READS FROM SETTINGS.
// Jon, 2026-08-25: "we will eventually derive all financial info from Eric's app." A rate that
// lives in a constant needs a deploy to change and cannot be fed from anywhere else. So the
// roster below is a SEED, not the answer: app_settings 'salaried_staff' overrides it by name,
// which means the People card can edit it today and Eric's app can write the same row tomorrow
// without touching this engine.
//
// THE WEEK IS THE UNIT. A salary quoted as "29 an hour, 40 hours a week" is $1,160 a week —
// that is what we pay whether or not a single unit turns. So a window costs weekly × days ÷ 7,
// not an annual figure divided by 365; the two disagree by about 0.3% and the weekly one is the
// one that matches the payroll run. An annually-quoted salary (Roberto) converts at 52 weeks.
//
// PUNCHES NEVER DRIVE THE DOLLARS (Jon: "salary always"). Homebase hours still ride on the
// person's row — hours per clean is a productivity read, not a money read — but the wages those
// punches imply are pulled OUT of their crew's hourly payroll before the salary is added, so
// nobody is ever paid twice. Yoslenis clocked 42.4 h/wk and Guillermo 35.2 h/wk in the same
// month; on salary both cost exactly their weekly rate.
import 'server-only'
import { getSetting } from './app-settings'

export type SalaryRow = {
  /** Homebase spelling, including its typos — that is what the timecards key on. Matching is fuzzy. */
  name: string
  /** Quoted rate. hourly × hoursPerWeek is the weekly cost. */
  hourly?: number | null
  hoursPerWeek?: number | null
  /** Alternative quote for someone stated as an annual number. */
  annual?: number | null
  title?: string
  /** false = keep the row for the record but stop charging it. */
  active?: boolean
}

export const SALARY_SETTING_KEY = 'salaried_staff'

// The roster as Jon stated it. Anyone here is paid a salary; everyone else is paid by the clock.
export const SALARY_DEFAULTS: SalaryRow[] = [
  // Jon, 2026-08-24: "We can also add a manager (Roberto section). He is salaried 80k per year."
  { name: 'Roberto Chiriboga', annual: 80000, title: 'Operations Manager', active: true },
  // Jon, 2026-08-25. Yoslenis and George are also the 17WEST pair — 17WEST pays $100k/yr toward
  // the two of them combined and Stay pays the difference, which is now computed off these
  // salaries rather than off their punches. George clocks NO Homebase hours at all (127 Breezeway
  // tasks, $0 of wages), so before this row he was a real cost that no margin could see.
  { name: 'Yoslenis Rodiguez', hourly: 29, hoursPerWeek: 40, title: 'Supervisor', active: true },
  { name: 'Guillermo Hernandez', hourly: 22, hoursPerWeek: 40, title: 'Supervisor', active: true },
  { name: 'George Paz', hourly: 25, hoursPerWeek: 40, title: 'Maintenance', active: true },
]

const r2 = (n: number) => Math.round(n * 100) / 100

/** What this person costs in a week — the number the payroll run actually pays. */
export const DEFAULT_HOURS_PER_WEEK = 40

export function weeklyCost(r: SalaryRow): number {
  const h = Number(r?.hourly)
  // A row with an hourly rate and a blank week is a half-typed form, not a free employee. It
  // falls back to the standard 40 rather than to zero: silently costing nothing is the exact
  // failure this file exists to prevent (George Paz was $0 for months).
  const hw = Number.isFinite(Number(r?.hoursPerWeek)) && Number(r?.hoursPerWeek) > 0
    ? Number(r.hoursPerWeek) : DEFAULT_HOURS_PER_WEEK
  if (Number.isFinite(h) && h > 0) return r2(h * hw)
  const a = Number(r?.annual)
  if (Number.isFinite(a) && a > 0) return r2(a / 52)
  return 0
}

/** The same salary as a year, for the receipts. Weekly quotes annualise at 52 weeks. */
export function annualCost(r: SalaryRow): number {
  const a = Number(r?.annual)
  if (Number.isFinite(a) && a > 0) return r2(a)
  return r2(weeklyCost(r) * 52)
}

/** A window's share. Days ÷ 7, because the salary is quoted by the week. */
export function windowCost(r: SalaryRow, windowDays: number): number {
  const d = Math.max(0, Number(windowDays) || 0)
  return r2((weeklyCost(r) * d) / 7)
}

/** Plain-words rate, for a receipt line: "$29/hr × 40 h/wk = $1,160/wk". */
export function rateLabel(r: SalaryRow): string {
  const h = Number(r?.hourly), hw = Number(r?.hoursPerWeek)
  if (Number.isFinite(h) && Number.isFinite(hw) && h > 0 && hw > 0) {
    return '$' + h + '/hr × ' + hw + ' h/wk = $' + weeklyCost(r).toLocaleString('en-US') + '/wk'
  }
  return '$' + annualCost(r).toLocaleString('en-US') + '/yr = $' + weeklyCost(r).toLocaleString('en-US') + '/wk'
}

/**
 * The live roster: the seed above with any app_settings row of the same name laid over it.
 * Fail-open — an unreachable settings table degrades to the seed, never to an empty roster,
 * because an empty roster silently reports these people as free.
 */
export async function getSalaried(): Promise<SalaryRow[]> {
  let stored: any = null
  try { stored = await getSetting<any>(SALARY_SETTING_KEY, null) } catch { stored = null }
  const rows = Array.isArray(stored) ? stored : Array.isArray(stored?.people) ? stored.people : null
  if (!rows || !rows.length) return SALARY_DEFAULTS.slice()
  const out: SalaryRow[] = SALARY_DEFAULTS.map(d => ({ ...d }))
  const norm = (s: any) => String(s || '').trim().toLowerCase()
  const loose = (s: any) => norm(s).replace(/[^a-z]/g, '')
  for (const raw of rows) {
    const name = String(raw?.name || '').trim()
    if (!name) continue
    const clean: SalaryRow = {
      name,
      hourly: raw?.hourly == null || raw.hourly === '' ? null : Number(raw.hourly),
      hoursPerWeek: raw?.hoursPerWeek == null || raw.hoursPerWeek === '' ? null : Number(raw.hoursPerWeek),
      annual: raw?.annual == null || raw.annual === '' ? null : Number(raw.annual),
      title: raw?.title ? String(raw.title) : undefined,
      active: raw?.active === false ? false : true,
    }
    // MATCH THE SEED LOOSELY. The engine matches names fuzzily, so an exact-string overlay let a
    // settings row spelled "Rodriguez" sit beside the seed's "Rodiguez" — two rows, one person,
    // charged twice. Compare on letters only so the spellings collapse onto one row, and MERGE
    // rather than replace so a partially-filled form keeps the seed's other fields.
    const i = out.findIndex(x => loose(x.name) === loose(name))
    if (i >= 0) {
      const base = out[i]
      out[i] = {
        ...base, ...clean,
        hourly: clean.hourly ?? base.hourly ?? null,
        hoursPerWeek: clean.hoursPerWeek ?? base.hoursPerWeek ?? null,
        annual: clean.annual ?? base.annual ?? null,
        title: clean.title || base.title,
      }
    } else out.push(clean)
  }
  return out
}

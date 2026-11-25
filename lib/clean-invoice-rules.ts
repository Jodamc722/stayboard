// VENDOR INVOICES — the rules, with nothing imported, so plain node can test them
// (lib/__tests__/clean-invoice-rules.test.mjs). The reading and the database are lib/clean-invoices.ts.
//
// Jon, 2026-11-25: "Opal has two models for invoices, so we need to train the invoice email to account
// for that. One is agency model for hours worked, meaning we pay a fee per hour for employees
// provided. We also have a model where they charge per clean, and one per employee. Sean or Atlantic
// is agency model, Pro Bowl is per clean, so need to match. So need to audit worked hours in
// Homebase." And: "It's super important to make sure we catch cleans if we move a clean, so look at
// Breezeway / checkouts. We can move a clean, so that needs to be checked."
//
// TWO MODELS, told apart by what the document bills:
//   per_clean  a line is a unit and a date. Checked against the cleans Breezeway has, and against the
//              checkouts, because a clean can be moved: a line billed on the checkout day matches the
//              clean finished two days later, once, and never twice.
//   hours      a line is a person and their hours. Checked against the hours that person punched in
//              Homebase in the worked period, regular and overtime, and the total against the rates.
// A time report sent along with an invoice (kind "timesheet") is not an invoice and is not audited.

export type InvoiceModel = 'per_clean' | 'hours'
export type DocKind = InvoiceModel | 'timesheet' | 'other'

export type Verdict =
  // per clean
  | 'match' | 'moved' | 'date_off' | 'not_done' | 'no_clean' | 'duplicate' | 'unknown_unit' | 'other_cleaner'
  // hours
  | 'hours_match' | 'hours_over' | 'hours_under' | 'ot_off' | 'no_punches' | 'unknown_person' | 'amount_off' | 'unchecked'

export const VERDICT_LABEL: Record<Verdict, string> = {
  match: 'Matches a clean', moved: 'Clean was moved', date_off: 'Clean on a different day', not_done: 'Clean not finished', no_clean: 'No clean on record',
  duplicate: 'Billed twice', unknown_unit: 'Unit not found', other_cleaner: 'Cleaned by someone else',
  hours_match: 'Hours match Homebase', hours_over: 'More hours than Homebase', hours_under: 'Fewer hours than Homebase', ot_off: 'Overtime does not match',
  no_punches: 'No hours in Homebase', unknown_person: 'Person not found', amount_off: 'Total does not match the rates', unchecked: 'Could not be checked',
}
/** A line that is fine as billed. */
export const OK: Verdict[] = ['match', 'moved', 'hours_match']
/** A line a person should look at before the invoice is paid. `hours_under` and `unchecked` are shown, not flagged. */
export const FLAGGED: Verdict[] = ['date_off', 'not_done', 'no_clean', 'duplicate', 'unknown_unit', 'other_cleaner', 'hours_over', 'ot_off', 'no_punches', 'unknown_person', 'amount_off']
export const isOk = (v: string) => (OK as string[]).includes(v)
export const isFlagged = (v: string) => (FLAGGED as string[]).includes(v)

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
const nice = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const hrs = (n: number) => r2(n).toFixed(2) + 'h'
const usd = (n: number) => '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Who the vendor is ───────────────────────────────────────────────────────────────────────────
const GENERIC = new Set(['llc', 'inc', 'co', 'corp', 'company', 'cleaning', 'cleaners', 'services', 'service', 'works', 'staffing', 'agency', 'the', 'and', 'of', 'group', 'solutions', 'contract'])
/** The words that name a vendor: "Opal Works, LLC" → [opal], "Pro Bowl Cleaning Services" → [pro, bowl]. */
export function vendorWords(vendor: string): string[] {
  return String(vendor || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC.has(w)).slice(0, 2)
}
/** Is this Breezeway name the vendor? ("Opal Works Opal Works" for [opal]; both words must be there for [pro, bowl].) */
export function isVendorName(person: string | null | undefined, words: string[]): boolean {
  const p = String(person || '').toLowerCase()
  return !!p && words.length > 0 && words.every(w => p.includes(w))
}

// ── Per clean: one dated line against the cleans and the checkouts ──────────────────────────────
export type TaskLite = {
  id: string
  /** The day the clean was finished (Eastern), or the day it is scheduled when it is not finished. */
  day: string | null
  scheduled: string | null
  done: boolean
  status: string | null
  /** Who finished it, or who it is assigned to. */
  by: string | null
}
export type LineJudge = { verdict: Verdict; why: string; taskId: string | null }

/** How long after a checkout its clean can land and still be that checkout's clean. */
export const MOVE_DAYS = 7

/**
 * One billed line with a date, against the unit's cleans not already used by another line.
 * `checkouts` and `checkins` are the unit's reservation days (YYYY-MM-DD), any order.
 *
 *   1. a finished clean on that day (finished, or scheduled)            → match
 *   2. a checkout on that day, and its clean finished later, before the
 *      next guest and inside a week                                      → moved (fine: it is the same clean)
 *   3. a finished clean a day either side                                → date_off
 *   4. a clean on record that is not finished                            → not_done
 *   5. nothing                                                            → no_clean
 */
export function judgeDatedLine(date: string, unit: string, cands: TaskLite[], checkouts: string[] = [], checkins: string[] = []): LineJudge {
  const by = (t: TaskLite) => (t.by ? ' by ' + t.by : '')
  const done = cands.filter(t => t.done)
  const exact = done.find(t => t.day === date) || done.find(t => t.scheduled === date)
  if (exact) return { verdict: 'match', why: (exact.day === date ? `Finished ${nice(date)}` : `Scheduled ${nice(date)}, finished ${exact.day ? nice(exact.day) : 'later'}`) + by(exact) + '.', taskId: exact.id }

  const hadCheckout = checkouts.includes(date)
  // The window this checkout's clean can sit in: from the checkout to the next arrival, a week at most.
  const next = checkins.filter(d => d > date).sort()[0]
  const end = next && next < addDays(date, MOVE_DAYS) ? next : addDays(date, MOVE_DAYS)
  if (hadCheckout) {
    const later = done.filter(t => !!t.day && t.day > date && t.day <= end).sort((a, b) => String(a.day).localeCompare(String(b.day)))[0]
    if (later) return { verdict: 'moved', why: `Checkout ${nice(date)}; the clean was moved and finished ${nice(later.day!)}${by(later)}. Same clean, billed on the checkout day.`, taskId: later.id }
  }

  const near = [addDays(date, -1), addDays(date, 1)]
  const off = done.find(t => near.includes(String(t.day))) || done.find(t => near.includes(String(t.scheduled)))
  if (off) return { verdict: 'date_off', why: `Billed ${nice(date)}; the clean on record was ${off.day ? nice(off.day) : 'another day'}${hadCheckout ? '' : ', and there was no checkout on ' + nice(date)}.`, taskId: off.id }

  const open = cands.filter(t => !t.done)
  const pending = open.find(t => t.scheduled === date || t.day === date) || open.find(t => near.includes(String(t.scheduled)))
    || (hadCheckout ? open.find(t => !!t.scheduled && t.scheduled > date && t.scheduled <= end) : undefined)
  if (pending) return { verdict: 'not_done', why: `A clean is on record for ${pending.scheduled ? nice(pending.scheduled) : 'this unit'} but it is “${pending.status || 'open'}”, not finished.`, taskId: pending.id }

  return {
    verdict: 'no_clean', taskId: null,
    why: hadCheckout
      ? `There was a checkout at ${unit} on ${nice(date)}, but no finished clean from then through ${nice(end)}.`
      : `No checkout and no housekeeping task at ${unit} on or around ${nice(date)}.`,
  }
}

// ── Hours: what was worked, from the punches ────────────────────────────────────────────────────
export type Punch = { name: string; date: string | null; hours: number | null }
export type Worked = { total: number; reg: number; ot: number; days: number }
export const OT_WEEKLY = 40

/**
 * Hours a person worked in the period, with overtime as the hours past 40 in each week. Weeks are
 * counted from the first day of the period (the agencies' worked periods start on the payroll
 * week's first day), so a two-week invoice is two weeks, each with its own 40.
 */
export function workedInPeriod(punches: Punch[], from: string, to: string, otWeekly = OT_WEEKLY): Worked {
  const weeks = new Map<number, number>()
  const days = new Set<string>()
  for (const p of punches) {
    const d = String(p.date || ''), h = num(p.hours)
    if (!d || d < from || d > to || h <= 0) continue
    const w = Math.floor(daysBetween(from, d) / 7)
    weeks.set(w, (weeks.get(w) || 0) + h); days.add(d)
  }
  let total = 0, ot = 0
  weeks.forEach(h => { total += h; ot += Math.max(0, h - otWeekly) })
  return { total: r2(total), reg: r2(total - ot), ot: r2(ot), days: days.size }
}
/** Overtime can only be compared when the period is whole weeks: a ten-day period has no clean weekly 40. */
export const wholeWeeks = (from: string, to: string) => (daysBetween(from, to) + 1) % 7 === 0

// ── Hours: what was billed, a person at a time ──────────────────────────────────────────────────
export type HoursRow = { name: string; role?: string | null; market?: string | null; regHours: number; otHours: number; baseRate?: number | null; otRate?: number | null; feePerHour?: number | null; amount?: number | null }
export type BilledPerson = { name: string; where: string; reg: number; ot: number; baseRate: number | null; otRate: number | null; amount: number | null }
const personKey = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** One entry a person: an invoice can list the same person under housekeeping and under maintenance. */
export function billedByPerson(rows: HoursRow[]): BilledPerson[] {
  const out = new Map<string, BilledPerson & { wheres: string[]; anyAmount: boolean }>()
  for (const r of rows) {
    const k = personKey(r.name); if (!k) continue
    const cur = out.get(k) || { name: String(r.name).trim(), where: '', wheres: [], reg: 0, ot: 0, baseRate: null, otRate: null, amount: null, anyAmount: false }
    cur.reg = r2(cur.reg + num(r.regHours)); cur.ot = r2(cur.ot + num(r.otHours))
    if (cur.baseRate == null && num(r.baseRate) > 0) cur.baseRate = num(r.baseRate)
    if (cur.otRate == null && num(r.otRate) > 0) cur.otRate = num(r.otRate)
    if (r.amount != null && Number.isFinite(Number(r.amount))) { cur.amount = r2((cur.amount || 0) + Number(r.amount)); cur.anyAmount = true }
    const w = [r.role, r.market].map(x => String(x || '').trim()).filter(Boolean).join(', ')
    if (w && !cur.wheres.includes(w)) cur.wheres.push(w)
    out.set(k, cur)
  }
  return Array.from(out.values()).map(p => ({ name: p.name, where: p.wheres.join(' · '), reg: p.reg, ot: p.ot, baseRate: p.baseRate, otRate: p.otRate, amount: p.anyAmount ? p.amount : null }))
}

/** Six minutes: a week of punches rounded to the hundredth can drift by a few. */
export const HOURS_TOL = 0.1
export type HoursJudge = { verdict: Verdict; why: string; risk: number | null }

/**
 * One person's billed hours against Homebase.
 * `worked` is null when Homebase has nobody by that name; `known` says the person is on our roster.
 * `rate` is what an hour costs on this invoice (base pay plus the fee), for the money at stake.
 */
export function judgeHours(billed: { reg: number; ot: number }, worked: Worked | null, opts: { known: boolean; weekly: boolean; period: string; rate?: number | null; otRate?: number | null }): HoursJudge {
  const total = r2(billed.reg + billed.ot)
  const rate = num(opts.rate), otRate = num(opts.otRate) || rate * 1.5
  if (!worked || worked.total <= 0) {
    return opts.known
      ? { verdict: 'no_punches', why: `Billed ${hrs(total)}; Homebase has no hours for this person in ${opts.period}.`, risk: rate ? r2(billed.reg * rate + billed.ot * otRate) : null }
      : { verdict: 'unknown_person', why: `Billed ${hrs(total)}; nobody by this name is in Homebase.`, risk: rate ? r2(billed.reg * rate + billed.ot * otRate) : null }
  }
  const diff = r2(total - worked.total)
  if (diff > HOURS_TOL) return { verdict: 'hours_over', why: `Billed ${hrs(total)}; Homebase shows ${hrs(worked.total)} worked (${hrs(diff)} more than worked).`, risk: rate ? r2(diff * rate) : null }
  if (diff < -HOURS_TOL) return { verdict: 'hours_under', why: `Billed ${hrs(total)}; Homebase shows ${hrs(worked.total)} worked (${hrs(-diff)} not billed).`, risk: null }
  const otDiff = r2(billed.ot - worked.ot)
  if (opts.weekly && otDiff > HOURS_TOL) {
    return { verdict: 'ot_off', why: `The total matches (${hrs(total)}), but ${hrs(billed.ot)} is billed as overtime and Homebase puts ${hrs(worked.ot)} past ${OT_WEEKLY} in a week.`, risk: rate ? r2(otDiff * Math.max(0, otRate - rate)) : null }
  }
  return { verdict: 'hours_match', why: `Homebase shows ${hrs(worked.total)}: ${hrs(worked.reg)} regular${worked.ot > 0 ? ' and ' + hrs(worked.ot) + ' overtime' : ''}, over ${worked.days} day${worked.days === 1 ? '' : 's'}.`, risk: null }
}

// ── Hours: the money ────────────────────────────────────────────────────────────────────────────
/**
 * What the hours on the invoice come to on the agreed terms: base pay for regular hours, time and a
 * half for overtime, and the agency's fee for every hour worked (a flat fee, not multiplied on
 * overtime). null when a rate is missing for anyone: half a sum is not a check.
 */
export function expectedTotal(people: BilledPerson[], feePerHour: number): number | null {
  if (!people.length || !(feePerHour > 0)) return null
  let sum = 0
  for (const p of people) {
    if (!(num(p.baseRate) > 0)) { if (p.reg + p.ot > 0) return null; continue }
    sum += p.reg * num(p.baseRate) + p.ot * num(p.baseRate) * 1.5 + (p.reg + p.ot) * feePerHour
  }
  return r2(sum)
}

export function judgeAmount(billedTotal: number | null, people: BilledPerson[], feePerHour: number, feeFrom: string): HoursJudge | null {
  const expected = expectedTotal(people, feePerHour)
  if (billedTotal == null || expected == null) return null
  const diff = r2(billedTotal - expected)
  const ot = r2(people.reduce((a, p) => a + p.ot, 0))
  const terms = `base pay, overtime at time and a half, and a ${usd(feePerHour)} an hour fee on every hour (${feeFrom})`
  if (Math.abs(diff) <= 1) return { verdict: 'hours_match', why: `Billed ${usd(billedTotal)}. The hours on the invoice at ${terms} come to ${usd(expected)}.`, risk: null }
  if (diff < 0) return { verdict: 'hours_match', why: `Billed ${usd(billedTotal)}, which is ${usd(-diff)} under what the hours come to at ${terms} (${usd(expected)}).`, risk: null }
  // The usual cause: the fee charged at time and a half on overtime hours.
  const feeOnOt = r2(0.5 * feePerHour * ot)
  const hint = ot > 0 && Math.abs(diff - feeOnOt) <= Math.max(1, diff * 0.15) ? ` That is about what charging the fee at time and a half on the ${hrs(ot)} of overtime adds.` : ''
  return { verdict: 'amount_off', why: `Billed ${usd(billedTotal)}. The hours on the invoice at ${terms} come to ${usd(expected)}: ${usd(diff)} over.${hint}`, risk: diff }
}

/** "Opal Works, LLC" → the agency whose key or label is in the vendor's name. */
export function agencyFor<T extends { key: string; label: string }>(vendor: string, agencies: T[]): T | null {
  const v = String(vendor || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!v) return null
  return agencies.find(a => { const k = a.key.toLowerCase().replace(/[^a-z0-9]+/g, ''), l = a.label.toLowerCase().replace(/[^a-z0-9]+/g, ''); return (k.length >= 3 && v.includes(k)) || (l.length >= 3 && v.includes(l)) }) || null
}

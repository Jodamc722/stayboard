// THE PRICE BOOK (Jon, 2026-11-02: "have suggested rate based on past jobs similar").
//
// What each KIND of job (lib/billing jobKind: billable category + the title's first words) has
// actually been billed once a person approved it, over the last four months. A task with no time on
// the clock is priced from this: "usual $95 — 7 similar approved jobs, $80–$120". A price far above
// the book is flagged.
//
// Rebuilt from the approved rows themselves (never from guesses), at most once every three days —
// the review desk asks for a rebuild when the stored book is stale. Stored in app_settings
// 'billing_pricebook'.
import 'server-only'
import { getSetting, setSetting } from './app-settings'

export const PRICEBOOK_KEY = 'billing_pricebook'
export type PriceEntry = {
  n: number; median: number; low: number; high: number
  /** Average hours on the clock for the jobs that logged time; null = none did. */
  avgHours: number | null
  /** What these jobs billed per clocked hour (total billed ÷ total hours, jobs with time only). */
  perHour: number | null
  /** The rate we recommend for this kind of job: the median, rounded to $5. */
  recommended: number
  recent: { amount: number; unit: string; day: string }[]
}
export type PriceBook = { builtAt: string; months: string[]; kinds: Record<string, PriceEntry>; categories?: Record<string, PriceEntry>; houseRate?: number }

export async function readPricebook(): Promise<PriceBook | null> {
  const v = await getSetting<any>(PRICEBOOK_KEY, null)
  return v && typeof v === 'object' && v.kinds ? v as PriceBook : null
}
export const pricebookStale = (b: PriceBook | null) => !b || Date.now() - Date.parse(b.builtAt) > 3 * 86400000

const q = (sorted: number[], p: number) => { if (!sorted.length) return 0; const i = (sorted.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) * 100) / 100 }

export async function buildPricebook(by: string): Promise<PriceBook> {
  const { billingRange, monthRange } = await import('./billing')
  const { isDepartureCleanName } = await import('./breezeway')
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
  const months: string[] = []
  for (let i = 0; i < 4; i++) { const [y, m] = now.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 - i, 15)); months.push(d.toISOString().slice(0, 7)) }
  type Row = { amount: number; unit: string; day: string; hours: number }
  const rows: Record<string, Row[]> = {}
  const cats: Record<string, Row[]> = {}
  for (const m of months) {
    const r = monthRange(m)
    const data = await billingRange(r.from, r.to)
    for (const t of data.tasks) {
      if (t.excluded || !(t.billedAmount > 0) || t.reviewState === 'open' || t.gmBy === 'auto' || t.routine) continue
      if (isDepartureCleanName(t.name) || t.billable?.category === 'inspection') continue
      const hours = t.billedHours != null ? t.billedHours : t.actualMinutes ? t.actualMinutes / 60 : 0
      const row = { amount: t.billedAmount, unit: t.unit, day: String(t.scheduledDate || t.finishedAt || '').slice(0, 10), hours }
      ;(rows[t.kind] = rows[t.kind] || []).push(row)
      const c = t.billable?.category || 'other'
      ;(cats[c] = cats[c] || []).push(row)
    }
  }
  const entry = (list: Row[]): PriceEntry => {
    const a = list.map(x => x.amount).sort((x, y) => x - y)
    const timed = list.filter(x => x.hours > 0)
    const hrs = timed.reduce((s, x) => s + x.hours, 0)
    const median = q(a, 0.5)
    return {
      n: a.length, median, low: q(a, 0.25), high: q(a, 0.75),
      avgHours: timed.length ? Math.round(hrs / timed.length * 100) / 100 : null,
      perHour: hrs > 0 ? Math.round(timed.reduce((s, x) => s + x.amount, 0) / hrs * 100) / 100 : null,
      recommended: Math.max(5, Math.round(median / 5) * 5),
      recent: list.slice().sort((x, y) => y.day.localeCompare(x.day)).slice(0, 3).map(({ amount, unit, day }) => ({ amount, unit, day })),
    }
  }
  const kinds: Record<string, PriceEntry> = {}
  for (const [k, list] of Object.entries(rows)) kinds[k] = entry(list)
  const categories: Record<string, PriceEntry> = {}
  for (const [k, list] of Object.entries(cats)) categories[k] = entry(list)
  let houseRate = 40
  try { const r = await getSetting<any>('billing_default_rate', null); if (Number(r?.rate) > 0) houseRate = Number(r.rate) } catch { /* $40 */ }
  const book: PriceBook = { builtAt: new Date().toISOString(), months, kinds, categories, houseRate }
  await setSetting(PRICEBOOK_KEY, book, by)
  return book
}

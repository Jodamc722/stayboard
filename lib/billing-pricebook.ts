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
export type PriceEntry = { n: number; median: number; low: number; high: number; recent: { amount: number; unit: string; day: string }[] }
export type PriceBook = { builtAt: string; months: string[]; kinds: Record<string, PriceEntry> }

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
  const rows: Record<string, { amount: number; unit: string; day: string }[]> = {}
  for (const m of months) {
    const r = monthRange(m)
    const data = await billingRange(r.from, r.to)
    for (const t of data.tasks) {
      if (t.excluded || !(t.billedAmount > 0) || t.reviewState === 'open' || t.gmBy === 'auto' || t.routine) continue
      if (isDepartureCleanName(t.name) || t.billable?.category === 'inspection') continue
      ;(rows[t.kind] = rows[t.kind] || []).push({ amount: t.billedAmount, unit: t.unit, day: String(t.scheduledDate || t.finishedAt || '').slice(0, 10) })
    }
  }
  const kinds: Record<string, PriceEntry> = {}
  for (const [k, list] of Object.entries(rows)) {
    const a = list.map(x => x.amount).sort((x, y) => x - y)
    kinds[k] = { n: a.length, median: q(a, 0.5), low: q(a, 0.25), high: q(a, 0.75), recent: list.sort((x, y) => y.day.localeCompare(x.day)).slice(0, 3) }
  }
  const book: PriceBook = { builtAt: new Date().toISOString(), months, kinds }
  await setSetting(PRICEBOOK_KEY, book, by)
  return book
}

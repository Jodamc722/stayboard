// Pure: no imports, so the test can load it directly (lib/__tests__/owner-onboard-deal.test.mjs).
/**
 * THE DEAL, AS SALES SIGNED IT (Jon, 2026-11-20: "have a live date the Sales team can put, meaning when we can actually
 * start running the unit… have it fill out management fee… that way we can prioritize properties"). Two facts the team
 * works from and the owner's page never shows: the day the home can start taking guests, and the management fee on the
 * agreement. The list sorts by the live date, soonest first.
 */
export type OODeal = { /** YYYY-MM-DD, '' when not set */ liveDate: string; /** percent of revenue, null when not set */ fee: number | null }
export const DEFAULT_FEE = 15
export function cleanDeal(v: any, prev?: OODeal | null): OODeal {
  const d = v?.liveDate, f = v?.fee
  const liveDate = typeof d === 'string' ? (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '') : prev?.liveDate || ''
  const x = Number(f)
  const fee = f === '' || f === null ? null : f === undefined ? prev?.fee ?? null : Number.isFinite(x) && x >= 0 && x <= 100 ? Math.round(x * 100) / 100 : prev?.fee ?? null
  return { liveDate, fee }
}
/** Whole days from today (Eastern) to the live date: 0 today, negative when it has passed, null when there is none. */
export function daysToLive(liveDate: string | undefined, now: Date = new Date()): number | null {
  if (!liveDate || !/^\d{4}-\d{2}-\d{2}$/.test(liveDate)) return null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
  return Math.round((Date.parse(liveDate + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
}
/** "Dec 5" from a YYYY-MM-DD, with the year when it is not this one. */
export function liveLabel(liveDate: string, now: Date = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(liveDate || '')) return ''
  const d = new Date(liveDate + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(d.getUTCFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}
/** "in 12 days", "tomorrow", "today", "5 days ago". */
export function liveIn(days: number): string {
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days > 0 ? 'in ' + days + ' days' : -days + ' days ago'
}
export const feeLabel = (fee: number | null | undefined) => (typeof fee === 'number' ? String(fee).replace(/\.0+$/, '') + '%' : '')
/** SOONEST LIVE DATE FIRST: homes with a date before homes without; a home already live or archived drops to the end. */
export function byLiveDate<T extends { liveDate?: string; stage?: string; archived?: boolean; updatedAt: string }>(a: T, b: T): number {
  const rank = (x: T) => (x.archived || x.stage === 'Live' ? 2 : x.liveDate ? 0 : 1)
  return rank(a) - rank(b) || (rank(a) === 0 ? String(a.liveDate).localeCompare(String(b.liveDate)) : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt))
}

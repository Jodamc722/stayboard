// OUR OWN NUMBERS FOR THE PDF'S WINDOW (2026-10-06). The pacing check needs our occupancy / ADR /
// RevPAR for exactly the stay dates the PriceLabs pull covers — not the report period, which for a
// month in progress includes weeks nobody has booked yet. Same reservation pull and metric math as
// the report's own snapshot cards (lib/owner-report), so the two can never disagree on method.
import 'server-only'
import { pullReservations, metricsFor, resolveScope } from './owner-report'
import { pacingWindow, type OurTruth } from './pacing-check'

const nextDay = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export type WindowTruth = OurTruth & { from: string; to: string; source: 'pdf' | 'to-date' }

/**
 * The window to check against: the PDF's own (explicit or from the subtitle); otherwise the report
 * period up to today (month-to-date), never past today.
 */
export function checkWindow(subtitle: string, explicit: any, periodStart: string, periodEnd: string): { from: string; to: string; source: 'pdf' | 'to-date' } {
  const year = Number(String(periodStart).slice(0, 4)) || new Date().getFullYear()
  const w = pacingWindow(subtitle, explicit, year)
  if (w) return { ...w, source: 'pdf' }
  const t = todayET()
  const to = periodEnd && periodEnd < t ? periodEnd : t
  return { from: periodStart, to: to >= periodStart ? to : periodStart, source: 'to-date' }
}

export async function truthForWindow(listingIds: string[], w: { from: string; to: string; source: 'pdf' | 'to-date' }): Promise<WindowTruth | null> {
  try {
    const ids = (listingIds || []).map(String).filter(Boolean).filter(x => x !== 'garden').slice(0, 40)
    if (!ids.length) return null
    const scope = await resolveScope(ids, [])
    const units = scope.listings.length
    if (!units) return null
    const toExcl = nextDay(w.to)
    const m = metricsFor(await pullReservations(ids, w.from, toExcl), units, w.from, toExcl)
    return { occPct: m.occupancyPct || undefined, adr: m.adr || undefined, revpar: m.revpar || undefined, ...w }
  } catch { return null }
}

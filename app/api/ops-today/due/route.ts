// THE PM CALENDAR — what is due and when, by building (lib/pm-calendar).
//   GET /api/ops-today/due?market=Miami&days=30[&count=1]
// Read-only: this proposes nothing and creates nothing. Adding is the Add-task route, as ever.
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { buildDueCalendar } from '@/lib/pm-calendar'
import { requireVrUser } from '@/lib/vr-gate'
import { DAY_TAG, freshEnough } from '@/lib/bust'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

// ?count=1 IS THE TAB BADGE'S READ (2026-11-09 audit). The badge used to download the whole ledger
// — every building, every item — to print one number, on every view of the board. It now gets the
// totals only, and the ledger behind them is built at most once every five minutes per market
// (busted with the day, so filing a job from the ledger moves the number). A failed build throws,
// so it is never cached; a copy older than fifteen minutes is rebuilt rather than served.
const COUNT_MAX_AGE_MS = 15 * 60_000
async function buildDueCount(today: string, market: string, horizonDays: number) {
  const due = await buildDueCalendar(today, { market, horizonDays })
  return { ok: true as const, today: due.today, totals: due.totals, builtAt: new Date().toISOString() }
}
const cachedDueCount = unstable_cache(
  async (today: string, market: string, horizonDays: number) => buildDueCount(today, market, horizonDays),
  ['ops-due-count-v1'], { tags: [DAY_TAG], revalidate: 300 },
)

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const market = String(req.nextUrl.searchParams.get('market') || 'all')
  const days = Number(req.nextUrl.searchParams.get('days') || 30)
  const q = String(req.nextUrl.searchParams.get('date') || '')
  const today = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : ymd(new Date())
  const horizonDays = Number.isFinite(days) ? days : 30
  try {
    if (req.nextUrl.searchParams.get('count') === '1') {
      return NextResponse.json(await freshEnough(
        () => cachedDueCount(today, market, horizonDays), () => buildDueCount(today, market, horizonDays), c => c.builtAt, COUNT_MAX_AGE_MS))
    }
    return NextResponse.json(await buildDueCalendar(today, { market, horizonDays }))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

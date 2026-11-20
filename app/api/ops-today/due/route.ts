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

// ONE LEDGER BUILD FOR THE BADGE AND THE TAB (Jon, 2026-11-20 audit: the PM due tab opened on "Reading the cadence
// ledger…" for six seconds). The badge's count was cached, but the tab's own read was not — and the two never
// shared: opening the tab cold ran the whole ledger twice at once (once for the number, once for the rows), and
// every flip back to the tab after its ten-minute device copy lapsed ran it again. The full ledger is now kept
// under the same day tag for the same five minutes, the count is read off it, and the tab is served the copy the
// badge already paid for. Filing a job, a task action and the Breezeway webhook all bump the day tag, so a change
// still shows on the next read. A build that throws is never cached; a partial read ("degraded") is never served
// from the cache; a copy older than fifteen minutes is rebuilt in place (lib/bust freshEnough).
async function buildDue(today: string, market: string, horizonDays: number) {
  return { due: await buildDueCalendar(today, { market, horizonDays }), builtAt: new Date().toISOString() }
}
const cachedDue = unstable_cache(
  async (today: string, market: string, horizonDays: number) => buildDue(today, market, horizonDays),
  ['ops-due-ledger-v1'], { tags: [DAY_TAG], revalidate: 300 },
)
async function readDue(today: string, market: string, horizonDays: number) {
  const v = await freshEnough(() => cachedDue(today, market, horizonDays), () => buildDue(today, market, horizonDays), c => c.builtAt, COUNT_MAX_AGE_MS)
  return v.due.degraded && v.due.degraded.length ? (await buildDue(today, market, horizonDays)).due : v.due
}

async function buildDueCount(today: string, market: string, horizonDays: number) {
  const due = await readDue(today, market, horizonDays)
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
    return NextResponse.json(await readDue(today, market, horizonDays))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

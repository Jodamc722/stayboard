// LABOR BY DAY, BY CREW — the one KPI table (Jon, 2026-09-21). See lib/labor-day.ts.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&market=all|miami|broward|north   (default: last 14 days ending yesterday)
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { laborDays, CREW_KEYS } from '@/lib/labor-day'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const money = canSeeMoney(access)
  const sp = new URL(req.url).searchParams
  const today = dISO(new Date())
  const yesterday = dISO(addDays(new Date(), -1))
  let to = String(sp.get('to') || '')
  let from = String(sp.get('from') || '')
  if (!isDay(to)) to = yesterday
  if (to > today) to = today
  if (!isDay(from)) from = dISO(addDays(new Date(to + 'T12:00:00Z'), -13))
  if (from > to) from = to
  // 90 days max — one engine run over the window; Homebase is week-chunked underneath.
  if ((new Date(to + 'T12:00:00Z').getTime() - new Date(from + 'T12:00:00Z').getTime()) / 864e5 > 90) from = dISO(addDays(new Date(to + 'T12:00:00Z'), -90))
  const market = String(sp.get('market') || 'all').toLowerCase()
  try {
    const out = await laborDays({ from, to, market })
    if (!money) {
      // Same money gate as the board: hours, turns and counts stay; every dollar is hidden.
      const strip = (r: any) => {
        for (const k of CREW_KEYS) { r.crews[k].payroll = null; r.crews[k].punchPayroll = null; r.crews[k].billable = null }
        r.hk.fees = null; r.hk.costPerClean = null; r.hk.margin = null; r.hk.marginPct = null
        r.total.payroll = null; r.total.fees = null; r.total.billable = null; r.total.margin = null
      }
      out.rows.forEach(strip); strip(out.sum)
      ;(out.health as any).unrostered.payroll = null; (out.health as any).unassignedMarket.payroll = null
      ;(out.health as any).feesNoCleanFound = null
    }
    return NextResponse.json({ ok: true, moneyHidden: !money, ...out })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

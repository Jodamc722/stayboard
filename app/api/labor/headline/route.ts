// THE ONE COST PER CLEAN, SERVED ONCE.
//
// Cost per clean is the number Jon reads first, and until today three surfaces computed it three
// different ways: lib/labor-econ (right), lib/kpi from an empty Breezeway pay column (wrong), and
// /labor/dashboard from housekeeping wages over CHECKOUTS (wrong, and labelled as such on screen).
// A number that disagrees with itself across three screens is worse than a missing one.
//
// So the engine is the only author, and anything that wants the headline asks here. It is a
// separate endpoint rather than part of /api/kpi because the engine is a heavy sweep and the home
// page should paint before it lands.
//   GET /api/labor/headline?days=7&market=all
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { laborEconomics } from '@/lib/labor-econ'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Money is gated the same way it is everywhere else; the clean COUNT is not money.
  const money = canSeeMoney(access)

  const sp = req.nextUrl.searchParams
  const days = Math.min(Math.max(Number(sp.get('days') || 7), 1), 90)
  const market = String(sp.get('market') || 'all').toLowerCase()
  const to = ymd(new Date())
  const from = addDays(to, -(days - 1))

  try {
    const eco = await laborEconomics({ from, to, market })
    const H: any = eco.kpi.housekeeping
    return NextResponse.json({
      ok: true, from, to, days, market,
      cleans: H.cleans,
      // Named, not netted: turns the housekeepers did not do, and what they were worth.
      coveredByOtherCrews: H.coveredByOtherCrews,
      costPerClean: money ? H.costPerClean : null,
      revPerClean: money ? H.revPerClean : null,
      hoursPerClean: H.hoursPerClean,
      marginPct: money ? H.marginPct : null,
      laborPct: money ? H.laborPct : null,
      loadedCostPerClean: money ? (eco.kpi as any).housekeepingLoaded?.costPerClean ?? null : null,
      allInCostPerClean: money ? (eco.kpi as any).housekeepingAllIn?.costPerClean ?? null : null,
      perHead: money ? (eco.kpi as any).perHead : null,
      basis: H.basisNote,
    })
  } catch (e: any) {
    // A failed sweep says so. It does not hand back a plausible number from a thinner source.
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

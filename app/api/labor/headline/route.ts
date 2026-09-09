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
import { canSeeMoney, requireLevel } from '@/lib/access'
import { laborEconomics } from '@/lib/labor-econ'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }

export async function GET(req: NextRequest) {
  // Payroll by crew is labor data, gated like the rest of the labor board — not merely "signed in".
  const gate = await requireLevel('labor', 'view')
  if (!gate.ok) return gate.res
  const access = gate.access
  // Money is gated the same way it is everywhere else; the clean COUNT is not money.
  const money = canSeeMoney(access)

  const sp = req.nextUrl.searchParams
  const market = String(sp.get('market') || 'all').toLowerCase()
  const isRange = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.get('from') || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(sp.get('to') || ''))
  const today = ymd(new Date())
  // A bad `days` used to reach addDays as NaN and throw a RangeError OUTSIDE the try, which the
  // caller saw as a framework 500 instead of the { ok:false } it knows how to render.
  const raw = Number(sp.get('days'))
  const days = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 7, 1), 90)
  const to = isRange ? String(sp.get('to')) : today
  const from = isRange ? String(sp.get('from')) : addDays(to, -(days - 1))

  try {
    const eco = await laborEconomics({ from, to, market })
    const H: any = eco.kpi.housekeeping
    return NextResponse.json({
      ok: true, from, to, days, market,
      cleans: H.cleans,
      // Named, not netted: turns the housekeepers did not do, and what they were worth. The COUNT
      // is not money; the fee is, and it is gated like every other dollar on this route — a number
      // that must not be seen must not be sent.
      coveredByOtherCrews: {
        cleans: (H.coveredByOtherCrews && H.coveredByOtherCrews.cleans) || 0,
        fees: money ? ((H.coveredByOtherCrews && H.coveredByOtherCrews.fees) || 0) : null,
      },
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

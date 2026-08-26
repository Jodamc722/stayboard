// WEEK BY WEEK: departure cleans against the hours and payroll that turned them.
//
// Jon, 2026-08-21: "calculate the total departure cleans by the week and look at the hours worked
// to get a good idea… What matters most is Rev generated and HK payroll. Breezeway is the color
// not the rule." So every row leads with cleaning revenue, housekeeper payroll and departure
// cleans — Homebase for the money and hours, the matched departure clean for the volume — and the
// Breezeway task counts ride along as context.
//
// It runs the SAME engine (lib/labor-econ) once per week rather than re-deriving anything, because
// a trend that disagrees with the board it sits under is worse than no trend. Homebase caches its
// weeks internally, which is what keeps six calls affordable.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { laborEconomics } from '@/lib/labor-econ'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

// Monday-start weeks: a turnover Saturday and its Sunday belong to the same working week.
function mondayOf(d: Date): Date {
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }))
  const dow = local.getDay()               // 0 = Sunday
  return addDays(d, -((dow + 6) % 7))
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const money = canSeeMoney(access)

  const sp = new URL(req.url).searchParams
  const weeks = Math.max(2, Math.min(12, Number(sp.get('weeks')) || 6))
  const market = String(sp.get('market') || 'all').toLowerCase()
  const includeCurrent = sp.get('current') === '1'

  // Whole weeks only by default: a Tuesday's worth of punches next to six full weeks reads as a
  // collapse in cleans that never happened.
  const thisMonday = mondayOf(new Date())
  const lastComplete = addDays(thisMonday, -1)          // yesterday's Sunday
  const endAnchor = includeCurrent ? new Date() : lastComplete

  const spans: { start: string; end: string; label: string; partial: boolean }[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const s = addDays(mondayOf(endAnchor), -7 * i)
    const eFull = addDays(s, 6)
    const partial = includeCurrent && dISO(eFull) > dISO(new Date())
    const e = partial ? new Date() : eFull
    spans.push({
      start: dISO(s), end: dISO(e), partial,
      label: new Date(dISO(s) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    })
  }

  const rows: any[] = []
  for (const w of spans) {
    try {
      const e = await laborEconomics({ from: w.start, to: w.end, market })
      const hk = (e.departments || []).find((d: any) => d.key === 'housekeeping')
      // HOUSEKEEPER WAGES OVER HOUSEKEEPER CLEANS. `e.cleans` is every person's clean count —
      // techs, supervisors, outside cleaners — so dividing HK-only payroll by it made this trend
      // read materially cheaper than the board's own tile, directly above it on the same screen.
      const cleans = Number(hk?.cleans) || 0
      const hkHours = Number(hk?.hours) || 0
      const hkPayroll = Number(hk?.payroll) || 0
      const revenue = Number(e.cleaningRevenue) || 0
      rows.push({
        ...w,
        // -- the rule --------------------------------------------------
        cleans,
        cleaningRevenue: money ? round2(revenue) : null,
        hkPayroll: money ? round2(hkPayroll) : null,
        hkHours: round1(hkHours),
        housekeepers: Number(hk?.people) || 0,
        hoursPerClean: cleans > 0 && hkHours > 0 ? round2(hkHours / cleans) : null,
        costPerClean: money && cleans > 0 && hkPayroll > 0 ? round2(hkPayroll / cleans) : null,
        revPerClean: money && cleans > 0 && revenue > 0 ? round2(revenue / cleans) : null,
        hkMargin: money ? round2(revenue - hkPayroll) : null,
        hkMarginPct: revenue > 0 ? round1(((revenue - hkPayroll) / revenue) * 100) : null,
        // -- vendor, kept apart on purpose (Jon 2026-08-21) ------------
        vendorRevenue: money ? round2(Number(e.cleaningRevenueVendor) || 0) : null,
        // -- the colour ------------------------------------------------
        totalPayroll: money ? round2(Number(e.payroll) || 0) : null,
        unattributedRevenue: money ? round2(Number(e.cleaningRevenueUnattributed) || 0) : null,
        cleansUnassigned: Number(e.coverage?.cleansUnassigned) || 0,
        unrosteredPayroll: money ? round2(Number(e.unrostered?.payroll) || 0) : null,
        unrosteredPeople: Number(e.unrostered?.people) || 0,
        payrollComplete: e.payrollAudit?.complete !== false,
      })
    } catch (err: any) {
      // One bad week must not take the trend down with it - and it must not silently read as zero.
      rows.push({ ...w, error: String(err?.message || err).slice(0, 160), cleans: null })
    }
  }

  const ok = rows.filter(r => !r.error && r.cleans != null)
  const avg = (pick: (r: any) => number | null) => {
    const vals = ok.map(pick).filter((n): n is number => n != null && Number.isFinite(n))
    return vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  return NextResponse.json({
    ok: true,
    market, weeks: rows.length,
    rows,
    averages: {
      cleans: avg(r => r.cleans),
      hkHours: avg(r => r.hkHours),
      hoursPerClean: avg(r => r.hoursPerClean),
      costPerClean: avg(r => r.costPerClean),
      revPerClean: avg(r => r.revPerClean),
    },
    basis: 'Homebase timecards for hours and payroll · matched departure cleans for volume · cleaning fees net of the channel cut for revenue. Breezeway task counts are context, never the calculation.',
    failedWeeks: rows.filter(r => r.error).map(r => r.label),
  })
}

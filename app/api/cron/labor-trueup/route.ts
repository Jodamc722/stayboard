// THE LABOR LEDGER — 7:58am every morning (Jon, 2026-11-05: ONE BRIEF PER ROLE). Until today this
// job also sent the Labor Scorecard email; its numbers now ride in the GM morning's Labor block
// (lib/briefs/labor-scorecard, built at 7:01). What stays here is the work nothing else does:
//   1. THE TRUE-UP SNAPSHOT — the settled 30 days (app_settings `labor_trueup_snapshot`), read by the
//      staffing planner and anything that wants "the last 30 days (settled)" without re-running the
//      engine. Never stored on partial payroll: a snapshot taken while Homebase was rate-limiting
//      would store understated payroll as settled truth.
//   2. THE FORWARD-BOOKINGS SNAPSHOT for the staffing planner (lib/labor-plan).
//   3. THE INTEGRITY CHECKS (lib/labor-integrity) on the same 30 days. The owner hears about a
//      failure in the GM morning; the separate ⚠️ email goes out only on a morning the GM morning did
//      not deliver its Labor block (off, nobody on the list, timed out, or the engine failed there).
//
// GET                → run, store the snapshots, email failing checks if the GM morning did not carry them
// GET ?force=1       → the same, and email failing checks even if they are unchanged or already shown
// GET ?preview=1     → the snapshot and the checks as JSON; nothing stored or sent (signed-in admin)
// GET ?checks=1      → the integrity checks as JSON, nothing sent (signed-in admin)
// Nobody's address lives here any more: `labor_weekly` / `labor_daily` are no longer read — the
// labor numbers go to the GM morning list (ops_brief.gm).
import { NextRequest, NextResponse } from 'next/server'
import { setSetting } from '@/lib/app-settings'
import { laborEconomics } from '@/lib/labor-econ'
import { storeForwardSnapshot } from '@/lib/labor-plan'
import { requireCron, cronAllowed } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { integrityChecks, engineFailedCheck, emailIntegrityFailures, integrityIgnoreNames, shouldEmailIntegrity, markIntegrityEmailed } from '@/lib/labor-integrity'
import { atEasternHour } from '@/lib/et-clock'
import { laborDeliveredToday, freshLabor30 } from '@/lib/briefs/labor-scorecard'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)

// The settled 30 days — the staffing planner reads this snapshot; keep the shape it expects.
type Snap = {
  from: string; to: string; takenAt: string
  maintFrom?: string
  cleans: number; cleaningRevenue: number; hkRevenue?: number; credited: number
  billable: number; payroll: number; margin: number
  costPerClean: number | null
  hkPayroll?: number
  markets?: { key: string; label: string; inHouse: boolean; cleans: number; revenue: number; payroll: number; costPerClean: number | null; hoursPerClean: number | null; margin: number; marginPct: number | null }[]
}

// RECEIPT (2026-09-21): the Learning tab's Homebase row read "missing" because this job never
// wrote one. The wrapper reads ok off the response; preview, test and ?checks write nothing.
const receipted = withRouteReceipt<NextRequest>('labor-trueup', send, { skipWhen: (req) => { const sp = new URL(req.url).searchParams; return sp.get('preview') === '1' || sp.get('test') === '1' || sp.get('checks') === '1' } })

// 7:58AM EASTERN ALL YEAR (2026-09-29). vercel.json fires this at 11:58 AND 12:58 UTC; on the
// scheduler's own call, the one that is not 7am in New York stops here — before the receipt, the
// Homebase reads, the snapshot or any send (lib/et-clock). A person's run — ?force, preview,
// checks — carries no bearer and is never skipped.
export async function GET(req: NextRequest) {
  // :58 sits two minutes before the hour turns: read the clock ten minutes back so a call Vercel
  // delivers a little late (12:00 UTC for the 11:58 fire) is still this morning's 7am run, not a twin.
  if (cronAllowed(req).viaSecret && !atEasternHour(7, undefined, new Date(Date.now() - 10 * 60_000))) return NextResponse.json({ ok: true, skipped: 'daylight-saving twin — this job runs at 7am Eastern' })
  return receipted(req)
}

async function send(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const preview = sp.get('preview') === '1'
  const force = sp.get('force') === '1'
  const checksOnly = sp.get('checks') === '1'
  // WHO IS ALLOWED TO SET THIS OFF: the scheduler's bearer, or a signed-in admin (lib/cron-auth
  // requireCron); preview and checks are a person's actions, so the bearer alone does not open them.
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const user = gate.access ? gate.access.user : null
  try {
    if ((preview || checksOnly) && !user) return NextResponse.json({ error: 'sign in' }, { status: 401 })
    if (sp.get('test') === '1') return NextResponse.json({ ok: false, error: 'This job no longer sends an email — the labor numbers are in the GM morning. Preview it at /api/cron/ops-brief?preview=gm.' }, { status: 400 })

    const now = new Date()
    const today = dISO(now)
    const yd = dISO(addDays(now, -1))
    const d30 = dISO(addDays(now, -30))

    // The engine not running at all is itself an integrity failure: the owner hears about it,
    // then it fails the run exactly as before.
    // REUSE THE GM MORNING'S 30 DAYS (2026-11-09). The GM morning ran this same window through the
    // engine at 7:01 and left what this job reads (lib/briefs/labor-scorecard freshLabor30). On the
    // scheduled run it is used when under 90 minutes old; a person's run (?force, ?preview, ?checks)
    // always recomputes, and so does any morning the GM morning did not build its Labor block.
    const handoff = !force && !preview && !checksOnly ? await freshLabor30(d30, yd) : null
    const ec30: any = handoff ? handoff.ec30 : await laborEconomics({ from: d30, to: yd, market: 'all' }).catch(async (e: any) => {
      if (!preview && !checksOnly) await emailIntegrityFailures([engineFailedCheck(e)], 1, d30, yd)
      throw e
    })
    const checks = handoff ? handoff.checks : integrityChecks(ec30, { ignoreNames: await integrityIgnoreNames() })
    if (checksOnly) return NextResponse.json({ ok: checks.every(c => c.ok), window: `${d30}..${yd}`, checks })

    const badAudit = ec30.payrollAudit && !ec30.payrollAudit.complete ? ec30.payrollAudit : null
    const failing = checks.filter(c => !c.ok)
    // ONE PLACE FOR THE OWNER TO READ IT (Jon, 2026-11-05). When this morning's GM morning carried the
    // Labor block, these failures were already in front of him; the separate email is the fallback.
    const shownInGm = await laborDeliveredToday(today)
    const integrity: { checks: number; failed: number; emailed: boolean; shownInGm: boolean; note?: string } = { checks: checks.length, failed: failing.length, emailed: false, shownInGm }
    if (!preview && failing.length) {
      if (shownInGm && !force) integrity.note = 'shown in the GM morning — not emailed separately'
      else {
        const g = force ? { send: true, why: 'forced' } : await shouldEmailIntegrity(failing, yd)
        integrity.note = g.why
        if (g.send) {
          integrity.emailed = await emailIntegrityFailures(failing, checks.length, d30, yd)
          if (integrity.emailed) await markIntegrityEmailed(failing, yd)
        }
      }
    }
    if (badAudit) {
      // NEVER QUIET-SKIP: the snapshot is withheld, and the run says why (the receipt carries it; the
      // GM morning or the integrity email above told the owner the payroll was partial).
      return NextResponse.json({
        ok: false, snapshotStored: false,
        reason: 'payroll incomplete — Homebase did not return timecards for: ' + (badAudit.failedWeeks || []).join(', '), integrity,
      }, { status: 503 })
    }

    // ── snapshot: the settled 30 days (shape unchanged — the planner reads this) ──────────────
    const K: any = ec30.kpi
    const snap: Snap = {
      from: d30, to: yd, takenAt: new Date().toISOString(),
      maintFrom: d30,
      cleans: K.housekeeping.cleans,
      cleaningRevenue: ec30.cleaningRevenue,
      hkRevenue: K.housekeeping.revenue,
      credited: ec30.feeAudit ? ec30.feeAudit.credited : 0,
      billable: K.maintenance.billable,
      payroll: K.allIn.payroll,
      margin: K.allIn.margin,
      costPerClean: K.housekeeping.costPerClean,
      hkPayroll: K.housekeeping.payroll,
      markets: (ec30.buckets || []).filter((b: any) => b.cleans > 0 || b.payroll > 0).map((b: any) => ({
        key: String(b.key), label: String(b.label), inHouse: !!b.inHouse,
        cleans: b.cleans, revenue: b.cleaningRevenue, payroll: b.payroll,
        costPerClean: b.laborCostPerClean, hoursPerClean: b.hoursPerClean,
        margin: b.margin, marginPct: b.marginPct,
      })),
    }
    if (preview) return NextResponse.json({ ok: true, preview: true, snapshot: snap, integrity })

    // Store AFTER a successful build so a failed run never poisons the next comparison.
    await setSetting('labor_trueup_snapshot', snap, 'cron').catch(() => null)
    // Staffing planner learning: record today's forward bookings so the planner can learn
    // last-minute pickup per lead time. Cheap, once a day.
    const forward = await storeForwardSnapshot().catch(() => null)
    return NextResponse.json({ ok: true, snapshotStored: true, forward, integrity, engine: handoff ? `reused the GM morning's 30 days (built ${handoff.at})` : 'ran' })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}

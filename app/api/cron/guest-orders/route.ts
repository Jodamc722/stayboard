// GUEST ORDERS CRON — every two hours. Two hops, both idempotent (plus the parking-permit
// retries, below):
//   1. links: every confirmed arrival inside the window gets its /order/<code> link, written into
//      the Guesty reservation custom field "Order form" (Guesty's own automation carries it on)
//   2. pushes: every PAID order whose delivery date has arrived becomes a Breezeway task on the
//      unit + Slack to the area housekeeping channel + the email digest
// Master switch: /users → App settings → Guest orders → Enabled. OFF = this route reports and
// does nothing, same contract as auto-inspections.
//
// BARE PATH ON PURPOSE (a Vercel cron with a query string never fires — see reservation-notices).
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron).
import { NextRequest, NextResponse } from 'next/server'
import { getGuestOrdersCfg, createDueLinks, pushDue } from '@/lib/guest-orders'
import { retryPendingGuestyWrites } from '@/lib/parking'
import { recordRun } from '@/lib/automation-runs'
import { requireCron } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
// 180 (was 120): the parking-permit retries now ride this line ahead of the two 50s passes.
export const maxDuration = 180

// PARKING PERMIT → GUESTY RETRIES ride this cron (2026-09-28; they were /api/cron/parking-guesty,
// a cron line of their own every 4 hours). The vendor upload stores a permit and then tries to
// write /permit/<token> onto the reservation; a write that missed is retried here — up to twenty
// Guesty reads + writes, usually none, and switched off with the parking settings' own
// writeToGuesty flag (lib/parking). It runs whether or not the guest-orders switch is on, and it
// keeps its own receipt name, so its history carries on unbroken.
async function retryParkingWrites(): Promise<any> {
  const t0 = Date.now()
  try {
    const r = await retryPendingGuestyWrites(20)
    await recordRun({ name: 'parking-guesty', ok: true, itemCount: r.ok, detail: r, ms: Date.now() - t0 })
    return { tried: r.tried, written: r.ok, errors: r.errors }
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300)
    await recordRun({ name: 'parking-guesty', ok: false, detail: { error: msg }, error: msg, ms: Date.now() - t0 })
    return { error: msg }
  }
}

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const started = Date.now()
  const parking = await retryParkingWrites()
  const cfg = await getGuestOrdersCfg()
  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'guest orders automation is off (App settings → Guest orders)', parking })
  const out: any = { ok: true, parking }
  try { out.links = await createDueLinks(cfg, 50_000) } catch (e: any) { out.links = { error: String(e?.message || e).slice(0, 200) } }
  try { out.pushes = await pushDue(cfg, 50_000) } catch (e: any) { out.pushes = { error: String(e?.message || e).slice(0, 200) } }
  out.ms = Date.now() - started
  recordRun({ name: 'guest-orders', ok: !out.links?.error && !out.pushes?.error, itemCount: (out.links?.created ?? 0) + (out.pushes?.pushed ?? 0) || undefined, detail: out, ms: out.ms, error: out.links?.error || out.pushes?.error || null })
  return NextResponse.json(out)
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

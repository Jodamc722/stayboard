// THROW THE MINIMUM-STAY SWITCH AT THE HOUR JON SET.
//
// Decides for itself whether this is the hour, in EASTERN time: Vercel crons run on UTC and do not
// shift with daylight saving. vercel.json fires HOURLY at :06 (2026-09-29), so every Eastern hour is
// reached all year under both offsets, and only the fire that lands on the configured open or close
// hour acts; every other fire answers "not a switch hour". The hours are whatever the panel set
// (cfg.openHour / cfg.closeHour) — the old schedule fired only at 7am and 6pm ET, so any other pair
// (today's is 7pm / 5am) could never run. runDirection is idempotent per Eastern day, so the
// repeated 1am hour of the November fall-back cannot write twice.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron).
import { NextRequest, NextResponse } from 'next/server'
import { readConfig, writeConfig, runDirection, hourET, todayET } from '@/lib/stay-window'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res

  const cfg = await readConfig()
  const hour = hourET()
  const today = todayET()

  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'schedule is off', hour, today })
  if (!cfg.listings.length) return NextResponse.json({ ok: true, skipped: 'no listings on the schedule', hour, today })

  // The configured Eastern hours decide; the hourly schedule reaches every one of them.
  const direction: 'open' | 'close' | null =
    hour === cfg.openHour ? 'open' : hour === cfg.closeHour ? 'close' : null

  if (!direction) {
    return NextResponse.json({ ok: true, skipped: 'not a switch hour', hour, openHour: cfg.openHour, closeHour: cfg.closeHour, today })
  }

  // runDirection is idempotent per Eastern day per direction, so a retry after a timeout or a double
  // fire inside the same hour does not write the same range twice.
  const { config, results } = await runDirection(cfg, direction, false)
  await writeConfig(config, 'cron')

  // HONEST OK: every listing that was supposed to switch did. A listing deliberately skipped (not
  // cleared for short stays) is not a failure; a Guesty refusal or a max-nights clash is.
  const writes = results.filter(r => !r.skipped)
  const failed = writes.filter(r => !r.ok)
  return NextResponse.json({
    ok: failed.length === 0, direction, hour, today,
    ran: results.length,
    written: writes.length - failed.length,
    unverified: writes.filter(r => r.ok && r.verified === false).length,
    error: failed.length
      ? (failed.length + ' of ' + writes.length + ' listing(s) did not switch: ' + failed.map(f => f.label + ' — ' + f.note).join('; ')).slice(0, 400)
      : undefined,
    results: results.map(r => ({ listing: r.label, minNights: r.minNights, ok: r.ok, verified: r.verified, skipped: !!r.skipped, note: r.note })),
  })
}

// RECEIPT (2026-09-28): the switch writes Guesty calendars for real listings, and until now a run
// that failed every write still answered ok:true and left no trace. Every fire is recorded.
const receipted = withRouteReceipt<NextRequest>('stay-window', run, { count: (b) => (typeof b.written === 'number' ? b.written : 0) })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }

// THROW THE MINIMUM-STAY SWITCH AT THE HOUR JON SET.
//
// Decides for itself whether this is the hour, in EASTERN time: Vercel crons run on UTC and do not
// shift with daylight saving, so a schedule pinned to one UTC offset silently stops matching every
// November and March. vercel.json fires at 03 past 11, 12, 22 and 23 UTC — BOTH UTC candidates for
// 7am and for 6pm Eastern — and only the fire that lands on the configured Eastern hour acts:
//   EDT (UTC−4): 11:03Z = 07:03 ET (close) · 22:03Z = 18:03 ET (open) · the other two are no-ops
//   EST (UTC−5): 12:03Z = 07:03 ET (close) · 23:03Z = 18:03 ET (open) · the other two are no-ops
// Until 2026-09-28 the schedule was `36 21,22,10,11`, which only reached 7am/6pm while New York was
// on EDT — from 2026-11-01 neither switch would ever have run and the calendar would have frozen on
// whichever minimum was written last. Same pattern as app/api/cron/ops-focus.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron).
import { NextRequest, NextResponse } from 'next/server'
import { readConfig, writeConfig, runDirection, hourET, todayET } from '@/lib/stay-window'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The only Eastern hours the vercel.json schedule reaches all year (see the header). */
const CRON_HOURS_ET = [7, 18]
const hourLabel = (h: number) => (h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm')

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res

  const cfg = await readConfig()
  const hour = hourET()
  const today = todayET()

  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'schedule is off', hour, today })
  if (!cfg.listings.length) return NextResponse.json({ ok: true, skipped: 'no listings on the schedule', hour, today })

  // An hour the schedule never reaches is a switch that never fires. Say so on every run rather
  // than skip quietly: the panel lets any hour be picked, the cron does not.
  const unreachable = [cfg.openHour, cfg.closeHour].filter(h => CRON_HOURS_ET.indexOf(h) < 0)
  const reason = unreachable.length
    ? 'The switch only runs at 7am and 6pm Eastern, so ' + unreachable.map(hourLabel).join(' and ') +
      ' will never fire — set the hours back to 6pm / 7am (or add those hours to vercel.json).'
    : undefined

  const direction: 'open' | 'close' | null =
    hour === cfg.openHour ? 'open' : hour === cfg.closeHour ? 'close' : null

  if (!direction) {
    return NextResponse.json({ ok: !reason, skipped: 'not a switch hour', reason, hour, openHour: cfg.openHour, closeHour: cfg.closeHour, today })
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

// THROW THE MINIMUM-STAY SWITCH AT THE HOUR JON SET.
//
// Fires HOURLY and decides for itself whether this is the hour. That is deliberate rather than two
// crons at 22:00 and 11:00 UTC: Vercel crons run on UTC and do not shift with daylight saving, so a
// schedule pinned to UTC silently slides an hour every March and November. The property's calendar
// is Eastern, so the hour is read in Eastern and the schedule stays where Jon put it all year.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
// Auth matches the other crons: enforce the bearer token when CRON_SECRET is set, otherwise run
// open so the schedule works without extra configuration.
import { NextRequest, NextResponse } from 'next/server'
import { readConfig, writeConfig, runDirection, hourET, todayET } from '@/lib/stay-window'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cfg = await readConfig()
  const hour = hourET()
  const today = todayET()

  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'schedule is off', hour, today })
  if (!cfg.listings.length) return NextResponse.json({ ok: true, skipped: 'no listings on the schedule', hour, today })

  const direction: 'open' | 'close' | null =
    hour === cfg.openHour ? 'open' : hour === cfg.closeHour ? 'close' : null

  if (!direction) {
    return NextResponse.json({ ok: true, skipped: 'not a switch hour', hour, openHour: cfg.openHour, closeHour: cfg.closeHour, today })
  }

  // runDirection is idempotent per Eastern day per direction, so a retry after a timeout or a double
  // fire inside the same hour does not write the same range twice.
  const { config, results } = await runDirection(cfg, direction, false)
  await writeConfig(config, 'cron')

  return NextResponse.json({
    ok: true, direction, hour, today,
    ran: results.length,
    results: results.map(r => ({ listing: r.label, minNights: r.minNights, ok: r.ok, verified: r.verified, note: r.note })),
  })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

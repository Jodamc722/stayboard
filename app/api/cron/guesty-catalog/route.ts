// LISTINGS + CUSTOM FIELDS, TWICE A DAY (2026-09-18).
//
// /api/sync/guesty used to run every two hours and re-sync reservations (already every 5 min),
// conversations (every 15), reviews (their own job) and messages — the same work three times over
// on a 60-second function that could not finish it. Listings and custom fields are the only
// entities nothing else syncs, so that is all the schedule asks for now. The manual "Sync now"
// button still runs the whole set through /api/sync/guesty.
import { NextRequest, NextResponse } from 'next/server'
import { runFullSync } from '@/lib/guesty'
import { requireCron, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { runChannelCheck } from '@/lib/channel-check'
import { runListingWatch } from '@/lib/listing-watch'
import { buildChannelHealth, type ChannelHealth } from '@/lib/channel-health'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  // The scheduler's bearer, or a signed-in admin. The x-vercel-cron header alone is spoofable and
  // is not accepted (probed anonymously 2026-09-18).
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  // Whoever the caller is, the catalog does not change by the minute.
  const skip = await tooSoon('guesty-catalog', 20)
  if (skip) return NextResponse.json({ ok: true, ...skip })
  const started = Date.now()
  const result = await runFullSync(false, { catalogOnly: true })
  recordRun({ name: 'guesty-catalog', ok: result.errors.length === 0, itemCount: result.listings + result.custom_fields, detail: result, error: result.errors.join('; ') || null, ms: Date.now() - started })
  // THE CHANNEL TRIGGER RIDES ON THIS SYNC (Jon, 2026-09-18). raw.integrations only changes when
  // the listings were just re-pulled, so this is the one moment a comparison with the last snapshot
  // can find anything. Never allowed to fail the sync.
  let channels: any = 'skipped — the listings did not sync, so there is nothing new to compare'
  // Built once and handed to both checks below: it is the slowest read of the two.
  let health: ChannelHealth | undefined
  if (result.listings > 0 || result.errors.length === 0) {
    health = await buildChannelHealth().catch(() => undefined)
    channels = await runChannelCheck(health ? { health } : undefined).catch((e: any) => ({ ok: false, error: String(e?.message || e).slice(0, 200) }))
  }
  // THE LISTING WATCH RIDES ON IT TOO (Jon, 2026-11-24): a cleaning fee or an Airbnb connection can only
  // have changed in what this sync just wrote. Here it speaks only about a listing that is new to a
  // list; the daily reminder is its own morning run (app/api/cron/listing-watch). Never fails the sync.
  let watch: any = 'skipped'
  if (result.listings > 0 || result.errors.length === 0) {
    watch = await runListingWatch({ by: 'guesty-catalog', health }).catch((e: any) => ({ ok: false, error: String(e?.message || e).slice(0, 200) }))
  }
  return NextResponse.json({ ok: true, scope: 'catalog', elapsed_ms: Date.now() - started, ...result, channels, watch })
}

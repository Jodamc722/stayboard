// LISTINGS + CUSTOM FIELDS, TWICE A DAY (2026-09-18).
//
// /api/sync/guesty used to run every two hours and re-sync reservations (already every 5 min),
// conversations (every 15), reviews (their own job) and messages — the same work three times over
// on a 60-second function that could not finish it. Listings and custom fields are the only
// entities nothing else syncs, so that is all the schedule asks for now. The manual "Sync now"
// button still runs the whole set through /api/sync/guesty.
import { NextRequest, NextResponse } from 'next/server'
import { runFullSync } from '@/lib/guesty'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { createClient } from '@/lib/supabase-server'
import { runChannelCheck } from '@/lib/channel-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  // CRON_SECRET is set on this project, so the scheduler always carries the bearer; the
  // x-vercel-cron header alone is spoofable and is not accepted (probed anonymously 2026-09-18).
  const allowed = cronAllowed(req).viaSecret
  if (!allowed) {
    try {
      const { data: { user } } = await createClient().auth.getUser()
      if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  // Whoever the caller is, the catalog does not change by the minute.
  const skip = await tooSoon('guesty-catalog', 20)
  if (skip) return NextResponse.json({ ok: true, ...skip })
  const started = Date.now()
  const result = await runFullSync(false, { catalogOnly: true })
  recordRun({ name: 'guesty-catalog', ok: result.errors.length === 0, itemCount: result.listings + result.custom_fields, detail: result, error: result.errors.join('; ') || null, ms: Date.now() - started })
  // THE CHANNEL TRIGGER RIDES ON THIS SYNC (Jon, 2026-09-18). raw.integrations only changes when
  // the listings were just re-pulled, so this is the one moment a comparison with the last snapshot
  // can find anything — and vercel.json is at its cron cap. Never allowed to fail the sync.
  let channels: any = 'skipped — the listings did not sync, so there is nothing new to compare'
  if (result.listings > 0 || result.errors.length === 0) {
    channels = await runChannelCheck().catch((e: any) => ({ ok: false, error: String(e?.message || e).slice(0, 200) }))
  }
  return NextResponse.json({ ok: true, scope: 'catalog', elapsed_ms: Date.now() - started, ...result, channels })
}

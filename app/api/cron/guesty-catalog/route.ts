// LISTINGS + CUSTOM FIELDS, TWICE A DAY (2026-09-18).
//
// /api/sync/guesty used to run every two hours and re-sync reservations (already every 5 min),
// conversations (every 15), reviews (their own job) and messages — the same work three times over
// on a 60-second function that could not finish it. Listings and custom fields are the only
// entities nothing else syncs, so that is all the schedule asks for now. The manual "Sync now"
// button still runs the whole set through /api/sync/guesty.
import { NextRequest, NextResponse } from 'next/server'
import { runFullSync } from '@/lib/guesty'
import { cronAllowed } from '@/lib/cron-auth'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const allowed = cronAllowed(req).ok || !!req.headers.get('x-vercel-cron')
  if (!allowed) {
    try {
      const { data: { user } } = await createClient().auth.getUser()
      if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    } catch { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  const started = Date.now()
  const result = await runFullSync(false, { catalogOnly: true })
  return NextResponse.json({ ok: true, scope: 'catalog', elapsed_ms: Date.now() - started, ...result })
}

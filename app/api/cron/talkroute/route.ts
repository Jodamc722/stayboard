// TALKROUTE BACKFILL — every 30 minutes (16 and 46 past; was every 15 until 2026-09-28). The
// webhook is the fast path; this is the one that never misses: calls (last sync − 1h), changed text
// threads, voicemails, and the matcher over all of it.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireCron } from '@/lib/cron-auth'
import { talkrouteConfigured } from '@/lib/talkroute'
import { syncTalkrouteAll } from '@/lib/talkroute-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
// 100s of budget under the 120s limit; the sync stops itself cleanly and resumes next run.

export async function GET(req: NextRequest) {
  const allowed = await requireCron(req)
  if (!allowed.ok) return allowed.res
  if (!(await talkrouteConfigured())) return NextResponse.json({ ok: true, skipped: 'not connected' })
  try {
    const r = await syncTalkrouteAll(supabaseAdmin(), { budgetMs: 100_000 })
    return NextResponse.json({ ok: r.errors.length === 0, ...r })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

// NIGHTLY CLOSE-OUT for the Calls desk (Jon, 2026-09-08: "if calls not completed same day, please
// close, incomplete").
//
// Runs once after midnight Eastern. Every welcome call whose grace period ended (arrival day over)
// and every post-checkout call past its 48 hours, with no completed outcome, gets an `incomplete`
// row in guest_calls — tier, scheduled day, attempts so far. That row is what makes "we closed 12
// mandatory calls incomplete this week" a fact the scoreboard can show, and what a person can be
// asked about, rather than a number that quietly reset each morning.
//
// It runs lib/call-desk's loadCallsDesk — the SAME engine the page renders from — and closes exactly
// the rows the page would have shown as Missed. No second definition of "due".
//
// Schedule: 05:30 UTC = 01:30 EDT / 00:30 EST, safely after midnight Eastern all year. Idempotent:
// rows already completed or already incomplete are never touched, so re-running is harmless.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cronAllowed } from '@/lib/cron-auth'
import { ymdET } from '@/lib/team-schedule'
import { closeOutCalls } from '@/lib/call-desk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const allowed = cronAllowed(req)
  if (!allowed.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const startedAt = Date.now()
  const today = ymdET(new Date())
  try {
    const sb = supabaseAdmin()
    const r = await closeOutCalls(sb, today)
    try {
      await sb.from('automation_runs').insert({ name: 'calls-closeout', ok: true, item_count: r.welcome + r.post, detail: r, ms: Date.now() - startedAt })
    } catch { /* ledger is best-effort */ }
    return NextResponse.json({ ok: true, today, ...r, ms: Date.now() - startedAt })
  } catch (e: any) {
    return NextResponse.json({ ok: false, today, error: String(e?.message || e).slice(0, 300), ms: Date.now() - startedAt }, { status: 500 })
  }
}

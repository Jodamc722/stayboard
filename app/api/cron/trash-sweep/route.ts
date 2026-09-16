// THE 60 DAYS ACTUALLY ELAPSING.
//
// Jon, 2026-09-16: "Deleted projects go to a trash section but take 60 days for permanent delete."
// A retention promise nothing enforces is not a policy, it is a column — the graveyard would grow
// forever and "60 days" would be a sentence in a comment. This is the part that makes it true.
//
// ONCE A DAY IS OFTEN ENOUGH, and deliberately so. Nothing here is urgent: a record one hour past
// its deadline is not a problem, and a sweep that runs constantly is a sweep that can delete a lot
// of things quickly if it is ever wrong. Slow and boring is the correct temperament for the only
// job in this app whose whole purpose is to destroy data.
//
// IT ONLY EVER TOUCHES RECORDS THAT ARE BOTH PAST THEIR DATE AND NOT RESTORED. A restored record
// keeps its row as history — it says what was deleted and that somebody put it back — and that
// history is not what the clock was ever about.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function sweep() {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  // Read before deleting so the run receipt can say WHAT went, not just how many. A number alone
  // is unauditable: "purged 14" tells nobody whether the right 14 went.
  const { data, error } = await db.from('deleted_records')
    .select('id,kind,label,deleted_at,purge_after')
    .is('restored_at', null)
    .lte('purge_after', now)
    .limit(500)
  if (error) return { ok: false, error: error.message }
  const rows = (data || []) as any[]
  if (!rows.length) return { ok: true, purged: 0, items: [] as any[] }

  const ids = rows.map(r => String(r.id))
  const { error: delErr } = await db.from('deleted_records').delete().in('id', ids)
  if (delErr) return { ok: false, error: delErr.message, found: rows.length }
  return {
    ok: true,
    purged: rows.length,
    items: rows.slice(0, 40).map(r => ({ kind: String(r.kind), label: String(r.label || ''), deleted_at: r.deleted_at })),
  }
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

async function run(req: NextRequest) {
  const allowed = cronAllowed(req)
  if (!allowed.ok) {
    // An Eve admin may run it by hand, the same as the other jobs — with CRON_SECRET set there is
    // otherwise no way to check that the sweep works without waiting a day to find out.
    const { eveGate } = await import('../../agent/route')
    const gate = await eveGate()
    if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!allowed.viaSecret) {
    const skip = await tooSoon('trash-sweep', 60)
    if (skip) return NextResponse.json({ ok: true, ...skip })
  }
  const out = await sweep()
  try {
    await recordRun({ name: 'trash-sweep', ok: !!out.ok, itemCount: Number((out as any).purged || 0), detail: out, error: (out as any).error || null })
  } catch { /* the sweep is what matters; the receipt is bookkeeping */ }
  return NextResponse.json(out, { status: out.ok ? 200 : 500 })
}

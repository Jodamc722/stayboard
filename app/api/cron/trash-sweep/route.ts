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
import { requireCron, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { getSetting } from '@/lib/app-settings'

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

// ── THE LOG PRUNE (2026-09-28, migration 131) — SHIPPED OFF ─────────────────────────────────────
// The app's log tables (run receipts, notifications, activity, the email log, Eve's watch fires and
// resolved audits, old sentiment rows, Telegram transcripts, raw Revenue App rows, AI usage) had no
// retention at all. prune_logs() in migration 131 holds the retention rules; this calls it table by
// table, so no single statement runs long. It ONLY runs when app_settings `housekeeping` has
// "prune": true — "prune": "dry" records what it would delete and deletes nothing. Off by default.
// Before migration 131 runs, it reports "not installed" and does nothing.
const PRUNE_TABLES = [
  'automation_runs', 'app_notifications', 'user_activity', 'email_log', 'eve_watch_fires',
  'eve_audits', 'guesty_conversation_sentiment', 'telegram_messages', 'rev_feed_row', 'ai_usage',
]
const PRUNE_BUDGET_MS = 40_000

async function prune(): Promise<{ mode?: string; skipped?: string; deleted?: number; errors?: number; counts?: Record<string, any> }> {
  const cfg = await getSetting<{ prune?: boolean | string }>('housekeeping', {})
  const mode = cfg && cfg.prune === true ? 'delete' : cfg && cfg.prune === 'dry' ? 'dry' : null
  if (!mode) return { skipped: 'off — app_settings housekeeping.prune is not set' }
  const db = supabaseAdmin()
  const t0 = Date.now()
  const counts: Record<string, any> = {}
  let errors = 0
  for (const table of PRUNE_TABLES) {
    if (Date.now() - t0 > PRUNE_BUDGET_MS) { counts[table] = 'deferred to tomorrow (out of time)'; continue }
    const { data, error } = await db.rpc('prune_logs', { dry_run: mode === 'dry', only_table: table })
    if (error) {
      // The function is not there yet: migration 131 has not been run. Nothing to do.
      if (/PGRST202|42883/.test(String(error.code || '')) || /prune_logs/i.test(String(error.message || ''))) {
        return { mode, skipped: 'not installed — run supabase/migrations/131_ops_housekeeping.sql' }
      }
      counts[table] = 'error: ' + String(error.message || error).slice(0, 120)
      errors++
      continue
    }
    if (data && typeof data === 'object') Object.assign(counts, data)
  }
  let deleted = 0
  for (const k of Object.keys(counts)) if (typeof counts[k] === 'number') deleted += counts[k]
  return { mode, deleted, errors, counts }
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

async function run(req: NextRequest) {
  // The scheduler's bearer, or an Eve admin by hand — with CRON_SECRET set there is otherwise no
  // way to check that the sweep works without waiting a day to find out.
  const allowed = await requireCron(req, { fallback: async () => (await import('../../agent/route')).eveGate() })
  if (!allowed.ok) return allowed.res
  if (!allowed.viaSecret) {
    const skip = await tooSoon('trash-sweep', 60)
    if (skip) return NextResponse.json({ ok: true, ...skip })
  }
  const swept: any = await sweep()
  // The prune never blocks or fails the trash sweep it rides on; a prune error is reported on the
  // same receipt, which is where its counts live.
  let pruned: any
  try { pruned = await prune() } catch (e: any) { pruned = { errors: 1, error: String(e?.message || e).slice(0, 200) } }
  const ok = !!swept.ok && !(pruned && pruned.errors)
  const out = { ...swept, ok, prune: pruned }
  try {
    const err = swept.error || (pruned && pruned.errors ? 'log prune: ' + (pruned.error || pruned.errors + ' table(s) failed') : null)
    await recordRun({ name: 'trash-sweep', ok, itemCount: Number(swept.purged || 0), detail: out, error: err })
  } catch { /* the sweep is what matters; the receipt is bookkeeping */ }
  return NextResponse.json(out, { status: swept.ok ? 200 : 500 })
}

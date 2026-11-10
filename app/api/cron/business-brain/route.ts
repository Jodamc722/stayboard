// THE BUSINESS BRAIN, NIGHTLY (06:53 UTC — about 2am Eastern, an hour no other daily job uses).
//
// Rebuilds the nightly layer of migration 178 (lib/brain/run): the entity spine, fact_unit_day for
// every calendar month touching the last 45 days, vendor_xref, fact_maintenance_event, today's
// unit_health_daily, owner_month / vendor_month — then spends what time is left walking
// fact_unit_day backwards a month at a time to 400 days (a cursor in
// app_settings, so a long backfill resumes on the next run; an admin may also press it again).
//
// UNTIL MIGRATION 178 HAS RUN this answers { ok: true, skipped: 'tables missing — run migration 178' }
// and touches nothing.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path with a query string never fires.
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron).
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { runBrain } from '@/lib/brain/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const t0 = Date.now()
  // 250s of the 300: the last upsert, the state write and the receipt need the rest.
  const deadline = t0 + 250_000
  try {
    const r = await runBrain({ deadline, by: gate.access ? gate.access.email : 'cron' })
    // Tables not there yet: say so and leave no trace — not even a receipt. Nothing ran.
    if (r.skipped) return NextResponse.json(r)
    // The receipt carries what the Learning tab and /api/brain/status need: rows and the partial
    // flag per table, and where the backfill stands.
    const detail: Record<string, any> = {
      tables: Object.fromEntries(Object.keys(r.tables).map(k => [k, { rows: r.tables[k].rows, partial: r.tables[k].partial, ...(r.tables[k].error ? { error: r.tables[k].error } : {}), ...(r.tables[k].note ? { note: String(r.tables[k].note).slice(0, 600) } : {}) }])),
      backfill: r.backfill,
    }
    await recordRun({ name: 'business-brain', ok: r.ok, itemCount: r.count, detail, error: r.error || null, ms: Date.now() - t0 })
    return NextResponse.json(r, { status: r.ok ? 200 : 500 })
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 300)
    await recordRun({ name: 'business-brain', ok: false, error, ms: Date.now() - t0 })
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}
export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

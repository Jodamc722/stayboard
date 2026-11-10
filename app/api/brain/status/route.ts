// IS THE BUSINESS BRAIN WORKING? (admin, read-only)
//
// One answer for the owner after migration 178: which tables exist, when the nightly build last
// ran and what it wrote, how many rows each table holds, where the 400-day backfill stands, and
// the ten apartments with the lowest health score today — each with the reasons it lost points.
// Before the migration has run this says so and lists what is missing; it never errors for that.
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { lastRuns } from '@/lib/automation-runs'
import { brainTables, BRAIN_MIGRATION, BRAIN_TABLES } from '@/lib/brain/shared'
import { getBrainState, BACKFILL_DAYS, NIGHTLY_DAYS } from '@/lib/brain/run'
import { HEALTH_FORMULA } from '@/lib/brain/health'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  try {
    const db = supabaseAdmin()
    const presence = await brainTables()
    const ready = presence.missing.length === 0

    // Row counts and the newest build stamp, per table that exists.
    const counts: Record<string, { rows: number | null; lastBuiltAt: string | null }> = {}
    await Promise.all(presence.present.map(async (t) => {
      let rows: number | null = null
      let lastBuiltAt: string | null = null
      try {
        const c = await db.from(t).select('built_at', { count: 'exact', head: true })
        rows = !c.error && typeof c.count === 'number' ? c.count : null
      } catch { rows = null }
      try {
        const { data } = await db.from(t).select('built_at').order('built_at', { ascending: false }).limit(1)
        const v = ((data || []) as any[])[0]?.built_at
        lastBuiltAt = v ? String(v) : null
      } catch { lastBuiltAt = null }
      counts[t] = { rows, lastBuiltAt }
    }))

    const [state, runs] = await Promise.all([
      getBrainState(),
      lastRuns(['business-brain']).catch(() => ({} as Record<string, any>)),
    ])

    // The ten lowest health scores on the newest day built.
    let worst: any[] = []
    let healthDay: string | null = null
    if (presence.present.indexOf('unit_health_daily') >= 0) {
      try {
        const { data: d } = await db.from('unit_health_daily').select('day').order('day', { ascending: false }).limit(1)
        healthDay = ((d || []) as any[])[0]?.day ? String((d as any[])[0].day).slice(0, 10) : null
        if (healthDay) {
          const { data } = await db.from('unit_health_daily')
            .select('physical_unit_id,listing_id,nickname,building_id,market,score,band,drivers,review_avg_live,review_n,low_reviews_90d,glitches_90d,glitches_per_100_nights,repeat_systems,pm_overdue_count,pm_max_days_late,last_inspection_pass,upkeep_cost_pct_rev,partial')
            .eq('day', healthDay).not('score', 'is', null)
            .order('score', { ascending: true }).order('physical_unit_id').limit(10)
          worst = (data || []) as any[]
        }
      } catch { worst = [] }
    }

    return NextResponse.json({
      ok: true,
      ready,
      migration: BRAIN_MIGRATION,
      ...(ready ? {} : { note: 'tables missing — run migration 178', missing: presence.missing }),
      tables: BRAIN_TABLES.map(t => ({
        table: t,
        present: presence.present.indexOf(t) >= 0,
        rows: counts[t] ? counts[t].rows : null,
        lastBuiltAt: counts[t] ? counts[t].lastBuiltAt : null,
        lastRun: state.tables && state.tables[t] ? state.tables[t] : null,
        ...(presence.errors[t] ? { error: presence.errors[t] } : {}),
      })),
      lastBuild: { at: state.lastRunAt, ok: state.lastOk, receipt: runs['business-brain'] || null },
      backfill: {
        backfilledTo: state.backfilledTo, done: state.backfillDone, rollupsBackfilled: state.rollupsBackfilled === true,
        targetDays: BACKFILL_DAYS, nightlyDays: NIGHTLY_DAYS,
      },
      health: { day: healthDay, formula: HEALTH_FORMULA, worst },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

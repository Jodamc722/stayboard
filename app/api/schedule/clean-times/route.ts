// HOW LONG THIS UNIT ACTUALLY TAKES (Jon, 2026-09-23: "I don't think how you calculate hours per
// turn is correct").
//
// The suggester started from the bedroom standards in lib/capacity. A unit that has been cleaned
// before has a better answer: its own Breezeway timer. This returns, per listing, the median of its
// last eight finished departure cleans over the past 120 days, once there are at least three. A
// median, not a mean, because one forgotten stop button makes a 9-hour clean.
//
// GET ?ids=<listingId>,<listingId>…   →   { ok, times: { [listingId]: { minutes, n } } }
import { NextRequest, NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDepartureCleanName } from '@/lib/breezeway'
import { PERFORMED_FLOOR_MIN } from '@/lib/capacity'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MIN_SAMPLE = 3
const KEEP = 8

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const ids = Array.from(new Set(String(new URL(req.url).searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean))).slice(0, 300)
  if (!ids.length) return NextResponse.json({ ok: true, times: {} })
  const since = new Date(Date.now() - 120 * 86400_000).toISOString()
  const db = supabaseAdmin()
  const by: Record<string, number[]> = {}
  for (let i = 0; i < ids.length; i += 100) {
    // PAGED, newest first (2026-09-28). `.limit(3000)` was capped at 1,000 rows by PostgREST, which
    // across 100 units and every timed task kind could stop short of a unit's last eight cleans.
    const got = await pageRows<any>((a, b) => db.from('breezeway_tasks_sync').select('id,reference_property_id,name,total_minutes,finished_at')
      .in('reference_property_id', ids.slice(i, i + 100)).gte('finished_at', since).gt('total_minutes', 0)
      .order('finished_at', { ascending: false }).order('id').range(a, b), 6)
    // A read that failed outright is an error; one that ran long only lost its OLDEST rows, and the
    // median is taken over each unit's newest eight.
    if (got.truncated && !got.rows.length) return NextResponse.json({ ok: false, error: 'could not read clean times' }, { status: 500 })
    for (const t of got.rows) {
      if (!isDepartureCleanName(t.name)) continue
      const m = Number(t.total_minutes)
      // THE HOUR FLOOR (audit 2026-09-28). This accepted 20–59 minute "cleans", which lib/capacity
      // shows are close-outs, not cleans performed (23% of timed cleans). They made units look fast
      // and the popup over-filled days. Same floor as the capacity model: under an hour was closed
      // out on somebody's behalf. Over eight hours, a timer was left running.
      if (!Number.isFinite(m) || m < PERFORMED_FLOOR_MIN || m > 480) continue
      const k = String(t.reference_property_id)
      const arr = (by[k] = by[k] || [])
      if (arr.length < KEEP) arr.push(m)
    }
  }
  const times: Record<string, { minutes: number; n: number }> = {}
  for (const [k, arr] of Object.entries(by)) {
    if (arr.length < MIN_SAMPLE) continue
    const s = arr.slice().sort((a, b) => a - b)
    const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    times[k] = { minutes: Math.round(mid), n: arr.length }
  }
  return NextResponse.json({ ok: true, times })
}

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
import { requireUser } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDepartureCleanName } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MIN_SAMPLE = 3
const KEEP = 8

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const ids = Array.from(new Set(String(new URL(req.url).searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean))).slice(0, 300)
  if (!ids.length) return NextResponse.json({ ok: true, times: {} })
  const since = new Date(Date.now() - 120 * 86400_000).toISOString()
  const db = supabaseAdmin()
  const by: Record<string, number[]> = {}
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('breezeway_tasks_sync').select('reference_property_id,name,total_minutes,finished_at')
      .in('reference_property_id', ids.slice(i, i + 100)).gte('finished_at', since).gt('total_minutes', 0)
      .order('finished_at', { ascending: false }).limit(3000)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    for (const t of (data as any[]) || []) {
      if (!isDepartureCleanName(t.name)) continue
      const m = Number(t.total_minutes)
      if (!Number.isFinite(m) || m < 20 || m > 480) continue   // a timer left running is not a clean
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

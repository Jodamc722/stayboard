// AI USAGE — what the model calls cost, from the ai_usage ledger (lib/ai-usage). Admins read.
//   GET ?days=30 -> { ok, days, total: {...}, byTask: {[task]: {...}}, byDay: [{day, usd, calls}], byModel: {...}, last7Usd, projectedMonthUsd }
// Each {...} is { calls, usd, input, output, cacheRead, cacheWrite, errors, avgMs }.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

type Agg = { calls: number; usd: number; input: number; output: number; cacheRead: number; cacheWrite: number; errors: number; ms: number; avgMs: number }
const blank = (): Agg => ({ calls: 0, usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, errors: 0, ms: 0, avgMs: 0 })
function add(a: Agg, r: any) {
  a.calls++; a.usd += Number(r.cost_usd) || 0
  a.input += r.input_tokens || 0; a.output += r.output_tokens || 0
  a.cacheRead += r.cache_read || 0; a.cacheWrite += r.cache_write || 0
  if (r.ok === false) a.errors++
  a.ms += r.ms || 0
}
function finish(a: Agg) { a.avgMs = a.calls ? Math.round(a.ms / a.calls) : 0; a.usd = Number(a.usd.toFixed(4)); return a }

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 30))
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const db = supabaseAdmin()
  const rows: any[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('ai_usage')
      .select('at,task,model,input_tokens,output_tokens,cache_read,cache_write,cost_usd,ms,ok')
      .gte('at', since).order('at', { ascending: false }).range(from, from + PAGE - 1)
    if (error) {
      // Table not created yet (migration 097 not run) reads as "no data" with a hint, not a 500.
      if (/ai_usage/.test(error.message)) return NextResponse.json({ ok: true, days, missing: true, total: finish(blank()), byTask: {}, byDay: [], byModel: {}, last7Usd: 0, projectedMonthUsd: 0 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    rows.push(...(data || []))
    if (!data || data.length < PAGE || rows.length >= 50_000) break
  }

  const total = blank(); const byTask: Record<string, Agg> = {}; const byModel: Record<string, Agg> = {}
  const dayMap: Record<string, { usd: number; calls: number }> = {}
  const sevenAgo = Date.now() - 7 * 86400_000
  let last7Usd = 0
  for (const r of rows) {
    add(total, r)
    ;(byTask[r.task] ||= blank()); add(byTask[r.task], r)
    ;(byModel[r.model || '?'] ||= blank()); add(byModel[r.model || '?'], r)
    const day = String(r.at).slice(0, 10)
    ;(dayMap[day] ||= { usd: 0, calls: 0 }); dayMap[day].usd += Number(r.cost_usd) || 0; dayMap[day].calls++
    if (new Date(r.at).getTime() >= sevenAgo) last7Usd += Number(r.cost_usd) || 0
  }
  // Fill every day in the window so the bar chart has no gaps.
  const byDay: { day: string; usd: number; calls: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    const d = dayMap[day] || { usd: 0, calls: 0 }
    byDay.push({ day, usd: Number(d.usd.toFixed(4)), calls: d.calls })
  }
  for (const k of Object.keys(byTask)) finish(byTask[k])
  for (const k of Object.keys(byModel)) finish(byModel[k])
  // Projection: the last 7 days' daily average × 30. Honest only once a week of rows exists.
  const daysWithData = Math.min(7, Object.keys(dayMap).filter(d => new Date(d).getTime() >= sevenAgo - 86400_000).length)
  const projectedMonthUsd = daysWithData ? Number(((last7Usd / daysWithData) * 30).toFixed(2)) : 0

  return NextResponse.json({ ok: true, days, total: finish(total), byTask, byDay, byModel, last7Usd: Number(last7Usd.toFixed(4)), projectedMonthUsd, daysWithData })
}

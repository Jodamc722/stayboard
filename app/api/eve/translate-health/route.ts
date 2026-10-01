// IS THE TRANSLATION WORKING? (Jon, 2026-10-01: "the translations not always working … Make sure
// it works 100% of the time.") Every tag-at-the-end writes a receipt (automation_runs,
// 'slack-translate'); this lists them with their outcome, so the question is answered from the
// record. GET ?days=7 (default 7, max 60) — admins who may use Eve.
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { supabaseAdmin } from '@/lib/supabase-admin'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await eveGate()
  if (!g.ok) return g.res
  const days = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get('days') || 7)))
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const { data, error } = await supabaseAdmin().from('automation_runs').select('ran_at,ok,ms,item_count,error,detail').eq('name', 'slack-translate').gte('ran_at', since).order('ran_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const rows = (data || []) as any[]
  const by: Record<string, number> = {}
  for (const r of rows) { const o = String(r.detail?.outcome || (r.ok ? 'ok' : 'failed')); by[o] = (by[o] || 0) + 1 }
  const slow = rows.filter(r => Number(r.ms) > 20000).length
  return NextResponse.json({ ok: true, days, total: rows.length, outcomes: by, slowOver20s: slow,
    failures: rows.filter(r => !r.ok).slice(0, 60).map(r => ({ at: r.ran_at, ms: r.ms, error: r.error, detail: r.detail })),
    recent: rows.slice(0, 40).map(r => ({ at: r.ran_at, ok: r.ok, ms: r.ms, outcome: r.detail?.outcome, chars: r.detail?.chars, channel: r.detail?.channel, retry: r.detail?.retry })) })
}

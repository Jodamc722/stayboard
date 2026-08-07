// app/api/labor/settings/route.ts
//   GET  -> all rows (default + per market)
//   POST -> upsert one market's settings  { market, pct_good, ... }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAllLaborSettings } from '@/lib/labor-settings'

export const dynamic = 'force-dynamic'

const NUM_FIELDS = ['pct_good', 'pct_bad', 'grace_min', 'over_sched_min', 'ot_weekly_hours', 'attribution_min'] as const

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, settings: await getAllLaborSettings() })
}

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const market = String(body?.market || '').toLowerCase().trim()
  if (!market) return NextResponse.json({ error: 'market is required' }, { status: 400 })

  const row: any = { market, updated_at: new Date().toISOString(), updated_by: user.email || user.id }
  for (const f of NUM_FIELDS) {
    if (body[f] == null) continue
    const n = Number(body[f])
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `invalid ${f}` }, { status: 400 })
    row[f] = n
  }
  if (row.pct_good != null && row.pct_bad != null && row.pct_good > row.pct_bad)
    return NextResponse.json({ error: 'pct_good must be ≤ pct_bad' }, { status: 400 })

  const sb = supabaseAdmin()
  const { error } = await sb.from('labor_settings').upsert(row, { onConflict: 'market' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

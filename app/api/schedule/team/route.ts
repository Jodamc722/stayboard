import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Weekly team schedule (status cards per person/day) persisted per week_start + market.
// Shifts live in Homebase; this stores who is Working / On Call / OFF / REQ OFF for the week.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('weekStart') || ''
  const market = searchParams.get('market') || ''
  if (!weekStart || !market) {
    return NextResponse.json({ ok: false, error: 'weekStart and market required' }, { status: 400 })
  }
  const sb = supabaseAdmin()
  const { data, error } = await sb
    .from('team_schedule')
    .select('doc, updated_at, share_token')
    .eq('week_start', weekStart)
    .eq('market', market)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({
    ok: true,
    doc: data?.doc ?? null,
    updatedAt: data?.updated_at ?? null,
    shareToken: data?.share_token ?? null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || !body.weekStart || !body.market) {
    return NextResponse.json({ ok: false, error: 'weekStart and market required' }, { status: 400 })
  }
  const sb = supabaseAdmin()
  const row: Record<string, unknown> = {
    week_start: String(body.weekStart),
    market: String(body.market),
    doc: body.doc ?? {},
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await sb
    .from('team_schedule')
    .upsert(row, { onConflict: 'week_start,market' })
    .select('updated_at')
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updatedAt: data?.updated_at ?? row.updated_at })
}

// Owner budgets. GET ?building=&year= -> 12 month rows (missing months as nulls).
// PUT { building, year, months: [{month, occupancy_pct, adr, revpar, gross_revenue}] } upserts.
// GET ?buildings=1 -> rollup building names for the picker.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupBuilding } from '@/lib/optimize-score'

export const dynamic = 'force-dynamic'

async function requireUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const db = supabaseAdmin()

  if (sp.get('buildings')) {
    const { data } = await db.from('guesty_listings').select('building').not('building', 'is', null).limit(2000)
    const names: string[] = []
    for (const r of (data || []) as any[]) {
      const b = rollupBuilding(String(r.building || '').trim())
      if (b && b !== 'Unassigned' && names.indexOf(b) < 0) names.push(b)
    }
    names.sort((a, b) => a.localeCompare(b))
    return NextResponse.json({ ok: true, buildings: names })
  }

  const building = sp.get('building') || ''
  const year = Number(sp.get('year') || new Date().getFullYear())
  if (!building) return NextResponse.json({ error: 'building required' }, { status: 400 })
  const { data, error } = await db
    .from('owner_budgets')
    .select('month, occupancy_pct, adr, revpar, gross_revenue')
    .eq('building_key', building)
    .eq('year', year)
  if (error) return NextResponse.json({ error: error.message + ' (run supabase/migrations/011_owner_reports.sql first?)' }, { status: 500 })
  const byMonth: Record<number, any> = {}
  for (const r of (data || []) as any[]) byMonth[Number(r.month)] = r
  const months = []
  for (let m = 1; m <= 12; m++) {
    const r = byMonth[m] || {}
    months.push({
      month: m,
      occupancy_pct: r.occupancy_pct ?? null,
      adr: r.adr ?? null,
      revpar: r.revpar ?? null,
      gross_revenue: r.gross_revenue ?? null,
    })
  }
  return NextResponse.json({ ok: true, building, year, months })
}

export async function PUT(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const building = typeof body?.building === 'string' ? body.building.trim() : ''
  const year = Number(body?.year)
  const monthsIn: any[] = Array.isArray(body?.months) ? body.months : []
  if (!building || !Number.isFinite(year) || year < 2020 || year > 2040) {
    return NextResponse.json({ error: 'building + year required' }, { status: 400 })
  }
  const rows = []
  for (const m of monthsIn) {
    const month = Number(m?.month)
    if (!Number.isFinite(month) || month < 1 || month > 12) continue
    rows.push({
      building_key: building, year, month,
      occupancy_pct: numOrNull(m?.occupancy_pct),
      adr: numOrNull(m?.adr),
      revpar: numOrNull(m?.revpar),
      gross_revenue: numOrNull(m?.gross_revenue),
      updated_at: new Date().toISOString(),
    })
  }
  if (!rows.length) return NextResponse.json({ error: 'no month rows' }, { status: 400 })
  const { error } = await supabaseAdmin().from('owner_budgets').upsert(rows, { onConflict: 'building_key,year,month' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, saved: rows.length })
}

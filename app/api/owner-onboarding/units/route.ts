// The properties and units to attach an onboarding link to: the buildings and listings in Guesty.
//   GET ?q=<words> → up to 30 units (building, unit, nickname, listing id)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  const q = String(req.nextUrl.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60)
  const { data } = await supabaseAdmin().from('guesty_listings').select('id, nickname, building, unit, status').limit(2000)
  const rows = ((data || []) as any[]).map(r => ({ id: String(r.id), building: String(r.building || ''), unit: String(r.unit || ''), nickname: String(r.nickname || ''), active: r.status !== 'inactive' }))
  const words = q.split(/\s+/).filter(Boolean)
  const hits = rows.filter(r => words.every(w => (r.building + ' ' + r.unit + ' ' + r.nickname).toLowerCase().includes(w)))
  const buildings = Array.from(new Set(rows.map(r => r.building).filter(Boolean))).sort()
  return NextResponse.json({ ok: true, units: hits.slice(0, 30), buildings })
}

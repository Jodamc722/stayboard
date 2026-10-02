// QUICK ONBOARDING API (lib/onboarding-quick). Signed in, feature `onboarding`.
//   GET                                   → every unit, newest building first
//   POST { action:'create', building, unit_no, from?: id }   → a unit (copied from another when `from`)
//   POST { action:'save', id, building?, unit_no?, data?, status? }
//   POST { action:'delete', id }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normData, EMPTY_DATA } from '@/lib/onboarding-quick'
export const dynamic = 'force-dynamic'
const MISSING = 'Quick onboarding needs migration 142 (onboarding_quick) — run it in Supabase and reload.'
const missing = (m: any) => /relation|schema cache|find the table|does not exist/i.test(String(m || ''))
const str = (v: any, n = 80) => String(v ?? '').trim().slice(0, n)

export async function GET() {
  const g = await requireLevel('onboarding', 'view')
  if (!g.ok) return g.res
  const { data, error } = await supabaseAdmin().from('onboarding_quick').select('*').order('building').order('unit_no').limit(1000)
  if (error) return NextResponse.json({ ok: false, error: missing(error.message) ? MISSING : error.message }, { status: 500 })
  return NextResponse.json({ ok: true, units: (data || []).map(u => ({ ...u, data: normData(u.data) })) })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('onboarding', 'edit')
  if (!g.ok) return g.res
  const by = String(g.access.email || '')
  const b = await req.json().catch(() => ({} as any))
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  try {
    if (b.action === 'create') {
      const building = str(b.building), unit_no = str(b.unit_no, 40)
      if (!building || !unit_no) return NextResponse.json({ ok: false, error: 'Building and unit number, please.' }, { status: 400 })
      let data = EMPTY_DATA
      if (b.from) { const { data: src } = await db.from('onboarding_quick').select('data').eq('id', String(b.from)).maybeSingle(); if (src) data = { ...normData(src.data), photos: [] } }   // a copy keeps the answers, not the photos
      const { data: row, error } = await db.from('onboarding_quick').insert({ building, unit_no, data, created_by: by, updated_by: by }).select('*').single()
      if (error) return NextResponse.json({ ok: false, error: missing(error.message) ? MISSING : error.message }, { status: 500 })
      return NextResponse.json({ ok: true, unit: { ...row, data: normData(row.data) } })
    }
    if (b.action === 'save') {
      const id = str(b.id)
      if (!id) return NextResponse.json({ ok: false, error: 'Which unit?' }, { status: 400 })
      const patch: any = { updated_at: now, updated_by: by }
      if (b.building !== undefined) patch.building = str(b.building)
      if (b.unit_no !== undefined) patch.unit_no = str(b.unit_no, 40)
      if (b.data !== undefined) patch.data = normData(b.data)
      if (b.status === 'draft' || b.status === 'done') patch.status = b.status
      if (b.listing_id !== undefined) patch.listing_id = str(b.listing_id) || null
      const { data: row, error } = await db.from('onboarding_quick').update(patch).eq('id', id).select('*').single()
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, unit: { ...row, data: normData(row.data) } })
    }
    if (b.action === 'delete') {
      const { error } = await db.from('onboarding_quick').delete().eq('id', str(b.id))
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }) }
}

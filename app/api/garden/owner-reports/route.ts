// GARDEN HOTEL OWNER REPORTS — build, save, narrate, finalise.
//   GET                        → { reports } (newest first)     GET ?period=YYYY-MM → one, with data
//   POST { op: 'build', period, narrate? } | { op: 'status', period, status } | { op: 'narrative', period, narrative }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveOwnerReport } from '@/lib/garden/owner-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireLevel('garden', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const period = req.nextUrl.searchParams.get('period')
  try {
    if (period) { const { data } = await db.from('garden_owner_reports').select('*').eq('period', period).maybeSingle(); return NextResponse.json({ ok: true, report: data }) }
    const { data, error } = await db.from('garden_owner_reports').select('id,period,title,status,share_code,created_at,updated_at,sent_at,narrative').order('period', { ascending: false }).limit(36)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, reports: data || [] })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('garden', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const period = String(b?.period || '')
  if (!/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: 'period YYYY-MM required' }, { status: 400 })
  const db = supabaseAdmin()
  const op = String(b?.op || 'build')
  try {
    if (op === 'build') return NextResponse.json({ ok: true, report: await saveOwnerReport(period, gate.access.email || 'someone', { narrate: b?.narrate !== false }) })
    if (op === 'status') { const st = ['draft', 'final', 'sent'].includes(b?.status) ? b.status : 'draft'; await db.from('garden_owner_reports').update({ status: st, sent_at: st === 'sent' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('period', period); return NextResponse.json({ ok: true }) }
    if (op === 'narrative') { await db.from('garden_owner_reports').update({ narrative: String(b?.narrative || '').slice(0, 6000), updated_at: new Date().toISOString() }).eq('period', period); return NextResponse.json({ ok: true }) }
  } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 500 }) }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}

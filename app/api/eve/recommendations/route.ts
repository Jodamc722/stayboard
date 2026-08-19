// The recommendation ledger, for the /eve Direction tab.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { decideRecommendation, gradeDue, scorecard, createRecommendation } from '@/lib/eve/recommendations'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const db = supabaseAdmin()
  let q = db.from('eve_recommendations').select('*').order('created_at', { ascending: false }).limit(200)
  const status = sp.get('status')
  if (status && status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, needsMigration: true, error: 'eve_recommendations not found — run migration 046.', recommendations: [] })
  return NextResponse.json({ ok: true, recommendations: data || [], scorecard: await scorecard() })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const actor = String(gate.access.email || '')

  if (body?.op === 'decide') {
    const status = ['accepted', 'rejected', 'superseded'].indexOf(String(body?.status)) >= 0 ? String(body.status) : null
    if (!status || !body?.id) return NextResponse.json({ error: 'id and a valid status are required' }, { status: 400 })
    const r = await decideRecommendation(String(body.id), status as any, actor, body?.note)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (body?.op === 'grade-now') {
    return NextResponse.json({ ok: true, ...(await gradeDue(40)) })
  }
  // Manual entry — Jon writing his own directive and letting it be graded on the same terms.
  const res = await createRecommendation({ ...body, created_by: actor, source: 'chat' })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, id: res.id })
}

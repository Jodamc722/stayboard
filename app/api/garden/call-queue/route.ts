// GARDEN HOTEL CALL QUEUE — what the desk owes each guest.
//   GET  ?status=pending|done|skipped|expired&days=3&script=<reservationId>
//   POST { op: 'rebuild' } | { op: 'skip' | 'done' | 'reopen', id, note? } | { op: 'assign', id, to }
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callQueue, buildCallQueue, welcomeScript } from '@/lib/garden/call-desk'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireGarden('calls', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  try {
    if (sp.get('script')) return NextResponse.json({ ok: true, script: await welcomeScript(String(sp.get('script'))) })
    return NextResponse.json({ ok: true, queue: await callQueue({ status: sp.get('status') || 'pending', days: Number(sp.get('days')) || 3 }) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('calls', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const by = gate.access.email || 'someone'
  const db = supabaseAdmin()
  const op = String(b?.op || '')
  if (op === 'rebuild') return NextResponse.json({ ok: true, ...(await buildCallQueue()) })
  const id = String(b?.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const now = new Date().toISOString()
  const patch = op === 'skip' ? { status: 'skipped', done_at: now, done_by: by, note: b?.note ? String(b.note).slice(0, 300) : 'skipped' }
    : op === 'done' ? { status: 'done', done_at: now, done_by: by, last_outcome: 'reached', note: b?.note ? String(b.note).slice(0, 300) : null }
    : op === 'reopen' ? { status: 'pending', done_at: null, done_by: null }
    : op === 'assign' ? { assigned_to: b?.to ? String(b.to).slice(0, 80) : null } : null
  if (!patch) return NextResponse.json({ error: 'unknown op' }, { status: 400 })
  const { error } = await db.from('garden_call_queue').update(patch).eq('id', id)
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
}

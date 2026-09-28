// GARDEN HOTEL CALLS & VERIFICATIONS — the front-desk log behind the Calls tab and its reports.
//
//   POST { type: 'call',         reservationId?, guestName?, kind, outcome, note?, durationMin? }
//   POST { type: 'verification', reservationId, kind: id|card|deposit|agreement|age, status: passed|failed|waived|pending, note? }
//
// A call is an attempt (one row each, never edited); a verification is one status per
// reservation per kind (upserted), so the tab can say "ID ✓ · card pending" on a single line.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const CALL_KINDS = ['pre_arrival', 'welcome', 'verification', 'post_stay', 'other']
const OUTCOMES = ['reached', 'voicemail', 'no_answer', 'wrong_number', 'declined']
const VER_KINDS = ['id', 'card', 'deposit', 'agreement', 'age']
const VER_STATUS = ['pending', 'passed', 'failed', 'waived']

export async function POST(req: NextRequest) {
  const gate = await requireLevel('garden', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const db = supabaseAdmin()
  const by = gate.access.email || null
  const resId = b?.reservationId ? String(b.reservationId) : null
  if (resId) { const { data } = await db.from('garden_reservations').select('id').eq('id', resId).maybeSingle(); if (!data) return NextResponse.json({ error: 'reservation not found' }, { status: 404 }) }

  if (b?.type === 'verification') {
    const kind = String(b?.kind || ''), status = String(b?.status || 'pending')
    if (!resId) return NextResponse.json({ error: 'reservationId required' }, { status: 400 })
    if (!VER_KINDS.includes(kind) || !VER_STATUS.includes(status)) return NextResponse.json({ error: 'bad kind/status' }, { status: 400 })
    const row = { reservation_id: resId, kind, status, checked_at: status === 'pending' ? null : new Date().toISOString(), checked_by: status === 'pending' ? null : by, note: b?.note ? String(b.note).slice(0, 300) : null }
    const { error } = await db.from('garden_verifications').upsert(row, { onConflict: 'reservation_id,kind' })
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
  }

  const kind = String(b?.kind || 'pre_arrival'), outcome = String(b?.outcome || '')
  if (!CALL_KINDS.includes(kind) || !OUTCOMES.includes(outcome)) return NextResponse.json({ error: 'bad kind/outcome' }, { status: 400 })
  const { data, error } = await db.from('garden_calls').insert({
    reservation_id: resId, guest_name: b?.guestName ? String(b.guestName).slice(0, 120) : null, kind, outcome,
    called_by: by, duration_min: b?.durationMin != null ? Math.max(0, Math.round(Number(b.durationMin) || 0)) : null,
    note: b?.note ? String(b.note).slice(0, 500) : null,
  }).select('*').single()
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, call: data })
}

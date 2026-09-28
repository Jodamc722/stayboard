// GARDEN HOTEL TASKS — cleans, stayovers, inspections, deep cleans, maintenance per room per day.
//
//   POST  { roomId?, roomName?, date, kind, note?, assignedTo?, priority? }   → create
//   PATCH { id, status?: open|in_progress|done|cancelled, assignedTo?, note?, pushCloudbeds? }
//
// Finishing a 'clean' with pushCloudbeds (default on when connected) writes the room back to
// Cloudbeds as clean; an 'inspection' finished writes inspected. Best effort — the task is marked
// done here first, and a Cloudbeds refusal is returned as a warning, never as a failure.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cloudbedsConfigured, setHousekeeping } from '@/lib/garden/cloudbeds'
import { emitGardenEvent } from '@/lib/garden/triggers'

export const dynamic = 'force-dynamic'
const KINDS = ['clean', 'stayover', 'inspection', 'deep_clean', 'maintenance']
const STATUSES = ['open', 'in_progress', 'done', 'cancelled']

export async function POST(req: NextRequest) {
  const gate = await requireLevel('garden', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const date = String(b?.date || ''), kind = String(b?.kind || 'clean')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'bad kind' }, { status: 400 })
  const db = supabaseAdmin()
  let roomId = b?.roomId ? String(b.roomId) : null, roomName = b?.roomName ? String(b.roomName).slice(0, 80) : null
  if (roomId) { const { data } = await db.from('garden_rooms').select('id,name').eq('id', roomId).maybeSingle(); if (!data) roomId = null; else roomName = roomName || data.name }
  const { data, error } = await db.from('garden_tasks').insert({
    room_id: roomId, room_name: roomName, date, kind, note: b?.note ? String(b.note).slice(0, 500) : null,
    assigned_to: b?.assignedTo ? String(b.assignedTo).slice(0, 80) : null, priority: b?.priority ? String(b.priority).slice(0, 20) : null,
    source: 'lighthouse', created_by: gate.access.email || null,
  }).select('*').single()
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, task: data })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireLevel('garden', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const id = String(b?.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseAdmin()
  const { data: t } = await db.from('garden_tasks').select('*').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const patch: any = { updated_at: new Date().toISOString() }
  const by = gate.access.email || 'someone'
  if (b?.status != null) {
    const st = String(b.status)
    if (!STATUSES.includes(st)) return NextResponse.json({ error: 'bad status' }, { status: 400 })
    patch.status = st
    if (st === 'in_progress' && !t.started_at) patch.started_at = patch.updated_at
    if (st === 'done') { patch.finished_at = patch.updated_at; patch.finished_by = by }
    if (st === 'open') { patch.finished_at = null; patch.finished_by = null }
  }
  if (b?.assignedTo !== undefined) patch.assigned_to = b.assignedTo ? String(b.assignedTo).slice(0, 80) : null
  if (b?.note !== undefined) patch.note = b.note ? String(b.note).slice(0, 500) : null
  const { error } = await db.from('garden_tasks').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (patch.status === 'done') await emitGardenEvent('task_done', id, { kind: t.kind, room_name: t.room_name, room_id: t.room_id, reservation_id: t.reservation_id })
  let warning: string | null = null
  const push = b?.pushCloudbeds !== false
  if (patch.status === 'done' && push && t.room_id && cloudbedsConfigured() && (t.kind === 'clean' || t.kind === 'stayover' || t.kind === 'inspection')) {
    try { await setHousekeeping(String(t.room_id), t.kind === 'inspection' ? 'inspected' : 'clean') }
    catch (e: any) { warning = `Marked done here; Cloudbeds did not take the room status: ${String(e?.message || e).slice(0, 160)}` }
  }
  return NextResponse.json({ ok: true, warning })
}

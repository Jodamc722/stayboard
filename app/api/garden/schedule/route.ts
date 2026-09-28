// GARDEN HOTEL SCHEDULER — staff and shifts.
//   GET  ?from=YYYY-MM-DD&days=7      → { staff, days: [{ date, load, shifts, suggest }] }
//   POST { op: 'staff', id?, name, role, phone?, email?, active? }
//        { op: 'shift', id?, date, staffId, role?, start?, end?, rooms?, note? }
//        { op: 'delete_shift' | 'delete_staff', id }
//        { op: 'split', date }         → rooms split across the housekeepers on shift
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { weekSchedule, weekStart, splitRooms } from '@/lib/garden/schedule'

export const dynamic = 'force-dynamic'
const ROLES = ['frontdesk', 'housekeeping', 'maintenance', 'manager']

export async function GET(req: NextRequest) {
  const gate = await requireLevel('garden', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.get('from'))) ? String(sp.get('from')) : weekStart()
  const days = Math.min(14, Math.max(1, Number(sp.get('days')) || 7))
  try { return NextResponse.json({ ok: true, ...(await weekSchedule(from, days)) }) } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('garden', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const db = supabaseAdmin()
  const op = String(b?.op || '')
  if (op === 'staff') {
    const row: any = { name: String(b?.name || '').trim().slice(0, 80), role: ROLES.includes(b?.role) ? b.role : 'housekeeping', phone: b?.phone ? String(b.phone).slice(0, 40) : null, email: b?.email ? String(b.email).toLowerCase().slice(0, 120) : null, active: b?.active !== false, note: b?.note ? String(b.note).slice(0, 300) : null }
    if (!row.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const r = b?.id ? await db.from('garden_staff').update(row).eq('id', String(b.id)).select('*').single() : await db.from('garden_staff').insert(row).select('*').single()
    return r.error ? NextResponse.json({ error: r.error.message }, { status: 500 }) : NextResponse.json({ ok: true, staff: r.data })
  }
  if (op === 'shift') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b?.date)) || !b?.staffId) return NextResponse.json({ error: 'date and staffId required' }, { status: 400 })
    const { data: st } = await db.from('garden_staff').select('id,role').eq('id', String(b.staffId)).maybeSingle()
    if (!st) return NextResponse.json({ error: 'staff not found' }, { status: 404 })
    const row: any = { date: b.date, staff_id: st.id, role: ROLES.includes(b?.role) ? b.role : st.role, start_time: /^\d{2}:\d{2}$/.test(String(b?.start)) ? b.start : '08:00', end_time: /^\d{2}:\d{2}$/.test(String(b?.end)) ? b.end : '16:00', rooms: Array.isArray(b?.rooms) ? b.rooms.map(String).slice(0, 60) : [], note: b?.note ? String(b.note).slice(0, 300) : null, source: b?.source === 'suggested' ? 'suggested' : 'manual', created_by: gate.access.email || null }
    const r = b?.id ? await db.from('garden_shifts').update(row).eq('id', String(b.id)).select('*').single() : await db.from('garden_shifts').insert(row).select('*').single()
    return r.error ? NextResponse.json({ error: r.error.message }, { status: 500 }) : NextResponse.json({ ok: true, shift: r.data })
  }
  if (op === 'delete_shift') { await db.from('garden_shifts').delete().eq('id', String(b?.id || '')); return NextResponse.json({ ok: true }) }
  if (op === 'delete_staff') { await db.from('garden_staff').update({ active: false }).eq('id', String(b?.id || '')); return NextResponse.json({ ok: true }) }
  if (op === 'split') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b?.date))) return NextResponse.json({ error: 'date required' }, { status: 400 }); return NextResponse.json({ ok: true, ...(await splitRooms(String(b.date))) }) }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}

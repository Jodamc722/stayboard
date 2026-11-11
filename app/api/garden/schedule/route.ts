// GARDEN HOTEL SCHEDULER — staff and shifts.
//   GET  ?from=YYYY-MM-DD&days=7      → { staff, days: [{ date, load, shifts, suggest }] }
//   POST { op: 'staff', id?, name, role, phone?, email?, active? }
//        { op: 'shift', id?, date, staffId, role?, start?, end?, rooms?, note? }
//        { op: 'delete_shift' | 'delete_staff', id }
//        { op: 'split', date }         → rooms split across the housekeepers on shift
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { weekSchedule, weekStart, splitRooms } from '@/lib/garden/schedule'

export const dynamic = 'force-dynamic'
const ROLES = ['frontdesk', 'housekeeping', 'maintenance', 'manager']

export async function GET(req: NextRequest) {
  const gate = await requireGarden('schedule', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.get('from'))) ? String(sp.get('from')) : weekStart()
  const days = Math.min(14, Math.max(1, Number(sp.get('days')) || 7))
  try { return NextResponse.json({ ok: true, ...(await weekSchedule(from, days)) }) } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('schedule', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const db = supabaseAdmin()
  const op = String(b?.op || '')
  if (op === 'staff' || op === 'delete_staff') { const g2 = await requireGarden('staff', 'edit'); if (!g2.ok) return g2.res }
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
  // Copy last week's shifts into this week (Jon, 2026-11-10: "create a scheduler that works") — only
  // for people and days that have nothing yet, so it never doubles a shift.
  if (op === 'copy_week') {
    const from = String(b?.from || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return NextResponse.json({ error: 'from required' }, { status: 400 })
    const add = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
    const [{ data: prev }, { data: cur }] = await Promise.all([
      db.from('garden_shifts').select('staff_id,role,date,start_time,end_time,note').gte('date', add(from, -7)).lte('date', add(from, -1)),
      db.from('garden_shifts').select('staff_id,date').gte('date', from).lte('date', add(from, 6)),
    ])
    const have = new Set(((cur || []) as any[]).map(x => x.staff_id + '|' + x.date))
    const rows = ((prev || []) as any[]).map(x => ({ staff_id: x.staff_id, role: x.role, date: add(x.date, 7), start_time: x.start_time, end_time: x.end_time, note: x.note, rooms: [], source: 'manual', created_by: gate.access.email || null })).filter(x => !have.has(x.staff_id + '|' + x.date))
    if (rows.length) { const { error } = await db.from('garden_shifts').insert(rows); if (error) return NextResponse.json({ error: error.message }, { status: 500 }) }
    return NextResponse.json({ ok: true, copied: rows.length })
  }
  // BUILD THE WEEK (Jon, 2026-11-11: "build weekly schedule"). Each day gets the people it needs per
  // role (housekeepers from that day's checkouts + stayovers, a front desk, maintenance when there is
  // work), drawn from the roster: whoever has the fewest shifts so far this week, never twice in a
  // day, at most five days a week. Shifts already there are kept; the role's usual hours.
  if (op === 'build_week') {
    const from = String(b?.from || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return NextResponse.json({ error: 'from required' }, { status: 400 })
    const HOURS: Record<string, [string, string]> = { housekeeping: ['09:00', '17:00'], frontdesk: ['07:00', '15:00'], maintenance: ['08:00', '16:00'], manager: ['09:00', '17:00'] }
    const MAX_DAYS = Number(b?.maxDays) > 0 ? Math.min(7, Number(b.maxDays)) : 5
    const wk = await weekSchedule(from, 7)
    const staff = (wk.staff || []) as any[]
    const count: Record<string, number> = {}
    for (const d of wk.days as any[]) for (const x of d.shifts) count[x.staff_id] = (count[x.staff_id] || 0) + 1
    const rows: any[] = [], short: string[] = []
    for (const d of wk.days as any[]) {
      const onDay = new Set<string>(d.shifts.map((x: any) => x.staff_id))
      for (const role of ['housekeeping', 'frontdesk', 'maintenance'] as const) {
        let need = Math.max(0, (d.suggest.need[role] || 0) - d.shifts.filter((x: any) => x.role === role).length)
        const pool = staff.filter(s => s.role === role && !onDay.has(s.id) && (count[s.id] || 0) < MAX_DAYS).sort((a, b) => (count[a.id] || 0) - (count[b.id] || 0) || String(a.name).localeCompare(String(b.name)))
        for (const p of pool) {
          if (need <= 0) break
          rows.push({ date: d.date, staff_id: p.id, role, start_time: HOURS[role][0], end_time: HOURS[role][1], rooms: [], source: 'suggested', created_by: gate.access.email || null })
          onDay.add(p.id); count[p.id] = (count[p.id] || 0) + 1; need--
        }
        if (need > 0) short.push(`${d.date} ${role} short ${need}`)
      }
    }
    if (rows.length) { const { error } = await db.from('garden_shifts').insert(rows); if (error) return NextResponse.json({ error: error.message }, { status: 500 }) }
    return NextResponse.json({ ok: true, added: rows.length, short })
  }
  if (op === 'split') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b?.date))) return NextResponse.json({ error: 'date required' }, { status: 400 }); return NextResponse.json({ ok: true, ...(await splitRooms(String(b.date))) }) }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}

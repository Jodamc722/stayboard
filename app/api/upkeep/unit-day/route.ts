// ONE UNIT, ONE DAY — what the coordinator needs before booking upkeep into a unit on a date (Jon,
// 2026-10-16: "click into the unit date, see what's pending and assign each one, add notes").
//
//   GET /api/upkeep/unit-day?listingId=…&date=YYYY-MM-DD
//   → stays around the day (who leaves, who arrives), the work already on the books for this unit
//     (open Breezeway tasks from a week before to three weeks after), and the unit info.
// The pending upkeep itself comes from the page (every program's rows for the unit), so this stays
// one cheap read.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isLiveStay } from '@/lib/stay-status'
import { getUnitInfo, type UnitInfo } from '@/lib/unit-equipment'

export const dynamic = 'force-dynamic'
const str = (v: any) => String(v ?? '').trim()
const plus = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

export type UnitDay = {
  ok: true; listingId: string; date: string
  stays: { guest: string; checkIn: string; checkOut: string; nights: number | null; source: string | null; relation: 'leaving' | 'arriving' | 'in-house' | 'next' | 'previous' }[]
  tasks: { id: string; name: string; date: string; dept: string; status: string; assignees: string[] }[]
  info: UnitInfo | null
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const listingId = str(req.nextUrl.searchParams.get('listingId'))
  const date = str(req.nextUrl.searchParams.get('date')).slice(0, 10)
  if (!listingId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'listingId and date required' }, { status: 400 })
  const db = supabaseAdmin()
  try {
    const [rs, ts, info] = await Promise.all([
      db.from('guesty_reservations').select('guest_name,check_in,check_out,status,nights,source').eq('listing_id', listingId)
        .gte('check_out', plus(date, -14)).lte('check_in', plus(date, 21)).order('check_in').limit(40),
      db.from('breezeway_tasks_sync').select('id,name,scheduled_date,status,finished_at,assignees,type_department').eq('reference_property_id', listingId)
        .gte('scheduled_date', plus(date, -7)).lte('scheduled_date', plus(date, 21)).order('scheduled_date').limit(80),
      getUnitInfo().catch(() => ({} as Record<string, UnitInfo>)),
    ])
    const live = ((rs.data || []) as any[]).filter(r => isLiveStay(r.status)).map(r => ({ ...r, ci: str(r.check_in).slice(0, 10), co: str(r.check_out).slice(0, 10) }))
    const rel = (r: any): UnitDay['stays'][number]['relation'] =>
      r.co === date ? 'leaving' : r.ci === date ? 'arriving' : r.ci < date && date < r.co ? 'in-house' : r.ci > date ? 'next' : 'previous'
    // The stays that matter for this day: the one leaving, arriving or in-house, plus the nearest before and after.
    const touching = live.filter(r => ['leaving', 'arriving', 'in-house'].includes(rel(r)))
    const prev = live.filter(r => rel(r) === 'previous').slice(-1)
    const next = live.filter(r => rel(r) === 'next').slice(0, 1)
    const stays = [...prev, ...touching, ...next].map(r => ({ guest: str(r.guest_name) || 'Guest', checkIn: r.ci, checkOut: r.co, nights: Number(r.nights) || null, source: r.source ? str(r.source) : null, relation: rel(r) }))
    const tasks = ((ts.data || []) as any[])
      .filter(t => !t.finished_at && !/cancel|delet|void|complete|approved|finished/i.test(str(t.status)))
      .map(t => ({ id: str(t.id), name: str(t.name), date: str(t.scheduled_date).slice(0, 10), dept: str(t.type_department), status: str(t.status),
        assignees: Array.isArray(t.assignees) ? t.assignees.map((p: any) => str(p && typeof p === 'object' ? p.name : p)).filter(Boolean) : [] }))
    return NextResponse.json({ ok: true, listingId, date, stays, tasks, info: (info as any)[listingId] || null } satisfies UnitDay)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

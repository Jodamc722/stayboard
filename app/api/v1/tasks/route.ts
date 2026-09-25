import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json, todayET, ymd } from '@/lib/api-v1'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'schedule'); if (!g.ok) return g.res
  const date = ymd(req.nextUrl.searchParams.get('date'), todayET())
  const { data } = await supabaseAdmin().from('breezeway_tasks_sync').select('id,name,status,scheduled_date,started_at,finished_at,finished_by_name,assignees,reference_property_id,linked_reservation_id').eq('scheduled_date', date).limit(2000)
  const rows = ((data as any[]) || []).map(t => ({ id: t.id, name: t.name, status: t.status, date: t.scheduled_date, startedAt: t.started_at, finishedAt: t.finished_at, finishedBy: t.finished_by_name, assignees: Array.isArray(t.assignees) ? t.assignees.map((a: any) => a?.name).filter(Boolean) : [], listingId: t.reference_property_id, reservationId: t.linked_reservation_id }))
  return json(rows, { date, count: rows.length })
}

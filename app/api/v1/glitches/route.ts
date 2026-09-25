import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json, todayET, ymd, shift } from '@/lib/api-v1'
export const dynamic = 'force-dynamic'
const OPEN = (s: any) => !/^(closed|done|resolved)$/i.test(String(s || ''))
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'glitches'); if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const status = String(sp.get('status') || 'open'), since = ymd(sp.get('since'), shift(todayET(), -90))
  const { data } = await supabaseAdmin().from('glitches').select('id,unit,listing_id,status,category,overview,assignee,guest_name,check_in,check_out,vendor_name,breezeway_task_id,created_at,closed_at,due_date').gte('created_at', since + 'T00:00:00Z').order('created_at', { ascending: false }).limit(1000)
  const rows = ((data as any[]) || []).filter(r => status === 'all' ? true : status === 'closed' ? !OPEN(r.status) : OPEN(r.status))
    .map(r => ({ id: r.id, unit: r.unit, listingId: r.listing_id, status: r.status, category: r.category, summary: r.overview, assignee: r.assignee, vendor: r.vendor_name, guest: r.guest_name, checkIn: r.check_in, checkOut: r.check_out, breezewayTaskId: r.breezeway_task_id, due: r.due_date, createdAt: r.created_at, closedAt: r.closed_at }))
  return json(rows, { status, since, count: rows.length })
}

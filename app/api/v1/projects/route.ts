import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json } from '@/lib/api-v1'
import { isSuperadmin } from '@/lib/access'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'projects'); if (!g.ok) return g.res
  const sb = supabaseAdmin(), email = String(g.access.email || '').toLowerCase()
  let ids: string[] | null = null
  if (!isSuperadmin(email)) { const { data } = await sb.from('project_members').select('project_id').eq('email', email).limit(2000); ids = ((data as any[]) || []).map(m => String(m.project_id)) }
  let q = sb.from('projects').select('id,title,kind,stage,building,market,archived,updated_at').eq('archived', false).order('updated_at', { ascending: false }).limit(500)
  if (ids) { if (!ids.length) return json([], { count: 0 }); q = q.in('id', ids) }
  const { data } = await q
  const rows = ((data as any[]) || [])
  const pids = rows.map(p => String(p.id))
  const open: Record<string, number> = {}
  if (pids.length) { const { data: st } = await sb.from('project_steps').select('project_id').in('project_id', pids).eq('done', false).neq('status', 'done').limit(10000); for (const s of (st as any[]) || []) open[String(s.project_id)] = (open[String(s.project_id)] || 0) + 1 }
  return json(rows.map(p => ({ id: p.id, title: p.title, kind: p.kind, stage: p.stage, building: p.building, market: p.market, openTasks: open[String(p.id)] || 0, updatedAt: p.updated_at })), { count: rows.length })
}

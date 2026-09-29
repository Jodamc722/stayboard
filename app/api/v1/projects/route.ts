import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json } from '@/lib/api-v1'
import { isSuperadmin } from '@/lib/access'
import { pageRows } from '@/lib/db-page'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'projects'); if (!g.ok) return g.res
  const sb = supabaseAdmin(), email = String(g.access.email || '').toLowerCase()
  let ids: string[] | null = null
  // Memberships paged: every recurring instance adds a row, so one person's list only grows.
  if (!isSuperadmin(email)) { const mem = await pageRows((a, b) => sb.from('project_members').select('project_id').eq('email', email).order('id').range(a, b)); if (mem.truncated) console.error('api/v1/projects: membership read stopped early'); ids = (mem.rows as any[]).map(m => String(m.project_id)) }
  let q = sb.from('projects').select('id,title,kind,stage,building,market,archived,updated_at').eq('archived', false).order('updated_at', { ascending: false }).limit(500)
  if (ids) { if (!ids.length) return json([], { count: 0 }); q = q.in('id', ids) }
  const { data } = await q
  const rows = ((data as any[]) || [])
  const pids = rows.map(p => String(p.id))
  const open: Record<string, number> = {}
  // Open-task counts paged (was one read capped at 1,000 across up to 500 projects), up to the 10,000 it always asked for.
  if (pids.length) { const st = await pageRows((a, b) => sb.from('project_steps').select('project_id').in('project_id', pids).eq('done', false).neq('status', 'done').order('id').range(a, b), 10); if (st.truncated) console.error('api/v1/projects: open-task read stopped early — counts may be low'); for (const s of st.rows as any[]) open[String(s.project_id)] = (open[String(s.project_id)] || 0) + 1 }
  return json(rows.map(p => ({ id: p.id, title: p.title, kind: p.kind, stage: p.stage, building: p.building, market: p.market, openTasks: open[String(p.id)] || 0, updatedAt: p.updated_at })), { count: rows.length })
}

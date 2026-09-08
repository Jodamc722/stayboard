// THE BELL — what is waiting for me across every project.
//
//   GET  /api/projects/notifications            → unread count + the latest 40 (unread first)
//   POST { action: 'read', ids: [...] }         → mark those read
//   POST { action: 'readAll' }                  → clear the bell
//
// Always scoped to the signed-in email. There is no admin view of somebody else's inbox — a
// one-on-one's notifications are as private as the one-on-one.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const email = String(g.access.email || '').toLowerCase()
  if (!email) return NextResponse.json({ ok: true, unread: 0, items: [] })
  const sb = supabaseAdmin()
  const [{ data: unreadRows, error: e1 }, { data: recent, error: e2 }] = await Promise.all([
    sb.from('project_notifications').select('id').eq('email', email).is('read_at', null).limit(500),
    sb.from('project_notifications').select('*').eq('email', email).order('created_at', { ascending: false }).limit(40),
  ])
  if (e1 || e2) return NextResponse.json({ error: 'Could not load notifications: ' + (e1 || e2)!.message }, { status: 500 })
  const items = (recent || []).slice().sort((a: any, b: any) => (a.read_at ? 1 : 0) - (b.read_at ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at)))
  const pids = Array.from(new Set(items.map((n: any) => String(n.project_id))))
  const titles: Record<string, string> = {}
  if (pids.length) {
    const { data: ps } = await sb.from('projects').select('id,title').in('id', pids)
    for (const p of (ps || []) as any[]) titles[p.id] = p.title
  }
  return NextResponse.json({ ok: true, unread: (unreadRows || []).length, items: items.map((n: any) => ({ ...n, project: titles[n.project_id] || null })) })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const email = String(g.access.email || '').toLowerCase()
  const b = await req.json().catch(() => ({}))
  const sb = supabaseAdmin()
  const now = new Date().toISOString()
  if (b.action === 'readAll') {
    const { error } = await sb.from('project_notifications').update({ read_at: now }).eq('email', email).is('read_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'read') {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 200)
    if (!ids.length) return NextResponse.json({ error: 'ids required' }, { status: 400 })
    // .eq(email) is the authorisation: an id that is not mine simply matches nothing.
    const { error } = await sb.from('project_notifications').update({ read_at: now }).eq('email', email).in('id', ids).is('read_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// MY TASKS — what do I do today. Since 2026-11-06 this reads the LEADERSHIP BOARD (lib/board), not
// the retired Projects engine: Jon, "everyone's tasks can live here". The shape is unchanged so the
// Command Center's "My tasks" strip and Hub keep working; every row carries projectId 'board' so a
// done-toggle goes to /api/leadership and "Open" goes to /leadership?item=<id>.
// Grouped by when: overdue, today, this week, later, no date.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { todayET, addItem } from '@/lib/board'

export const dynamic = 'force-dynamic'
const empty = () => ({ overdue: [] as any[], today: [] as any[], week: [] as any[], later: [] as any[], someday: [] as any[] })

export async function GET(_req: NextRequest) {
  const g = await requireLevel('leadership', 'view')
  if (!g.ok) return g.res
  const email = String(g.access.email || '').toLowerCase()
  if (!email) return NextResponse.json({ ok: false, error: 'no email on session' }, { status: 400 })
  const today = todayET()
  try {
    const sb = supabaseAdmin()
    const { data: rows, error } = await sb.from('board_items').select('id,lane,title,status,due_on,priority,property').eq('status', 'open').contains('assignees', [email])
      .order('due_on', { ascending: true, nullsFirst: false }).limit(1000)
    if (error) { if (/board_items|does not exist/i.test(error.message)) return NextResponse.json({ ok: true, today, groups: empty(), total: 0 }); throw new Error(error.message) }
    const week = new Date(Date.parse(today + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10)
    const groups = empty()
    for (const r of ((rows || []) as any[])) {
      const item = {
        id: String(r.id), projectId: 'board', title: String(r.title), status: 'todo', due: r.due_on ? String(r.due_on).slice(0, 10) : null,
        priority: String(r.priority || 'normal'), section: r.lane || null, subtask: false, parent: null,
        project: String(r.lane || 'Leadership'), oneOnOne: false, mine: true, where: r.property || null, role: 'assignee',
      }
      if (!item.due) groups.someday.push(item)
      else if (item.due < today) groups.overdue.push(item)
      else if (item.due === today) groups.today.push(item)
      else if (item.due <= week) groups.week.push(item)
      else groups.later.push(item)
    }
    return NextResponse.json({ ok: true, today, groups, total: (rows || []).length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

// Quick add straight from Today: the task lands on the board's Tasks lane, assigned to me.
export async function POST(req: NextRequest) {
  const g = await requireLevel('leadership', 'edit')
  if (!g.ok) return g.res
  const email = String(g.access.email || '').toLowerCase()
  const b = await req.json().catch(() => ({}))
  const r = await addItem(email, String(g.access.profile?.name || '') || null, { lane: 'Tasks', title: b.title, assignees: [email], due: b.due_on || null })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, taskId: r.id })
}

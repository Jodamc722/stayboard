// MY TASKS — everything with my name on it, across every project I can see.
//
// This is the screen the task-as-atom model exists for. A project page answers "how is this
// project going"; this one answers "what do I do today", which is the question people open the
// app with. Grouped by when: overdue, today, this week, later, no date.
//
// A person is matched two ways: by email (their login) and by name (the roster spelling), through
// the same key the assignees table stores — so a task assigned to "Roberto" and one assigned to
// roberto@… land on the same person's list.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { personKey } from '@/lib/person-name'
import { todayISO } from '@/lib/projects-shared'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const email = String(g.access.email || '').toLowerCase()
  if (!email) return NextResponse.json({ ok: false, error: 'no email on session' }, { status: 400 })
  const sb = supabaseAdmin()
  const today = todayISO()

  try {
    // Which projects may I see? Same rule as the board: membership, or superadmin.
    let visible: Set<string> | null = null
    if (!isSuperadmin(email)) {
      const { data, error } = await sb.from('project_members').select('project_id').eq('email', email).limit(2000)
      if (error) throw new Error(error.message)
      visible = new Set(((data || []) as any[]).map(m => String(m.project_id)))
      if (!visible.size) return NextResponse.json({ ok: true, today, groups: empty(), total: 0 })
    }

    // My name, as the roster might spell it, so name-only assignments reach me too.
    const { data: meRow } = await sb.from('app_users').select('profile').eq('email', email).maybeSingle()
    const myName = String((meRow as any)?.profile?.name || (meRow as any)?.profile?.full_name || '')
    const keys = Array.from(new Set([email, myName ? personKey(myName) : ''].filter(Boolean)))

    const { data: asg, error: aErr } = await sb.from('project_task_assignees')
      .select('task_id,project_id').or(`email.eq.${email},person_key.in.(${keys.map(k => JSON.stringify(k)).join(',')})`).limit(2000)
    if (aErr) throw new Error(aErr.message)
    let taskIds = Array.from(new Set(((asg || []) as any[]).filter(a => !visible || visible.has(String(a.project_id))).map(a => String(a.task_id))))
    if (!taskIds.length) return NextResponse.json({ ok: true, today, groups: empty(), total: 0 })

    const { data: tasks, error: tErr } = await sb.from('project_steps')
      .select('id,project_id,title,status,due_on,priority,section,parent_id,updated_at')
      .in('id', taskIds.slice(0, 1000)).neq('status', 'done')
      .order('due_on', { ascending: true, nullsFirst: false }).order('id')
    if (tErr) throw new Error(tErr.message)
    const rows = (tasks || []) as any[]
    if (!rows.length) return NextResponse.json({ ok: true, today, groups: empty(), total: 0 })

    const pids = Array.from(new Set(rows.map(r => String(r.project_id))))
    const [{ data: projs }, { data: links }] = await Promise.all([
      sb.from('projects').select('id,title,kind,private,stage').in('id', pids),
      sb.from('project_links').select('project_id,kind,label').in('project_id', pids).in('kind', ['building', 'listing']),
    ])
    const pmap: Record<string, any> = {}
    for (const p of ((projs || []) as any[])) pmap[String(p.id)] = p
    // One line of "where": the building if there is one, else the first unit.
    const where: Record<string, string> = {}
    for (const l of ((links || []) as any[])) {
      const pid = String(l.project_id)
      if (l.kind === 'building') where[pid] = String(l.label || '')
      else if (!where[pid]) where[pid] = String(l.label || '')
    }

    const week = new Date(Date.parse(today + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10)
    const groups = empty()
    for (const r of rows) {
      const item = {
        id: String(r.id), projectId: String(r.project_id), title: String(r.title),
        status: String(r.status), due: r.due_on ? String(r.due_on).slice(0, 10) : null,
        priority: String(r.priority || 'normal'), section: r.section || null, subtask: !!r.parent_id,
        project: pmap[String(r.project_id)]?.title || 'Project',
        oneOnOne: pmap[String(r.project_id)]?.kind === 'one_on_one',
        where: where[String(r.project_id)] || null,
      }
      if (!item.due) groups.someday.push(item)
      else if (item.due < today) groups.overdue.push(item)
      else if (item.due === today) groups.today.push(item)
      else if (item.due <= week) groups.week.push(item)
      else groups.later.push(item)
    }
    return NextResponse.json({ ok: true, today, groups, total: rows.length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

const empty = () => ({ overdue: [] as any[], today: [] as any[], week: [] as any[], later: [] as any[], someday: [] as any[] })

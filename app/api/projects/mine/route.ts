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
import { ensureMyBoard } from '@/lib/projects'
import { pageRows } from '@/lib/db-page'

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
      // Paged: every recurring instance adds a membership row, so one person's list only grows.
      const mem = await pageRows<any>((a, b) => sb.from('project_members').select('project_id').eq('email', email).order('id').range(a, b))
      if (mem.truncated) throw new Error('could not read every project you are on')
      visible = new Set(mem.rows.map(m => String(m.project_id)))
      if (!visible.size) return NextResponse.json({ ok: true, today, groups: empty(), total: 0 })
    }

    // My name, as the roster might spell it, so name-only assignments reach me too.
    const { data: meRow } = await sb.from('app_users').select('profile').eq('email', email).maybeSingle()
    const myName = String((meRow as any)?.profile?.name || (meRow as any)?.profile?.full_name || '')
    const keys = Array.from(new Set([email, myName ? personKey(myName) : ''].filter(Boolean)))

    // MY BOARD (Jon, 2026-09-09): every user has one. Its tasks are mine by definition, assigned or not.
    const board = await ensureMyBoard(email, myName).catch(() => null)
    // select('*') so this keeps working before migration 087 adds `role`; a row without one is
    // an assignee, which is what every row meant until collaborators existed.
    // PAGED (2026-09-29): this is every assignment the person has ever had, done tasks included, and
    // each recurring cycle carries open tasks forward with fresh rows — past 1,000 an unordered read
    // dropped some.
    const asgRead = await pageRows<any>((a, b) => sb.from('project_task_assignees')
      .select('*').or(`email.eq.${email},person_key.in.(${keys.map(k => JSON.stringify(k)).join(',')})`).order('id').range(a, b))
    if (asgRead.truncated) throw new Error('could not read every task assigned to you')
    const asg = asgRead.rows
    // A COLLABORATOR'S TASK IS STILL ON MY LIST (Jon, 2026-09-15: "if collaborated it's assigned
    // to my tasks"). It is not hidden and it is not a separate tab — it is labelled, so the list
    // can still tell me what I owe from what I am only party to.
    const roleByTask: Record<string, string> = {}
    for (const a of ((asg || []) as any[])) {
      const k = String(a.task_id)
      // Assignee wins: being on the hook outranks being copied in, if somehow both are recorded.
      if (roleByTask[k] !== 'assignee') roleByTask[k] = String(a.role || 'assignee')
    }
    const own = board ? await sb.from('project_steps').select('id').eq('project_id', board.id).neq('status', 'done').limit(1000) : { data: [] as any[] } // deliberate cap: one person's own board, open tasks only — nowhere near 1,000
    let taskIds = Array.from(new Set([
      ...((asg || []) as any[]).filter(a => !visible || visible.has(String(a.project_id))).map(a => String(a.task_id)),
      ...((own.data || []) as any[]).map(t => String(t.id)),
    ]))
    if (!taskIds.length) return NextResponse.json({ ok: true, today, groups: empty(), total: 0, board })

    // 200 ids a read (an .in() list rides in the URL) instead of the first 1,000 ids only. More than
    // one read is merged back into the order a single read gives: due date, undated last, then id.
    const rows: any[] = []
    for (let i = 0; i < taskIds.length; i += 200) {
      const { data: tasks, error: tErr } = await sb.from('project_steps')
        .select('id,project_id,title,status,due_on,priority,section,parent_id,updated_at')
        .in('id', taskIds.slice(i, i + 200)).neq('status', 'done')
        .order('due_on', { ascending: true, nullsFirst: false }).order('id')
      if (tErr) throw new Error(tErr.message)
      rows.push(...((tasks || []) as any[]))
    }
    if (taskIds.length > 200) rows.sort((x, y) => {
      const dx = x.due_on ? String(x.due_on) : null, dy = y.due_on ? String(y.due_on) : null
      if (dx !== dy) return dx === null ? 1 : dy === null ? -1 : dx < dy ? -1 : 1
      const ix = String(x.id), iy = String(y.id)
      return ix < iy ? -1 : ix > iy ? 1 : 0
    })
    if (!rows.length) return NextResponse.json({ ok: true, today, groups: empty(), total: 0, board })

    // A SUBTASK NEEDS ITS PARENT'S NAME. "Which unit" is a perfectly good subtask under "Vendor
    // visit for 1418/2" and a meaningless line on its own — and My Tasks is exactly where it is
    // seen on its own. One extra read, only when the list actually contains subtasks.
    const parentIds = Array.from(new Set(rows.map(r => r.parent_id).filter(Boolean).map(String)))
    const parentTitle: Record<string, string> = {}
    if (parentIds.length) {
      const { data: parents } = await sb.from('project_steps').select('id,title').in('id', parentIds.slice(0, 500))
      for (const x of ((parents || []) as any[])) parentTitle[String(x.id)] = String(x.title || '')
    }

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
        parent: r.parent_id ? (parentTitle[String(r.parent_id)] || null) : null,
        project: pmap[String(r.project_id)]?.title || 'Project',
        oneOnOne: pmap[String(r.project_id)]?.kind === 'one_on_one',
        mine: !!board && String(r.project_id) === board.id,
        where: where[String(r.project_id)] || null,
        role: roleByTask[String(r.id)] === 'collaborator' ? 'collaborator' : 'assignee',
      }
      if (!item.due) groups.someday.push(item)
      else if (item.due < today) groups.overdue.push(item)
      else if (item.due === today) groups.today.push(item)
      else if (item.due <= week) groups.week.push(item)
      else groups.later.push(item)
    }
    return NextResponse.json({ ok: true, today, groups, total: rows.length, board })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

// Quick add straight from My Tasks: the task lands on my board, assigned to me, dated if asked.
export async function POST(req: NextRequest) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  const email = String(g.access.email || '').toLowerCase()
  const b = await req.json().catch(() => ({}))
  const title = String(b.title || '').trim().slice(0, 300)
  if (!title) return NextResponse.json({ error: 'Give it a title.' }, { status: 400 })
  try {
    const sb = supabaseAdmin()
    const { data: meRow } = await sb.from('app_users').select('profile').eq('email', email).maybeSingle()
    const myName = String((meRow as any)?.profile?.name || (meRow as any)?.profile?.full_name || '')
    const board = await ensureMyBoard(email, myName)
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_on || '')) ? String(b.due_on) : null
    const { data: t, error } = await sb.from('project_steps').insert({ project_id: board.id, title, status: 'todo', section: 'To do', priority: 'normal', due_on: due, created_by: email }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await sb.from('project_task_assignees').upsert({ task_id: t.id, project_id: board.id, person_key: email, display: myName || email.split('@')[0], email }, { onConflict: 'task_id,person_key' })
    return NextResponse.json({ ok: true, taskId: t.id, board })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

const empty = () => ({ overdue: [] as any[], today: [] as any[], week: [] as any[], later: [] as any[], someday: [] as any[] })

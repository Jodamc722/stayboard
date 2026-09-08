'use client'
// THE PROJECT PAGE — where the task is the atom.
//
// Jon, 2026-09-08: an Asana-style board. This is the surface that makes it one: a list of tasks
// grouped by section, a drawer that opens on any task with everything about it, the people on the
// project, and the real Guesty things it is attached to. Wave 1 of four; comments, files and
// notifications arrive in the next two.
//
// Design notes, in the order they matter:
//   • The task list is the page. Not a tab, not a card — the first thing on screen and most of it.
//   • Adding a task is a text box at the bottom of each section, like Asana, so the friction of
//     capturing a thought is one keystroke, not a form.
//   • The drawer edits in place and saves on blur. Nothing has a Save button except things that
//     change who can see the project.
//   • Members and Guesty links are a side column on desktop and stacked below on a phone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Plus, Check, Circle, CircleDot, Ban, ChevronRight, ChevronDown, X, Users, Building2,
  Home, CalendarDays, UserRound, Loader2, Lock, Unlock, Search, Trash2, MoreHorizontal, CornerDownRight,
} from 'lucide-react'
import type { ProjectFull, Task, Member, Person } from '@/lib/projects-shared'
import { STAGE_LABEL, TASK_STATUS_LABEL } from '@/lib/projects-shared'

type Roster = { display: string; email: string | null; notifiable: boolean }[]
type Hit =
  | { kind: 'building'; id: string; label: string; sub: string; unitIds: string[] }
  | { kind: 'listing'; id: string; label: string; sub: string; building: string | null }
  | { kind: 'reservation'; id: string; label: string; sub: string; listingId: string; checkIn: string; checkOut: string; status: string }
  | { kind: 'owner'; id: string; label: string; sub: string; unitIds: string[] }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const nice = (ymd: string | null) => {
  if (!ymd) return ''
  try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd }
}
const first = (s: string) => String(s || '').split(/[\s@]/)[0]

const STATUS_ICON: Record<string, any> = { todo: Circle, doing: CircleDot, blocked: Ban, done: Check }
const STATUS_CLS: Record<string, string> = {
  todo: 'text-muted border-line hover:border-ink',
  doing: 'text-amber-600 border-amber-300 bg-amber-50',
  blocked: 'text-rose-600 border-rose-300 bg-rose-50',
  done: 'text-white bg-emerald-500 border-emerald-500',
}
const LINK_ICON: Record<string, any> = { building: Building2, listing: Home, reservation: CalendarDays, owner: UserRound }

export function ProjectPage({ initial, me, canEdit, canFull, superadmin }: {
  initial: ProjectFull; me: string; canEdit: boolean; canFull: boolean; superadmin: boolean
}) {
  const [p, setP] = useState<ProjectFull>(initial)
  const [roster, setRoster] = useState<Roster>([])
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Roster for the pickers — same endpoint the board uses, so both surfaces offer the same people.
  useEffect(() => {
    fetch('/api/projects?archived=0', { cache: 'no-store' }).then(r => r.json())
      .then(j => setRoster(j?.roster || [])).catch(() => {})
  }, [])

  const reload = useCallback(async () => {
    const r = await fetch('/api/projects/' + p.id, { cache: 'no-store' })
    const j = await r.json()
    if (r.ok && j.project) setP(j.project)
  }, [p.id])

  // One writer for every change on the page. Returns the refreshed project when the server sends
  // one back (taskAdd does), else reloads — so the UI is never a step behind the database.
  const act = useCallback(async (body: any): Promise<any> => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/projects/' + p.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'That did not save.')
      if (j.project) setP(j.project); else await reload()
      return j
    } catch (e: any) { setErr(String(e?.message || e)); return null } finally { setBusy(false) }
  }, [p.id, reload])

  // ── SECTIONS ──────────────────────────────────────────────────────────────────────────────
  // The order sections appear is the order they were first used, with "no section" last. A 1:1
  // template will create them in the right order; an ad-hoc project grows them as it goes.
  const sections = useMemo(() => {
    const order: string[] = []
    const by: Record<string, Task[]> = {}
    for (const t of p.tasks) {
      const k = t.section || ''
      if (!(k in by)) { by[k] = []; if (k) order.push(k) }
      by[k].push(t)
    }
    if ('' in by) order.push('')
    return order.map(k => ({ name: k, tasks: by[k] }))
  }, [p.tasks])

  const open = p.tasks.filter(t => t.status !== 'done').length
  const total = p.tasks.length
  const overdue = p.tasks.filter(t => t.status !== 'done' && t.due_on && t.due_on < today()).length
  const current = openTask ? findTask(p.tasks, openTask) : null

  return (
    <div className="pb-16">
      {/* ── HEADER ── */}
      <div className="mb-4">
        <Link href="/projects" className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink">
          <ArrowLeft size={12} /> Projects
        </Link>
        <div className="mt-1.5 flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] sm:text-2xl font-bold text-ink tracking-tight leading-tight">{p.title}</h1>
            <p className="text-[12.5px] text-muted mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="inline-flex items-center gap-1">
                {p.private ? <Lock size={11} /> : <Unlock size={11} />}
                {p.private ? 'Private — members only' : 'Members only'}
              </span>
              <span>{STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL] || p.stage}</span>
              {p.due_on && <span className={overdue ? 'text-rose-600 font-semibold' : ''}>Due {nice(p.due_on)}</span>}
              <span className="tabular-nums">{total - open} of {total} done{overdue ? ` · ${overdue} overdue` : ''}</span>
            </p>
          </div>
        </div>
        {p.summary && <p className="text-[13.5px] text-ink/85 mt-2 max-w-3xl">{p.summary}</p>}
        {err && <p className="mt-2 text-[12.5px] text-rose-700">{err}</p>}
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
        {/* ── TASKS ── */}
        <div className="space-y-3">
          {sections.map(sec => (
            <Section key={sec.name || '__none'} name={sec.name} tasks={sec.tasks} canEdit={canEdit} busy={busy}
              openId={openTask} onOpen={setOpenTask} act={act} />
          ))}
          {canEdit && (
            <NewSection onAdd={name => act({ action: 'taskAdd', title: 'First task', section: name })} busy={busy} />
          )}
          {total === 0 && !canEdit && (
            <p className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-[13px] text-muted">Nothing here yet.</p>
          )}
        </div>

        {/* ── SIDE: people and what it is about ── */}
        <div className="space-y-3">
          <MembersPanel p={p} roster={roster} me={me} canEdit={canEdit} superadmin={superadmin} act={act} busy={busy} />
          <LinksPanel p={p} canEdit={canEdit} act={act} busy={busy} />
        </div>
      </div>

      {current && (
        <TaskDrawer task={current} p={p} roster={roster} canEdit={canEdit} busy={busy}
          onClose={() => setOpenTask(null)} act={act} />
      )}
    </div>
  )
}

function findTask(list: Task[], id: string): Task | null {
  for (const t of list) { if (t.id === id) return t; const s = findTask(t.subtasks, id); if (s) return s }
  return null
}

// ── A SECTION OF TASKS ────────────────────────────────────────────────────────────────────────
function Section({ name, tasks, canEdit, busy, openId, onOpen, act }: {
  name: string; tasks: Task[]; canEdit: boolean; busy: boolean; openId: string | null
  onOpen: (id: string) => void; act: (b: any) => Promise<any>
}) {
  const [collapsed, setCollapsed] = useState(false)
  const done = tasks.filter(t => t.status === 'done').length
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <button onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-app/60 border-b border-line text-left">
        {collapsed ? <ChevronRight size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
        <span className="text-[12.5px] font-bold text-ink">{name || 'Tasks'}</span>
        <span className="text-[11px] text-muted tabular-nums">{done}/{tasks.length}</span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-line">
          {tasks.map(t => <TaskRow key={t.id} t={t} depth={0} canEdit={canEdit} busy={busy} open={openId === t.id} onOpen={onOpen} act={act} />)}
          {canEdit && <QuickAdd section={name} act={act} busy={busy} />}
        </div>
      )}
    </div>
  )
}

function TaskRow({ t, depth, canEdit, busy, open, onOpen, act }: {
  t: Task; depth: number; canEdit: boolean; busy: boolean; open: boolean
  onOpen: (id: string) => void; act: (b: any) => Promise<any>
}) {
  const Icon = STATUS_ICON[t.status] || Circle
  const late = t.status !== 'done' && !!t.due_on && t.due_on < today()
  const next = (s: string) => (s === 'done' ? 'todo' : 'done')   // one tap toggles done; the drawer has the four states
  return (
    <>
      <div className={'flex items-center gap-2.5 px-3 py-2 cursor-pointer ' + (open ? 'bg-brand-50/60' : 'hover:bg-app/50')}
        style={{ paddingLeft: 12 + depth * 22 }} onClick={() => onOpen(t.id)}>
        {depth > 0 && <CornerDownRight size={11} className="text-muted shrink-0 -ml-1" />}
        <button disabled={!canEdit || busy} onClick={e => { e.stopPropagation(); act({ action: 'taskSet', taskId: t.id, status: next(t.status) }) }}
          className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center shrink-0 disabled:opacity-60 ' + STATUS_CLS[t.status]}
          title={TASK_STATUS_LABEL[t.status]}>
          <Icon size={11} strokeWidth={3} />
        </button>
        <span className={'min-w-0 flex-1 text-[13px] truncate ' + (t.status === 'done' ? 'text-muted line-through' : 'text-ink')}>{t.title}</span>
        {t.assignees.length > 0 && (
          <span className="hidden sm:inline text-[11px] text-muted truncate max-w-[140px]">{t.assignees.map(a => first(a.display)).join(', ')}</span>
        )}
        {t.due_on && <span className={'text-[11px] tabular-nums shrink-0 ' + (late ? 'text-rose-600 font-bold' : 'text-muted')}>{nice(t.due_on)}</span>}
        {t.priority === 'urgent' && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-rose-100 text-rose-700 shrink-0">Urgent</span>}
        {t.priority === 'high' && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">High</span>}
        {t.subtasks.length > 0 && <span className="text-[11px] text-muted tabular-nums shrink-0">{t.subtasks.filter(s => s.status === 'done').length}/{t.subtasks.length}</span>}
      </div>
      {t.subtasks.map(s => <TaskRow key={s.id} t={s} depth={depth + 1} canEdit={canEdit} busy={busy} open={false} onOpen={onOpen} act={act} />)}
    </>
  )
}

// One text box, Enter to add, stays focused for the next one. Capturing a task is one keystroke.
function QuickAdd({ section, act, busy, parentId }: { section: string; act: (b: any) => Promise<any>; busy: boolean; parentId?: string }) {
  const [v, setV] = useState('')
  const ref = useRef<HTMLInputElement | null>(null)
  const go = async () => {
    const title = v.trim(); if (!title) return
    setV('')
    await act({ action: 'taskAdd', title, section: section || undefined, parentId })
    ref.current?.focus()
  }
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5" style={{ paddingLeft: parentId ? 34 : 12 }}>
      <Plus size={13} className="text-muted shrink-0" />
      <input ref={ref} value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }}
        placeholder={parentId ? 'Add a subtask…' : 'Add a task…'} disabled={busy}
        className="flex-1 bg-transparent text-[13px] py-1 focus:outline-none placeholder:text-muted/70" />
    </div>
  )
}

function NewSection({ onAdd, busy }: { onAdd: (name: string) => void; busy: boolean }) {
  const [on, setOn] = useState(false); const [v, setV] = useState('')
  if (!on) return <button onClick={() => setOn(true)} className="text-[12.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1"><Plus size={12} /> Add section</button>
  return (
    <div className="flex items-center gap-2">
      <input autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="Section name"
        onKeyDown={e => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); setOn(false) } if (e.key === 'Escape') setOn(false) }}
        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px]" disabled={busy} />
      <button onClick={() => { if (v.trim()) { onAdd(v.trim()); setV(''); setOn(false) } }} disabled={busy || !v.trim()}
        className="rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] font-bold disabled:opacity-40">Add</button>
      <button onClick={() => setOn(false)} className="text-muted hover:text-ink"><X size={13} /></button>
    </div>
  )
}

// ── THE TASK DRAWER ───────────────────────────────────────────────────────────────────────────
// Everything about one task, editable in place. Fields save on blur; status and assignees save
// on change. There is no Save button because there is nothing to batch — each field is its own
// fact, and a form that holds six unsaved facts is a form that loses them.
function TaskDrawer({ task, p, roster, canEdit, busy, onClose, act }: {
  task: Task; p: ProjectFull; roster: Roster; canEdit: boolean; busy: boolean; onClose: () => void; act: (b: any) => Promise<any>
}) {
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.description || '')
  const [who, setWho] = useState('')
  useEffect(() => { setTitle(task.title); setDesc(task.description || '') }, [task.id, task.title, task.description])

  const set = (patch: any) => act({ action: 'taskSet', taskId: task.id, ...patch })
  const assignees = task.assignees
  const addPerson = (name: string) => {
    const n = name.trim(); if (!n) return
    set({ assignees: [...assignees.map(a => a.email || a.display), n] }); setWho('')
  }
  const dropPerson = (a: Person) => set({ assignees: assignees.filter(x => x.person_key !== a.person_key).map(x => x.email || x.display) })
  const suggestions = who.trim().length >= 1
    ? roster.filter(r => r.display.toLowerCase().includes(who.toLowerCase()) && !assignees.some(a => a.person_key === (r.email || r.display).toLowerCase() || a.display === r.display)).slice(0, 6)
    : []
  const late = task.status !== 'done' && !!task.due_on && task.due_on < today()

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/25 lg:bg-transparent" onClick={onClose} />
      <div className="fixed z-50 inset-x-0 bottom-0 lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[460px] max-h-[88vh] lg:max-h-none
                      bg-white border-t lg:border-t-0 lg:border-l border-line shadow-2xl rounded-t-2xl lg:rounded-none flex flex-col">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <select value={task.status} disabled={!canEdit || busy} onChange={e => set({ status: e.target.value })}
            className={'rounded-lg border px-2 py-1 text-[12px] font-bold ' + STATUS_CLS[task.status]}>
            {Object.entries(TASK_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="text-[11px] text-muted truncate flex-1">{task.section || 'No section'}{task.parent_id ? ' · subtask' : ''}</span>
          {canEdit && (
            <button onClick={async () => { if (confirm('Delete this task' + (task.subtasks.length ? ' and its subtasks' : '') + '?')) { await act({ action: 'taskDelete', taskId: task.id }); onClose() } }}
              disabled={busy} className="text-muted hover:text-rose-600" title="Delete task"><Trash2 size={14} /></button>
          )}
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== task.title) set({ title }) }}
            disabled={!canEdit} className="w-full text-[17px] font-bold text-ink bg-transparent focus:outline-none focus:bg-app/60 rounded px-1 -mx-1" />

          {/* who · when · how urgent */}
          <div className="grid grid-cols-[92px_1fr] gap-y-2.5 gap-x-3 items-start text-[13px]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted pt-1.5">Assignees</span>
            <div>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {assignees.map(a => (
                  <span key={a.person_key} className="inline-flex items-center gap-1 rounded-full bg-app border border-line px-2 py-0.5 text-[12px]">
                    {a.display}{!a.email && <span className="text-muted" title="No login — can be named, not notified">·</span>}
                    {canEdit && <button onClick={() => dropPerson(a)} className="text-muted hover:text-rose-600"><X size={10} /></button>}
                  </span>
                ))}
                {assignees.length === 0 && <span className="text-[12px] text-rose-600 font-semibold">Nobody yet</span>}
              </div>
              {canEdit && (
                <div className="relative">
                  <input value={who} onChange={e => setWho(e.target.value)} placeholder="Add a person…"
                    onKeyDown={e => { if (e.key === 'Enter') addPerson(suggestions[0]?.email || suggestions[0]?.display || who) }}
                    className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px]" />
                  {suggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-line bg-white shadow-lg overflow-hidden">
                      {suggestions.map(r => (
                        <button key={r.email || r.display} onClick={() => addPerson(r.email || r.display)}
                          className="w-full text-left px-2.5 py-1.5 text-[12.5px] hover:bg-app flex items-center justify-between gap-2">
                          <span>{r.display}</span>
                          <span className="text-[10px] text-muted">{r.notifiable ? 'can be notified' : 'name only'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted pt-1.5">Due</span>
            <div className="flex items-center gap-2">
              <input type="date" value={task.due_on || ''} disabled={!canEdit || busy} onChange={e => set({ due_on: e.target.value || null })}
                className={'rounded-lg border px-2 py-1 text-[12.5px] bg-white ' + (late ? 'border-rose-300 text-rose-700' : 'border-line')} />
              {late && <span className="text-[11px] font-bold text-rose-600">Overdue</span>}
            </div>

            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted pt-1.5">Priority</span>
            <select value={task.priority} disabled={!canEdit || busy} onChange={e => set({ priority: e.target.value })}
              className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px] w-fit">
              {['low', 'normal', 'high', 'urgent'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
            </select>

            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted pt-1.5">Section</span>
            <input value={task.section || ''} disabled={!canEdit} placeholder="None"
              onBlur={e => { if ((e.target.value || null) !== (task.section || null)) set({ section: e.target.value }) }}
              onChange={() => {}} className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Notes</p>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => { if (desc !== (task.description || '')) set({ description: desc }) }}
              disabled={!canEdit} rows={5} placeholder="What this is, what done looks like, anything the person doing it needs to know."
              className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] leading-relaxed focus:outline-none focus:border-ink" />
          </div>

          {!task.parent_id && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Subtasks <span className="normal-case font-normal tabular-nums">{task.subtasks.filter(s => s.status === 'done').length}/{task.subtasks.length}</span></p>
              <div className="rounded-lg border border-line divide-y divide-line">
                {task.subtasks.map(s => (
                  <div key={s.id} className="flex items-center gap-2 px-2.5 py-1.5">
                    <button disabled={!canEdit || busy} onClick={() => act({ action: 'taskSet', taskId: s.id, status: s.status === 'done' ? 'todo' : 'done' })}
                      className={'w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + STATUS_CLS[s.status]}>
                      {s.status === 'done' && <Check size={9} strokeWidth={3} />}
                    </button>
                    <span className={'text-[12.5px] flex-1 ' + (s.status === 'done' ? 'line-through text-muted' : 'text-ink')}>{s.title}</span>
                    {s.due_on && <span className="text-[11px] text-muted tabular-nums">{nice(s.due_on)}</span>}
                  </div>
                ))}
                {canEdit && <QuickAdd section={task.section || ''} parentId={task.id} act={act} busy={busy} />}
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted">
            Created {task.created_by ? `by ${first(task.created_by)} ` : ''}{nice(task.created_at.slice(0, 10))}
            {task.done_at && <> · done {nice(task.done_at.slice(0, 10))}{task.done_by ? ` by ${first(task.done_by)}` : ''}</>}
          </p>
          <p className="text-[11px] text-muted/80">Comments and files arrive in the next release.</p>
        </div>
      </div>
    </>
  )
}

// ── MEMBERS ───────────────────────────────────────────────────────────────────────────────────
function MembersPanel({ p, roster, me, canEdit, superadmin, act, busy }: {
  p: ProjectFull; roster: Roster; me: string; canEdit: boolean; superadmin: boolean; act: (b: any) => Promise<any>; busy: boolean
}) {
  const [who, setWho] = useState('')
  const [adding, setAdding] = useState(false)
  const suggestions = who.trim() ? roster.filter(r => r.display.toLowerCase().includes(who.toLowerCase())
    && !p.members.some(m => (m.email && r.email && m.email === r.email) || m.display === r.display)).slice(0, 6) : []
  const add = async (name: string) => { if (!name.trim()) return; await act({ action: 'memberAdd', person: name, role: 'editor' }); setWho(''); setAdding(false) }
  const isMe = (m: Member) => !!m.email && m.email.toLowerCase() === me.toLowerCase()

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-3 py-2 bg-app/60 border-b border-line flex items-center gap-2">
        <Users size={13} className="text-muted" />
        <span className="text-[12.5px] font-bold text-ink flex-1">People</span>
        <span className="text-[11px] text-muted tabular-nums">{p.members.length}</span>
        {canEdit && <button onClick={() => setAdding(a => !a)} className="text-muted hover:text-ink"><Plus size={13} /></button>}
      </div>
      <div className="divide-y divide-line">
        {p.members.map(m => (
          <div key={m.id} className="px-3 py-2 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold inline-flex items-center justify-center shrink-0">{m.display.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] text-ink truncate">{m.display}{isMe(m) ? <span className="text-muted"> (you)</span> : ''}</span>
              <span className="block text-[10.5px] text-muted">{m.email ? 'can be notified' : 'name only'}</span>
            </span>
            {canEdit ? (
              <select value={m.role} disabled={busy} onChange={e => act({ action: 'memberRole', personKey: m.person_key, role: e.target.value })}
                className="text-[11px] rounded border border-line bg-white px-1 py-0.5">
                <option value="owner">Owner</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
              </select>
            ) : <span className="text-[11px] text-muted">{m.role}</span>}
            {canEdit && !isMe(m) && (
              <button onClick={() => act({ action: 'memberRemove', personKey: m.person_key })} disabled={busy} className="text-muted hover:text-rose-600" title="Remove"><X size={12} /></button>
            )}
          </div>
        ))}
      </div>
      {adding && canEdit && (
        <div className="p-2 border-t border-line relative">
          <input autoFocus value={who} onChange={e => setWho(e.target.value)} placeholder="Name or email…"
            onKeyDown={e => { if (e.key === 'Enter') add(suggestions[0]?.email || suggestions[0]?.display || who); if (e.key === 'Escape') setAdding(false) }}
            className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px]" />
          {suggestions.length > 0 && (
            <div className="absolute z-10 left-2 right-2 mt-1 rounded-lg border border-line bg-white shadow-lg overflow-hidden">
              {suggestions.map(r => (
                <button key={r.email || r.display} onClick={() => add(r.email || r.display)}
                  className="w-full text-left px-2.5 py-1.5 text-[12.5px] hover:bg-app flex items-center justify-between gap-2">
                  <span>{r.display}</span><span className="text-[10px] text-muted">{r.notifiable ? 'can be notified' : 'name only'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="px-3 py-2 border-t border-line bg-app/40 flex items-center gap-2">
        <span className="text-[11px] text-muted flex-1">
          {p.private ? 'Only these people can open this project.' : 'Only these people can open this project.'}{superadmin && !p.members.some(isMe) ? ' You see it as owner.' : ''}
        </span>
        {canEdit && (
          <button onClick={() => act({ action: 'setPrivate', private: !p.private })} disabled={busy}
            className="text-[11px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1" title={p.private ? 'Marked as a one-on-one' : 'Mark as a one-on-one'}>
            {p.private ? <Lock size={11} /> : <Unlock size={11} />}{p.private ? '1:1' : 'Mark 1:1'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── WHAT IT IS ABOUT: real Guesty things ──────────────────────────────────────────────────────
function LinksPanel({ p, canEdit, act, busy }: { p: ProjectFull; canEdit: boolean; act: (b: any) => Promise<any>; busy: boolean }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch('/api/projects/search?q=' + encodeURIComponent(q.trim()), { cache: 'no-store' })
        const j = await r.json(); setHits(j?.hits || [])
      } catch { setHits([]) } finally { setSearching(false) }
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  const attach = async (h: Hit) => {
    const body: any = { action: 'link', kind: h.kind, refId: h.id, label: h.label }
    if (h.kind === 'building' || h.kind === 'owner') body.expandUnitIds = h.unitIds
    if (h.kind === 'reservation') body.label = `${h.label} · ${h.checkIn} → ${h.checkOut}`
    await act(body); setQ(''); setHits([]); setOpen(false)
  }

  // Units that arrived as part of a building are shown under it, not as a flat list of thirty.
  const buildings = p.links.filter(l => l.kind === 'building')
  const units = p.links.filter(l => l.kind === 'listing')
  const others = p.links.filter(l => l.kind === 'reservation' || l.kind === 'owner')
  const unitsDone = units.filter(u => u.done).length

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-3 py-2 bg-app/60 border-b border-line flex items-center gap-2">
        <Building2 size={13} className="text-muted" />
        <span className="text-[12.5px] font-bold text-ink flex-1">About</span>
        {units.length > 0 && <span className="text-[11px] text-muted tabular-nums">{unitsDone}/{units.length} units</span>}
        {canEdit && <button onClick={() => setOpen(o => !o)} className="text-muted hover:text-ink"><Plus size={13} /></button>}
      </div>

      {open && canEdit && (
        <div className="p-2 border-b border-line">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Building, unit, guest, code, or owner…"
              onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQ('') } }}
              className="w-full rounded-lg border border-line bg-white pl-7 pr-2 py-1.5 text-[12.5px]" />
            {searching && <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          {hits.length > 0 && (
            <div className="mt-1.5 rounded-lg border border-line divide-y divide-line max-h-[260px] overflow-y-auto">
              {hits.map(h => { const I = LINK_ICON[h.kind]; return (
                <button key={h.kind + h.id} onClick={() => attach(h)} disabled={busy}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-app flex items-start gap-2">
                  <I size={12} className="text-muted mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-ink truncate">{h.label}</span>
                    <span className="block text-[10.5px] text-muted truncate">{h.sub}</span>
                  </span>
                  <span className="ml-auto text-[9.5px] font-bold uppercase tracking-wide text-muted shrink-0">{h.kind}</span>
                </button>
              )})}
            </div>
          )}
          {q.trim().length >= 2 && !searching && hits.length === 0 && <p className="mt-1.5 text-[11.5px] text-muted px-1">Nothing in Guesty matches.</p>}
        </div>
      )}

      <div className="divide-y divide-line">
        {p.links.length === 0 && !open && (
          <p className="px-3 py-3 text-[12px] text-muted">Not attached to anything yet.{canEdit ? ' Add a building, unit, reservation or owner.' : ''}</p>
        )}
        {buildings.map(b => (
          <div key={b.ref_id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <Building2 size={12} className="text-muted shrink-0" />
              <span className="text-[12.5px] font-semibold text-ink flex-1 truncate">{b.label || b.ref_id}</span>
              <span className="text-[11px] text-muted tabular-nums">{units.length} units</span>
              {canEdit && <button onClick={() => act({ action: 'unlink', kind: 'building', refId: b.ref_id })} disabled={busy} className="text-muted hover:text-rose-600"><X size={11} /></button>}
            </div>
          </div>
        ))}
        {units.length > 0 && (
          <div className="px-3 py-2">
            <div className="flex flex-wrap gap-1">
              {units.map(u => (
                <button key={u.ref_id} disabled={!canEdit || busy} onClick={() => act({ action: 'linkDone', kind: 'listing', refId: u.ref_id, done: !u.done })}
                  title={u.done ? 'Done — click to reopen' : 'Click when this unit is done'}
                  className={'text-[11px] px-1.5 py-0.5 rounded border ' + (u.done ? 'bg-emerald-50 border-emerald-200 text-emerald-700 line-through' : 'bg-white border-line text-ink hover:border-ink')}>
                  {u.label || u.ref_id}
                </button>
              ))}
            </div>
          </div>
        )}
        {others.map(o => { const I = LINK_ICON[o.kind]; return (
          <div key={o.kind + o.ref_id} className="px-3 py-2 flex items-center gap-2">
            <I size={12} className="text-muted shrink-0" />
            <span className="text-[12.5px] text-ink flex-1 truncate">{o.label || o.ref_id}</span>
            <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted">{o.kind}</span>
            {canEdit && <button onClick={() => act({ action: 'unlink', kind: o.kind, refId: o.ref_id })} disabled={busy} className="text-muted hover:text-rose-600"><X size={11} /></button>}
          </div>
        )})}
      </div>
    </div>
  )
}

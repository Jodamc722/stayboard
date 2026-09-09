'use client'
// THE PROJECT PAGE — where the task is the atom.
//
// Jon, 2026-09-08: an Asana-style board. This is the surface that makes it one: a list of tasks
// grouped by section, a drawer that opens on any task with everything about it, the people on the
// project, and the real Guesty things it is attached to. Wave 2 added the conversation: comments
// and files on every task and on the project, and one activity feed that records what people did.
//
// Design notes, in the order they matter:
//   • The task list is the page. Not a tab, not a card — the first thing on screen and most of it.
//   • Adding a task is a text box at the bottom of each section, like Asana, so the friction of
//     capturing a thought is one keystroke, not a form.
//   • The drawer edits in place and saves on blur. Nothing has a Save button except things that
//     change who can see the project.
//   • Members and Guesty links are a side column on desktop and stacked below on a phone.
//   • Comments and events share one feed. A task's drawer shows its slice; the project shows all of
//     it. Reading the feed is how someone who missed a day catches up, so events read as sentences.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Plus, Check, Circle, CircleDot, Ban, ChevronRight, ChevronDown, X, Users, Building2,
  Home, CalendarDays, UserRound, Loader2, Lock, Unlock, Search, Trash2, CornerDownRight,
  MessageSquare, Paperclip, FileText, Send, Pencil, Download, Activity, Repeat, SlidersHorizontal, LayoutTemplate, LayoutList, Columns3, ArrowUp, ArrowDown, MoreHorizontal, Save,
  CalendarRange, ChevronLeft, GripVertical, ShieldAlert, Bug, Wrench, ExternalLink, ArrowRightCircle,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import type { ProjectFull, Task, Member, Person, Note, ProjectFile } from '@/lib/projects-shared'
import { STAGE_LABEL, TASK_STATUS_LABEL, isImage, fmtBytes, ago, prefsOf, settingsOf, describeRecurrence, WEEKDAYS, ACCENT_CLS, ACCENTS, ICONS, iconOf, type BoardSettings, type Recurrence, type Accent } from '@/lib/projects-shared'

type Roster = { display: string; email: string | null; notifiable: boolean }[]
type Hit =
  | { kind: 'building'; id: string; label: string; sub: string; unitIds: string[] }
  | { kind: 'listing'; id: string; label: string; sub: string; building: string | null }
  | { kind: 'reservation'; id: string; label: string; sub: string; listingId: string; checkIn: string; checkOut: string; status: string }
  | { kind: 'owner'; id: string; label: string; sub: string; unitIds: string[] }
  | { kind: 'claim'; id: string; label: string; sub: string }
  | { kind: 'glitch'; id: string; label: string; sub: string; listingId: string | null }
  | { kind: 'task'; id: string; label: string; sub: string; listingId: string | null }

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
const LINK_ICON: Record<string, any> = { building: Building2, listing: Home, reservation: CalendarDays, owner: UserRound, claim: ShieldAlert, glitch: Bug, task: Wrench }
const TONE_CLS: Record<string, string> = { open: 'bg-white border-line text-ink', done: 'bg-emerald-50 border-emerald-200 text-emerald-700', bad: 'bg-rose-50 border-rose-200 text-rose-700', wait: 'bg-amber-50 border-amber-200 text-amber-800' }
// Accent classes come from lib/projects-shared (ACCENT_CLS) so the rail, the tiles and this page
// agree on what "violet" looks like. Shaped here for the two spots this page needs.
const ACCENT = Object.fromEntries((Object.keys(ACCENT_CLS) as Accent[]).map(k => [k, { bar: ACCENT_CLS[k].soft, dot: ACCENT_CLS[k].solid, ring: ACCENT_CLS[k].ring }])) as Record<Accent, { bar: string; dot: string; ring: string }>

export function ProjectPage({ initial, me, canEdit, canFull, superadmin }: {
  initial: ProjectFull; me: string; canEdit: boolean; canFull: boolean; superadmin: boolean
}) {
  const [p, setP] = useState<ProjectFull>(initial)
  const [roster, setRoster] = useState<Roster>([])
  // A notification links straight to its task: /projects/<id>?task=<taskId> opens the drawer.
  const sp = useSearchParams()
  const [openTask, setOpenTask] = useState<string | null>(() => {
    const t = sp?.get('task'); return t && findTask(initial.tasks, t) ? t : null
  })
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

  // Files go up as multipart to their own route; the response carries the refreshed project the
  // same way an action does. Partial refusals (one bad type in a batch of five) are surfaced, not
  // swallowed — the four that saved are on screen and the one that did not is named.
  const upload = useCallback(async (files: FileList | File[], taskId?: string | null): Promise<boolean> => {
    const list = Array.from(files || []); if (!list.length) return false
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      for (const f of list) fd.append('file', f)
      if (taskId) fd.append('taskId', taskId)
      const r = await fetch('/api/projects/' + p.id + '/upload', { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'The upload did not finish.')
      if (j.project) setP(j.project); else await reload()
      if (Array.isArray(j.refused) && j.refused.length) setErr('Saved ' + j.saved + '; not saved: ' + j.refused.join('; '))
      return true
    } catch (e: any) { setErr(String(e?.message || e)); return false } finally { setBusy(false) }
  }, [p.id, reload])

  // Per-task counts for the row badges — one pass over the feed and the files, not one per row.
  const counts = useMemo(() => {
    const c: Record<string, { comments: number; files: number }> = {}
    const bump = (id: string | null, k: 'comments' | 'files') => { if (!id) return; (c[id] = c[id] || { comments: 0, files: 0 })[k]++ }
    for (const n of p.notes) if (n.kind === 'comment') bump(n.task_id, 'comments')
    for (const f of p.photos) bump(f.task_id, 'files')
    return c
  }, [p.notes, p.photos])
  const nameOf = useCallback((email: string | null) => {
    if (!email) return 'Someone'
    const m = p.members.find(x => x.email && x.email.toLowerCase() === email.toLowerCase())
    return m ? m.display : (email.includes('@') ? email.split('@')[0] : email)
  }, [p.members])

  // ── SECTIONS ──────────────────────────────────────────────────────────────────────────────
  // The order sections appear is the order they were first used, with "no section" last. A 1:1
  // template will create them in the right order; an ad-hoc project grows them as it goes.
  // HOW THIS BOARD LOOKS is the owner's choice (Jon, 2026-09-08: "customise the board however they
  // want"): list or columns, an accent, whether done tasks show, and the order of sections. Sections
  // named in the order but holding no task still render, so a fresh personal board shows its
  // "Doing" and "Done" columns before anything is in them.
  const settings = useMemo(() => settingsOf(p.settings), [p.settings])
  const sections = useMemo(() => {
    const order: string[] = []
    const by: Record<string, Task[]> = {}
    for (const k of settings.sectionOrder) if (!(k in by)) { by[k] = []; order.push(k) }
    for (const t of p.tasks) {
      const k = t.section || ''
      if (!(k in by)) { by[k] = []; if (k) order.push(k) }
      by[k].push(t)
    }
    if ('' in by && !order.includes('')) order.push('')
    const keep = (t: Task) => !settings.hideDone || t.status !== 'done'
    return order.map(k => ({ name: k, tasks: by[k].filter(keep) })).filter(sec => sec.name !== '' || sec.tasks.length || !settings.hideDone)
  }, [p.tasks, settings])
  const accent = ACCENT[settings.accent]
  // A viewer-role member can switch views for themselves without being able to save it.
  const [localView, setLocalView] = useState<BoardSettings['view'] | null>(null)
  const view = (canEdit ? settings.view : (localView || settings.view))
  // Drag state for tasks: what is being dragged, so drop targets can accept it.
  const [dragId, setDragId] = useState<string | null>(null)
  const moveTask = (taskId: string, section: string, beforeId: string | null) => act({ action: 'taskMove', taskId, section, beforeId })
  // The wrench on a row opens the drawer straight onto the Breezeway box — push from the board.
  const [bzFocus, setBzFocus] = useState<string | null>(null)
  const pushTask = (taskId: string) => { setBzFocus(taskId); setOpenTask(taskId) }

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
          <span className={'w-11 h-11 rounded-2xl border grid place-items-center text-[22px] shrink-0 ' + accent.bar} aria-hidden>{iconOf(p)}</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] sm:text-2xl font-bold text-ink tracking-tight leading-tight">{p.title}</h1>
            <p className="text-[12.5px] text-muted mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="inline-flex items-center gap-1">
                {p.private ? <Lock size={11} /> : <Unlock size={11} />}
                {p.kind === 'personal' ? 'Your board — only you' : p.kind === 'one_on_one' ? 'One-on-one — private' : p.private ? 'Private — members only' : 'Members only'}
              </span>
              {p.kind !== 'personal' && <span>{STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL] || p.stage}</span>}
              <RecurChip p={p} canEdit={canEdit} act={act} busy={busy} />
              {p.due_on && <span className={overdue ? 'text-rose-600 font-semibold' : ''}>Due {nice(p.due_on)}</span>}
              <span className="tabular-nums">{total - open} of {total} done{overdue ? ` · ${overdue} overdue` : ''}</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Customize settings={settings} sections={sections.map(x => x.name)} canEdit={canEdit} act={act} busy={busy} />
            <MoreMenu p={p} canEdit={canEdit} act={act} busy={busy} />
          </div>
        </div>
        {p.summary && <p className="text-[13.5px] text-ink/85 mt-2 max-w-3xl">{p.summary}</p>}
        {/* VIEWS, like Asana's tabs under the title. The choice is saved on the project. */}
        <div className="mt-3 flex items-center gap-1 border-b border-line">
          {([['list', 'List', LayoutList], ['board', 'Board', Columns3], ['calendar', 'Calendar', CalendarRange]] as const).map(([v, label, I]) => (
            <button key={v} onClick={() => canEdit ? act({ action: 'setSettings', settings: { view: v } }) : setLocalView(v)}
              className={'inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold -mb-px border-b-2 ' + (view === v ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
              <I size={13} /> {label}
            </button>
          ))}
        </div>
        {err && <p className="mt-2 text-[12.5px] text-rose-700">{err}</p>}
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
        {/* ── TASKS ── */}
        <div className="space-y-3">
          {view === 'calendar' ? (
            <CalendarView tasks={p.tasks} onOpen={setOpenTask} accent={accent} hideDone={settings.hideDone} />
          ) : view === 'board' ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {sections.map(sec => (
                <SectionColumn key={sec.name || '__none'} name={sec.name} tasks={sec.tasks} canEdit={canEdit} busy={busy}
                  openId={openTask} onOpen={setOpenTask} act={act} counts={counts} accent={accent}
                  dragId={dragId} setDragId={setDragId} onMove={moveTask} onPush={pushTask} />
              ))}
              {canEdit && (
                <div className="w-[220px] shrink-0 pt-1">
                  <NewSection onAdd={name => act({ action: 'setSettings', settings: { sectionOrder: [...sections.map(x => x.name).filter(x => x && x !== name), name] } })} busy={busy} />
                </div>
              )}
            </div>
          ) : (
            sections.map(sec => (
              <Section key={sec.name || '__none'} name={sec.name} tasks={sec.tasks} canEdit={canEdit} busy={busy}
                openId={openTask} onOpen={setOpenTask} act={act} counts={counts} accent={accent}
                dragId={dragId} setDragId={setDragId} onMove={moveTask} onPush={pushTask} />
            ))
          )}
          {canEdit && view === 'list' && (
            <NewSection onAdd={name => act({ action: 'setSettings', settings: { sectionOrder: [...sections.map(x => x.name).filter(x => x && x !== name), name] } })} busy={busy} />
          )}
          {total === 0 && !canEdit && (
            <p className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-[13px] text-muted">Nothing here yet.</p>
          )}
          <ActivityPanel p={p} me={me} nameOf={nameOf} act={act} busy={busy} onOpen={setOpenTask} superadmin={superadmin} />
        </div>

        {/* ── SIDE: people, files and what it is about ── */}
        <div className="space-y-3">
          <MembersPanel p={p} roster={roster} me={me} canEdit={canEdit} superadmin={superadmin} act={act} busy={busy} />
          <LinksPanel p={p} canEdit={canEdit} act={act} busy={busy} />
          <FilesPanel p={p} canEdit={canEdit} act={act} busy={busy} upload={upload} onOpen={setOpenTask} />
        </div>
      </div>

      {current && (
        <TaskDrawer task={current} p={p} roster={roster} me={me} nameOf={nameOf} canEdit={canEdit} busy={busy}
          onClose={() => { setOpenTask(null); setBzFocus(null) }} act={act} upload={upload} superadmin={superadmin} bzFocus={bzFocus === current.id} />
      )}
    </div>
  )
}

function findTask(list: Task[], id: string): Task | null {
  for (const t of list) { if (t.id === id) return t; const s = findTask(t.subtasks, id); if (s) return s }
  return null
}

// ── A SECTION OF TASKS ────────────────────────────────────────────────────────────────────────
type Counts = Record<string, { comments: number; files: number }>
type AccentCls = typeof ACCENT[keyof typeof ACCENT]
type DragProps = { dragId: string | null; setDragId: (id: string | null) => void; onMove: (taskId: string, section: string, beforeId: string | null) => Promise<any>; onPush?: (taskId: string) => void }

// ── A SECTION HEADER YOU CAN RENAME OR REMOVE ─────────────────────────────────────────────────
// Click the name to rename it; the × removes the section and drops its tasks to "no section".
function SectionName({ name, canEdit, act, busy, className }: { name: string; canEdit: boolean; act: (b: any) => Promise<any>; busy: boolean; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(name)
  useEffect(() => setV(name), [name])
  if (!name) return <span className={className}>Tasks</span>
  if (editing && canEdit) {
    return (
      <input autoFocus value={v} onChange={e => setV(e.target.value)} onClick={e => e.stopPropagation()}
        onBlur={() => { setEditing(false); if (v.trim() && v.trim() !== name) act({ action: 'sectionRename', from: name, to: v.trim() }) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(name); setEditing(false) } }}
        className="rounded-md border border-line bg-white px-1.5 py-0.5 text-[12.5px] font-bold text-ink w-40" disabled={busy} />
    )
  }
  return (
    <span className={'inline-flex items-center gap-1 group/sec ' + (className || '')}>
      <span onClick={e => { if (canEdit) { e.stopPropagation(); setEditing(true) } }} title={canEdit ? 'Rename section' : undefined} className={canEdit ? 'cursor-text hover:underline decoration-line' : ''}>{name}</span>
      {canEdit && (
        <button onClick={e => { e.stopPropagation(); if (confirm(`Remove the “${name}” section? Its tasks stay, without a section.`)) act({ action: 'sectionDelete', name }) }}
          disabled={busy} title="Remove section" className="opacity-0 group-hover/sec:opacity-100 text-muted hover:text-rose-600"><X size={11} /></button>
      )}
    </span>
  )
}

// Drop target between rows/cards. Shows a line while something is over it.
function DropSlot({ active, onDrop, className }: { active: boolean; onDrop: () => void; className?: string }) {
  const [over, setOver] = useState(false)
  if (!active) return null
  return (
    <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); onDrop() }}
      className={'transition-all ' + (over ? 'h-8 rounded-lg border-2 border-dashed border-brand-400 bg-brand-50/60 my-1' : 'h-2 ' ) + (className || '')} />
  )
}

function Section({ name, tasks, canEdit, busy, openId, onOpen, act, counts, accent, dragId, setDragId, onMove, onPush }: {
  name: string; tasks: Task[]; canEdit: boolean; busy: boolean; openId: string | null
  onOpen: (id: string) => void; act: (b: any) => Promise<any>; counts: Counts; accent: AccentCls
} & DragProps) {
  const [collapsed, setCollapsed] = useState(false)
  const done = tasks.filter(t => t.status === 'done').length
  const dragging = !!dragId && canEdit
  return (
    <div className={'rounded-2xl border bg-white overflow-hidden ' + (dragging ? 'border-brand-200' : 'border-line')}
      onDragOver={e => { if (dragging) e.preventDefault() }}
      onDrop={e => { if (dragging && dragId) { e.preventDefault(); onMove(dragId, name, null); setDragId(null) } }}>
      <button onClick={() => setCollapsed(c => !c)}
        className={'w-full flex items-center gap-2 px-3 py-2 border-b text-left ' + accent.bar}>
        {collapsed ? <ChevronRight size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
        <SectionName name={name} canEdit={canEdit} act={act} busy={busy} className="text-[12.5px] font-bold text-ink" />
        <span className="text-[11px] text-muted tabular-nums">{done}/{tasks.length}</span>
      </button>
      {!collapsed && (
        <div>
          {tasks.map(t => (
            <div key={t.id}>
              <DropSlot active={dragging && dragId !== t.id} onDrop={() => { if (dragId) { onMove(dragId, name, t.id); setDragId(null) } }} className="mx-3" />
              <TaskRow t={t} depth={0} canEdit={canEdit} busy={busy} open={openId === t.id} onOpen={onOpen} act={act} counts={counts}
                dragId={dragId} setDragId={setDragId} onMove={onMove} onPush={onPush} />
            </div>
          ))}
          <DropSlot active={dragging} onDrop={() => { if (dragId) { onMove(dragId, name, null); setDragId(null) } }} className="mx-3" />
          {canEdit && <div className="border-t border-line"><QuickAdd section={name} act={act} busy={busy} /></div>}
        </div>
      )}
    </div>
  )
}

// ── COLUMNS: the same sections side by side ───────────────────────────────────────────────────
// A personal board reads better as To do / Doing / Done across the screen; a 1:1 as Wins /
// Blockers / Follow-ups. Same data, same drawer, one preference. Cards drag between columns.
function SectionColumn({ name, tasks, canEdit, busy, openId, onOpen, act, counts, accent, dragId, setDragId, onMove, onPush }: {
  name: string; tasks: Task[]; canEdit: boolean; busy: boolean; openId: string | null
  onOpen: (id: string) => void; act: (b: any) => Promise<any>; counts: Counts; accent: AccentCls
} & DragProps) {
  const done = tasks.filter(t => t.status === 'done').length
  const dragging = !!dragId && canEdit
  return (
    <div className={'w-[268px] shrink-0 rounded-2xl p-1.5 -m-1.5 ' + (dragging ? 'bg-brand-50/40' : '')}
      onDragOver={e => { if (dragging) e.preventDefault() }}
      onDrop={e => { if (dragging && dragId) { e.preventDefault(); onMove(dragId, name, null); setDragId(null) } }}>
      <div className={'flex items-center gap-2 px-2.5 py-1.5 rounded-xl border mb-2 ' + accent.bar}>
        <span className={'w-1.5 h-1.5 rounded-full ' + accent.dot} />
        <SectionName name={name} canEdit={canEdit} act={act} busy={busy} className="text-[12.5px] font-bold text-ink flex-1 truncate" />
        <span className="text-[11px] text-muted tabular-nums">{done}/{tasks.length}</span>
      </div>
      <div className="space-y-1.5 min-h-[40px]">
        {tasks.map(t => {
          const Icon = STATUS_ICON[t.status] || Circle
          const late = t.status !== 'done' && !!t.due_on && t.due_on < today()
          const c = counts[t.id]
          return (
            <div key={t.id}>
              <DropSlot active={dragging && dragId !== t.id} onDrop={() => { if (dragId) { onMove(dragId, name, t.id); setDragId(null) } }} />
              <div onClick={() => onOpen(t.id)} draggable={canEdit}
                onDragStart={e => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDragId(null)}
                className={'rounded-xl border bg-white px-2.5 py-2 cursor-pointer hover:shadow-sm ' + (openId === t.id ? 'border-ink' : 'border-line hover:border-ink/40') + (dragId === t.id ? ' opacity-40' : '')}>
                <div className="flex items-start gap-2">
                  <button disabled={!canEdit || busy} onClick={e => { e.stopPropagation(); act({ action: 'taskSet', taskId: t.id, status: t.status === 'done' ? 'todo' : 'done' }) }}
                    className={'w-4 h-4 mt-0.5 rounded-full border-2 inline-flex items-center justify-center shrink-0 disabled:opacity-60 ' + STATUS_CLS[t.status]} title={TASK_STATUS_LABEL[t.status]}>
                    <Icon size={9} strokeWidth={3} />
                  </button>
                  <span className={'text-[12.5px] leading-snug flex-1 ' + (t.status === 'done' ? 'text-muted line-through' : 'text-ink')}>{t.title}</span>
                </div>
                {(t.assignees.length > 0 || t.due_on || t.subtasks.length > 0 || c) && (
                  <div className="mt-1.5 pl-6 flex items-center gap-2 flex-wrap text-[10.5px] text-muted">
                    {t.assignees.length > 0 && <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-brand-50 text-brand-700 text-[9px] font-bold inline-flex items-center justify-center">{t.assignees[0].display.slice(0, 1).toUpperCase()}</span><span className="truncate max-w-[110px]">{t.assignees.map(a => first(a.display)).join(', ')}</span></span>}
                    {t.due_on && <span className={'tabular-nums ' + (late ? 'text-rose-600 font-bold' : '')}>{nice(t.due_on)}</span>}
                    {t.subtasks.length > 0 && <span className="tabular-nums">{t.subtasks.filter(s => s.status === 'done').length}/{t.subtasks.length}</span>}
                    {c && c.comments > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={10} />{c.comments}</span>}
                    {c && c.files > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={10} />{c.files}</span>}
                    {t.priority === 'urgent' && <span className="font-bold uppercase text-rose-700">Urgent</span>}
                    {t.priority === 'high' && <span className="font-bold uppercase text-amber-800">High</span>}
                    {t.breezeway_task_id && <span className={'inline-flex items-center gap-0.5 font-bold uppercase px-1 rounded border ' + (TONE_CLS[t.breezeway?.tone || 'open'])}><Wrench size={9} />{t.breezeway?.status || 'BZ'}</span>}
                    {!t.breezeway_task_id && canEdit && onPush && <button onClick={e => { e.stopPropagation(); onPush(t.id) }} className="ml-auto text-muted hover:text-ink" title="Push to Breezeway"><Wrench size={11} /></button>}
                  </div>
                )}
                {!(t.assignees.length > 0 || t.due_on || t.subtasks.length > 0 || c) && canEdit && onPush && !t.breezeway_task_id && (
                  <div className="mt-1 pl-6"><button onClick={e => { e.stopPropagation(); onPush(t.id) }} className="text-muted hover:text-ink" title="Push to Breezeway"><Wrench size={11} /></button></div>
                )}
              </div>
            </div>
          )
        })}
        <DropSlot active={dragging} onDrop={() => { if (dragId) { onMove(dragId, name, null); setDragId(null) } }} />
        {canEdit && (
          <div className="rounded-xl border border-dashed border-line bg-white/60">
            <QuickAdd section={name} act={act} busy={busy} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── CALENDAR: the month, with tasks on their due dates ────────────────────────────────────────
function CalendarView({ tasks, onOpen, accent, hideDone }: { tasks: Task[]; onOpen: (id: string) => void; accent: AccentCls; hideDone: boolean }) {
  const [ym, setYm] = useState(() => today().slice(0, 7))
  const flat = useMemo(() => { const out: Task[] = []; const walk = (l: Task[]) => l.forEach(t => { out.push(t); walk(t.subtasks) }); walk(tasks); return out.filter(t => !hideDone || t.status !== 'done') }, [tasks, hideDone])
  const byDay = useMemo(() => { const m: Record<string, Task[]> = {}; for (const t of flat) if (t.due_on) (m[t.due_on] = m[t.due_on] || []).push(t); return m }, [flat])
  const first = new Date(ym + '-01T12:00:00Z')
  const startPad = first.getUTCDay()
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells: (string | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)]
  while (cells.length % 7) cells.push(null)
  const shift = (n: number) => { const d = new Date(ym + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); setYm(d.toISOString().slice(0, 7)) }
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)
  const undated = flat.filter(t => !t.due_on && t.status !== 'done')
  const tdy = today()
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className={'flex items-center gap-2 px-3 py-2 border-b ' + accent.bar}>
        <button onClick={() => shift(-1)} className="text-muted hover:text-ink"><ChevronLeft size={15} /></button>
        <span className="text-[13px] font-bold text-ink flex-1 text-center">{label}</span>
        <button onClick={() => setYm(tdy.slice(0, 7))} className="text-[11px] font-semibold text-muted hover:text-ink">Today</button>
        <button onClick={() => shift(1)} className="text-muted hover:text-ink"><ChevronRight size={15} /></button>
      </div>
      <div className="grid grid-cols-7 text-[10.5px] font-bold uppercase tracking-wider text-muted border-b border-line">
        {WEEKDAYS.map(d => <div key={d} className="px-2 py-1 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => (
          <div key={i} className={'min-h-[88px] border-b border-r border-line p-1 ' + (d ? (d === tdy ? 'bg-brand-50/50' : '') : 'bg-app/40')}>
            {d && <div className={'text-[11px] tabular-nums mb-0.5 ' + (d === tdy ? 'font-bold text-brand-700' : 'text-muted')}>{Number(d.slice(-2))}</div>}
            {d && (byDay[d] || []).slice(0, 4).map(t => (
              <button key={t.id} onClick={() => onOpen(t.id)} title={t.title}
                className={'block w-full text-left truncate rounded px-1 py-0.5 text-[11px] mb-0.5 ' + (t.status === 'done' ? 'bg-app text-muted line-through' : d < tdy ? 'bg-rose-50 text-rose-800' : 'bg-white border border-line text-ink hover:border-ink')}>
                {t.title}
              </button>
            ))}
            {d && (byDay[d] || []).length > 4 && <span className="text-[10px] text-muted">+{byDay[d].length - 4} more</span>}
          </div>
        ))}
      </div>
      {undated.length > 0 && (
        <div className="px-3 py-2 border-t border-line flex items-center gap-2 flex-wrap text-[11.5px] text-muted">
          <span className="font-semibold">No date:</span>
          {undated.slice(0, 12).map(t => <button key={t.id} onClick={() => onOpen(t.id)} className="rounded-md border border-line bg-white px-1.5 py-0.5 text-ink hover:border-ink">{t.title}</button>)}
          {undated.length > 12 && <span>+{undated.length - 12}</span>}
        </div>
      )}
    </div>
  )
}

// ── CUSTOMISE: list or columns, accent, hide done, section order ───────────────────────────────
function Customize({ settings, sections, canEdit, act, busy }: {
  settings: BoardSettings; sections: string[]; canEdit: boolean; act: (b: any) => Promise<any>; busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  if (!canEdit) return null
  const set = (patch: Partial<BoardSettings>) => act({ action: 'setSettings', settings: patch })
  const [customIcon, setCustomIcon] = useState('')
  const order = sections.filter(Boolean)
  const move = (i: number, d: -1 | 1) => {
    const next = order.slice(); const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ sectionOrder: next })
  }
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} title="Customize this board"
        className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1 text-[12px] font-bold text-muted hover:text-ink">
        <SlidersHorizontal size={13} /> <span className="hidden sm:inline">Customize</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-[280px] rounded-2xl border border-line bg-white shadow-2xl p-3 space-y-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted mb-1">Icon</p>
            <div className="flex flex-wrap gap-1">
              {ICONS.map(ic => (
                <button key={ic} onClick={() => set({ icon: ic })} disabled={busy}
                  className={'w-7 h-7 rounded-lg grid place-items-center text-[15px] border ' + (settings.icon === ic ? 'border-ink bg-app' : 'border-transparent hover:border-line')}>{ic}</button>
              ))}
              <input value={customIcon} onChange={e => setCustomIcon(e.target.value)} placeholder="any"
                onKeyDown={e => { if (e.key === 'Enter' && customIcon.trim()) { set({ icon: customIcon.trim().slice(0, 4) }); setCustomIcon('') } }}
                className="w-12 h-7 rounded-lg border border-line px-1 text-[12px] text-center" title="Type any emoji and press Enter" />
            </div>
          </div>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted mb-1">Accent</p>
            <div className="flex gap-1.5 flex-wrap">
              {ACCENTS.map(k => (
                <button key={k} onClick={() => set({ accent: k })} disabled={busy} title={k}
                  className={'w-6 h-6 rounded-full ' + ACCENT[k].dot + (settings.accent === k ? ' ring-2 ring-offset-2 ' + ACCENT[k].ring : '')} />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" checked={settings.hideDone} onChange={e => set({ hideDone: e.target.checked })} disabled={busy} /> Hide done tasks
          </label>
          {order.length > 1 && (
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted mb-1">Section order</p>
              <div className="rounded-lg border border-line divide-y divide-line">
                {order.map((name, i) => (
                  <div key={name} className="flex items-center gap-1 px-2 py-1">
                    <span className="text-[12px] text-ink flex-1 truncate">{name}</span>
                    <button onClick={() => move(i, -1)} disabled={busy || i === 0} className="text-muted hover:text-ink disabled:opacity-30"><ArrowUp size={11} /></button>
                    <button onClick={() => move(i, 1)} disabled={busy || i === order.length - 1} className="text-muted hover:text-ink disabled:opacity-30"><ArrowDown size={11} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── REPEATS: the chip in the header, and the editor behind it ─────────────────────────────────
function RecurChip({ p, canEdit, act, busy }: { p: ProjectFull; canEdit: boolean; act: (b: any) => Promise<any>; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const r = p.recurs
  const [every, setEvery] = useState<Recurrence['every']>(r?.every || 'week')
  const [weekday, setWeekday] = useState(r?.weekday ?? 1)
  const [day, setDay] = useState(r?.day ?? 1)
  const [carry, setCarry] = useState(r?.carry !== false)
  useEffect(() => { setEvery(r?.every || 'week'); setWeekday(r?.weekday ?? 1); setDay(r?.day ?? 1); setCarry(r?.carry !== false) }, [r])
  const save = async (on: boolean) => {
    await act({ action: 'setRecurs', recurs: on ? (every === 'month' ? { every, day, carry } : { every, weekday, carry }) : null }); setOpen(false)
  }
  return (
    <span className="relative inline-flex">
      <button onClick={() => canEdit && setOpen(o => !o)} className={'inline-flex items-center gap-1 ' + (r ? 'text-ink font-semibold' : 'text-muted') + (canEdit ? ' hover:underline' : '')} title={r ? `Next on ${r.next_on}` : 'Make this repeat'}>
        <Repeat size={11} />{r ? `${describeRecurrence(r)} · next ${nice(r.next_on)}` : (canEdit ? 'Does not repeat' : '')}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[280px] rounded-2xl border border-line bg-white shadow-2xl p-3 space-y-2 text-[12.5px]">
          <div className="flex gap-1.5">
            {(['week', '2weeks', 'month'] as const).map(v => (
              <button key={v} onClick={() => setEvery(v)} className={'rounded-lg px-2 py-1 border text-[12px] font-semibold ' + (every === v ? 'bg-ink text-white border-ink' : 'border-line text-muted hover:text-ink')}>{v === 'week' ? 'Weekly' : v === '2weeks' ? 'Every 2 wks' : 'Monthly'}</button>
            ))}
          </div>
          {every !== 'month' ? (
            <select value={weekday} onChange={e => setWeekday(Number(e.target.value))} className="rounded-lg border border-line px-2 py-1 bg-white">{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          ) : (
            <select value={day} onChange={e => setDay(Number(e.target.value))} className="rounded-lg border border-line px-2 py-1 bg-white">{Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>on the {d}</option>)}</select>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" checked={carry} onChange={e => setCarry(e.target.checked)} /> Open items roll into the next one</label>
          <p className="text-[11px] text-muted">Each morning it is due, a fresh copy is made from the template and this one is closed.</p>
          <div className="flex gap-2 justify-end">
            {r && <button onClick={() => save(false)} disabled={busy} className="text-[12px] text-rose-600 font-semibold">Stop repeating</button>}
            <button onClick={() => save(true)} disabled={busy} className="rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-bold">Save</button>
          </div>
        </div>
      )}
    </span>
  )
}

// ── ⋯ : save as template, add from template ──────────────────────────────────────────────────
function MoreMenu({ p, canEdit, act, busy }: { p: ProjectFull; canEdit: boolean; act: (b: any) => Promise<any>; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [tpls, setTpls] = useState<{ key: string; label: string; kind: string }[]>([])
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    fetch('/api/projects?archived=0', { cache: 'no-store' }).then(r => r.json()).then(j => setTpls(j?.templates || [])).catch(() => {})
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  if (!canEdit) return null
  const saveAs = async () => {
    const label = window.prompt('Name this template (the team will see it under "Start from"):', p.title.replace(/\s*·.*$/, ''))
    if (!label?.trim()) return
    const j = await act({ action: 'saveTemplate', label: label.trim() })
    if (j?.ok) setOpen(false)
  }
  const addFrom = async (key: string) => { await act({ action: 'applyTemplate', template: key }); setOpen(false) }
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} title="More" className="inline-flex items-center justify-center rounded-xl border border-line bg-white w-8 h-8 text-muted hover:text-ink"><MoreHorizontal size={14} /></button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-[260px] rounded-2xl border border-line bg-white shadow-2xl overflow-hidden text-[12.5px]">
          {p.kind !== 'personal' && (
            <button onClick={saveAs} disabled={busy} className="w-full text-left px-3 py-2 hover:bg-app flex items-center gap-2"><Save size={13} className="text-muted" /> Save as template…</button>
          )}
          <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted border-t border-line">Add sections from</div>
          {tpls.filter(t => t.kind !== 'personal').map(t => (
            <button key={t.key} onClick={() => addFrom(t.key)} disabled={busy} className="w-full text-left px-3 py-1.5 hover:bg-app flex items-center gap-2"><LayoutTemplate size={12} className="text-muted" /> {t.label}</button>
          ))}
          {!tpls.length && <p className="px-3 py-2 text-muted">Loading…</p>}
        </div>
      )}
    </div>
  )
}

function TaskRow({ t, depth, canEdit, busy, open, onOpen, act, counts, dragId, setDragId, onMove, onPush }: {
  t: Task; depth: number; canEdit: boolean; busy: boolean; open: boolean
  onOpen: (id: string) => void; act: (b: any) => Promise<any>; counts: Counts
} & DragProps) {
  const Icon = STATUS_ICON[t.status] || Circle
  const late = t.status !== 'done' && !!t.due_on && t.due_on < today()
  const next = (s: string) => (s === 'done' ? 'todo' : 'done')   // one tap toggles done; the drawer has the four states
  const c = counts[t.id]
  return (
    <>
      <div className={'group/row flex items-center gap-2.5 px-3 py-2 cursor-pointer border-t border-line ' + (open ? 'bg-brand-50/60' : 'hover:bg-app/50') + (dragId === t.id ? ' opacity-40' : '')}
        style={{ paddingLeft: 12 + depth * 22 }} onClick={() => onOpen(t.id)}
        draggable={canEdit && depth === 0} onDragStart={e => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDragId(null)}>
        {depth === 0 && canEdit && <GripVertical size={12} className="text-muted/50 shrink-0 -ml-1 cursor-grab" />}
        {depth > 0 && <CornerDownRight size={11} className="text-muted shrink-0 -ml-1" />}
        <button disabled={!canEdit || busy} onClick={e => { e.stopPropagation(); act({ action: 'taskSet', taskId: t.id, status: next(t.status) }) }}
          className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center shrink-0 disabled:opacity-60 ' + STATUS_CLS[t.status]}
          title={TASK_STATUS_LABEL[t.status]}>
          <Icon size={11} strokeWidth={3} />
        </button>
        <span className={'min-w-0 flex-1 text-[13px] truncate ' + (t.status === 'done' ? 'text-muted line-through' : 'text-ink')}>{t.title}</span>
        {t.breezeway_task_id ? (
          <button onClick={e => { e.stopPropagation(); onPush?.(t.id) }} className={'inline-flex items-center gap-0.5 text-[10px] font-bold uppercase px-1 py-0.5 rounded border shrink-0 ' + (TONE_CLS[t.breezeway?.tone || 'open'])} title="In Breezeway — click to reassign or move"><Wrench size={9} /> {t.breezeway?.status || 'BZ'}</button>
        ) : (canEdit && depth === 0 && onPush && (
          <button onClick={e => { e.stopPropagation(); onPush(t.id) }} className="opacity-0 group-hover/row:opacity-100 text-muted hover:text-ink shrink-0" title="Push to Breezeway"><Wrench size={12} /></button>
        ))}
        {c && c.comments > 0 && <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted tabular-nums shrink-0" title={`${c.comments} comment${c.comments === 1 ? '' : 's'}`}><MessageSquare size={11} />{c.comments}</span>}
        {c && c.files > 0 && <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted tabular-nums shrink-0" title={`${c.files} file${c.files === 1 ? '' : 's'}`}><Paperclip size={11} />{c.files}</span>}
        {t.assignees.length > 0 && (
          <span className="hidden sm:inline text-[11px] text-muted truncate max-w-[140px]">{t.assignees.map(a => first(a.display)).join(', ')}</span>
        )}
        {t.homed && <span className="text-[9.5px] font-semibold text-muted truncate max-w-[110px] shrink-0" title={`Also in ${t.home_project_title}`}>↗ {t.home_project_title}</span>}
        {canEdit ? (
          <label onClick={e => e.stopPropagation()} className={'relative inline-flex items-center gap-1 text-[11px] tabular-nums shrink-0 cursor-pointer ' + (late ? 'text-rose-600 font-bold' : t.due_on ? 'text-muted' : 'text-muted/40 hover:text-muted')} title="Due date">
            <CalendarDays size={11} />{t.due_on ? nice(t.due_on) : ''}
            <input type="date" value={t.due_on || ''} disabled={busy} onChange={e => act({ action: 'taskSet', taskId: t.id, due_on: e.target.value || null })} className="absolute inset-0 opacity-0 cursor-pointer w-full" />
          </label>
        ) : (t.due_on && <span className={'text-[11px] tabular-nums shrink-0 ' + (late ? 'text-rose-600 font-bold' : 'text-muted')}>{nice(t.due_on)}</span>)}
        {t.priority === 'urgent' && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-rose-100 text-rose-700 shrink-0">Urgent</span>}
        {t.priority === 'high' && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">High</span>}
        {t.subtasks.length > 0 && <span className="text-[11px] text-muted tabular-nums shrink-0">{t.subtasks.filter(s => s.status === 'done').length}/{t.subtasks.length}</span>}
      </div>
      {t.subtasks.map(s => <TaskRow key={s.id} t={s} depth={depth + 1} canEdit={canEdit} busy={busy} open={false} onOpen={onOpen} act={act} counts={counts} dragId={dragId} setDragId={setDragId} onMove={onMove} />)}
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
        placeholder={parentId ? 'Add a checklist item…' : 'Add a task…'} disabled={busy}
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
function TaskDrawer({ task, p, roster, me, nameOf, canEdit, busy, onClose, act, upload, superadmin, bzFocus }: {
  task: Task; p: ProjectFull; roster: Roster; me: string; nameOf: (e: string | null) => string; canEdit: boolean; busy: boolean
  onClose: () => void; act: (b: any) => Promise<any>; upload: (files: FileList | File[], taskId?: string | null) => Promise<boolean>; superadmin: boolean; bzFocus?: boolean
}) {
  const files = useMemo(() => p.photos.filter(f => f.task_id === task.id), [p.photos, task.id])
  const feed = useMemo(() => p.notes.filter(n => n.task_id === task.id).slice().reverse(), [p.notes, task.id])
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
          <span className="text-[11px] text-muted truncate flex-1">{task.section || 'No section'}{task.parent_id ? ' · subtask' : ''}{task.homed ? ` · from ${task.home_project_title}` : ''}</span>
          {canEdit && (
            <button onClick={async () => { if (confirm(task.homed ? `Remove this task from this project? It stays in ${task.home_project_title}.` : 'Delete this task' + (task.subtasks.length ? ' and its subtasks' : '') + '?')) { await act({ action: 'taskDelete', taskId: task.id }); onClose() } }}
              disabled={busy} className="text-muted hover:text-rose-600" title={task.homed ? 'Remove from this project' : 'Delete task'}><Trash2 size={14} /></button>
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

            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted pt-1.5">Projects</span>
            <TaskProjects task={task} p={p} canEdit={canEdit} busy={busy} act={act} />
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Notes</p>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => { if (desc !== (task.description || '')) set({ description: desc }) }}
              disabled={!canEdit} rows={5} placeholder="What this is, what done looks like, anything the person doing it needs to know."
              className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] leading-relaxed focus:outline-none focus:border-ink" />
          </div>

          {/* what this task is about — the stay, the owner, the unit, the claim */}
          <TaskAttached task={task} p={p} canEdit={canEdit} busy={busy} act={act} />

          {!task.parent_id && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Checklist <span className="normal-case font-normal tabular-nums">{task.subtasks.filter(s => s.status === 'done').length}/{task.subtasks.length}</span></p>
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

          {/* Breezeway — the field. A task here can become a real task there, and follows it. */}
          {!task.parent_id && (
            <BreezewayBox key={task.id + (bzFocus ? ':bz' : '')} task={task} p={p} canEdit={canEdit} busy={busy} act={act} startOpen={!!bzFocus} />
          )}

          {/* files on this task */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted flex-1">Files <span className="normal-case font-normal tabular-nums">{files.length || ''}</span></p>
              {canEdit && <UploadButton busy={busy} onPick={fl => upload(fl, task.id)} />}
            </div>
            <FileList files={files} canEdit={canEdit} busy={busy} onRemove={f => act({ action: 'fileDelete', fileId: f.id })} compact />
          </div>

          <p className="text-[11px] text-muted">
            Created {task.created_by ? `by ${first(task.created_by)} ` : ''}{nice(task.created_at.slice(0, 10))}
            {task.done_at && <> · done {nice(task.done_at.slice(0, 10))}{task.done_by ? ` by ${first(task.done_by)}` : ''}</>}
          </p>

          {/* the conversation on this task */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Activity</p>
            <Feed items={feed} me={me} nameOf={nameOf} act={act} busy={busy} superadmin={superadmin} members={p.members} />
          </div>
        </div>

        {/* composer pinned to the bottom, like a chat — the field you came here to type in */}
        <div className="border-t border-line px-3 py-2 bg-white">
          <Composer busy={busy} members={p.members} placeholder={`Comment on “${task.title.slice(0, 40)}${task.title.length > 40 ? '…' : ''}” — @ to mention`}
            onSend={body => act({ action: 'comment', taskId: task.id, body })} />
        </div>
      </div>
    </>
  )
}

// ── ONE TASK, SEVERAL PROJECTS ─────────────────────────────────────────────────────────────────
// The chips are every project this task appears in; the picker offers the projects you are on.
function TaskProjects({ task, p, canEdit, busy, act }: { task: Task; p: ProjectFull; canEdit: boolean; busy: boolean; act: (b: any) => Promise<any> }) {
  const [homes, setHomes] = useState<{ id: string; title: string; home: boolean }[] | null>(null)
  const [mine, setMine] = useState<{ id: string; title: string; kind?: string }[]>([])
  const [open, setOpen] = useState(false)
  const load = useCallback(() => { act({ action: 'taskProjects', taskId: task.id }).then(j => { if (j?.projects) setHomes(j.projects) }) }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHomes(null); fetch('/api/projects/' + p.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'taskProjects', taskId: task.id }) }).then(r => r.json()).then(j => setHomes(j?.projects || [])).catch(() => setHomes([])) }, [task.id, p.id, p.tasks.length])
  useEffect(() => { if (open && !mine.length) fetch('/api/projects?archived=0', { cache: 'no-store' }).then(r => r.json()).then(j => setMine((j?.projects || []).map((x: any) => ({ id: x.id, title: x.title, kind: x.kind })))).catch(() => {}) }, [open, mine.length])
  const own = task.home_project_id || task.project_id
  const inIds = new Set((homes || []).map(h => h.id))
  const options = mine.filter(m => !inIds.has(m.id) && m.id !== own)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {homes === null && <span className="text-[11px] text-muted">…</span>}
      {(homes || []).map(h => (
        <span key={h.id} className={'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ' + (h.id === p.id ? 'bg-app border-line text-ink font-semibold' : 'bg-white border-line text-muted')}>
          <Link href={'/projects/' + h.id} className="hover:underline">{h.title}</Link>
          {!h.home && <span className="text-[9px] uppercase font-bold text-muted/70" title="The project that made this task">home</span>}
          {canEdit && h.home && <button onClick={async () => { await act({ action: 'taskRemoveFromProject', taskId: task.id, projectId: h.id }); load() }} disabled={busy} className="text-muted hover:text-rose-600" title="Remove from this project"><X size={10} /></button>}
        </span>
      ))}
      {canEdit && !open && <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink"><Plus size={11} /> Add to project</button>}
      {canEdit && open && (
        <select autoFocus onChange={async e => { if (e.target.value) { await act({ action: 'taskAddToProject', taskId: task.id, projectId: e.target.value }); setOpen(false); load() } }} onBlur={() => setOpen(false)} disabled={busy}
          className="rounded-lg border border-line bg-white px-2 py-1 text-[12px]">
          <option value="">Add to…</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.kind === 'personal' ? '🔒 ' : ''}{o.title}</option>)}
        </select>
      )}
    </div>
  )
}

// ── ATTACHED TO THIS TASK ─────────────────────────────────────────────────────────────────────
// The same Guesty / claims / glitches search the project uses, scoped to one task. A reservation
// here is the stay this task is about; a unit here is where the Breezeway task will be created.
function TaskAttached({ task, p, canEdit, busy, act }: { task: Task; p: ProjectFull; canEdit: boolean; busy: boolean; act: (b: any) => Promise<any> }) {
  const links = p.links.filter(l => l.task_id === task.id)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const t = setTimeout(async () => {
      try { const r = await fetch('/api/projects/search?q=' + encodeURIComponent(q.trim()), { cache: 'no-store' }); const j = await r.json(); setHits((j?.hits || []).filter((h: Hit) => h.kind !== 'building')) } catch { setHits([]) }
    }, 220)
    return () => clearTimeout(t)
  }, [q])
  const attach = async (h: Hit) => {
    const body: any = { action: 'link', kind: h.kind, refId: h.id, label: h.label, taskId: task.id }
    if (h.kind === 'reservation') body.label = `${h.label} · ${h.checkIn} → ${h.checkOut}`
    await act(body); setQ(''); setHits([]); setOpen(false)
  }
  if (!links.length && !canEdit) return null
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted flex-1">Attached <span className="normal-case font-normal tabular-nums">{links.length || ''}</span></p>
        {canEdit && <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink"><Plus size={11} /> Attach</button>}
      </div>
      {open && canEdit && (
        <div className="relative mb-1.5">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Reservation, owner, unit, claim, glitch…" onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQ('') } }}
            className="w-full rounded-lg border border-line bg-white pl-7 pr-2 py-1.5 text-[12.5px]" />
          {hits.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-line bg-white shadow-lg divide-y divide-line max-h-[220px] overflow-y-auto">
              {hits.map(h => { const I = LINK_ICON[h.kind] || Building2; return (
                <button key={h.kind + h.id} onClick={() => attach(h)} disabled={busy} className="w-full text-left px-2.5 py-1.5 hover:bg-app flex items-start gap-2">
                  <I size={12} className="text-muted mt-0.5 shrink-0" />
                  <span className="min-w-0"><span className="block text-[12.5px] text-ink truncate">{h.label}</span><span className="block text-[10.5px] text-muted truncate">{h.sub}</span></span>
                  <span className="ml-auto text-[9.5px] font-bold uppercase tracking-wide text-muted shrink-0">{h.kind}</span>
                </button>
              )})}
            </div>
          )}
        </div>
      )}
      {links.length === 0 ? <p className="text-[12px] text-muted">Nothing attached to this task.</p> : (
        <div className="rounded-lg border border-line divide-y divide-line">
          {links.map(o => { const I = LINK_ICON[o.kind] || Building2; const st = o.state; return (
            <div key={o.kind + o.ref_id} className="px-2.5 py-1.5 flex items-center gap-2">
              <I size={12} className="text-muted shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-ink truncate">{o.label || o.ref_id}</span>
                {st?.detail && <span className="block text-[10.5px] text-muted truncate">{st.detail}</span>}
              </span>
              {st ? <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ' + (TONE_CLS[st.tone] || TONE_CLS.open)}>{st.label}</span> : <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted">{o.kind}</span>}
              {st?.href && <a href={st.href} target="_blank" rel="noreferrer" className="text-muted hover:text-ink"><ExternalLink size={11} /></a>}
              {canEdit && <button onClick={() => act({ action: 'unlink', kind: o.kind, refId: o.ref_id, taskId: task.id })} disabled={busy} className="text-muted hover:text-rose-600"><X size={11} /></button>}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

// ── BREEZEWAY: push this task to the field, pick who, pick the checklist; then follow it ──────
type BzPerson = { id: number; name: string; departments: string[]; region: string | null }
type BzTemplate = { id: number; name: string; department: string }
let BZ_CACHE: { at: number; people: BzPerson[]; templates: BzTemplate[] } | null = null
function useBreezewayPickers(on: boolean) {
  const [data, setData] = useState<{ people: BzPerson[]; templates: BzTemplate[] } | null>(BZ_CACHE && Date.now() - BZ_CACHE.at < 600000 ? BZ_CACHE : null)
  useEffect(() => {
    if (!on || data) return
    fetch('/api/projects/breezeway', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) { BZ_CACHE = { at: Date.now(), people: j.people || [], templates: j.templates || [] }; setData(BZ_CACHE) } }).catch(() => setData({ people: [], templates: [] }))
  }, [on, data])
  return data
}

function BreezewayBox({ task, p, canEdit, busy, act, startOpen }: { task: Task; p: ProjectFull; canEdit: boolean; busy: boolean; act: (b: any) => Promise<any>; startOpen?: boolean }) {
  const taskUnits = p.links.filter(l => l.task_id === task.id && l.kind === 'listing')
  const projUnits = p.links.filter(l => !l.task_id && l.kind === 'listing')
  const units = [...taskUnits, ...projUnits.filter(u => !taskUnits.some(t => t.ref_id === u.ref_id))]
  const hasStay = p.links.some(l => l.task_id === task.id && l.kind === 'reservation')
  const [open, setOpen] = useState(!!startOpen)
  const [listingId, setListingId] = useState(units[0]?.ref_id || '')
  const [department, setDepartment] = useState('maintenance')
  const [priority, setPriority] = useState(task.priority === 'urgent' || task.priority === 'high' ? task.priority : 'normal')
  const [date, setDate] = useState(task.due_on || today())
  const [templateId, setTemplateId] = useState<string>('')
  const [who, setWho] = useState<number[] | null>(null)   // null = not chosen yet → matched by name on the server
  const [filter, setFilter] = useState('')
  const pick = useBreezewayPickers(open || !!task.breezeway_task_id)
  useEffect(() => { if (!listingId && units[0]) setListingId(units[0].ref_id) }, [units, listingId])
  // Pre-tick the field people whose names match this task's assignees, so the usual case is one click.
  useEffect(() => {
    if (who !== null || !pick?.people?.length || !task.assignees.length) return
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').trim()
    const ids = pick.people.filter(bp => task.assignees.some(a => { const A = norm(a.display), B = norm(bp.name); return A === B || (A.split(' ')[0] && B.split(' ')[0] === A.split(' ')[0] && (A.split(' ')[1]?.[0] === B.split(' ')[1]?.[0])) })).map(bp => bp.id)
    if (ids.length) setWho(ids)
  }, [pick, task.assignees, who])
  const bz = task.breezeway
  const people = (pick?.people || []).filter(bp => !filter || bp.name.toLowerCase().includes(filter.toLowerCase()) || (bp.region || '').toLowerCase().includes(filter.toLowerCase()))
  const toggle = (id: number) => setWho(w => { const cur = w || []; return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] })
  const chosenNames = (who || []).map(id => pick?.people.find(x => x.id === id)?.name).filter(Boolean)

  // Plain JSX, not a nested component: a component defined inside render remounts on every keystroke.
  const peoplePicker = (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Assign in Breezeway</span>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a person…" className="ml-auto w-36 rounded-md border border-line bg-white px-2 py-0.5 text-[11.5px]" />
      </div>
      <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
        {!pick && <span className="text-[11px] text-muted inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Loading people…</span>}
        {pick && people.slice(0, 60).map(bp => {
          const on = (who || []).includes(bp.id)
          return <button key={bp.id} onClick={() => toggle(bp.id)} title={[bp.region, ...bp.departments].filter(Boolean).join(' · ')}
            className={'rounded-full border px-2 py-0.5 text-[11.5px] ' + (on ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-ink')}>{bp.name}</button>
        })}
        {pick && !people.length && <span className="text-[11px] text-muted">Nobody matches.</span>}
      </div>
    </div>
  )

  if (task.breezeway_task_id) {
    return (
      <div className={'rounded-xl border px-3 py-2 space-y-2 ' + (bz?.tone === 'done' ? 'border-emerald-200 bg-emerald-50/60' : bz?.tone === 'bad' ? 'border-rose-200 bg-rose-50/60' : 'border-line bg-app/40')}>
        <div className="flex items-center gap-2 text-[12px]">
          <Wrench size={12} className="text-muted" />
          <span className="font-semibold text-ink">In Breezeway</span>
          <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ' + (TONE_CLS[bz?.tone || 'open'])}>{bz?.status || 'created'}</span>
          <span className="text-muted truncate flex-1">{[bz?.assignee, bz?.date].filter(Boolean).join(' · ')}</span>
          {bz?.reportUrl && <a href={bz.reportUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-ink inline-flex items-center gap-1 text-[11px] font-semibold">Report <ExternalLink size={10} /></a>}
          {canEdit && bz?.tone !== 'done' && <button onClick={() => setOpen(o => !o)} className="text-[11px] font-semibold text-muted hover:text-ink">{open ? 'Close' : 'Reassign / move'}</button>}
        </div>
        {open && canEdit && (
          <div className="space-y-2 text-[12.5px]">
            {peoplePicker}
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1"><span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1" /></label>
              <button onClick={async () => { const j = await act({ action: 'taskBreezewayUpdate', taskId: task.id, assigneeIds: who || [], date }); if (j?.ok) setOpen(false) }} disabled={busy}
                className="ml-auto rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-bold disabled:opacity-40 inline-flex items-center gap-1.5">{busy ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />} Push to Breezeway</button>
            </div>
          </div>
        )}
        {!open && <p className="text-[10.5px] text-muted pl-5">Follows the field: marked done here when the Breezeway task finishes.</p>}
      </div>
    )
  }
  if (!canEdit) return null
  if (!open) return (
    <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:border-ink">
      <Wrench size={12} /> Push to Breezeway…
    </button>
  )
  return (
    <div className="rounded-xl border border-line bg-app/40 px-3 py-2.5 space-y-2.5 text-[12.5px]">
      <p className="font-semibold text-ink inline-flex items-center gap-1.5"><Wrench size={12} /> Push to Breezeway</p>
      {units.length === 0 && !hasStay ? (
        <p className="text-[11.5px] text-muted">Attach a unit or a reservation to this task (above), or a unit or building to the project — a field task has to live somewhere.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted">Unit</span>
              {units.length ? (
                <select value={listingId} onChange={e => setListingId(e.target.value)} className="w-full rounded-lg border border-line bg-white px-2 py-1">{units.map(u => <option key={u.ref_id} value={u.ref_id}>{u.label || u.ref_id}{u.task_id ? ' (this task)' : ''}</option>)}</select>
              ) : <span className="block text-[12px] text-muted py-1">From the attached reservation</span>}
            </label>
            <label className="block"><span className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted">Department</span>
              <select value={department} onChange={e => setDepartment(e.target.value)} className="w-full rounded-lg border border-line bg-white px-2 py-1">{['maintenance', 'housekeeping', 'inspection', 'safety'].map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}</select></label>
            <label className="block"><span className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted">Priority</span>
              <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full rounded-lg border border-line bg-white px-2 py-1">{['urgent', 'high', 'normal', 'low'].map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}</select></label>
            <label className="block"><span className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted">Date</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-lg border border-line bg-white px-2 py-1" /></label>
            <label className="block col-span-2"><span className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted">Checklist (Breezeway template)</span>
              <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="w-full rounded-lg border border-line bg-white px-2 py-1">
                <option value="">No checklist — just the task</option>
                {(pick?.templates || []).filter(t => !department || !t.department || t.department === department).map(t => <option key={t.id} value={String(t.id)}>{t.name}{t.department ? ` · ${t.department}` : ''}</option>)}
              </select></label>
          </div>
          {peoplePicker}
          <p className="text-[11px] text-muted">{chosenNames.length ? `Goes to ${chosenNames.join(', ')}.` : task.assignees.length ? 'Nobody ticked — the server will match this task’s assignees by name.' : 'Nobody ticked — it will land unassigned in Breezeway.'}</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="text-[12px] text-muted hover:text-ink">Cancel</button>
            <button onClick={async () => { const j = await act({ action: 'taskToBreezeway', taskId: task.id, listingId: listingId || undefined, department, priority, date, templateId: templateId || undefined, assigneeIds: who || [] }); if (j?.ok) setOpen(false) }} disabled={busy || (!listingId && !hasStay)}
              className="rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-bold disabled:opacity-40 inline-flex items-center gap-1.5">{busy ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />} Create field task</button>
          </div>
        </>
      )}
    </div>
  )
}

// ── COMMENTS + EVENTS: one feed, two kinds of line ─────────────────────────────────────────────
// A comment is a block: who, when, what they said. An event is a single quiet line: who did what
// to which task. Both are ordered oldest → newest, so reading down is reading forward in time.
function Feed({ items, me, nameOf, act, busy, superadmin, members, onOpen, empty }: {
  items: Note[]; me: string; nameOf: (e: string | null) => string; act: (b: any) => Promise<any>; busy: boolean
  superadmin: boolean; members: Member[]; onOpen?: (taskId: string) => void; empty?: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const isOwner = superadmin || members.some(m => m.email && m.email.toLowerCase() === me.toLowerCase() && m.role === 'owner')
  if (!items.length) return <p className="text-[12px] text-muted py-2">{empty || 'Nothing yet. Say something below.'}</p>
  return (
    <div className="space-y-1.5">
      {items.map(n => {
        const who = n.via_share ? (n.author || 'vendor') : nameOf(n.author)
        const mine = !!n.author && n.author.toLowerCase() === me.toLowerCase()
        if (n.kind === 'event') {
          const t = n.meta?.task_title
          return (
            <div key={n.id} className="flex items-start gap-2 text-[12px] text-muted py-0.5">
              <Activity size={11} className="mt-[3px] shrink-0 text-muted/70" />
              <span className="min-w-0">
                <span className="font-semibold text-ink/80">{who}</span> {n.body}
                {t && onOpen && n.meta?.task_id ? <> · <button onClick={() => onOpen(n.meta!.task_id!)} className="text-ink underline decoration-line hover:decoration-ink truncate">{t}</button></> : (t && !n.task_id ? <> · <span className="italic">{t}</span></> : null)}
                <span className="text-muted/70"> · {ago(n.created_at)}</span>
              </span>
            </div>
          )
        }
        return (
          <div key={n.id} className="flex items-start gap-2 py-1">
            <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold inline-flex items-center justify-center shrink-0 mt-0.5">{who.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] text-muted leading-tight">
                <span className="font-semibold text-ink">{who}</span> · {ago(n.created_at)}{n.edited_at ? ' · edited' : ''}
                {n.task_id && onOpen && n.meta?.task_title ? <> · on <button onClick={() => onOpen(n.task_id!)} className="underline decoration-line hover:text-ink">{n.meta.task_title}</button></> : null}
              </p>
              {editing === n.id ? (
                <div className="mt-1">
                  <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={3}
                    className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] leading-relaxed focus:outline-none focus:border-ink" />
                  <div className="flex gap-2 mt-1">
                    <button onClick={async () => { if (draft.trim()) { await act({ action: 'commentEdit', noteId: n.id, body: draft.trim() }); setEditing(null) } }} disabled={busy || !draft.trim()}
                      className="rounded-lg bg-ink text-white px-2.5 py-1 text-[11.5px] font-bold disabled:opacity-40">Save</button>
                    <button onClick={() => setEditing(null)} className="text-[11.5px] text-muted hover:text-ink">Cancel</button>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-ink whitespace-pre-wrap break-words leading-relaxed"><Mentions text={n.body} /></p>
              )}
              {(mine || isOwner) && editing !== n.id && (
                <p className="mt-0.5 flex gap-2.5 text-[11px] text-muted">
                  {mine && <button onClick={() => { setEditing(n.id); setDraft(n.body) }} className="hover:text-ink inline-flex items-center gap-1"><Pencil size={10} /> Edit</button>}
                  <button onClick={() => { if (confirm('Delete this comment?')) act({ action: 'commentDelete', noteId: n.id }) }} disabled={busy} className="hover:text-rose-600 inline-flex items-center gap-1"><Trash2 size={10} /> Delete</button>
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// "@Roberto Diaz" reads as a name, not a handle. Purely visual — the server decides who was meant.
function Mentions({ text }: { text: string }) {
  const parts = String(text || '').split(/(@[A-Za-zÀ-ɏ][\wÀ-ɏ.'-]*(?:\s[A-Z][\wÀ-ɏ.'-]*)?)/g)
  return <>{parts.map((s, i) => s.startsWith('@') ? <span key={i} className="font-semibold text-brand-700">{s}</span> : <span key={i}>{s}</span>)}</>
}

// Enter sends, Shift+Enter is a new line — the convention every chat tool taught everyone.
// Typing @ offers the project's members; picking one drops their name in and they get told.
function Composer({ onSend, busy, placeholder, members }: { onSend: (body: string) => Promise<any>; busy: boolean; placeholder?: string; members: Member[] }) {
  const [v, setV] = useState('')
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const send = async () => { const body = v.trim(); if (!body || busy) return; setV(''); const r = await onSend(body); if (r === null) setV(body) }

  // The @-word being typed, if the caret is inside one.
  const at = useMemo(() => {
    const before = v.slice(0, caret)
    const m = before.match(/(?:^|[^\w@])@([\wÀ-ɏ.'-]*)$/)
    return m ? { start: before.length - m[1].length - 1, q: m[1].toLowerCase() } : null
  }, [v, caret])
  const hits = at ? members.filter(m => !at.q || m.display.toLowerCase().includes(at.q) || (m.email || '').toLowerCase().startsWith(at.q)).slice(0, 6) : []
  const choose = (m: Member) => {
    if (!at) return
    const name = m.display   // full name — unambiguous on the server, and reads as a name in the feed
    const next = v.slice(0, at.start) + '@' + name + ' ' + v.slice(caret)
    setV(next); setPick(0)
    const pos = at.start + name.length + 2
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); setCaret(pos) })
  }
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (hits.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPick(p => (p + 1) % hits.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPick(p => (p - 1 + hits.length) % hits.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(hits[pick] || hits[0]); return }
      if (e.key === 'Escape') { setCaret(-1); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }
  return (
    <div className="relative">
      {hits.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 z-20 w-64 rounded-lg border border-line bg-white shadow-lg overflow-hidden">
          {hits.map((m, i) => (
            <button key={m.id} onMouseDown={e => { e.preventDefault(); choose(m) }}
              className={'w-full text-left px-2.5 py-1.5 text-[12.5px] flex items-center justify-between gap-2 ' + (i === pick ? 'bg-app' : 'hover:bg-app')}>
              <span>{m.display}</span><span className="text-[10px] text-muted">{m.email ? 'will be notified' : 'name only'}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea ref={ref} value={v} rows={v.includes('\n') ? 3 : 1} placeholder={placeholder || 'Write a comment… @ to mention'}
          onChange={e => { setV(e.target.value); setCaret(e.target.selectionStart || 0); setPick(0) }}
          onSelect={e => setCaret((e.target as HTMLTextAreaElement).selectionStart || 0)}
          onKeyDown={onKey}
          className="flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2 text-[13px] leading-relaxed focus:outline-none focus:border-ink" />
        <button onClick={send} disabled={busy || !v.trim()} title="Send (Enter)"
          className="rounded-xl bg-ink text-white w-9 h-9 inline-flex items-center justify-center disabled:opacity-40 shrink-0">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  )
}

// ── FILES ─────────────────────────────────────────────────────────────────────────────────────
function UploadButton({ onPick, busy, label }: { onPick: (files: FileList) => void; busy: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <input ref={ref} type="file" multiple className="hidden"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip"
        onChange={e => { if (e.target.files?.length) onPick(e.target.files); e.target.value = '' }} />
      <button onClick={() => ref.current?.click()} disabled={busy}
        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink disabled:opacity-40">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} {label || 'Attach'}
      </button>
    </>
  )
}

// Photos are a grid you can see at a glance; documents are rows you can read the name of. Both
// open in a new tab — the signed URL is the download.
function FileList({ files, canEdit, busy, onRemove, compact, onOpen }: {
  files: ProjectFile[]; canEdit: boolean; busy: boolean; onRemove: (f: ProjectFile) => void; compact?: boolean; onOpen?: (taskId: string) => void
}) {
  if (!files.length) return <p className="text-[12px] text-muted py-1">{canEdit ? 'Nothing attached. Photos, PDFs, spreadsheets — up to 25MB each.' : 'Nothing attached.'}</p>
  const pics = files.filter(isImage), docs = files.filter(f => !isImage(f))
  return (
    <div className="space-y-2">
      {pics.length > 0 && (
        <div className={'grid gap-1.5 ' + (compact ? 'grid-cols-3' : 'grid-cols-3')}>
          {pics.map(f => (
            <div key={f.id} className="relative group aspect-square rounded-lg overflow-hidden border border-line bg-app">
              <a href={f.url} target="_blank" rel="noreferrer" title={f.name || f.caption || 'Photo'}>
                <img src={f.url} alt={f.name || f.caption || ''} className="w-full h-full object-cover" loading="lazy" />
              </a>
              {canEdit && (
                <button onClick={() => { if (confirm('Remove this photo?')) onRemove(f) }} disabled={busy} title="Remove"
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 text-ink inline-flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-rose-600"><X size={11} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="rounded-lg border border-line divide-y divide-line">
          {docs.map(f => (
            <div key={f.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <FileText size={13} className="text-muted shrink-0" />
              <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-ink truncate hover:underline">{f.name || 'File'}</span>
                <span className="block text-[10.5px] text-muted">{fmtBytes(f.bytes)}{f.uploaded_by ? ` · ${first(f.uploaded_by)}` : ''} · {ago(f.created_at)}</span>
              </a>
              <a href={f.url} target="_blank" rel="noreferrer" download={f.name || undefined} className="text-muted hover:text-ink" title="Download"><Download size={12} /></a>
              {canEdit && <button onClick={() => { if (confirm('Remove ' + (f.name || 'this file') + '?')) onRemove(f) }} disabled={busy} className="text-muted hover:text-rose-600" title="Remove"><X size={12} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FilesPanel({ p, canEdit, act, busy, upload, onOpen }: {
  p: ProjectFull; canEdit: boolean; act: (b: any) => Promise<any>; busy: boolean
  upload: (files: FileList | File[], taskId?: string | null) => Promise<boolean>; onOpen: (id: string) => void
}) {
  const [all, setAll] = useState(false)
  const files = all ? p.photos : p.photos.slice(0, 9)
  const pics = p.photos.filter(isImage).length
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-3 py-2 bg-app/60 border-b border-line flex items-center gap-2">
        <Paperclip size={13} className="text-muted" />
        <span className="text-[12.5px] font-bold text-ink flex-1">Files</span>
        {p.photos.length > 0 && <span className="text-[11px] text-muted tabular-nums" title={`${pics} photo${pics === 1 ? '' : 's'}`}>{p.photos.length}</span>}
        {canEdit && <UploadButton busy={busy} onPick={fl => upload(fl, null)} label="Add" />}
      </div>
      <div className="p-2.5">
        <FileList files={files} canEdit={canEdit} busy={busy} onRemove={f => act({ action: 'fileDelete', fileId: f.id })} onOpen={onOpen} />
        {p.photos.length > 9 && (
          <button onClick={() => setAll(a => !a)} className="mt-2 text-[11.5px] font-semibold text-muted hover:text-ink">{all ? 'Show fewer' : `Show all ${p.photos.length}`}</button>
        )}
      </div>
    </div>
  )
}

// ── THE PROJECT FEED ──────────────────────────────────────────────────────────────────────────
// Everything that happened, newest at the bottom, with the composer under it. Someone who was out
// yesterday reads this before the task list — it is the "what did I miss" of the project.
function ActivityPanel({ p, me, nameOf, act, busy, onOpen, superadmin }: {
  p: ProjectFull; me: string; nameOf: (e: string | null) => string; act: (b: any) => Promise<any>; busy: boolean
  onOpen: (id: string) => void; superadmin: boolean
}) {
  const [all, setAll] = useState(false)
  const [onlyComments, setOnlyComments] = useState(false)
  const ordered = useMemo(() => p.notes.slice().reverse(), [p.notes])
  const filtered = onlyComments ? ordered.filter(n => n.kind === 'comment') : ordered
  const shown = all ? filtered : filtered.slice(-25)
  const comments = p.notes.filter(n => n.kind === 'comment').length
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-3 py-2 bg-app/60 border-b border-line flex items-center gap-2">
        <MessageSquare size={13} className="text-muted" />
        <span className="text-[12.5px] font-bold text-ink flex-1">Activity</span>
        <span className="text-[11px] text-muted tabular-nums">{comments} comment{comments === 1 ? '' : 's'}</span>
        <button onClick={() => setOnlyComments(o => !o)}
          className={'text-[11px] font-semibold rounded-md px-1.5 py-0.5 border ' + (onlyComments ? 'bg-ink text-white border-ink' : 'border-line text-muted hover:text-ink')}>
          {onlyComments ? 'Comments only' : 'Everything'}
        </button>
      </div>
      <div className="px-3 py-2">
        {filtered.length > 25 && !all && (
          <button onClick={() => setAll(true)} className="text-[11.5px] font-semibold text-muted hover:text-ink mb-1.5">Show all {filtered.length}</button>
        )}
        <Feed items={shown} me={me} nameOf={nameOf} act={act} busy={busy} superadmin={superadmin} members={p.members} onOpen={onOpen}
          empty={onlyComments ? 'No comments yet.' : 'Nothing has happened here yet.'} />
      </div>
      <div className="border-t border-line px-3 py-2">
        <Composer busy={busy} members={p.members} placeholder="Comment on the project… @ to mention" onSend={body => act({ action: 'comment', body })} />
      </div>
    </div>
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
      {p.members.some(isMe) && (() => {
        const mine = p.members.find(isMe)!
        const pr = prefsOf(mine.notify)
        const Tog = ({ k, label }: { k: keyof typeof pr; label: string }) => (
          <button onClick={() => act({ action: 'memberNotify', notify: { [k]: !pr[k] } })} disabled={busy}
            className={'text-[10.5px] font-semibold rounded-md px-1.5 py-0.5 border ' + (pr[k] ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{label}</button>
        )
        return (
          <div className="px-3 py-2 border-t border-line flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted mr-1">Email me:</span>
            <Tog k="assigned" label="Assigned" /><Tog k="mentions" label="Mentions" /><Tog k="comments" label="Comments" /><Tog k="digest" label="Morning digest" />
          </div>
        )
      })()}
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
  const plinks = p.links.filter(l => !l.task_id)   // task-level attachments live in the drawer
  const buildings = plinks.filter(l => l.kind === 'building')
  const units = plinks.filter(l => l.kind === 'listing')
  const others = plinks.filter(l => ['reservation', 'owner', 'claim', 'glitch', 'task'].includes(l.kind))
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
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Building, unit, guest, owner, claim, glitch or Breezeway task…"
              onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQ('') } }}
              className="w-full rounded-lg border border-line bg-white pl-7 pr-2 py-1.5 text-[12.5px]" />
            {searching && <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          {hits.length > 0 && (
            <div className="mt-1.5 rounded-lg border border-line divide-y divide-line max-h-[260px] overflow-y-auto">
              {hits.map(h => { const I = LINK_ICON[h.kind] || Building2; return (
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
        {plinks.length === 0 && !open && (
          <p className="px-3 py-3 text-[12px] text-muted">Not attached to anything yet.{canEdit ? ' Add a building, unit, reservation, owner, claim, glitch or Breezeway task.' : ''}</p>
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
        {others.map(o => { const I = LINK_ICON[o.kind] || Building2; const st = o.state; return (
          <div key={o.kind + o.ref_id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <I size={12} className="text-muted shrink-0" />
              <span className="text-[12.5px] text-ink flex-1 truncate">{o.label || o.ref_id}</span>
              {st ? (
                <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ' + (TONE_CLS[st.tone] || TONE_CLS.open)} title="Live from the source">{st.label}</span>
              ) : <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted">{o.kind}</span>}
              {st?.href && <a href={st.href} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="Open"><ExternalLink size={11} /></a>}
              {canEdit && <button onClick={() => act({ action: 'unlink', kind: o.kind, refId: o.ref_id })} disabled={busy} className="text-muted hover:text-rose-600"><X size={11} /></button>}
            </div>
            {(st?.detail || (canEdit && o.kind !== 'owner')) && (
              <div className="pl-5 mt-0.5 flex items-center gap-2 text-[10.5px] text-muted">
                {st?.detail && <span className="truncate">{st.detail}</span>}
                {canEdit && o.kind !== 'owner' && o.kind !== 'task' && (
                  <button onClick={() => act({ action: 'linkToTask', kind: o.kind, refId: o.ref_id })} disabled={busy}
                    className="ml-auto inline-flex items-center gap-1 font-semibold hover:text-ink shrink-0" title="Make a task from this so it can be assigned and dated">
                    <ArrowRightCircle size={11} /> Make a task
                  </button>
                )}
              </div>
            )}
          </div>
        )})}
      </div>
    </div>
  )
}

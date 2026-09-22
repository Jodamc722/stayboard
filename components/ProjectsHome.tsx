'use client'
// PROJECTS HOME — the first screen behind the Projects tab.
//
// Asana's home answers two questions before you click anything: what is on me today, and where
// is everything. So: a strip with your overdue / due-today / this-week counts (from the same
// endpoint My Tasks uses), then every project you are on as a tile, grouped the way the rail
// groups them. A tile shows the one thing a card is for — how it is doing — and opens the page.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Lock, Repeat, ListChecks, KanbanSquare, Loader2, Truck, ChevronRight, ChevronDown, MoreHorizontal, Archive, Trash2, RotateCcw, ShieldAlert, Check, Circle } from 'lucide-react'
import { ACCENT_CLS, iconOf, accentOf } from '@/lib/projects-shared'
import { Pill, LeanHead, Tip, LeanEmpty } from '@/components/lean'

type P = {
  id: string; title: string; summary: string | null; kind?: string; category?: string; template_key?: string | null; stage: string; due_on: string | null; recurs?: any
  lead_email: string | null; building: string | null; market: string | null; settings?: any
  health: { state: string; reason: string | null }; progress: { done: number; total: number; pct: number | null; basis: string }
}
type Tpl = { key: string; label: string; kind: string; blurb: string; icon?: string; accent?: string }
type TrashItem = { id: string; kind: string; record_id: string; label: string; deleted_by: string | null; deleted_at: string; purge_after: string | null }

/** Days left before a deleted project is gone for good. Negative means the sweep has not run yet. */
const daysLeft = (iso: string | null) => {
  if (!iso) return null
  const ms = Date.parse(iso) - Date.now()
  return Math.max(0, Math.ceil(ms / 86400000))
}

const first = (s: string) => String(s || '').split(/[\s@]/)[0]
const niceDay = (ymd: string) => { try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }
const AVATAR_PALETTE = ['bg-indigo-100 text-indigo-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800', 'bg-sky-100 text-sky-800', 'bg-rose-100 text-rose-800', 'bg-violet-100 text-violet-800', 'bg-teal-100 text-teal-800', 'bg-orange-100 text-orange-800']
const avatarCls = (name: string) => { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0; return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length] }
type MineItem = { id: string; projectId: string; title: string; status: string; due: string | null; priority?: string; project: string; oneOnOne?: boolean; mine?: boolean; where?: string | null }
type MineGroups = { overdue: MineItem[]; today: MineItem[]; week: MineItem[]; later: MineItem[]; someday: MineItem[] }

export function ProjectsHome({ me, canEdit }: { me: string; canEdit: boolean }) {
  const [projects, setProjects] = useState<P[] | null>(null)
  const [templates, setTemplates] = useState<Tpl[]>([])
  // MY TASKS, ON THE PAGE (Jon, 2026-09-21: "home page is noise"). The strip used to print four
  // counts and a link; the overdue and due-today tasks themselves are what a person opens this
  // page for, so they sit at the top, each one completable in place.
  const [mine, setMine] = useState<{ groups: MineGroups; total: number } | null>(null)
  const [showWeek, setShowWeek] = useState(false)
  const [newMenu, setNewMenu] = useState(false)
  const [doneIds, setDoneIds] = useState<Record<string, boolean>>({})
  const completeMine = async (it: MineItem) => {
    setDoneIds(d => ({ ...d, [it.id]: true }))
    try {
      const r = await fetch('/api/projects/' + it.projectId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'taskSet', taskId: it.id, status: 'done' }) })
      if (!r.ok) throw new Error('save failed')
    } catch { setDoneIds(d => ({ ...d, [it.id]: false })); setNote('That task did not save.') }
  }
  const [err, setErr] = useState<string | null>(null)
  // Which of the foldable groups this person has opened. Vendor jobs start folded.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [trash, setTrash] = useState<TrashItem[] | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [purging, setPurging] = useState<TrashItem | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const loadTrash = async () => {
    try {
      const j = await fetch('/api/trash?kind=project', { cache: 'no-store' }).then(r => r.json())
      setTrash(j?.items || [])
    } catch { setTrash([]) }
  }
  useEffect(() => { loadTrash() }, [])

  const reload = async () => {
    const j = await fetch('/api/projects?archived=0', { cache: 'no-store' }).then(r => r.json())
    if (j?.ok) setProjects(j.projects || [])
    await loadTrash()
  }

  /** Archive keeps everything and hides it. Delete starts a 60-day clock. Two different buttons. */
  const removeProject = async (p: P, mode: 'archive' | 'delete') => {
    if (mode === 'delete' && !confirm(`Delete "${p.title}"?\n\nIt goes to the trash with its tasks, people, comments and files, and can be restored for 60 days.`)) return
    setBusyId(p.id); setNote(null)
    try {
      const r = await fetch('/api/projects', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, mode }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'That did not work.')
      setNote(mode === 'delete' ? `"${p.title}" is in the trash. You have 60 days to change your mind.` : `"${p.title}" is archived.`)
      await reload()
    } catch (e: any) { setNote(String(e?.message || e)) } finally { setBusyId(null) }
  }

  const restore = async (t: TrashItem) => {
    setBusyId(t.id); setNote(null)
    try {
      const r = await fetch('/api/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore', id: t.id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'That did not work.')
      setNote(`"${t.label}" is back.`)
      await reload()
    } catch (e: any) { setNote(String(e?.message || e)) } finally { setBusyId(null) }
  }

  useEffect(() => {
    fetch('/api/projects?archived=0', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (!j?.ok) throw new Error(j?.error || 'Could not load projects.'); setProjects(j.projects || []); setTemplates(j.templates || []) })
      .catch(e => { setErr(String(e?.message || e)); setProjects([]) })
    fetch('/api/projects/mine', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (j?.ok !== false && j?.groups) setMine({ groups: j.groups, total: j.total || 0 }) })
      .catch(() => {})
  }, [])

  /**
   * VENDOR JOBS GET THEIR OWN HEADING (Jon, 2026-09-16).
   *
   * "Vendor visit for 1418/2" and "Vendor will deliver the new dryer between 10am-1pm" were sitting
   * in the same list as the Operations board, at the same size, looking like peers of it. They are
   * not — they are single jobs, there will be dozens of them, and every one that gets created
   * pushes the actual projects further down the page. A vendor visit is still a project with its
   * own page, files and invoice, which is why Jon kept them as projects; it just does not deserve
   * to compete for attention with a standing board.
   *
   * Matched on category rather than template_key so a job created by hand, without the template,
   * still lands in the right group.
   */
  const groups = useMemo(() => {
    const list = projects || []
    const live = (p: P) => p.stage !== 'done' && p.stage !== 'cancelled'
    const isVendor = (p: P) => p.category === 'vendor' || p.template_key === 'vendor_work'
    const team = (p: P) => p.kind !== 'personal' && p.kind !== 'one_on_one' && live(p)
    return [
      { key: 'personal', label: 'Your boards', icon: Lock, items: list.filter(p => p.kind === 'personal') },
      { key: 'one', label: 'One-on-ones', icon: Repeat, items: list.filter(p => p.kind === 'one_on_one' && live(p)) },
      { key: 'team', label: 'Projects', icon: KanbanSquare, items: list.filter(p => team(p) && !isVendor(p)) },
      { key: 'vendor', label: 'Vendor jobs', icon: Truck, items: list.filter(p => team(p) && isVendor(p)), quiet: true },
    ].filter(g => g.items.length)
  }, [projects])

  const done = (projects || []).filter(p => p.stage === 'done' || p.stage === 'cancelled').length

  return (
    <div className="pb-16">
      <LeanHead title="Projects" icon={<KanbanSquare size={20} className="text-muted" />}>
        {mine && mine.groups.overdue.length > 0 && <Pill tone="rose" title="Your tasks past their due date">{mine.groups.overdue.length} overdue</Pill>}
        {mine && mine.groups.today.length > 0 && <Pill tone="amber" title="Your tasks due today">{mine.groups.today.length} today</Pill>}
        {mine && <Pill title={mine.groups.week.length + ' due this week · ' + mine.total + ' open tasks on you'}>{mine.total} open</Pill>}
        {canEdit && (
          <span className="relative inline-flex">
            <button onClick={() => setNewMenu(v => !v)} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white px-3 py-1.5 text-[12.5px] font-bold hover:bg-brand-700"><Plus size={13} /> New <ChevronDown size={12} /></button>
            {newMenu && (<>
              <div className="fixed inset-0 z-30" onClick={() => setNewMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-40 w-56 rounded-xl border border-line bg-white shadow-lifted py-1">
                <Link href="/projects/board?new=1" className="block px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-app">Project</Link>
                <Link href="/projects/board?new=personal" className="block px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-app">Private board</Link>
                {templates.filter(t => t.kind !== 'personal').length > 0 && <p className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">From a template</p>}
                {templates.filter(t => t.kind !== 'personal').slice(0, 8).map(t => (
                  <Link key={t.key} href={'/projects/board?new=' + encodeURIComponent(t.key)} title={t.blurb} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-app"><span aria-hidden>{t.icon || '📋'}</span>{t.label}</Link>
                ))}
              </div>
            </>)}
          </span>
        )}
      </LeanHead>

      {/* ── MY TASKS: overdue and due today, right here, completable in place ── */}
      <section className="mb-4 rounded-2xl border border-line bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-app/60 border-b border-line">
          <ListChecks size={13} className="text-muted" />
          <span className="text-[12.5px] font-bold text-ink">My tasks</span>
          <Link href="/projects/mine" className="ml-auto text-[12px] font-semibold text-muted hover:text-ink">All my tasks →</Link>
        </div>
        {!mine ? (
          <p className="px-3 py-3 text-[12.5px] text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading…</p>
        ) : (() => {
          const rows: { it: MineItem; tone: 'late' | 'today' | 'week' }[] = [
            ...mine.groups.overdue.map(it => ({ it, tone: 'late' as const })),
            ...mine.groups.today.map(it => ({ it, tone: 'today' as const })),
            ...(showWeek ? mine.groups.week.map(it => ({ it, tone: 'week' as const })) : []),
          ]
          if (!rows.length) return (
            <p className="px-3 py-3 text-[12.5px] text-muted">Nothing overdue, nothing due today.{mine.groups.week.length ? <> <button onClick={() => setShowWeek(true)} className="underline hover:text-ink">{mine.groups.week.length} due this week</button>.</> : ''}</p>
          )
          return (
            <div>
              {rows.map(({ it, tone }) => {
                const isDone = doneIds[it.id] || it.status === 'done'
                return (
                  <div key={it.id} className={'flex items-center gap-2 px-3 border-t border-line first:border-t-0 ' + (isDone ? 'opacity-50' : '')} style={{ minHeight: 32 }}>
                    <Tip label={isDone ? 'Done' : 'Mark done'}><button onClick={() => !isDone && completeMine(it)} disabled={isDone} aria-label="Mark done"
                      className={'w-[18px] h-[18px] rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + (isDone ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-line text-muted hover:border-ink')}>
                      {isDone ? <Check size={10} strokeWidth={3} /> : <Circle size={0} />}
                    </button></Tip>
                    <Link href={'/projects/' + it.projectId + '?task=' + it.id} className={'min-w-0 flex-1 text-[13px] truncate hover:underline ' + (isDone ? 'line-through text-muted' : 'text-ink')}>{it.title}</Link>
                    <span className="text-[11px] text-muted truncate max-w-[160px] hidden sm:inline">{it.project}</span>
                    {it.due && <span className={'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums ' + (tone === 'late' ? 'bg-rose-100 text-rose-700 border-rose-200 font-bold' : tone === 'today' ? 'bg-amber-100 text-amber-800 border-amber-200 font-bold' : 'bg-white text-muted border-line')}>{tone === 'today' ? 'Today' : niceDay(it.due)}</span>}
                  </div>
                )
              })}
              {!showWeek && mine.groups.week.length > 0 && (
                <button onClick={() => setShowWeek(true)} className="w-full text-left px-3 py-1.5 border-t border-line text-[11.5px] font-semibold text-muted hover:text-ink hover:bg-app/60">+ {mine.groups.week.length} due this week</button>
              )}
            </div>
          )
        })()}
      </section>

      {err && <p className="mb-3 text-[12.5px] text-rose-700">{err}</p>}
      {projects === null && <p className="py-10 text-center text-[13px] text-muted inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" /> Loading projects…</p>}

      {projects && projects.length === 0 && <LeanEmpty>No projects yet{canEdit ? ' — start one with New.' : '.'}</LeanEmpty>}

      {groups.map(g => { const I = g.icon; const folded = !!(g as any).quiet && !openGroups[g.key]; return (
        <section key={g.key} className="mb-5">
          {/* A QUIET GROUP FOLDS. Vendor jobs are the many, not the important: a heading with a
              count says everything a glance needs, and one click opens them when you actually
              want them. Everything else stays open, as it was. */}
          <button type="button" onClick={() => (g as any).quiet && setOpenGroups(o => ({ ...o, [g.key]: !o[g.key] }))}
            className={'w-full flex items-center gap-2 px-1 mb-2 text-left ' + ((g as any).quiet ? 'group/head' : 'cursor-default')}>
            {(g as any).quiet && (folded ? <ChevronRight size={12} className="text-muted" /> : <ChevronDown size={12} className="text-muted" />)}
            <I size={12} className="text-muted" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted group-hover/head:text-ink">{g.label}</span>
            <span className="text-[11px] text-muted tabular-nums">{g.items.length}</span>
            <span className="flex-1 h-px bg-line" />
          </button>
          {/* ONE LINE PER BOARD. The tiles spent 120px on a summary nobody reads twice; a row
              carries the same facts — icon, name, progress, what is late, who leads — and the
              whole list fits on one screen. */}
          {!folded && <div className="rounded-2xl border border-line bg-white overflow-hidden">
            {g.items.map(p => {
              const h = p.health
              const ac = ACCENT_CLS[accentOf(p)]
              const openN = Math.max(0, (p.progress.total || 0) - (p.progress.done || 0))
              return (
                <div key={p.id} className="relative group/card flex items-center gap-2.5 px-2.5 border-t border-line first:border-t-0 hover:bg-app/60" style={{ minHeight: 40 }}>
                  <Link href={'/projects/' + p.id} className="flex items-center gap-2.5 min-w-0 flex-1 py-1.5">
                    <span className={'w-7 h-7 rounded-lg border grid place-items-center text-[15px] shrink-0 ' + ac.soft} aria-hidden>{iconOf(p)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink truncate">{p.title}{p.recurs && <span title="Repeats on a schedule" className="inline-flex"><Repeat size={10} className="inline ml-1.5 text-muted" /></span>}</span>
                      {(h.reason || p.building || p.market) && (
                        <span className="block text-[11px] text-muted truncate">
                          {h.reason && <span className={'font-semibold ' + (h.state === 'late' ? 'text-rose-700' : h.state === 'due' ? 'text-amber-700' : '')}>{h.reason}</span>}
                          {h.reason && (p.building || p.market) ? ' · ' : ''}{p.building || p.market || ''}
                        </span>
                      )}
                    </span>
                    {p.progress.total > 0 && (
                      <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 text-[11px] text-muted tabular-nums" title={`${p.progress.done} of ${p.progress.total} done`}>
                        <span className="w-16 h-1.5 rounded-full bg-app overflow-hidden inline-block"><span className={'block h-full ' + ac.solid} style={{ width: (p.progress.pct || 0) + '%' }} /></span>
                        <span className={openN ? 'text-ink font-semibold' : ''}>{openN} open</span>
                      </span>
                    )}
                    {p.lead_email && p.kind !== 'personal' && (
                      <span className={'w-5 h-5 rounded-full text-[9px] font-bold inline-flex items-center justify-center shrink-0 ' + avatarCls(p.lead_email)} title={p.lead_email}>{first(p.lead_email).slice(0, 1).toUpperCase()}</span>
                    )}
                  </Link>
                  {canEdit && (
                    <ProjectMenu p={p} busy={busyId === p.id}
                      onArchive={() => removeProject(p, 'archive')} onDelete={() => removeProject(p, 'delete')} />
                  )}
                </div>
              )
            })}
          </div>}
        </section>
      )})}

      {note && <p className="text-[12.5px] text-ink bg-app border border-line rounded-xl px-3 py-2 mb-4">{note}</p>}

      {done > 0 && <p className="text-[12px] text-muted px-1 mb-5">{done} finished project{done === 1 ? '' : 's'} — see the <Link href="/projects/board" className="underline hover:text-ink">board overview</Link>.</p>}

      {/* THE TRASH. Folded by default and silent when empty: a bin you have to look at is a bin
          that makes the page about deletion. The countdown is the whole point of it being here —
          "17 days left" is the difference between a safety net and a junk drawer. */}
      {trash && trash.length > 0 && (
        <section className="mb-5">
          <button type="button" onClick={() => setShowTrash(v => !v)} className="w-full flex items-center gap-2 px-1 mb-2 text-left group/head">
            {showTrash ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
            <Trash2 size={12} className="text-muted" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted group-hover/head:text-ink">Trash</span>
            <span className="text-[11px] text-muted tabular-nums">{trash.length}</span>
            <span className="flex-1 h-px bg-line" />
          </button>
          {showTrash && (
            <div className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
              {trash.map(t => {
                const left = daysLeft(t.purge_after)
                return (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink truncate">{t.label || 'Untitled project'}</span>
                      <span className="block text-[11px] text-muted truncate">
                        deleted {new Date(t.deleted_at).toLocaleDateString()}{t.deleted_by ? ` by ${first(t.deleted_by)}` : ''}
                        {left !== null && <> · <span className={left <= 7 ? 'text-rose-600 font-semibold' : ''}>{left === 0 ? 'goes today' : `${left} day${left === 1 ? '' : 's'} left`}</span></>}
                      </span>
                    </span>
                    <button onClick={() => restore(t)} disabled={busyId === t.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-muted hover:text-ink shrink-0">
                      {busyId === t.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Restore
                    </button>
                    <button onClick={() => setPurging(t)} disabled={busyId === t.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11.5px] font-semibold text-rose-700 hover:bg-rose-50 shrink-0"
                      title="Delete for good, now">
                      <ShieldAlert size={11} /> Delete for good
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {purging && (
        <PurgeDialog item={purging} onClose={() => setPurging(null)}
          onDone={async (msg) => { setPurging(null); setNote(msg); await reload() }} />
      )}

    </div>
  )
}

/**
 * ARCHIVE OR DELETE, from the card, without opening the project (Jon, 2026-09-16).
 *
 * Hidden until hover so tidying tools do not compete with the work — the same principle as the rest
 * of this page. The two are worded as what they DO rather than what they are called, because
 * "archive" and "delete" sound equally final to most people and only one of them is.
 *
 * The server decides who may press these; this only decides who is shown them. A non-owner who
 * finds the button anyway gets a clean 403 from /api/projects.
 */
function ProjectMenu({ p, busy, onArchive, onDelete }: {
  p: { id: string; title: string }; busy: boolean; onArchive: () => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={box} className="absolute top-2 right-2 z-20">
      <Tip label="Archive or delete"><button onClick={e => { e.preventDefault(); setOpen(o => !o) }} disabled={busy}
        aria-label="Archive or delete"
        className={'rounded-lg border border-line bg-white/90 backdrop-blur px-1 py-0.5 text-muted hover:text-ink shadow-sm ' + (open ? '' : 'opacity-0 group-hover/card:opacity-100 focus:opacity-100')}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
      </button></Tip>
      {open && (
        <div className="absolute right-0 mt-1 w-[232px] rounded-xl border border-line bg-white shadow-2xl p-1 text-left">
          <button onClick={e => { e.preventDefault(); setOpen(false); onArchive() }}
            className="w-full flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-app text-left">
            <Archive size={13} className="text-muted mt-0.5 shrink-0" />
            <span>
              <span className="block text-[12.5px] font-semibold text-ink">Archive</span>
              <span className="block text-[11px] text-muted">Off the board, nothing lost.</span>
            </span>
          </button>
          <button onClick={e => { e.preventDefault(); setOpen(false); onDelete() }}
            className="w-full flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-rose-50 text-left">
            <Trash2 size={13} className="text-rose-600 mt-0.5 shrink-0" />
            <span>
              <span className="block text-[12.5px] font-semibold text-rose-700">Delete</span>
              <span className="block text-[11px] text-muted">To the trash. Restorable for 60 days.</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * DELETING SOMETHING FOR GOOD, BEFORE ITS 60 DAYS ARE UP.
 *
 * Jon asked for a password on this. He first described a new "admin level password" kept in user
 * settings; offered the alternatives, he chose re-entering the one he already signs in with, and
 * that is the safer of the two by some distance. This app has been burnt by the other kind: the old
 * glitch delete demanded an admin share password that had never been set, so the button was locked
 * forever and the only way to discover that was to press it. A password everybody already has
 * cannot rot, and there is no second secret to store or leak.
 *
 * The field is a real password input, the value is sent once over HTTPS and never held anywhere
 * else, and the server checks it against Supabase on a throwaway client so the check cannot disturb
 * the session that made it.
 */
function PurgeDialog({ item, onClose, onDone }: {
  item: TrashItem; onClose: () => void; onDone: (msg: string) => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    if (!password) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/trash/purge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, password }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'That did not work.')
      setPassword('')
      onDone(`"${item.label}" is gone for good.`)
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-ink/30 grid place-items-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-white shadow-2xl p-4">
        <p className="text-[14px] font-bold text-ink flex items-center gap-2"><ShieldAlert size={15} className="text-rose-600" /> Delete for good</p>
        <p className="text-[12.5px] text-ink/85 mt-2">
          <strong>{item.label || 'This project'}</strong> and everything in it — tasks, people, comments, invoices and files — will be removed permanently. This cannot be undone.
        </p>
        <p className="text-[12px] text-muted mt-2">Leave it alone and it goes on its own when the 60 days are up.</p>
        <label className="block mt-3">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Your Lighthouse password</span>
          <input type="password" autoFocus value={password} autoComplete="current-password"
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && password && !busy) go(); if (e.key === 'Escape') onClose() }}
            className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-ink" />
        </label>
        {err && <p className="text-[12.5px] text-rose-700 mt-2">{err}</p>}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-[12.5px] font-semibold text-muted hover:text-ink px-2 py-1">Keep it</button>
          <button onClick={go} disabled={!password || busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 text-white px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-40">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete permanently
          </button>
        </div>
      </div>
    </div>
  )
}

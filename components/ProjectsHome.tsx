'use client'
// PROJECTS HOME — the first screen behind the Projects tab.
//
// Asana's home answers two questions before you click anything: what is on me today, and where
// is everything. So: a strip with your overdue / due-today / this-week counts (from the same
// endpoint My Tasks uses), then every project you are on as a tile, grouped the way the rail
// groups them. A tile shows the one thing a card is for — how it is doing — and opens the page.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Lock, Repeat, Clock, AlertTriangle, ListChecks, KanbanSquare, Loader2, LayoutTemplate, Truck, ChevronRight, ChevronDown, MoreHorizontal, Archive, Trash2, RotateCcw, ShieldAlert } from 'lucide-react'
import { ACCENT_CLS, iconOf, accentOf } from '@/lib/projects-shared'

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
const hello = () => { const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' })); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

export function ProjectsHome({ me, canEdit }: { me: string; canEdit: boolean }) {
  const [projects, setProjects] = useState<P[] | null>(null)
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [mine, setMine] = useState<{ overdue: number; today: number; week: number; total: number } | null>(null)
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
      .then(j => { if (j?.ok !== false && j?.groups) setMine({ overdue: j.groups.overdue.length, today: j.groups.today.length, week: j.groups.week.length, total: j.total || 0 }) })
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
      <header className="mb-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted inline-flex items-center gap-1.5"><KanbanSquare size={12} /> Projects</p>
          <h1 className="text-2xl font-bold text-ink tracking-tight">{hello()}{me ? `, ${first(me)[0]?.toUpperCase()}${first(me).slice(1)}` : ''}.</h1>
        </div>
      </header>

      {/* what is on me */}
      <Link href="/projects/mine" className="block rounded-2xl border border-line bg-white px-4 py-3 mb-4 hover:border-ink/40">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-[12.5px] font-bold text-ink inline-flex items-center gap-1.5"><ListChecks size={13} /> My Tasks</span>
          {mine ? (
            <>
              <span className={'text-[12.5px] inline-flex items-center gap-1 ' + (mine.overdue ? 'text-rose-700 font-bold' : 'text-muted')}><AlertTriangle size={12} /> {mine.overdue} overdue</span>
              <span className={'text-[12.5px] inline-flex items-center gap-1 ' + (mine.today ? 'text-ink font-semibold' : 'text-muted')}><Clock size={12} /> {mine.today} due today</span>
              <span className="text-[12.5px] text-muted">{mine.week} this week · {mine.total} open</span>
            </>
          ) : <span className="text-[12.5px] text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading…</span>}
          <span className="ml-auto text-[12px] font-semibold text-muted">Open →</span>
        </div>
      </Link>

      {err && <p className="mb-3 text-[12.5px] text-rose-700">{err}</p>}
      {projects === null && <p className="py-10 text-center text-[13px] text-muted inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" /> Loading projects…</p>}

      {projects && projects.length === 0 && (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center">
          <p className="text-[14px] font-semibold text-ink">Nothing here yet.</p>
          <p className="text-[12.5px] text-muted mt-1 max-w-md mx-auto">A project is the work that does not fit a task. Start one from a template, or make a private board for yourself.</p>
        </div>
      )}

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
          {!folded && <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {g.items.map(p => {
              const h = p.health
              const ac = ACCENT_CLS[accentOf(p)]
              return (
                <div key={p.id} className="relative group/card">
                {canEdit && (
                  <ProjectMenu p={p} busy={busyId === p.id}
                    onArchive={() => removeProject(p, 'archive')} onDelete={() => removeProject(p, 'delete')} />
                )}
                <Link href={'/projects/' + p.id}
                  className="block group rounded-2xl border border-line bg-white p-3 hover:border-ink/30 hover:shadow-md transition">
                  <div className="flex items-start gap-2.5">
                    <span className={'w-10 h-10 rounded-xl border grid place-items-center text-[20px] shrink-0 ' + ac.soft} aria-hidden>{iconOf(p)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-ink leading-snug">{p.title}</span>
                      {p.summary && <span className="block text-[11.5px] text-muted mt-0.5 line-clamp-2">{p.summary}</span>}
                    </span>
                    {p.recurs && <Repeat size={11} className="text-muted shrink-0 mt-1" />}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[11px] text-muted">
                    {p.progress.total > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-16 h-1.5 rounded-full bg-app overflow-hidden inline-block"><span className={'block h-full ' + ac.solid} style={{ width: (p.progress.pct || 0) + '%' }} /></span>
                        <span className="tabular-nums">{p.progress.done}/{p.progress.total}</span>
                      </span>
                    )}
                    {h.reason && <span className={'font-semibold ' + (h.state === 'late' ? 'text-rose-700' : h.state === 'due' ? 'text-amber-700' : '')}>{h.reason}</span>}
                    {(p.building || p.market) && <span>· {p.building || p.market}</span>}
                    {p.lead_email && p.kind !== 'personal' && <span>· {first(p.lead_email)}</span>}
                  </div>
                </Link>
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

      {canEdit && (
        <section>
          <div className="flex items-center gap-2 px-1 mb-2">
            <LayoutTemplate size={12} className="text-muted" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Start something</span>
            <span className="flex-1 h-px bg-line" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/projects/board?new=1" className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white px-3 py-1.5 text-[12.5px] font-bold hover:bg-brand-700"><Plus size={13} /> New project</Link>
            <Link href="/projects/board?new=personal" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-muted hover:text-ink"><Lock size={12} /> Private board</Link>
            {templates.filter(t => t.kind !== 'personal').slice(0, 8).map(t => {
              const ac = ACCENT_CLS[((t.accent && t.accent in ACCENT_CLS) ? t.accent : 'indigo') as keyof typeof ACCENT_CLS]
              return (
                <Link key={t.key} href={'/projects/board?new=' + encodeURIComponent(t.key)} title={t.blurb}
                  className={'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[12.5px] font-semibold hover:shadow-sm ' + ac.soft + ' ' + ac.text}>
                  <span className="text-[14px]" aria-hidden>{t.icon || '📋'}</span> {t.label}
                </Link>
              )
            })}
          </div>
        </section>
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
      <button onClick={e => { e.preventDefault(); setOpen(o => !o) }} disabled={busy}
        title="Archive or delete"
        className={'rounded-lg border border-line bg-white/90 backdrop-blur px-1 py-0.5 text-muted hover:text-ink shadow-sm ' + (open ? '' : 'opacity-0 group-hover/card:opacity-100 focus:opacity-100')}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
      </button>
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

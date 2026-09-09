'use client'
// PROJECTS HOME — the first screen behind the Projects tab.
//
// Asana's home answers two questions before you click anything: what is on me today, and where
// is everything. So: a strip with your overdue / due-today / this-week counts (from the same
// endpoint My Tasks uses), then every project you are on as a tile, grouped the way the rail
// groups them. A tile shows the one thing a card is for — how it is doing — and opens the page.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Lock, Repeat, Clock, AlertTriangle, ListChecks, KanbanSquare, Loader2, LayoutTemplate } from 'lucide-react'
import { NotifyBell } from './NotifyBell'

type P = {
  id: string; title: string; summary: string | null; kind?: string; stage: string; due_on: string | null; recurs?: any
  lead_email: string | null; building: string | null; market: string | null
  health: { state: string; reason: string | null }; progress: { done: number; total: number; pct: number | null; basis: string }
}
type Tpl = { key: string; label: string; kind: string; blurb: string }

const first = (s: string) => String(s || '').split(/[\s@]/)[0]
const hello = () => { const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' })); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

export function ProjectsHome({ me, canEdit }: { me: string; canEdit: boolean }) {
  const [projects, setProjects] = useState<P[] | null>(null)
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [mine, setMine] = useState<{ overdue: number; today: number; week: number; total: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/projects?archived=0', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (!j?.ok) throw new Error(j?.error || 'Could not load projects.'); setProjects(j.projects || []); setTemplates(j.templates || []) })
      .catch(e => { setErr(String(e?.message || e)); setProjects([]) })
    fetch('/api/projects/mine', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (j?.ok !== false && j?.groups) setMine({ overdue: j.groups.overdue.length, today: j.groups.today.length, week: j.groups.week.length, total: j.total || 0 }) })
      .catch(() => {})
  }, [])

  const groups = useMemo(() => {
    const list = projects || []
    const live = (p: P) => p.stage !== 'done' && p.stage !== 'cancelled'
    return [
      { key: 'personal', label: 'Your boards', icon: Lock, items: list.filter(p => p.kind === 'personal') },
      { key: 'one', label: 'One-on-ones', icon: Repeat, items: list.filter(p => p.kind === 'one_on_one' && live(p)) },
      { key: 'team', label: 'Projects', icon: KanbanSquare, items: list.filter(p => p.kind !== 'personal' && p.kind !== 'one_on_one' && live(p)) },
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
        <div className="hidden lg:block"><NotifyBell /></div>
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

      {groups.map(g => { const I = g.icon; return (
        <section key={g.key} className="mb-5">
          <div className="flex items-center gap-2 px-1 mb-2">
            <I size={12} className="text-muted" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{g.label}</span>
            <span className="text-[11px] text-muted tabular-nums">{g.items.length}</span>
            <span className="flex-1 h-px bg-line" />
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {g.items.map(p => {
              const h = p.health
              const tone = h.state === 'late' ? 'border-l-rose-500' : h.state === 'blocked' ? 'border-l-slate-400' : h.state === 'due' ? 'border-l-amber-400' : h.state === 'done' ? 'border-l-emerald-500' : 'border-l-brand-400'
              return (
                <Link key={p.id} href={'/projects/' + p.id} style={{ borderLeftWidth: 3 }}
                  className={'rounded-xl border border-line bg-white px-3 py-2.5 hover:border-brand-300 hover:shadow-sm transition ' + tone}>
                  <div className="flex items-start gap-2">
                    <span className="flex-1 text-[13.5px] font-semibold text-ink leading-snug">{p.title}</span>
                    {p.recurs && <Repeat size={11} className="text-muted shrink-0 mt-1" />}
                  </div>
                  {p.summary && <p className="text-[11.5px] text-muted mt-0.5 line-clamp-2">{p.summary}</p>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-muted">
                    {p.progress.total > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-16 h-1.5 rounded-full bg-app overflow-hidden inline-block"><span className="block h-full bg-emerald-500" style={{ width: (p.progress.pct || 0) + '%' }} /></span>
                        <span className="tabular-nums">{p.progress.done}/{p.progress.total}</span>
                      </span>
                    )}
                    {h.reason && <span className={'font-semibold ' + (h.state === 'late' ? 'text-rose-700' : h.state === 'due' ? 'text-amber-700' : '')}>{h.reason}</span>}
                    {(p.building || p.market) && <span>· {p.building || p.market}</span>}
                    {p.lead_email && p.kind !== 'personal' && <span>· {first(p.lead_email)}</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )})}

      {done > 0 && <p className="text-[12px] text-muted px-1 mb-5">{done} finished project{done === 1 ? '' : 's'} — see the <Link href="/projects/board" className="underline hover:text-ink">board overview</Link>.</p>}

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
            {templates.filter(t => t.kind !== 'personal').slice(0, 6).map(t => (
              <Link key={t.key} href={'/projects/board?new=' + encodeURIComponent(t.key)} title={t.blurb}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-muted hover:text-ink"><LayoutTemplate size={12} /> {t.label}</Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

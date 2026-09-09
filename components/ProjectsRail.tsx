'use client'
// THE PROJECTS RAIL — the Asana sidebar.
//
// Jon, 2026-09-09: "the project tab should open asana style interface". Asana's shape is a rail on
// the left listing every project you are on, and the project you clicked filling the rest. This is
// the rail. It lives in app/projects/layout.tsx, so every /projects/* page has it — Home, My Tasks,
// the kanban overview, and each project.
//
// Grouping is by what the thing IS: your private boards first (they are yours), then one-on-ones
// (private to two people), then team projects. Done and cancelled projects fall to the bottom of
// their group rather than vanishing — a finished 1:1 is still worth opening.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, ListChecks, KanbanSquare, Plus, Lock, Search, ChevronDown, ChevronRight, Repeat, Menu } from 'lucide-react'
import { NotifyBell } from './NotifyBell'
import { useShellMenu } from './Shell'

type P = { id: string; title: string; kind?: string; stage: string; recurs?: any; health: { state: string }; progress: { done: number; total: number } }

const DOT: Record<string, string> = { late: 'bg-rose-500', blocked: 'bg-slate-400', due: 'bg-amber-400', done: 'bg-emerald-500', ok: 'bg-brand-400' }

export function ProjectsRail() {
  const path = usePathname() || ''
  const menu = useShellMenu()
  const [projects, setProjects] = useState<P[]>([])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({ personal: true, one: true, team: true })
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/projects?archived=0', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (alive && j?.ok) setProjects(j.projects || []) }).catch(() => {})
    load()
    const t = setInterval(load, 90000)
    return () => { alive = false; clearInterval(t) }
  }, [path])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = projects.filter(p => !needle || p.title.toLowerCase().includes(needle))
    const rank = (p: P) => (p.stage === 'done' || p.stage === 'cancelled' ? 1 : 0)
    const sorted = (xs: P[]) => xs.slice().sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
    return [
      { key: 'personal', label: 'Your boards', items: sorted(list.filter(p => p.kind === 'personal')) },
      { key: 'one', label: 'One-on-ones', items: sorted(list.filter(p => p.kind === 'one_on_one')) },
      { key: 'team', label: 'Projects', items: sorted(list.filter(p => p.kind !== 'personal' && p.kind !== 'one_on_one')) },
    ]
  }, [projects, q])

  const current = projects.find(p => path === '/projects/' + p.id)
  const Row = ({ to, label, Icon, exact }: { to: string; label: string; Icon: any; exact?: boolean }) => {
    const on = exact ? path === to : path.startsWith(to)
    return (
      <Link href={to} onClick={() => setMobileOpen(false)}
        className={'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] ' + (on ? 'bg-white border border-line text-ink font-semibold' : 'text-muted hover:text-ink hover:bg-white/70')}>
        <Icon size={13} /> {label}
      </Link>
    )
  }

  const body = (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <Row to="/projects" label="Home" Icon={Home} exact />
        <Row to="/projects/mine" label="My Tasks" Icon={ListChecks} />
        <Row to="/projects/board" label="Board overview" Icon={KanbanSquare} />
      </div>
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a project…"
          className="w-full rounded-lg border border-line bg-white pl-6 pr-2 py-1 text-[12px] focus:outline-none focus:border-ink" />
      </div>
      {groups.map(g => (g.items.length > 0 || g.key === 'team') && (
        <div key={g.key}>
          <button onClick={() => setOpen(o => ({ ...o, [g.key]: !o[g.key] }))}
            className="w-full flex items-center gap-1 px-1 py-1 text-[10.5px] font-bold uppercase tracking-wider text-muted hover:text-ink">
            {open[g.key] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {g.key === 'personal' && <Lock size={9} />}{g.label}
            <span className="ml-auto font-normal tabular-nums normal-case">{g.items.length}</span>
          </button>
          {open[g.key] && (
            <div className="space-y-0.5">
              {g.items.map(p => {
                const on = path === '/projects/' + p.id
                const finished = p.stage === 'done' || p.stage === 'cancelled'
                return (
                  <Link key={p.id} href={'/projects/' + p.id} onClick={() => setMobileOpen(false)}
                    className={'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] ' + (on ? 'bg-white border border-line text-ink font-semibold' : 'text-ink/85 hover:bg-white/70') + (finished ? ' opacity-60' : '')}>
                    <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (DOT[p.health?.state] || DOT.ok)} />
                    <span className="truncate flex-1">{p.title}</span>
                    {p.recurs && <Repeat size={10} className="text-muted shrink-0" />}
                    {p.progress?.total > 0 && !finished && <span className="text-[10px] text-muted tabular-nums shrink-0">{p.progress.done}/{p.progress.total}</span>}
                  </Link>
                )
              })}
              {g.items.length === 0 && <p className="px-2 py-1 text-[11.5px] text-muted">Nothing yet.</p>}
            </div>
          )}
        </div>
      ))}
      <div className="pt-1 space-y-1">
        <Link href="/projects/board?new=1" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 rounded-lg bg-brand-600 text-white px-2.5 py-1.5 text-[12.5px] font-bold hover:bg-brand-700"><Plus size={13} /> New project</Link>
        <Link href="/projects/board?new=personal" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-muted hover:text-ink"><Lock size={12} /> New private board</Link>
      </div>
    </div>
  )

  // The Lighthouse mark is the way back to the rest of the app: it opens the main navigation as a
  // drawer over this page. Nothing else about the app is on screen while you are in Projects.
  const mark = (
    <button onClick={menu.open} title="Lighthouse menu" aria-label="Open the Lighthouse menu"
      className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/80 text-left">
      <span className="w-8 h-8 rounded-lg border border-line bg-white grid place-items-center text-muted"><Menu size={16} /></span>
      <img src="/icon-192.png" alt="" className="w-6 h-6 rounded-md shadow-sm" />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-bold text-ink leading-tight">Projects</span>
        <span className="block text-[10px] text-muted leading-tight">Lighthouse · menu</span>
      </span>
    </button>
  )

  return (
    <>
      {/* Desktop: the rail owns the left edge, full height, its own scroll. */}
      <aside className="hidden lg:flex w-[260px] shrink-0 h-full flex-col border-r border-line bg-app/70">
        <div className="px-2.5 pt-3 pb-2 flex items-center gap-1 border-b border-line">
          <div className="flex-1 min-w-0">{mark}</div>
          <NotifyBell compact />
        </div>
        <div className="flex-1 overflow-y-auto p-2.5">{body}</div>
      </aside>
      {/* Phone: a bar that names where you are and opens the same list. */}
      <div className="lg:hidden shrink-0 border-b border-line bg-white px-3 py-2 pt-safe-keep">
        <div className="flex items-center gap-2">
          <button onClick={menu.open} aria-label="Open the Lighthouse menu" className="w-10 h-10 rounded-lg border border-line grid place-items-center text-muted hover:text-ink shrink-0"><Menu size={18} /></button>
          <button onClick={() => setMobileOpen(o => !o)}
            className="flex-1 min-w-0 flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink text-left">
            <KanbanSquare size={14} className="text-muted" />
            <span className="truncate flex-1">{current ? current.title : path === '/projects/mine' ? 'My Tasks' : path.startsWith('/projects/board') ? 'Board overview' : 'Projects'}</span>
            <ChevronDown size={14} className="text-muted" />
          </button>
          <NotifyBell compact />
        </div>
        {mobileOpen && <div className="mt-2 rounded-2xl border border-line bg-app/70 p-2.5 max-h-[70vh] overflow-y-auto">{body}</div>}
      </div>
    </>
  )
}

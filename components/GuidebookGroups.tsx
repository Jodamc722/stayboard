'use client'
// THE GUIDEBOOK LIBRARY'S LIST (2026-11-09 audit: 398 KB of HTML). The page used to render every
// guidebook row for every building on the server — each row sent twice (the HTML and the data
// React re-reads), and each a link that pre-loaded its guidebook as it scrolled into view. The
// server now hands over one compact line per book and this draws them: buildings as sections you
// open, a search across all of them, and links that load only when tapped. Same rows, same order,
// same tags.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { Tag, LeanEmpty } from './lean'

export type GuidebookLine = { id: string; name: string; sub: string; themeLabel: string; themeTone: 'violet' | 'sky'; status: string }
export type GuidebookGroup = { name: string; items: GuidebookLine[] }

// A short library is simply shown; a long one opens on its first building.
const OPEN_ALL_UNDER = 40

export function GuidebookGroups({ groups }: { groups: GuidebookGroup[] }) {
  const total = useMemo(() => groups.reduce((a, g) => a + g.items.length, 0), [groups])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [all, setAll] = useState(false)
  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!needle) return groups
    return groups
      .map(g => g.name.toLowerCase().includes(needle) ? g : { name: g.name, items: g.items.filter(i => (i.name + ' ' + i.sub + ' ' + i.status).toLowerCase().includes(needle)) })
      .filter(g => g.items.length > 0)
  }, [groups, needle])
  const isOpen = (name: string, i: number) => {
    if (needle || all) return true
    if (open[name] !== undefined) return open[name]
    return total <= OPEN_ALL_UNDER || i === 0
  }
  const matches = shown.reduce((a, g) => a + g.items.length, 0)

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="relative flex-1 min-w-[160px] sm:flex-none">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a unit or building…"
            className="text-[12px] border border-line rounded-lg bg-white py-1 pl-6 pr-6 w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          {q ? <button onClick={() => setQ('')} aria-label="Clear the search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={12} /></button> : null}
        </span>
        {needle ? <span className="text-[12px] text-muted tabular-nums">{matches} match{matches === 1 ? '' : 'es'}</span> : null}
        {!needle && total > OPEN_ALL_UNDER ? (
          <button onClick={() => { setAll(v => !v); setOpen({}) }} className="ml-auto text-[12px] font-semibold text-muted hover:text-ink">
            {all ? 'Collapse all' : 'Open all buildings'}
          </button>
        ) : null}
      </div>
      {shown.length === 0 ? <LeanEmpty>No guidebook matches “{q.trim()}”.</LeanEmpty> : shown.map((grp, i) => {
        const on = isOpen(grp.name, i)
        return (
          <section key={grp.name} className="mb-4">
            <button onClick={() => { if (!needle && !all) setOpen(prev => ({ ...prev, [grp.name]: !on })) }} aria-expanded={on}
              className="w-full text-left text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 flex items-center gap-2 text-muted hover:text-ink">
              {on ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
              {grp.name}<span className="tabular-nums">{grp.items.length}</span>
            </button>
            {on ? (
              <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 [&>li:first-child]:rounded-t-2xl [&>li:last-child]:rounded-b-2xl">
                {grp.items.map(g => (
                  <li key={g.id}>
                    <Link href={`/guidebooks/${g.id}`} prefetch={false} title="Open to view, edit or print" className="group flex items-center gap-2.5 px-3 sm:px-4 py-2 hover:bg-app/60">
                      <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13.5px] font-semibold text-ink truncate max-w-[18rem]">{g.name}</span>
                        <span className="text-[12px] text-muted truncate max-w-[18rem]">{g.sub}</span>
                        <Tag tone={g.themeTone} title="Colour theme">{g.themeLabel}</Tag>
                        {g.status ? <Tag tone={g.status === 'draft' ? 'amber' : 'emerald'}>{g.status}</Tag> : null}
                      </div>
                      <ArrowRight size={15} className="shrink-0 text-muted group-hover:text-ink transition" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

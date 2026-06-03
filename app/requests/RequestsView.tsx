'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, Search, X, Clock, AlertTriangle } from 'lucide-react'
import { FieldRequest, PRIORITY_STYLE, STATUS_LABEL, STATUS_STYLE, TYPE_LABEL } from '@/lib/types'

type Tab = 'all' | 'open' | 'mine' | 'done'

export function RequestsView({ rows }: { rows: FieldRequest[] }) {
  const [tab, setTab]   = useState<Tab>('open')
  const [q, setQ]       = useState('')
  const [pri, setPri]   = useState<string | null>(null)

  const counts = useMemo(() => ({
    all:  rows.length,
    open: rows.filter(r => !['done', 'cancelled'].includes(r.status)).length,
    done: rows.filter(r => r.status === 'done').length
  }), [rows])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (tab === 'open' && ['done', 'cancelled'].includes(r.status)) return false
      if (tab === 'done' && r.status !== 'done') return false
      if (pri && r.priority !== pri) return false
      if (needle) {
        const hay = `${r.title} ${r.description ?? ''} ${r.building ?? ''} ${r.unit ?? ''} ${r.assignee_email ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [rows, tab, q, pri])

  return (
    <>
      <header className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight">Requests</h1>
          <p className="text-sm text-muted mt-1">
            Work orders, issues, and approvals — <strong className="text-ink/80">{counts.open}</strong> open · <strong className="text-ink/80">{counts.all}</strong> total
          </p>
        </div>
        <Link href="/requests/new" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-ink text-white hover:bg-ink/90 shadow-sm transition-colors">
          <Plus size={14} /> New request
        </Link>
      </header>

      <div className="bg-white rounded-2xl border border-line shadow-soft p-2 mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex p-0.5 rounded-lg bg-app">
          {([
            { v: 'open', l: `Open · ${counts.open}` },
            { v: 'done', l: `Done · ${counts.done}` },
            { v: 'all',  l: 'All' }
          ] as { v: Tab; l: string }[]).map(t => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${tab === t.v ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'}`}
            >{t.l}</button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search title, building, assignee…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white"
          />
        </div>

        <select
          value={pri ?? ''}
          onChange={e => setPri(e.target.value || null)}
          className="text-xs px-2.5 py-2 rounded-lg border border-line bg-white text-ink focus:border-brand-400 outline-none cursor-pointer"
        >
          <option value="">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {(q || pri) && (
          <button onClick={() => { setQ(''); setPri(null) }} className="text-xs text-muted hover:text-ink px-2 py-1 inline-flex items-center gap-1">
            <X size={11} /> Clear
          </button>
        )}

        <span className="ml-auto text-xs text-muted pr-2">{filtered.length} shown</span>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-line p-16 text-center text-muted shadow-soft">
          {rows.length === 0 ? (
            <>
              <p className="mb-3">No requests yet. Get started with your first one.</p>
              <Link href="/requests/new" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-ink text-white hover:bg-ink/90"><Plus size={14}/> New request</Link>
            </>
          ) : 'No requests match the current filters.'}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-line shadow-soft divide-y divide-line/60 overflow-hidden">
          {filtered.map(r => {
            const overdue = r.due_at && r.status !== 'done' && r.status !== 'cancelled' && new Date(r.due_at) < new Date(new Date().toISOString().slice(0,10))
            return (
              <Link key={r.id} href={`/requests/${r.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-app/40 transition-colors">
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold uppercase tracking-wide ring-1 ring-inset flex-shrink-0 ${PRIORITY_STYLE[r.priority]}`}>{r.priority}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium text-ink truncate">{r.title}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">{TYPE_LABEL[r.type]}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {(r.building || r.unit) && <span>{[r.building, r.unit].filter(Boolean).join(' · ')}</span>}
                    {r.assignee_email && <span>· {r.assignee_email.split('@')[0]}</span>}
                    {r.due_at && (
                      <span className={`inline-flex items-center gap-1 ${overdue ? 'text-rose-600 font-medium' : ''}`}>
                        {overdue ? <AlertTriangle size={11}/> : <Clock size={11}/>}
                        {overdue ? 'Overdue ' : 'Due '}
                        {new Date(r.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {r.vendor && <span>· {r.vendor}</span>}
                    {r.amount_usd != null && <span>· ${Number(r.amount_usd).toLocaleString()}</span>}
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold uppercase tracking-wide ring-1 ring-inset flex-shrink-0 ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}

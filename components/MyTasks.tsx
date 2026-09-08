'use client'
// MY TASKS — what do I do today, across every project.
//
// Five groups in the order a person works them: overdue, today, this week, later, no date. A group
// with nothing in it does not render — a heading over an empty list is a reproach, not information.
// Each row carries enough to decide without opening it: the project, where it is, when it's due,
// and a done-toggle so clearing the list is one tap per line.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Circle, CircleDot, Ban, Loader2, RefreshCw, ListChecks, Lock, MapPin, ArrowLeft } from 'lucide-react'

type Item = {
  id: string; projectId: string; title: string; status: string; due: string | null; priority: string
  section: string | null; subtask: boolean; project: string; oneOnOne: boolean; where: string | null
}
type Groups = { overdue: Item[]; today: Item[]; week: Item[]; later: Item[]; someday: Item[] }

const nice = (ymd: string | null) => {
  if (!ymd) return ''
  try { return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd }
}
const ICON: Record<string, any> = { todo: Circle, doing: CircleDot, blocked: Ban, done: Check }
const CLS: Record<string, string> = {
  todo: 'text-muted border-line hover:border-ink', doing: 'text-amber-600 border-amber-300 bg-amber-50',
  blocked: 'text-rose-600 border-rose-300 bg-rose-50', done: 'text-white bg-emerald-500 border-emerald-500',
}
const GROUPS: { key: keyof Groups; label: string; tone: string }[] = [
  { key: 'overdue', label: 'Overdue', tone: 'text-rose-700' },
  { key: 'today', label: 'Today', tone: 'text-ink' },
  { key: 'week', label: 'This week', tone: 'text-ink' },
  { key: 'later', label: 'Later', tone: 'text-muted' },
  { key: 'someday', label: 'No date', tone: 'text-muted' },
]

export function MyTasks({ me }: { me: string }) {
  const [groups, setGroups] = useState<Groups | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/projects/mine', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) throw new Error(j?.error || 'Could not load your tasks.')
      setGroups(j.groups); setTotal(j.total || 0)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const done = async (it: Item) => {
    setBusy(it.id)
    try {
      const r = await fetch('/api/projects/' + it.projectId, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'taskSet', taskId: it.id, status: it.status === 'done' ? 'todo' : 'done' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'Could not update.')
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }

  return (
    <div className="pb-16">
      <header className="mb-3">
        <Link href="/projects" className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink"><ArrowLeft size={12} /> Projects</Link>
        <div className="flex items-end gap-3 flex-wrap mt-1">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-muted inline-flex items-center gap-1.5"><ListChecks size={12} /> Operations</p>
            <h1 className="text-2xl font-bold text-ink tracking-tight">My Tasks</h1>
            <p className="text-[13px] text-muted mt-0.5">{loading && !groups ? 'Loading…' : total === 0 ? 'Nothing assigned to you across any project.' : `${total} open across your projects.`}</p>
          </div>
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-bold text-muted hover:text-ink disabled:opacity-40">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
          </button>
        </div>
        {err && <p className="mt-2 text-[12.5px] text-rose-700">{err}</p>}
      </header>

      {groups && total === 0 && !err && (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center">
          <p className="text-[13.5px] text-ink font-semibold">Clear.</p>
          <p className="text-[12.5px] text-muted mt-1">Nothing has your name on it. Either the day is done or nobody has assigned you anything yet.</p>
        </div>
      )}

      <div className="space-y-4">
        {groups && GROUPS.map(gr => {
          const list = groups[gr.key]
          if (!list.length) return null
          return (
            <div key={gr.key}>
              <p className={'text-[11px] font-bold uppercase tracking-wider mb-1.5 ' + gr.tone}>{gr.label} <span className="font-normal text-muted tabular-nums">· {list.length}</span></p>
              <div className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
                {list.map(it => {
                  const I = ICON[it.status] || Circle
                  const late = gr.key === 'overdue'
                  return (
                    <div key={it.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-app/50">
                      <button onClick={() => done(it)} disabled={busy === it.id} title="Mark done"
                        className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + CLS[it.status]}>
                        {busy === it.id ? <Loader2 size={10} className="animate-spin" /> : <I size={11} strokeWidth={3} />}
                      </button>
                      <Link href={'/projects/' + it.projectId} className="min-w-0 flex-1">
                        <span className="block text-[13px] text-ink truncate">{it.title}</span>
                        <span className="block text-[11px] text-muted truncate">
                          {it.oneOnOne && <Lock size={9} className="inline -mt-0.5 mr-0.5" />}{it.project}
                          {it.where && <> · <MapPin size={9} className="inline -mt-0.5" /> {it.where}</>}
                          {it.section && <> · {it.section}</>}
                        </span>
                      </Link>
                      {it.priority === 'urgent' && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-rose-100 text-rose-700 shrink-0">Urgent</span>}
                      {it.priority === 'high' && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">High</span>}
                      {it.due && <span className={'text-[11px] tabular-nums shrink-0 ' + (late ? 'text-rose-600 font-bold' : 'text-muted')}>{nice(it.due)}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

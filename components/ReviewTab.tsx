'use client'
// REVIEW & RECOMMENDED — the third tab on Today in Ops.
//
// Jon, 2026-08-31: "create a review / recommended tab", and earlier: "there can be a review section
// in Today in Ops for the ops team to review as well… maybe that's safer."
//
// Two halves, and the order is the argument:
//
//   RECOMMENDED — outstanding maintenance, each line carrying the next day that unit is actually
//   empty. This is the half somebody acts on. A backlog list tells a supervisor they are behind; a
//   backlog list with a workable date beside every row tells them what to do this morning.
//
//   PROPOSALS — what the automation would retire if it were switched on, and what it found done
//   twice. This is the half somebody APPROVES. It is deliberately not automatic: these cancel
//   inspections and reschedule real work, and Jon's own instinct was that a human should look first.
//
// Scheduling goes through the same route the rest of the board uses, so there is one code path that
// moves a task and one place for it to be wrong.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, CalendarDays, MapPin, AlertTriangle, Check, ExternalLink, Copy } from 'lucide-react'

const niceDate = (ymd: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(ymd + 'T12:00:00Z'))
  } catch { return ymd }
}
const lateWord = (n: number | null) =>
  n == null ? 'scheduled ahead' : n <= 0 ? 'due today' : n === 1 ? '1 day late' : `${n} days late`

type Item = {
  taskId: string; listingId: string; unit: string; task: string; dept: string
  scheduledDate: string | null; waitingDays: number | null
  target: { date: string; hasTrade: boolean; who: string[] } | null
  recommendation: string
}

export function ReviewTab({ market, onRefresh }: { market: string; onRefresh: () => void }) {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [half, setHalf] = useState<'recommended' | 'proposals'>('recommended')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/ops-today/review?market=${encodeURIComponent(market)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) throw new Error(j?.error || 'Could not load the review.')
      setData(j)
    } catch (e: any) { setError(String(e?.message || e)) } finally { setLoading(false) }
  }, [market])
  useEffect(() => { load() }, [load])

  const items: Item[] = useMemo(() => (data?.queue?.items || []).filter((i: Item) => !done.has(i.taskId)), [data, done])
  const summary = data?.queue?.summary || { total: 0, freeTrips: 0, needsATrip: 0, noWindow: 0 }

  // Move one job onto the day the planner recommends. Same endpoint the row-level actions use.
  async function schedule(i: Item) {
    if (!i.target || busy) return
    setBusy(i.taskId)
    try {
      const r = await fetch('/api/ops-today/task-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'schedule', taskId: i.taskId, date: i.target.date }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'Could not reschedule.')
      setDone(s => new Set(s).add(i.taskId))
      onRefresh()
    } catch (e: any) { setError(String(e?.message || e)) } finally { setBusy(null) }
  }

  if (loading && !data) {
    return <div className="px-4 py-10 text-center text-[13px] text-muted">
      <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Working out what is outstanding&hellip;</span>
    </div>
  }
  if (error && !data) {
    return <div className="px-4 py-10 text-center text-[13px]">
      <p className="text-rose-700">{error}</p>
      <button onClick={load} className="mt-2 text-[12.5px] font-semibold text-brand-600 hover:underline">Try again</button>
    </div>
  }

  return (
    <div className="p-3 sm:p-4">
      {/* ── THE SENTENCE, THEN THE LIST ── */}
      <div className="flex items-start gap-3 flex-wrap mb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink leading-relaxed">
            {summary.total === 0
              ? <span className="text-muted">Nothing outstanding in this market. Every maintenance job is either scheduled or done.</span>
              : <>
                  <b>{summary.freeTrips}</b> of {summary.total} ride along free &mdash; somebody is already going into that unit.
                  {summary.needsATrip > 0 && <> <b>{summary.needsATrip}</b> need a trip into an empty unit.</>}
                  {summary.noWindow > 0 && <> <b className="text-amber-700">{summary.noWindow}</b> have no empty day in three weeks.</>}
                </>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-bold text-muted hover:text-ink disabled:opacity-40">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      <div className="inline-flex rounded-xl border border-line bg-white p-0.5 mb-3">
        {([['recommended', `Recommended${summary.total ? ` · ${summary.total}` : ''}`],
           ['proposals', `Needs a decision${(data?.dupes?.summary?.groups || 0) + (data?.strays?.closed?.length || 0) ? ` · ${(data?.dupes?.summary?.groups || 0) + (data?.strays?.closed?.length || 0)}` : ''}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setHalf(k as any)}
            className={'px-3 py-1.5 rounded-[10px] text-[12.5px] font-bold ' + (half === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-[12px] text-rose-700 mb-2">{error}</p>}

      {half === 'recommended' && (
        <div className="rounded-2xl border border-line bg-white overflow-hidden">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">Nothing waiting. This is what a clear backlog looks like.</p>
          ) : items.map(i => (
            <div key={i.taskId} className="flex items-start gap-3 px-3 py-2.5 border-b border-line last:border-0 hover:bg-app/40">
              <span className={'shrink-0 mt-0.5 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ' + (
                i.target?.hasTrade ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : i.target ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200')}>
                {i.target?.hasTrade ? 'Free trip' : i.target ? 'Unit empty' : 'No window'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-ink">
                  <b>{i.unit}</b> <span className="text-muted">&middot; {i.task}</span>
                </p>
                <p className="text-[11.5px] text-muted mt-0.5">
                  <MapPin size={9} className="inline -mt-0.5 mr-0.5" />{i.recommendation}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={'text-[11.5px] font-bold tabular-nums ' + ((i.waitingDays ?? 0) > 0 ? 'text-rose-600' : 'text-muted')}>
                  {lateWord(i.waitingDays)}
                </p>
                {i.target && (
                  <button onClick={() => schedule(i)} disabled={!!busy}
                    className="mt-1 inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2 py-1 text-[11px] font-bold disabled:opacity-40">
                    {busy === i.taskId ? <Loader2 size={10} className="animate-spin" /> : <CalendarDays size={10} />}
                    Move to {niceDate(i.target.date)}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {half === 'proposals' && (
        <div className="space-y-3">
          {/* ── WHAT THE AUTOMATION WOULD RETIRE ── */}
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-3 py-2 bg-app border-b border-line">
              <p className="text-[12.5px] font-semibold text-ink">
                {data?.strays?.closed?.length || 0} inspection{(data?.strays?.closed?.length || 0) === 1 ? '' : 's'} would be cancelled
              </p>
              <p className="text-[11.5px] text-muted mt-0.5">
                Open more than a week and not created by Lighthouse. Cancelled, never marked complete &mdash; completing one
                would say the walk happened.
                {data?.strays?.skipped?.lighthouse ? ` ${data.strays.skipped.lighthouse} left alone, Lighthouse made them.` : ''}
              </p>
            </div>
            <div className="divide-y divide-line max-h-[260px] overflow-y-auto">
              {(data?.strays?.closed || []).slice(0, 60).map((c: any) => (
                <div key={c.id} className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[12px] text-ink flex-1 truncate">{c.unit} <span className="text-muted">&middot; {c.name}</span></span>
                  <span className="text-[11px] text-muted tabular-nums shrink-0">{c.date}</span>
                </div>
              ))}
              {(data?.strays?.closed || []).length === 0 && (
                <p className="px-3 py-3 text-[12px] text-muted">Nothing stray is sitting open.</p>
              )}
            </div>
            <p className="px-3 py-2 text-[11px] text-muted border-t border-line bg-app/50">
              This runs only when the automation is switched on in Settings &rarr; Automations. Until then it is a proposal and nothing else.
            </p>
          </div>

          {/* ── DONE TWICE ── */}
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-3 py-2 bg-app border-b border-line">
              <p className="text-[12.5px] font-semibold text-ink">
                {data?.dupes?.summary?.groups || 0} job{(data?.dupes?.summary?.groups || 0) === 1 ? '' : 's'} done twice
                {(data?.dupes?.summary?.extraTasks || 0) > 0 && <> &middot; {data.dupes.summary.extraTasks} wasted visit{data.dupes.summary.extraTasks === 1 ? '' : 's'}</>}
              </p>
              <p className="text-[11.5px] text-muted mt-0.5">Same unit, same day, same kind of job, completed twice &mdash; last 30 days.</p>
            </div>
            <div className="divide-y divide-line max-h-[260px] overflow-y-auto">
              {(data?.dupes?.groups || []).slice(0, 40).map((g: any) => (
                <div key={g.listingId + g.date + g.key} className="px-3 py-2">
                  <p className="text-[12px] text-ink"><b>{g.unit}</b> <span className="text-muted">&middot; {g.date} &middot; {String(g.key).replace(/-/g, ' ')}</span></p>
                  {g.tasks.map((t: any) => (
                    <p key={t.id} className={'text-[11px] ' + (t.id === g.keepId ? 'text-muted' : 'text-rose-700')}>
                      {t.id === g.keepId ? 'kept' : 'extra'} &middot; {t.name}
                      {t.assignees?.length ? ` · ${t.assignees.join(', ')}` : ' · nobody named'}
                    </p>
                  ))}
                </div>
              ))}
              {(data?.dupes?.groups || []).length === 0 && (
                <p className="px-3 py-3 text-[12px] text-muted">Nothing was done twice in the last 30 days.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

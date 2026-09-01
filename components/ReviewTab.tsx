'use client'
// REVIEW & RECOMMENDED — the third tab on Today in Ops.
//
// Jon, 2026-08-31: "create a review / recommended tab", and earlier: "there can be a review section
// in Today in Ops for the ops team to review as well… maybe that's safer."
//
// ONE LIST (Jon, 2026-09-01: "can review and suggestion be the same thing"). He is right, and the
// split was mine, not the work's. A coordinator does not think "this is a suggestion, that is a
// review item" — they think "what needs doing, and when can it be done". The engine's distinction
// (propose new work vs. re-place existing work) is an implementation detail that was leaking into
// the interface as two places to look.
//
// So both live here, in one list, with one action row: give it to somebody, put it on a day, apply.
// The only thing that survives the merge is a tag saying which kind a row is, because "create this"
// and "move this" have genuinely different consequences and somebody should be able to see which.
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
import { Loader2, RefreshCw, CalendarClock, MapPin, X, Wrench, Sparkles, ClipboardList, Lightbulb } from 'lucide-react'
import { useSuggestions, type Sug } from '@/components/SuggestionsBand'

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

/**
 * The number on the tab. The suggestions band used to shout from above the board; removing it must
 * not make today's proposals invisible, so the count comes with them. Suggestions only — the
 * waiting backlog is always there and a permanent badge for it would just be wallpaper.
 */
export function ReviewCount({ market }: { market: string }) {
  const ctx = useSuggestions()
  const n = ctx?.run?.enabled === false ? 0 : (ctx?.all(market) || []).length
  if (!n) return null
  return <span className="ml-1 text-[10px] font-bold px-1 rounded bg-brand-500 text-white tabular-nums">{n}</span>
}

// One row shape for both kinds, so the list renders once and the difference is a tag.
type Row =
  | { kind: 'suggestion'; id: string; unit: string; label: string; dept: string; why: string; sug: Sug }
  | { kind: 'pending'; id: string; unit: string; label: string; dept: string; why: string; item: Item }

const DEPT_ICON: Record<string, any> = { maintenance: Wrench, housekeeping: Sparkles, inspection: ClipboardList }

export function ReviewTab({ market, onRefresh }: { market: string; onRefresh: () => void }) {
  const sugCtx = useSuggestions()
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

  // ── THE MERGE ─────────────────────────────────────────────────────────────────────────────
  // Suggestions first: they are preventative, and the whole reason to do them today is that
  // somebody is already in the building. Pending work is sorted by how long it has waited, so the
  // two orderings do not fight — proposals lead, then the backlog by age.
  const rows: Row[] = useMemo(() => {
    const sugs = (sugCtx?.all(market) || []).map((sg): Row => ({
      kind: 'suggestion', id: sg.id, unit: sg.unit, label: sg.label, dept: sg.dept, why: sg.why, sug: sg,
    }))
    const pend = items.map((i): Row => ({
      kind: 'pending', id: i.taskId, unit: i.unit, label: i.task, dept: i.dept, why: i.recommendation, item: i,
    }))
    return [...sugs, ...pend]
  }, [sugCtx, market, items])
  const sugCount = rows.filter(r => r.kind === 'suggestion').length

  // Move one job onto the day the planner recommends. Same endpoint the row-level actions use.
  async function schedule(i: Item, date?: string, assignee?: string) {
    const when = date || i.target?.date
    if (!when || busy) return
    setBusy(i.taskId)
    try {
      const r = await fetch('/api/ops-today/task-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'schedule', taskId: i.taskId, date: when, ...(assignee ? { assignee } : {}) }),
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
            {rows.length === 0
              ? <span className="text-muted">Nothing outstanding in this market. Every maintenance job is either scheduled or done.</span>
              : <>
                  {sugCount > 0 && <><b>{sugCount}</b> suggested for today. </>}
                  {summary.total > 0 && <>
                    <b>{summary.freeTrips}</b> of {summary.total} waiting jobs ride along free &mdash; somebody is already going into that unit.
                    {summary.needsATrip > 0 && <> <b>{summary.needsATrip}</b> need a trip into an empty unit.</>}
                    {summary.noWindow > 0 && <> <b className="text-amber-700">{summary.noWindow}</b> have no empty day in three weeks.</>}
                  </>}
                </>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-bold text-muted hover:text-ink disabled:opacity-40">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      <div className="inline-flex rounded-xl border border-line bg-white p-0.5 mb-3">
        {([['recommended', `Recommended${rows.length ? ` · ${rows.length}` : ''}`],
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
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">Nothing waiting and nothing to suggest. This is what a clear backlog looks like.</p>
          ) : rows.map(r => (
            <RowLine key={r.kind + r.id} row={r} today={data?.today || ''} busy={busy}
              roster={sugCtx?.roster || []}
              onSchedule={(date, who) => r.kind === 'pending' ? schedule(r.item, date, who) : undefined}
              onAddSuggestion={(date, who) => r.kind === 'suggestion' && sugCtx ? sugCtx.act(r.sug, 'add', { assignee: who, scheduleDate: date }) : undefined}
              onDismiss={() => r.kind === 'suggestion' && sugCtx ? sugCtx.act(r.sug, 'dismiss') : undefined} />
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

// ── ONE ROW, EITHER KIND ────────────────────────────────────────────────────────────────────────
// The action row is deliberately identical for both. A coordinator deciding who does something and
// when should not have to learn two controls because the engine got there two different ways.
//
// Closed by default: the engine's pick is a DEFAULT, not a decision, and putting a name and a date
// picker on every row at rest turns a scannable list into a form. Open it and you override both.
function RowLine({ row, today, busy, roster, onSchedule, onAddSuggestion, onDismiss }: {
  row: Row
  today: string
  busy: string | null
  roster: { id: number; name: string; departments: string[] }[]
  onSchedule: (date?: string, who?: string) => void
  onAddSuggestion: (date?: string, who?: string) => void
  onDismiss: () => void
}) {
  const suggested = row.kind === 'suggestion'
  const target = row.kind === 'pending' ? row.item.target : null
  const defaultDate = target?.date || today
  const defaultWho = row.kind === 'suggestion' ? (row.sug.candidates[0] || '') : (target?.who?.[0] || '')

  const [open, setOpen] = useState(false)
  const [who, setWho] = useState(defaultWho)
  const [when, setWhen] = useState(defaultDate)

  const Icon = DEPT_ICON[row.dept] || Wrench
  const mine = busy === row.id
  const inDept = roster.filter(p => (p.departments || []).some(d => String(d).toLowerCase().includes(String(row.dept).slice(0, 6))))
  const rest = roster.filter(p => inDept.indexOf(p) < 0)

  const apply = () => {
    const d = open ? when : defaultDate
    const w = open ? who : defaultWho
    if (suggested) onAddSuggestion(d, w)
    else onSchedule(d, w)
  }

  const late = row.kind === 'pending' ? row.item.waitingDays : null

  return (
    <div className={(open ? 'bg-app/60 ' : 'hover:bg-app/40 ') + 'border-b border-line last:border-0'}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className={'w-5 h-5 rounded-md inline-flex items-center justify-center shrink-0 mt-0.5 ' +
          (suggested ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-500')}>
          <Icon size={11} strokeWidth={2.6} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-ink">
            <span className={'mr-1.5 align-[1px] text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded border ' +
              (suggested ? 'bg-brand-50 text-brand-700 border-brand-200'
                : target?.hasTrade ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : target ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200')}>
              {suggested ? 'Suggested' : target?.hasTrade ? 'Free trip' : target ? 'Unit empty' : 'No window'}
            </span>
            <b>{row.unit}</b> <span className="text-muted">&middot; {row.label}</span>
          </p>
          <p className="text-[11.5px] text-muted mt-0.5"><MapPin size={9} className="inline -mt-0.5 mr-0.5" />{row.why}</p>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {late != null && late > 0 && (
            <span className="hidden sm:inline text-[11px] font-bold tabular-nums text-rose-600 mr-1">{late}d late</span>
          )}
          <button onClick={apply} disabled={!!busy || (!suggested && !target && !open)}
            className="rounded-lg bg-ink text-white px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap disabled:opacity-40 inline-flex items-center gap-1">
            {mine && <Loader2 size={10} className="animate-spin" />}
            {suggested ? 'Add' : 'Move'}{(open ? who : defaultWho) ? ` \u00b7 ${(open ? who : defaultWho).split(' ')[0]}` : ''}
          </button>
          <button onClick={() => setOpen(o => !o)} disabled={!!busy} title="Who does it, and when"
            className={'rounded-lg border px-1.5 py-1 disabled:opacity-40 ' + (open ? 'border-ink text-ink' : 'border-line text-muted hover:text-ink')}>
            <CalendarClock size={11} />
          </button>
          {suggested && (
            <button onClick={onDismiss} disabled={!!busy} title="Hides this for 30 days"
              className="rounded-lg border border-line px-1.5 py-1 text-muted hover:text-rose-600 hover:border-rose-200 disabled:opacity-40">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="px-3 pb-2.5 pl-[38px] flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted">Give it to</span>
          <select value={who} onChange={e => setWho(e.target.value)}
            className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px] max-w-[150px]">
            <option value="">Nobody yet</option>
            {inDept.map(p => <option key={'d' + p.id} value={p.name}>{p.name}</option>)}
            {rest.length > 0 && <option key="sep" disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500'}</option>}
            {rest.map(p => <option key={'r' + p.id} value={p.name}>{p.name}</option>)}
          </select>
          <span className="text-[11px] text-muted">on</span>
          {/* min=today: a task dated last week never lands on any board, so nobody works it. */}
          <input type="date" value={when} min={today} onChange={e => setWhen(e.target.value)}
            className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px]" />
          {target && when !== target.date && (
            <span className="text-[11px] text-amber-700">Recommended day was {niceDate(target.date)}.</span>
          )}
        </div>
      )}
    </div>
  )
}

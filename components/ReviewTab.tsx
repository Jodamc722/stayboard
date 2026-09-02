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
import { Loader2, RefreshCw, CalendarClock, MapPin, X, Wrench, Sparkles, ClipboardList, Trash2, CheckSquare, Square, ChevronRight, ChevronDown, ExternalLink, FileText } from 'lucide-react'
import CommentThread from '@/components/CommentThread'

const bzTask = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)
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
  assignees: string[]; status: string; reportUrl: string | null
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
  // BULK IS FOR THE REVERSIBLE THINGS ONLY. Moving and assigning can be undone by moving and
  // assigning again; deleting cannot. So selection drives move/assign, and delete stays strictly
  // one row at a time behind a password that names the task — the asymmetry is the safety.
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulkDate, setBulkDate] = useState('')
  const [bulkWho, setBulkWho] = useState('')
  const [bulkNote, setBulkNote] = useState('')

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

  // ── DELETE ────────────────────────────────────────────────────────────────────────────────
  // Jon, 2026-09-01: "we should also be able to delete as well."
  //
  // Straight to the route that already exists, which requires the embedded admin password and
  // refuses departure cleans outright — their date comes from the reservation, so a deleted one
  // just reappears on the next sync looking like a mystery. The prompt NAMES the task and the unit:
  // a confirmation that does not say what it is about to destroy is not a confirmation.
  async function remove(i: Item) {
    if (busy) return
    const pw = window.prompt(`Admin password required to delete \u201c${i.task}\u201d on ${i.unit}:`)
    if (!pw) return
    setBusy(i.taskId)
    try {
      const r = await fetch('/api/ops-today/task-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', taskId: i.taskId, adminPassword: pw }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'Could not delete.')
      setDone(d => new Set(d).add(i.taskId))
      setSel(x => { const n = new Set(x); n.delete(i.taskId); return n })
      onRefresh()
    } catch (e: any) { setError(String(e?.message || e)) } finally { setBusy(null) }
  }

  // ── BULK ──────────────────────────────────────────────────────────────────────────────────
  // Sequential, with a per-row receipt. A bulk action that reports only "3 failed" and not WHICH
  // three is worse than doing them one at a time, because now nobody knows what state the board is
  // in. Each row that lands disappears from the list; each that does not keeps its place and says
  // why in the summary line.
  async function applySelected() {
    const chosen = rows.filter(r => sel.has(r.id))
    if (!chosen.length || busy) return
    setBulkNote(''); setError(null)
    let ok = 0
    const failures: string[] = []
    for (const r of chosen) {
      setBusy(r.id)
      try {
        if (r.kind === 'suggestion') {
          if (!sugCtx) throw new Error('suggestions unavailable')
          await sugCtx.act(r.sug, 'add', {
            assignee: bulkWho || (r.sug.candidates[0] || ''),
            scheduleDate: bulkDate || data?.today || '',
          })
        } else {
          const when = bulkDate || r.item.target?.date
          if (!when) throw new Error('no workable day')
          const res = await fetch('/api/ops-today/task-action', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'schedule', taskId: r.item.taskId, date: when,
              ...(bulkWho ? { assignee: bulkWho } : (r.item.target?.who?.[0] ? { assignee: r.item.target.who[0] } : {})),
            }),
          })
          const j = await res.json().catch(() => ({}))
          if (!res.ok || j?.error) throw new Error(j?.error || 'failed')
          setDone(d => new Set(d).add(r.item.taskId))
        }
        ok++
        setSel(x => { const n = new Set(x); n.delete(r.id); return n })
      } catch (e: any) {
        failures.push(`${r.unit} — ${String(e?.message || e).slice(0, 60)}`)
      }
    }
    setBusy(null)
    setBulkNote(
      failures.length
        ? `${ok} applied. ${failures.length} did not: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`
        : `${ok} applied.`)
    onRefresh()
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
        <>
          {/* ── THE BULK BAR ── Appears only when something is selected, so it costs nothing at
              rest. Leaving the day or the person blank keeps each row's own recommendation, which
              is the common case: select eight, press Move, and each goes to ITS best day. ── */}
          {sel.size > 0 && (
            <div className="mb-2 rounded-xl border border-ink/20 bg-app px-3 py-2 flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] font-bold text-ink">{sel.size} selected</span>
              <span className="text-[11px] text-muted">Give to</span>
              <select value={bulkWho} onChange={e => setBulkWho(e.target.value)}
                className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px] max-w-[150px]">
                <option value="">each row&rsquo;s pick</option>
                {(sugCtx?.roster || []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
              <span className="text-[11px] text-muted">on</span>
              <input type="date" value={bulkDate} min={data?.today || ''} onChange={e => setBulkDate(e.target.value)}
                className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px]" />
              {!bulkDate && <span className="text-[11px] text-muted">each row&rsquo;s best day</span>}
              <button onClick={applySelected} disabled={!!busy}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold disabled:opacity-40">
                {busy ? <Loader2 size={12} className="animate-spin" /> : null} Apply to {sel.size}
              </button>
              <button onClick={() => { setSel(new Set()); setBulkNote('') }} disabled={!!busy}
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-40">
                Clear
              </button>
            </div>
          )}
          {bulkNote && <p className="mb-2 text-[11.5px] text-muted">{bulkNote}</p>}

          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            {rows.length > 0 && (
              <div className="px-3 py-1.5 border-b border-line bg-app/60 flex items-center gap-2">
                <button onClick={() => setSel(s2 => s2.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))}
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted hover:text-ink">
                  {sel.size === rows.length && rows.length > 0 ? <CheckSquare size={12} /> : <Square size={12} />}
                  {sel.size === rows.length && rows.length > 0 ? 'Clear all' : 'Select all'}
                </button>
              </div>
            )}
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted">Nothing waiting and nothing to suggest. This is what a clear backlog looks like.</p>
            ) : rows.map(r => (
              <RowLine key={r.kind + r.id} row={r} today={data?.today || ''} busy={busy}
                roster={sugCtx?.roster || []}
                selected={sel.has(r.id)}
                onToggle={() => setSel(x => { const n = new Set(x); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })}
                onSchedule={(date, who) => r.kind === 'pending' ? schedule(r.item, date, who) : undefined}
                onAddSuggestion={(date, who) => r.kind === 'suggestion' && sugCtx ? sugCtx.act(r.sug, 'add', { assignee: who, scheduleDate: date }) : undefined}
                onDismiss={() => r.kind === 'suggestion' && sugCtx ? sugCtx.act(r.sug, 'dismiss') : undefined}
                onDelete={() => r.kind === 'pending' ? remove(r.item) : undefined} />
            ))}
          </div>
        </>
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
function RowLine({ row, today, busy, roster, selected, onToggle, onSchedule, onAddSuggestion, onDismiss, onDelete }: {
  row: Row
  today: string
  busy: string | null
  roster: { id: number; name: string; departments: string[] }[]
  selected: boolean
  onToggle: () => void
  onSchedule: (date?: string, who?: string) => void
  onAddSuggestion: (date?: string, who?: string) => void
  onDismiss: () => void
  onDelete: () => void
}) {
  const suggested = row.kind === 'suggestion'
  const target = row.kind === 'pending' ? row.item.target : null
  const defaultDate = target?.date || today
  const defaultWho = row.kind === 'suggestion' ? (row.sug.candidates[0] || '') : (target?.who?.[0] || '')

  const [open, setOpen] = useState(false)
  // DETAILS ARE A SEPARATE DISCLOSURE FROM THE SCHEDULER.
  // Opening "who and when" to read a comment, or opening a comment thread to change a date, are
  // both the wrong shape. One button changes the job, the other explains it.
  const [detail, setDetail] = useState(false)
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
        <input type="checkbox" checked={selected} onChange={onToggle} disabled={!!busy}
          className="mt-1 shrink-0" aria-label={`Select ${row.unit} ${row.label}`} />
        <button onClick={() => setDetail(d => !d)} aria-expanded={detail}
          aria-label={detail ? 'Hide details' : 'Show details'}
          className="mt-0.5 shrink-0 text-muted hover:text-ink">
          {detail ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
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
          {suggested ? (
            <button onClick={onDismiss} disabled={!!busy} title="Hides this for 30 days"
              className="rounded-lg border border-line px-1.5 py-1 text-muted hover:text-rose-600 hover:border-rose-200 disabled:opacity-40">
              <X size={11} />
            </button>
          ) : (
            // Deleting destroys the record. The route asks for the admin password and names the
            // task in the prompt; nothing here should make that feel like a one-tap action.
            <button onClick={onDelete} disabled={!!busy} title="Delete this task — admin password required"
              className="rounded-lg border border-line px-1.5 py-1 text-muted hover:text-rose-600 hover:border-rose-200 disabled:opacity-40">
              <Trash2 size={11} />
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

      {/* ── DETAILS ── Everything a normal task row gives you: what it is, where it stands, the
          field report, the way through to Breezeway, and the thread. A row you can act on but not
          read is a row people act on wrongly. ── */}
      {detail && (
        <div className="px-3 pb-3 pl-[52px]">
          <div className="rounded-xl border border-line bg-white p-3">
            {row.kind === 'pending' ? (
              <>
                <div className="flex items-start gap-x-4 gap-y-1 flex-wrap text-[11.5px]">
                  <span className="text-muted">Trade <b className="text-ink capitalize">{row.item.dept}</b></span>
                  <span className="text-muted">Status <b className="text-ink">{row.item.status || 'open'}</b></span>
                  <span className="text-muted">Scheduled <b className="text-ink">{row.item.scheduledDate ? niceDate(row.item.scheduledDate) : 'no date'}</b></span>
                  <span className="text-muted">
                    {row.item.assignees.length
                      ? <>On it <b className="text-ink">{row.item.assignees.join(', ')}</b></>
                      : <b className="text-rose-600">Nobody assigned</b>}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    {row.item.reportUrl && (
                      <a href={row.item.reportUrl} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink">
                        <FileText size={11} /> Field report
                      </a>
                    )}
                    <a href={bzTask(row.item.taskId)} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink">
                      <ExternalLink size={11} /> Open in Breezeway
                    </a>
                  </span>
                </div>
                <div className="mt-2 border-t border-line pt-2">
                  <CommentThread type="task" id={row.item.taskId} taskId={row.item.taskId}
                    label={`${row.unit} — ${row.label}`} link={bzTask(row.item.taskId)} />
                </div>
              </>
            ) : (
              // A suggestion has no task yet, so there is nothing to comment on and no report to
              // read. Saying that plainly beats an empty thread that looks broken.
              <div className="text-[11.5px] text-muted space-y-1">
                <p><span className="text-ink font-semibold">Why now:</span> {row.sug.why}</p>
                <div className="flex gap-x-4 flex-wrap">
                  <span>Trade <b className="text-ink capitalize">{row.sug.dept}</b></span>
                  <span>About <b className="text-ink">{row.sug.minutes} min</b></span>
                  <span>{row.sug.lastDone ? <>Last done <b className="text-ink">{niceDate(row.sug.lastDone)}</b></> : <b className="text-ink">No record of it being done</b>}</span>
                  {row.sug.vacantTonight && <span className="text-emerald-700 font-semibold">Unit is empty tonight</span>}
                </div>
                <p className="text-muted/80">Nothing to open yet &mdash; this task does not exist until you add it. Once it does, the report and the comment thread live here.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

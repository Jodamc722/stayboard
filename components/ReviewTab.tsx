'use client'
// FOCUS — the third view on Today in Ops (Jon, 2026-09-09: "make sure the suggestions use fable to
// determine real things to focus on and clarity about suggestions and things to review").
//
// Before this the tab was one merged list — cadence suggestions on top, the waiting backlog under
// them, a bulk bar, two halves — and a coordinator still had to decide what mattered. Now the model
// (lib/ops-focus, on the Fable tier by default; Users & admin → AI models) reads the day and every
// candidate and answers the actual question:
//
//   FOCUS TODAY   the few worth doing — each with a one-sentence reason and one button.
//   REVIEW        the rest of the backlog, grouped by why it waits (free trip · unit empty · no
//                 window · done twice), closed by default, opened when you want to plan ahead.
//                 Preventative jobs the engine parked for today are NOT here — the Due ledger is
//                 their home, and listing them twice is how two surfaces drift.
//
// The rows are still the engines' rows (suggestions from the provider, the backlog from
// /api/ops-today/review), so Add / Move / Delete go through the exact routes they always did. The
// model only ORDERS and EXPLAINS; it never touches a task.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, CalendarClock, X, Wrench, Sparkles, ClipboardList, Trash2, CheckSquare, Square, ChevronRight, ChevronDown, ExternalLink, FileText, Cpu } from 'lucide-react'
import CommentThread from '@/components/CommentThread'
import { useSuggestions, type Sug } from '@/components/SuggestionsBand'
import { useCachedFetch, invalidateCache } from '@/lib/swr'

const bzTask = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)
const niceDate = (ymd: string) => {
  try { return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd }
}
const clock = (iso: string) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) } catch { return '' } }

type Item = {
  taskId: string; listingId: string; unit: string; task: string; dept: string
  scheduledDate: string | null; waitingDays: number | null
  assignees: string[]; status: string; reportUrl: string | null
  target: { date: string; hasTrade: boolean; who: string[] } | null
  recommendation: string
}
type DupGroup = { listingId: string; unit: string; date: string; key: string; keepId: string; tasks: { id: string; name: string; assignees?: string[] }[] }
type Focus = {
  ok: boolean; today: string; market: string; model: string; at: string; cached: boolean; fallback?: string
  verdict: { headline: string; focus: { id: string; reason: string; do: 'add' | 'move' | 'cancel' }[]; review: { id: string; note: string }[]; parked: string }
  error?: string
}
const focusUrl = (market: string, refresh = false, date?: string) => `/api/ops-today/focus?market=${encodeURIComponent(market)}${refresh ? '&refresh=1' : ''}` + (date ? `&date=${date}` : '')
const dupId = (g: DupGroup) => 'dup:' + g.listingId + '|' + g.date + '|' + g.key

/** The number on the tab: how many the model says to focus on today. */
export function ReviewCount({ market, date }: { market: string | null; date?: string }) {
  // The SAME url the tab uses, or the badge and the tab are two cache entries, two requests and two
  // model calls on every board load — which is what the in-flight guard exists to prevent.
  const { data } = useCachedFetch<Focus>(market ? focusUrl(market, false, date) : null, { ttl: 5 * 60_000 })
  const n = data?.verdict?.focus?.length || 0
  if (!n) return null
  return <span className="ml-1 text-[10px] font-bold px-1 rounded bg-brand-500 text-white tabular-nums">{n}</span>
}

// One row shape for every kind, so the list renders once and the difference is a tag.
type Row =
  | { kind: 'suggestion'; id: string; unit: string; label: string; dept: string; why: string; sug: Sug }
  | { kind: 'pending'; id: string; unit: string; label: string; dept: string; why: string; item: Item }
  | { kind: 'dup'; id: string; unit: string; label: string; dept: string; why: string; group: DupGroup }

const DEPT_ICON: Record<string, any> = { maintenance: Wrench, housekeeping: Sparkles, inspection: ClipboardList }
const CARD = 'rounded-2xl border border-line bg-white overflow-hidden'

export function ReviewTab({ market, date, onRefresh }: { market: string; date?: string; onRefresh: () => void }) {
  const sugCtx = useSuggestions()
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulkDate, setBulkDate] = useState('')
  const [bulkWho, setBulkWho] = useState('')
  const [bulkNote, setBulkNote] = useState('')
  const { data: focus, loading: focusLoading, error: focusErr, refresh: refetchFocus } = useCachedFetch<Focus>(focusUrl(market, false, date), { ttl: 5 * 60_000 })
  const [reasking, setReasking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/ops-today/review?market=${encodeURIComponent(market)}` + (date ? `&date=${date}` : ''), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) throw new Error(j?.error || 'Could not load the review.')
      setData(j)
    } catch (e: any) { setError(String(e?.message || e)) } finally { setLoading(false) }
  }, [market, date])
  useEffect(() => { load() }, [load])

  // Re-ask the model: bypass the two-hour cache, then re-read the rows too.
  const reask = async () => {
    setReasking(true)
    try { await fetch(focusUrl(market, true, date), { cache: 'no-store' }); invalidateCache(focusUrl(market, false, date)); await refetchFocus(); await load() } finally { setReasking(false) }
  }

  const items: Item[] = useMemo(() => (data?.queue?.items || []).filter((i: Item) => !done.has(i.taskId)), [data, done])
  const groups: DupGroup[] = useMemo(() => (data?.dupes?.groups || []).filter((g: DupGroup) => !done.has(dupId(g))), [data, done])

  // ── every candidate, by id ──
  const byId = useMemo(() => {
    const m = new Map<string, Row>()
    for (const sg of (sugCtx?.all(market) || [])) m.set(sg.id, { kind: 'suggestion', id: sg.id, unit: sg.unit, label: sg.label, dept: sg.dept, why: sg.why, sug: sg })
    for (const i of items) m.set(i.taskId, { kind: 'pending', id: i.taskId, unit: i.unit, label: i.task, dept: i.dept, why: i.recommendation, item: i })
    for (const g of groups) m.set(dupId(g), { kind: 'dup', id: dupId(g), unit: g.unit, label: String(g.key).replace(/-/g, ' ') + ' — done twice on ' + g.date, dept: 'maintenance', why: g.tasks.length + ' tasks; keep #' + g.keepId + ', cancel the rest.', group: g })
    return m
  }, [sugCtx, market, items, groups])

  // ── the model's split, reconciled with what is actually still on the board ──
  const picks = useMemo(() => (focus?.verdict?.focus || []).map(p => ({ ...p, row: byId.get(p.id) })).filter(p => !!p.row) as { id: string; reason: string; do: string; row: Row }[], [focus, byId])
  const picked = useMemo(() => new Set(picks.map(p => p.id)), [picks])
  const selectable = useMemo(() => picks.filter(p => p.row.kind !== 'dup'), [picks])
  const suggestionsParked = useMemo(() => Array.from(byId.values()).filter(r => !picked.has(r.id) && r.kind === 'suggestion').length, [byId, picked])
  const noteOf = useMemo(() => { const m: Record<string, string> = {}; for (const r of (focus?.verdict?.review || [])) m[r.id] = r.note; return m }, [focus])
  // Cadence suggestions the model did not pick are NOT listed here: by the engine's own rule they
  // were dropped for today, and the Due ledger is the forward view that owns them. So they leave
  // `rest` entirely — otherwise the count above the list counts rows the list does not show.
  const rest = useMemo(() => Array.from(byId.values()).filter(r => !picked.has(r.id) && r.kind !== 'suggestion'), [byId, picked])
  const reviewGroups: { key: string; label: string; rows: Row[] }[] = useMemo(() => {
    const g = (k: string, label: string, rows: Row[]) => ({ key: k, label, rows })
    return [
      g('free', 'Free trip — somebody is already going', rest.filter(r => r.kind === 'pending' && r.item.target?.hasTrade)),
      g('empty', 'Unit empty — needs a person sent', rest.filter(r => r.kind === 'pending' && r.item.target && !r.item.target.hasTrade)),
      g('none', 'No empty day in three weeks', rest.filter(r => r.kind === 'pending' && !r.item.target)),
      // "Suggested by cadence — not today" is gone: by the engine's own rule those were dropped for
      // today, and the Due view is now the forward ledger they belong in.
      g('dup', 'Done twice — cancel the extra', rest.filter(r => r.kind === 'dup')),
    ].filter(x => x.rows.length)
  }, [rest])
  const allRows = useMemo(() => [...picks.map(p => p.row), ...rest], [picks, rest])

  // ── actions — the same routes as ever ──
  async function schedule(i: Item, date?: string, assignee?: string) {
    const when = date || i.target?.date
    if (!when || busy) return
    setBusy(i.taskId)
    try {
      const r = await fetch('/api/ops-today/task-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'schedule', taskId: i.taskId, date: when, ...(assignee ? { assignee } : {}) }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'Could not reschedule.')
      setDone(s => new Set(s).add(i.taskId)); onRefresh()
    } catch (e: any) { setError(String(e?.message || e)) } finally { setBusy(null) }
  }
  // Deleting destroys the record: the route wants the admin password and names the task in the prompt.
  async function remove(taskId: string, what: string, unit: string, after?: () => void) {
    if (busy) return
    const pw = window.prompt(`Admin password required to delete “${what}” on ${unit}:`)
    if (!pw) return
    setBusy(taskId)
    try {
      const r = await fetch('/api/ops-today/task-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', taskId, adminPassword: pw }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'Could not delete.')
      setDone(d => new Set(d).add(taskId)); setSel(x => { const n = new Set(x); n.delete(taskId); return n })
      after?.(); onRefresh()
    } catch (e: any) { setError(String(e?.message || e)) } finally { setBusy(null) }
  }
  const cancelExtra = (g: DupGroup) => {
    const extras = g.tasks.filter(t => t.id !== g.keepId && !done.has(t.id))
    const extra = extras[0]
    if (!extra) return
    // The group leaves the list only when its last extra is gone.
    remove(extra.id, extra.name, g.unit, () => { if (extras.length <= 1) setDone(d => new Set(d).add(dupId(g))) })
  }
  async function applySelected() {
    const chosen = allRows.filter(r => sel.has(r.id) && r.kind !== 'dup')
    if (!chosen.length || busy) return
    setBulkNote(''); setError(null)
    let ok = 0
    const failures: string[] = []
    for (const r of chosen) {
      setBusy(r.id)
      try {
        if (r.kind === 'suggestion') {
          if (!sugCtx) throw new Error('suggestions unavailable')
          await sugCtx.act(r.sug, 'add', { assignee: bulkWho || (r.sug.candidates[0] || ''), scheduleDate: bulkDate || data?.today || '' })
        } else if (r.kind === 'pending') {
          const when = bulkDate || r.item.target?.date
          if (!when) throw new Error('no workable day')
          const res = await fetch('/api/ops-today/task-action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'schedule', taskId: r.item.taskId, date: when, ...(bulkWho ? { assignee: bulkWho } : (r.item.target?.who?.[0] ? { assignee: r.item.target.who[0] } : {})) }) })
          const j = await res.json().catch(() => ({}))
          if (!res.ok || j?.error) throw new Error(j?.error || 'failed')
          setDone(d => new Set(d).add(r.item.taskId))
        }
        ok++
        setSel(x => { const n = new Set(x); n.delete(r.id); return n })
      } catch (e: any) { failures.push(`${r.unit} — ${String(e?.message || e).slice(0, 60)}`) }
    }
    setBusy(null)
    setBulkNote(failures.length ? `${ok} applied. ${failures.length} did not: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}` : `${ok} applied.`)
    onRefresh()
  }

  const rowProps = (r: Row) => ({
    row: r, today: data?.today || '', busy, roster: sugCtx?.roster || [],
    selected: sel.has(r.id),
    onToggle: () => setSel(x => { const n = new Set(x); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n }),
    onSchedule: (date?: string, who?: string) => r.kind === 'pending' ? schedule(r.item, date, who) : undefined,
    onAddSuggestion: (date?: string, who?: string) => r.kind === 'suggestion' && sugCtx ? sugCtx.act(r.sug, 'add', { assignee: who, scheduleDate: date }) : undefined,
    onDismiss: () => r.kind === 'suggestion' && sugCtx ? sugCtx.act(r.sug, 'dismiss') : undefined,
    onDelete: () => r.kind === 'pending' ? remove(r.item.taskId, r.item.task, r.unit) : r.kind === 'dup' ? cancelExtra(r.group) : undefined,
  })

  if (loading && !data) {
    return <div className="px-4 py-10 text-center text-[13px] text-muted"><span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Working out what is outstanding&hellip;</span></div>
  }
  if (error && !data) {
    return <div className="px-4 py-10 text-center text-[13px]"><p className="text-rose-700">{error}</p><button onClick={load} className="mt-2 text-[12.5px] font-semibold text-brand-600 hover:underline">Try again</button></div>
  }
  const v = focus?.verdict

  return (
    <div className="p-3 sm:p-4 space-y-4">
      {/* ── THE VERDICT ── one sentence from the model, and who said it. */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          {focusLoading && !focus
            ? <p className="text-[13.5px] text-muted inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading the day&hellip;</p>
            : focusErr && !focus
              ? <p className="text-[13px] text-rose-700">{focusErr}</p>
              : <p className="text-[14px] font-semibold text-ink leading-snug">{v?.headline || 'Nothing to decide today.'}</p>}
          {v?.parked && <p className="text-[12px] text-muted mt-0.5">{v.parked}</p>}
          {focus?.fallback && <p className="text-[11.5px] text-amber-800 mt-1">The model could not answer ({focus.fallback}) — this is the engines&rsquo; own order, not a judgement.</p>}
          {focus && !focus.fallback && (
            <p className="text-[11px] text-muted mt-1 inline-flex items-center gap-1" title={'Model: ' + focus.model}><Cpu size={10} /> AI · {clock(focus.at)}{focus.cached ? ' · cached' : ''}</p>
          )}
        </div>
        <button onClick={reask} disabled={reasking || loading} title="Ask the model again with the board as it is now"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-bold text-muted hover:text-ink disabled:opacity-40">
          {reasking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-ask
        </button>
      </div>
      {error && <p className="text-[12px] text-rose-700">{error}</p>}

      {/* ── BULK ── only when something is selected. */}
      {sel.size > 0 && (
        <div className="rounded-xl border border-ink/20 bg-app px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] font-bold text-ink">{sel.size} selected</span>
          <span className="text-[11px] text-muted">Give to</span>
          <select value={bulkWho} onChange={e => setBulkWho(e.target.value)} className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px] max-w-[150px]">
            <option value="">each row&rsquo;s pick</option>
            {(sugCtx?.roster || []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <span className="text-[11px] text-muted">on</span>
          <input type="date" value={bulkDate} min={data?.today || ''} onChange={e => setBulkDate(e.target.value)} className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px]" />
          {!bulkDate && <span className="text-[11px] text-muted">each row&rsquo;s best day</span>}
          <button onClick={applySelected} disabled={!!busy} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold disabled:opacity-40">{busy ? <Loader2 size={12} className="animate-spin" /> : null} Apply to {sel.size}</button>
          <button onClick={() => { setSel(new Set()); setBulkNote('') }} disabled={!!busy} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-40">Clear</button>
        </div>
      )}
      {bulkNote && <p className="text-[11.5px] text-muted">{bulkNote}</p>}

      {/* ── FOCUS TODAY ── */}
      <section>
        <div className="flex items-center gap-2 mb-1.5 px-1">
          <h3 className="text-[13.5px] font-bold text-ink inline-flex items-center gap-1.5"><Sparkles size={13} className="text-brand-600" /> Focus today <span className="text-muted font-semibold tabular-nums">{picks.length}</span></h3>
          {selectable.length > 1 && (
            <button onClick={() => setSel(s => selectable.every(p => s.has(p.id)) ? new Set() : new Set(selectable.map(p => p.id)))} className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted hover:text-ink">
              {selectable.every(p => sel.has(p.id)) ? <CheckSquare size={12} /> : <Square size={12} />} Select all
            </button>
          )}
        </div>
        <div className={CARD}>
          {picks.length === 0
            ? <p className="px-4 py-6 text-center text-[13px] text-muted">{focusLoading && !focus ? 'Deciding…' : allRows.length === 0 ? 'Nothing waiting and nothing to suggest. This is what a clear backlog looks like.' : 'Nothing worth pushing today — the day cannot hold it, or nobody is near. The rest is under Review.'}</p>
            : picks.map(p => <RowLine key={p.row.kind + p.id} {...rowProps(p.row)} reason={p.reason} />)}
        </div>
      </section>

      {/* ── REVIEW ── grouped by why it waits; closed at rest. */}
      <section>
        <h3 className="text-[13.5px] font-bold text-ink mb-1.5 px-1">
          Review <span className="text-muted font-semibold tabular-nums">{rest.length}</span>
          {suggestionsParked > 0 && <span className="ml-2 text-[11.5px] font-normal text-muted">· {suggestionsParked} preventative job{suggestionsParked === 1 ? '' : 's'} not for today — see Due</span>}
        </h3>
        <div className={CARD}>
          {reviewGroups.length === 0 && <p className="px-4 py-4 text-[12.5px] text-muted">Nothing else is waiting.</p>}
          {reviewGroups.map(g => {
            const open = !!openGroups[g.key]
            return (
              <div key={g.key} className="border-b border-line last:border-0">
                <button onClick={() => setOpenGroups(o => ({ ...o, [g.key]: !open }))} aria-expanded={open}
                  className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-app/50">
                  {open ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
                  <span className="text-[12.5px] font-semibold text-ink">{g.label}</span>
                  <span className="text-[11.5px] text-muted tabular-nums">{g.rows.length}</span>
                </button>
                {open && <div className="border-t border-line bg-app/30">{g.rows.map(r => <RowLine key={r.kind + r.id} {...rowProps(r)} reason={noteOf[r.id] || undefined} />)}</div>}
              </div>
            )
          })}
        </div>
      </section>

      {/* DECISIONS lived here — the automation's stray-inspection proposals, with no button on them.
          A list that fires nothing is a settings page, not an ops floor; it lives in Settings →
          Automations, where the switch that would act on it is. Duplicates kept their row, because
          those DO have a button. (2026-09-09 audit.) */}
    </div>
  )
}

// ── ONE ROW, ANY KIND ───────────────────────────────────────────────────────────────────────────
// `reason` is the model's sentence; when present it is what the row says, and the engine's own
// sentence moves into the details. Closed by default: the pick is a default, not a decision.
function RowLine({ row, today, busy, roster, selected, onToggle, onSchedule, onAddSuggestion, onDismiss, onDelete, reason }: {
  row: Row; today: string; busy: string | null; roster: { id: number; name: string; departments: string[] }[]
  selected: boolean; onToggle: () => void
  onSchedule: (date?: string, who?: string) => void; onAddSuggestion: (date?: string, who?: string) => void
  onDismiss: () => void; onDelete: () => void; reason?: string
}) {
  const suggested = row.kind === 'suggestion'
  const dup = row.kind === 'dup'
  const target = row.kind === 'pending' ? row.item.target : null
  const defaultDate = target?.date || today
  const defaultWho = row.kind === 'suggestion' ? (row.sug.candidates[0] || '') : (target?.who?.[0] || '')
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(false)
  const [who, setWho] = useState(defaultWho)
  const [when, setWhen] = useState(defaultDate)
  const Icon = DEPT_ICON[row.dept] || Wrench
  const mine = busy === row.id
  const inDept = roster.filter(p => (p.departments || []).some(d => String(d).toLowerCase().includes(String(row.dept).slice(0, 6))))
  const rest = roster.filter(p => inDept.indexOf(p) < 0)
  const apply = () => {
    const d = open ? when : defaultDate, w = open ? who : defaultWho
    if (suggested) onAddSuggestion(d, w); else if (!dup) onSchedule(d, w)
  }
  const late = row.kind === 'pending' ? row.item.waitingDays : null
  const tag = suggested ? { t: 'Add', c: 'bg-brand-50 text-brand-700 border-brand-200' }
    : dup ? { t: 'Done twice', c: 'bg-rose-50 text-rose-700 border-rose-200' }
    : target?.hasTrade ? { t: 'Free trip', c: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    : target ? { t: 'Unit empty ' + niceDate(target.date).replace(/^\w+, /, ''), c: 'bg-sky-50 text-sky-700 border-sky-200' }
    : { t: 'No window', c: 'bg-amber-50 text-amber-700 border-amber-200' }

  return (
    <div className={(open ? 'bg-app/60 ' : 'hover:bg-app/40 ') + 'border-b border-line last:border-0'}>
      <div className="flex items-start gap-2 px-3 py-2">
        {!dup && <input type="checkbox" checked={selected} onChange={onToggle} disabled={!!busy} className="mt-1 shrink-0" aria-label={`Select ${row.unit} ${row.label}`} />}
        <span className={'w-5 h-5 rounded-md inline-flex items-center justify-center shrink-0 mt-0.5 ' + (suggested ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-500')}><Icon size={11} strokeWidth={2.6} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-ink leading-snug"><b>{row.unit}</b> <span className="text-ink/80">&middot; {row.label}</span></p>
          <p className="text-[11.5px] text-muted mt-0.5 leading-snug">
            <span className={'mr-1.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-px rounded border align-[1px] ' + tag.c}>{tag.t}</span>
            {reason || row.why}
            {late != null && late > 0 && <span className="ml-1.5 font-bold text-rose-600 tabular-nums">{late}d late</span>}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {dup
            ? <button onClick={onDelete} disabled={!!busy} className="rounded-lg bg-rose-600 text-white px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap disabled:opacity-40 inline-flex items-center gap-1">{mine && <Loader2 size={10} className="animate-spin" />} Cancel extra</button>
            : <button onClick={apply} disabled={!!busy || (!suggested && !target && !open)} className="rounded-lg bg-ink text-white px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap disabled:opacity-40 inline-flex items-center gap-1">
                {mine && <Loader2 size={10} className="animate-spin" />}
                {suggested ? 'Add' : 'Move'}{(open ? who : defaultWho) ? ` · ${(open ? who : defaultWho).split(' ')[0]}` : ''}
              </button>}
          {!dup && <button onClick={() => setOpen(o => !o)} disabled={!!busy} title="Who does it, and when" className={'rounded-lg border px-1.5 py-1 disabled:opacity-40 ' + (open ? 'border-ink text-ink' : 'border-line text-muted hover:text-ink')}><CalendarClock size={11} /></button>}
          <button onClick={() => setDetail(d => !d)} aria-expanded={detail} title="Details" className={'rounded-lg border px-1.5 py-1 ' + (detail ? 'border-ink text-ink' : 'border-line text-muted hover:text-ink')}>{detail ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
          {suggested
            ? <button onClick={onDismiss} disabled={!!busy} title="Hides this for 30 days" className="rounded-lg border border-line px-1.5 py-1 text-muted hover:text-rose-600 hover:border-rose-200 disabled:opacity-40"><X size={11} /></button>
            : !dup && <button onClick={onDelete} disabled={!!busy} title="Delete this task — admin password required" className="rounded-lg border border-line px-1.5 py-1 text-muted hover:text-rose-600 hover:border-rose-200 disabled:opacity-40"><Trash2 size={11} /></button>}
        </div>
      </div>

      {open && !dup && (
        <div className="px-3 pb-2.5 pl-[38px] flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted">Give it to</span>
          <select value={who} onChange={e => setWho(e.target.value)} className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px] max-w-[150px]">
            <option value="">Nobody yet</option>
            {inDept.map(p => <option key={'d' + p.id} value={p.name}>{p.name}</option>)}
            {rest.length > 0 && <option key="sep" disabled>{'──────'}</option>}
            {rest.map(p => <option key={'r' + p.id} value={p.name}>{p.name}</option>)}
          </select>
          <span className="text-[11px] text-muted">on</span>
          <input type="date" value={when} min={today} onChange={e => setWhen(e.target.value)} className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px]" />
          {target && when !== target.date && <span className="text-[11px] text-amber-700">Recommended day was {niceDate(target.date)}.</span>}
        </div>
      )}

      {detail && (
        <div className="px-3 pb-3 pl-[38px]">
          <div className="rounded-xl border border-line bg-white p-3 text-[11.5px]">
            {reason && <p className="text-muted mb-1.5"><span className="text-ink font-semibold">Engine:</span> {row.why}</p>}
            {row.kind === 'pending' ? (
              <>
                <div className="flex items-start gap-x-4 gap-y-1 flex-wrap">
                  <span className="text-muted">Trade <b className="text-ink capitalize">{row.item.dept}</b></span>
                  <span className="text-muted">Status <b className="text-ink">{row.item.status || 'open'}</b></span>
                  <span className="text-muted">Scheduled <b className="text-ink">{row.item.scheduledDate ? niceDate(row.item.scheduledDate) : 'no date'}</b></span>
                  <span className="text-muted">{row.item.assignees.length ? <>On it <b className="text-ink">{row.item.assignees.join(', ')}</b></> : <b className="text-rose-600">Nobody assigned</b>}</span>
                  <span className="ml-auto flex items-center gap-3">
                    {row.item.reportUrl && <a href={row.item.reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-muted hover:text-ink"><FileText size={11} /> Field report</a>}
                    <a href={bzTask(row.item.taskId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-muted hover:text-ink"><ExternalLink size={11} /> Breezeway</a>
                  </span>
                </div>
                <div className="mt-2 border-t border-line pt-2">
                  <CommentThread type="task" id={row.item.taskId} taskId={row.item.taskId} label={`${row.unit} — ${row.label}`} link={bzTask(row.item.taskId)} />
                </div>
              </>
            ) : row.kind === 'suggestion' ? (
              <div className="text-muted space-y-1">
                <div className="flex gap-x-4 flex-wrap">
                  <span>Trade <b className="text-ink capitalize">{row.sug.dept}</b></span>
                  <span>About <b className="text-ink">{row.sug.minutes} min</b></span>
                  <span>{row.sug.lastDone ? <>Last done <b className="text-ink">{niceDate(row.sug.lastDone)}</b></> : <b className="text-ink">No record of it being done</b>}</span>
                  {row.sug.vacantTonight && <span className="text-emerald-700 font-semibold">Unit is empty tonight</span>}
                </div>
                <p className="text-muted/80">This task does not exist until you add it. Once it does, the report and the comment thread live here.</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {row.group.tasks.map(t => (
                  <p key={t.id} className={t.id === row.group.keepId ? 'text-muted' : 'text-rose-700'}>
                    {t.id === row.group.keepId ? 'kept' : 'extra'} &middot; {t.name}{t.assignees?.length ? ` · ${t.assignees.join(', ')}` : ' · nobody named'}
                    <a href={bzTask(t.id)} target="_blank" rel="noreferrer" className="ml-1.5 text-muted hover:text-ink"><ExternalLink size={10} className="inline" /></a>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

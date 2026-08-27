'use client'
// SUGGESTED WORK — one fetch, three places it shows up.
//
// Jon, 2026-08-26: "Lets get the suggestion populating, and have eve / ai agent be intuitive when
// deciding if today is a good day to do it, we cant have 200 tasks just auto populate."
// Jon, 2026-08-27: "the suggestion should live at the unit level, at the people level, and at the
// push level. I should be able to assign and schedule the tasks as well."
//
// So there are three surfaces over ONE list, and that matters more than it looks: a suggestion the
// band shows, the unit row shows and the person row shows is the SAME object with the same id, so
// adding it in one place makes it disappear from the other two. Three independent fetches would
// have meant three lists disagreeing about work that only exists once.
//
//   BAND   (push level)   — the shape of the day, above the board. Leads with the day read, and on
//                           a heavy turn day prints only that.
//   UNIT   (unit level)   — inside an expanded unit row: what this unit is owed.
//   PERSON (people level) — inside an expanded person row: what this person could pick up, because
//                           they are already in that building today.
//
// Every card carries the reason it is being proposed. A suggestion whose reasoning is invisible is
// an order, and people stop reading orders they did not agree to. Assign and schedule are one row
// deeper: the engine's pick is a default, never a decision.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  Lightbulb, Loader2, Plus, X, ChevronDown, ChevronRight, Wrench, Sparkles, ClipboardList,
  CalendarClock, Check, AlertTriangle, RefreshCw, Info,
} from 'lucide-react'

export type Sug = {
  id: string; cadenceKey: string; label: string; listingId: string; unit: string
  building: string | null; market: string; dept: 'maintenance' | 'housekeeping' | 'inspection'
  minutes: number; lastDone: string | null; daysSince: number | null; daysOver: number
  candidates: string[]; score: number; why: string; windowDays: number; vacantTonight: boolean
  proximity: 'building' | 'area' | 'none'; vendor: boolean
}
type Run = {
  ok: boolean; date: string; enabled: boolean
  day: { openCleans: number; cleaners: number; load: number; cap: number; verdict: string; heavy: boolean }
  suggestions: Sug[]; considered: number; historyComplete: boolean; error?: string
  inert?: { key: string; label: string; why: string }[]
  stalled?: { unit: string; label: string; since: string }[]
  doubleListed?: number
  pending?: Record<string, Pend[]>
}
export type Pend = {
  id: string; listingId: string; name: string; rawName: string
  dept: 'maintenance' | 'housekeeping' | 'inspection' | 'other'
  scheduledDate: string | null; assignees: string[]
  overdueDays: number | null; future: boolean; movedBefore: boolean
}
type Person = { id: number; name: string; departments: string[] }

const ICON: Record<Sug['dept'], any> = { maintenance: Wrench, housekeeping: Sparkles, inspection: ClipboardList }

// ── THE ONE LIST ────────────────────────────────────────────────────────────────────────────────
type Ctx = {
  run: Run | null
  loading: boolean
  roster: Person[]
  /** Handled ids, and what happened to them, so all three surfaces agree instantly. */
  gone: Record<string, string>
  /** Errors are per CARD. One shared string used to print the same failure under every open row. */
  errOf: (id: string) => string
  busy: string | null
  reload: () => void
  act: (s: Sug, action: 'add' | 'dismiss', opts?: { assignee?: string; scheduleDate?: string }) => Promise<void>
  /** Everything still live, for one unit / one person / everything. */
  forUnit: (listingId: string) => Sug[]
  forPerson: (name: string) => Sug[]
  all: (market?: string) => Sug[]
  pendingFor: (listingId: string) => Pend[]
  /** Move pending tasks onto a date (and optionally a person). Returns a sentence to show. */
  push: (listingId: string, unit: string, taskIds: string[], date: string, assignee?: string) => Promise<void>
  note: string
}
const SugCtx = createContext<Ctx | null>(null)
export const useSuggestions = () => useContext(SugCtx)

export function SuggestionsProvider({ date, roster, onAdded, children }: {
  date: string
  roster: Person[]
  onAdded: () => void
  children: React.ReactNode
}) {
  const [run, setRun] = useState<Run | null>(null)
  const [loading, setLoading] = useState(true)
  const [gone, setGone] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/suggestions' + (date ? `?date=${date}` : ''), { cache: 'no-store' })
      const j = await r.json()
      setRun(j && typeof j === 'object' ? j : null)
    } catch { setRun(null) } finally { setLoading(false) }
  }, [date])
  useEffect(() => { load() }, [load])
  // THE WHOLE PREMISE IS "SOMEBODY IS STANDING THERE RIGHT NOW".
  // The board polls every five minutes; this list used to be fetched once and then sat there, so by
  // 11am it was still showing the 7am verdict and the 7am picks — after cleans had closed and people
  // had moved buildings. A list that stale is worse than no list, because the server rebuilds on
  // every Add and rejects picks that have gone off.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5 * 60_000)
    const onShow = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
  }, [load])

  const act = useCallback(async (s: Sug, action: 'add' | 'dismiss', opts?: { assignee?: string; scheduleDate?: string }) => {
    setBusy(s.id)
    setErrs(e => { const n = { ...e }; delete n[s.id]; return n })
    try {
      const payload: any = action === 'add'
        ? { action, id: s.id, ...(opts?.assignee !== undefined ? { assignee: opts.assignee } : {}), ...(opts?.scheduleDate ? { scheduleDate: opts.scheduleDate } : {}) }
        : { action, id: s.id, days: 30 }
      const r = await fetch('/api/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      // A gateway timeout or a Next error page is HTML, and r.json() on HTML threw a parser error
      // that reached the screen as `Unexpected token '<'`. Nobody standing in a parking lot can do
      // anything with that sentence.
      const text = await r.text()
      let j: any = null
      try { j = JSON.parse(text) } catch { j = null }
      if (!r.ok) throw new Error(j?.error || (r.status >= 500 ? 'The server did not answer. Try again in a moment.' : 'That did not work.'))
      if (!j) throw new Error('The server did not answer. Try again in a moment.')
      setGone(g => ({
        ...g,
        [s.id]: action === 'add'
          ? (j.assigned ? `added for ${j.assigned}` : 'added, nobody assigned')
            + (j.scheduled && j.scheduled !== date ? ` on ${j.scheduled}` : '')
          : 'not now — hidden for 30 days',
      }))
      // The auto-sweep changes work nobody asked about in this click, so it must be SAID.
      if (j.swept?.moved) {
        setNote(`Brought ${j.swept.moved} other pending ${j.swept.moved === 1 ? 'job' : 'jobs'} in ${s.unit} onto the same visit: ${j.swept.names.join(', ')}.`)
      }
      if (action === 'add') { onAdded(); load() }
    } catch (e: any) {
      const m = String(e?.message || e)
      setErrs(er => ({
        ...er,
        // "Failed to fetch" is what a dropped signal looks like. Say that instead.
        [s.id]: /failed to fetch|networkerror|load failed/i.test(m)
          ? 'No connection right now — nothing was created. Try again when you have signal.'
          : m,
      }))
    } finally { setBusy(null) }
  }, [date, onAdded, load])

  const push = useCallback(async (listingId: string, unit: string, taskIds: string[], date: string, assignee?: string) => {
    setBusy('push:' + listingId); setNote('')
    try {
      const r = await fetch('/api/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push', listingId, unit, taskIds, scheduleDate: date, assignee }),
      })
      const text = await r.text()
      let j: any = null; try { j = JSON.parse(text) } catch { j = null }
      if (!r.ok || !j) throw new Error(j?.error || 'Could not move those.')
      setNote(j.moved ? `Moved ${j.moved} ${j.moved === 1 ? 'job' : 'jobs'} in ${unit} to ${date}: ${(j.names || []).join(', ')}.` : 'Nothing moved.')
      onAdded(); load()
    } catch (e: any) {
      const m = String(e?.message || e)
      setErrs(er => ({ ...er, ['push:' + listingId]: /failed to fetch|networkerror/i.test(m) ? 'No connection right now — nothing moved.' : m }))
    } finally { setBusy(null) }
  }, [onAdded, load])

  const live = useMemo(
    () => (run?.enabled && run.ok !== false ? (run.suggestions || []) : []).filter(s => !gone[s.id]),
    [run, gone])

  const value: Ctx = useMemo(() => ({
    run, loading, roster, gone, busy, act, reload: load, push, note,
    errOf: (id: string) => errs[id] || '',
    pendingFor: (id: string) => (run?.pending || {})[String(id)] || [],
    forUnit: (id: string) => live.filter(s => s.listingId === id),
    // A person sees what they could pick up — the jobs where they are one of the people already
    // working in that building today. Not "assigned to them": nothing is assigned yet.
    // Case- and spacing-tolerant: Breezeway assignee strings drift, and an exact === emptied a
    // person's section with no explanation at all.
    forPerson: (name: string) => {
      const n = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase()
      return live.filter(s => s.candidates.some(c => String(c).replace(/\s+/g, ' ').trim().toLowerCase() === n))
    },
    // The board files vendor-cleaned buildings under a 'Vendor' chip rather than their geography,
    // and marketOf never returns 'Vendor' — so on that chip the rows were there and the band was
    // permanently empty.
    all: (market?: string) => live.filter(s =>
      !market || market === 'all' || (market === 'Vendor' ? s.vendor : s.market === market && !s.vendor)),
  }), [run, loading, roster, gone, errs, busy, act, live, load, push, note])

  return <SugCtx.Provider value={value}>{children}</SugCtx.Provider>
}

// ── ONE CARD ────────────────────────────────────────────────────────────────────────────────────
function SugRow({ s, showUnit = true, defaultAssignee }: {
  s: Sug
  showUnit?: boolean
  /**
   * WHOSE ROW IS THIS. On a person's row the job must default to THAT person — it used to default
   * to `s.candidates[0]`, an arbitrary co-worker, so opening Maria's row produced a button reading
   * "Add for Devon" that created the task for Devon.
   */
  defaultAssignee?: string
}) {
  const ctx = useSuggestions()
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState<string>(defaultAssignee ?? s.candidates[0] ?? '')
  const [when, setWhen] = useState<string>(ctx?.run?.date || '')
  if (!ctx) return null
  const Icon = ICON[s.dept] || Wrench
  const busy = ctx.busy === s.id
  const err = ctx.errOf(s.id)
  const today = ctx.run?.date || ''
  const inDept = ctx.roster.filter(p => (p.departments || []).some(d => String(d).toLowerCase().includes(s.dept.slice(0, 6))))
  const rest = ctx.roster.filter(p => inDept.indexOf(p) < 0)
  const target = open ? who : (defaultAssignee ?? s.candidates[0] ?? '')
  const dated = open && when && when !== today
  // One clause on the row, the full reasoning when you open it. Three lines of grey prose per item
  // is what made six suggestions unreadable at 7am.
  const gist = s.candidates.length
    ? `${s.candidates[0].split(' ')[0]} is there today`
    : s.daysSince == null ? 'no record of it' : `${s.daysOver}d past due`

  return (
    <div className={open ? 'bg-app/60' : 'hover:bg-app/50'}>
      <div className="px-3 py-2 flex items-center gap-2.5">
        <span className="w-5 h-5 rounded-md bg-brand-50 text-brand-600 inline-flex items-center justify-center shrink-0">
          <Icon size={11} strokeWidth={2.6} />
        </span>
        <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
          <span className="block sm:inline text-[12.5px] font-bold text-ink sm:whitespace-nowrap">{s.label}</span>
          {showUnit && <span className="block sm:inline text-[12px] text-muted truncate">{s.unit}</span>}
        </div>
        <span className="hidden sm:block text-[11px] text-muted whitespace-nowrap w-[58px] text-right tabular-nums">{s.minutes} min</span>
        <span className="hidden md:block text-[11px] text-muted truncate w-[170px]">{gist}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => ctx.act(s, 'add', open
              ? { assignee: who, scheduleDate: when }
              : (defaultAssignee !== undefined ? { assignee: defaultAssignee } : undefined))}
            disabled={busy}
            className="rounded-lg bg-brand-500 hover:bg-brand-600 text-white px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap disabled:opacity-40 inline-flex items-center gap-1">
            {busy && <Loader2 size={10} className="animate-spin" />}
            {dated ? `Schedule ${when.slice(5).replace('-', '/')}` : `Add${target ? ` \u00b7 ${target.split(' ')[0]}` : ''}`}
          </button>
          <button onClick={() => setOpen(o => !o)} disabled={busy} title="Who does it, and when"
            className={'rounded-lg border px-1.5 py-1 disabled:opacity-40 ' + (open ? 'border-ink text-ink' : 'border-line text-muted hover:text-ink')}>
            <CalendarClock size={11} />
          </button>
          <button onClick={() => ctx.act(s, 'dismiss')} disabled={busy} title="Hides this job everywhere for 30 days"
            className="rounded-lg border border-line px-1.5 py-1 text-muted hover:text-rose-600 hover:border-rose-200 disabled:opacity-40">
            <X size={11} />
          </button>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-2 pl-[38px] flex items-center gap-1.5 flex-wrap">
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
          <span className="text-[11px] text-muted basis-full sm:basis-auto sm:ml-1">{s.why}</span>
        </div>
      )}
      {err && <p className="px-3 pb-2 pl-[38px] text-[11px] text-rose-700">{err}</p>}
    </div>
  )
}

// ── PENDING WORK IN A UNIT ──────────────────────────────────────────────────────────────────────
// Jon, 2026-08-27: "keep tabs on pending tasks in a particular unit." Same row language as a
// suggestion, one shade quieter, because these are not proposals — they are jobs that already exist
// and have been waiting. The action is a move, not a create.
function PendingRows({ listingId, unit, defaultAssignee }: {
  listingId: string; unit: string; defaultAssignee?: string
}) {
  const ctx = useSuggestions()
  const [when, setWhen] = useState<string>(ctx?.run?.date || '')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  if (!ctx) return null
  const rows = ctx.pendingFor(listingId)
  if (!rows.length) return null
  const today = ctx.run?.date || ''
  const busy = ctx.busy === 'push:' + listingId
  const err = ctx.errOf('push:' + listingId)
  const chosen = rows.filter(r => picked[r.id]).map(r => r.id)
  const allIds = rows.map(r => r.id)

  return (
    <div className="mt-2 rounded-xl border border-line bg-white overflow-hidden">
      <div className="px-2.5 py-1.5 bg-app border-b border-line flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Pending in this unit</span>
        <span className="text-[10px] font-bold text-white bg-muted rounded-full px-1.5 py-0.5 tabular-nums leading-none">{rows.length}</span>
        <span className="flex-1" />
        <input type="date" value={when} min={today} onChange={e => setWhen(e.target.value)}
          className="rounded-lg border border-line bg-white px-1.5 py-0.5 text-[11px]" />
        <button
          onClick={() => ctx.push(listingId, unit, chosen.length ? chosen : allIds, when, defaultAssignee)}
          disabled={busy}
          className="rounded-lg bg-ink text-white px-2 py-1 text-[11px] font-bold disabled:opacity-40 inline-flex items-center gap-1">
          {busy ? <Loader2 size={10} className="animate-spin" /> : <CalendarClock size={10} />}
          Bring {chosen.length ? chosen.length : 'all'} to this date
        </button>
      </div>
      <div className="divide-y divide-line">
        {rows.map(r => (
          <label key={r.id} className="px-2.5 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-app/50">
            <input type="checkbox" checked={!!picked[r.id]}
              onChange={e => setPicked(p => ({ ...p, [r.id]: e.target.checked }))} className="shrink-0" />
            <span className="min-w-0 flex-1 text-[12px] text-ink truncate">{r.name}</span>
            <span className="text-[10.5px] text-muted shrink-0 capitalize hidden sm:block">{r.dept}</span>
            <span className={'text-[10.5px] shrink-0 tabular-nums whitespace-nowrap '
              + (r.overdueDays != null && r.overdueDays > 14 ? 'text-rose-600 font-semibold' : 'text-muted')}>
              {r.overdueDays != null ? `${r.overdueDays}d late` : r.future ? `set ${String(r.scheduledDate).slice(5)}` : 'unscheduled'}
            </span>
            {r.assignees[0] && <span className="text-[10.5px] text-muted shrink-0 hidden md:block">{r.assignees[0].split(' ')[0]}</span>}
          </label>
        ))}
      </div>
      {err && <p className="px-2.5 py-1.5 text-[11px] text-rose-700 border-t border-line">{err}</p>}
    </div>
  )
}

// ── PUSH LEVEL: the band above the board ────────────────────────────────────────────────────────
export function SuggestionsBand({ market }: { market: string }) {
  const ctx = useSuggestions()
  const [open, setOpen] = useState(true)
  const [notesOpen, setNotesOpen] = useState(false)
  if (!ctx || ctx.loading || !ctx.run) return null

  // A TOTAL FAILURE MUST NOT LOOK LIKE A QUIET DAY.
  // The old guard returned null on `ok === false`, so the engine falling over and the engine having
  // nothing to say rendered identically — which is how a dark feature stays dark for a month.
  if (ctx.run.ok === false) {
    return (
      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
        <p className="text-[12.5px] font-bold text-rose-900 flex items-center gap-1.5">
          <AlertTriangle size={13} /> Suggestions are not running
        </p>
        <p className="text-[11.5px] text-rose-900/80 mt-0.5">{ctx.run.error || ctx.run.day?.verdict || 'The engine could not complete a run.'}</p>
      </div>
    )
  }
  if (!ctx.run.enabled) return null

  const list = ctx.all(market)
  const handled = Object.entries(ctx.gone)
  const heavy = ctx.run.day?.heavy
  const inert = ctx.run.inert || []
  const stalled = ctx.run.stalled || []
  const truncated = ctx.run.historyComplete === false
  const dbl = ctx.run.doubleListed || 0
  if (!list.length && !heavy && !handled.length && !inert.length && !stalled.length) return null

  // The caveats the engine already knew. Collected into ONE line with a count, rather than a stack
  // of amber paragraphs that push the actual board off a phone screen.
  const notes: string[] = []
  if (truncated) notes.push('Task history was too long to read in full, so a job shown as never done may just be older than we can see.')
  if (inert.length) notes.push(`${inert.map(i => i.label).join(', ')} is suggesting nothing until somebody picks which buildings it applies to (Settings \u2192 Preventative cadences).`)
  if (stalled.length) notes.push(`${stalled.length} preventative ${stalled.length === 1 ? 'job was' : 'jobs were'} scheduled and never done \u2014 ${stalled.slice(0, 3).map(x => `${x.label} at ${x.unit} (${x.since})`).join(', ')}${stalled.length > 3 ? ', and more' : ''}. Already on the board, so not proposed again.`)
  if (dbl) notes.push(`${dbl} apartment${dbl === 1 ? ' is' : 's are'} listed both whole and as halves \u2014 the whole-unit listing is skipped so one front door gets one job.`)

  return (
    <div className="mt-2.5 rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
      {/* ── THE HEADER ──────────────────────────────────────────────────────────────────────
          Jon, 2026-08-27: "just look at it, it's so ugly, make it cleaner." It was an amber slab
          with amber cards and three heavy black buttons, in an app that is white, grey and indigo
          everywhere else — it read as a warning banner, not as help, and the ragged card heights
          left the buttons on three different lines. This is the SAME shell as the board below it:
          white card, app-grey header strip, micro-caps label, one brand accent. */}
      <div className="px-3 py-2 bg-app border-b border-line flex items-center gap-2">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted shrink-0">Suggested today</span>
          {list.length > 0 && (
            <span className="text-[10px] font-bold text-white bg-brand-500 rounded-full px-1.5 py-0.5 tabular-nums leading-none shrink-0">{list.length}</span>
          )}
          {market !== 'all' && <span className="text-[10px] font-semibold text-muted shrink-0">in {market}</span>}
          {ctx.run.day?.verdict && (
            <span className="text-[11.5px] text-muted truncate hidden sm:block">{ctx.run.day.verdict}</span>
          )}
        </button>
        <button type="button" onClick={ctx.reload} title="Re-read the day"
          className="text-muted hover:text-ink shrink-0"><RefreshCw size={12} /></button>
        <button type="button" onClick={() => setOpen(o => !o)} title={open ? 'Collapse' : 'Expand'}
          className="text-muted hover:text-ink shrink-0">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      </div>

      {/* The verdict gets its own line on a phone, where it will not fit beside the label. */}
      {ctx.run.day?.verdict && (
        <p className="sm:hidden px-3 py-1.5 text-[11.5px] text-muted border-b border-line">{ctx.run.day.verdict}</p>
      )}

      {open && list.length > 0 && <div className="divide-y divide-line">{list.map(s => <SugRow key={s.id} s={s} />)}</div>}

      {ctx.note && (
        <p className="px-3 py-1.5 text-[11.5px] text-brand-700 bg-brand-50 border-t border-line flex items-start gap-1.5">
          <Check size={12} className="mt-0.5 shrink-0" /><span>{ctx.note}</span>
        </p>
      )}
      {handled.length > 0 && (
        <p className="px-3 py-1.5 text-[11.5px] text-emerald-800 bg-emerald-50 border-t border-line flex items-start gap-1.5">
          <Check size={12} className="mt-0.5 shrink-0" />
          <span>{handled.map(([, v]) => v).join(' \u00b7 ')}</span>
        </p>
      )}

      {notes.length > 0 && (
        <div className="border-t border-line">
          <button type="button" onClick={() => setNotesOpen(n => !n)}
            className="w-full px-3 py-1.5 flex items-center gap-1.5 text-left text-[11px] text-muted hover:text-ink">
            <Info size={11} className="shrink-0" />
            <span>{notes.length} thing{notes.length === 1 ? '' : 's'} worth knowing about this list</span>
            {notesOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          {notesOpen && (
            <ul className="px-3 pb-2 space-y-1">
              {notes.map((n, i) => <li key={i} className="text-[11px] text-muted leading-snug">{n}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── UNIT LEVEL / PEOPLE LEVEL: inside an expanded row ───────────────────────────────────────────
function InlineSuggestions({ list, title, showUnit, defaultAssignee, done }: {
  list: Sug[]; title: string; showUnit: boolean; defaultAssignee?: string; done: string[]
}) {
  const ctx = useSuggestions()
  if (!ctx) return null
  if (!list.length) {
    return done.length ? (
      <p className="mt-2 text-[11.5px] text-muted flex items-start gap-1">
        <Check size={12} className="mt-0.5 shrink-0 text-emerald-600" /> <span>{done.join(' \u00b7 ')}</span>
      </p>
    ) : null
  }
  return (
    <div className="mt-2 rounded-xl border border-line bg-white overflow-hidden">
      <p className="px-2.5 py-1.5 bg-app border-b border-line text-[10px] uppercase tracking-wider font-bold text-muted flex items-center gap-1.5">
        <Lightbulb size={11} strokeWidth={2.6} className="text-brand-500" /> {title}
      </p>
      <div className="divide-y divide-line">
        {list.map(s => <SugRow key={s.id} s={s} showUnit={showUnit} defaultAssignee={defaultAssignee} />)}
      </div>
      {done.length > 0 && (
        <p className="px-2.5 py-1.5 text-[11.5px] text-emerald-800 bg-emerald-50 border-t border-line flex items-start gap-1">
          <Check size={12} className="mt-0.5 shrink-0" /> <span>{done.join(' \u00b7 ')}</span>
        </p>
      )}
    </div>
  )
}

/** What this unit is owed: what we would suggest, and what is already pending on it. */
export function UnitSuggestions({ listingId, unit }: { listingId: string | null | undefined; unit?: string }) {
  const ctx = useSuggestions()
  if (!ctx || !listingId) return null
  const id = String(listingId)
  const done = Object.entries(ctx.gone).filter(([k]) => k.split('|')[1] === id).map(([, v]) => v)
  return (
    <>
      <InlineSuggestions list={ctx.forUnit(id)} title="Worth doing while somebody is here"
        showUnit={false} done={done} />
      <PendingRows listingId={id} unit={unit || 'this unit'} />
    </>
  )
}

/** What this person could pick up, because they are already in that building today. */
export function PersonSuggestions({ name }: { name: string }) {
  const ctx = useSuggestions()
  if (!ctx || !name) return null
  const list = ctx.forPerson(name)
  const ids = new Set(list.map(s => s.id))
  const done = Object.entries(ctx.gone).filter(([k]) => ids.has(k)).map(([, v]) => v)
  // `defaultAssignee` is the whole fix for the wrong-person bug: on Maria's row, Maria gets it.
  return <InlineSuggestions list={list} title={`Could go to ${name.split(' ')[0]} where they already are`}
    showUnit defaultAssignee={name} done={done} />
}

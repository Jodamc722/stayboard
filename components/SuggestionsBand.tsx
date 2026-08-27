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
  CalendarClock, Check, AlertTriangle, RefreshCw,
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

  const live = useMemo(
    () => (run?.enabled && run.ok !== false ? (run.suggestions || []) : []).filter(s => !gone[s.id]),
    [run, gone])

  const value: Ctx = useMemo(() => ({
    run, loading, roster, gone, busy, act, reload: load,
    errOf: (id: string) => errs[id] || '',
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
  }), [run, loading, roster, gone, errs, busy, act, live, load])

  return <SugCtx.Provider value={value}>{children}</SugCtx.Provider>
}

// ── ONE CARD ────────────────────────────────────────────────────────────────────────────────────
function SugCard({ s, showUnit = true, defaultAssignee }: {
  s: Sug
  showUnit?: boolean
  /**
   * WHOSE ROW IS THIS.
   *
   * Audit, 2026-08-27: the card had no idea which surface it was rendered in, so on a person's row
   * it still defaulted to `s.candidates[0]` — an arbitrary co-worker, since `candidates` is a Set
   * built in whatever order today's task rows came back. Opening Maria's row to give Maria a job
   * produced a button reading "Add for Devon" that created the task for Devon, with nothing on the
   * card mentioning Maria. On a phone nobody catches that.
   */
  defaultAssignee?: string
}) {
  const ctx = useSuggestions()
  const [openAssign, setOpenAssign] = useState(false)
  const [who, setWho] = useState<string>(defaultAssignee ?? s.candidates[0] ?? '')
  const [when, setWhen] = useState<string>(ctx?.run?.date || '')
  if (!ctx) return null
  const Icon = ICON[s.dept] || Wrench
  const busy = ctx.busy === s.id
  const err = ctx.errOf(s.id)
  const today = ctx.run?.date || ''
  const inDept = ctx.roster.filter(p => (p.departments || []).some(d => String(d).toLowerCase().includes(s.dept.slice(0, 6))))
  const rest = ctx.roster.filter(p => inDept.indexOf(p) < 0)
  // The label always names whoever would actually receive it — never a different person.
  const target = openAssign ? who : (defaultAssignee ?? s.candidates[0] ?? '')
  const dated = openAssign && when && when !== today

  return (
    <div className="rounded-lg border border-amber-200 bg-white px-2.5 py-2">
      <div className="flex items-start gap-1.5">
        <Icon size={12} className="text-muted mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-ink leading-tight">{s.label}</p>
          {showUnit && <p className="text-[11.5px] text-muted truncate">{s.unit}</p>}
        </div>
        <span className="text-[10px] text-muted shrink-0">{s.minutes}m</span>
      </div>
      <p className="text-[11px] text-muted mt-1 leading-snug">{s.why}</p>

      {openAssign && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <select value={who} onChange={e => setWho(e.target.value)}
            className="rounded-lg border border-line px-1.5 py-1 text-[11.5px] max-w-[140px]">
            <option value="">Nobody yet</option>
            {inDept.map(p => <option key={'d' + p.id} value={p.name}>{p.name}</option>)}
            {rest.length > 0 && <option key="sep" disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500'}</option>}
            {rest.map(p => <option key={'r' + p.id} value={p.name}>{p.name}</option>)}
          </select>
          {/* min=today: a task dated last week never lands on any board, so nobody works it. */}
          <input type="date" value={when} min={today} onChange={e => setWhen(e.target.value)}
            className="rounded-lg border border-line px-1.5 py-1 text-[11.5px]" />
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-1.5">
        <button
          onClick={() => ctx.act(s, 'add', openAssign
            ? { assignee: who, scheduleDate: when }
            // Even collapsed, a person's row sends that person explicitly rather than letting the
            // server fall back to candidates[0].
            : (defaultAssignee !== undefined ? { assignee: defaultAssignee } : undefined))}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2 py-1 text-[11.5px] font-semibold disabled:opacity-40">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          {dated ? 'Schedule it' : `Add${target ? ` for ${target.split(' ')[0]}` : ''}`}
        </button>
        <button onClick={() => setOpenAssign(o => !o)} disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11.5px] text-muted disabled:opacity-40">
          {/* Says both things it does. It used to say only "Assign", so the ability to move a job to
              another day was behind a button that gave no hint it was there. */}
          <CalendarClock size={11} /> {openAssign ? 'Close' : 'Who / when'}
        </button>
        <button onClick={() => ctx.act(s, 'dismiss')} disabled={busy}
          title="Hides this job everywhere, for 30 days"
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11.5px] text-muted disabled:opacity-40">
          <X size={11} /> Not for a month
        </button>
      </div>
      {err && <p className="text-[11px] text-rose-600 mt-1 leading-snug">{err}</p>}
    </div>
  )
}

// ── PUSH LEVEL: the band above the board ────────────────────────────────────────────────────────
export function SuggestionsBand({ market }: { market: string }) {
  const ctx = useSuggestions()
  const [open, setOpen] = useState(true)
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
  if (!list.length && !heavy && !handled.length && !inert.length && !stalled.length) return null

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
      <div className="w-full px-3 py-2 flex items-start gap-2">
        <Lightbulb size={14} className="text-amber-500 mt-0.5 shrink-0" />
        <button type="button" onClick={() => setOpen(o => !o)} className="flex-1 min-w-0 text-left">
          <span className="text-[12.5px] font-bold text-ink">
            {list.length ? `${list.length} worth slotting in today` : 'Nothing extra today'}
          </span>
          {ctx.run.day?.verdict && <span className="block text-[11.5px] text-muted mt-0.5">{ctx.run.day.verdict}</span>}
        </button>
        <button type="button" onClick={ctx.reload} title="Re-read the day"
          className="text-muted hover:text-ink shrink-0 mt-0.5"><RefreshCw size={12} /></button>
        {list.length > 0 && (
          <button type="button" onClick={() => setOpen(o => !o)} className="text-muted shrink-0 mt-0.5">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>

      {open && list.length > 0 && (
        <div className="px-2 pb-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(s => <SugCard key={s.id} s={s} />)}
        </div>
      )}

      {/* ── THE CAVEATS THE ENGINE ALREADY KNEW AND NEVER SAID ────────────────────────────────
          All three of these were computed every run and rendered nowhere on the board. A flag that
          says "these numbers may be wrong", shown only inside owner-only settings behind a button
          nobody presses, is not a warning. */}
      {truncated && (
        <p className="px-3 pb-1.5 text-[11px] text-amber-800">
          Task history was too long to read in full, so a job shown as never done may just be older than we can see.
        </p>
      )}
      {inert.length > 0 && (
        <p className="px-3 pb-1.5 text-[11px] text-amber-800">
          <strong>{inert.map(i => i.label).join(', ')}</strong> is suggesting nothing until somebody picks which
          buildings it applies to (Settings &rarr; Preventative cadences).
        </p>
      )}
      {stalled.length > 0 && (
        <p className="px-3 pb-1.5 text-[11px] text-amber-800">
          {stalled.length} preventative {stalled.length === 1 ? 'job was' : 'jobs were'} scheduled and never done &mdash;
          {' '}{stalled.slice(0, 3).map(x => `${x.label} at ${x.unit} (${x.since})`).join(', ')}
          {stalled.length > 3 ? ', and more' : ''}. They are already on the board, so they are not proposed again.
        </p>
      )}
      {handled.length > 0 && (
        <p className="px-3 pb-2 text-[11.5px] text-muted flex items-start gap-1">
          <Check size={12} className="mt-0.5 shrink-0 text-emerald-600" />
          <span>{handled.map(([, v]) => v).join(' \u00b7 ')}</span>
        </p>
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
  // CONFIRM WHERE THE ACTION HAPPENED. Adding from a unit row used to make the card vanish and say
  // nothing — the only confirmation in the whole feature was a line at the top of the page, which
  // on a phone is twenty rows away.
  if (!list.length) {
    return done.length ? (
      <p className="mt-2 text-[11.5px] text-muted flex items-start gap-1">
        <Check size={12} className="mt-0.5 shrink-0 text-emerald-600" /> <span>{done.join(' \u00b7 ')}</span>
      </p>
    ) : null
  }
  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/50 px-2 py-2">
      <p className="text-[10px] uppercase tracking-wider font-bold text-amber-700 mb-1.5 flex items-center gap-1">
        <Lightbulb size={11} /> {title}
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {list.map(s => <SugCard key={s.id} s={s} showUnit={showUnit} defaultAssignee={defaultAssignee} />)}
      </div>
      {done.length > 0 && (
        <p className="text-[11.5px] text-muted mt-1.5 flex items-start gap-1">
          <Check size={12} className="mt-0.5 shrink-0 text-emerald-600" /> <span>{done.join(' \u00b7 ')}</span>
        </p>
      )}
    </div>
  )
}

/** What this unit is owed, on the unit's own row. */
export function UnitSuggestions({ listingId }: { listingId: string | null | undefined }) {
  const ctx = useSuggestions()
  if (!ctx || !listingId) return null
  const id = String(listingId)
  const done = Object.entries(ctx.gone).filter(([k]) => k.split('|')[1] === id).map(([, v]) => v)
  return <InlineSuggestions list={ctx.forUnit(id)} title="Worth doing while somebody is here" showUnit={false} done={done} />
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

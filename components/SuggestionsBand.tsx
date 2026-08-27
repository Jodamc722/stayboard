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
  Lightbulb, Loader2, Plus, X, ChevronDown, ChevronRight, Wrench, Sparkles, ClipboardList, UserPlus, Check,
} from 'lucide-react'

export type Sug = {
  id: string; cadenceKey: string; label: string; listingId: string; unit: string
  building: string | null; market: string; dept: 'maintenance' | 'housekeeping' | 'inspection'
  minutes: number; lastDone: string | null; daysSince: number | null; daysOver: number
  candidates: string[]; score: number; why: string; windowDays: number; vacantTonight: boolean
  proximity: 'building' | 'area' | 'none'
}
type Run = {
  ok: boolean; date: string; enabled: boolean
  day: { openCleans: number; cleaners: number; load: number; cap: number; verdict: string; heavy: boolean }
  suggestions: Sug[]; considered: number; historyComplete: boolean; error?: string
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
  err: string
  busy: string | null
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
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/suggestions' + (date ? `?date=${date}` : ''), { cache: 'no-store' })
      const j = await r.json()
      setRun(j && typeof j === 'object' ? j : null)
    } catch { setRun(null) } finally { setLoading(false) }
  }, [date])
  useEffect(() => { load() }, [load])

  const act = useCallback(async (s: Sug, action: 'add' | 'dismiss', opts?: { assignee?: string; scheduleDate?: string }) => {
    setBusy(s.id); setErr('')
    try {
      const payload: any = action === 'add'
        ? { action, id: s.id, ...(opts?.assignee !== undefined ? { assignee: opts.assignee } : {}), ...(opts?.scheduleDate ? { scheduleDate: opts.scheduleDate } : {}) }
        : { action, id: s.id, days: 30 }
      const r = await fetch('/api/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'That did not work.')
      setGone(g => ({
        ...g,
        [s.id]: action === 'add'
          ? `added${j.assigned ? ' for ' + j.assigned : ''}${j.scheduled && j.scheduled !== date ? ' on ' + j.scheduled : ''}`
          : 'not now',
      }))
      if (action === 'add') onAdded()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(null) }
  }, [date, onAdded])

  const live = useMemo(
    () => (run?.enabled && run.ok !== false ? (run.suggestions || []) : []).filter(s => !gone[s.id]),
    [run, gone])

  const value: Ctx = useMemo(() => ({
    run, loading, roster, gone, err, busy, act,
    forUnit: (id: string) => live.filter(s => s.listingId === id),
    // A person sees what they could pick up — the jobs where they are one of the people already
    // working in that building today. Not "assigned to them": nothing is assigned yet.
    forPerson: (name: string) => live.filter(s => s.candidates.some(c => c === name)),
    all: (market?: string) => live.filter(s => !market || market === 'all' || s.market === market),
  }), [run, loading, roster, gone, err, busy, act, live])

  return <SugCtx.Provider value={value}>{children}</SugCtx.Provider>
}

// ── ONE CARD ────────────────────────────────────────────────────────────────────────────────────
function SugCard({ s, showUnit = true }: { s: Sug; showUnit?: boolean }) {
  const ctx = useSuggestions()
  const [openAssign, setOpenAssign] = useState(false)
  const [who, setWho] = useState<string>(s.candidates[0] || '')
  const [when, setWhen] = useState<string>(ctx?.run?.date || '')
  if (!ctx) return null
  const Icon = ICON[s.dept] || Wrench
  const busy = ctx.busy === s.id
  // The picker offers the department first — the people who could actually do this job — with the
  // rest of the roster after, because "the right person" is an operator's call, not a rule's.
  const inDept = ctx.roster.filter(p => (p.departments || []).some(d => String(d).toLowerCase().includes(s.dept.slice(0, 6))))
  const rest = ctx.roster.filter(p => inDept.indexOf(p) < 0)

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
            {inDept.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            {rest.length > 0 && <option disabled>──────────</option>}
            {rest.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <input type="date" value={when} onChange={e => setWhen(e.target.value)}
            className="rounded-lg border border-line px-1.5 py-1 text-[11.5px]" />
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-1.5">
        <button onClick={() => ctx.act(s, 'add', openAssign ? { assignee: who, scheduleDate: when } : undefined)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2 py-1 text-[11.5px] font-semibold disabled:opacity-40">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          {openAssign ? (when && when !== ctx.run?.date ? 'Schedule it' : 'Add it') : `Add${s.candidates[0] ? ` for ${s.candidates[0].split(' ')[0]}` : ''}`}
        </button>
        <button onClick={() => setOpenAssign(o => !o)} disabled={busy}
          title="Choose who and when"
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11.5px] text-muted disabled:opacity-40">
          <UserPlus size={11} /> {openAssign ? 'Close' : 'Assign'}
        </button>
        <button onClick={() => ctx.act(s, 'dismiss')} disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11.5px] text-muted disabled:opacity-40">
          <X size={11} /> Not now
        </button>
      </div>
    </div>
  )
}

// ── PUSH LEVEL: the band above the board ────────────────────────────────────────────────────────
export function SuggestionsBand({ market }: { market: string }) {
  const ctx = useSuggestions()
  const [open, setOpen] = useState(true)
  if (!ctx || ctx.loading || !ctx.run || ctx.run.ok === false || !ctx.run.enabled) return null

  const list = ctx.all(market)
  const handled = Object.keys(ctx.gone).length
  const heavy = ctx.run.day?.heavy
  // SILENT WHEN IT HAS NOTHING TO SAY. No "0 suggestions" row taking a line of a phone screen.
  if (!list.length && !heavy && !handled) return null

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full px-3 py-2 flex items-start gap-2 text-left">
        <Lightbulb size={14} className="text-amber-500 mt-0.5 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="text-[12.5px] font-bold text-ink">
            {list.length ? `${list.length} worth slotting in today` : 'Nothing extra today'}
          </span>
          {ctx.run.day?.verdict && <span className="block text-[11.5px] text-muted mt-0.5">{ctx.run.day.verdict}</span>}
        </span>
        {list.length > 0 && (open ? <ChevronDown size={14} className="text-muted mt-0.5" /> : <ChevronRight size={14} className="text-muted mt-0.5" />)}
      </button>
      {open && list.length > 0 && (
        <div className="px-2 pb-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(s => <SugCard key={s.id} s={s} />)}
        </div>
      )}
      {(ctx.err || handled > 0) && (
        <p className={'px-3 pb-2 text-[11.5px] ' + (ctx.err ? 'text-rose-600' : 'text-muted')}>
          {ctx.err || `${handled} handled: ${Object.values(ctx.gone).join(' · ')}`}
        </p>
      )}
    </div>
  )
}

// ── UNIT LEVEL / PEOPLE LEVEL: inside an expanded row ───────────────────────────────────────────
function InlineSuggestions({ list, title, showUnit }: { list: Sug[]; title: string; showUnit: boolean }) {
  const ctx = useSuggestions()
  if (!ctx || !list.length) return null
  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/50 px-2 py-2">
      <p className="text-[10px] uppercase tracking-wider font-bold text-amber-700 mb-1.5 flex items-center gap-1">
        <Lightbulb size={11} /> {title}
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {list.map(s => <SugCard key={s.id} s={s} showUnit={showUnit} />)}
      </div>
      {ctx.err && <p className="text-[11.5px] text-rose-600 mt-1">{ctx.err}</p>}
    </div>
  )
}

/** What this unit is owed, on the unit's own row. */
export function UnitSuggestions({ listingId }: { listingId: string | null | undefined }) {
  const ctx = useSuggestions()
  if (!ctx || !listingId) return null
  return <InlineSuggestions list={ctx.forUnit(String(listingId))} title="Worth doing while somebody is here" showUnit={false} />
}

/** What this person could pick up, because they are already in that building today. */
export function PersonSuggestions({ name }: { name: string }) {
  const ctx = useSuggestions()
  if (!ctx || !name) return null
  return <InlineSuggestions list={ctx.forPerson(name)} title="Could pick this up where they already are" showUnit />
}

/** Small confirmation used where a whole list has been worked through. */
export function SuggestionsDone() {
  const ctx = useSuggestions()
  if (!ctx || !Object.keys(ctx.gone).length) return null
  return <p className="text-[11px] text-muted inline-flex items-center gap-1"><Check size={11} /> handled</p>
}

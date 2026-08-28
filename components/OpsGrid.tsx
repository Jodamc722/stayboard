'use client'
// THE GRID — Today in Ops, the way Breezeway lays a day out (Jon, 2026-08-25: "there should be
// another view like Breezeway, which shows you the unit and all the tasks assigned to that unit.
// We should also be able to click it by people instead of the listings being on the left").
//
// ── WHAT THIS IS AND WHY IT IS NOT THE BOARD ────────────────────────────────────────────────────
// The Board is management by exception: it leads with what needs a human and hides the rest. That
// is the right landing for a manager and the wrong one for a coordinator working the whole day —
// they need every unit in one scannable list, with the day's work on each row, and the ability to
// flip the same list onto the person axis when the question changes from "is 1418 ready?" to
// "what is Yoslenis carrying?". Breezeway solved that layout well, so this borrows the shape:
// counters on top that double as filters, one dense row per unit, the tasks as a strip of chips.
//
// ── ONE PASS OVER THE DAY, SEVEN COUNTERS ───────────────────────────────────────────────────────
// The old strip counted Cleans / Maintenance / Inspections, which put a departure clean, a strip
// and a linen drop in one number and buried guest-reported problems entirely. Jon asked for the
// real breakdown: Departure, Cleaning, Glitches, Maintenance, Housekeeping audit, Inspection.
// `catOf` is the single definition (lib/task-categories.ts, shared with the daily briefs) — so a
// task can never be counted in one place and coloured as something else in another.
//
// Glitches are the exception to "today": they are open-until-fixed, carry no scheduled date in
// Breezeway, and matter on the day they are open rather than the day they were filed. That tile
// reads the open-glitch feed and merges by task id so a glitch that IS scheduled today is not
// counted twice.
//
// Everything actionable here reuses machinery that already works: /api/breezeway/assign for
// assignment, /api/ops-today/add-task for creation (which now carries a Breezeway template_id),
// /api/breezeway/comments for the last comment on a row you open.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Plus, Loader2, ChevronRight, ExternalLink, MessageSquare, AlertTriangle,
  LayoutGrid, Users, X, MapPin, Clock, RefreshCw, ChevronDown,
  DoorOpen, Sparkles, Zap, Wrench, ClipboardCheck, ClipboardList, Check,
  Droplet, Bug, Hammer, KeyRound, ShieldCheck, Package, Star, BedDouble, Wand2,
} from 'lucide-react'
import { catOfTask, type TaskCat } from '@/lib/task-categories'
import { SuggestionsProvider, SuggestionsBand, UnitSuggestions, PersonSuggestions, useSuggestions } from '@/components/SuggestionsBand'
import { AssignPanel } from '@/components/AssignPanel'
import { DayPlanPanel } from '@/components/DayPlanPanel'

// ── types (mirrors of /api/ops-today) ───────────────────────────────────────────────────────────
export type GTask = {
  id: string; listingId: string; unit: string; market: string; dept: string; type: string
  name: string; status: string; assignees: string[]; assigneeIds?: number[]
  startedAt: string | null; finishedAt: string | null; minutes: number | null
  reportUrl?: string | null
  done: boolean; running: boolean; late: boolean; atRisk: boolean; untracked?: boolean; guestyOnly?: boolean
  // A departure clean that is not today's turn: 'extended' = the stay ran past it, do not go in;
  // 'moved' = the checkout was earlier and this clean was moved onto today (the BFC hold).
  /** The category the SERVER assigned, against the saved taxonomy. Authoritative. */
  cat?: string
  moveState?: 'normal' | 'extended' | 'moved'
  movedFrom?: string | null
  extendedTo?: string | null
}
export type GUnit = {
  listingId: string; unit: string; market: string; market2?: string | null; building?: string | null
  city?: string | null; address?: string | null; bedrooms?: number | null
  guestOut: string | null; arrivingGuest?: string | null; arrivingAt?: string | null
  checkOutTime?: string | null; sameDayTurn: boolean; nights?: number | null; arrivingNights?: number | null
  qc?: { issue: string; status: string; reportUrl: string | null }[]
  tasks: GTask[]; late: boolean; atRisk: boolean; unassigned: boolean; allDone: boolean; guestyOnly?: boolean
}
export type GVacant = { listingId: string; unit: string; market: string; leftToday: string | null; nextArrival: string | null; openTasks: number; needsClean?: boolean }
export type GCat = { key: string; label: string; icon: string }
export type GDeadline = {
  dueBy: string; minsLeft: number; passed: boolean
  cleans: number; done: number; running: number; remaining: number
  late: number; atRisk: number; missed: number; untracked: number
}
export type GData = {
  ok: boolean; today: string; units: GUnit[]; vacants?: GVacant[]; categories?: GCat[]
  // COMPUTED ON EVERY REQUEST SINCE THE ROUTE WAS WRITTEN, AND RENDERED NOWHERE.
  // The whole job of this board is a 4pm deadline, and it had no clock. `atRisk` per task existed
  // only inside a sort expression; `deadline.minsLeft` and `lastSync` were never read at all.
  deadline?: GDeadline
  lastSync?: string | null
}
export type GStaff = {
  people?: { name: string; role?: string | null; clockedIn?: boolean; shift?: string | null; bzAlias?: string | null }[]
  summary?: { idleNames?: string[]; clockedIn?: number; assignedOffShift?: string[] }
}
export type GGlitch = { id: string; unit: string; issue: string; rawName?: string; market?: string | null; market2?: string | null; ageDays?: number | null; running?: boolean; unassigned?: boolean; assignees?: string[]; reportUrl?: string | null; done?: boolean }
export type GRoster = { id: number; name: string; departments: string[] }

// ── CATEGORIES — the one definition ─────────────────────────────────────────────────────────────
export type Cat = TaskCat
// ── ONE JOB PER CHANNEL (Jon, 2026-08-26: "should be color coded not by task type but by
// completion, the symbols should be indicator of the task type") ────────────────────────────────
//
// He is right, and the first cut had it doing double duty: the glyph said "departure clean" and so
// did the colour, while the thing you actually need to know at a glance — is it done? — was left to
// whether the square was filled in. Two channels saying the same thing, and the important one
// implied.
//
//   SYMBOL  = what the work is.   Never carries state.
//   COLOUR  = how far along it is. Never carries type.
//   RING    = an exception on top of either (today: a stay that ran past its clean).
//
// So the category palette is gone entirely. Categories keep a glyph and a label; nothing else here
// is allowed to be coloured by type, or the two channels start lying to each other again.
// The glyphs a category can wear. Named, because the taxonomy is data now and data cannot hold a
// React component. An unknown name falls back to the wrench rather than rendering nothing.
const GLYPH: Record<string, any> = {
  door: DoorOpen, sparkles: Sparkles, bolt: Zap, wrench: Wrench,
  'clipboard-check': ClipboardCheck, 'clipboard-list': ClipboardList,
  droplet: Droplet, bug: Bug, hammer: Hammer, key: KeyRound, shield: ShieldCheck,
  package: Package, star: Star, bed: BedDouble,
}
const glyphOf = (icon: string) => GLYPH[icon] || Wrench

// MUST MIRROR lib/task-categories.ts DEFAULT_CATS. This is only what the board paints in the
// moment before /api/ops-today answers with the taxonomy in force; if it lists different
// categories, the counters visibly rearrange themselves a beat after the page loads.
const FALLBACK_CATS: { key: Cat; label: string; short: string; Icon: any }[] = [
  { key: 'departure', label: 'Departure cleans', short: 'Dep', Icon: DoorOpen },
  { key: 'inspection', label: 'Inspections', short: 'Inspect', Icon: ClipboardList },
  { key: 'maintenance', label: 'Maintenance', short: 'Maint', Icon: Wrench },
  { key: 'other', label: 'Other', short: 'Other', Icon: Sparkles },
]
// Kept only for the first paint, before /api/ops-today answers with the real taxonomy.
const FALLBACK_BY: Record<string, any> = FALLBACK_CATS.reduce((m, c) => { m[c.key] = c; return m }, {} as any)

// THE TAXONOMY IN FORCE, handed down rather than imported. It arrives with the day's data and can
// be edited in Users & admin, so a module-level constant would be a second, stale opinion about
// what a task is — which is exactly the drift that put the same task in two counters before.
type CatMeta = { key: string; label: string; short: string; Icon: any }
const CatsCtx = createContext<{ list: CatMeta[]; by: Record<string, CatMeta> }>({ list: FALLBACK_CATS, by: FALLBACK_BY })
const useCats = () => useContext(CatsCtx)
/** The server labelled it; fall back to the shipped rules only during a deploy skew. */
const catKeyOf = (t: GTask) => String(t.cat || catOf(t))
const metaOf = (by: Record<string, CatMeta>, key: string): CatMeta =>
  by[key] || { key, label: key, short: key.slice(0, 8), Icon: Wrench }

// ── ONE CHANNEL, ONE MEANING ────────────────────────────────────────────────────────────────────
//
// This file has always stated its own contract: SYMBOL = what the work is, never state. COLOUR =
// how far along it is, never type. The contract was then broken by the table beneath it, and that
// break is most of why the board is hard to read.
//
// What the 24px chip was carrying at once: a glyph (category), a fill colour (state), a border
// colour (state again), a border STYLE — dashed for unassigned — and a rose ring for "a guest is
// still inside". Five channels, and two of them collide badly:
//
//   • `unassigned` is not a stage. It is ownership. Rendering it as a fourth COLOUR put ownership
//     into the channel colour had promised not to carry, and `border-dashed` at 2px on a 24px chip
//     is invisible at scan distance — so what a coordinator actually perceived was rose vs slate.
//   • Unassigned (rose dashed border) and extended (rose ring) then read as the same thing: a white
//     square with rose around it. One means "nobody has this". The other means "do not go in, a
//     guest is asleep in there". Those are the two most consequential states on the board and they
//     looked alike.
//
// So the encodings are separated onto channels that cannot be confused:
//
//   COLOUR    three states only — finished, in progress, not started. The contract, restored.
//   POSITION  a dot in the corner means nobody has taken it. Position was the one strong
//             pre-attentive channel going unused, it survives sunlight and colour-blindness, and it
//             cannot be mistaken for a fill.
//   MUTING    an extended clean is drawn switched OFF — faded, with a neutral ring. It is not an
//             alarm, it is an exclusion: the job exists and must not be done today. Keeping rose
//             out of it means rose now means exactly one thing on this board — a human is needed.
type TaskState = 'done' | 'running' | 'open' | 'unassigned'
const STATE: Record<TaskState, { label: string; chip: string; swatch: string }> = {
  done: { label: 'Finished', chip: 'bg-emerald-500 border-emerald-500 text-white', swatch: 'bg-emerald-500 border-emerald-500' },
  running: { label: 'In progress', chip: 'bg-amber-400 border-amber-400 text-white', swatch: 'bg-amber-400 border-amber-400' },
  open: { label: 'Not started', chip: 'bg-white border-slate-300 text-slate-500', swatch: 'bg-white border-slate-300' },
  // Same paint as `open` — an unassigned task IS not-started; the dot says nobody owns it.
  unassigned: { label: 'Nobody assigned', chip: 'bg-white border-slate-300 text-slate-500', swatch: 'bg-white border-slate-300' },
}
const stateOf = (t: GTask): TaskState =>
  t.done ? 'done' : t.running ? 'running' : t.assignees.length ? 'open' : 'unassigned'

/** The board's category rule is lib/task-categories.ts, so the daily briefs count the same way. */
export const catOf = catOfTask

/**
 * The one sentence a moved or extended departure clean has to say for itself. Returns null for an
 * ordinary turn, because a badge on every clean is a badge on nothing.
 */
function moveNote(t: GTask): { tag: string; cls: string; line: string } | null {
  if (t.moveState === 'extended') return {
    tag: 'EXTENDED', cls: 'bg-rose-600 text-white',
    line: 'The guest is still in the unit' + (t.extendedTo ? ' until ' + niceDay(t.extendedTo) : '') + ' — do not clean it today.',
  }
  if (t.moveState === 'moved') return {
    tag: 'MOVED', cls: 'bg-indigo-100 text-indigo-800',
    // Only claim a checkout date when there actually is one on the books. Without it, say the
    // thing we DO know — nobody left today and the unit is empty — rather than inventing a story.
    line: t.movedFrom
      ? 'Checked out ' + niceDay(t.movedFrom) + '. The clean was moved to today and the unit is held for it.'
      : 'Nobody checked out today and the unit is empty — this clean was moved onto today.',
  }
  return null
}
/** "Sat Aug 23" — a date a person can place without counting. */
function niceDay(iso: string): string {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso + 'T12:00:00Z')) } catch { return iso }
}

const bzTask = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)
const isReal = (t: GTask) => !t.guestyOnly && /^\d+$/.test(String(t.id))
function daysBetween(a: string, b: string) { const x = new Date(a + 'T12:00:00'), y = new Date(b + 'T12:00:00'); return Math.round((+y - +x) / 86400000) }
function shortTime(iso: string | null): string {
  if (!iso) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) } catch { return '' }
}

type Counts = { total: number; done: number; running: number; open: number }
const zero = (): Counts => ({ total: 0, done: 0, running: 0, open: 0 })

// ── ONE COUNTER, SMALL ──────────────────────────────────────────────────────────────────────────
// Jon, 2026-08-26, with a screenshot of eight tiles running off the side of the screen:
// "we have too many of these, more condensed."
//
// He is right, and the size was doing damage beyond the space it took. A 52px donut plus three
// stacked lines of legend made each tile ~110px tall and ~170px wide, so eight categories could
// not fit a row — they scrolled sideways, the labels truncated to "House…" and "Inspect…", and the
// counters you had to scroll to reach may as well not have been there.
//
// What the three legend lines were mostly saying was ZERO. "0 in progress" is not information; it
// is a line of type defending its own existence. So the ring becomes a bar, the zeros disappear,
// and the tile says the two things that are actually true of it: how many, and how far along.
//
// The bar keeps the completion palette exactly as the task chips use it — green done, amber
// running, grey untouched — so the top of the screen and the rows below it are one language.
function Tile({ cat, c, active, onClick }: { cat: CatMeta | null; c: Counts; active: boolean; onClick: () => void }) {
  const pct = (n: number) => c.total > 0 ? (n / c.total) * 100 : 0
  const G = cat ? cat.Icon : null
  return (
    <button onClick={onClick} title={cat ? cat.label : 'Everything open'}
      className={'text-left rounded-xl border-2 px-2 py-1.5 bg-white transition-colors ' +
        (active ? 'border-ink shadow-sm' : 'border-line hover:border-ink/25')}>
      <div className="flex items-baseline gap-1.5">
        {G && <G size={11} strokeWidth={2.5} className="text-slate-500 shrink-0 self-center" />}
        <span className="text-[11px] font-bold text-ink truncate flex-1 min-w-0">{cat ? cat.label : 'Everything'}</span>
        <span className="text-[15px] font-bold text-ink tabular-nums leading-none">{c.total}</span>
      </div>

      {/* The ring was 52px to say one fraction. A 4px bar says the same fraction and leaves the
          row short enough that every category fits on screen at once. */}
      <div className="mt-1.5 h-1 rounded-full bg-slate-200 overflow-hidden flex">
        {c.done > 0 && <span className="bg-emerald-500 h-full" style={{ width: pct(c.done) + '%' }} />}
        {c.running > 0 && <span className="bg-amber-400 h-full" style={{ width: pct(c.running) + '%' }} />}
      </div>

      {/* Only the states that exist. A tile with nothing on it says so once, instead of three times. */}
      <div className="mt-1 text-[10px] text-muted leading-tight truncate">
        {c.total === 0 ? 'nothing today'
          : [
            c.done ? c.done + ' done' : '',
            c.running ? c.running + ' going' : '',
            c.open ? c.open + ' to go' : '',
          ].filter(Boolean).join(' · ')}
      </div>
    </button>
  )
}

// ── STATUS — the unit-level word, Breezeway's vocabulary ────────────────────────────────────────
// Ready / Dirty / In progress / Open. "Dirty" is reserved for the one that costs money: the guest
// has gone and the turnover has not been touched.
function unitStatus(u: GUnit): { label: string; cls: string } {
  const open = u.tasks.filter(t => !t.done)
  const clean = u.tasks.find(t => t.type === 'departure_clean')
  if (!open.length) return { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  // AN OCCUPIED UNIT IS NOT DIRTY, IT IS OCCUPIED. A stale clean sitting on an extended stay used
  // to read "Dirty" here, which is the one word that would send somebody to the door.
  if (clean && !clean.done && clean.moveState === 'extended') return { label: 'Guest still in', cls: 'bg-rose-100 text-rose-800 border-rose-300' }
  if (u.tasks.some(t => t.running && !t.done)) return { label: 'In progress', cls: 'bg-amber-50 text-amber-800 border-amber-200' }
  if (clean && !clean.done && clean.moveState === 'moved') return { label: 'Held for clean', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
  if (u.guestOut && clean && !clean.done) return { label: 'Dirty', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
  return { label: 'Open', cls: 'bg-app text-muted border-line' }
}

// ── ONE TASK, AS A CHIP ─────────────────────────────────────────────────────────────────────────
// Jon, 2026-08-25, looking at a row of five identical coloured squares: "can you do symbols and
// when I hover over should show details, not automatically go to task when click into it."
//
// Both halves of that matter. The squares were unreadable — a colour with no glyph is a legend you
// have to hold in your head — so every category now carries its own icon. And CLICKING NO LONGER
// NAVIGATES: a click on a 20px square that throws you into Breezeway is a trap, because the thing
// you wanted was almost always just to know what the square meant. Hover opens the detail card;
// click PINS it open (which is also how this works on a phone, where there is no hover); and
// Breezeway is an explicit link inside the card, so leaving the page is always a deliberate act.
//
// The card is position:fixed off the chip's own rect because the rows live inside an
// overflow-hidden container that would otherwise clip it.
function TaskChip({ t }: { t: GTask }) {
  const { by } = useCats()
  const c = metaOf(by, catKeyOf(t))
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [pinned, setPinned] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const Glyph = c.Icon

  const place = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setAt({ x: r.left + r.width / 2, y: r.bottom + 6 })
  }
  const state = stateOf(t)
  const open = pinned || !!at
  const mv = moveNote(t)

  return (
    <>
      <button ref={ref}
        onMouseEnter={place}
        onMouseLeave={() => { if (!pinned) setAt(null) }}
        onClick={ev => { ev.stopPropagation(); place(); setPinned(p => !p) }}
        aria-label={c.label + ': ' + t.name}
        className={'relative w-6 h-6 rounded-[6px] border-2 shrink-0 inline-flex items-center justify-center transition-transform hover:scale-110 ' +
          STATE[state].chip +
          // SWITCHED OFF, NOT ALARMED. A guest is still in the unit, so this job must not happen
          // today. Muting it says that in the one way an alarm colour cannot: it removes the chip
          // from the set of things you are meant to act on.
          (t.moveState === 'extended' ? ' opacity-45 ring-2 ring-slate-400 ring-offset-1' : '')}>
        <Glyph size={12} strokeWidth={2.4} />
        {/* NOBODY HAS THIS. A dot, not a colour — see the STATE header. */}
        {state === 'unassigned' && (
          <span aria-hidden className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-1 ring-white" />
        )}
      </button>

      {open && at && (
        <>
          {/* Click-away for the pinned state. Transparent, below the card, above everything else. */}
          {pinned && <div className="fixed inset-0 z-[60]" onClick={ev => { ev.stopPropagation(); setPinned(false); setAt(null) }} />}
          <div className="fixed z-[61] w-64 rounded-xl border border-line bg-white shadow-xl p-2.5 text-left"
            style={{ left: Math.min(Math.max(at.x - 128, 8), (typeof window !== 'undefined' ? window.innerWidth : 1200) - 264), top: at.y }}
            onClick={ev => ev.stopPropagation()}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={'w-4 h-4 rounded-[4px] border inline-flex items-center justify-center ' + STATE[state].chip}><Glyph size={10} strokeWidth={2.6} /></span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-line bg-app text-muted">{c.label}</span>
            </div>
            <p className="text-[12.5px] font-bold text-ink leading-snug">{t.name}</p>
            <p className="text-[11.5px] text-muted mt-0.5">{t.unit}</p>
            {mv && (
              <div className="mt-1.5 rounded-lg bg-app px-2 py-1.5">
                <span className={'text-[9.5px] font-bold px-1.5 py-0.5 rounded ' + mv.cls}>{mv.tag}</span>
                <p className="text-[11.5px] text-ink mt-1 leading-snug">{mv.line}</p>
              </div>
            )}
            <p className="text-[11.5px] mt-1">
              {t.done
                ? <span className="font-bold text-emerald-700">Finished{t.finishedAt ? ' ' + shortTime(t.finishedAt) : ''}{t.minutes ? ' \u00b7 ' + t.minutes + 'm' : ''}</span>
                : t.running
                  ? <span className="font-bold text-amber-700">In progress{t.startedAt ? ' since ' + shortTime(t.startedAt) : ''}</span>
                  : <span className="font-bold text-muted">Not started</span>}
            </p>
            <p className="text-[11.5px] mt-0.5">
              {t.assignees.length
                ? <span className="text-muted">{t.assignees.join(', ')}</span>
                : <span className="font-bold text-rose-600">Nobody assigned</span>}
            </p>
            {t.late && <p className="text-[11px] font-bold text-rose-700 mt-1">Past the 4pm deadline.</p>}
            {isReal(t) && (
              <div className="mt-2 pt-2 border-t border-line flex items-center gap-3">
                <a href={bzTask(t.id)} target="_blank" rel="noreferrer"
                  className="text-[11.5px] font-bold text-brand-700 inline-flex items-center gap-1 hover:underline">
                  Open in Breezeway <ExternalLink size={11} />
                </a>
                {t.reportUrl && <a href={t.reportUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-muted hover:underline">Field report</a>}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

// ── THE ROW ─────────────────────────────────────────────────────────────────────────────────────
export type Issue = {
  text: string; kind: 'qc' | 'glitch'
  id?: string; ageDays?: number | null; assignees?: string[]
  unassigned?: boolean; running?: boolean; reportUrl?: string | null
}

type Row = {
  key: string
  title: string
  sub: string
  reservation: string
  status: { label: string; cls: string }
  tasks: GTask[]
  issues: Issue[]
  gapNights: number | null
  urgent: number
  listingId?: string
  /**
   * PAST 4PM / WITHIN THE AT-RISK WINDOW. Both were computed per task server-side and used here
   * ONLY inside the sort expression — so the two facts that decide what a coordinator does next
   * changed the order of the rows and were otherwise invisible. A row that is late now says so.
   */
  late?: boolean
  atRisk?: boolean
  building?: string | null
  market?: string
  /** The clock facts already in the payload: when the guest left, when the next one lands. */
  outAt?: string | null
  inAt?: string | null
}

function GridRow({ row, roster, mode, onRefresh, onAdd, units, staff }: {
  row: Row; roster: GRoster[]; mode: 'units' | 'people'; onRefresh: () => void; onAdd: (unit: string) => void
  units: GUnit[]; staff?: GStaff | null
}) {
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<Record<string, { body: string; at: string } | null> | null>(null)
  const done = row.tasks.filter(t => t.done).length
  const total = row.tasks.length

  // Comments cost a Breezeway call each, so they are fetched when a row is opened and never before.
  useEffect(() => {
    if (!open || comments) return
    const ids = row.tasks.filter(isReal).slice(0, 6).map(t => t.id)
    if (!ids.length) { setComments({}); return }
    fetch('/api/breezeway/comments?taskIds=' + ids.join(','), { cache: 'no-store' })
      .then(r => r.json()).then(j => setComments(j && j.comments ? j.comments : {})).catch(() => setComments({}))
  }, [open, comments, row.tasks])

  const lastComment = useMemo(() => {
    if (!comments) return null
    const all = Object.values(comments).filter(Boolean) as { body: string; at: string }[]
    return all.sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null
  }, [comments])

  // "Oasis - Royal Palm" above "Oasis · Fort Lauderdale" spends a line of a phone screen saying
  // Oasis twice. When the name already carries the building, the sub keeps only what it adds.
  const metaSub = useMemo(() => {
    const sub = String(row.sub || '')
    if (!sub) return ''
    const title = String(row.title || '').toLowerCase()
    const parts = sub.split(' \u00b7 ').map(p => p.trim()).filter(Boolean)
    const kept = parts.filter(p => !title.includes(p.toLowerCase()))
    // If every part was already in the name there is nothing left to say — drop the whole thing
    // rather than falling back to repeating it.
    return kept.join(' \u00b7 ')
  }, [row.sub, row.title])

  return (
    <div className="border-b border-line last:border-0">
      {/* THE ROW. 12 columns from lg: up; below that it stacks into a card, because a coordinator
          on a phone in a hallway needs the same information and cannot scroll a table sideways. */}
      {/* PHONE: TWO LINES, NOT FIVE (Jon, 2026-08-26: "make it visible and concise").
          The desktop row is five cells across twelve columns. Stacked on a phone that became five
          separate lines — title, building, reservation, status, chips — 160px per unit, so a
          twenty-unit market was eight screens and you could see two and a half units at a time.
          The information did not need cutting, it needed to stop being one item per line:
            line 1   unit name          · status · 0/3 · issue count · nights free
            line 2   city · what is happening today
            line 3   the task chips, when there are any
          From lg: up the twelve-column grid is exactly as it was — the `order-*` and width classes
          all carry an lg: reset. */}
      {/* A LEFT RAIL FOR THE TWO FACTS THAT DECIDE THE MORNING. Late and at-risk were computed on
          every task and shown nowhere on the collapsed row — you had to open a row to learn that a
          clean had blown the 4pm deadline. A 3px rail costs no space and is readable down the whole
          column at a glance, which is the one thing a colour-coded 24px chip cannot do.
          Also: this was a bare clickable <div> with no role, no tabIndex and no key handler — the
          primary interaction on the most-used screen in the app, unreachable by keyboard. */}
      <div role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}
        className={'relative flex flex-wrap items-center gap-x-2 gap-y-0.5 lg:grid lg:grid-cols-12 lg:gap-3 px-3 py-2 lg:py-2.5 hover:bg-app/60 cursor-pointer focus:outline-none focus-visible:bg-app '
          + (row.late ? 'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-rose-500'
            : row.atRisk ? 'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-amber-400' : '')}
        onClick={() => setOpen(o => !o)}>
        {/* who / what */}
        <div className="order-1 flex-1 min-w-0 flex items-center gap-1.5 lg:order-none lg:col-span-3 lg:flex-none lg:gap-2">
          <ChevronRight size={14} className={'text-muted shrink-0 transition-transform ' + (open ? 'rotate-90' : '')} />
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold text-ink truncate">{row.title}</div>
            {/* On a phone this rides on the meta line below instead, next to the reservation. */}
            {row.sub && <div className="hidden lg:block text-[11px] text-muted truncate">{row.sub}</div>}
          </div>
        </div>
        {/* status — beside the name on a phone, its own column on desktop */}
        <div className="order-2 flex items-center gap-1.5 shrink-0 lg:order-none lg:col-span-2 lg:gap-2">
          <span className={'text-[10.5px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ' + row.status.cls}>{row.status.label}</span>
          {total > 0 && (
            <span className="text-[10.5px] font-semibold text-muted tabular-nums" title={done + ' of ' + total + ' finished'}>
              {done}/{total}
            </span>
          )}
          {/* Issues and the free-nights count join the headline on a phone: they are the two things
              that decide whether this row needs you, so they belong where the eye already is. */}
          {row.issues.length > 0 && (
            <span className="lg:hidden text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 inline-flex items-center gap-1"
              title={row.issues.map(i => i.text).join(' · ')}>
              <AlertTriangle size={10} />{row.issues.length}
            </span>
          )}
          {row.gapNights != null && (
            <span className="lg:hidden text-[10.5px] text-muted font-semibold tabular-nums" title="Nights free before the next arrival">{row.gapNights}n</span>
          )}
          {/* LATE AND AT RISK, IN WORDS. The rail catches the eye down the column; this says which
              one it is without opening anything. */}
          {row.late && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 whitespace-nowrap">LATE</span>}
          {!row.late && row.atRisk && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap">AT RISK</span>}
        </div>
        {/* reservation / shift context — full width on a phone, carrying the city with it */}
        <div className="order-3 w-full min-w-0 lg:order-none lg:col-span-3 lg:w-auto">
          <span className="block truncate text-[11.5px] text-muted lg:whitespace-nowrap">
            <span className="lg:hidden">{[metaSub, row.reservation].filter(Boolean).join(' \u00b7 ')}</span>
            <span className="hidden lg:inline">{row.reservation}</span>
          </span>
        </div>
        {/* the day's work */}
        <div className="order-4 w-full flex items-center gap-1 flex-wrap lg:order-none lg:col-span-3 lg:w-auto">
          {row.tasks.length === 0
            ? <span className="text-[11px] text-muted">No tasks today</span>
            : row.tasks.slice(0, 14).map(t => <TaskChip key={t.id} t={t} />)}
          {row.tasks.length > 14 && <span className="text-[10.5px] text-muted font-semibold">+{row.tasks.length - 14}</span>}
        </div>
        {/* issues + gap — desktop keeps its own right-hand column */}
        <div className="hidden lg:col-span-1 lg:flex items-center gap-2 lg:justify-end">
          {row.issues.length > 0 && (
            <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 inline-flex items-center gap-1"
              title={row.issues.map(i => i.text).join(' · ')}>
              <AlertTriangle size={10} />{row.issues.length}
            </span>
          )}
          {row.gapNights != null && (
            <span className="text-[10.5px] text-muted font-semibold tabular-nums" title="Nights free before the next arrival">
              {row.gapNights}n
            </span>
          )}
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 bg-app/40" onClick={e => e.stopPropagation()}>
          {row.issues.length > 0 && (
            <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50/60 overflow-hidden">
              <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-800 border-b border-rose-200">
                {row.issues.length} open {row.issues.length === 1 ? 'issue' : 'issues'} on this unit
              </p>
              <div className="divide-y divide-rose-200/70">
                {row.issues.map((i, n) => (
                  <div key={i.id || n} className="px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                    <span className="text-[11.5px] font-semibold text-rose-900 min-w-0 flex-1">{i.text}</span>
                    {i.ageDays != null && (
                      <span className={'text-[10px] font-bold tabular-nums shrink-0 ' + (i.ageDays > 7 ? 'text-rose-700' : 'text-rose-600/70')}>
                        {i.ageDays}d open
                      </span>
                    )}
                    {i.kind === 'glitch' && (
                      i.unassigned
                        ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white shrink-0">Nobody on it</span>
                        : i.assignees?.length
                          ? <span className="text-[10.5px] text-rose-800/80 shrink-0">{i.assignees.join(', ')}{i.running ? ' · working' : ''}</span>
                          : null
                    )}
                    {i.reportUrl && (
                      <a href={i.reportUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="text-[11px] font-semibold text-rose-700 hover:underline shrink-0">Report</a>
                    )}
                    {i.id && (
                      <a href={bzTask(i.id)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="text-rose-700 hover:text-rose-900 shrink-0" title="Open in Breezeway"><ExternalLink size={11} /></a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-xl border border-line bg-white divide-y divide-line overflow-hidden">
            {row.tasks.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-muted">Nothing scheduled on this {mode === 'people' ? 'person' : 'unit'} today.</div>}
            {row.tasks.map(t => (
              <TaskLine key={t.id} t={t} roster={roster} mode={mode} onRefresh={onRefresh}
                comment={comments ? comments[t.id] || null : null}
                units={units} staff={staff}
                unitMeta={{ listingId: row.listingId, building: row.building, market: row.market, unit: row.title }} />
            ))}
          </div>
          {/* SUGGESTED, AT THIS LEVEL (Jon, 2026-08-27: "the suggestion should live at the unit
              level, at the people level, and at the push level"). Same list as the band above —
              the unit row asks what this unit is owed, the person row asks what this person could
              pick up where they already are. Renders nothing when the answer is nothing. */}
          {mode === 'units'
            ? <UnitSuggestions listingId={row.listingId} unit={row.title} />
            : <PersonSuggestions name={row.title} />}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {mode === 'units' && (
              <button onClick={() => onAdd(row.title)}
                className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:border-ink/30 inline-flex items-center gap-1.5">
                <Plus size={12} /> Add a task here
              </button>
            )}
            {lastComment && (
              <span className="text-[11.5px] text-muted inline-flex items-start gap-1.5 min-w-0">
                <MessageSquare size={12} className="mt-0.5 shrink-0" />
                <span className="truncate">{lastComment.body}</span>
              </span>
            )}
            {open && !comments && <span className="text-[11px] text-muted inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> reading comments…</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/** One task inside an opened row: what it is, who has it, where it stands, and one-tap assign. */
function TaskLine({ t, roster, mode, onRefresh, comment, units, staff, unitMeta }: {
  t: GTask; roster: GRoster[]; mode: 'units' | 'people'; onRefresh: () => void; comment: { body: string; at: string } | null
  units: GUnit[]; staff?: GStaff | null
  unitMeta?: { listingId?: string; building?: string | null; market?: string; unit?: string }
}) {
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  // THE VERBS THE BOARD NEVER HAD. complete / priority / vendor / reschedule have been working APIs
  // this whole time, wired into the OLD board — this one shipped as a viewer with a single write.
  const [acting, setActing] = useState('')
  const sug = useSuggestions()
  const { by } = useCats()
  const c = metaOf(by, catKeyOf(t))
  const mv = moveNote(t)
  const assign = async (id: number, alsoTaskIds: string[] = []) => {
    setBusy(id); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, assigneeIds: [id] }) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'assign failed')
      // Anything ticked in the panel moves onto today and goes to the same person — the trip is
      // the expensive part, and this is the moment we know who is making it.
      if (alsoTaskIds.length && unitMeta?.listingId) {
        const who = roster.find(p => p.id === id)?.name
        try {
          await fetch('/api/suggestions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'push', listingId: unitMeta.listingId, unit: unitMeta.unit || t.unit, taskIds: alsoTaskIds, scheduleDate: sug?.run?.date, assignee: who }),
          })
        } catch { /* the primary assign already succeeded — never fail the whole action on the extra */ }
      }
      setAssigning(false); onRefresh(); sug?.reload()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(0)
  }

  /** complete / vendor / priority — all against the existing task-action route. */
  const act = async (action: string, extra: Record<string, any> = {}) => {
    setActing(action); setErr('')
    try {
      const r = await fetch('/api/ops-today/task-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: t.id, action, ...extra }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) throw new Error(j?.error || 'That did not work.')
      onRefresh()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setActing('') }
  }
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={'w-4 h-4 rounded-[4px] border shrink-0 inline-flex items-center justify-center ' + STATE[stateOf(t)].chip}><c.Icon size={9} strokeWidth={2.6} /></span>
        <span className="text-[12.5px] font-semibold text-ink">{t.name}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-line bg-app text-muted">{c.short}</span>
        {t.done
          ? <span className="text-[10.5px] font-bold text-emerald-700">Finished{t.finishedAt ? ' ' + shortTime(t.finishedAt) : ''}{t.minutes ? ' · ' + t.minutes + 'm' : ''}</span>
          : t.running
            ? <span className="text-[10.5px] font-bold text-amber-700">In progress{t.startedAt ? ' since ' + shortTime(t.startedAt) : ''}</span>
            : <span className="text-[10.5px] font-bold text-muted">Not started</span>}
        {t.late && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-600 text-white">Late</span>}
        {mv && <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-md ' + mv.cls} title={mv.line}>{mv.tag}</span>}
        {mode === 'units' && (
          t.assignees.length
            ? <span className="text-[11.5px] text-muted">{t.assignees.join(', ')}</span>
            : <span className="text-[11px] font-bold text-rose-600">Unassigned</span>
        )}
        {mode === 'people' && <span className="text-[11.5px] text-muted">{t.unit}</span>}
        <span className="ml-auto flex items-center gap-2">
          {isReal(t) && !t.done && (
            <button onClick={() => setAssigning(a => !a)} className="text-[11.5px] font-bold text-brand-700 hover:underline">
              {t.assignees.length ? 'Reassign' : 'Assign'}
            </button>
          )}
          {/* DONE. The single most-wanted verb on an ops board, and the one this one did not have:
              crews finish work and forget to close it, so a board full of "not started" is often a
              board that is actually finished. The API has existed and been wired into the old board
              all along. */}
          {isReal(t) && !t.done && (
            <button onClick={() => { if (window.confirm(`Mark "${t.name}" complete in Breezeway?`)) act('complete') }}
              disabled={!!acting}
              className="text-[11.5px] font-bold text-emerald-700 hover:underline disabled:opacity-50 inline-flex items-center gap-1">
              {acting === 'complete' ? <Loader2 size={10} className="animate-spin" /> : <Check size={11} />} Done
            </button>
          )}
          {isReal(t) && !t.done && (
            <button onClick={() => act('priority', { level: 'urgent' })} disabled={!!acting}
              title="Flag urgent in Breezeway"
              className="text-[11.5px] font-semibold text-muted hover:text-rose-700 disabled:opacity-50">
              {acting === 'priority' ? <Loader2 size={10} className="animate-spin inline" /> : 'Urgent'}
            </button>
          )}
          {isReal(t) && !t.done && !/vendor needed/i.test(t.name) && (
            <button onClick={() => act('vendor', { on: true })} disabled={!!acting}
              title="Tag VENDOR NEEDED so it is never billed to the owner by mistake"
              className="text-[11.5px] font-semibold text-muted hover:text-ink disabled:opacity-50">
              {acting === 'vendor' ? <Loader2 size={10} className="animate-spin inline" /> : 'Vendor'}
            </button>
          )}
          {t.reportUrl && <a href={t.reportUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-muted hover:underline" title="Read-only field report">Report</a>}
          {isReal(t) && <a href={bzTask(t.id)} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="Open in Breezeway"><ExternalLink size={12} /></a>}
        </span>
      </div>
      {mv && <p className={'mt-1 text-[11.5px] ' + (t.moveState === 'extended' ? 'font-semibold text-rose-700' : 'text-muted')}>{mv.line}</p>}
      {comment && (
        <div className="mt-1 text-[11.5px] text-muted flex items-start gap-1.5">
          <MessageSquare size={11} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{comment.body}</span>
        </div>
      )}
      {assigning && (
        <AssignPanel
          task={{ id: t.id, dept: t.dept, listingId: unitMeta?.listingId, unit: unitMeta?.unit || t.unit, building: unitMeta?.building, market: unitMeta?.market || t.market }}
          units={units} roster={roster} staff={staff}
          onAssign={assign} onClose={() => setAssigning(false)} busyId={busy} error={err} />
      )}
      {!assigning && err && <p className="mt-1 text-[11px] text-rose-600 font-semibold">{err}</p>}
    </div>
  )
}

// ── THE GRID ────────────────────────────────────────────────────────────────────────────────────
/** "3 min ago" — how stale the board is, in the only unit a coordinator cares about. */
function fmtAgo(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'just now'
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

export function OpsGrid({ data, glitches, roster, staff, loading, error, onRefresh, onAddTask }: {
  data: GData | undefined
  glitches: GGlitch[]
  roster: GRoster[]
  staff?: GStaff | null
  loading?: boolean
  error?: string | null
  onRefresh: () => void
  onAddTask: (unit: string) => void
}) {
  const [mode, setMode] = useState<'units' | 'people'>('units')
  const [cat, setCat] = useState<Cat | null>(null)
  const [q, setQ] = useState('')
  // The search box is a whole line of a phone screen for something you use once a day. On a phone
  // it starts as the magnifier next to the Units/People switch and expands when tapped; anything
  // typed keeps it open, so a live filter is never hidden behind an icon. Desktop is unchanged.
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { if (searchOpen && searchRef.current) searchRef.current.focus() }, [searchOpen])
  const [activeOnly, setActiveOnly] = useState(true)
  const [keyOpen, setKeyOpen] = useState(false)
  // PLAN THE DAY (Jon, 2026-08-27: "need the AI systems to help assign or build tasks to ensure we
  // give the team a full and directional day"). Opens over the board it is planning, so the numbers
  // in the header and the plan behind it are the same numbers.
  const [planOpen, setPlanOpen] = useState(false)
  // MARKET (Jon, 2026-08-25: "I should also be able to select by market area"). Remembered per
  // device, because whoever runs Broward runs Broward every morning and should not re-pick it.
  const [mkt, setMkt] = useState<string>('all')
  useEffect(() => {
    try {
      const m = localStorage.getItem('opsgrid_mode'); if (m === 'people') setMode('people')
      const k = localStorage.getItem('opsgrid_market'); if (k) setMkt(k)
    } catch {}
  }, [])
  const pickMode = (m: 'units' | 'people') => { setMode(m); try { localStorage.setItem('opsgrid_mode', m) } catch {} }
  const pickMkt = (m: string) => { setMkt(m); try { localStorage.setItem('opsgrid_market', m) } catch {} }

  const allUnits: GUnit[] = Array.isArray(data?.units) ? data!.units : []
  const today = data?.today || ''

  // The taxonomy the server used to label today's tasks. Until it arrives we render the shipped
  // one, so the board is never blank and never invents a category the server did not use.
  const cats = useMemo(() => {
    const src = Array.isArray(data?.categories) && data!.categories!.length ? data!.categories! : null
    const list: CatMeta[] = src
      ? src.map(c => ({ key: c.key, label: c.label, short: c.label.length > 9 ? c.label.slice(0, 8) + '\u2026' : c.label, Icon: glyphOf(c.icon) }))
      : FALLBACK_CATS
    const by: Record<string, CatMeta> = {}
    for (const c of list) by[c.key] = c
    return { list, by }
  }, [data])

  // A unit belongs to its market AND, for vendor buildings, to the geography behind it — same
  // two-market rule the board and the API use, so picking North here shows what North shows there.
  const inMkt = (m?: string | null, m2?: string | null) => mkt === 'all' || m === mkt || m2 === mkt
  const units = useMemo(() => allUnits.filter(u => inMkt(u.market, u.market2)), [allUnits, mkt])
  const glitchesInMkt = useMemo(() => glitches.filter(g => inMkt(g.market, g.market2)), [glitches, mkt])

  // How much work on this slice of the board nobody owns. It is the label on the Plan day button
  // and the reason it exists — when it is zero the button is not rendered at all, because a button
  // that opens a panel saying "nothing to do" is a button that trains people not to press it.
  const unownedNow = useMemo(() => units.reduce((n, u) =>
    u.guestyOnly ? n : n + u.tasks.filter(t => !t.done && !t.guestyOnly && !(t.assignees || []).length).length, 0), [units])

  // The chips are built from the WHOLE day, not the filtered slice — otherwise picking a market
  // hides every other market and you cannot get back without knowing the names.
  const markets = useMemo(() => {
    const RANK: Record<string, number> = { Miami: 0, Broward: 1, North: 2, Vendor: 3 }
    const seen: Record<string, number> = {}
    for (const u of allUnits) for (const m of [u.market, u.market2]) {
      if (!m) continue
      seen[m] = (seen[m] || 0) + u.tasks.filter(t => !t.done).length
    }
    return Object.keys(seen).sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9) || a.localeCompare(b))
      .map(m => ({ key: m, open: seen[m] }))
  }, [allUnits])

  const allTasks = useMemo(() => units.flatMap(u => u.tasks), [units])

  // ── COUNTERS ────────────────────────────────────────────────────────────────────────────────
  // Today's Breezeway tasks by category, plus the open guest/glitch backlog merged in by id so a
  // glitch scheduled for today is counted once, not twice.
  const counts = useMemo(() => {
    const m: Record<string, Counts> = { all: zero() }
    for (const c of cats.list) m[c.key] = zero()
    const bump = (k: string, done: boolean, running: boolean) => {
      const c = m[k]; if (!c) return
      c.total++; if (done) c.done++; else if (running) c.running++; else c.open++
    }
    const seen: Record<string, true> = {}
    for (const t of allTasks) {
      seen[t.id] = true
      bump('all', t.done, t.running)
      bump(catKeyOf(t), t.done, t.running)
    }
    for (const g of glitchesInMkt) {
      if (seen[g.id] || g.done) continue
      bump('all', false, !!g.running)
      bump('glitch', false, !!g.running)
    }
    return m
  }, [allTasks, glitchesInMkt, cats])

  // Open issues per unit: the QC items the board already carries plus the open guest/glitch feed.
  // AN ISSUE IS A JOB, NOT A LABEL. The glitch feed returns id, age, who has it, whether anybody
  // has it, and a report link — and every one of those was thrown away here to make a string, so an
  // open guest issue rendered as a grey sentence you could not act on without leaving the board.
  const issuesByUnit = useMemo(() => {
    const m: Record<string, Issue[]> = {}
    for (const u of units) for (const q2 of (u.qc || [])) {
      (m[u.unit] = m[u.unit] || []).push({ text: q2.issue, kind: 'qc', reportUrl: q2.reportUrl || null })
    }
    for (const g of glitchesInMkt) {
      if (g.done) continue
      ;(m[g.unit] = m[g.unit] || []).push({
        text: g.issue, kind: 'glitch', id: g.id,
        ageDays: g.ageDays ?? null, assignees: g.assignees || [],
        unassigned: !!g.unassigned, running: !!g.running, reportUrl: g.reportUrl || null,
      })
    }
    return m
  }, [units, glitchesInMkt])

  const gapByListing = useMemo(() => {
    const m: Record<string, number> = {}
    for (const v of (data?.vacants || [])) if (v.nextArrival && today) m[v.listingId] = Math.max(0, daysBetween(today, v.nextArrival))
    return m
  }, [data, today])

  // ── ROWS ────────────────────────────────────────────────────────────────────────────────────
  const rows: Row[] = useMemo(() => {
    const catMatch = (t: GTask) => !cat || catKeyOf(t) === cat
    if (mode === 'units') {
      const rowsForUnits: Row[] = units.map(u => {
        const tasks = u.tasks.filter(catMatch)
        const res = u.sameDayTurn
          ? 'TURN · out ' + (u.checkOutTime || '') + ' → in ' + (u.arrivingAt || '4:00 PM') + (u.arrivingGuest ? ' · ' + u.arrivingGuest : '')
          : u.guestOut
            ? 'Out today' + (u.checkOutTime ? ' ' + u.checkOutTime : '') + ' · ' + u.guestOut + (u.nights ? ' · ' + u.nights + 'n stay' : '')
            : u.arrivingAt
              ? 'Arriving ' + u.arrivingAt + (u.arrivingGuest ? ' · ' + u.arrivingGuest : '')
              : (() => {
                // Nobody moved today, but there is a departure clean on the board — say which of
                // the two reasons it is, because "no movement" reads as "nothing to know".
                const dc = u.tasks.find(t => t.type === 'departure_clean' && !t.done)
                const n = dc ? moveNote(dc) : null
                return n ? n.line : 'In-house / no movement'
              })()
        // Under a Guest issues / Glitches filter the row should show only the issues of that
        // kind — otherwise tapping "Glitches" hands back a row whose badge is counting QC items.
        const issues = cat === 'glitch'
          ? (issuesByUnit[u.unit] || []).filter(i => i.kind === 'glitch')
          : (issuesByUnit[u.unit] || [])
        return {
          key: 'u:' + u.listingId, title: u.unit,
          sub: [u.building, u.city].filter(Boolean).join(' · ') || u.market,
          reservation: res, status: unitStatus(u), tasks, issues,
          gapNights: gapByListing[u.listingId] ?? null,
          urgent: (u.late ? 100 : 0) + (u.atRisk ? 50 : 0) + (u.sameDayTurn ? 20 : 0) + (u.unassigned ? 10 : 0) + issues.length,
          listingId: u.listingId,
          late: !!u.late, atRisk: !!u.atRisk,
          building: u.building || null, market: u.market,
          outAt: u.checkOutTime || null, inAt: u.arrivingAt || null,
        } as Row
      })
      // A UNIT WITH A PROBLEM AND NO WORK ON IT IS THE WHOLE POINT OF A GLITCH.
      // /api/ops-today builds its unit list from today's Breezeway tasks, so a unit with an open
      // guest-reported issue but nothing scheduled today never appears — which would leave the
      // Guest issues and Glitches counters pointing at rows that do not exist. These units get a
      // row of their own, carrying the issue and no task strip.
      const have: Record<string, true> = {}
      for (const u of units) have[u.unit] = true
      for (const g of glitchesInMkt) {
        if (g.done || have[g.unit]) continue
        have[g.unit] = true
        const issues = (issuesByUnit[g.unit] || []).filter(i => cat === 'glitch' ? i.kind === 'glitch' : true)
        if (!issues.length) continue
        rowsForUnits.push({
          key: 'g:' + g.unit, title: g.unit, sub: 'open issue \u00b7 nothing scheduled today',
          reservation: 'No work on the board today',
          status: { label: 'Issue open', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
          tasks: [], issues, gapNights: null, urgent: 40 + issues.length,
        })
      }
      return rowsForUnits
    }
    // PEOPLE AXIS — the same day, re-pivoted. Unassigned work is a row of its own and sorts to the
    // top: it is the only row on this screen nobody is carrying, which makes it the first question.
    const byPerson: Record<string, GTask[]> = {}
    const unassigned: GTask[] = []
    for (const u of units) for (const t of u.tasks) {
      if (!catMatch(t)) continue
      if (!t.assignees.length) { if (!t.done) unassigned.push(t); continue }
      for (const n of t.assignees) (byPerson[n] = byPerson[n] || []).push(t)
    }
    // ── ANYONE ON SHIFT WITH NOTHING ON THEM STILL EXISTS ────────────────────────────────────
    // People mode was built purely by re-pivoting today's TASKS on the assignee string, so somebody
    // clocked in and idle produced no row at all. "Who is free?" is the first question of the
    // morning and it was structurally unanswerable on the board — while the answer sat in the
    // staffing payload, fetched two lines above where this component is mounted and never passed in.
    const idleNames: string[] = []
    for (const sp of (staff?.people || [])) {
      const nm = String(sp?.name || '').trim()
      if (!nm) continue
      if (!(sp.clockedIn || sp.shift)) continue
      const known = Object.keys(byPerson).some(k => k.toLowerCase() === nm.toLowerCase())
      if (!known) idleNames.push(nm)
    }

    const out: Row[] = Object.keys(byPerson).sort().map(name => {
      const tasks = byPerson[name]
      const doneN = tasks.filter(t => t.done).length
      const running = tasks.filter(t => t.running && !t.done).length
      const late = tasks.filter(t => t.late).length
      const dep = tasks.filter(t => catKeyOf(t) === 'departure').length
      const status = doneN === tasks.length
        ? { label: 'Done for today', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
        : running
          ? { label: 'Working', cls: 'bg-amber-50 text-amber-800 border-amber-200' }
          : { label: 'Not started', cls: 'bg-app text-muted border-line' }
      const roles = roster.find(p => p.name.toLowerCase() === name.toLowerCase())
      return {
        key: 'p:' + name, title: name,
        sub: (roles && roles.departments && roles.departments.length ? roles.departments.join(' · ') : ''),
        reservation: [dep ? dep + ' departure clean' + (dep === 1 ? '' : 's') : '', tasks.length - doneN + ' left of ' + tasks.length,
        Array.from(new Set(tasks.map(t => t.unit))).length + ' units'].filter(Boolean).join(' · '),
        status, tasks, issues: [], gapNights: null,
        urgent: late * 100 + (tasks.length - doneN),
      } as Row
    })
    // Free people sort just under the unassigned pile — the two rows a coordinator needs to put
    // together are then adjacent, which is the whole point of showing them at all.
    for (const nm of idleNames.sort()) {
      const sp = (staff?.people || []).find(x => String(x?.name || '').toLowerCase() === nm.toLowerCase())
      out.push({
        key: 'p:free:' + nm, title: nm,
        sub: (roster.find(p => p.name.toLowerCase() === nm.toLowerCase())?.departments || []).join(' · '),
        reservation: sp?.clockedIn ? 'On the clock, nothing assigned' : 'On shift, nothing assigned',
        status: { label: 'Free', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
        tasks: [], issues: [], gapNights: null,
        // Above ordinary working people, below the unassigned pile: an idle person is not urgent in
        // itself, but it is the answer to the row directly above them.
        urgent: 500_000,
      } as Row)
    }

    if (unassigned.length) out.unshift({
      key: 'p:unassigned', title: 'Nobody assigned', sub: 'open work with no name on it',
      reservation: unassigned.length + ' task' + (unassigned.length === 1 ? '' : 's') + ' · ' + Array.from(new Set(unassigned.map(t => t.unit))).length + ' units',
      status: { label: 'Needs a name', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
      tasks: unassigned, issues: [], gapNights: null, urgent: 1e6,
    })
    return out
  }, [mode, units, cat, issuesByUnit, gapByListing, roster, glitchesInMkt])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    let r = rows
    if (n) r = r.filter(x => (x.title + ' ' + x.sub + ' ' + x.tasks.map(t => t.name + ' ' + t.assignees.join(' ')).join(' ')).toLowerCase().includes(n))
    // "Active" is Breezeway's word for "still has something on it". Off = the whole portfolio,
    // finished units included, which is what you want at 6pm when you are checking the day closed.
    // "Active" means work still to do — but a FREE person has no open tasks by definition, so the
    // default filter would have hidden the very rows that answer "who can take this".
    if (activeOnly) r = r.filter(x => x.key.startsWith('p:free:') || x.tasks.some(t => !t.done) || x.issues.length > 0)
    // A filtered row earns its place with a matching task OR a matching issue — dropping the
    // issue-only rows here is what made the Glitches tile filter to an empty list.
    if (cat) r = r.filter(x => x.tasks.length > 0 || x.issues.length > 0)
    return r.slice().sort((a, b) => b.urgent - a.urgent || a.title.localeCompare(b.title))
  }, [rows, q, activeOnly, cat])

  const tiles: { key: string; cat: CatMeta | null }[] = [{ key: 'all', cat: null }, ...cats.list.map(c => ({ key: c.key, cat: c }))]

  // ── THE CLOCK ────────────────────────────────────────────────────────────────────────────────
  // Every departure clean on this board has to be finished by 4pm, because that is when the next
  // guest can walk in. The route has computed the countdown, the late count and the at-risk count
  // on every single request since it was written, and the board rendered none of it — so the one
  // number that decides the morning was the one number nobody could see.
  const dl = data?.deadline || null
  const hh = dl ? Math.floor(Math.abs(dl.minsLeft) / 60) : 0
  const mm = dl ? Math.abs(dl.minsLeft) % 60 : 0
  const clock = dl ? (dl.passed ? `${hh}h ${mm}m past` : `${hh}h ${mm}m left`) : ''

  return (
    <CatsCtx.Provider value={cats}>
    {/* ONE fetch of the suggestion list, shared by the band, the unit rows and the people rows —
        so adding a job in one place makes it disappear from the other two (Jon, 2026-08-27). */}
    <SuggestionsProvider date={today} roster={roster} onAdded={onRefresh}>
    <div>
      {/* ── A BROKEN BOARD MUST NOT LOOK LIKE A FINISHED DAY ──────────────────────────────────
          The fetch error was dropped on the floor and `loading` never reached this component, so a
          500, a timeout and a genuinely clear day all rendered the same sentence: "Nothing on the
          board for today yet." That is the failure mode that quietly destroys trust in a board —
          it says all clear at the exact moment it knows least. */}
      {error && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="text-rose-600 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-rose-900">Could not load the board</p>
            <p className="text-[11.5px] text-rose-900/80 mt-0.5">{error} — what you see below may be old, or nothing at all.</p>
          </div>
          <button onClick={onRefresh} className="text-[11.5px] font-bold text-rose-700 hover:text-rose-900 shrink-0">Retry</button>
        </div>
      )}

      {/* ── THE DEADLINE STRIP ─────────────────────────────────────────────────────────────── */}
      {dl && dl.cleans > 0 && (
        <div className={'mb-3 rounded-xl border overflow-hidden ' + (dl.late > 0 ? 'border-rose-300' : dl.atRisk > 0 ? 'border-amber-300' : 'border-line')}>
          <div className={'px-3 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap ' + (dl.late > 0 ? 'bg-rose-50' : dl.atRisk > 0 ? 'bg-amber-50' : 'bg-app')}>
            <span className="inline-flex items-baseline gap-1.5 shrink-0">
              <Clock size={13} className={dl.late > 0 ? 'text-rose-600' : dl.atRisk > 0 ? 'text-amber-600' : 'text-muted'} />
              <span className="text-[13px] font-black text-ink tabular-nums">{dl.dueBy}</span>
              <span className={'text-[12px] font-bold tabular-nums ' + (dl.passed ? 'text-rose-700' : 'text-muted')}>{clock}</span>
            </span>
            <span className="text-line hidden sm:inline">|</span>
            <span className="text-[12px] text-muted">
              <b className="text-ink tabular-nums">{dl.remaining}</b> of {dl.cleans} cleans still open
              {dl.running > 0 && <> &middot; <b className="text-amber-700 tabular-nums">{dl.running}</b> under way</>}
            </span>
            {dl.late > 0 && (
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 tabular-nums">{dl.late} late</span>
            )}
            {dl.atRisk > 0 && (
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 tabular-nums">{dl.atRisk} at risk</span>
            )}
            {dl.untracked > 0 && (
              <span className="text-[11px] text-muted" title="Vendor-cleaned units never close their tasks in Breezeway, so they carry no deadline.">
                {dl.untracked} vendor &mdash; no clock
              </span>
            )}
            <span className="flex-1" />
            {/* HOW OLD IS THIS. The route computes lastSync precisely so a coordinator can tell —
                its own comment says "a stale list is how walk-ins happen" — and nothing showed it. */}
            <span className="text-[10.5px] text-muted shrink-0 inline-flex items-center gap-1.5">
              {loading && <Loader2 size={10} className="animate-spin" />}
              {data?.lastSync ? `synced ${fmtAgo(data.lastSync)}` : today}
              <button onClick={onRefresh} className="hover:text-ink" title="Refresh now"><RefreshCw size={11} /></button>
            </span>
          </div>
        </div>
      )}
      {/* ── COUNTERS. Every tile is a filter — the number you are worried about is one tap from
          the list of rows behind it, which is the whole reason to put counters on a screen. ── */}
      {/* A GRID, NOT A SCROLLER. Eight categories on one screen at every width — four across on a
          phone, all eight on a laptop — so no counter is hidden behind a sideways swipe and no
          label has to truncate. */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
        {tiles.map(t => (
          <Tile key={t.key} cat={t.cat} c={counts[t.key] || zero()}
            active={t.key === 'all' ? cat === null : cat === t.key}
            onClick={() => setCat(t.key === 'all' ? null : (cat === t.key ? null : (t.key as Cat)))} />
        ))}
      </div>

      {/* ── MARKET (Jon, 2026-08-25: "I should also be able to select by market area"). Above the
          other controls because it scopes everything below it, counters included — a filter that
          silently changes the numbers has to be the most visible thing on the screen. ── */}
      {markets.length > 1 && (
        <div className="lh-actions mt-3 flex items-center gap-1.5 flex-wrap">
          <MapPin size={13} className="text-muted shrink-0" />
          <button onClick={() => pickMkt('all')}
            className={'px-2.5 py-1 rounded-full border text-[12px] font-bold ' + (mkt === 'all' ? 'bg-ink border-ink text-white' : 'bg-white border-line text-muted hover:text-ink')}>
            All areas
          </button>
          {markets.map(m => (
            <button key={m.key} onClick={() => pickMkt(m.key)}
              className={'px-2.5 py-1 rounded-full border text-[12px] font-bold inline-flex items-center gap-1.5 ' + (mkt === m.key ? 'bg-ink border-ink text-white' : 'bg-white border-line text-muted hover:text-ink')}>
              {m.key}
              {m.open > 0 && <span className={'text-[10px] font-bold ' + (mkt === m.key ? 'text-white/70' : 'text-muted')}>{m.open}</span>}
            </button>
          ))}
        </div>
      )}

      {/* ── SUGGESTED TODAY ────────────────────────────────────────────────────────────────
          Jon, 2026-08-26: "lets get the suggestion populating… we can't have 200 tasks just auto
          populate". Below the market chips so it scopes with them, and above the controls because
          it is about the shape of the day rather than about finding one row. It renders NOTHING
          when it has nothing to say, which on a heavy turn day is most mornings. ── */}
      <SuggestionsBand market={mkt} />

      {/* ── CONTROLS ── */}
      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line bg-white p-0.5">
          {([['units', 'Units', LayoutGrid], ['people', 'People', Users]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => pickMode(k as any)}
              className={'px-3 py-1.5 rounded-[10px] text-[12.5px] font-bold inline-flex items-center gap-1.5 ' +
                (mode === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        {!(searchOpen || q) && (
          <button onClick={() => setSearchOpen(true)} aria-label="Search"
            className="sm:hidden px-2.5 py-1.5 rounded-xl border border-line bg-white text-muted hover:text-ink">
            <Search size={14} />
          </button>
        )}
        <div className={'relative order-last w-full basis-full sm:order-none sm:w-auto sm:basis-auto sm:flex-1 sm:min-w-[180px] '
          + ((searchOpen || q) ? '' : 'hidden sm:block')}>
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)}
            onBlur={() => { if (!q) setSearchOpen(false) }}
            placeholder={mode === 'units' ? 'Find a unit, a task, a name…' : 'Find a person…'}
            className="w-full rounded-xl border border-line bg-white pl-7 pr-7 py-1.5 text-[12.5px] focus:outline-none focus:border-ink" />
          {q && <button onClick={() => { setQ(''); setSearchOpen(false) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={12} /></button>}
        </div>
        <button onClick={() => setActiveOnly(a => !a)}
          className={'px-2.5 py-1.5 rounded-xl border text-[12px] font-bold ' + (activeOnly ? 'bg-ink border-ink text-white' : 'bg-white border-line text-muted hover:text-ink')}>
          {activeOnly ? 'Active' : 'All'}
        </button>
        {/* PLAN THE DAY. Sits with the controls because it acts on exactly what the controls
            have selected — the market chips scope the plan the same way they scope the rows. It
            counts the unowned work in its own label, so the reason to press it is on the button. */}
        {unownedNow > 0 && (
          <button onClick={() => setPlanOpen(true)}
            className="px-2.5 py-1.5 rounded-xl border border-brand-500/40 bg-brand-50 text-brand-700 text-[12px] font-bold inline-flex items-center gap-1.5 hover:bg-brand-100">
            <Wand2 size={13} /> Plan day
            <span className="text-[10px] font-bold text-brand-700/70 tabular-nums">{unownedNow}</span>
          </button>
        )}
        {/* The key sits with the other controls rather than over the table header, where it
            collided with the Issues label, and where a phone would never have seen it. */}
        <button onClick={() => setKeyOpen(k => !k)}
          className={'px-2.5 py-1.5 rounded-xl border text-[12px] font-bold inline-flex items-center gap-1 ' + (keyOpen ? 'bg-app border-ink/30 text-ink' : 'bg-white border-line text-muted hover:text-ink')}>
          Key {keyOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {cat && (
          <button onClick={() => setCat(null)}
            className="px-2.5 py-1.5 rounded-xl border border-ink bg-ink text-white text-[12px] font-bold inline-flex items-center gap-1.5">
            {(() => { const G = metaOf(cats.by, cat).Icon; return <G size={12} strokeWidth={2.6} /> })()}
            {metaOf(cats.by, cat).label} <X size={11} />
          </button>
        )}
        <button onClick={() => onAddTask('')}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-1.5 text-[12.5px] font-bold hover:opacity-90">
          <Plus size={13} /> Add
        </button>
      </div>

      {/* ── HEADER + ROWS ── */}
      <div className="mt-2.5 rounded-2xl border border-line bg-white overflow-hidden">
        {/* ── THE KEY ─────────────────────────────────────────────────────────────────────────
            The legend used to be thirteen swatches over two rows, rendered AFTER the entire table.
            To decode a symbol in row three you scrolled past eighty rows, read the key, and scrolled
            back — a legend you cannot see while decoding is not a legend, it is an apology. It also
            cost ~66px of permanent height on the screen where height is the scarcest thing there is.
            Now it opens where you are already looking, and costs nothing when closed. */}
        <div className="relative">
          {keyOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setKeyOpen(false)} />
              <div className="absolute right-0 top-1 z-30 w-[min(340px,calc(100vw-2rem))] rounded-xl border border-line bg-white shadow-xl p-3 text-left">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">Colour &mdash; how far along</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2.5">
                  {(['done', 'running', 'open'] as TaskState[]).map(k => (
                    <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-ink">
                      <span className={'w-4 h-4 rounded-[4px] border-2 shrink-0 ' + STATE[k].swatch} />{STATE[k].label}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">And two things that are not stages</p>
                <div className="space-y-1 mb-2.5">
                  <span className="flex items-center gap-1.5 text-[11px] text-ink">
                    <span className="relative w-4 h-4 rounded-[4px] border-2 bg-white border-slate-300 shrink-0">
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-1 ring-white" />
                    </span>
                    Dot = nobody has taken it
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-ink">
                    <span className="w-4 h-4 rounded-[4px] border-2 bg-white border-slate-300 opacity-45 ring-2 ring-slate-400 ring-offset-1 shrink-0" />
                    Faded = guest still in, do not clean
                  </span>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">Symbol &mdash; what the work is</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {cats.list.map(c => {
                    const G = c.Icon
                    return (
                      <span key={c.key} className="inline-flex items-center gap-1.5 text-[11px] text-ink">
                        <span className="w-4 h-4 rounded-[4px] border border-slate-300 bg-white text-slate-500 inline-flex items-center justify-center shrink-0"><G size={9} strokeWidth={2.6} /></span>
                        {c.label}
                      </span>
                    )
                  })}
                </div>
                <p className="text-[10.5px] text-muted mt-2 pt-2 border-t border-line">Each symbol is one task. Hover or tap one for its detail; tap a row to work it.</p>
              </div>
            </>
          )}
        </div>
        <div className="hidden lg:grid grid-cols-12 gap-3 px-3 py-2 bg-app border-b border-line text-[10px] font-bold uppercase tracking-wider text-muted">
          {/* THE HEADER NOW MATCHES THE ROW. The cells render in DOM order on desktop — property,
              STATUS, reservation, tasks, issues — but this header claimed property, RESERVATION,
              STATUS, tasks, issues. Two of five labels sat over the wrong data, and nobody caught
              it because the header is hidden below lg. */}
          <div className="col-span-3 pl-5">{mode === 'units' ? 'Property' : 'Person'}</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-3">{mode === 'units' ? 'Reservation' : 'Load today'}</div>
          <div className="col-span-3">Tasks today</div>
          <div className="col-span-1 text-right">{mode === 'units' ? 'Issues' : ''}</div>
        </div>
        {shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted">
            {/* THREE DIFFERENT SITUATIONS THAT USED TO PRINT THE SAME SENTENCE. Still loading, the
                fetch failed, and a genuinely clear day are not the same news, and telling a
                coordinator "nothing on the board" when the request 500'd is how a board earns the
                reputation of being wrong. */}
            {loading && rows.length === 0 ? (
              <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading today&rsquo;s board&hellip;</span>
            ) : error ? (
              <span className="text-rose-700">The board could not load, so this is not &ldquo;nothing to do&rdquo; &mdash; it is &ldquo;we do not know&rdquo;.</span>
            ) : rows.length === 0 ? (
              <>Nothing scheduled on {today || 'today'}.{' '}<button onClick={onRefresh} className="font-semibold text-brand-600 hover:underline">Check again</button></>
            ) : (
              'Nothing matches. Clear the filters to see the rest.'
            )}
          </div>
        ) : shown.map(r => (
          <GridRow key={r.key} row={r} roster={roster} mode={mode} onRefresh={onRefresh} onAdd={onAddTask}
            units={allUnits} staff={staff} />
        ))}
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {shown.length} {mode === 'units' ? 'unit' : 'person'}{shown.length === 1 ? '' : 's'} shown.
        {' '}Glitches count everything still open, not only what is scheduled today.
      </p>

      {planOpen && (
        <DayPlanPanel
          units={units} roster={roster} staff={staff} today={today}
          onClose={() => setPlanOpen(false)}
          onApplied={onRefresh}
        />
      )}
    </div>
    </SuggestionsProvider>
    </CatsCtx.Provider>
  )
}

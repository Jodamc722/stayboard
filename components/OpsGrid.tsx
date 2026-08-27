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
  LayoutGrid, Users, X, MapPin,
  DoorOpen, Sparkles, Zap, Wrench, ClipboardCheck, ClipboardList, Check,
  Droplet, Bug, Hammer, KeyRound, ShieldCheck, Package, Star, BedDouble,
} from 'lucide-react'
import { catOfTask, type TaskCat } from '@/lib/task-categories'

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
export type GData = { ok: boolean; today: string; units: GUnit[]; vacants?: GVacant[]; categories?: GCat[] }
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

// THE ONLY PLACE COLOUR IS DECIDED. Four states, in the order a job moves through them, plus the
// one that is not a stage at all: nobody has taken it. Unassigned is drawn as a dashed outline as
// well as a colour, because "no owner" is the state most worth catching on a screen where somebody
// is colour-blind or standing in the sun.
type TaskState = 'done' | 'running' | 'open' | 'unassigned'
const STATE: Record<TaskState, { label: string; chip: string; swatch: string }> = {
  done: { label: 'Finished', chip: 'bg-emerald-500 border-emerald-500 text-white', swatch: 'bg-emerald-500 border-emerald-500' },
  running: { label: 'In progress', chip: 'bg-amber-400 border-amber-400 text-white', swatch: 'bg-amber-400 border-amber-400' },
  open: { label: 'Not started', chip: 'bg-white border-slate-300 text-slate-500', swatch: 'bg-white border-slate-300' },
  unassigned: { label: 'Nobody assigned', chip: 'bg-white border-dashed border-rose-400 text-rose-500', swatch: 'bg-white border-dashed border-rose-400' },
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
        className={'w-6 h-6 rounded-[6px] border-2 shrink-0 inline-flex items-center justify-center transition-transform hover:scale-110 ' +
          STATE[state].chip +
          // The exception rides ON TOP of the state rather than replacing it, so an extended clean
          // still tells you whether anyone has touched it — it just also shouts not to.
          (t.moveState === 'extended' ? ' ring-2 ring-rose-500 ring-offset-1' : '')}>
        <Glyph size={12} strokeWidth={2.4} />
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
type Row = {
  key: string
  title: string
  sub: string
  reservation: string
  status: { label: string; cls: string }
  tasks: GTask[]
  issues: { text: string; kind: 'qc' | 'glitch' }[]
  gapNights: number | null
  urgent: number
  listingId?: string
}

function GridRow({ row, roster, mode, onRefresh, onAdd }: {
  row: Row; roster: GRoster[]; mode: 'units' | 'people'; onRefresh: () => void; onAdd: (unit: string) => void
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 lg:grid lg:grid-cols-12 lg:gap-3 px-3 py-2 lg:py-2.5 hover:bg-app/60 cursor-pointer"
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
            <div className="mb-2 flex flex-wrap gap-1.5">
              {row.issues.map((i, n) => (
                <span key={n} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">{i.text}</span>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-line bg-white divide-y divide-line overflow-hidden">
            {row.tasks.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-muted">Nothing scheduled on this {mode === 'people' ? 'person' : 'unit'} today.</div>}
            {row.tasks.map(t => <TaskLine key={t.id} t={t} roster={roster} mode={mode} onRefresh={onRefresh} comment={comments ? comments[t.id] || null : null} />)}
          </div>
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
function TaskLine({ t, roster, mode, onRefresh, comment }: {
  t: GTask; roster: GRoster[]; mode: 'units' | 'people'; onRefresh: () => void; comment: { body: string; at: string } | null
}) {
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const { by } = useCats()
  const c = metaOf(by, catKeyOf(t))
  const mv = moveNote(t)
  const ppl = useMemo(() => {
    const inDept = roster.filter(p => !p.departments?.length || p.departments.some(x => x.toLowerCase().includes(String(t.dept || '').toLowerCase())))
    return (inDept.length ? inDept : roster).slice(0, 14)
  }, [roster, t.dept])
  const assign = async (id: number) => {
    setBusy(id); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, assigneeIds: [id] }) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'assign failed')
      setAssigning(false); onRefresh()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(0)
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
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {ppl.map(p => (
            <button key={p.id} onClick={() => assign(p.id)} disabled={!!busy}
              className="text-[11.5px] font-semibold px-2 py-1 rounded-full border border-line bg-white hover:border-ink/40 disabled:opacity-50">
              {busy === p.id ? <Loader2 size={10} className="animate-spin inline" /> : null} {p.name}
            </button>
          ))}
          {err && <span className="text-[11px] text-rose-600 font-semibold">{err}</span>}
        </div>
      )}
    </div>
  )
}

// ── THE GRID ────────────────────────────────────────────────────────────────────────────────────
export function OpsGrid({ data, glitches, roster, onRefresh, onAddTask }: {
  data: GData | undefined
  glitches: GGlitch[]
  roster: GRoster[]
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
  const issuesByUnit = useMemo(() => {
    const m: Record<string, { text: string; kind: 'qc' | 'glitch' }[]> = {}
    for (const u of units) for (const q2 of (u.qc || [])) (m[u.unit] = m[u.unit] || []).push({ text: q2.issue, kind: 'qc' })
    for (const g of glitchesInMkt) {
      if (g.done) continue
      ;(m[g.unit] = m[g.unit] || []).push({ text: g.issue, kind: 'glitch' })
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
    if (activeOnly) r = r.filter(x => x.tasks.some(t => !t.done) || x.issues.length > 0)
    // A filtered row earns its place with a matching task OR a matching issue — dropping the
    // issue-only rows here is what made the Glitches tile filter to an empty list.
    if (cat) r = r.filter(x => x.tasks.length > 0 || x.issues.length > 0)
    return r.slice().sort((a, b) => b.urgent - a.urgent || a.title.localeCompare(b.title))
  }, [rows, q, activeOnly, cat])

  const tiles: { key: string; cat: CatMeta | null }[] = [{ key: 'all', cat: null }, ...cats.list.map(c => ({ key: c.key, cat: c }))]

  return (
    <CatsCtx.Provider value={cats}>
    <div>
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
        <div className="hidden lg:grid grid-cols-12 gap-3 px-3 py-2 bg-app border-b border-line text-[10px] font-bold uppercase tracking-wider text-muted">
          <div className="col-span-3 pl-5">{mode === 'units' ? 'Property' : 'Person'}</div>
          <div className="col-span-3">{mode === 'units' ? 'Reservation' : 'Load today'}</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-3">Tasks today</div>
          <div className="col-span-1 text-right">Issues</div>
        </div>
        {shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted">
            {rows.length === 0 ? 'Nothing on the board for today yet.' : 'Nothing matches. Clear the filters to see the rest.'}
          </div>
        ) : shown.map(r => (
          <GridRow key={r.key} row={r} roster={roster} mode={mode} onRefresh={onRefresh} onAdd={onAddTask} />
        ))}
      </div>

      {/* THE LEGEND — two rows, because there are two channels and mixing them in one line is how
          people end up believing the colour means the category. Symbols first: they are the thing
          you read; colour is the thing you scan. */}
      <div className="mt-2.5 rounded-xl border border-line bg-app/50 px-3 py-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted shrink-0">Symbol = what it is</span>
          <span className="flex items-center gap-x-3 gap-y-1 flex-wrap">
            {cats.list.map(c => {
              const G = c.Icon
              return (
                <span key={c.key} className="inline-flex items-center gap-1 text-[10.5px] text-muted">
                  <span className="w-4 h-4 rounded-[4px] border border-slate-300 bg-white text-slate-500 inline-flex items-center justify-center"><G size={9} strokeWidth={2.6} /></span>
                  {c.label}
                </span>
              )
            })}
          </span>
        </div>
        <div className="mt-1.5 pt-1.5 border-t border-line flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted shrink-0">Colour = how far along</span>
          <span className="flex items-center gap-x-3 gap-y-1 flex-wrap">
            {(['done', 'running', 'open', 'unassigned'] as TaskState[]).map(k => (
              <span key={k} className="inline-flex items-center gap-1 text-[10.5px] text-muted">
                <span className={'w-4 h-4 rounded-[4px] border-2 ' + STATE[k].swatch} />
                {STATE[k].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted">
              <span className="w-4 h-4 rounded-[4px] border-2 bg-white border-slate-300 ring-2 ring-rose-500 ring-offset-1" />
              Guest still in &mdash; do not clean
            </span>
          </span>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {shown.length} {mode === 'units' ? 'unit' : 'person'}{shown.length === 1 ? '' : 's'} shown ·
        each symbol is one task · hover or tap a symbol for its detail, tap a row to work it.
        {' '}Glitches count everything still open, not only what is scheduled today &mdash; they stay open until somebody fixes them.
      </p>
    </div>
    </CatsCtx.Provider>
  )
}

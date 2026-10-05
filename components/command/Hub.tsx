'use client'
// COMMAND CENTER — THE OPERATIONAL HUB (Jon, 2026-09-30).
//
//   "Command Center should be the interface where most people can get their work done from…
//    inspections, available hours for the day, welcome calls, departure cleans, pending units…
//    guest sentiment, prioritizing operations like high-ticket items, review management,
//    administrative work… It should be clean, actionable, and manageable." And, on the first cut:
//   "it's just a long, long list instead of it being more optimized… track some high-level KPIs at
//    the top that are important to the organization based on these key areas."
//
// THE SHAPE OF THE DAY, top to bottom:
//   1. KPIs — eight numbers in four areas (Operations, Guests, Reviews, Admin): the state of the
//      business right now, each with the week beside it where the week means something. A tile is
//      also a switch: click it and the page focuses on that area's lane.
//   2. NOW — the six things that matter most in the next two hours, ranked across every area by
//      guest impact, lateness and the money on the booking (high-ticket first). Each with its buttons.
//   3. FOUR LANES side by side (two by two on a desktop, stacked on a phone): Operations · Guests ·
//      Reviews · Admin. A lane shows its top rows and a count chip per sub-area (Cleans · Inspections ·
//      Team…) — chips filter in place, "+N more" opens the rest in place. No drop-downs anywhere.
//   Under the lanes: Eve and Slack decisions, the batch clears, the week's scoreboard.
//
// Every row is ONE line with its action buttons, never a menu. Actions a role cannot take are not
// drawn (useAccess); the server checks again. Reads: the day (/api/command/day, shared with the rest
// of the page), the reply queue (/api/reviews), the checklist (/api/daily-checklist), your tasks
// (/api/projects/mine), the listing fixes (/api/listing-health?slim=1) and the week (/api/command/scoreboard).
import { cloneElement, createContext, isValidElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2, Check, ExternalLink, UserPlus, Star, Phone, X, Sparkles, ClipboardCheck, ListChecks, MessageSquare, FileText, ChevronDown, ChevronUp, StickyNote, Circle, CheckCircle2 } from 'lucide-react'
import { Tag, type Tone } from '@/components/lean'
import { signalLabel } from '@/lib/checklist-shared'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { useAccess } from '@/lib/useAccess'
import type { CommandDay, NextItem, GuestDeskRow, CleanRow as CleanRowT, ArrivalRow, TaskRow, TeamRow as TeamRowT, GlitchRow as GlitchRowT } from '@/lib/command-day'
import type { PersonTask } from '@/lib/capacity-day'
type PersonTaskGroup = PersonTask['group']
import { InlineAssign, BTN, MINE_URL, type Roster, type Mine, type MineItem } from '@/components/CommandCockpit'
import { SCOREBOARD_URL } from '@/components/command/Scoreboard'
import { NudgeBtn } from '@/components/command/Nudge'
import { DayKpis } from '@/components/command/DayKpis'
import { ArrivalsLane } from '@/components/command/ArrivalsLane'
import { useTaskActions, TaskStateTag, BehindTag, taskStateOf, type TaskState } from '@/components/task/TaskActions'
import { whereNow, clockTag } from '@/lib/team-where'
import { UnpaidBoard } from '@/components/UnpaidBoard'

// ── shared bits ─────────────────────────────────────────────────────────────────────────────────
export type Area = 'ops' | 'guests' | 'reviews' | 'admin'
export type HubItem = { key: string; area: Area; sub: string; score: number; node: ReactNode }
const AREA: Record<Area, { label: string; short: string; Icon: any; href: string; hrefLabel: string; blurb: string }> = {
  ops: { label: 'Operations', short: 'Ops', Icon: ListChecks, href: '/plan', hrefLabel: 'Today board', blurb: 'Departure cleans and pending units, today’s inspections, and the team’s hours' },
  guests: { label: 'Guests', short: 'Guests', Icon: MessageSquare, href: '/messages', hrefLabel: 'Inbox', blurb: 'Welcome calls, guests waiting or unhappy, and open guest issues' },
  reviews: { label: 'Reviews', short: 'Reviews', Icon: Star, href: '/reviews', hrefLabel: 'Reviews', blurb: 'Reviews waiting on a public reply — low scores first' },
  admin: { label: 'Admin', short: 'Admin', Icon: FileText, href: '/buildings', hrefLabel: 'Properties', blurb: 'What needs your decision, unpaid balances to collect, the checklist, your tasks and today’s recommended listing work' },
}
const SUB_ORDER = ['Cleans', 'Inspections', 'Tasks', 'Team', 'Calls', 'Inbox', 'Glitches', 'Reviews', 'Queue', 'Needs you', 'Yours', 'Optimize', 'Fixes']
const UNPAID_URL = '/api/unpaid'   // today → +7: in house, arriving today, next seven days (direct / VRBO / Google only)
const NOW_MIN = 65     // a row needs this score to make the Now list
const NOW_MAX = 6
const LANE_ROWS = 5
export const LIST = 'rounded-2xl border border-line bg-white divide-y divide-line/70 shadow-soft'
export const GHOST = BTN + ' border border-line bg-white text-ink hover:border-ink/40'
export const DARK = BTN + ' bg-ink text-white'
export const bz = (id: string) => 'https://app.breezeway.io/task/' + id
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
export const hm = (min: number) => { const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60; return (min < 0 ? '-' : '') + (h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm') }
/** High-ticket weighting: up to +10 on a $5,000 booking. */
const valueBonus = (v: number) => Math.min(10, Math.max(0, v) / 500)
export const INSPECT = /inspect|unit check|quality/i

async function post(url: string, body: any, method = 'POST') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false || j.error) throw new Error(j.error || j.message || 'Request failed')
  return j
}
const clearRow = (i: { key: string; title?: string; unit?: string }, outcome: 'done' | 'skipped') =>
  post('/api/command/dismiss', { key: i.key, outcome, title: i.title, unit: i.unit })

// ── NOTES ON EVERY ROW (Jon, 2026-10-01: "everything on that page should be able to add notes …
// Today's Ecosystem"). One read for the page (/api/command/notes, last 14 days by row key); a row
// with a `noteKey` shows a note button with its count and opens a small thread under itself.
export type DayNote = { id: string; key: string; text: string; by: string; at: string }
export const NOTES_URL = '/api/command/notes'
export const NotesCtx = createContext<{ byKey: Record<string, DayNote[]>; add: (key: string, text: string) => Promise<void>; ready: boolean } | null>(null)
export function NoteBtn({ noteKey, open, onToggle }: { noteKey: string; open: boolean; onToggle: () => void }) {
  const ctx = useContext(NotesCtx)
  const n = ctx?.byKey[noteKey]?.length || 0
  return (
    <button onClick={onToggle} aria-pressed={open} className={GHOST + (n ? ' !border-amber-300 !bg-amber-50 !text-amber-900' : '')} title={n ? n + ' note' + (n === 1 ? '' : 's') + ' — click to read or add' : 'Add a note'}>
      <StickyNote size={12} />{n ? <span className="tabular-nums">{n}</span> : null}
    </button>
  )
}
export function NoteThread({ noteKey }: { noteKey: string }) {
  const ctx = useContext(NotesCtx)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const notes = ctx?.byKey[noteKey] || []
  const save = async () => {
    const t = text.trim(); if (!t || !ctx) return
    setBusy(true); setErr('')
    try { await ctx.add(noteKey, t); setText('') } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="mt-1.5 pl-3.5 space-y-1.5">
      {notes.length > 0 && <ul className="space-y-1">{notes.slice(0, 8).map(n => <li key={n.id} className="text-[12px] text-ink"><span className="text-muted">{String(n.by).split(/[\s@]/)[0]} · {when(n.at)} — </span>{n.text}</li>)}</ul>}
      <div className="flex items-start gap-1.5">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} placeholder="Add a note — what was done, who you spoke to, what is next" className="flex-1 text-[12px] bg-app border border-line rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        <button onClick={save} disabled={busy || !text.trim()} className={DARK} title="Saves with your name and the time">{busy ? <Loader2 size={12} className="animate-spin" /> : 'Save'}</button>
      </div>
      {err && <p className="text-[11.5px] text-rose-700">{err}</p>}
    </div>
  )
}

/** One row: dot · title · tags · meta, then the buttons. Detail (an assign strip, a reply box) opens under it. */
export function Row({ dot, title, meta, tags, actions, children, err, lane, noteKey }: {
  dot?: 'rose' | 'amber' | null; title: ReactNode; meta?: ReactNode; tags?: ReactNode; actions?: ReactNode; children?: ReactNode; err?: string; lane?: string; noteKey?: string
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const notesCtx = useContext(NotesCtx)
  const noteBtn = noteKey && notesCtx ? <NoteBtn noteKey={noteKey} open={notesOpen} onToggle={() => setNotesOpen(o => !o)} /> : null
  return (
    <div className="px-3.5 py-2 min-h-[48px] flex flex-col justify-center hover:bg-app/60 transition-colors">
      <div className="flex items-center gap-2 min-w-0 flex-wrap sm:flex-nowrap">
        <span aria-hidden className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (dot === 'rose' ? 'bg-rose-500' : dot === 'amber' ? 'bg-amber-400' : 'bg-transparent')} />
        <span className="flex-1 min-w-[55%] sm:min-w-0 flex items-center gap-x-1.5 flex-wrap">
          <span className="text-[13px] font-semibold text-ink truncate max-w-full">{title}</span>
          {tags}
          {meta ? <span className="text-[11.5px] text-muted truncate max-w-full">{meta}</span> : null}
          {lane ? <span className="hidden sm:inline text-[10px] uppercase tracking-wider font-bold text-muted/60 ml-auto pl-2" title={'From the ' + lane + ' lane'}>{lane}</span> : null}
        </span>
        {actions || noteBtn ? <span className="flex items-center gap-1.5 shrink-0 ml-3.5 sm:ml-0">{noteBtn}{actions}</span> : null}
      </div>
      {err && <p className="text-[11.5px] font-semibold mt-1 pl-3.5 text-rose-600">{err}</p>}
      {notesOpen && noteKey && <NoteThread noteKey={noteKey} />}
      {children}
    </div>
  )
}

// ── rows, one per kind ──────────────────────────────────────────────────────────────────────────
export const CLEAN_ST: Record<string, { label: string; tone: Tone; title: string }> = {
  late: { label: 'late', tone: 'rose', title: 'Will not land by the deadline at the current pace' },
  atRisk: { label: 'at risk', tone: 'amber', title: 'Tight against the next arrival or 4pm' },
  open: { label: 'not started', tone: 'slate', title: 'Nobody has started this clean' },
  running: { label: 'in progress', tone: 'sky', title: 'Started, not finished' },
}
export function CleanRow({ c, value, roster, canAssign: _canAssign, onChanged, lane }: { c: CleanRowT; value: number; roster: Roster[]; canAssign: boolean; onChanged: () => void; lane?: string }) {
  // ONE TASK, ONE WAY (2026-10-01): the shared strip — Assign · Done · Nudge · Comments · Breezeway —
  // and the 3-way comment thread, the same as the Schedule, Today board and Maintenance desk.
  const nobody = !c.who
  const state: TaskState = c.status === 'done' ? 'done' : c.status === 'late' ? 'late' : c.status === 'atRisk' ? 'atRisk' : c.status === 'running' ? 'running' : 'open'
  const ta = useTaskActions({ taskId: c.taskId, dept: 'housekeeping', label: c.unit + ' — clean', link: '/schedule', state, who: c.who, roster, onChanged })
  return (
    <Row lane={lane} dot={state === 'late' || (c.behind === 'late' && !ta.done) ? 'rose' : state === 'atRisk' || (c.behind && !ta.done) || (nobody && !ta.done) ? 'amber' : null} title={c.unit}
      tags={<>
        <TaskStateTag state={ta.done ? 'done' : state} />
        {c.behind && !ta.done && <Tag tone={c.behind === 'late' ? 'rose' : 'amber'} title={c.behind === 'late' ? 'In progress, but at this pace it finishes after the deadline' : 'In progress, finishing close to the deadline'}>{c.behind === 'late' ? 'running late' : 'tight'}</Tag>}
        {c.sameDay && !ta.done && <Tag tone="violet" title="A guest arrives into this unit today">same-day</Tag>}
        {nobody && !ta.done && <TaskStateTag state="unassigned" />}
        {value >= 1000 && <Tag tone="slate" title={'The arriving booking is worth ' + money(value) + ' — high-ticket, first in line'}>{money(value)}</Tag>}
      </>}
      meta={[c.who, c.arrivingAt ? 'guest in ' + c.arrivingAt : '', c.market].filter(Boolean).join(' · ')}
      actions={ta.actions}>
      {ta.panels}
    </Row>
  )
}

export function InspectionTaskRow({ t, big, roster, canAssign: _canAssign, onChanged, lane }: { t: TaskRow; big: boolean; roster: Roster[]; canAssign: boolean; onChanged: () => void; lane?: string }) {
  const nobody = !t.who
  const state: TaskState = taskStateOf({ done: t.state === 'done', running: t.state === 'running', late: t.late })
  const ta = useTaskActions({ taskId: t.taskId, dept: 'inspection', label: t.unit + ' — ' + t.name, link: '/command', state, who: t.who, roster, onChanged })
  return (
    <Row lane={lane} dot={!ta.done && (nobody || t.late) ? (t.late ? 'rose' : 'amber') : null} title={t.unit}
      tags={<>
        <TaskStateTag state={ta.done ? 'done' : state} />
        {!ta.done && state === 'running' && <BehindTag late={t.late} />}
        {nobody && !ta.done && <TaskStateTag state="unassigned" />}
        {big && <Tag tone="violet" title="A big arrival lands in this unit — walk it first">big arrival</Tag>}
      </>}
      meta={[t.name, t.who, t.market].filter(Boolean).join(' · ')}
      actions={ta.actions}>
      {ta.panels}
    </Row>
  )
}

const ARR_ST: Record<string, { label: string; tone: Tone; title: string }> = {
  open: { label: 'inspection open', tone: 'sky', title: 'An inspection is scheduled on this unit' },
  done: { label: 'inspected', tone: 'emerald', title: 'Walked recently — covered' },
  auto: { label: 'auto', tone: 'violet', title: 'Task automation files this inspection on its next run — nobody needs to' },
  none: { label: 'no inspection', tone: 'amber', title: 'Nothing walks this unit before the guest lands — create one, or turn Task automation on' },
}
export function ArrivalInspectionRow({ a, create, canCreate, onChanged, lane }: { a: ArrivalRow; create: NextItem | null; canCreate: boolean; onChanged: () => void; lane?: string }) {
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState(false)
  const [err, setErr] = useState('')
  const s = made ? ARR_ST.open : ARR_ST[a.inspection] || ARR_ST.none
  const go = async () => {
    if (!create || create.action?.type !== 'create_task') return
    setBusy(true); setErr('')
    try { await post('/api/ops-today/add-task', create.action.payload); setMade(true); onChanged() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <Row lane={lane} noteKey={'arr:' + a.reservationId} dot={a.inspection === 'none' && !made ? (a.today ? 'rose' : 'amber') : null} title={a.unit}
      tags={<>
        <Tag tone={a.today ? 'slate' : 'sky'} title={'Checks in ' + a.checkIn}>{a.today ? 'arrives today' : 'arrives tomorrow'}</Tag>
        <Tag tone={s.tone} title={s.title}>{s.label}</Tag>
        {a.value >= 1000 && <Tag tone="slate" title={'A ' + money(a.value) + ' booking — high-ticket'}>{money(a.value)}</Tag>}
      </>}
      meta={[a.guest, a.nights + ' nights'].join(' · ')} err={err}
      actions={<>
        {a.inspection === 'none' && !made && canCreate && create && <button onClick={go} disabled={busy} className={DARK} title="Create the pre-arrival inspection in Breezeway">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Create</button>}
        {a.inspectionTaskId && <a href={bz(a.inspectionTaskId)} target="_blank" rel="noreferrer" className={GHOST} title="Open the inspection in Breezeway"><ExternalLink size={12} /></a>}
      </>} />
  )
}

export function CallRow({ a, canLog, onChanged, lane }: { a: ArrivalRow; canLog: boolean; onChanged: () => void; lane?: string }) {
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')
  const log = async (outcome: 'reached' | 'voicemail' | 'no_answer') => {
    setBusy(outcome); setErr('')
    try { await post('/api/welcome-call', { reservationId: a.reservationId, outcome }); setDone(outcome); onChanged() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  if (done) return <Row lane={lane} noteKey={'call:' + a.reservationId} title={a.guest} tags={<Tag tone="emerald" title="Logged on the booking and in Guesty">{done === 'no_answer' ? 'no answer — try again later' : 'called'}</Tag>} meta={a.unit} />
  const B = (o: 'reached' | 'voicemail' | 'no_answer', label: string, title: string) => (
    <button onClick={() => log(o)} disabled={!!busy} className={o === 'reached' ? DARK : GHOST} title={title}>{busy === o ? <Loader2 size={12} className="animate-spin" /> : null}{label}</button>
  )
  return (
    <Row lane={lane} noteKey={'call:' + a.reservationId} dot={a.big ? 'amber' : null} title={a.guest}
      tags={<>{a.big && <Tag tone="violet" title="Big arrival — a mandatory call">must call</Tag>}{a.value >= 1000 && <Tag tone="slate" title={money(a.value) + ' booking'}>{money(a.value)}</Tag>}</>}
      meta={[a.unit, a.nights + ' nights'].join(' · ')} err={err}
      actions={canLog ? <>
        {B('reached', 'Reached', 'Spoke to the guest — logs the call on the booking and in Guesty')}
        {B('voicemail', 'Voicemail', 'Left a voicemail — counts as called')}
        {B('no_answer', 'No answer', 'No answer — stays on the list for another try')}
      </> : <Link href="/welcome-calls" className={GHOST}><Phone size={12} /> Open</Link>} />
  )
}

function InboxRow({ i, onCleared, lane }: { i: NextItem; onCleared: (k: string) => void; lane?: string }) {
  const unhappy = (i.tags || []).some(t => t.label === 'Unhappy')
  const [busy, setBusy] = useState(false)
  // "Should be able to close these if no action needed" (Jon, 2026-10-01): one tap clears the row
  // for the day on every device; it comes back tomorrow if the guest is still waiting or unhappy.
  const close = async () => { setBusy(true); try { await clearRow(i, 'skipped'); onCleared(i.key) } catch { /* shown on reload */ } setBusy(false) }
  return (
    <Row lane={lane} noteKey={i.key} dot={i.severity === 'now' ? 'rose' : 'amber'} title={i.unit || i.title}
      tags={<>{(i.tags || []).map(t => <Tag key={t.label} tone={t.tone} title={t.title}>{t.label}</Tag>)}</>}
      meta={i.why}
      actions={<>
        <Link href={i.href || '/messages'} prefetch={false} className={DARK} title={unhappy ? 'Open the thread — read what upset them and reply' : 'Open the thread — reply, or send Eve’s draft'}>Reply</Link>
        <button onClick={close} disabled={busy} className={GHOST} title="No action needed — clears this row for today, for everyone">{busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}</button>
      </>} />
  )
}

export function GlitchRow({ g, canEdit, canApprove, onChanged, lane }: { g: GlitchRowT; canEdit: boolean; canApprove?: boolean; onChanged: () => void; lane?: string }) {
  const [busy, setBusy] = useState('')
  const [gone, setGone] = useState(false)
  const [sent, setSent] = useState(false)      // closed by a non-manager: parked for approval, not gone
  const [why, setWhy] = useState('')
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState('')
  const awaiting = sent || g.status === 'manager_review'
  const run = async (body: Record<string, any>, after: () => void) => {
    setBusy(String(body.action) + (body.status || '')); setErr('')
    try { await post('/api/glitches/action', { id: g.id, ...body }).then(j => { if (j.awaitingApproval) setSent(true); else after() }); onChanged() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  if (gone) return null
  return (
    <Row lane={lane} noteKey={'gl:' + g.id} dot={g.overdue ? 'rose' : !g.hasTask ? 'amber' : null} title={g.unit}
      tags={<>
        {g.overdue && <Tag tone="rose" title={'Due ' + (g.due || '')}>overdue</Tag>}
        {!g.hasTask && <Tag tone="amber" title="No Breezeway task yet — open the card to push one">no task</Tag>}
        {awaiting
          ? <Tag tone="violet" title="Marked complete by the team — a manager approves the close">awaiting manager approval</Tag>
          : <Tag tone="slate" title="Where the card sits on the Glitches board">{g.status.replace(/_/g, ' ')}</Tag>}
      </>}
      meta={[g.issue, g.assignee, g.ageDays + 'd old'].filter(Boolean).join(' · ')} err={err}
      actions={<>
        <Link href={g.href} prefetch={false} className={GHOST} title="Open the card: refund advice, vendor, push a task">Open</Link>
        {awaiting && canApprove ? (asking ? (
          <form className="inline-flex items-center gap-1" onSubmit={e => { e.preventDefault(); if (why.trim()) run({ action: 'rejectClose', note: why.trim() }, () => setSent(false)) }}>
            <input autoFocus value={why} onChange={e => setWhy(e.target.value)} placeholder="What still needs doing?" maxLength={300} className="h-7 w-44 rounded-md border border-line px-2 text-[12px]" />
            <button type="submit" disabled={!!busy || !why.trim()} className={GHOST}>Send back</button>
            <button type="button" onClick={() => setAsking(false)} className={GHOST}>Cancel</button>
          </form>
        ) : <>
          <button onClick={() => run({ action: 'approveClose' }, () => setGone(true))} disabled={!!busy} className={DARK} title="Approve — the card closes with your name on it">{busy === 'approveClose' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve</button>
          <button onClick={() => setAsking(true)} disabled={!!busy} className={GHOST} title="Not done yet — back to ops with a reason">Send back</button>
        </>) : null}
        {!awaiting && canEdit && <button onClick={() => run({ action: 'move', status: 'closed' }, () => setGone(true))} disabled={!!busy} className={GHOST} title={canApprove ? 'Resolved — close the card' : 'Resolved — sends it to a manager to approve the close'}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {canApprove ? 'Close' : 'Complete'}</button>}
      </>} />
  )
}

type Review = { id: string; rating: number | null; content: string; channel: string; listingId: string; guest: string; created_at: string; hasReply: boolean; listing_name: string; dismissed?: boolean; removed?: boolean }
const REVIEWS_URL = '/api/reviews?days=60&hub=1'
const five = (r: number | null, ch: string) => r == null ? null : /booking/i.test(ch) && r > 5 ? Math.round((r / 2) * 10) / 10 : r
function ReviewRow({ r, canReply, onGone, lane }: { r: Review; canReply: boolean; onGone: () => void; lane?: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const s = five(r.rating, r.channel)
  const low = s != null && s <= 3
  const run = async (what: 'draft' | 'post' | 'skip') => {
    setBusy(what); setErr('')
    try {
      if (what === 'draft') { const j = await post('/api/reviews/draft', { content: r.content, rating: r.rating, guest: r.guest, channel: r.channel, listing_name: r.listing_name, listingId: r.listingId }); setText(String(j.draft || '')) }
      else if (what === 'post') { await post('/api/reviews/reply', { reviewId: r.id, reviewReply: text.trim() }); onGone() }
      else { await post('/api/reviews/dismiss', { reviewId: r.id }); onGone() }
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  return (
    <Row lane={lane} noteKey={'rv:' + r.id} dot={low ? 'rose' : null} title={r.listing_name || 'Unit'}
      tags={s != null ? <Tag tone={low ? 'rose' : s >= 4.5 ? 'emerald' : 'slate'} title={r.channel + ' · ' + r.created_at.slice(0, 10) + (low ? ' · a low score is answered within 24h' : '')}><Star size={10} className="inline -mt-0.5" /> {s}</Tag> : null}
      meta={r.guest + ' · ' + (r.content || '(no text)').replace(/\s+/g, ' ').slice(0, 90)} err={err}
      actions={canReply ? <>
        <button onClick={() => setOpen(o => !o)} className={open ? DARK : GHOST} title="Read it and write the public reply here">{open ? 'Close' : 'Reply'}</button>
        <button onClick={() => run('skip')} disabled={!!busy} className={GHOST} title="No reply needed — take it off the queue"><X size={12} /></button>
      </> : <Link href="/reviews" className={GHOST}>Open</Link>}>
      {open && (
        <div className="mt-2 pl-3.5 space-y-2">
          <p className="text-[12.5px] text-ink/80 whitespace-pre-wrap">{r.content || '(no text)'}</p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Write the public reply, or let Eve draft one"
            className="w-full rounded-lg border border-line px-3 py-2 text-[13px] focus:outline-none focus:border-ink/40" />
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => run('draft')} disabled={!!busy} className={GHOST} title="Eve writes a draft in the house voice — edit it before posting">{busy === 'draft' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Draft with Eve</button>
            <button onClick={() => run('post')} disabled={!!busy || !text.trim()} className={DARK} title="Post this reply publicly on the channel">{busy === 'post' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Post reply</button>
          </div>
        </div>
      )}
    </Row>
  )
}

/** WHO IS WHERE, ONE LINE (Jon, 2026-10-05: "see who's working and … where they might be"). Groups the
 *  team by the building each person is most likely in right now, plus who is on the clock. */
export function TeamWhereStrip({ rows }: { rows: TeamRowT[] }) {
  const now = new Date()
  const read = rows.map(p => ({ p, w: whereNow(p.tasks || [], now, p.clock) }))
  const byB: Record<string, { name: string; kind: string }[]> = {}
  for (const { p, w } of read) {
    if (w.kind === 'none' || w.kind === 'last' || !w.building) continue
    ;(byB[w.building] = byB[w.building] || []).push({ name: p.person.split(/\s+/)[0], kind: w.kind })
  }
  const on = rows.filter(p => p.clock?.open).length
  const known = rows.some(p => p.clock)
  const atN = read.filter(x => x.w.kind === 'at').length
  const movingN = read.filter(x => (x.w.kind === 'still' || x.w.kind === 'heading') && x.w.tone !== 'amber').length
  const notN = read.filter(x => x.w.kind === 'none' && (x.p.tasks || []).length).length
  const doneN = read.filter(x => x.w.kind === 'last').length
  const quiet = read.filter(x => x.w.tone === 'amber').map(x => x.p.person.split(/\s+/)[0])
  const bs = Object.keys(byB).sort((a, b) => byB[b].length - byB[a].length || a.localeCompare(b))
  return (
    <div className="px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {known && <Tag tone="emerald" title="Clocked in right now (Homebase)">{on} on the clock</Tag>}
        <Tag tone="sky" title="A task in progress in Breezeway">{atN} in a unit</Tag>
        {movingN > 0 && <Tag tone="slate" title="Finished a task, more to do">{movingN} between units</Tag>}
        {notN > 0 && <Tag tone="slate" title="Has work, nothing started yet">{notN} not started</Tag>}
        {doneN > 0 && <Tag tone="emerald" title="Everything assigned is finished">{doneN} done for the day</Tag>}
        {quiet.length > 0 && <Tag tone="amber" title={'Nothing started in a while, with work left: ' + quiet.join(', ')}>{quiet.length} quiet</Tag>}
      </div>
      {bs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
          {bs.map(b => (
            <span key={b} className="whitespace-nowrap"><span className="font-semibold text-ink">{b}</span> <span className="text-muted">{byB[b].map(x => x.name + (x.kind === 'heading' ? ' →' : '')).join(', ')}</span></span>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[12px] text-muted">Where people probably are: a task in progress puts them in that unit; otherwise their last finish and their next task. → means heading there.</p>
    </div>
  )
}

export function TeamRow({ p, lane }: { p: TeamRowT; lane?: string }) {
  // OPEN A PERSON, SEE THEIR DAY (Jon, 2026-10-01: "Balance does not make sense… it should be a
  // drop-down so I can see all of their tasks for each user… organized by departure cleans,
  // inspections, maintenance, miscellaneous"). "Balance" was only a link to the Today board. Now
  // the row opens in place to the person's tasks in those four groups — every group always shown,
  // "none today" when empty — and the Board link lives inside, where moving work actually happens.
  const [open, setOpen] = useState(false)
  const over = p.utilisationPct > 100
  const tasks = p.tasks || []
  const idle = tasks.length === 0 && p.cleans + p.otherTasks === 0
  // WHERE THEY PROBABLY ARE (Jon, 2026-10-05) — lib/team-where, the same read the strip above uses.
  const where = whereNow(tasks, new Date(), p.clock)
  const ck = clockTag(p.clock, p.shiftStartMin)
  const GROUPS: { key: PersonTaskGroup; label: string }[] = [
    { key: 'clean', label: 'Departure cleans' }, { key: 'inspection', label: 'Inspections' },
    { key: 'maintenance', label: 'Maintenance' }, { key: 'misc', label: 'Miscellaneous' },
  ]
  const count = (g: PersonTaskGroup) => tasks.filter(t => t.group === g).length
  const summary = GROUPS.map(g => count(g.key) ? count(g.key) + ' ' + (g.key === 'clean' ? 'cleans' : g.key === 'inspection' ? 'inspections' : g.key === 'maintenance' ? 'maintenance' : 'misc') : '').filter(Boolean).join(' · ')
  const doing = tasks.filter(t => t.status === 'doing').length
  const timeLine = p.capacityMinutes > 0 ? hm(p.loadMinutes) + ' of work in a ' + hm(p.capacityMinutes) + ' shift' : hm(p.loadMinutes) + ' of work · no shift on record'
  return (
    <Row lane={lane} noteKey={'team:' + p.person} dot={over || where.tone === 'amber' || ck?.tone === 'amber' ? 'amber' : null} title={p.person}
      tags={<>
        {ck && <Tag tone={ck.tone} title={ck.title}>{ck.label}</Tag>}
        {over ? <Tag tone="amber" title={hm(p.loadMinutes - p.capacityMinutes) + ' more work than hours'}>{p.utilisationPct}% loaded</Tag> : <Tag tone="sky" title={hm(Math.max(0, p.capacityMinutes - p.loadMinutes)) + ' free today'}>{idle ? 'nothing assigned' : hm(Math.max(0, p.capacityMinutes - p.loadMinutes)) + ' free'}</Tag>}
      </>}
      meta={[where.line, p.role, doing ? doing + ' in progress' : '', summary || (idle ? '' : (p.cleans ? p.cleans + ' cleans' : '') + (p.otherTasks ? ' · ' + p.otherTasks + ' tasks' : '')), timeLine].filter(Boolean).join(' · ')}
      actions={<button type="button" onClick={() => setOpen(o => !o)} className={GHOST} aria-expanded={open} title={open ? 'Close this person’s tasks' : 'Open this person’s tasks, grouped by kind'}>{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>}>
      {open && (
        <div className="mt-2 pl-3.5 space-y-2.5">
          {GROUPS.map(g => {
            const rows = tasks.filter(t => t.group === g.key)
            return (
              <div key={g.key}>
                <div className="flex items-baseline gap-2 text-[10.5px] uppercase tracking-[0.12em] font-bold text-muted">{g.label}<span className="normal-case tracking-normal font-medium">{rows.length}</span></div>
                {rows.length === 0 ? <p className="text-[12px] text-muted/70 py-1">none today</p> : (
                  <div className="divide-y divide-line/70">
                    {rows.map(t => (
                      <div key={t.id} className="flex items-center gap-2 min-h-[36px] py-1 min-w-0">
                        <span aria-hidden className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (t.status === 'done' ? 'bg-emerald-500' : t.status === 'doing' ? 'bg-sky-500' : 'bg-muted/40')} />
                        <span className="text-[12.5px] font-semibold text-ink truncate">{t.unit}</span>
                        <span className="text-[12px] text-muted truncate flex-1 min-w-0">{g.key === 'clean' ? '' : t.name + ' · '}{t.status === 'done' ? 'done' + (t.minutes ? ' · ' + hm(t.minutes) : '') : t.status === 'doing' ? '' : 'not started'}</span>
                        {t.status === 'doing' ? <Tag tone="sky" title={t.startedAt ? 'Started ' + new Date(t.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : 'Started in Breezeway'}>in progress</Tag> : null}
                        <Link href={'/plan?unit=' + encodeURIComponent(t.unit)} prefetch={false} className={GHOST} title="Open this unit on the Today board to move or finish the work">Board</Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Row>
  )
}

export function ApprovalRow({ row, onCleared, onChanged, lane }: { row: GuestDeskRow; onCleared: (k: string) => void; onChanged: () => void; lane?: string }) {
  const id = row.key.replace(/^ap:/, '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const decide = async (approved: boolean) => {
    setBusy(true); setErr('')
    try {
      await post('/api/requests/update', { action: 'decide', id, approved })
      await clearRow({ key: row.key, title: (approved ? 'Approved: ' : 'Rejected: ') + row.text, unit: row.unit }, 'done').catch(() => {})
      onCleared(row.key); onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <Row lane={lane} noteKey={row.key} dot="amber" title={row.who + (row.unit ? ' · ' + row.unit : '')} tags={<Tag tone="amber" title="A spend waiting on your approval">spend</Tag>} meta={row.text + (row.meta ? ' · ' + row.meta : '')} err={err}
      actions={<>
        <button onClick={() => decide(true)} disabled={busy} className={DARK} title="Approve the spend">{busy ? <Loader2 size={12} className="animate-spin" /> : <ClipboardCheck size={12} />} Approve</button>
        <button onClick={() => decide(false)} disabled={busy} className={GHOST} title="Reject the spend"><X size={12} /></button>
      </>} />
  )
}

/** A decision made one tap away — a claim to review, a refund over the cap, a short-staffed day. */
function NeedsRow({ i, tag, tone, hover, clear, clearTitle, onCleared, lane }: { i: NextItem; tag: string; tone: Tone; hover: string; clear: 'done' | 'skipped'; clearTitle: string; onCleared: (k: string) => void; lane?: string }) {
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await clearRow(i, clear); onCleared(i.key) } catch { /* shown on reload */ } setBusy(false) }
  return (
    <Row lane={lane} noteKey={i.key} dot={i.severity === 'now' ? 'rose' : 'amber'} title={i.unit && i.unit !== 'Unit' ? i.unit + ' — ' + i.title : i.title}
      tags={<Tag tone={tone} title={hover}>{tag}</Tag>} meta={i.why + (i.due ? ' · ' + i.due : '')}
      actions={<>
        <Link href={i.href || (i.action?.type === 'open' ? i.action.href : '/')} prefetch={false} className={DARK}>{i.action?.type === 'open' ? i.action.label : 'Open'}</Link>
        <button onClick={go} disabled={busy} className={GHOST} title={clearTitle}>{clear === 'done' ? <Check size={12} /> : <X size={12} />}</button>
      </>} />
  )
}

/** CHANNEL FAILURES AS ONE ROW (2026-10-01, visual pass): five "Failed on Vrbo" rows were the whole
 *  Admin lane and half of Now. One row carries the count and the units; it opens to the rows. */
function ChannelGroupRow({ items, onCleared, lane }: { items: NextItem[]; onCleared: (k: string) => void; lane?: string }) {
  const [open, setOpen] = useState(false)
  if (items.length === 1) return <NeedsRow i={items[0]} tag="channel" tone="rose" hover="Unbookable on that channel until someone reconnects it" clear="done" clearTitle="Reconnected" onCleared={onCleared} lane={lane} />
  const byChan: Record<string, number> = {}
  for (const i of items) { const m = /on (.+)$/.exec(i.title); const c = (m ? m[1] : 'a channel').split(' +')[0]; byChan[c] = (byChan[c] || 0) + 1 }
  const units = items.map(i => i.unit).filter(Boolean)
  return (
    <div>
      <Row lane={lane} noteKey={'channel-group'} dot="amber" title={items.length + ' listings failed on a channel'}
        tags={<>{Object.keys(byChan).map(c => <Tag key={c} tone="rose" title={'Listings Guesty reports failed on ' + c}>{c} ×{byChan[c]}</Tag>)}</>}
        meta={units.slice(0, 4).join(', ') + (units.length > 4 ? ' +' + (units.length - 4) : '') + ' · unbookable there until reconnected'}
        actions={<>
          <Link href="/channels?problems=1" prefetch={false} className={DARK}>Open channels</Link>
          <button onClick={() => setOpen(o => !o)} className={GHOST} title={open ? 'Hide the listings' : 'Show each listing'}>{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {items.length}</button>
        </>} />
      {open && <div className="pl-5 border-t border-line divide-y divide-line bg-app/40">
        {items.map(i => <div key={i.key}><NeedsRow i={i} tag="channel" tone="rose" hover="Unbookable on that channel until someone reconnects it" clear="done" clearTitle="Reconnected" onCleared={onCleared} /></div>)}
      </div>}
    </div>
  )
}

/** A task nobody is on, a targeted look after guest feedback, backlog in a unit — the engine's own rows. */
function NextRow({ i, roster, canAssign, canCreate, onCleared, onChanged, lane }: { i: NextItem; roster: Roster[]; canAssign: boolean; canCreate: boolean; onCleared: (k: string) => void; onChanged: () => void; lane?: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const a = i.action
  const create = async () => {
    if (!a || a.type !== 'create_task') return
    setBusy('create'); setErr('')
    try { await post('/api/ops-today/add-task', a.payload); await clearRow(i, 'done').catch(() => {}); onCleared(i.key); onChanged() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const done = async () => { setBusy('done'); try { await clearRow(i, 'done'); onCleared(i.key) } catch { /* reload shows it */ } setBusy('') }
  return (
    <Row lane={lane} noteKey={i.key} dot={i.severity === 'now' ? 'rose' : i.severity === 'today' ? 'amber' : null} title={i.unit + ' — ' + i.title} meta={i.why} err={err}
      tags={<>{(i.tags || []).map(t => <Tag key={t.label} tone={t.tone} title={t.title}>{t.label}</Tag>)}</>}
      actions={<>
        {a?.type === 'assign' && canAssign && <button onClick={() => setOpen(o => !o)} className={DARK} title="Pick who does it"><UserPlus size={12} /> Assign</button>}
        {a?.type === 'create_task' && canCreate && <button onClick={create} disabled={!!busy} className={DARK} title={a.payload.title}>{busy === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {a.label}</button>}
        {a?.type === 'open' && <a href={a.href} target={a.external ? '_blank' : undefined} rel="noreferrer" className={GHOST}>{a.label}</a>}
        {i.bzTaskId && a?.type !== 'open' && <a href={bz(i.bzTaskId)} target="_blank" rel="noreferrer" className={GHOST} title="Open the task in Breezeway"><ExternalLink size={12} /></a>}
        <button onClick={done} disabled={!!busy} className={GHOST} title="Handled — take it off the list for today">{busy === 'done' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}</button>
      </>}>
      {open && a?.type === 'assign' && <InlineAssign taskId={a.taskId} dept={a.dept} roster={roster} onDone={() => { setOpen(false); onChanged() }} />}
    </Row>
  )
}

type CkRow = { id: string; title: string; band: string; by_time: string | null; done: boolean; late: boolean; link: string | null; in_minutes?: number | null; owner_role?: string | null; signal?: string | null; auto?: boolean; count?: number | null; done_by?: string | null }
type Ck = { ok: boolean; rows: CkRow[]; progress: { total: number; done: number; late: number; pct: number }; canTick: boolean; signals?: Record<string, number | null> }
const CK_URL = '/api/daily-checklist'
const hm12 = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t); if (!m) return t; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}` }
const ckFirst = (s: string) => String(s || '').split(/[\s@]/)[0]

/**
 * ONE CHECKLIST ROW ON TODAY. The smart kind (Jon, 2026-10-01): a row tied to a live count carries
 * the count ("2 unpaid", "4 to answer") and ticks ITSELF when the count reaches zero — "auto". A row
 * someone ticked while the count is still above zero stays ticked (their name on it) but keeps the
 * count in view, so a tick never hides live work. Plain reminders are a title, a time, Open and Done.
 */
function ChecklistRow({ r, canTick, onTicked, lane }: { r: CkRow; canTick: boolean; onTicked: () => void; lane?: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const tick = async (done: boolean) => { setBusy(true); setErr(''); try { await post(CK_URL, { action: 'tick', itemId: r.id, done }); onTicked() } catch (e: any) { setErr(String(e?.message || e)) } setBusy(false) }
  const countTxt = r.signal && r.count != null ? signalLabel(r.signal, r.count) : ''
  const due = r.by_time ? 'by ' + hm12(r.by_time) : r.band
  return (
    <Row lane={lane} noteKey={'ck:' + r.id} dot={r.done ? null : r.late ? 'rose' : null}
      title={<span className={'inline-flex items-center gap-1.5 ' + (r.done ? 'text-muted line-through decoration-muted/50' : '')}>{r.done ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0" /> : <Circle size={14} className={'shrink-0 ' + (r.late ? 'text-rose-500' : 'text-muted/50')} />}{r.title}</span>}
      tags={<>
        {countTxt && <Tag tone={r.count ? (r.late ? 'rose' : 'amber') : 'emerald'} title="Live count from the app — this is what is left to do">{countTxt}</Tag>}
        {r.done && r.auto && <Tag tone="emerald" title="Ticked itself: nothing left to count">auto</Tag>}
        {r.done && !r.auto && r.done_by && <Tag tone="slate" title="Ticked by hand">{ckFirst(r.done_by)}</Tag>}
        {!r.done && r.late && <Tag tone="rose" title="Past its time">late</Tag>}
        {r.owner_role && !r.done && <Tag title="Who does it">{r.owner_role}</Tag>}
      </>}
      meta={r.done ? undefined : due} err={err}
      actions={<>
        {r.link && !r.done && <Link href={r.link} prefetch={false} className={GHOST} title="Open where this gets done">Open</Link>}
        {canTick && !r.done ? <button onClick={() => tick(true)} disabled={busy} className={DARK} title="Done — ticks it with your name">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button> : null}
        {canTick && r.done && !r.auto ? <button onClick={() => tick(false)} disabled={busy} className={GHOST} title="Put it back on the list">{busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}</button> : null}
      </>} />
  )
}

// THE SMART CHECKLIST ON TODAY (Jon, 2026-10-01: "a reminder to complete certain tasks … if they're
// already completed, they should be auto-marked complete … dynamic, not static"). Every open item,
// late first then by time, each with its live count; the done ones (auto or by hand) fold under one
// line. Holds its spot before the read lands and when nothing is scheduled.
// A DROPDOWN, PENDING-BY-TIME (Jon, 2026-10-02: "make checklist dropdown and show the pending ones
// only based on time"). Collapsed — the default — it shows only what is pending NOW: late items and
// items due inside the next two hours (an untimed item counts once its part of the day has begun).
// The header is the toggle; open, it adds the rest of today in time order and the done ones.
const NOW_WINDOW_MIN = 120
const BAND_START: Record<string, number> = { morning: 0, midday: 11 * 60, afternoon: 14 * 60, evening: 17 * 60 }
function ChecklistStrip({ ck, onTicked }: { ck: Ck | undefined; onTicked: () => void }) {
  const [open, setOpen] = useState(false)
  const head = (txt: ReactNode, right?: ReactNode, toggle?: boolean) => (
    <h2 className="px-1 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink flex items-center gap-2 flex-wrap">
      {toggle
        ? <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 hover:text-brand-700" title={open ? 'Show only what is pending now' : 'Show the whole day'}><ListChecks size={13} className="text-brand-600" /> Checklist {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
        : <><ListChecks size={13} className="text-brand-600" /> Checklist</>}
      <span className="normal-case tracking-normal font-medium text-muted">— {txt}</span>
      <span className="ml-auto inline-flex items-center gap-2">{right}<Link href="/checklist" prefetch={false} className="text-[11px] font-semibold text-brand-700 hover:underline">Checklist →</Link></span>
    </h2>
  )
  if (!ck || !ck.ok || !ck.progress?.total) return <section>{head(!ck ? 'reading…' : ck.ok ? 'nothing scheduled today' : 'could not read the checklist')}</section>
  const nowMin = (() => { const d = new Date(); const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(d); const h = Number(et.find(x => x.type === 'hour')?.value || 0) % 24, m = Number(et.find(x => x.type === 'minute')?.value || 0); return h * 60 + m })()
  const pending = ck.rows.filter(r => !r.done)
  const isNow = (r: CkRow) => r.late || (r.in_minutes != null ? r.in_minutes <= NOW_WINDOW_MIN : nowMin >= (BAND_START[r.band] ?? 0))
  const byTime = (a: CkRow, b: CkRow) => (a.in_minutes ?? 9e9) - (b.in_minutes ?? 9e9)
  const now = pending.filter(isNow).sort((a, b) => (Number(b.late) - Number(a.late)) || byTime(a, b))
  const later = pending.filter(r => !isNow(r)).sort(byTime)
  const late = now.filter(r => r.late).length
  const done = ck.rows.filter(r => r.done)
  const auto = done.filter(r => r.auto).length
  const p = ck.progress
  const txt = now.length
    ? (late ? `${late} late · ` : '') + `${now.length} pending now` + (later.length ? ` · ${later.length} later today` : '')
    : later.length ? `nothing due right now · ${later.length} later today` : `everything done${auto ? ` · ${auto} ticked by itself` : ''}`
  return (
    <section>
      {head(txt, <>
        <span className="w-16 h-1.5 rounded-full bg-line overflow-hidden"><span className={'block h-full ' + (p.late ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: p.pct + '%' }} /></span>
        <span className={'text-[11px] font-semibold tabular-nums ' + (p.late ? 'text-amber-700' : 'text-emerald-700')}>{p.done}/{p.total}</span>
      </>, true)}
      {(now.length > 0 || open) && (
        <div className={LIST}>
          {now.map(r => <div key={'cks:' + r.id}><ChecklistRow r={r} canTick={!!ck.canTick} onTicked={onTicked} /></div>)}
          {open && later.length > 0 && <div className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted bg-app/60">Later today · {later.length}</div>}
          {open && later.map(r => <div key={'ckl:' + r.id}><ChecklistRow r={r} canTick={!!ck.canTick} onTicked={onTicked} /></div>)}
          {open && done.length > 0 && <div className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted bg-app/60">Done · {done.length}{auto ? ` · ${auto} by itself` : ''}</div>}
          {open && done.map(r => <div key={'ckd:' + r.id}><ChecklistRow r={r} canTick={!!ck.canTick} onTicked={onTicked} /></div>)}
          {!open && (later.length > 0 || done.length > 0) && (
            <button onClick={() => setOpen(true)} className="w-full text-left px-3 py-2 text-[12px] font-semibold text-muted hover:bg-app inline-flex items-center gap-1" title="Show the whole day">
              <ChevronDown size={13} /> {[later.length ? `${later.length} later today` : '', done.length ? `${done.length} done` : ''].filter(Boolean).join(' · ')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

type OptimizeDue = { id: string; name: string; building: string; lastOptimized: string | null; days: number | null }
const OPTIMIZE_URL = '/api/command/optimize-due'
/** A listing past its optimization cadence (six months) or never optimized. Opens the listing engine. */
function OptimizeRow({ o, lane }: { o: OptimizeDue; lane?: string }) {
  const months = o.days == null ? null : Math.floor(o.days / 30)
  return (
    <Row lane={lane} noteKey={'opt:' + o.id} dot={o.days == null ? 'amber' : null} title={o.name}
      tags={o.days == null ? <Tag tone="amber" title="No optimization on record">never optimized</Tag> : <Tag tone="slate" title={'Last optimized ' + o.lastOptimized}>{months} months ago</Tag>}
      meta={(o.building ? o.building + ' · ' : '') + 'optimize every 6 months — copy, photos, hero'}
      actions={<Link href={'/listings/' + encodeURIComponent(o.id)} prefetch={false} className={DARK} title="Open the listing — Recreate, photo order, hero"><Sparkles size={12} /> Optimize</Link>} />
  )
}

function MineRow({ it, late, pending, onChanged, lane }: { it: MineItem; late: boolean; pending?: boolean; onChanged: () => void; lane?: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const done = async () => { setBusy(true); setErr(''); try { await post('/api/projects/' + it.projectId, { action: 'taskSet', taskId: it.id, status: 'done' }); onChanged() } catch (e: any) { setErr(String(e?.message || e)) } setBusy(false) }
  return (
    <Row lane={lane} noteKey={'mine:' + it.id} dot={late ? 'rose' : null} title={it.title}
      tags={<>{late ? <Tag tone="rose" title={'Was due ' + (it.due || '')}>overdue</Tag> : it.due ? <Tag tone={pending ? 'slate' : 'amber'} title="Due date">{pending ? 'due ' : ''}{String(it.due).slice(5)}</Tag> : pending ? <Tag tone="slate" title="No date on it">pending</Tag> : null}{it.status === 'doing' && <Tag tone="sky" title="In progress">doing</Tag>}{it.status === 'blocked' && <Tag tone="rose" title="Blocked">blocked</Tag>}</>}
      meta={it.project} err={err}
      actions={<>
        <button onClick={done} disabled={busy} className={GHOST} title="Mark done">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button>
        <Link href={'/projects/' + it.projectId} prefetch={false} className={GHOST} title="Open the project">Open</Link>
      </>} />
  )
}

type FixAction = { listingId: string; listing: string; building: string; severity: string; title: string; action: string; gain: number; key: string }
function FixRow({ a, lane }: { a: FixAction; lane?: string }) {
  return (
    <Row lane={lane} noteKey={'fix:' + a.listingId} dot={a.severity === 'critical' ? 'rose' : a.severity === 'high' ? 'amber' : null} title={a.listing}
      tags={<Tag tone={a.severity === 'critical' ? 'rose' : a.severity === 'high' ? 'amber' : 'slate'} title={a.action}>{a.title}</Tag>} meta={a.action}
      actions={<Link href={'/listings/' + encodeURIComponent(a.listingId)} prefetch={false} className={GHOST} title="Open the unit page: fixes, optimizer, photos and copy">Optimize</Link>} />
  )
}

// ── KPI tiles ───────────────────────────────────────────────────────────────────────────────────
type Kpi = { key: string; area: Area; label: string; short?: string; value: string; sub: string; tone: Tone; title: string }
function KpiTiles({ kpis, focus, onFocus }: { kpis: Kpi[]; focus: Area | null; onFocus: (a: Area | null) => void }) {
  const VAL: Record<string, string> = { rose: 'text-rose-700', amber: 'text-amber-700', emerald: 'text-emerald-700', slate: 'text-ink', sky: 'text-sky-700', violet: 'text-violet-700', brand: 'text-brand-700', roseSolid: 'text-rose-700' }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {kpis.map(k => {
        const on = focus === k.area
        return (
          <button key={k.key} onClick={() => onFocus(on ? null : k.area)} title={k.title + (on ? ' — click to show every lane again' : ' — click to focus on ' + AREA[k.area].label)} aria-pressed={on}
            className={'text-left rounded-xl border bg-white px-3 py-2 min-h-[64px] transition ' + (on ? 'border-brand-400 ring-2 ring-brand-100' : 'border-line hover:border-ink/30')}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-bold text-muted truncate"><span className="sm:hidden">{k.short || k.label}</span><span className="hidden sm:inline">{k.label}</span></span>
              <span className="hidden sm:inline text-[9.5px] uppercase tracking-wider font-bold text-muted/50">{AREA[k.area].short}</span>
            </div>
            <div className={'text-[20px] leading-tight font-bold tabular-nums ' + (VAL[k.tone] || 'text-ink')}>{k.value}</div>
            <div className="text-[11px] text-muted truncate" title={k.sub}>{k.sub || ' '}</div>
          </button>
        )
      })}
    </div>
  )
}

// ── unpaid balances (Jon, 2026-10-01: "update the today board … the items that need to be managed") ──
// A direct / VRBO / Google guest who still owes money: inside the unit or arriving today it is a Now
// item; the next seven days sit in the Admin lane. One button marks the guest contacted; the board
// holds the rest (promised / disputed / waived, notes).
export type UnpaidHubRow = {
  id: string; unit: string; guest: string; phone: string | null; checkIn: string; checkOut: string; source: string
  total: number; paid: number; balance: number; daysUntil: number; bucket: 'in_house' | 'today' | 'week' | 'later'
  guestyUrl: string; tracking: { status: string; notes: { at: string; by: string; text: string }[]; updatedBy: string | null }
}
const UNPAID_CH: Record<string, string> = { vrbo: 'VRBO', homeaway: 'VRBO', manual: 'Direct', direct: 'Direct', 'be-api': 'Website', website: 'Website', google: 'Google' }
const UNPAID_ST: Record<string, { label: string; tone: Tone }> = { contacted: { label: 'contacted', tone: 'sky' }, promised: { label: 'promised', tone: 'amber' }, disputed: { label: 'disputed', tone: 'rose' }, waived: { label: 'waived', tone: 'violet' } }
export function UnpaidRow({ r, canEdit, onChanged, lane }: { r: UnpaidHubRow; canEdit: boolean; onChanged: () => void; lane?: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [st, setSt] = useState(r.tracking.status)
  const mark = async () => {
    setBusy(true); setErr('')
    try { await post(UNPAID_URL, { reservationId: r.id, status: 'contacted' }); setSt('contacted'); onChanged() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const when = r.bucket === 'in_house' ? 'in the unit · out ' + r.checkOut.slice(5).replace('-', '/') : r.bucket === 'today' ? 'arrives today' : 'arrives in ' + r.daysUntil + 'd · ' + r.checkIn.slice(5).replace('-', '/')
  const s = UNPAID_ST[st]
  return (
    <Row lane={lane} noteKey={'unpaid:' + r.id} dot={r.bucket === 'in_house' || r.bucket === 'today' ? 'rose' : 'amber'} title={r.unit + ' — ' + r.guest}
      tags={<>
        <Tag tone="rose" title={'Owed · paid ' + money(r.paid) + ' of ' + money(r.total)}>{money(r.balance)} owed</Tag>
        <Tag tone="slate" title={'Booked on ' + (r.source || '—') + ' — we collect'}>{UNPAID_CH[String(r.source || '').toLowerCase()] || r.source || '—'}</Tag>
        {s && <Tag tone={s.tone} title={'Follow-up' + (r.tracking.updatedBy ? ' · ' + r.tracking.updatedBy : '')}>{s.label}</Tag>}
      </>}
      meta={when + (r.paid > 0 ? '' : ' · nothing paid')} err={err}
      actions={<>
        {r.phone && <a href={'tel:' + r.phone} className={GHOST} title={'Call ' + r.phone}><Phone size={12} /> Call</a>}
        {canEdit && !s && <button onClick={mark} disabled={busy} className={DARK} title="Marks the guest contacted on the unpaid board (Guesty is not written)">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Contacted</button>}
        <Link href="/reservations/unpaid" prefetch={false} className={GHOST} title="The unpaid board — statuses and notes"><ExternalLink size={12} /> Board</Link>
      </>} />
  )
}

// ── a lane ──────────────────────────────────────────────────────────────────────────────────────
function Lane({ area, items, focused, empty, right }: { area: Area; items: HubItem[]; focused: boolean; empty: string; right?: ReactNode }) {
  const A = AREA[area]
  const [sub, setSub] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => { if (focused) setAll(true) }, [focused])
  const subs = useMemo(() => {
    const n: Record<string, number> = {}
    for (const it of items) if (it.key !== 'team:where') n[it.sub] = (n[it.sub] || 0) + 1
    return Object.keys(n).sort((a, b) => SUB_ORDER.indexOf(a) - SUB_ORDER.indexOf(b)).map(k => ({ key: k, n: n[k] }))
  }, [items])
  const pick = sub && subs.some(s => s.key === sub) ? sub : null
  const list = (pick ? items.filter(i => i.sub === pick) : items.filter(i => i.key !== 'team:where')).slice().sort((a, b) => b.score - a.score)
  const shown = all ? list : list.slice(0, LANE_ROWS)
  const hidden = list.length - shown.length
  return (
    <section id={'lane-' + area} className="scroll-mt-4 min-w-0">
      <div className="px-1 mb-1.5 flex items-center gap-2 flex-wrap">
        <button onClick={() => setAll(a => !a)} aria-expanded={all} className="text-[11px] font-bold uppercase tracking-wider text-ink inline-flex items-center gap-1.5 hover:text-brand-700" title={A.blurb + (all ? ' — click to show fewer' : ' — click to open the whole list')}><A.Icon size={13} className="text-brand-600" /> {A.label} {list.length > LANE_ROWS ? (all ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}</button>
        {items.length ? <span className="text-[11px] font-bold tabular-nums text-muted">{items.length}</span> : <span className="text-[11px] text-muted">— {empty}</span>}
        {right}
        <Link href={A.href} prefetch={false} className="ml-auto text-[11px] font-semibold text-brand-700 hover:underline" title={'Open ' + A.hrefLabel}>{A.hrefLabel} →</Link>
      </div>
      {subs.length > 1 && (
        <div className="px-1 mb-1.5 flex items-center gap-1 flex-wrap" role="group" aria-label={A.label + ' filters'}>
          <button onClick={() => setSub(null)} aria-pressed={!pick} className={'lh-tab text-[11px] font-semibold px-2 py-0.5 rounded-full border ' + (!pick ? 'lh-tab-on bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')} title="Every row in this lane">All</button>
          {subs.map(s => <button key={s.key} onClick={() => setSub(pick === s.key ? null : s.key)} aria-pressed={pick === s.key} title={'Only ' + s.key.toLowerCase()}
            className={'lh-tab text-[11px] font-semibold px-2 py-0.5 rounded-full border tabular-nums ' + (pick === s.key ? 'lh-tab-on bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{s.key} {s.n}</button>)}
        </div>
      )}
      {list.length > 0 && (
        <div className={LIST}>
          {shown.map(i => <div key={i.key}>{i.node}</div>)}
          {hidden > 0 && <button onClick={() => setAll(true)} className="w-full text-left px-3 py-2 text-[12px] font-semibold text-brand-700 hover:bg-app inline-flex items-center gap-1"><ChevronDown size={13} /> {hidden} more</button>}
          {all && list.length > LANE_ROWS && !focused && <button onClick={() => setAll(false)} className="w-full text-left px-3 py-2 text-[12px] font-semibold text-muted hover:bg-app inline-flex items-center gap-1"><ChevronUp size={13} /> Show fewer</button>}
        </div>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function CommandHub({ d, live, roster, fixRows, claims, links, approvals, onCleared, onChanged }: {
  d: CommandDay; live: NextItem[]; roster: Roster[]; fixRows: NextItem[]; claims: NextItem[]; links: NextItem[]; approvals: GuestDeskRow[]
  onCleared: (key: string) => void; onChanged: () => void
}) {
  const acc = useAccess()
  const can = { assign: acc.atLeast('schedule', 'edit'), plan: acc.atLeast('plan', 'edit'), calls: acc.atLeast('welcome-calls', 'edit'), glitches: acc.atLeast('glitches', 'edit'), reviews: acc.atLeast('reviews', 'edit'), unpaid: acc.atLeast('reservations', 'edit') }
  const [focus, setFocus] = useState<Area | null>(null)
  // EVERY SECTION OPENS FULLY FROM ITS TITLE (Jon, 2026-10-02: "if you click on any of the specifics, it should open up fully").
  const [nowOpen, setNowOpen] = useState(false)
  useEffect(() => { if (focus) document.getElementById('lane-' + focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [focus])

  // The other reads. Each fails soft: a 403 hides its rows, an error leaves the lane to the rest.
  const reviewsQ = useCachedFetch<{ reviews: Review[] }>(REVIEWS_URL, { ttl: 120_000 })
  const ckQ = useCachedFetch<Ck>(CK_URL, { ttl: 60_000 })
  const mineQ = useCachedFetch<Mine>(MINE_URL, { ttl: 60_000 })
  const fixQ = useCachedFetch<{ actions?: FixAction[] }>('/api/listing-health?slim=1', { ttl: 10 * 60_000 })
  const optQ = useCachedFetch<{ rows?: OptimizeDue[]; due?: number }>(OPTIMIZE_URL, { ttl: 30 * 60_000 })
  const optimizeRows = (optQ.data?.rows || []).slice(0, 6)
  const optimizeDue = Number(optQ.data?.due) || 0
  const weekQ = useCachedFetch<{ tiles?: { key: string; value: string; sub: string }[] }>(SCOREBOARD_URL, { ttl: 5 * 60_000 })
  // Notes on every row — one read, added to in place (Jon, 2026-10-01).
  const notesQ = useCachedFetch<{ byKey?: Record<string, DayNote[]> }>(NOTES_URL, { ttl: 60_000 })
  const [addedNotes, setAddedNotes] = useState<Record<string, DayNote[]>>({})
  const notesCtx = useMemo(() => {
    const byKey: Record<string, DayNote[]> = {}
    const base = notesQ.data?.byKey || {}
    for (const k of Object.keys(base)) byKey[k] = base[k]
    for (const k of Object.keys(addedNotes)) byKey[k] = [...addedNotes[k], ...(byKey[k] || [])]
    return {
      byKey, ready: !!notesQ.data,
      add: async (key: string, text: string) => {
        const j = await post(NOTES_URL, { key, text })
        setAddedNotes(a => ({ ...a, [key]: [j.note as DayNote, ...(a[key] || [])] }))
        invalidateCache(NOTES_URL)
      },
    }
  }, [notesQ.data, addedNotes])
  const [goneReviews, setGoneReviews] = useState<Record<string, true>>({})
  const reloadReviews = () => { invalidateCache(REVIEWS_URL); reviewsQ.refresh() }
  const reloadCk = () => { invalidateCache(CK_URL); ckQ.refresh() }
  const reloadMine = () => { invalidateCache(MINE_URL); mineQ.refresh() }
  const week = (key: string) => (weekQ.data?.tiles || []).find(t => t.key === key) || null

  const t = d.tiles
  // The arriving booking's value per unit today, so a clean or an inspection can be ranked by the money on it.
  const valueByUnit: Record<string, number> = {}
  for (const a of t.arrivals.rows) if (a.today) valueByUnit[a.unit] = Math.max(valueByUnit[a.unit] || 0, a.value)
  const bigUnitsSoon = new Set(t.arrivals.rows.filter(a => a.big && (a.today || a.checkIn <= tomorrowOf(d.today))).map(a => a.unit))

  // ── OPERATIONS ──
  const cleans = t.cleans.rows.filter(c => c.status in CLEAN_ST)
  const inspTasks = t.tasks.rows.filter(x => x.dept === 'inspection' || INSPECT.test(x.name))
  const arrivalsInsp = t.arrivals.rows.filter(a => a.inspection !== 'n/a' && a.big && (a.today || a.checkIn <= tomorrowOf(d.today)))
  const teamRows = t.team.rows.filter(r => r.utilisationPct > 100 || (r.cleans + r.otherTasks === 0 && r.capacityMinutes > 0))
  const otherFix = fixRows.filter(i => i.kind !== 'inspection' && i.kind !== 'channel')
  const createFor = (resId: string) => live.find(i => i.key === 'insp:' + resId && i.action?.type === 'create_task') || null

  // ── GUESTS ──
  const calls = t.arrivals.rows.filter(a => a.today && !a.welcomeDone)
  const inbox = live.filter(i => i.kind === 'guest')
  const unhappy = inbox.filter(i => (i.tags || []).some(x => x.label === 'Unhappy'))
  const lateReplies = inbox.filter(i => (i.tags || []).some(x => /^Late/.test(x.label)))
  const glitches = t.glitches.rows

  // ── REVIEWS ──
  const reviews = (reviewsQ.data?.reviews || []).filter(r => !r.hasReply && !r.dismissed && !r.removed && !goneReviews[r.id])
  const lowReviews = reviews.filter(r => { const s = five(r.rating, r.channel); return s != null && s <= 3 })
  const avg30 = (() => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const xs = (reviewsQ.data?.reviews || []).filter(r => !r.removed && r.created_at >= since).map(r => five(r.rating, r.channel)).filter((x): x is number => x != null)
    return xs.length ? { avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, n: xs.length } : null
  })()

  // ── ADMIN ──
  const ck = ckQ.data
  const mine = mineQ.data?.groups
  // YOURS = everything with your name on it, not only today (Jon, 2026-10-01: "pending projects …
  // user-assigned tasks"): overdue, today, this week, then the rest of the open ones (capped at 8).
  const mineRows: { it: MineItem; late: boolean; score: number; pending?: boolean }[] = mine ? [
    ...mine.overdue.map(x => ({ it: x, late: true, score: 48 })),
    ...mine.today.map(x => ({ it: x, late: false, score: 35 })),
    ...(mine.week || []).map(x => ({ it: x, late: false, score: 28, pending: true })),
    ...[...(mine.later || []), ...(mine.someday || [])].slice(0, 8).map(x => ({ it: x, late: false, score: 18, pending: true })),
  ] : []
  const channel = live.filter(i => i.kind === 'channel')
  const seenFix: Record<string, true> = {}
  const fixes = (fixQ.data?.actions || []).filter(a => (seenFix[a.listingId] ? false : (seenFix[a.listingId] = true))).slice(0, 6)
  const NEEDS: Record<string, { tag: string; tone: Tone; hover: string; clear: 'done' | 'skipped'; clearTitle: string; score: number }> = {
    claim: { tag: 'claim', tone: 'amber', hover: 'A damage claim in your review or near its filing deadline', clear: 'done', clearTitle: 'Handled', score: 68 },
    refund: { tag: 'refund', tone: 'violet', hover: 'A refund over the cap — Approve or Reject it on the glitch card', clear: 'skipped', clearTitle: 'Not today — hide it until tomorrow', score: 74 },
    staffing: { tag: 'staffing', tone: 'amber', hover: 'The 14-day staffing forecast says a day 1–3 days out is short', clear: 'done', clearTitle: 'Handled — somebody is covering it', score: 62 },
  }

  // ── the items, scored (high-ticket first: the money on the booking adds up to 10) ──
  const items: HubItem[] = []
  for (const c of cleans) {
    const v = valueByUnit[c.unit] || 0
    const base = c.status === 'late' ? 90 : c.status === 'atRisk' ? 75 : !c.who ? 70 : c.status === 'open' ? 40 : 20
    items.push({ key: 'clean:' + c.taskId, area: 'ops', sub: 'Cleans', score: base + valueBonus(v) + (c.sameDay ? 3 : 0), node: <CleanRow c={c} value={v} roster={roster} canAssign={can.assign} onChanged={onChanged} /> })
  }
  for (const x of inspTasks) {
    const big = bigUnitsSoon.has(x.unit)
    const base = x.state === 'done' ? 8 : !x.who ? 72 : x.late ? 68 : x.state === 'running' ? 30 : 45
    items.push({ key: 'insp:' + x.taskId, area: 'ops', sub: 'Inspections', score: base + (big ? 8 : 0) + valueBonus(valueByUnit[x.unit] || 0), node: <InspectionTaskRow t={x} big={big} roster={roster} canAssign={can.plan} onChanged={onChanged} /> })
  }
  for (const a of arrivalsInsp) {
    if (inspTasks.some(x => x.taskId === a.inspectionTaskId)) continue   // the task row already covers it
    const base = a.inspection === 'none' ? (a.today ? 80 : 60) : a.inspection === 'auto' ? 30 : a.inspection === 'open' ? 28 : 8
    items.push({ key: 'arr:' + a.reservationId, area: 'ops', sub: 'Inspections', score: base + valueBonus(a.value), node: <ArrivalInspectionRow a={a} create={createFor(a.reservationId)} canCreate={can.plan} onChanged={onChanged} /> })
  }
  for (const i of otherFix) items.push({ key: i.key, area: 'ops', sub: 'Tasks', score: i.severity === 'now' ? 66 : i.severity === 'today' ? 52 : 30, node: <NextRow i={i} roster={roster} canAssign={can.assign} canCreate={can.plan} onCleared={onCleared} onChanged={onChanged} /> })
  // Working first: on the clock or in a unit, then the rest; the most loaded first within each.
  for (const r of teamRows) {
    const w = whereNow(r.tasks || [], new Date(), r.clock)
    const active = r.clock?.open || w.kind === 'at' || w.kind === 'still' || w.kind === 'heading'
    items.push({ key: 'team:' + r.person, area: 'ops', sub: 'Team', score: (active ? 44 : 24) + Math.min(r.utilisationPct, 150) / 15 /* ≤ 54: never reaches Now */, node: <TeamRow p={r} /> })
  }

  for (const a of calls) items.push({ key: 'call:' + a.reservationId, area: 'guests', sub: 'Calls', score: (a.big ? 78 : 50) + valueBonus(a.value), node: <CallRow a={a} canLog={can.calls} onChanged={onChanged} /> })
  for (const i of inbox) {
    const isUnhappy = (i.tags || []).some(x => x.label === 'Unhappy'), late = (i.tags || []).some(x => /^Late/.test(x.label))
    items.push({ key: i.key, area: 'guests', sub: 'Inbox', score: isUnhappy ? 88 : late ? 85 : 60, node: <InboxRow i={i} onCleared={onCleared} /> })
  }
  for (const g of glitches) items.push({ key: 'gl:' + g.id, area: 'guests', sub: 'Glitches', score: g.overdue ? 82 : !g.hasTask ? 55 : 40, node: <GlitchRow g={g} canEdit={can.glitches} canApprove={acc.atLeast('glitches', 'full')} onChanged={onChanged} /> })

  for (const r of reviews) {
    const s = five(r.rating, r.channel), low = s != null && s <= 3
    const ageH = (Date.now() - Date.parse(r.created_at)) / 3600000
    items.push({ key: 'rv:' + r.id, area: 'guests', sub: 'Reviews', score: (low ? 76 : 45) + Math.min(6, ageH / 24), node: <ReviewRow r={r} canReply={can.reviews} onGone={() => { setGoneReviews(g => ({ ...g, [r.id]: true })); reloadReviews() }} /> })
  }

  for (const row of approvals) items.push({ key: row.key, area: 'admin', sub: 'Needs you', score: 70, node: <ApprovalRow row={row} onCleared={onCleared} onChanged={onChanged} /> })
  for (const i of claims.concat(links)) {
    const m = NEEDS[i.kind]; if (!m) continue
    items.push({ key: i.key, area: 'admin', sub: 'Needs you', score: m.score, node: <NeedsRow i={i} tag={m.tag} tone={m.tone} hover={m.hover} clear={m.clear} clearTitle={m.clearTitle} onCleared={onCleared} /> })
  }
  // Unpaid stays are their own section under the checklist (the board's rows, embedded) — not lane rows.
  // Checklist rows live in the strip above (the smart checklist), not in the lane (2026-10-01).
  for (const m of mineRows) items.push({ key: 'mine:' + m.it.id, area: 'admin', sub: 'Yours', score: m.score, node: <MineRow it={m.it} late={m.late} pending={m.pending} onChanged={reloadMine} /> })
  // OPTIMIZE (Jon, 2026-10-01: "every listing should be optimized once every 6 months"): the listings
  // past the cadence or never optimized — never first, then oldest. Low score: standing work, not a fire.
  for (const o of optimizeRows) items.push({ key: 'opt:' + o.id, area: 'admin', sub: 'Optimize', score: o.days == null ? 26 : 22, node: <OptimizeRow o={o} /> })
  if (channel.length) items.push({ key: 'channel-group', area: 'admin', sub: 'Fixes', score: channel.length > 1 ? 58 : 66, node: <ChannelGroupRow items={channel} onCleared={onCleared} /> })
  for (const a of fixes) items.push({ key: 'fix:' + a.listingId + a.key, area: 'admin', sub: 'Fixes', score: a.severity === 'critical' ? 40 : a.severity === 'high' ? 30 : 20, node: <FixRow a={a} /> })

  // NOW: the top of everything, across areas — but only rows that clear the bar.
  const nowAll = items.filter(i => i.score >= NOW_MIN).sort((a, b) => b.score - a.score)
  const now = nowOpen ? nowAll : nowAll.slice(0, NOW_MAX)

  // ── the KPIs ──
  const free = t.team.rows.reduce((a, r) => a + Math.max(0, (r.capacityMinutes || 0) - (r.loadMinutes || 0)), 0)
  const over = t.team.rows.filter(r => r.utilisationPct > 100).length
  // Cleans, inspections and welcome calls read needed-vs-completed in the DayKpis strip above (2026-09-30).
  const wkGl = week('glitches')
  const kpis: Kpi[] = [
    { key: 'hours', area: 'ops', label: 'Free hours', short: 'Hours', value: t.team.onShift ? hm(free) : '—', sub: t.team.onShift ? t.team.onShift + ' on shift' + (over ? ' · ' + over + ' over' : '') : 'nobody on shift', tone: !t.team.onShift ? 'rose' : over ? 'amber' : free < 60 ? 'amber' : 'emerald', title: 'Hours the people on shift can still take today: their capacity minus the work already on them' },
    { key: 'waiting', area: 'guests', label: 'Guests waiting', short: 'Waiting', value: String(inbox.length), sub: [lateReplies.length ? lateReplies.length + ' past the hour' : '', unhappy.length ? unhappy.length + ' unhappy' : 'sentiment clear'].filter(Boolean).join(' · '), tone: unhappy.length || lateReplies.length ? 'rose' : inbox.length ? 'amber' : 'emerald', title: 'Guests waiting on a reply (1-hour rule), and current guests the sentiment scan reads as unhappy' },
    { key: 'glitches', area: 'guests', label: 'Glitches', value: String(glitches.length), sub: [t.glitches.overdue ? t.glitches.overdue + ' overdue' : 'none overdue', wkGl && /to close/.test(wkGl.sub) ? 'wk ' + wkGl.sub.split(' · ').filter(s => /to close/.test(s))[0] : ''].filter(Boolean).join(' · '), tone: t.glitches.overdue ? 'rose' : glitches.length ? 'amber' : 'emerald', title: 'Open guest issues, how many are past due, and the month’s median time to close' },
    { key: 'reviews', area: 'guests', label: 'Reviews', value: String(reviews.length), sub: [lowReviews.length ? lowReviews.length + ' at 3★ or under' : reviews.length ? 'to answer' : 'all answered', avg30 ? avg30.avg + '★ last 30d' : ''].filter(Boolean).join(' · '), tone: lowReviews.length ? 'rose' : reviews.length ? 'amber' : 'emerald', title: 'Reviews waiting on a public reply, and the average score of the last 30 days' },
    { key: 'admin', area: 'admin', label: 'Admin', value: String(approvals.length + claims.length + links.length), sub: [approvals.length + claims.length + links.length ? 'need your decision' : 'nothing to decide', mineRows.length ? mineRows.length + ' of yours' : '', optimizeDue ? optimizeDue + ' to optimize' : '', fixes.length ? fixes.length + ' fixes' : ''].filter(Boolean).join(' · '), tone: approvals.length || links.length ? 'amber' : ck?.progress?.late ? 'amber' : 'emerald', title: 'Decisions waiting on you, your own tasks, listings past their six-month optimization, and the listing fixes recommended for today' },
  ]

  const EMPTY: Record<Area, string> = { ops: 'every clean and inspection is covered', guests: 'nobody is waiting', reviews: 'nothing waiting on a reply', admin: 'nothing on your desk' }
  // One line of numbers per lane, from the same KPIs the tiles used to show.
  const laneStat = (a: Area): ReactNode => {
    const ks = kpis.filter(k => k.area === a)
    if (!ks.length) return null
    return <span className="text-[11px] text-muted inline-flex items-center gap-1.5 flex-wrap">{ks.map(k => <span key={k.key} title={k.title} className="inline-flex items-center gap-1"><span className={'font-bold tabular-nums ' + (k.tone === 'rose' ? 'text-rose-700' : k.tone === 'amber' ? 'text-amber-800' : 'text-ink')}>{k.value}</span>{k.label.toLowerCase()}{k.sub ? <span className="hidden xl:inline"> · {k.sub}</span> : null}</span>)}</span>
  }

  return (
    <NotesCtx.Provider value={notesCtx}>
    <div className="space-y-5">
      {/* THE WORK TODAY — needed vs completed, with the granular list under the strip (Jon, 2026-09-30). */}
      <DayKpis d={d} live={live} roster={roster} can={{ assign: can.assign, plan: can.plan, calls: can.calls, glitchApprove: acc.atLeast('glitches', 'full') }} onChanged={onChanged} />

      {/* THE CHECKLIST, next two things, then NOW. The second row of tiles that used to sit here
          (free hours, guests waiting, glitches, reviews, admin) now reads as one line in each lane's
          header below — same numbers, one less band to scan (Jon, 2026-10-01: "cleaner … better organized"). */}

      {/* UNPAID — the actual reservations, one flat list with a due date each (Jon, 2026-10-01). The
          Unpaid tile above scrolls here. Hidden when nothing is owed this week. */}

      {!focus && <ArrivalsLane />}

      {!focus && (
        <section>
          <h2 className="px-1 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink flex items-center gap-2">
            <button onClick={() => setNowOpen(o => !o)} aria-expanded={nowOpen} className="inline-flex items-center gap-1.5 hover:text-brand-700" title={nowOpen ? 'Back to the top six' : 'Open the whole list'}>Now {nowAll.length ? <span className="tabular-nums text-muted whitespace-nowrap">{nowOpen ? nowAll.length : now.length + (nowAll.length > now.length ? ' of ' + nowAll.length : '')}</span> : null} {nowAll.length > NOW_MAX ? (nowOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}</button>
            <span className="normal-case tracking-normal font-medium text-muted">— {now.length ? 'what matters most in the next two hours, high-ticket first' : 'nothing urgent — the lanes below have the rest'}</span>
          </h2>
          {now.length > 0 && <div className={LIST}>{now.map(i => <div key={'now:' + i.key}>{withLane(i)}</div>)}</div>}
        </section>
      )}

      {focus && (
        <div className="px-1 flex items-center gap-2 text-[12px] text-muted">
          <span>Focused on <b className="text-ink">{AREA[focus].label}</b>.</span>
          <button onClick={() => setFocus(null)} className="font-semibold text-brand-700 hover:underline">Show every lane</button>
        </div>
      )}
      {/* TWO FIXED COLUMNS that stack (2026-10-01, visual pass): Operations over Reviews on the left,
          Guests over Admin on the right. Each lane holds its spot; an empty one is a single line and
          the lane under it moves up — the old grid left a hole beside an empty Reviews lane. */}
      {focus ? (
        <Lane area={focus} items={items.filter(i => i.area === focus)} focused empty={EMPTY[focus]} right={laneStat(focus)} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 items-start">
          {[['ops', 'reviews'], ['guests', 'admin']].map((col, ci) => (
            <div key={ci} className="space-y-5 min-w-0">
              {(col as Area[]).map(a => <Lane key={a} area={a} items={items.filter(i => i.area === a)} focused={false} empty={EMPTY[a]} right={laneStat(a)} />)}
            </div>
          ))}
        </div>
      )}
    </div>
    </NotesCtx.Provider>
  )
}

/** The same row, stamped with its lane, for the Now list. */
function withLane(i: HubItem): ReactNode {
  return isValidElement(i.node) ? cloneElement(i.node as any, { lane: AREA[i.area].short }) : i.node
}
export function tomorrowOf(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10)
}

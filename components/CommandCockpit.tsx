'use client'
// COMMAND CENTER v4 — the cockpit (Jon, 2026-09-09: "cleaner and easier to read, get rid of noise
// and waste, this should be an actionable page, clarity in the day. Think Recommendations,
// pending, completed. Command center should have My tasks as well from all boards. Also in future
// important emails.")
//
// ONE READ (/api/command/day), FIVE THINGS ON THE SCREEN, IN THIS ORDER:
//   1. THE DAY      one line — on track / at risk / behind — and the pulse under it.
//   2. THE NUMBERS  one compact strip (cleans · arrivals · tasks · team · glitches · claims ·
//                   overdue · guest desk). Tap one and its rows open in place. No tiles.
//   3. RECOMMENDATIONS  what the engine proposes a person DO — create an inspection, assign the
//                   turn, cancel the duplicate. Each row: one action, Done, Skip.
//   4. PENDING      what is already in motion and needs following — an open glitch, a claim in
//                   review, a guest waiting, a late clean somebody is on. Each row opens the thing.
//   5. MY TASKS     everything with your name on it across every Projects board (/api/projects/mine),
//                   with a done-toggle and quick add — the same list as /projects/mine, shorter.
//   and COMPLETED   what landed today: cleans, tasks, calls, and every row cleared here (by whom).
//
// WHAT LEFT (v3 → v4) AND WHY: the eight 92px tiles (→ one strip), the KIND/OWNER badge pair on
// every row (→ a dot for urgency, one muted meta line), the review quote printed on every feedback
// row (→ behind a tap: Jon, "only show the review if you click into it"), the sticky Eve panel with
// four prompt buttons (→ one line; the floating Eve bubble is on every page), the engine footnote.
//
// FUTURE (Jon): "important emails" — a fifth list, `pending`-shaped, from a mail read. The page is
// built as sections over one feed so that lands as one more section, not a redesign.
//
// ACTION RULES (Jon, unchanged): assign · create (an inspection is not a completion) · open · note
// to the assignee · done · skip. Nothing here completes a Breezeway task; cancelling a duplicate
// needs the admin password. Nothing auto-fires.
//
// 2026-09-28: the v4 page itself (CommandCockpit(), its lists, its side cards) was no longer
// mounted anywhere — /command renders CommandDayList (v5). It is gone; what stays here are the
// pieces v5 and the Scoreboard reuse: the tile drawers, the team panel, inline assign, Completed,
// and the shared styles and My-tasks shapes.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ExternalLink, UserPlus, Loader2, Check, X, Crown,
  MessageSquare, CheckCircle2, Star, Phone, ClipboardCheck, Undo2, Send,
  Circle, CircleDot, Ban,
} from 'lucide-react'
import type { CommandDay, Handled } from '@/lib/command-day'
import { matchRoster } from '@/lib/roster-match'

export type Roster = { id: number; name: string; departments: string[] }
export type TileKey = 'cleans' | 'arrivals' | 'tasks' | 'team' | 'glitches' | 'claims' | 'overdue' | 'guestDesk'

export const DAY_URL = '/api/command/day'
export const MINE_URL = '/api/projects/mine'
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const fmtH = (mins: number) => { const m = Math.max(0, Math.round(mins)); const h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm' }
const ago = (iso: string, tick: number) => { void tick; const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago' }
const clock = (iso: string) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) } catch { return '' } }
const bz = (id: string) => 'https://app.breezeway.io/task/' + id
export const BTN = 'text-[12px] font-bold px-3 py-1.5 rounded-lg shrink-0 inline-flex items-center gap-1 min-h-[34px] disabled:opacity-50'
export const ICON_BTN = 'inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0'
export const CARD = 'rounded-2xl border border-line bg-white overflow-hidden'

// ── THE NUMBERS ─────────────────────────────────────────────────────────────────────────────────
export type Tone = 'ok' | 'warn' | 'hot' | 'quiet'
export function Stat({ label, value, sub, tone, active, onClick }: { label: string; value: string; sub: string; tone: Tone; active: boolean; onClick: () => void }) {
  const num = tone === 'hot' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-800' : tone === 'ok' ? 'text-emerald-700' : 'text-ink'
  const dot = tone === 'hot' ? 'bg-rose-500' : tone === 'warn' ? 'bg-amber-400' : tone === 'ok' ? 'bg-emerald-500' : 'bg-transparent'
  return (
    <button onClick={onClick} aria-expanded={active} aria-label={label + ': ' + value + (sub ? ', ' + sub : '')}
      className={'shrink-0 text-left rounded-xl border px-2.5 py-1.5 min-h-[44px] transition-colors ' + (active ? 'border-ink bg-white ring-1 ring-ink' : 'border-line bg-white hover:border-ink/30')}>
      <div className="flex items-center gap-1.5">
        <span className={'w-1.5 h-1.5 rounded-full ' + dot} aria-hidden />
        <span className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className={'text-[15px] font-bold tabular-nums leading-none ' + num}>{value}</span>
        {sub && <span className="text-[10.5px] text-muted leading-none whitespace-nowrap">{sub}</span>}
      </div>
    </button>
  )
}

// ── MY TASKS — every Projects board, your name on it ───────────────────────────────────────────
export type MineItem = { id: string; projectId: string; title: string; status: string; due: string | null; priority: string; section: string | null; project: string; oneOnOne: boolean; where: string | null; mine?: boolean }
export type Mine = { ok: boolean; today: string; total: number; groups: { overdue: MineItem[]; today: MineItem[]; week: MineItem[]; later: MineItem[]; someday: MineItem[] }; board?: { id: string; title: string } | null; error?: string }
export const MINE_ICON: Record<string, any> = { todo: Circle, doing: CircleDot, blocked: Ban, done: Check }
export const MINE_CLS: Record<string, string> = { todo: 'text-muted border-line hover:border-ink', doing: 'text-amber-600 border-amber-300 bg-amber-50', blocked: 'text-rose-600 border-rose-300 bg-rose-50', done: 'text-white bg-emerald-500 border-emerald-500' }
export const niceDay = (ymd: string | null) => { if (!ymd) return ''; try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }

// ── COMPLETED TODAY ─────────────────────────────────────────────────────────────────────────────
export function CompletedCard({ d, onChanged, tick }: { d: CommandDay; onChanged: () => void; tick: number }) {
  const c = d.completed
  const [showSkipped, setShowSkipped] = useState(false)
  const [busy, setBusy] = useState('')
  const doneRows = d.handled.filter(h => h.outcome === 'done')
  const skipped = d.handled.filter(h => h.outcome !== 'done')
  const undo = async (h: Handled) => {
    setBusy(h.key)
    try { await fetch('/api/command/dismiss', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: h.key }) }); onChanged() } catch { /* shown on reload */ }
    setBusy('')
  }
  const n = (v: number, of?: number) => <b className="text-ink tabular-nums">{v}{of != null ? <span className="text-muted font-semibold">/{of}</span> : null}</b>
  const HandledRow = ({ h }: { h: Handled }) => (
    <div className="px-3 py-1.5 flex items-center gap-2 text-[12px]">
      {h.outcome === 'done' ? <Check size={12} className="text-emerald-600 shrink-0" /> : <X size={12} className="text-muted shrink-0" />}
      <span className="min-w-0 flex-1 truncate"><span className="font-bold text-ink">{h.unit || ''}</span>{h.unit && h.title ? ' — ' : ''}<span className="text-ink/80">{h.title || h.key}</span></span>
      <span className="text-[10.5px] text-muted shrink-0">{h.by.split('@')[0]} · {clock(h.at) || ago(h.at, tick)}</span>
      <button onClick={() => undo(h)} disabled={busy === h.key} aria-label="Bring back" title="Bring it back" className="text-muted hover:text-ink shrink-0"><Undo2 size={12} /></button>
    </div>
  )
  return (
    <section className={CARD}>
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
        <CheckCircle2 size={14} className="text-emerald-600" />
        <h2 className="text-[13.5px] font-bold text-ink">Completed today</h2>
      </div>
      <div className="px-4 py-2.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[12px] text-muted">
        <span>{n(c.cleansDone, c.cleansTotal)} cleans</span>
        <span>{n(c.tasksDone, c.tasksTotal)} tasks</span>
        <span>{n(c.callsDone)} calls</span>
        <span>{n(c.handledDone)} done here</span>
      </div>
      {doneRows.length > 0 && <div className="border-t border-line divide-y divide-line">{doneRows.map(h => <HandledRow key={h.key} h={h} />)}</div>}
      {skipped.length > 0 && (
        <>
          <button onClick={() => setShowSkipped(s => !s)} className="w-full text-left px-4 py-1.5 text-[11.5px] font-semibold text-muted hover:text-ink border-t border-line">
            {showSkipped ? 'Hide' : 'Show'} {skipped.length} skipped today
          </button>
          {showSkipped && <div className="border-t border-line divide-y divide-line">{skipped.map(h => <HandledRow key={h.key} h={h} />)}</div>}
        </>
      )}
    </section>
  )
}

// ── THE DRAWERS behind the numbers ─────────────────────────────────────────────────────────────
const Pill = ({ cls, children }: { cls: string; children: React.ReactNode }) => <span className={'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ' + cls}>{children}</span>
const ROW = 'px-4 py-2 flex items-center gap-2.5 text-[13px] flex-wrap'
function Empty({ text }: { text: string }) { return <div className="px-4 py-5 text-[13px] text-muted flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> {text}</div> }
function BzLink({ id }: { id: string }) { return <a href={bz(id)} target="_blank" rel="noreferrer" aria-label="Open in Breezeway" title="Open in Breezeway" className={ICON_BTN + ' border border-line bg-white text-muted hover:text-ink'}><ExternalLink size={13} /></a> }
function AssignBtn({ who, open, onClick }: { who: string; open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-expanded={open} className={BTN + ' ' + (who ? 'border border-line bg-white text-ink' : 'bg-ink text-white')} title={who ? 'With ' + who + ' — tap to reassign' : 'Assign'}>
      {who ? <>{who.split(',')[0]} ↺</> : <><UserPlus size={12} />Assign</>}
    </button>
  )
}

export function TilePanel({ k, d, roster, onChanged }: { k: TileKey; d: CommandDay; roster: Roster[]; onChanged: () => void }) {
  const t = d.tiles
  const [assignFor, setAssignFor] = useState('')
  const scroll = 'divide-y divide-line max-h-[440px] overflow-y-auto'
  if (k === 'cleans') return (
    <div className={scroll}>
      {t.cleans.rows.length === 0 && <Empty text="No departure cleans on the board today." />}
      {t.cleans.rows.map(r => (
        <div key={r.taskId} className={ROW}>
          {r.status === 'late' ? <Pill cls="bg-rose-600 text-white">Late</Pill> : r.status === 'atRisk' ? <Pill cls="bg-rose-100 text-rose-700">At risk</Pill> : r.status === 'done' ? <Pill cls="bg-emerald-100 text-emerald-700">Done</Pill> : r.status === 'running' ? <Pill cls="bg-sky-100 text-sky-700">Running</Pill> : r.status === 'vendor' ? <Pill cls="bg-app text-muted">Vendor</Pill> : r.status === 'extended' ? <Pill cls="bg-app text-muted">Extended</Pill> : <Pill cls="bg-amber-100 text-amber-800">Not started</Pill>}
          <span className="font-bold text-ink">{r.unit}</span>
          <span className="text-[10.5px] font-semibold text-muted bg-app rounded px-1.5 py-0.5">{r.market}</span>
          {r.outAt && r.status !== 'done' && r.status !== 'extended' && <span className="text-[11.5px] text-muted">out {r.outAt}</span>}
          {r.sameDay && <span className="text-[11.5px] font-bold text-amber-700">same-day{r.arrivingAt ? ' · in ' + r.arrivingAt : ''}</span>}
          {r.status === 'extended' && <span className="text-[11.5px] text-muted">guest still in the unit · do not clean</span>}
          <span className="ml-auto flex items-center gap-1.5">
            {r.status !== 'vendor' && r.status !== 'done' && r.status !== 'extended' && <AssignBtn who={r.who} open={assignFor === r.taskId} onClick={() => setAssignFor(assignFor === r.taskId ? '' : r.taskId)} />}
            {(r.status === 'done' || r.status === 'extended') && r.who && <span className="text-[11.5px] text-muted">{r.who}</span>}
            {r.status !== 'vendor' && <BzLink id={r.taskId} />}
          </span>
          {assignFor === r.taskId && <div className="w-full"><InlineAssign taskId={r.taskId} dept="housekeeping" roster={roster} onDone={() => { setAssignFor(''); onChanged() }} /></div>}
        </div>
      ))}
      {t.cleans.extended > 0 && <div className="px-4 py-2 text-[11.5px] text-muted">{t.cleans.extended} extended-stay clean{t.cleans.extended === 1 ? '' : 's'} listed but not counted — the guest has not left.</div>}
    </div>
  )
  if (k === 'arrivals') return (
    <div className={scroll}>
      {t.arrivals.rows.length === 0 && <Empty text="No arrivals in the next three days." />}
      {t.arrivals.rows.map(r => (
        <div key={r.reservationId} className={ROW}>
          {r.today ? <Pill cls="bg-emerald-600 text-white">Today</Pill> : <span className="text-[11.5px] text-muted w-[42px] shrink-0">{r.checkIn.slice(5)}</span>}
          {r.big && <Crown size={13} className="text-amber-500 shrink-0" aria-label="Big arrival" />}
          <span className="font-bold text-ink">{r.guest}</span>
          <span className="text-ink/70 truncate flex-1 min-w-[120px]">{r.unit}</span>
          <span className="text-[11.5px] text-muted">{r.nights} nt</span>
          <span className="font-bold tabular-nums text-ink">{fmtMoney(r.value)}</span>
          {r.big && (r.inspection === 'none' ? <Pill cls="bg-amber-100 text-amber-800">No inspection</Pill>
            : r.inspection === 'open' && r.inspectionTaskId ? <a href={bz(r.inspectionTaskId)} target="_blank" rel="noreferrer"><Pill cls="bg-sky-100 text-sky-700">Inspection open</Pill></a>
            : r.inspection === 'done' ? <Pill cls="bg-emerald-100 text-emerald-700">Inspected</Pill>
            : r.inspection === 'auto' ? <span title="Task automation creates and assigns this inspection on its next run — nobody needs to"><Pill cls="bg-sky-50 text-sky-700">Auto</Pill></span>
            : <Pill cls="bg-app text-muted">Vendor</Pill>)}
          {r.today && !r.welcomeDone && <Link href="/welcome-calls" className="text-[11.5px] font-semibold text-brand-700 inline-flex items-center gap-1 min-h-[32px]"><Phone size={11} /> call</Link>}
        </div>
      ))}
      <div className="px-4 py-2 text-[11.5px] text-muted">Big = value at or above the bar in /users → Task automation. Inspected = an inspection open or completed on the unit in the last 45 days.</div>
    </div>
  )
  if (k === 'tasks') return (
    <div className={scroll}>
      <div className="px-4 py-1.5 text-[11.5px] text-muted flex gap-3 flex-wrap">{Object.entries(t.tasks.byDept).map(([dp, n]) => <span key={dp}><b className="text-ink">{n}</b> {dp}</span>)}<span><b className="text-ink">{t.tasks.done}</b> done</span>{t.tasks.late ? <span className="text-rose-700 font-bold">{t.tasks.late} late</span> : null}</div>
      {t.tasks.rows.length === 0 && <Empty text="No maintenance, inspection or other work on the board today." />}
      {t.tasks.rows.map(r => (
        <div key={r.taskId} className={ROW}>
          {r.state === 'done' ? <Pill cls="bg-emerald-100 text-emerald-700">Done</Pill> : r.state === 'running' ? <Pill cls="bg-sky-100 text-sky-700">Running</Pill> : <Pill cls="bg-app text-muted">Open</Pill>}
          <span className="font-bold text-ink">{r.unit}</span>
          <span className="text-ink/75 truncate flex-1 min-w-[140px]">{r.name}</span>
          {(r.prio === 'urgent' || r.prio === 'high') && r.state !== 'done' && <Pill cls={r.prio === 'urgent' ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800'}>{r.prio}</Pill>}
          <span className="text-[10.5px] font-semibold text-muted bg-app rounded px-1.5 py-0.5">{r.dept}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {r.state !== 'done' && <AssignBtn who={r.who} open={assignFor === r.taskId} onClick={() => setAssignFor(assignFor === r.taskId ? '' : r.taskId)} />}
            <BzLink id={r.taskId} />
          </span>
          {assignFor === r.taskId && <div className="w-full"><InlineAssign taskId={r.taskId} dept={r.dept} roster={roster} onDone={() => { setAssignFor(''); onChanged() }} /></div>}
        </div>
      ))}
    </div>
  )
  if (k === 'team') return <TeamPanel d={d} roster={roster} onChanged={onChanged} />
  if (k === 'glitches') return (
    <div className={scroll}>
      <div className="px-4 py-1.5 text-[11.5px] text-muted flex gap-3 flex-wrap">{Object.entries(t.glitches.byLane).map(([l, n]) => <span key={l}><b className="text-ink">{n}</b> {l.replace('_', ' ')}</span>)}<Link href="/glitches" className="ml-auto font-semibold text-brand-700">Open the board →</Link></div>
      {t.glitches.rows.length === 0 && <Empty text="No open guest issues on the board." />}
      {t.glitches.rows.map(g => (
        <Link key={g.id} href={g.href} className={ROW + ' hover:bg-app/40'}>
          <Pill cls={g.status === 'incident' ? 'bg-rose-600 text-white' : g.overdue ? 'bg-rose-100 text-rose-700' : 'bg-pink-100 text-pink-700'}>{g.overdue ? 'Overdue' : g.status.replace('_', ' ')}</Pill>
          <span className="font-bold text-ink">{g.unit}</span>
          <span className="text-ink/75 truncate flex-1 min-w-[160px]">{g.issue}</span>
          <span className="text-[11.5px] text-muted">{g.ageDays}d{g.due ? ' · due ' + g.due.slice(5) : ''}</span>
          <span className={'text-[11.5px] ' + (g.assignee ? 'text-muted' : 'text-amber-700 font-bold')}>{g.assignee || 'unassigned'}</span>
          {g.hasTask ? <Pill cls={g.taskStatus === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}>{g.taskStatus === 'done' ? 'task done' : 'task open'}</Pill> : <Pill cls="bg-amber-100 text-amber-800">no task</Pill>}
        </Link>
      ))}
    </div>
  )
  if (k === 'claims') return (
    <div className={scroll}>
      {t.claims.rows.length === 0 && <Empty text="No open claims." />}
      {t.claims.rows.map(c => (
        <Link key={c.id} href={'/claims?claim=' + encodeURIComponent(c.id)} className={ROW + ' hover:bg-app/40'}>
          <Pill cls={c.stage === 'review' ? 'bg-amber-100 text-amber-800' : c.stage === 'ready' ? 'bg-rose-100 text-rose-700' : 'bg-app text-muted'}>{c.stageLabel}</Pill>
          <span className="font-bold text-ink">{c.unit}</span>
          <span className="text-ink/75 truncate flex-1 min-w-[120px]">{c.guest}</span>
          {c.amount != null && <span className="font-bold tabular-nums text-ink">{fmtMoney(c.amount)}</span>}
          {c.daysLeft != null && <span className={'text-[11.5px] font-semibold ' + (c.daysLeft <= 1 ? 'text-rose-700' : c.daysLeft <= 5 ? 'text-amber-700' : 'text-muted')}>{c.daysLeft < 0 ? 'deadline passed' : c.daysLeft === 0 ? 'due today' : c.daysLeft + 'd to file'}</span>}
          {c.waitingOn && <span className="text-[11.5px] text-muted">waiting on {c.waitingOn}</span>}
        </Link>
      ))}
      <div className="px-4 py-2"><Link href="/claims" className="text-[12px] font-semibold text-brand-700">Open the claims desk →</Link></div>
    </div>
  )
  if (k === 'overdue') return (
    <div className={scroll}>
      {t.overdue.rows.length === 0 && <Empty text="Nothing overdue on any board." />}
      {t.overdue.rows.map(r => {
        const inner = (<>
          <Pill cls={r.kind === 'urgent' ? 'bg-rose-100 text-rose-700' : r.kind === 'glitch' ? 'bg-pink-100 text-pink-700' : r.kind === 'field' ? 'bg-violet-100 text-violet-700' : 'bg-app text-muted'}>{r.kind === 'breezeway' ? 'Backlog' : r.kind === 'field' ? 'Request' : r.kind === 'glitch' ? 'Glitch' : 'Urgent'}</Pill>
          <span className="text-ink/85 flex-1 min-w-[200px]">{r.text}</span>
          {r.href && <ExternalLink size={12} className="text-muted" aria-hidden />}
        </>)
        if (!r.href) return <div key={r.key} className={ROW}>{inner}</div>
        return /^https?:/.test(r.href) ? <a key={r.key} href={r.href} target="_blank" rel="noreferrer" className={ROW + ' hover:bg-app/40'}>{inner}</a> : <Link key={r.key} href={r.href} className={ROW + ' hover:bg-app/40'}>{inner}</Link>
      })}
      <div className="px-4 py-2 text-[11.5px] text-muted">Backlog = Breezeway tasks scheduled in the last 45 days and still open (Guesty-only buildings excluded). Urgent = high/urgent tasks open on today&rsquo;s board.</div>
    </div>
  )
  return (
    <div className={scroll}>
      {t.guestDesk.rows.length === 0 && <Empty text="Nothing waiting at the guest desk." />}
      {t.guestDesk.rows.map(r => (
        <Link key={r.key} href={r.href} className={ROW + ' hover:bg-app/40'}>
          {r.kind === 'review' ? <Star size={13} className="text-amber-500 shrink-0" aria-label="Review" /> : r.kind === 'message' ? <MessageSquare size={13} className="text-sky-600 shrink-0" aria-label="Message" /> : r.kind === 'welcome' ? <Phone size={13} className="text-emerald-600 shrink-0" aria-label="Welcome call" /> : <ClipboardCheck size={13} className="text-violet-600 shrink-0" aria-label="Approval" />}
          <span className="font-bold text-ink">{r.who}</span>
          {r.unit && <span className="text-[11.5px] text-muted">{r.unit}</span>}
          <span className="text-ink/75 truncate flex-1 min-w-[160px]">{r.text}</span>
          <span className="text-[11.5px] text-muted">{r.meta}</span>
        </Link>
      ))}
      <div className="px-4 py-2 flex gap-3 flex-wrap text-[12px] font-semibold text-brand-700 items-center">
        {t.guestDesk.total > t.guestDesk.shown && <span className="text-muted font-normal">Showing {t.guestDesk.shown} of {t.guestDesk.total} —</span>}
        <Link href="/messages">Messages →</Link><Link href="/welcome-calls">Calls →</Link><Link href="/requests">Approvals →</Link><Link href="/reviews">Reviews →</Link>
      </div>
    </div>
  )
}

/** The capacity model, per person, with the moves it recommends. Assign-kind moves file here. */
export function TeamPanel({ d, roster, onChanged }: { d: CommandDay; roster: Roster[]; onChanged: () => void }) {
  const tm = d.tiles.team
  const [busy, setBusy] = useState('')
  const [filed, setFiled] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const file = async (s: CommandDay['tiles']['team']['moves'][number]) => {
    const hit = matchRoster(roster, s.toPerson)
    if (!hit.ok) { setErr(hit.reason); return }
    setBusy(s.stopId + s.toPerson); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: s.stopId, assigneeIds: [hit.id] }) })
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'failed')
      setFiled(f => ({ ...f, [s.stopId]: true })); onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  return (
    <div className="divide-y divide-line max-h-[480px] overflow-y-auto">
      {tm.rows.length === 0 && <Empty text="No Homebase shifts today, so there is nothing to price." />}
      {tm.rows.map(p => {
        const over = p.utilisationPct > 100, warm = !over && p.utilisationPct >= 85
        const impl = p.verdict === 'implausible'
        return (
          <div key={p.person} className={ROW}>
            <span className="w-8 h-8 rounded-full bg-app grid place-items-center text-[11px] font-bold text-ink/60 shrink-0">{p.person.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()}</span>
            <span className="font-bold text-ink">{p.person}</span>
            <span className="text-[11.5px] text-muted">{p.cleans} clean{p.cleans === 1 ? '' : 's'}{p.otherTasks ? ' · ' + p.otherTasks + ' other' : ''}</span>
            {impl
              ? <span className="text-[11.5px] text-muted italic">not priced — more work than a day holds (likely closed out for the team)</span>
              : p.capacityMinutes > 0
                ? <span className={'text-[11.5px] font-semibold ' + (over ? 'text-rose-700' : warm ? 'text-amber-700' : 'text-emerald-700')}>≈ {fmtH(p.loadMinutes)} of {fmtH(p.capacityMinutes)} · {p.utilisationPct}%{over ? ' · over' : p.headroomCleans > 0 ? ' · room for ' + p.headroomCleans + ' more' : ' · full'}</span>
                : <span className="text-[11.5px] text-muted">no shift on record</span>}
            {!impl && p.capacityMinutes > 0 && (
              <span className="ml-auto w-24 h-2 rounded-full bg-app overflow-hidden" aria-hidden><span className={'block h-full ' + (over ? 'bg-rose-500' : warm ? 'bg-amber-400' : 'bg-emerald-500')} style={{ width: Math.min(100, Math.max(4, p.utilisationPct)) + '%' }} /></span>
            )}
          </div>
        )
      })}
      {tm.moves.length > 0 && (
        <div className="px-4 py-2.5 bg-app/40">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink/80 mb-1.5">Moves the model recommends</div>
          <div className="space-y-1.5">
            {tm.moves.map(s => (
              <div key={s.stopId + s.toPerson} className="flex items-center gap-2 flex-wrap text-[12.5px]">
                <span className="font-bold text-ink">{s.unit}</span>
                <span className="text-muted">→ {s.toPerson}</span>
                <span className="text-muted tabular-nums">{s.toBeforePct}%→{s.toAfterPct}%</span>
                <span className="text-muted flex-1 min-w-[140px]">{s.why}</span>
                {s.kind === 'assign' ? (filed[s.stopId] ? <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-700"><Check size={12} /> assigned</span>
                  : <button onClick={() => file(s)} disabled={busy === s.stopId + s.toPerson} className={BTN + ' bg-ink text-white'}>{busy === s.stopId + s.toPerson ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Assign · {s.toPerson.split(' ')[0]}</button>)
                  : <Link href="/plan?tab=people" className={BTN + ' border border-line bg-white text-muted'}>from {s.fromPerson ? s.fromPerson.split(' ')[0] : '—'} · lanes →</Link>}
              </div>
            ))}
          </div>
          {err && <p className="text-[11.5px] text-rose-600 font-semibold mt-1.5">{err}</p>}
        </div>
      )}
      {tm.notes.length > 0 && <p className="px-4 py-2 text-[11px] text-muted">{tm.notes.join(' · ')}</p>}
      <div className="px-4 py-2"><Link href="/plan?tab=people" className="text-[12px] font-semibold text-brand-700">Open the People view on the board →</Link></div>
    </div>
  )
}

/** Assign a Breezeway task inline: filtered roster, one tap, done. Errors stay in the row. */
export function InlineAssign({ taskId, dept, roster, onDone }: { taskId: string; dept: string; roster: Roster[]; onDone: () => void }) {
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const [all, setAll] = useState(false)
  const ppl = useMemo(() => {
    const inDept = roster.filter(p => !p.departments?.length || p.departments.some(x => x.toLowerCase().includes((dept || '').toLowerCase())))
    return all || !inDept.length ? roster : inDept
  }, [roster, dept, all])
  const go = async (id: number) => {
    setBusy(id); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, assigneeIds: [id] }) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'assign failed')
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(0) }
  }
  return (
    <div className="mt-2 pt-2 border-t border-line flex items-center gap-1.5 flex-wrap">
      {roster.length === 0 && <span className="text-[11.5px] text-muted">Roster still loading…</span>}
      {ppl.slice(0, all ? 60 : 14).map(p => (
        <button key={p.id} onClick={() => go(p.id)} disabled={!!busy}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-full border border-line bg-white hover:border-ink/40 disabled:opacity-50 min-h-[34px]">
          {busy === p.id ? <Loader2 size={11} className="animate-spin inline" /> : null} {p.name}
        </button>
      ))}
      {!all && roster.length > ppl.length && <button onClick={() => setAll(true)} className="text-[12px] font-semibold text-brand-700 min-h-[34px] px-2">everyone ({roster.length})</button>}
      {err && <span className="text-[11.5px] text-rose-600 font-semibold">{err}</span>}
    </div>
  )
}

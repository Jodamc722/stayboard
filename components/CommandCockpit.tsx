'use client'
// COMMAND CENTER v3.1 — the cockpit (Jon, 2026-09-02, two passes).
//
// Pass 1: "Command Center = where claims, glitches, tasks, departure cleans, big-arrival inspections
// and top-priority issues are managed; get rid of the needs-a-human tab."
// Pass 2: "think GM of a 300+ unit STR business — actionable plan, visibility, direction and
// coordination. World class."
//
// FOUR BANDS, FIXED SHAPE, ONE READ (/api/command/day):
//   1. VERDICT   direction — on track / at risk / behind / past 4pm, the facts behind it, tomorrow.
//   2. PULSE     the day in one line — the same numbers the board shows (lib/ops-day).
//   3. TILES     visibility — eight counters that open IN PLACE; each number reconciles with its
//                drawer (one denominator per thing). Team is the capacity model, priced per person.
//   4. DO NEXT   the plan — one ranked list, each row with an OWNER lane, a DUE time, evidence and
//                one action. Filter by owner so a supervisor sees their lane; "Copy handoff" turns
//                the live list into text for the group chat. Dismiss is shared across devices.
//
// ACTION RULES (Jon): assign · create (an inspection is not a completion) · open · note to the
// assignee · dismiss. Never complete a task from here; cancelling a duplicate needs the admin
// password. Nothing auto-fires.
//
// PHONE: Do-next renders ABOVE the tiles below 640px — the list is what the page is for, and four
// rows of tiles pushed it under the fold. Nothing above 640px moves.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Sparkles, RefreshCw, ExternalLink, UserPlus, Loader2, Check, X, Crown, Wrench, AlertTriangle, Sparkle, ShieldAlert,
  Scale, MessageSquare, CheckCircle2, Eye, EyeOff, Star, Phone, ClipboardCheck, Undo2, Users, Clock, Copy, Send, History,
} from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { CommandDay, NextItem, NextAction } from '@/lib/command-day'
import { OWNER_LABEL, type Owner } from '@/lib/command-types'
import { matchRoster } from '@/lib/roster-match'

type Roster = { id: number; name: string; departments: string[] }
type TileKey = 'cleans' | 'arrivals' | 'tasks' | 'team' | 'glitches' | 'claims' | 'overdue' | 'guestDesk'

const DAY_URL = '/api/command/day'
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const fmtLeft = (m: number) => { const a = Math.abs(m); const h = Math.floor(a / 60); return (h ? h + 'h ' : '') + (a % 60) + 'm' }
const fmtH = (mins: number) => { const m = Math.max(0, Math.round(mins)); const h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm' }
const ago = (iso: string, tick: number) => { void tick; const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago' }
const bz = (id: string) => 'https://app.breezeway.io/task/' + id
const BTN = 'text-[12px] font-bold px-3 py-2 rounded-lg shrink-0 inline-flex items-center gap-1 min-h-[36px] disabled:opacity-50'
const ICON_BTN = 'inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0'

export function CommandCockpit({ firstName }: { firstName: string }) {
  const { data, loading, error, refresh } = useCachedFetch<CommandDay & { error?: string }>(DAY_URL, { ttl: 60_000 })
  // ONE roster read for every Assign on the page (the old page fetched it three times).
  const { data: rosterRes } = useCachedFetch<{ people: Roster[] }>('/api/breezeway/people', { ttl: 10 * 60_000 })
  const roster = useMemo(() => Array.isArray(rosterRes?.people) ? rosterRes!.people : [], [rosterRes])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') refresh() }
    const t = setInterval(onShow, 5 * 60 * 1000)
    const t2 = setInterval(() => setTick(x => x + 1), 30_000)
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(t); clearInterval(t2); document.removeEventListener('visibilitychange', onShow) }
  }, [refresh])
  const [open, setOpen] = useState<TileKey | null>(null)
  const reload = () => { invalidateCache(DAY_URL); refresh() }

  if (!data && loading) return <CockpitSkeleton />
  if (!data || !data.ok) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 flex items-center gap-3">
        <AlertTriangle size={15} /> <span className="flex-1">Could not read the day{error || (data as any)?.error ? ' — ' + (error || (data as any)?.error) : ''}.</span>
        <button onClick={reload} className="font-bold underline">Retry</button>
      </div>
    )
  }
  const p = data.pulse
  const t = data.tiles
  const v = data.verdict
  const occ = p.active ? Math.round((p.occupiedTonight / p.active) * 100) : null
  const deskSub = [t.guestDesk.messages && t.guestDesk.messages + ' unread', t.guestDesk.welcome && t.guestDesk.welcome + ' calls', t.guestDesk.approvals && t.guestDesk.approvals + ' approvals', t.guestDesk.reviews && t.guestDesk.reviews + ' reviews'].filter(Boolean).join(' · ') || 'all quiet'

  const tiles: { key: TileKey; label: string; value: number | string; sub: string; tone: Tone; Icon: any }[] = [
    { key: 'cleans', label: 'Cleans', value: t.cleans.done + '/' + t.cleans.total, sub: t.cleans.late ? t.cleans.late + ' late' : t.cleans.atRisk ? t.cleans.atRisk + ' at risk' : t.cleans.running ? t.cleans.running + ' running' : t.cleans.total && t.cleans.done === t.cleans.total ? 'all landed' : 'on the 4pm clock', tone: t.cleans.late ? 'hot' : t.cleans.atRisk ? 'warn' : t.cleans.total && t.cleans.done === t.cleans.total ? 'ok' : 'quiet', Icon: Sparkle },
    { key: 'arrivals', label: 'Arrivals', value: t.arrivals.today, sub: t.arrivals.bigToday + ' big today' + (t.arrivals.missingInspection ? ' · ' + t.arrivals.missingInspection + ' uninspected' : t.arrivals.bigToday ? ' · inspected' : ''), tone: t.arrivals.missingInspection ? 'warn' : 'quiet', Icon: Crown },
    { key: 'tasks', label: 'Tasks', value: t.tasks.total, sub: t.tasks.open + ' open' + (t.tasks.unassigned ? ' · ' + t.tasks.unassigned + ' unowned' : '') + (t.tasks.urgent ? ' · ' + t.tasks.urgent + ' urgent' : ''), tone: t.tasks.unassigned || t.tasks.late ? 'warn' : 'quiet', Icon: Wrench },
    { key: 'team', label: 'Team', value: t.team.onShift, sub: t.team.onShift ? t.team.utilisationPct + '% loaded' + (t.team.overloaded ? ' · ' + t.team.overloaded + ' over' : '') + (t.team.idle.length ? ' · ' + t.team.idle.length + ' idle' : '') : 'nobody on shift', tone: t.team.utilisationPct > 100 || t.team.idle.length ? 'warn' : t.team.onShift ? 'quiet' : 'hot', Icon: Users },
    { key: 'glitches', label: 'Glitches', value: t.glitches.open, sub: t.glitches.overdue ? t.glitches.overdue + ' overdue' : t.glitches.noTask ? t.glitches.noTask + ' without a task' : t.glitches.open ? 'open on the board' : 'none open', tone: t.glitches.overdue ? 'hot' : t.glitches.noTask ? 'warn' : t.glitches.open ? 'quiet' : 'ok', Icon: ShieldAlert },
    { key: 'claims', label: 'Claims', value: t.claims.open, sub: t.claims.review ? t.claims.review + ' awaiting your review' : t.claims.dueSoon ? t.claims.dueSoon + ' due to file' : t.claims.open ? 'in flight' : 'none open', tone: t.claims.dueSoon ? 'hot' : t.claims.review ? 'warn' : 'quiet', Icon: Scale },
    { key: 'overdue', label: 'Overdue', value: t.overdue.total, sub: t.overdue.total ? [t.overdue.breezeway && t.overdue.breezeway + ' tasks', t.overdue.field && t.overdue.field + ' requests', t.overdue.glitches && t.overdue.glitches + ' glitches'].filter(Boolean).join(' · ') : 'backlog clear', tone: t.overdue.total > 40 ? 'hot' : t.overdue.total ? 'warn' : 'ok', Icon: History },
    { key: 'guestDesk', label: 'Guest desk', value: t.guestDesk.total, sub: deskSub, tone: t.guestDesk.messages || t.guestDesk.approvals ? 'warn' : 'quiet', Icon: MessageSquare },
  ]

  const vTone = v.state === 'behind' ? 'border-rose-300 bg-rose-50 text-rose-900' : v.state === 'at_risk' ? 'border-amber-300 bg-amber-50 text-amber-900' : v.state === 'closing' ? 'border-slate-300 bg-slate-50 text-slate-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'
  const vDot = v.state === 'behind' ? 'bg-rose-600' : v.state === 'at_risk' ? 'bg-amber-500' : v.state === 'closing' ? 'bg-slate-500' : 'bg-emerald-600'

  return (
    <div className="flex flex-col">
      {/* ── 1. VERDICT ─────────────────────────────────────────────────────────────────────────── */}
      <section className={'rounded-2xl border px-4 py-3 ' + vTone} aria-live="polite">
        <div className="flex items-start gap-3 flex-wrap">
          <span className={'mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ' + vDot} aria-hidden />
          <div className="flex-1 min-w-[220px]">
            <div className="text-[17px] font-bold leading-tight">{v.headline}<span className="font-normal opacity-80"> — {v.detail}</span></div>
            <div className="text-[12.5px] opacity-80 mt-0.5">{v.tomorrow}</div>
          </div>
          <button onClick={reload} aria-label="Refresh the day" title="Refresh" className="inline-flex items-center gap-1 text-[11.5px] opacity-70 hover:opacity-100 min-h-[36px] px-2">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {ago(data.generatedAt, tick)}
          </button>
        </div>
        {/* ── 2. PULSE ── */}
        <div className="mt-2 pt-2 border-t border-black/10 flex items-center gap-x-4 gap-y-1 flex-wrap text-[12.5px]">
          {occ != null && <span><b>Tonight {occ}% full</b> <span className="opacity-70">({p.occupiedTonight} of {p.active})</span></span>}
          <span><b>{p.arrivals}</b> arriving</span>
          <span><b>{p.departures}</b> leaving</span>
          <span className={p.sameDayTurns > 0 ? 'font-bold' : ''}>{p.sameDayTurns} same-day {p.sameDayTurns === 1 ? 'turn' : 'turns'}</span>
          <span><b>{p.cleansDone}/{p.cleansTotal}</b> cleans{p.cleansTotal > p.cleansDone ? <span className="opacity-70"> · {p.minsLeft < 0 ? fmtLeft(p.minsLeft) + ' past 4pm' : fmtLeft(p.minsLeft) + ' to 4pm'}</span> : null}</span>
          <span><b>{p.vacant}</b> vacant</span>
        </div>
        {data.degraded.length > 0 && (
          <div className="mt-2 text-[11.5px] font-semibold text-rose-800 flex items-center gap-1.5"><AlertTriangle size={12} /> Some numbers are incomplete — could not read: {data.degraded.join(', ')}.</div>
        )}
      </section>

      {/* ── 3. TILES (below the list on a phone) ───────────────────────────────────────────────── */}
      <div className="order-2 sm:order-1 mt-3 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
        {tiles.map(({ key, ...tl }) => <Tile key={key} {...tl} active={open === key} onClick={() => setOpen(open === key ? null : key)} />)}
      </div>
      {open && (
        <div className="order-2 sm:order-1 mt-2 rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-4 py-2 border-b border-line bg-app/60 flex items-center gap-2">
            <span className="text-[12.5px] font-bold text-ink">{tiles.find(x => x.key === open)?.label}</span>
            <span className="text-[11.5px] text-muted">{tiles.find(x => x.key === open)?.sub}</span>
            <button onClick={() => setOpen(null)} className={ICON_BTN + ' ml-auto text-muted hover:text-ink'} aria-label="Close"><X size={15} /></button>
          </div>
          <TilePanel key={open} k={open} d={data} roster={roster} onChanged={reload} />
        </div>
      )}

      {/* ── 4. DO NEXT (first on a phone) ─────────────────────────────────────────────────────── */}
      <div className="order-1 sm:order-2">
        <DoNext d={data} roster={roster} onChanged={reload} firstName={firstName} />
      </div>
    </div>
  )
}

type Tone = 'ok' | 'warn' | 'hot' | 'quiet'
function Tile({ label, value, sub, tone, Icon, active, onClick }: { label: string; value: number | string; sub: string; tone: Tone; Icon: any; active: boolean; onClick: () => void }) {
  const ring = tone === 'hot' ? 'border-rose-200 bg-rose-50/60' : tone === 'warn' ? 'border-amber-200 bg-amber-50/60' : tone === 'ok' ? 'border-emerald-200 bg-emerald-50/50' : 'border-line bg-white'
  const num = tone === 'hot' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-800' : 'text-ink'
  const ic = tone === 'hot' ? 'text-rose-500' : tone === 'warn' ? 'text-amber-500' : tone === 'ok' ? 'text-emerald-600' : 'text-muted'
  return (
    <button onClick={onClick} aria-expanded={active} aria-label={label + ': ' + value + ', ' + sub}
      className={'text-left rounded-2xl border p-3 min-h-[92px] transition-colors hover:border-ink/30 ' + ring + (active ? ' ring-2 ring-ink/70' : '')}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] uppercase tracking-wide text-muted font-semibold leading-tight">{label}</span>
        <Icon size={14} className={ic + ' shrink-0'} aria-hidden />
      </div>
      <div className={'text-[26px] leading-none font-bold mt-1.5 tabular-nums ' + num}>{value}</div>
      <div className="mt-1 text-[11px] text-muted leading-snug">{sub}</div>
    </button>
  )
}

// ── TILE DRAWERS ────────────────────────────────────────────────────────────────────────────────
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

function TilePanel({ k, d, roster, onChanged }: { k: TileKey; d: CommandDay; roster: Roster[]; onChanged: () => void }) {
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
            : <Pill cls="bg-app text-muted">Vendor</Pill>)}
          {r.today && !r.welcomeDone && <Link href="/welcome-calls" className="text-[11.5px] font-semibold text-brand-700 inline-flex items-center gap-1 min-h-[36px]"><Phone size={11} /> call</Link>}
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
        <Link key={c.id} href="/claims" className={ROW + ' hover:bg-app/40'}>
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
        <Link href="/messages">Messages →</Link><Link href="/welcome-calls">Welcome calls →</Link><Link href="/requests">Approvals →</Link><Link href="/reviews">Reviews →</Link>
      </div>
    </div>
  )
}

/** The capacity model, per person, with the moves it recommends. Assign-kind moves file here. */
function TeamPanel({ d, roster, onChanged }: { d: CommandDay; roster: Roster[]; onChanged: () => void }) {
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
      <div className="px-4 py-2"><Link href="/plan?tab=people" className="text-[12px] font-semibold text-brand-700">Open Staffing on the board →</Link></div>
    </div>
  )
}

// ── DO NEXT ─────────────────────────────────────────────────────────────────────────────────────
const KIND_LABEL: Record<NextItem['kind'], string> = { turn: 'Same-day', late: 'Late', inspection: 'Inspection', feedback: 'Feedback', pending: 'Backlog', duplicate: 'Duplicate', glitch: 'Guest issue', claim: 'Claim', guest: 'Guest', unassigned: 'Unowned' }
const KIND_CLS: Record<NextItem['kind'], string> = {
  turn: 'bg-rose-600 text-white', late: 'bg-rose-100 text-rose-700', inspection: 'bg-amber-100 text-amber-800', feedback: 'bg-violet-100 text-violet-700',
  pending: 'bg-sky-100 text-sky-700', duplicate: 'bg-neutral-200 text-neutral-700', glitch: 'bg-pink-100 text-pink-700', claim: 'bg-indigo-100 text-indigo-700',
  guest: 'bg-pink-100 text-pink-700', unassigned: 'bg-amber-100 text-amber-800',
}
const OWNER_CLS: Record<Owner, string> = { housekeeping: 'bg-sky-50 text-sky-800 border-sky-200', maintenance: 'bg-amber-50 text-amber-800 border-amber-200', desk: 'bg-pink-50 text-pink-800 border-pink-200', gm: 'bg-indigo-50 text-indigo-800 border-indigo-200' }
const SEV: { key: NextItem['severity']; label: string; sub: string; rail: string }[] = [
  { key: 'now', label: 'Now', sub: 'a guest feels this today', rail: 'border-l-rose-500' },
  { key: 'today', label: 'Before the day ends', sub: 'land it before 4pm', rail: 'border-l-amber-500' },
  { key: 'soon', label: 'Next 48 hours', sub: 'get ahead of it', rail: 'border-l-sky-500' },
]

function DoNext({ d, roster, onChanged, firstName }: { d: CommandDay; roster: Roster[]; onChanged: () => void; firstName: string }) {
  const items = d.next
  const [showDismissed, setShowDismissed] = useState(false)
  const [owner, setOwner] = useState<Owner | 'all'>('all')
  const [copied, setCopied] = useState(false)
  const live = useMemo(() => items.filter(i => !i.dismissed), [items])
  const shown = (showDismissed ? items : live).filter(i => owner === 'all' || i.owner === owner)
  const hiddenTotal = Object.values(d.hiddenSoon).reduce((a, b) => a + (b || 0), 0)

  // COORDINATION: the live list as text for the group chat / handover — the coordinator's
  // "here is the plan" message, written by the same engine that ranks it.
  const copyHandoff = async () => {
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const lines: string[] = ['LIGHTHOUSE — ' + when, d.verdict.headline + ' — ' + d.verdict.detail, '']
    for (const g of SEV) {
      const rows = live.filter(i => i.severity === g.key)
      if (!rows.length) continue
      lines.push(g.label.toUpperCase() + ' (' + rows.length + ')')
      for (const i of rows) lines.push('• ' + i.unit + ' — ' + i.title + ' · ' + OWNER_LABEL[i.owner] + ' · ' + i.due)
      lines.push('')
    }
    lines.push(d.verdict.tomorrow)
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }

  const ownerChips: { key: Owner | 'all'; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: live.length },
    ...(Object.keys(OWNER_LABEL) as Owner[]).map(o => ({ key: o, label: OWNER_LABEL[o], n: d.byOwner[o] })),
  ]

  return (
    <section className="mt-5">
      <div className="flex items-end gap-2 flex-wrap mb-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Sparkles size={12} /> Do next</p>
          <h2 className="text-[18px] font-bold text-ink tracking-tight leading-tight">{live.length ? live.length + ' thing' + (live.length === 1 ? '' : 's') + ' worth your attention, ' + firstName : 'Nothing needs you right now, ' + firstName}</h2>
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {live.length > 0 && (
            <button onClick={copyHandoff} className={BTN + ' border border-line bg-white text-ink hover:border-ink/40'} title="Copy the live list as text for the group chat">
              {copied ? <><Check size={12} className="text-emerald-600" /> Copied</> : <><Copy size={12} /> Copy handoff</>}
            </button>
          )}
          {d.dismissedCount > 0 && (
            <button onClick={() => setShowDismissed(s => !s)} className={BTN + ' text-muted hover:text-ink'}>
              {showDismissed ? <EyeOff size={12} /> : <Eye size={12} />} {d.dismissedCount} dismissed{showDismissed ? ' · hide' : ''}
            </button>
          )}
        </div>
      </div>
      {live.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2" role="tablist" aria-label="Filter by owner">
          {ownerChips.map(c => (
            <button key={c.key} role="tab" aria-selected={owner === c.key} onClick={() => setOwner(c.key)}
              className={'text-[12px] font-semibold px-3 py-1.5 rounded-full border min-h-[32px] ' + (owner === c.key ? 'bg-ink text-white border-ink' : c.n ? 'bg-white text-ink border-line hover:border-ink/40' : 'bg-white text-muted border-line')}>
              {c.label} <span className={owner === c.key ? 'opacity-80' : 'text-muted'}>{c.n}</span>
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-5 text-[13px] text-emerald-900 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600" /> {owner === 'all' ? 'Turns covered, arrivals inspected, no open duplicates, nothing overdue on the boards.' : 'Nothing on the ' + OWNER_LABEL[owner as Owner] + ' lane right now.'}
        </div>
      ) : SEV.map(g => {
        const rows = shown.filter(i => i.severity === g.key)
        if (!rows.length) return null
        return (
          <div key={g.key} className="rounded-2xl border border-line bg-white overflow-hidden mb-2.5">
            <div className="px-4 pt-2.5 pb-1.5 flex items-baseline gap-2 bg-app/50 border-b border-line">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink/80">{g.label}</span>
              <span className="text-[11px] text-muted">· {rows.length} — {g.sub}</span>
            </div>
            <div className="divide-y divide-line">
              {rows.map(i => <NextRow key={i.key} item={i} rail={g.rail} roster={roster} onChanged={onChanged} />)}
            </div>
            {g.key === 'soon' && hiddenTotal > 0 && (
              <div className="px-4 py-2 text-[11.5px] text-muted border-t border-line">
                + {hiddenTotal} more in the next 48 hours not shown ({Object.entries(d.hiddenSoon).map(([k, n]) => n + ' ' + KIND_LABEL[k as NextItem['kind']].toLowerCase()).join(', ')}) — <Link href="/plan" className="font-semibold text-brand-700">Today in Ops</Link> has the full board.
              </div>
            )}
          </div>
        )
      })}
      <p className="text-[11.5px] text-muted px-1 mt-1">The engine proposes; a person commits. Assign, create, note and dismiss are one tap. Nothing here completes a task; cancelling a duplicate asks for the admin password.</p>
    </section>
  )
}

function NextRow({ item: i, rail, roster, onChanged }: { item: NextItem; rail: string; roster: Roster[]; onChanged: () => void }) {
  const [mode, setMode] = useState<'' | 'assign' | 'cancel' | 'note'>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const [pw, setPw] = useState('')
  const [note, setNote] = useState('')
  const dismissed = !!i.dismissed

  const post = async (url: string, method: string, body: any) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false || j.error) throw new Error(j.error || 'Request failed'); return j
  }
  const wrap = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e: any) { setErr(String(e?.message || e)) } setBusy(false) }
  const dismiss = (undo: boolean) => wrap(async () => { await post('/api/command/dismiss', undo ? 'DELETE' : 'POST', { key: i.key }); onChanged() })
  const run = (a: NextAction) => {
    if (a.type === 'open') return
    if (a.type === 'assign') { setMode(mode === 'assign' ? '' : 'assign'); return }
    if (a.type === 'cancel_task') { setMode(mode === 'cancel' ? '' : 'cancel'); return }
    wrap(async () => { await post('/api/ops-today/add-task', 'POST', a.payload); setDone('Filed in Breezeway'); onChanged() })
  }
  const cancelDup = () => wrap(async () => {
    if (i.action?.type !== 'cancel_task') return
    await post('/api/ops-today/task-action', 'POST', { taskId: i.action.taskId, action: 'delete', adminPassword: pw })
    setDone('Duplicate cancelled'); setMode(''); onChanged()
  })
  // COORDINATION: a note lands on the Breezeway task (and in the app thread) where the person
  // doing the work will see it — the 3-way comment route the board already uses.
  const sendNote = () => wrap(async () => {
    if (!i.bzTaskId || !note.trim()) return
    await post('/api/comments', 'POST', { type: 'task', id: i.bzTaskId, body: note.trim(), label: i.unit, link: '/command' })
    setDone('Note sent to the task'); setNote(''); setMode('')
  })

  return (
    <div className={'pl-3 pr-3 py-2.5 border-l-4 ' + rail + (dismissed ? ' opacity-50' : '')}>
      <div className="flex items-start gap-2.5 flex-wrap">
        <span className={'lh-chip text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 mt-1 w-auto sm:w-[80px] text-center ' + KIND_CLS[i.kind]}>{KIND_LABEL[i.kind]}</span>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13.5px] font-bold text-ink">{i.unit}</span>
            {i.market && <span className="text-[10.5px] font-semibold text-muted bg-app rounded px-1.5 py-0.5">{i.market}</span>}
            <span className="text-[13px] text-ink/85">{i.title}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className={'text-[10.5px] font-bold px-1.5 py-0.5 rounded border ' + OWNER_CLS[i.owner]}>{OWNER_LABEL[i.owner]}</span>
            <span className="text-[11.5px] font-semibold text-ink/70 inline-flex items-center gap-1"><Clock size={11} aria-hidden /> {i.due}</span>
            <span className="text-[12px] text-muted leading-snug">{i.why}</span>
          </div>
          {i.evidence && <p className="text-[12px] text-ink/70 italic mt-0.5 leading-snug">&ldquo;{i.evidence.quote}&rdquo; <span className="not-italic text-muted">— {i.evidence.stars != null ? (/booking/i.test(i.evidence.channel) ? Math.round(i.evidence.stars * 20) / 10 + '/10 · ' : i.evidence.stars + '★ · ') : ''}{i.evidence.channel}{i.evidence.date ? ' · ' + i.evidence.date : ''}</span></p>}
          {dismissed && <p className="text-[11.5px] text-muted mt-0.5">Dismissed by {i.dismissed!.by.split('@')[0]}</p>}
          {err && <p className="text-[11.5px] text-rose-600 font-semibold mt-1">{err}</p>}
          {done && <p className="text-[11.5px] text-emerald-700 font-semibold mt-1 inline-flex items-center gap-1"><Check size={12} /> {done}</p>}
        </div>
        <span className="flex items-center gap-1.5 shrink-0 ml-auto w-full justify-end sm:w-auto">
          {!done && !dismissed && i.action && (i.action.type === 'open'
            ? (i.action.external
              ? <a href={i.action.href} target="_blank" rel="noreferrer" className={BTN + ' border border-line bg-white text-ink hover:border-ink/40'}>{i.action.label} <ExternalLink size={11} /></a>
              : <Link href={i.action.href} className={BTN + ' border border-line bg-white text-ink hover:border-ink/40'}>{i.action.label} →</Link>)
            : <button onClick={() => run(i.action!)} disabled={busy} className={BTN + ' ' + (mode === 'assign' || mode === 'cancel' ? 'bg-white border border-ink text-ink' : 'bg-ink text-white')}>
                {busy ? <Loader2 size={11} className="animate-spin" /> : i.action.type === 'assign' ? <UserPlus size={11} /> : null} {i.action.label}
              </button>)}
          {i.bzTaskId && !dismissed && (
            <button onClick={() => setMode(mode === 'note' ? '' : 'note')} aria-expanded={mode === 'note'} title="Send a note to whoever holds this task" className={ICON_BTN + ' border border-line bg-white text-muted hover:text-ink' + (mode === 'note' ? ' border-ink text-ink' : '')}><MessageSquare size={14} /></button>
          )}
          {i.bzTaskId && i.action?.type !== 'open' && <BzLink id={i.bzTaskId} />}
          {dismissed
            ? <button onClick={() => dismiss(true)} disabled={busy} aria-label="Bring back" className={BTN + ' text-muted hover:text-ink'}><Undo2 size={13} /> undo</button>
            : <button onClick={() => dismiss(false)} disabled={busy} aria-label="Dismiss for today, for everyone" title="Dismiss for today (everyone sees it go)" className={ICON_BTN + ' text-muted hover:text-emerald-600'}><CheckCircle2 size={16} /></button>}
        </span>
      </div>
      {mode === 'assign' && i.action?.type === 'assign' && <InlineAssign taskId={i.action.taskId} dept={i.action.dept} roster={roster} onDone={() => { setMode(''); setDone('Assigned'); onChanged() }} />}
      {mode === 'note' && (
        <div className="mt-2 pt-2 border-t border-line flex items-center gap-2 flex-wrap">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for whoever holds this task — lands on the Breezeway task" className="flex-1 min-w-[200px] rounded-lg border border-line px-3 py-2 text-[13px]" onKeyDown={e => { if (e.key === 'Enter') sendNote() }} />
          <button onClick={sendNote} disabled={busy || !note.trim()} className={BTN + ' bg-ink text-white'}>{busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send</button>
        </div>
      )}
      {mode === 'cancel' && (
        <div className="mt-2 pt-2 border-t border-line flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-muted">Cancelling a task needs the admin password.</span>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Admin password" aria-label="Admin password" className="rounded-lg border border-line px-3 py-2 text-[13px] w-44" />
          <button onClick={cancelDup} disabled={busy || !pw} className={BTN + ' bg-rose-600 text-white'}>{busy ? <Loader2 size={11} className="animate-spin" /> : null} Cancel the duplicate</button>
        </div>
      )}
    </div>
  )
}

/** Assign a Breezeway task inline: filtered roster, one tap, done. Errors stay in the row. */
function InlineAssign({ taskId, dept, roster, onDone }: { taskId: string; dept: string; roster: Roster[]; onDone: () => void }) {
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
          className="text-[12px] font-semibold px-3 py-2 rounded-full border border-line bg-white hover:border-ink/40 disabled:opacity-50 min-h-[36px]">
          {busy === p.id ? <Loader2 size={11} className="animate-spin inline" /> : null} {p.name}
        </button>
      ))}
      {!all && roster.length > ppl.length && <button onClick={() => setAll(true)} className="text-[12px] font-semibold text-brand-700 min-h-[36px] px-2">everyone ({roster.length})</button>}
      {err && <span className="text-[11.5px] text-rose-600 font-semibold">{err}</span>}
    </div>
  )
}

function CockpitSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-[92px] rounded-2xl bg-white border border-line" />
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[92px] rounded-2xl bg-white border border-line" />)}</div>
      <div className="mt-5 h-6 w-56 rounded bg-app" />
      <div className="mt-2 h-40 rounded-2xl bg-white border border-line" />
    </div>
  )
}

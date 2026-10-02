'use client'
// THE WORK TODAY — NEEDED vs COMPLETED (Jon, 2026-09-30).
//
//   "It should show welcome calls needed versus completed, review recovery calls needed versus
//    completed, inspections needed (the important inspections) versus completed. Departure cleans:
//    completed versus pending versus not started. Clear insight into day-to-day operations, the
//    granular data from there, and push a message out via Slack to the assigned team members.
//    Same with maintenance: organized in a way that's easy for our team to maneuver through."
//
// Five tiles, one per stream of work, each reading DONE / NEEDED with a bar split by state. A tile
// is a switch: click it and its granular list opens right under the strip — every row one line with
// its buttons (Assign · Message on Slack · log the call · open in Breezeway) — with state chips that
// filter in place and one "Message the team" that reaches every person with open work in view.
//
//   Departure cleans   done · in progress · not started · late / at risk   (lib/command-day cleans)
//   Inspections        the ones that matter: every inspection on today's board, plus a big arrival
//                      today or tomorrow with nothing walking the unit                (tasks + arrivals)
//   Welcome calls      every pre-arrival call inside its 72-hour window   (/api/command/calls, the Calls desk)
//   Recovery calls     calls that exist because the unit is in review recovery: the pre-arrival call
//                      into it and the post-checkout call out of it          (/api/command/calls)
//   Maintenance        today's maintenance work: urgent · unassigned · open · in progress · done   (tasks)
//
// Numbers come from the same reads the rest of the page uses, so the strip and the lanes never
// disagree. Nothing here completes a Breezeway task; a call is logged the way the Calls desk logs it.
import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ExternalLink, UserPlus, Loader2, Phone, ChevronUp } from 'lucide-react'
import { Tag, type Tone } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { CommandDay, NextItem, TaskRow } from '@/lib/command-day'
import { InlineAssign, type Roster } from '@/components/CommandCockpit'
import { Row, CleanRow, InspectionTaskRow, ArrivalInspectionRow, GlitchRow, LIST, GHOST, DARK, bz, money, INSPECT, tomorrowOf } from '@/components/command/Hub'
import { Check } from 'lucide-react'
import { NudgeBtn } from '@/components/command/Nudge'
import { useTaskActions, TaskStateTag, type TaskState } from '@/components/task/TaskActions'
import type { DayCalls, DayCallRow } from '@/app/api/command/calls/route'
import { UnpaidRow, type UnpaidRowT } from '@/components/UnpaidBoard'

export const CALLS_URL = '/api/command/calls'
type Key = 'cleans' | 'insp' | 'welcome' | 'recovery' | 'maint' | 'unpaid' | 'glitches' | 'claims' | 'checklist'
const CK_URL = '/api/daily-checklist'
type CkRowT = { id: string; title: string; by_time: string | null; owner_role: string | null; link: string | null; done: boolean; late: boolean; in_minutes: number | null; done_by: string | null }
const UNPAID_URL = '/api/unpaid'   // today → +7 days, direct / VRBO / Google only
type Seg = { label: string; n: number; cls: string; tone: Tone; filter: string }
type Item = { key: string; state: string; taskId?: string; who?: string; node: ReactNode; sort: number }

async function post(url: string, body: any) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false || j.error) throw new Error(j.error || j.message || 'Request failed')
  return j
}
const isMaint = (t: TaskRow) => t.dept === 'maintenance' || /maint/i.test(t.dept)
const isInsp = (t: TaskRow) => t.dept === 'inspection' || INSPECT.test(t.name) || /inspect/i.test(t.type)

// ── a maintenance task row ──────────────────────────────────────────────────────────────────────
const PRIO: Record<string, { tone: Tone; label: string }> = { urgent: { tone: 'roseSolid', label: 'urgent' }, high: { tone: 'rose', label: 'high' }, normal: { tone: 'slate', label: 'normal' }, low: { tone: 'slate', label: 'low' } }
function MaintRow({ t, roster, canAssign: _canAssign, onChanged }: { t: TaskRow; roster: Roster[]; canAssign: boolean; onChanged: () => void }) {
  const nobody = !t.who
  const state: TaskState = t.state === 'done' ? 'done' : t.late ? 'late' : t.state === 'running' ? 'running' : 'open'
  const pr = PRIO[String(t.prio || '').toLowerCase()]
  const ta = useTaskActions({ taskId: t.taskId, dept: 'maintenance', label: t.unit + ' — ' + t.name, link: '/maintenance', state, who: t.who, roster, onChanged })
  return (
    <Row dot={!ta.done && (nobody || t.late || t.prio === 'urgent') ? (t.late || t.prio === 'urgent' ? 'rose' : 'amber') : null} title={t.unit}
      tags={<>
        <TaskStateTag state={ta.done ? 'done' : state} />
        {nobody && !ta.done && <TaskStateTag state="unassigned" />}
        {pr && (pr.label === 'urgent' || pr.label === 'high') && !ta.done && <Tag tone={pr.tone} title="Priority in Breezeway">{pr.label}</Tag>}
      </>}
      meta={[t.name, t.who, t.market].filter(Boolean).join(' · ')}
      actions={ta.actions}>
      {ta.panels}
    </Row>
  )
}

// ── a call row (welcome or recovery), logged the way the Calls desk logs it ────────────────────
function DayCallRowView({ r, canLog, onChanged }: { r: DayCallRow; canLog: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')
  const isPost = r.kind === 'post'
  const log = async (outcome: string) => {
    setBusy(outcome); setErr('')
    try {
      if (isPost) await post('/api/post-checkout-call', { reservationId: r.id, outcome })
      else await post('/api/welcome-call', { reservationId: r.id, outcome })
      setDone(outcome); onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const when = r.today ? (isPost ? 'checked out today' : 'arrives today') : (isPost ? 'out ' : 'in ') + r.date.slice(5)
  const recTag = r.recovery ? <Tag tone="rose" title={'The unit is in review recovery: a ' + r.recovery.rating + '★ ' + r.recovery.channel + ' review ' + r.recovery.openDays + ' days ago and nothing good since'}>{r.recovery.rating}★ · {r.recovery.openDays}d in recovery</Tag> : null
  const B = (o: string, label: string, title: string, primary?: boolean) => (
    <button onClick={() => log(o)} disabled={!!busy} className={primary ? DARK : GHOST} title={title}>{busy === o ? <Loader2 size={12} className="animate-spin" /> : null}{label}</button>
  )
  const shown = done || (r.done ? r.outcome : '')
  if (shown) {
    const lbl = shown === 'no_answer' ? 'no answer — try again' : shown === 'voicemail' ? 'voicemail left' : shown === 'issue' ? 'called — issue raised' : shown === 'happy' ? 'called — happy' : 'called'
    return <Row title={r.guest} tags={<><Tag tone={shown === 'no_answer' ? 'amber' : 'emerald'} title={r.calledBy ? 'By ' + r.calledBy : ''}>{lbl}</Tag>{recTag}</>} meta={[r.unit, when, r.calledBy].filter(Boolean).join(' · ')} />
  }
  return (
    <Row dot={r.today ? (r.mandatory ? 'rose' : 'amber') : null} title={r.guest} err={err}
      tags={<>
        <Tag tone={isPost ? 'violet' : 'sky'} title={isPost ? 'Post-checkout follow-up' : 'Pre-arrival welcome call'}>{isPost ? 'after stay' : 'welcome'}</Tag>
        {r.mandatory && !r.recovery && <Tag tone="violet" title={'Mandatory — ' + r.tier + ' tier'}>{r.tier}</Tag>}
        {recTag}
        {r.value >= 1000 && <Tag tone="slate" title={money(r.value) + ' booking'}>{money(r.value)}</Tag>}
        {r.claimedBy && <Tag tone="amber" title="Somebody has claimed this call">{r.claimedBy.split(' ')[0]} on it</Tag>}
        {r.attempts > 0 && <Tag tone="slate" title="Attempts so far">{r.attempts} tr{r.attempts === 1 ? 'y' : 'ies'}</Tag>}
      </>}
      meta={[r.unit, when, r.nights ? r.nights + ' nights' : ''].filter(Boolean).join(' · ')}
      actions={canLog ? (isPost ? <>
        {B('happy', 'Happy', 'Spoke to the guest — all good', true)}
        {B('issue', 'Issue', 'Spoke to the guest — something to fix or make right')}
        {B('no_answer', 'No answer', 'No answer — stays on the list')}
      </> : <>
        {B('reached', 'Reached', 'Spoke to the guest — logs the call on the booking and in Guesty', true)}
        {B('voicemail', 'Voicemail', 'Left a voicemail — counts as called')}
        {B('no_answer', 'No answer', 'No answer — stays on the list for another try')}
      </>) : <Link href="/welcome-calls" className={GHOST}><Phone size={12} /> Open</Link>} />
  )
}

// ── the tile ────────────────────────────────────────────────────────────────────────────────────
function Tile({ label, done, needed, segs, sub, on, onClick, title, loading, big }: { label: string; done: number; needed: number; segs: Seg[]; sub: string; on: boolean; onClick: () => void; title: string; loading?: boolean; big?: { value: string; unit: string; tone: string } }) {
  const pct = needed ? Math.round((done / needed) * 100) : 100
  const tone = big ? big.tone : !needed ? 'text-muted' : done === needed ? 'text-emerald-700' : segs.some(s => s.n && /late|urgent|unassigned/.test(s.filter)) ? 'text-rose-700' : 'text-ink'
  return (
    <button onClick={onClick} aria-pressed={on} title={title + (on ? ' — click to close the list' : ' — click to open the list')}
      className={'text-left rounded-xl border bg-white px-2.5 sm:px-3 py-2 min-h-[72px] sm:min-h-[84px] transition flex flex-col gap-1 min-w-0 ' + (on ? 'border-brand-400 ring-2 ring-brand-100' : 'border-line hover:border-ink/30')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-wider font-bold text-muted truncate">{label}</span>
        {loading ? <Loader2 size={11} className="animate-spin text-muted" /> : <span className={'text-[10.5px] font-bold tabular-nums ' + (needed ? 'text-muted' : 'text-muted/50')}>{needed ? pct + '%' : ''}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        {big ? <>
          <span className={'text-[22px] leading-none font-bold tabular-nums ' + tone}>{big.value}</span>
          <span className="text-[11px] text-muted ml-1 truncate">{big.unit}</span>
        </> : <>
          <span className={'text-[22px] leading-none font-bold tabular-nums ' + tone}>{done}</span>
          <span className="text-[13px] font-semibold text-muted tabular-nums">/ {needed}</span>
          <span className="text-[11px] text-muted ml-1">{needed ? 'done' : loading ? 'reading…' : 'none today'}</span>
        </>}
      </div>
      <div className="w-full h-1.5 rounded-full bg-line overflow-hidden flex" aria-hidden>
        {needed > 0 && segs.filter(s => s.n > 0).map(s => <span key={s.filter} className={'block h-full ' + s.cls} style={{ width: (s.n / needed) * 100 + '%' }} title={s.n + ' ' + s.label} />)}
      </div>
      <div className="text-[11px] text-muted truncate w-full" title={sub}>{sub || ' '}</div>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function DayKpis({ d, live, roster, can, onChanged }: {
  d: CommandDay; live: NextItem[]; roster: Roster[]; can: { assign: boolean; plan: boolean; calls: boolean }; onChanged: () => void
}) {
  const [open, setOpen] = useState<Key | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const callsQ = useCachedFetch<DayCalls & { error?: string }>(CALLS_URL, { ttl: 60_000 })
  const calls = callsQ.data && callsQ.data.ok ? callsQ.data : null
  const reloadCalls = () => { invalidateCache(CALLS_URL); callsQ.refresh() }
  const changed = () => { onChanged(); reloadCalls() }
  const t = d.tiles

  // ── unpaid (Jon, 2026-10-01: "make a tile up top to show unpaid") ──
  const unpaidQ = useCachedFetch<{ ok?: boolean; today?: string; rows?: UnpaidRowT[]; canEdit?: boolean }>(UNPAID_URL, { ttl: 5 * 60_000 })
  const [unpaidPatch, setUnpaidPatch] = useState<Record<string, UnpaidRowT['tracking']>>({})
  const unpaidRows = (unpaidQ.data?.rows || []).map(r => unpaidPatch[r.id] ? { ...r, tracking: unpaidPatch[r.id] } : r).filter(r => r.tracking.status !== 'waived')
  const uOwed = unpaidRows.reduce((a, r) => a + r.balance, 0)
  const uToday = unpaidRows.filter(r => r.bucket === 'in_house' || r.bucket === 'today').length
  const uOpen = unpaidRows.filter(r => r.tracking.status === 'open').length
  const uContacted = unpaidRows.filter(r => r.tracking.status === 'contacted').length
  const uPromised = unpaidRows.filter(r => r.tracking.status === 'promised').length
  const uDisputed = unpaidRows.filter(r => r.tracking.status === 'disputed').length
  const onUnpaidPatch = (id: string, tr: UnpaidRowT['tracking']) => { setUnpaidPatch(p => ({ ...p, [id]: tr })); invalidateCache(UNPAID_URL) }

  // ── glitch board, claim board, checklist board (Jon, 2026-10-02: "should be a glitch board here, claim board, checklist board") ──
  const gl = t.glitches, cl = t.claims
  const glCovered = Math.max(0, gl.open - gl.overdue - gl.noTask)
  const clOk = Math.max(0, cl.open - cl.dueSoon)
  const ckQ = useCachedFetch<{ ok?: boolean; rows?: CkRowT[]; progress?: { total: number; done: number; late: number; pct: number }; canTick?: boolean }>(CK_URL, { ttl: 60_000 })
  const ckRows = ckQ.data?.rows || []
  const ckDone = ckRows.filter(r => r.done).length, ckLate = ckRows.filter(r => r.late).length
  const ckSoon = ckRows.filter(r => !r.done && !r.late && r.in_minutes != null && r.in_minutes <= 60).length
  const [ckBusy, setCkBusy] = useState('')
  const tickCk = async (id: string) => { setCkBusy(id); try { await fetch(CK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tick', itemId: id, done: true }) }); invalidateCache(CK_URL); ckQ.refresh() } finally { setCkBusy('') } }
  const clock12 = (tm: string | null) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(tm || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}` }

  // ── cleans ──
  const cleans = t.cleans.rows.filter(c => c.status !== 'vendor' && c.status !== 'extended')   // done rows stay: the shared strip reads 'done' and draws no verbs
  const cDone = cleans.filter(c => c.status === 'done').length
  const cRun = cleans.filter(c => c.status === 'running').length
  const cTrouble = cleans.filter(c => c.status === 'late' || c.status === 'atRisk').length
  const cOpen = cleans.filter(c => c.status === 'open').length
  const cNobody = cleans.filter(c => c.status !== 'done' && !c.who).length
  const valueByUnit: Record<string, number> = {}
  for (const a of t.arrivals.rows) if (a.today) valueByUnit[a.unit] = Math.max(valueByUnit[a.unit] || 0, a.value)

  // ── inspections that matter ──
  const inspTasks = t.tasks.rows.filter(isInsp)
  const bigSoon = t.arrivals.rows.filter(a => a.big && a.inspection !== 'n/a' && (a.today || a.checkIn <= tomorrowOf(d.today)))
  const bigUnits = new Set(bigSoon.map(a => a.unit))
  const arrivalsInsp = bigSoon.filter(a => !inspTasks.some(x => x.taskId === a.inspectionTaskId))
  const iNeeded = inspTasks.length + arrivalsInsp.filter(a => a.inspection !== 'done').length
  const iDone = inspTasks.filter(x => x.state === 'done').length
  const iRun = inspTasks.filter(x => x.state === 'running').length
  const iNobody = inspTasks.filter(x => x.state !== 'done' && !x.who).length
  const iMissing = arrivalsInsp.filter(a => a.inspection === 'none').length
  const iSched = iNeeded - iDone - iRun - iNobody - iMissing
  const createFor = (resId: string) => live.find(i => i.key === 'insp:' + resId && i.action?.type === 'create_task') || null

  // ── maintenance ──
  const maint = t.tasks.rows.filter(x => isMaint(x) && !isInsp(x))
  const mDone = maint.filter(x => x.state === 'done').length
  const mRun = maint.filter(x => x.state === 'running').length
  const mNobody = maint.filter(x => x.state !== 'done' && !x.who).length
  const mUrgent = maint.filter(x => x.state !== 'done' && (x.prio === 'urgent' || x.prio === 'high')).length
  const mOpen = maint.length - mDone - mRun - mNobody

  // ── calls ──
  const w = calls?.welcome, rc = calls?.recovery
  const wOwedToday = w ? w.todayNeeded - w.todayDone : 0

  const tiles: { key: Key; label: string; done: number; needed: number; segs: Seg[]; sub: string; title: string; loading?: boolean; big?: { value: string; unit: string; tone: string } }[] = [
    { key: 'cleans', label: 'Departure cleans', done: cDone, needed: cleans.length, title: 'Departure cleans on today’s board: done, in progress, not started, and the ones the clock says are late or at risk',
      segs: [{ label: 'done', n: cDone, cls: 'bg-emerald-500', tone: 'emerald', filter: 'done' }, { label: 'in progress', n: cRun, cls: 'bg-sky-400', tone: 'sky', filter: 'running' }, { label: 'not started', n: cOpen, cls: 'bg-slate-300', tone: 'slate', filter: 'open' }, { label: 'late / at risk', n: cTrouble, cls: 'bg-rose-500', tone: 'rose', filter: 'late' }],
      sub: [cRun ? cRun + ' in progress' : '', cOpen ? cOpen + ' not started' : '', cTrouble ? cTrouble + ' late/at risk' : '', cNobody ? cNobody + ' nobody on it' : ''].filter(Boolean).join(' · ') || (cleans.length ? 'all done' : '') },
    { key: 'insp', label: 'Inspections', done: iDone, needed: iNeeded, title: 'The inspections that matter: every inspection on today’s board, plus a big arrival today or tomorrow with nothing walking the unit',
      segs: [{ label: 'done', n: iDone, cls: 'bg-emerald-500', tone: 'emerald', filter: 'done' }, { label: 'in progress', n: iRun, cls: 'bg-sky-400', tone: 'sky', filter: 'running' }, { label: 'scheduled', n: Math.max(0, iSched), cls: 'bg-slate-300', tone: 'slate', filter: 'open' }, { label: 'unassigned', n: iNobody, cls: 'bg-amber-400', tone: 'amber', filter: 'unassigned' }, { label: 'missing', n: iMissing, cls: 'bg-rose-500', tone: 'rose', filter: 'missing' }],
      sub: [iNobody ? iNobody + ' unconfirmed' : '', iMissing ? iMissing + ' big arrival' + (iMissing === 1 ? '' : 's') + ' uncovered' : bigSoon.length ? bigSoon.length + ' big arrival' + (bigSoon.length === 1 ? '' : 's') + ' covered' : '', iRun ? iRun + ' in progress' : ''].filter(Boolean).join(' · ') || (iNeeded ? 'all walked' : 'no big arrivals') },
    { key: 'welcome', label: 'Welcome calls', done: w?.done || 0, needed: w?.needed || 0, loading: !calls && callsQ.loading, title: 'Pre-arrival welcome calls inside their 72-hour window — done against needed, and how many of today’s arrivals are still owed one',
      segs: [{ label: 'done', n: w?.done || 0, cls: 'bg-emerald-500', tone: 'emerald', filter: 'done' }, { label: 'owed today', n: wOwedToday, cls: 'bg-rose-500', tone: 'rose', filter: 'today' }, { label: 'due', n: Math.max(0, (w?.needed || 0) - (w?.done || 0) - wOwedToday), cls: 'bg-slate-300', tone: 'slate', filter: 'open' }],
      sub: callsQ.error || (calls && !calls.ok) ? 'could not read the Calls desk' : w ? [wOwedToday ? wOwedToday + ' arriving today still owed' : (w.todayNeeded ? 'today’s arrivals all called' : 'no arrivals today'), (w.needed - w.done - wOwedToday) > 0 ? (w.needed - w.done - wOwedToday) + ' due in the next 3 days' : ''].filter(Boolean).join(' · ') : '' },
    { key: 'recovery', label: 'Recovery calls', done: rc?.done || 0, needed: rc?.needed || 0, loading: !calls && callsQ.loading, title: 'Calls that exist because the unit is in review recovery (a 3★-or-under review with nothing good since): the pre-arrival call into it and the post-checkout call out of it',
      segs: [{ label: 'done', n: rc?.done || 0, cls: 'bg-emerald-500', tone: 'emerald', filter: 'done' }, { label: 'open', n: Math.max(0, (rc?.needed || 0) - (rc?.done || 0)), cls: 'bg-amber-400', tone: 'amber', filter: 'open' }],
      sub: calls?.recoveryFailed ? 'recovery scan failed — see the Calls desk' : rc ? [rc.pre ? rc.pre + ' pre-arrival' : '', rc.post ? rc.post + ' after checkout' : ''].filter(Boolean).join(' · ') || 'no units in recovery with a guest moving' : '' },
    { key: 'maint', label: 'Maintenance', done: mDone, needed: maint.length, title: 'Today’s maintenance work in Breezeway: urgent and high first, then what nobody is on, open, in progress, done',
      segs: [{ label: 'done', n: mDone, cls: 'bg-emerald-500', tone: 'emerald', filter: 'done' }, { label: 'in progress', n: mRun, cls: 'bg-sky-400', tone: 'sky', filter: 'running' }, { label: 'open', n: Math.max(0, mOpen), cls: 'bg-slate-300', tone: 'slate', filter: 'open' }, { label: 'unassigned', n: mNobody, cls: 'bg-amber-400', tone: 'amber', filter: 'unassigned' }],
      sub: [mUrgent ? mUrgent + ' urgent/high' : '', mNobody ? mNobody + ' unassigned' : '', mRun ? mRun + ' in progress' : ''].filter(Boolean).join(' · ') || (maint.length ? 'all closed' : 'nothing on the board') },
    { key: 'unpaid', label: 'Unpaid', done: unpaidRows.length - uOpen, needed: unpaidRows.length, loading: !unpaidQ.data && unpaidQ.loading,
      big: { value: unpaidQ.data ? money(uOwed) : '—', unit: unpaidRows.length ? 'owed · ' + unpaidRows.length + (unpaidRows.length === 1 ? ' stay' : ' stays') : 'nothing owed', tone: uToday ? 'text-rose-700' : unpaidRows.length ? 'text-ink' : 'text-emerald-700' },
      title: 'Money still owed by direct, VRBO and Google guests in house, arriving today or in the next 7 days — every other channel pays us itself. The bar is how far the chase has got',
      segs: [{ label: 'promised', n: uPromised, cls: 'bg-emerald-500', tone: 'emerald', filter: 'promised' }, { label: 'contacted', n: uContacted, cls: 'bg-sky-400', tone: 'sky', filter: 'contacted' }, { label: 'disputed', n: uDisputed, cls: 'bg-rose-500', tone: 'rose', filter: 'disputed' }, { label: 'not contacted', n: uOpen, cls: 'bg-slate-300', tone: 'slate', filter: 'open' }],
      sub: unpaidQ.error ? 'could not read the folios' : unpaidRows.length ? [uToday ? uToday + ' to collect today' : '', uOpen ? uOpen + ' not contacted' : 'everyone contacted'].filter(Boolean).join(' · ') : 'direct, VRBO and Google all paid' },
    { key: 'glitches', label: 'Glitches', done: glCovered, needed: gl.open, title: 'Open guest issues: past due, with no Breezeway task yet, and the ones with a task and an owner',
      big: { value: String(gl.open), unit: gl.open === 1 ? 'open' : 'open', tone: gl.overdue ? 'text-rose-700' : gl.open ? 'text-ink' : 'text-emerald-700' },
      segs: [{ label: 'on it', n: glCovered, cls: 'bg-emerald-500', tone: 'emerald', filter: 'covered' }, { label: 'no task', n: gl.noTask, cls: 'bg-amber-400', tone: 'amber', filter: 'notask' }, { label: 'overdue', n: gl.overdue, cls: 'bg-rose-500', tone: 'rose', filter: 'overdue' }],
      sub: gl.open ? [gl.overdue ? gl.overdue + ' overdue' : 'none overdue', gl.noTask ? gl.noTask + ' without a task' : ''].filter(Boolean).join(' · ') : 'no open glitches' },
    { key: 'claims', label: 'Claims', done: clOk, needed: cl.open, title: 'Damage claims in flight: the filing countdown per channel, the ones due soon first',
      big: { value: String(cl.open), unit: 'open', tone: cl.dueSoon ? 'text-rose-700' : cl.open ? 'text-ink' : 'text-emerald-700' },
      segs: [{ label: 'on track', n: clOk, cls: 'bg-emerald-500', tone: 'emerald', filter: 'ok' }, { label: 'due soon', n: cl.dueSoon, cls: 'bg-rose-500', tone: 'rose', filter: 'due' }],
      sub: cl.open ? [cl.dueSoon ? cl.dueSoon + ' due within 3 days' : 'nothing due soon', cl.review ? cl.review + ' in review' : ''].filter(Boolean).join(' · ') : 'no open claims' },
    { key: 'checklist', label: 'Checklist', done: ckDone, needed: ckRows.length, loading: !ckQ.data && ckQ.loading, title: 'Today’s standing checklist: done, late, due within the hour, and the rest of the day',
      segs: [{ label: 'done', n: ckDone, cls: 'bg-emerald-500', tone: 'emerald', filter: 'done' }, { label: 'late', n: ckLate, cls: 'bg-rose-500', tone: 'rose', filter: 'late' }, { label: 'due soon', n: ckSoon, cls: 'bg-amber-400', tone: 'amber', filter: 'soon' }, { label: 'later', n: Math.max(0, ckRows.length - ckDone - ckLate - ckSoon), cls: 'bg-slate-300', tone: 'slate', filter: 'later' }],
      sub: ckRows.length ? [ckLate ? ckLate + ' late' : '', ckSoon ? ckSoon + ' due within the hour' : '', !ckLate && !ckSoon ? (ckDone === ckRows.length ? 'all done' : 'nothing due right now') : ''].filter(Boolean).join(' · ') : 'no checklist yet' },
  ]

  // ── the open list ──
  const items = useMemo<Item[]>(() => {
    if (!open) return []
    const out: Item[] = []
    if (open === 'cleans') for (const c of cleans) {
      const state = c.status === 'late' || c.status === 'atRisk' ? 'late' : c.status
      out.push({ key: c.taskId, state, taskId: c.taskId, who: c.who, sort: c.status === 'late' ? 0 : c.status === 'atRisk' ? 1 : !c.who ? 2 : c.status === 'open' ? 3 : c.status === 'running' ? 4 : 9, node: <CleanRow c={c} value={valueByUnit[c.unit] || 0} roster={roster} canAssign={can.assign} onChanged={onChanged} /> })
    }
    if (open === 'insp') {
      for (const x of inspTasks) out.push({ key: x.taskId, state: x.state === 'done' ? 'done' : x.state === 'running' ? 'running' : !x.who ? 'unassigned' : 'open', taskId: x.taskId, who: x.who, sort: x.state === 'done' ? 9 : !x.who ? 1 : x.late ? 0 : x.state === 'running' ? 4 : 3, node: <InspectionTaskRow t={x} big={bigUnits.has(x.unit)} roster={roster} canAssign={can.plan} onChanged={onChanged} /> })
      for (const a of arrivalsInsp) out.push({ key: 'arr:' + a.reservationId, state: a.inspection === 'none' ? 'missing' : a.inspection === 'done' ? 'done' : 'open', sort: a.inspection === 'none' ? (a.today ? 0 : 2) : 8, node: <ArrivalInspectionRow a={a} create={createFor(a.reservationId)} canCreate={can.plan} onChanged={onChanged} /> })
    }
    if (open === 'maint') for (const x of maint) out.push({ key: x.taskId, state: x.state === 'done' ? 'done' : x.state === 'running' ? 'running' : !x.who ? 'unassigned' : 'open', taskId: x.taskId, who: x.who, sort: x.state === 'done' ? 9 : (x.prio === 'urgent' ? 0 : x.prio === 'high' ? 1 : 3) + (!x.who ? 0 : 0.5) + (x.late ? -0.25 : 0) + (x.state === 'running' ? 2 : 0), node: <MaintRow t={x} roster={roster} canAssign={can.assign} onChanged={onChanged} /> })
    if (open === 'welcome' && w) for (const r of w.rows) out.push({ key: r.id, state: r.done ? 'done' : r.today ? 'today' : 'open', sort: r.done ? 9 : r.today ? (r.mandatory ? 0 : 1) : 3, node: <DayCallRowView r={r} canLog={can.calls} onChanged={changed} /> })
    if (open === 'glitches') for (const g of gl.rows) out.push({ key: 'gl:' + g.id, state: g.overdue ? 'overdue' : !g.hasTask ? 'notask' : 'covered', sort: g.overdue ? 0 : !g.hasTask ? 1 : 3, node: <GlitchRow g={g} canEdit={can.plan} onChanged={onChanged} /> })
    if (open === 'claims') for (const c of cl.rows) out.push({ key: 'cl:' + c.id, state: c.daysLeft != null && c.daysLeft <= 3 ? 'due' : 'ok', sort: c.daysLeft ?? 999, node: <Row dot={c.daysLeft != null && c.daysLeft <= 3 ? 'rose' : null} title={c.unit + (c.guest ? ' · ' + c.guest : '')} tags={<>{<Tag tone={c.daysLeft != null && c.daysLeft <= 3 ? 'rose' : 'slate'}>{c.daysLeft != null ? (c.daysLeft <= 0 ? 'due today' : c.daysLeft + 'd left') : c.stageLabel}</Tag>}{c.amount != null && <Tag>{money(c.amount)}</Tag>}</>} meta={[c.stageLabel, c.waitingOn ? 'waiting on ' + c.waitingOn : ''].filter(Boolean).join(' · ')} actions={<Link href={'/claims/' + c.id} prefetch={false} className={GHOST}>Open</Link>} /> })
    if (open === 'checklist') for (const r of ckRows) out.push({ key: 'ck:' + r.id, state: r.done ? 'done' : r.late ? 'late' : r.in_minutes != null && r.in_minutes <= 60 ? 'soon' : 'later', sort: r.done ? 9 : r.late ? 0 : (r.in_minutes ?? 9999) / 1000 + 1, node: <Row dot={r.late ? 'rose' : null} title={r.title} tags={<>{r.late ? <Tag tone="rose">late</Tag> : r.in_minutes != null && !r.done && r.in_minutes <= 60 ? <Tag tone="amber">in {r.in_minutes}m</Tag> : null}{r.owner_role ? <Tag>{r.owner_role}</Tag> : null}{r.done ? <Tag tone="emerald">done · {String(r.done_by || '').split(/[\s@]/)[0]}</Tag> : null}</>} meta={r.by_time ? 'by ' + clock12(r.by_time) : 'anytime today'} actions={<>{r.link && !r.done && <Link href={r.link} prefetch={false} className={GHOST}>Open</Link>}{!r.done && ckQ.data?.canTick && <button onClick={() => tickCk(r.id)} disabled={ckBusy === r.id} className={DARK}>{ckBusy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button>}</>} /> })
    if (open === 'unpaid') for (const r of unpaidRows) out.push({ key: 'unpaid:' + r.id, state: r.tracking.status, sort: (r.bucket === 'in_house' ? 0 : r.bucket === 'today' ? 1 : 2) + (r.tracking.status === 'open' ? 0 : 0.5), node: <UnpaidRow r={r} today={unpaidQ.data?.today || d.today} canEdit={!!unpaidQ.data?.canEdit} onPatch={onUnpaidPatch} simple /> })
    if (open === 'recovery' && rc) for (const r of rc.rows) out.push({ key: r.kind + r.id, state: r.done ? 'done' : 'open', sort: r.done ? 9 : r.today ? 0 : 2, node: <DayCallRowView r={r} canLog={can.calls} onChanged={changed} /> })
    return out.sort((a, b) => a.sort - b.sort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, d, calls, roster, can.assign, can.plan, can.calls, unpaidQ.data, unpaidPatch, ckQ.data, ckBusy])

  const tile = tiles.find(x => x.key === open) || null
  const chips = tile ? tile.segs.filter(s => s.n > 0) : []
  const pick = filter !== 'all' && chips.some(c => c.filter === filter) ? filter : 'all'
  const shown = pick === 'all' ? items : items.filter(i => i.state === pick)
  const nudgeIds = shown.filter(i => i.taskId && i.who && i.state !== 'done').map(i => i.taskId as string)
  const nudgePeople = new Set(shown.filter(i => i.taskId && i.who && i.state !== 'done').map(i => i.who)).size
  const toggle = (k: Key) => {
    // The Unpaid tile points at the list already on the page (under the checklist) rather than opening a second copy.
    if (k === 'unpaid') { const el = document.getElementById('unpaid-today'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return } }
    setOpen(o => (o === k ? null : k)); setFilter('all')
  }
  const headline = tile ? (tile.key === 'unpaid' ? money(uOwed) + ' owed · ' + tile.done + ' of ' + tile.needed + ' contacted' : tile.key === 'glitches' || tile.key === 'claims' ? tile.needed + ' open' : tile.done + ' of ' + tile.needed + ' done') : ''

  return (
    <section>
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        {tiles.map(x => <Tile key={x.key} label={x.label} done={x.done} needed={x.needed} segs={x.segs} sub={x.sub} on={open === x.key} onClick={() => toggle(x.key)} title={x.title} loading={x.loading} big={x.big} />)}
      </div>
      {open && tile && (
        <div className="mt-2 rounded-2xl border border-brand-200 bg-brand-50/30 p-2 sm:p-3">
          <div className="flex items-center gap-2 flex-wrap mb-2 px-1">
            <h3 className="text-[12px] font-bold text-ink">{tile.label}</h3>
            <span className="text-[11.5px] text-muted tabular-nums">{headline}</span>
            <div className="flex items-center gap-1 flex-wrap" role="group" aria-label={tile.label + ' filters'}>
              <button onClick={() => setFilter('all')} aria-pressed={pick === 'all'} className={'text-[11px] font-semibold px-2 py-0.5 rounded-full border ' + (pick === 'all' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>All {items.length}</button>
              {chips.map(c => <button key={c.filter} onClick={() => setFilter(pick === c.filter ? 'all' : c.filter)} aria-pressed={pick === c.filter} className={'text-[11px] font-semibold px-2 py-0.5 rounded-full border tabular-nums ' + (pick === c.filter ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{c.label} {c.n}</button>)}
            </div>
            <span className="ml-auto flex items-center gap-2">
              {(can.assign || can.plan) && (open === 'cleans' || open === 'insp' || open === 'maint') && nudgeIds.length > 0 && (
                <NudgeBtn taskIds={nudgeIds} label={'Message the team · ' + nudgePeople} className={DARK} title={'One Slack message per person, listing their open ' + (open === 'cleans' ? 'cleans' : open === 'insp' ? 'inspections' : 'jobs') + ' in view — posted in the building’s channel tagging them, or a DM when the building has no channel'} />
              )}
              {open === 'glitches' ? <Link href="/glitches" className="text-[11px] font-semibold text-brand-700 hover:underline">Glitch board →</Link> : open === 'claims' ? <Link href="/claims" className="text-[11px] font-semibold text-brand-700 hover:underline">Claims →</Link> : open === 'checklist' ? <Link href="/checklist" className="text-[11px] font-semibold text-brand-700 hover:underline">Checklist →</Link> : open === 'unpaid' ? <Link href="/reservations/unpaid" className="text-[11px] font-semibold text-brand-700 hover:underline">Unpaid board →</Link> : open === 'welcome' || open === 'recovery' ? <Link href="/welcome-calls" className="text-[11px] font-semibold text-brand-700 hover:underline">Calls desk →</Link> : open === 'maint' ? <Link href="/maintenance" className="text-[11px] font-semibold text-brand-700 hover:underline">Maintenance →</Link> : <Link href="/plan" className="text-[11px] font-semibold text-brand-700 hover:underline">Today board →</Link>}
              <button onClick={() => setOpen(null)} className="text-muted hover:text-ink" aria-label="Close the list" title="Close"><ChevronUp size={15} /></button>
            </span>
          </div>
          {shown.length === 0
            ? <p className="px-2 py-3 text-[12.5px] text-muted">{(open === 'welcome' || open === 'recovery') && !calls ? (callsQ.loading ? 'Reading the Calls desk…' : 'Could not read the Calls desk.') : 'Nothing here.'}</p>
            : <div className={LIST + ' max-h-[520px] overflow-y-auto'}>{shown.map(i => <div key={i.key}>{i.node}</div>)}</div>}
        </div>
      )}
    </section>
  )
}

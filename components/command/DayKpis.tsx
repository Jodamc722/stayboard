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
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ExternalLink, UserPlus, Loader2, Phone, PhoneCall, PhoneOff, ChevronUp } from 'lucide-react'
import { Tag, type Tone } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { CommandDay, NextItem, TaskRow } from '@/lib/command-day'
import { InlineAssign, type Roster } from '@/components/CommandCockpit'
import { Row, CleanRow, InspectionTaskRow, ArrivalInspectionRow, GlitchRow, LIST, GHOST, DARK, bz, money, INSPECT, tomorrowOf } from '@/components/command/Hub'
import { Check } from 'lucide-react'
import { NudgeBtn } from '@/components/command/Nudge'
import { useTaskActions, TaskStateTag, type TaskState } from '@/components/task/TaskActions'
import type { DayCalls, DayCallRow } from '@/app/api/command/calls/route'
import type { GuestCheckRow } from '@/app/api/guest-checks/route'
import { UnpaidRow, type UnpaidRowT } from '@/components/UnpaidBoard'

export const CALLS_URL = '/api/command/calls'
type Key = 'cleans' | 'insp' | 'welcome' | 'recovery' | 'maint' | 'unpaid' | 'glitches' | 'claims' | 'checklist' | 'reviews' | 'notices' | 'checks' | 'blocked' | 'channels'
const GROUPS: { label: string; keys: Key[] }[] = [
  { label: 'Housekeeping & maintenance', keys: ['cleans', 'insp', 'maint', 'blocked'] },
  { label: 'Guests', keys: ['welcome', 'recovery', 'notices', 'checks', 'reviews'] },
  { label: 'Office', keys: ['checklist', 'glitches', 'claims', 'unpaid', 'channels'] },
]
const CHECKS_URL = '/api/guest-checks'
const BLOCKED_URL = '/api/blocked-units?days=30'
const CHANNELS_URL = '/api/channels'
type BlockedRunT = { listingId: string; unit: string; building: string; market: string; from: string; to: string; nights: number; startsInDays: number; live: boolean; openEnded: boolean; reason: string; note: string | null }
type ChannelListingT = { id: string; name: string; building: string; verdict: string; missingMajor: string[]; cells: Record<string, { verdict: string; status: string | null }> }
const REVIEWS_URL = '/api/reviews?days=60&hub=1'
const NOTICES_URL = '/api/reservation-notices'
type ReviewT = { id: string; rating: number | null; channel: string; guest: string; created_at: string; hasReply: boolean; listing_name: string; dismissed?: boolean; removed?: boolean }
type NoticeT = { id: string; guest_name: string; unit_no: string; propertyName?: string; arrival_date: string; sent_at: string | null; sent_by?: string | null; urgency?: string; hasRecipient?: boolean }
const fiveStar = (r: number | null, ch: string) => r == null ? null : /booking/i.test(ch) && r > 5 ? Math.round((r / 2) * 10) / 10 : r
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
const mins = (sec: number) => sec < 60 ? sec + 's' : Math.round(sec / 60) + ' min'
const hhmm = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) } catch { return '' } }

/** "Who called?" — a name from the list, Me, or a typed name. Credits a completed call. */
function CreditPicker({ callers, onPick, busy }: { callers: string[]; onPick: (name: string) => void; busy: boolean }) {
  const [other, setOther] = useState(false)
  const [typed, setTyped] = useState('')
  if (other) return (
    <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); if (typed.trim()) onPick(typed.trim()) }}>
      <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder="Name" className="text-[12px] border border-line rounded-md px-2 py-1 w-28" maxLength={60} />
      <button type="submit" disabled={busy || !typed.trim()} className={DARK}>{busy ? <Loader2 size={12} className="animate-spin" /> : null}Credit</button>
      <button type="button" onClick={() => setOther(false)} className={GHOST}>Cancel</button>
    </form>
  )
  return (
    <select disabled={busy} value="" onChange={e => { const v = e.target.value; if (v === '__other') setOther(true); else if (v) onPick(v) }}
      className="text-[12px] border border-line rounded-md px-2 py-1 bg-white max-w-[160px]" title="Talkroute saw this call but names nobody — who made it?">
      <option value="">{busy ? 'Crediting…' : 'Who called? (credit)'}</option>
      <option value="__me">Me</option>
      {callers.map(c => <option key={c} value={c}>{c}</option>)}
      <option value="__other">Someone else…</option>
    </select>
  )
}

function DayCallRowView({ r, canLog, callers, onChanged }: { r: DayCallRow; canLog: boolean; callers: string[]; onChanged: () => void }) {
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [credited, setCredited] = useState('')
  const [err, setErr] = useState('')
  const isPost = r.kind === 'post'
  const credit = async (name: string) => {
    setBusy('credit'); setErr('')
    try {
      const j = await post('/api/guest-calls/credit', { reservationId: r.id, kind: isPost ? 'post_checkout' : 'welcome', name: name === '__me' ? '' : name })
      setCredited(String(j.by || name)); onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
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
  const shown = done || (r.done ? (r.outcome || 'done') : '')   // done with no log = ticked in Guesty
  if (shown) {
    // A COMPLETED CALL SAYS WHAT HAPPENED (Jon, 2026-10-02): the outcome, whether Talkroute proved it
    // (and how long they talked), who gets the credit, and the notes — the transcript write-up when
    // there is one, else what the caller typed. A Talkroute-closed call with nobody credited offers
    // the picker right here, so the person who made it gets it on their scorecard.
    const lbl = shown === 'no_answer' ? 'no answer — try again' : shown === 'voicemail' ? 'voicemail left' : shown === 'issue' ? 'reached — issue raised' : shown === 'happy' ? 'reached — happy' : shown === 'reached' ? 'reached' : 'called'
    const viaTitle = r.via === 'talkroute' ? 'Talkroute saw this call' + (r.lastResult ? ' · ' + r.lastResult : '') + (r.talkSeconds ? ' · talked ' + mins(r.talkSeconds) : '') : r.via === 'manual' ? 'Logged by hand in Lighthouse' : 'Welcome Call field ticked in Guesty'
    const by = credited || (r.calledBy && r.calledBy.toLowerCase() !== 'talkroute' ? r.calledBy : '')
    const hasNotes = !!(r.note || r.promised?.length || r.issues?.length)
    return (
      <Row title={r.guest}
        tags={<>
          <Tag tone={shown === 'no_answer' ? 'amber' : 'emerald'} title={by ? 'By ' + by : ''}>{lbl}</Tag>
          {r.via === 'talkroute' && <Tag tone="brand" title={viaTitle}><PhoneCall size={10} /> Talkroute{r.talkSeconds ? ' · ' + mins(r.talkSeconds) : ''}</Tag>}
          {r.via !== 'talkroute' && <Tag tone="slate" title={viaTitle}>{r.via === 'manual' ? 'logged by hand' : 'ticked in Guesty'}</Tag>}
          {hasNotes && <Tag tone={r.issues?.length ? 'rose' : 'slate'} title="There are notes from this call">notes</Tag>}
          {r.verify === 'none' && <Tag tone="rose" title="Marked done by hand, but Talkroute has no call to this guest's number in the last two weeks — was it made from a personal phone, or not made?"><PhoneOff size={10} /> no Talkroute call</Tag>}
          {r.verify === 'attempted' && <Tag tone="amber" title="Talkroute has calls to this number, but none that connected — the completion may be a voicemail or a WhatsApp follow-up">Talkroute: tried, not connected</Tag>}
          {r.intl && <Tag tone="slate" title="International number — calls go over WhatsApp, which Talkroute cannot see, so this one is taken on the caller's word">intl · WhatsApp</Tag>}
          {recTag}
        </>}
        meta={[r.unit, when, by ? 'by ' + by : (r.uncredited && !credited ? 'nobody credited yet' : ''), r.calledAt ? 'at ' + hhmm(r.calledAt) : ''].filter(Boolean).join(' · ')}
        actions={r.uncredited && !credited && canLog ? <CreditPicker callers={callers} onPick={credit} busy={busy === 'credit'} /> : undefined}
        err={err}>
        {hasNotes && (
          <div className="text-[12px] text-ink/80 space-y-0.5 mt-1">
            {r.note && <p>{r.note}{r.noteBy ? <span className="text-muted"> — {r.noteBy}</span> : null}</p>}
            {r.promised?.length ? <p><b>We promised:</b> {r.promised.join(' · ')}</p> : null}
            {r.issues?.length ? <p><b className="text-rose-700">Issues:</b> {r.issues.join(' · ')}</p> : null}
            {r.callId && <Link href={'/welcome-calls/call/' + r.callId} className="text-brand-600 hover:underline font-semibold">Open the transcript →</Link>}
          </div>
        )}
      </Row>
    )
  }
  return (
    <Row dot={r.today ? (r.mandatory ? 'rose' : 'amber') : null} title={r.guest} err={err}
      tags={<>
        <Tag tone={isPost ? 'violet' : 'sky'} title={isPost ? 'Post-checkout follow-up' : 'Pre-arrival welcome call'}>{isPost ? 'after stay' : 'welcome'}</Tag>
        {r.mandatory && !r.recovery && <Tag tone="violet" title={'Mandatory — ' + r.tier + ' tier'}>{r.tier}</Tag>}
        {recTag}
        {r.value >= 1000 && <Tag tone="slate" title={money(r.value) + ' booking'}>{money(r.value)}</Tag>}
        {r.intl && <Tag tone="slate" title="International number — call over WhatsApp (Talkroute will not see it), then log it here">intl · WhatsApp</Tag>}
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
function Tile({ label, done, needed, segs, sub, on, onClick, title, loading, big, noPct }: { label: string; done: number; needed: number; segs: Seg[]; sub: string; on: boolean; onClick: () => void; title: string; loading?: boolean; big?: { value: string; unit: string; tone: string }; noPct?: boolean }) {
  const pct = needed ? Math.round((done / needed) * 100) : 100
  const tone = big ? big.tone : !needed ? 'text-muted' : done === needed ? 'text-emerald-700' : segs.some(s => s.n && /late|urgent|unassigned/.test(s.filter)) ? 'text-rose-700' : 'text-ink'
  return (
    <button onClick={onClick} aria-pressed={on} title={title + (on ? ' — click to close the list' : ' — click to open the list')}
      className={'text-left rounded-2xl border bg-white px-3 sm:px-3.5 py-2.5 sm:py-3 min-h-[80px] sm:min-h-[96px] shadow-soft transition flex flex-col gap-1.5 min-w-0 ' + (on ? 'border-brand-400 ring-2 ring-brand-100' : 'border-line hover:border-ink/30')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.06em] sm:tracking-[0.12em] font-semibold text-muted truncate">{label}</span>
        {loading ? <Loader2 size={11} className="animate-spin text-muted" /> : <span className={'text-[10.5px] font-bold tabular-nums ' + (needed ? 'text-muted' : 'text-muted/50')}>{needed && !noPct ? pct + '%' : ''}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        {big ? <>
          <span className={'lh-display text-[26px] sm:text-[30px] leading-none font-bold tabular-nums ' + tone}>{big.value}</span>
          <span className="text-[11px] text-muted ml-1 truncate">{big.unit}</span>
        </> : <>
          <span className={'lh-display text-[26px] sm:text-[30px] leading-none font-bold tabular-nums ' + tone}>{done}</span>
          <span className="text-[13px] font-medium text-muted tabular-nums">/ {needed}</span>
          <span className="text-[11px] text-muted ml-1">{needed ? 'done' : loading ? 'reading…' : 'none today'}</span>
        </>}
      </div>
      <div className="w-full h-1 rounded-full bg-line overflow-hidden flex mt-auto" aria-hidden>
        {needed > 0 && segs.filter(s => s.n > 0).map(s => <span key={s.filter} className={'block h-full ' + s.cls} style={{ width: (s.n / needed) * 100 + '%' }} title={s.n + ' ' + s.label} />)}
      </div>
      <div className="text-[11px] text-muted truncate w-full" title={sub}>{sub || ' '}</div>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function DayKpis({ d, live, roster, can, onChanged }: {
  d: CommandDay; live: NextItem[]; roster: Roster[]; can: { assign: boolean; plan: boolean; calls: boolean; glitchApprove?: boolean }; onChanged: () => void
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

  // ── reviews responded, front-desk notices sent (Jon, 2026-10-02) ──
  const rvQ = useCachedFetch<{ reviews?: ReviewT[]; error?: string }>(REVIEWS_URL, { ttl: 120_000 })
  const rvAll = (rvQ.data?.reviews || []).filter(r => !r.removed)
  const rvDone = rvAll.filter(r => r.hasReply || r.dismissed)
  const rvWait = rvAll.filter(r => !r.hasReply && !r.dismissed)
  const rvLow = rvWait.filter(r => { const f = fiveStar(r.rating, r.channel); return f != null && f <= 3 })
  const ntQ = useCachedFetch<{ ok?: boolean; today?: NoticeT[]; counts?: { toSend: number; sentToday: number; late: number; due: number; blocked: number }; error?: string }>(NOTICES_URL, { ttl: 120_000 })
  // SENT IS CHECKED WHEN THE LIST IS OPENED (Jon, 2026-10-02: "front desk notices need to be marked sent
  // when sent"). The Notices page reconciles Gmail on open; the Today tile did not, so a notice sent an
  // hour ago still read "to send" here until the hourly cron. Once per page load, in the background.
  const [ntChecked, setNtChecked] = useState(false)
  useEffect(() => {
    if (open !== 'notices' || ntChecked) return
    setNtChecked(true)
    fetch('/api/reservation-notices/draft?check=1&past=0').then(r => r.ok ? r.json() : null).then(j => {
      if (j && (j.markedSent || j.sentSweep?.markedSent || j.guestySweep?.markedSent)) { invalidateCache(NOTICES_URL); ntQ.refresh() }
    }).catch(() => { /* the hourly cron will */ })
  }, [open, ntChecked, ntQ])
  const ntToday = ntQ.data?.today || []
  const ntC = ntQ.data?.counts || { toSend: 0, sentToday: 0, late: 0, due: 0, blocked: 0 }
  const [ntBusy, setNtBusy] = useState('')
  const sendNotice = async (id: string) => {
    let ini = ''; try { ini = localStorage.getItem('frontdesk.initials') || '' } catch { /* private mode */ }
    if (ini.length < 2) { const v = window.prompt('Your initials (so the record shows who sent it):', '') || ''; ini = v.trim().toUpperCase().slice(0, 4); if (ini.length < 2) return; try { localStorage.setItem('frontdesk.initials', ini) } catch { /* private mode */ } }
    setNtBusy(id)
    try { await fetch('/api/reservation-notices/mark-sent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, initials: ini }) }); invalidateCache(NOTICES_URL); ntQ.refresh() } finally { setNtBusy('') }
  }

  // ── guest checks (ID verified, deposit captured), blocked units, channels not connected (Jon, 2026-10-02) ──
  const gcQ = useCachedFetch<{ ok?: boolean; rows?: GuestCheckRow[]; needed?: number; done?: number; canEdit?: boolean; error?: string }>(CHECKS_URL, { ttl: 120_000 })
  const gcRows = gcQ.data?.rows || []
  const gcNeeded = gcQ.data?.needed || 0, gcDone = gcQ.data?.done || 0
  const gcTodayOpen = gcRows.filter(r => r.today && ((r.needId && r.idStatus === 'pending') || (r.needDeposit && r.depositStatus === 'pending'))).length
  const gcIdOpen = gcRows.filter(r => r.needId && r.idStatus === 'pending').length
  const gcDepOpen = gcRows.filter(r => r.needDeposit && r.depositStatus === 'pending').length
  const [gcBusy, setGcBusy] = useState('')
  const setCheck = async (rid: string, patch: Record<string, any>) => { setGcBusy(rid + JSON.stringify(patch)); try { await fetch(CHECKS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: rid, ...patch }) }); invalidateCache(CHECKS_URL); gcQ.refresh() } finally { setGcBusy('') } }
  const blQ = useCachedFetch<{ ok?: boolean; liveNow?: number; upcoming?: number; nightsBlocked?: number; runs?: BlockedRunT[]; error?: string }>(BLOCKED_URL, { ttl: 5 * 60_000 })
  const blRuns = blQ.data?.runs || []
  const blLive = blRuns.filter(r => r.live).length, blSoon = blRuns.filter(r => !r.live && r.startsInDays <= 7).length, blLater = Math.max(0, blRuns.length - blLive - blSoon)
  const chQ = useCachedFetch<{ ok?: boolean; listings?: ChannelListingT[]; error?: string }>(CHANNELS_URL, { ttl: 10 * 60_000 })
  const chAll = chQ.data?.listings || []
  const chBad = chAll.filter(l => ['suspended', 'failed', 'disconnected', 'missing'].includes(l.verdict))
  const chHard = chBad.filter(l => l.verdict === 'suspended' || l.verdict === 'failed' || l.verdict === 'disconnected').length
  const chMissing = chBad.length - chHard

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
    { key: 'reviews', label: 'Reviews responded', done: rvDone.length, needed: rvAll.length, loading: !rvQ.data && rvQ.loading, title: 'Reviews from the last 60 days: answered publicly (or set aside) against the ones still waiting on a reply — low scores first',
      segs: [{ label: 'responded', n: rvDone.length, cls: 'bg-emerald-500', tone: 'emerald', filter: 'done' }, { label: '3★ or under', n: rvLow.length, cls: 'bg-rose-500', tone: 'rose', filter: 'low' }, { label: 'waiting', n: Math.max(0, rvWait.length - rvLow.length), cls: 'bg-amber-400', tone: 'amber', filter: 'wait' }],
      sub: rvQ.error ? 'could not read the reviews' : rvAll.length ? [rvWait.length ? rvWait.length + ' waiting on a reply' : 'all answered', rvLow.length ? rvLow.length + ' at 3★ or under' : ''].filter(Boolean).join(' · ') : 'no reviews in 60 days' },
    { key: 'notices', label: 'Front-desk notices', done: ntC.sentToday, needed: ntToday.length, loading: !ntQ.data && ntQ.loading, title: 'Arrival notices the buildings need today (Elser’s registration form first): sent against to send, late ones first',
      segs: [{ label: 'sent', n: ntC.sentToday, cls: 'bg-emerald-500', tone: 'emerald', filter: 'sent' }, { label: 'late', n: ntC.late, cls: 'bg-rose-500', tone: 'rose', filter: 'late' }, { label: 'due', n: ntC.due, cls: 'bg-amber-400', tone: 'amber', filter: 'due' }, { label: 'to send', n: Math.max(0, ntC.toSend - ntC.late - ntC.due), cls: 'bg-slate-300', tone: 'slate', filter: 'open' }],
      sub: ntQ.error ? 'could not read the notices' : ntToday.length ? [ntC.toSend ? ntC.toSend + ' to send' : 'all sent', ntC.late ? ntC.late + ' late' : '', ntC.blocked ? ntC.blocked + ' with no recipient' : ''].filter(Boolean).join(' · ') : 'none needed today' },
    { key: 'checks', label: 'ID & deposits', done: gcDone, needed: gcNeeded, loading: !gcQ.data && gcQ.loading, title: 'Arrivals in the next 7 days whose channel asks us to verify ID (Vrbo, Direct, Google) or collect a security deposit (Expedia): checks done against checks owed, today first',
      segs: [{ label: 'done', n: gcDone, cls: 'bg-emerald-500', tone: 'emerald', filter: 'done' }, { label: 'ID to verify', n: gcIdOpen, cls: 'bg-amber-400', tone: 'amber', filter: 'id' }, { label: 'deposit to take', n: gcDepOpen, cls: 'bg-rose-500', tone: 'rose', filter: 'deposit' }],
      sub: gcQ.error ? (/migration/.test(gcQ.error) ? 'needs migration 145' : 'could not read') : gcNeeded ? [gcTodayOpen ? gcTodayOpen + ' arriving today still open' : 'today’s arrivals covered', gcIdOpen ? gcIdOpen + ' ID' : '', gcDepOpen ? gcDepOpen + ' deposit' : ''].filter(Boolean).join(' · ') : 'nothing owed this week' },
    { key: 'blocked', label: 'Blocked units', done: 0, needed: blRuns.length, loading: !blQ.data && blQ.loading, title: 'Units out of service on the calendar: off right now, starting within a week, and later — with the block note',
      big: { value: String(blLive), unit: blLive === 1 ? 'off today' : 'off today', tone: blLive ? 'text-rose-700' : 'text-emerald-700' },
      segs: [{ label: 'off now', n: blLive, cls: 'bg-rose-500', tone: 'rose', filter: 'live' }, { label: 'within 7 days', n: blSoon, cls: 'bg-amber-400', tone: 'amber', filter: 'soon' }, { label: 'later', n: blLater, cls: 'bg-slate-300', tone: 'slate', filter: 'later' }],
      sub: blQ.error ? 'could not read the calendar' : blRuns.length ? [blLive ? blLive + ' off now' : 'none off now', blSoon ? blSoon + ' starting this week' : '', blQ.data?.nightsBlocked ? blQ.data.nightsBlocked + ' nights blocked in 30d' : ''].filter(Boolean).join(' · ') : 'nothing blocked in the next 30 days' },
    { key: 'channels', label: 'Channels', done: Math.max(0, chAll.length - chBad.length), needed: chAll.length, loading: !chQ.data && chQ.loading, title: 'Every active listing against the major channels: live, or suspended / failed / disconnected, or simply not listed on one',
      big: { value: String(chHard), unit: chHard === 1 ? 'listing broken' : 'listings broken', tone: chHard ? 'text-rose-700' : chBad.length ? 'text-amber-800' : 'text-emerald-700' },
      segs: [{ label: 'live everywhere', n: Math.max(0, chAll.length - chBad.length), cls: 'bg-emerald-500', tone: 'emerald', filter: 'live' }, { label: 'not on a channel', n: chMissing, cls: 'bg-amber-400', tone: 'amber', filter: 'missing' }, { label: 'suspended / failed', n: chHard, cls: 'bg-rose-500', tone: 'rose', filter: 'hard' }],
      sub: chQ.error ? 'could not read channel health' : chAll.length ? [chHard ? 'suspended, failed or disconnected' : 'nothing broken', chMissing ? chMissing + ' not on every major channel' : ''].filter(Boolean).join(' · ') : 'no channel snapshot yet' },
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
    if (open === 'welcome' && w) for (const r of w.rows) out.push({ key: r.id, state: r.done ? 'done' : r.today ? 'today' : 'open', sort: r.done ? 9 : r.today ? (r.mandatory ? 0 : 1) : 3, node: <DayCallRowView r={r} canLog={can.calls || !!calls?.canEdit} callers={calls?.callers || []} onChanged={changed} /> })
    if (open === 'glitches') for (const g of gl.rows) out.push({ key: 'gl:' + g.id, state: g.overdue ? 'overdue' : !g.hasTask ? 'notask' : 'covered', sort: g.overdue ? 0 : !g.hasTask ? 1 : 3, node: <GlitchRow g={g} canEdit={can.plan} canApprove={can.glitchApprove} onChanged={onChanged} /> })
    if (open === 'claims') for (const c of cl.rows) out.push({ key: 'cl:' + c.id, state: c.daysLeft != null && c.daysLeft <= 3 ? 'due' : 'ok', sort: c.daysLeft ?? 999, node: <Row dot={c.daysLeft != null && c.daysLeft <= 3 ? 'rose' : null} title={c.unit + (c.guest ? ' · ' + c.guest : '')} tags={<>{<Tag tone={c.daysLeft != null && c.daysLeft <= 3 ? 'rose' : 'slate'}>{c.daysLeft != null ? (c.daysLeft <= 0 ? 'due today' : c.daysLeft + 'd left') : c.stageLabel}</Tag>}{c.amount != null && <Tag>{money(c.amount)}</Tag>}</>} meta={[c.stageLabel, c.waitingOn ? 'waiting on ' + c.waitingOn : ''].filter(Boolean).join(' · ')} actions={<Link href={'/claims/' + c.id} prefetch={false} className={GHOST}>Open</Link>} /> })
    if (open === 'checklist') for (const r of ckRows) out.push({ key: 'ck:' + r.id, state: r.done ? 'done' : r.late ? 'late' : r.in_minutes != null && r.in_minutes <= 60 ? 'soon' : 'later', sort: r.done ? 9 : r.late ? 0 : (r.in_minutes ?? 9999) / 1000 + 1, node: <Row dot={r.late ? 'rose' : null} title={r.title} tags={<>{r.late ? <Tag tone="rose">late</Tag> : r.in_minutes != null && !r.done && r.in_minutes <= 60 ? <Tag tone="amber">in {r.in_minutes}m</Tag> : null}{r.owner_role ? <Tag>{r.owner_role}</Tag> : null}{r.done ? <Tag tone="emerald">done · {String(r.done_by || '').split(/[\s@]/)[0]}</Tag> : null}</>} meta={r.by_time ? 'by ' + clock12(r.by_time) : 'anytime today'} actions={<>{r.link && !r.done && <Link href={r.link} prefetch={false} className={GHOST}>Open</Link>}{!r.done && ckQ.data?.canTick && <button onClick={() => tickCk(r.id)} disabled={ckBusy === r.id} className={DARK}>{ckBusy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button>}</>} /> })
    if (open === 'reviews') for (const r of rvAll) { const f = fiveStar(r.rating, r.channel); const low = f != null && f <= 3; const done = r.hasReply || r.dismissed; out.push({ key: 'rv:' + r.id, state: done ? 'done' : low ? 'low' : 'wait', sort: done ? 9 : low ? 0 : 2, node: <Row dot={!done && low ? 'rose' : null} title={(r.guest || 'Guest') + (r.listing_name ? ' · ' + r.listing_name : '')} tags={<>{f != null && <Tag tone={low ? 'rose' : f >= 4.5 ? 'emerald' : 'slate'}>{f}★</Tag>}<Tag>{String(r.channel || '').replace(/airbnb2?/i, 'Airbnb').replace(/bookingcom/i, 'Booking')}</Tag>{done ? <Tag tone="emerald">{r.hasReply ? 'responded' : 'set aside'}</Tag> : <Tag tone="amber">waiting</Tag>}</>} meta={new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })} actions={!done ? <Link href="/reviews" prefetch={false} className={DARK}>Reply</Link> : null} /> }) }
    if (open === 'notices') for (const n of ntToday) out.push({ key: 'nt:' + n.id, state: n.sent_at ? 'sent' : n.urgency === 'late' ? 'late' : n.urgency === 'due' ? 'due' : 'open', sort: n.sent_at ? 9 : n.urgency === 'late' ? 0 : n.urgency === 'due' ? 1 : 3, node: <Row dot={!n.sent_at && n.urgency === 'late' ? 'rose' : null} title={n.guest_name} tags={<>{n.propertyName && <Tag tone="violet">{n.propertyName}</Tag>}{n.sent_at ? <Tag tone="emerald">sent{n.sent_by ? ' · ' + n.sent_by : ''}</Tag> : n.urgency === 'late' ? <Tag tone="rose">late</Tag> : n.urgency === 'due' ? <Tag tone="amber">due now</Tag> : null}{!n.sent_at && n.hasRecipient === false && <Tag tone="amber">no recipient</Tag>}</>} meta={'Unit ' + n.unit_no + ' · arrives ' + String(n.arrival_date).slice(5)} actions={<>{!n.sent_at && <Link href="/reservation-emails" prefetch={false} className={GHOST}>Open</Link>}{!n.sent_at && <button onClick={() => sendNotice(n.id)} disabled={ntBusy === n.id} className={DARK}>{ntBusy === n.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Sent</button>}</>} /> })
    if (open === 'checks') for (const r of gcRows) {
      const idOpen = r.needId && r.idStatus === 'pending', depOpen = r.needDeposit && r.depositStatus === 'pending'
      out.push({ key: 'gc:' + r.reservationId, state: !idOpen && !depOpen ? 'done' : depOpen ? 'deposit' : 'id', sort: (!idOpen && !depOpen ? 9 : r.today ? 0 : 2) + (r.checkIn > d.today ? 0.5 : 0), node: <Row dot={(idOpen || depOpen) && r.today ? 'rose' : null} title={r.guest + ' · ' + r.unit}
        tags={<><Tag>{r.channel}</Tag><Tag tone={r.today ? 'amber' : 'slate'}>{r.today ? 'arrives today' : 'arrives ' + r.checkIn.slice(5)}</Tag>{r.needId && <Tag tone={r.idStatus === 'pending' ? 'amber' : 'emerald'}>{r.idStatus === 'verified' ? 'ID verified' + (r.salatoVerified ? ' (Salato link)' : '') : r.idStatus === 'waived' ? 'ID waived' : 'ID to verify'}</Tag>}{r.needDeposit && <Tag tone={r.depositStatus === 'pending' ? 'rose' : 'emerald'}>{r.depositStatus === 'captured' ? 'deposit captured' + (r.depositAmount ? ' · ' + money(r.depositAmount) : '') : r.depositStatus === 'waived' ? 'deposit waived' : 'deposit to take'}</Tag>}</>}
        meta={[r.note, r.by ? 'by ' + r.by.split('@')[0] : ''].filter(Boolean).join(' · ')}
        actions={gcQ.data?.canEdit ? <>
          {idOpen && <button onClick={() => setCheck(r.reservationId, { id_status: 'verified' })} disabled={!!gcBusy} className={DARK}>{gcBusy.startsWith(r.reservationId) ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} ID verified</button>}
          {depOpen && <button onClick={() => { const v = window.prompt('Deposit amount captured (optional):', ''); if (v === null) return; setCheck(r.reservationId, { deposit_status: 'captured', deposit_amount: v.trim() ? Number(v.replace(/[^\d.]/g, '')) : null }) }} disabled={!!gcBusy} className={DARK}><Check size={12} /> Deposit captured</button>}
          {(idOpen || depOpen) && <button onClick={() => setCheck(r.reservationId, idOpen ? { id_status: 'waived' } : { deposit_status: 'waived' })} disabled={!!gcBusy} className={GHOST} title={idOpen ? 'Not needed for this stay' : 'No deposit for this stay'}>Waive</button>}
          <Link href={'/reservations/' + encodeURIComponent(r.reservationId)} prefetch={false} className={GHOST}>Open</Link>
        </> : <Link href={'/reservations/' + encodeURIComponent(r.reservationId)} prefetch={false} className={GHOST}>Open</Link>} /> })
    }
    if (open === 'blocked') for (const r of blRuns) out.push({ key: 'bl:' + r.listingId + r.from, state: r.live ? 'live' : r.startsInDays <= 7 ? 'soon' : 'later', sort: r.live ? 0 : r.startsInDays, node: <Row dot={r.live ? 'rose' : null} title={r.unit} tags={<><Tag>{r.building}</Tag><Tag tone={r.live ? 'rose' : r.startsInDays <= 7 ? 'amber' : 'slate'}>{r.live ? 'off now' : 'in ' + r.startsInDays + 'd'}</Tag><Tag>{r.nights}{r.openEnded ? '+' : ''} night{r.nights === 1 ? '' : 's'}</Tag></>} meta={[r.from.slice(5) + ' → ' + (r.openEnded ? '?' : r.to.slice(5)), r.reason, r.note].filter(Boolean).join(' · ')} actions={<Link href="/blocked" prefetch={false} className={GHOST}>Manage</Link>} /> })
    if (open === 'channels') for (const l of chBad) out.push({ key: 'ch:' + l.id, state: l.verdict === 'missing' ? 'missing' : 'hard', sort: l.verdict === 'missing' ? 2 : 0, node: <Row dot={l.verdict !== 'missing' ? 'rose' : null} title={l.name} tags={<><Tag>{l.building}</Tag><Tag tone={l.verdict === 'missing' ? 'amber' : 'rose'}>{l.verdict}</Tag>{l.missingMajor.map(k => <Tag key={k}>not on {k.replace(/airbnb2?/i, 'Airbnb').replace(/bookingcom/i, 'Booking.com')}</Tag>)}</>} meta={Object.entries(l.cells || {}).filter(([, c]) => c.verdict !== 'live').map(([k, c]) => k + ': ' + (c.status || c.verdict)).join(' · ')} actions={<Link href="/channels" prefetch={false} className={GHOST}>Channels</Link>} /> })
    if (open === 'unpaid') for (const r of unpaidRows) out.push({ key: 'unpaid:' + r.id, state: r.tracking.status, sort: (r.bucket === 'in_house' ? 0 : r.bucket === 'today' ? 1 : 2) + (r.tracking.status === 'open' ? 0 : 0.5), node: <UnpaidRow r={r} today={unpaidQ.data?.today || d.today} canEdit={!!unpaidQ.data?.canEdit} onPatch={onUnpaidPatch} simple /> })
    if (open === 'recovery' && rc) for (const r of rc.rows) out.push({ key: r.kind + r.id, state: r.done ? 'done' : 'open', sort: r.done ? 9 : r.today ? 0 : 2, node: <DayCallRowView r={r} canLog={can.calls || !!calls?.canEdit} callers={calls?.callers || []} onChanged={changed} /> })
    return out.sort((a, b) => a.sort - b.sort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, d, calls, roster, can.assign, can.plan, can.calls, unpaidQ.data, unpaidPatch, ckQ.data, ckBusy, rvQ.data, ntQ.data, ntBusy, gcQ.data, gcBusy, blQ.data, chQ.data])

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
  const headline = tile ? (tile.key === 'unpaid' ? money(uOwed) + ' owed · ' + tile.done + ' of ' + tile.needed + ' contacted' : tile.key === 'glitches' || tile.key === 'claims' ? tile.needed + ' open' : tile.key === 'reviews' ? tile.done + ' of ' + tile.needed + ' responded' : tile.key === 'blocked' ? tile.needed + ' blocks in 30 days' : tile.key === 'channels' ? chHard + ' broken · ' + chMissing + ' not on every channel' : tile.key === 'checks' ? tile.done + ' of ' + tile.needed + ' checks done' : tile.key === 'notices' ? tile.done + ' of ' + tile.needed + ' sent' : tile.done + ' of ' + tile.needed + ' done') : ''

  return (
    <section>
      {/* BY TEAM (Jon, 2026-10-02: "clear visibility … for all teams and staff"; "clunky, noisy"). Three
          labelled rows instead of one wall of fourteen tiles: what housekeeping and maintenance own,
          what the guest team owns, what the office owns. A tile is still one click to its full list. */}
      <div className="space-y-2">
        {GROUPS.map(g => {
          const mine = tiles.filter(x => g.keys.includes(x.key))
          if (!mine.length) return null
          return (
            <div key={g.label}>
              <p className="px-1 mb-1.5 mt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">{g.label}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {mine.map(x => <Tile key={x.key} label={x.label} done={x.done} needed={x.needed} segs={x.segs} sub={x.sub} on={open === x.key} onClick={() => toggle(x.key)} title={x.title} loading={x.loading} big={x.big} noPct={x.key === 'glitches' || x.key === 'claims' || x.key === 'blocked'} />)}
              </div>
            </div>
          )
        })}
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
              {open === 'checks' ? <Link href="/welcome-calls" className="text-[11px] font-semibold text-brand-700 hover:underline">Calls desk →</Link> : open === 'blocked' ? <Link href="/blocked" className="text-[11px] font-semibold text-brand-700 hover:underline">Blocked units →</Link> : open === 'channels' ? <Link href="/channels" className="text-[11px] font-semibold text-brand-700 hover:underline">Channels →</Link> : open === 'reviews' ? <Link href="/reviews" className="text-[11px] font-semibold text-brand-700 hover:underline">Reviews →</Link> : open === 'notices' ? <Link href="/reservation-emails" className="text-[11px] font-semibold text-brand-700 hover:underline">Front-desk notices →</Link> : open === 'glitches' ? <Link href="/glitches" className="text-[11px] font-semibold text-brand-700 hover:underline">Glitch board →</Link> : open === 'claims' ? <Link href="/claims" className="text-[11px] font-semibold text-brand-700 hover:underline">Claims →</Link> : open === 'checklist' ? <Link href="/checklist" className="text-[11px] font-semibold text-brand-700 hover:underline">Checklist →</Link> : open === 'unpaid' ? <Link href="/reservations/unpaid" className="text-[11px] font-semibold text-brand-700 hover:underline">Unpaid board →</Link> : open === 'welcome' || open === 'recovery' ? <Link href="/welcome-calls" className="text-[11px] font-semibold text-brand-700 hover:underline">Calls desk →</Link> : open === 'maint' ? <Link href="/maintenance" className="text-[11px] font-semibold text-brand-700 hover:underline">Maintenance →</Link> : <Link href="/plan" className="text-[11px] font-semibold text-brand-700 hover:underline">Today board →</Link>}
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

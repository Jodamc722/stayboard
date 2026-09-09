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
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Sparkles, RefreshCw, ExternalLink, UserPlus, Loader2, Check, X, Crown, AlertTriangle,
  MessageSquare, CheckCircle2, Star, Phone, ClipboardCheck, Undo2, Clock, Copy, Send, ChevronDown, ChevronRight,
  Circle, CircleDot, Ban, Plus, ListChecks, Lock, MapPin, CalendarDays,
} from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { CommandDay, NextItem, NextAction, Handled } from '@/lib/command-day'
import { OWNER_LABEL, type Owner } from '@/lib/command-types'
import { matchRoster } from '@/lib/roster-match'
import { openEve } from '@/components/EveFloat'
import { SlackQueueCard } from '@/components/SlackQueueCard'
import { AvailabilityAlert } from '@/components/AvailabilityAlert'

type Roster = { id: number; name: string; departments: string[] }
type TileKey = 'cleans' | 'arrivals' | 'tasks' | 'team' | 'glitches' | 'claims' | 'overdue' | 'guestDesk'

const DAY_URL = '/api/command/day'
const MINE_URL = '/api/projects/mine'
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const fmtLeft = (m: number) => { const a = Math.abs(m); const h = Math.floor(a / 60); return (h ? h + 'h ' : '') + (a % 60) + 'm' }
const fmtH = (mins: number) => { const m = Math.max(0, Math.round(mins)); const h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm' }
const ago = (iso: string, tick: number) => { void tick; const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago' }
const clock = (iso: string) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) } catch { return '' } }
const bz = (id: string) => 'https://app.breezeway.io/task/' + id
const BTN = 'text-[12px] font-bold px-3 py-1.5 rounded-lg shrink-0 inline-flex items-center gap-1 min-h-[34px] disabled:opacity-50'
const ICON_BTN = 'inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0'
const CARD = 'rounded-2xl border border-line bg-white overflow-hidden'

/** Recommendation = the engine proposes a change a person commits. Pending = in motion; follow it. */
const isRecommendation = (i: NextItem) => !!i.action && (i.action.type === 'create_task' || i.action.type === 'assign' || i.action.type === 'cancel_task')

export function CommandCockpit() {
  const { data, loading, error, refresh } = useCachedFetch<CommandDay & { error?: string }>(DAY_URL, { ttl: 60_000 })
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
  const [owner, setOwner] = useState<Owner | 'all'>('all')
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
  const p = data.pulse, t = data.tiles, v = data.verdict
  const occ = p.active ? Math.round((p.occupiedTonight / p.active) * 100) : null
  const live = data.next.filter(i => !i.dismissed)
  const recs = live.filter(isRecommendation)
  const pend = live.filter(i => !isRecommendation(i))
  const byOwnerFilter = (rows: NextItem[]) => owner === 'all' ? rows : rows.filter(i => i.owner === owner)

  const stats: { key: TileKey; label: string; value: string; sub: string; tone: Tone }[] = [
    { key: 'cleans', label: 'Cleans', value: t.cleans.done + '/' + t.cleans.total, sub: t.cleans.late ? t.cleans.late + ' late' : t.cleans.atRisk ? t.cleans.atRisk + ' at risk' : t.cleans.running ? t.cleans.running + ' running' : '', tone: t.cleans.late ? 'hot' : t.cleans.atRisk ? 'warn' : t.cleans.total && t.cleans.done === t.cleans.total ? 'ok' : 'quiet' },
    { key: 'arrivals', label: 'Arrivals', value: String(t.arrivals.today), sub: t.arrivals.bigToday ? t.arrivals.bigToday + ' big' + (t.arrivals.missingInspection ? ' · ' + t.arrivals.missingInspection + ' uninspected' : '') : '', tone: t.arrivals.missingInspection ? 'warn' : 'quiet' },
    { key: 'tasks', label: 'Tasks', value: t.tasks.open + ' open', sub: [t.tasks.unassigned ? t.tasks.unassigned + ' unowned' : '', t.tasks.urgent ? t.tasks.urgent + ' urgent' : ''].filter(Boolean).join(' · '), tone: t.tasks.unassigned || t.tasks.late ? 'warn' : 'quiet' },
    { key: 'team', label: 'Team', value: t.team.onShift ? t.team.onShift + ' · ' + t.team.utilisationPct + '%' : '0', sub: t.team.onShift ? [t.team.overloaded ? t.team.overloaded + ' over' : '', t.team.idle.length ? t.team.idle.length + ' idle' : ''].filter(Boolean).join(' · ') : 'nobody on shift', tone: t.team.utilisationPct > 100 || t.team.idle.length ? 'warn' : t.team.onShift ? 'quiet' : 'hot' },
    { key: 'glitches', label: 'Glitches', value: String(t.glitches.open), sub: t.glitches.overdue ? t.glitches.overdue + ' overdue' : t.glitches.noTask ? t.glitches.noTask + ' no task' : '', tone: t.glitches.overdue ? 'hot' : t.glitches.noTask ? 'warn' : t.glitches.open ? 'quiet' : 'ok' },
    { key: 'claims', label: 'Claims', value: String(t.claims.open), sub: t.claims.review ? t.claims.review + ' to review' : t.claims.dueSoon ? t.claims.dueSoon + ' due' : '', tone: t.claims.dueSoon ? 'hot' : t.claims.review ? 'warn' : 'quiet' },
    { key: 'overdue', label: 'Overdue', value: String(t.overdue.total), sub: '', tone: t.overdue.total > 40 ? 'hot' : t.overdue.total ? 'warn' : 'ok' },
    { key: 'guestDesk', label: 'Guest desk', value: String(t.guestDesk.total), sub: [t.guestDesk.messages ? t.guestDesk.messages + ' msgs' : '', t.guestDesk.welcome ? t.guestDesk.welcome + ' calls' : '', t.guestDesk.reviews ? t.guestDesk.reviews + ' reviews' : ''].filter(Boolean).slice(0, 2).join(' · '), tone: t.guestDesk.messages || t.guestDesk.approvals ? 'warn' : 'quiet' },
  ]

  const vDot = v.state === 'behind' ? 'bg-rose-600' : v.state === 'at_risk' ? 'bg-amber-500' : v.state === 'closing' ? 'bg-slate-500' : 'bg-emerald-600'
  const vText = v.state === 'behind' ? 'text-rose-800' : v.state === 'at_risk' ? 'text-amber-800' : v.state === 'closing' ? 'text-slate-800' : 'text-emerald-800'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      <div className="lg:col-span-2 min-w-0 space-y-4">
        {/* ── 1. THE DAY ─────────────────────────────────────────────────────────────────────── */}
        <section className={CARD + ' px-4 py-3'} aria-live="polite">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={'w-2.5 h-2.5 rounded-full shrink-0 ' + vDot} aria-hidden />
            <span className={'text-[17px] font-bold leading-tight ' + vText}>{v.headline}</span>
            <span className="text-[14px] text-ink/80">{v.detail}</span>
            <button onClick={reload} aria-label="Refresh the day" title="Refresh" className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-ink min-h-[32px] px-1">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {ago(data.generatedAt, tick)}
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[12.5px] text-muted">
            {occ != null && <span><b className="text-ink">{occ}%</b> tonight</span>}
            <span><b className="text-ink">{p.arrivals}</b> in</span>
            <span><b className="text-ink">{p.departures}</b> out</span>
            <span className={p.sameDayTurns > 0 ? 'font-bold text-ink' : ''}>{p.sameDayTurns} same-day</span>
            <span><b className="text-ink">{p.cleansDone}/{p.cleansTotal}</b> cleans{p.cleansTotal > p.cleansDone ? ' · ' + (p.minsLeft < 0 ? fmtLeft(p.minsLeft) + ' past 4pm' : fmtLeft(p.minsLeft) + ' to 4pm') : ''}</span>
            <span>{p.vacant} vacant</span>
            <span className="hidden sm:inline">· {v.tomorrow}</span>
          </div>
          {data.degraded.length > 0 && (
            <div className="mt-2 text-[11.5px] font-semibold text-rose-800 flex items-center gap-1.5"><AlertTriangle size={12} /> Some numbers are incomplete — could not read: {data.degraded.join(', ')}.</div>
          )}
        </section>

        {/* ── 2. THE NUMBERS — one strip; tap to open the rows underneath ────────────────────── */}
        <section>
          <div className="flex gap-1.5 flex-wrap">
            {stats.map(({ key, ...s }) => <Stat key={key} {...s} active={open === key} onClick={() => setOpen(open === key ? null : key)} />)}
          </div>
          {open && (
            <div className={CARD + ' mt-2'}>
              <div className="px-4 py-2 border-b border-line bg-app/60 flex items-center gap-2">
                <span className="text-[12.5px] font-bold text-ink">{stats.find(x => x.key === open)?.label}</span>
                <span className="text-[11.5px] text-muted">{stats.find(x => x.key === open)?.sub}</span>
                <button onClick={() => setOpen(null)} className={ICON_BTN + ' ml-auto text-muted hover:text-ink'} aria-label="Close"><X size={15} /></button>
              </div>
              <TilePanel key={open} k={open} d={data} roster={roster} onChanged={reload} />
            </div>
          )}
        </section>

        {/* ── 3 + 4. RECOMMENDATIONS · PENDING ──────────────────────────────────────────────── */}
        <ListSection
          title="Recommendations" count={recs.length}
          empty="Nothing to propose — turns covered, arrivals inspected, no duplicates."
          rows={byOwnerFilter(recs)} allRows={recs} roster={roster} onChanged={reload} d={data}
          owner={owner} setOwner={setOwner} showOwnerFilter handoff />
        <ListSection
          title="Pending" count={pend.length}
          empty="Nothing in flight needs a follow-up."
          rows={byOwnerFilter(pend)} allRows={pend} roster={roster} onChanged={reload} d={data}
          owner={owner} setOwner={setOwner} hiddenSoon />
      </div>

      <div className="lg:col-span-1 space-y-4 min-w-0">
        {/* Slack messages waiting for approval — renders nothing when the queue is empty. */}
        <SlackQueueCard />
        <MyTasksCard />
        <CompletedCard d={data} onChanged={reload} tick={tick} />
        <EveLine />
        {/* A listing-settings check, not the day — it stays, quietly, at the bottom. */}
        <AvailabilityAlert />
      </div>
    </div>
  )
}

// ── THE NUMBERS ─────────────────────────────────────────────────────────────────────────────────
type Tone = 'ok' | 'warn' | 'hot' | 'quiet'
function Stat({ label, value, sub, tone, active, onClick }: { label: string; value: string; sub: string; tone: Tone; active: boolean; onClick: () => void }) {
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

// ── THE LISTS ───────────────────────────────────────────────────────────────────────────────────
const SEV: { key: NextItem['severity']; label: string; dot: string }[] = [
  { key: 'now', label: 'Now', dot: 'bg-rose-500' },
  { key: 'today', label: 'Before the day ends', dot: 'bg-amber-400' },
  { key: 'soon', label: 'Next 48 hours', dot: 'bg-sky-400' },
]
const KIND_LABEL: Record<NextItem['kind'], string> = { turn: 'Same-day turn', late: 'Late clean', inspection: 'Inspection', feedback: 'Guest feedback', pending: 'Backlog', duplicate: 'Duplicate', glitch: 'Guest issue', claim: 'Claim', guest: 'Guest', unassigned: 'Unowned' }

function ListSection({ title, count, empty, rows, allRows, roster, onChanged, d, owner, setOwner, showOwnerFilter, handoff, hiddenSoon }: {
  title: string; count: number; empty: string; rows: NextItem[]; allRows: NextItem[]; roster: Roster[]; onChanged: () => void; d: CommandDay
  owner: Owner | 'all'; setOwner: (o: Owner | 'all') => void; showOwnerFilter?: boolean; handoff?: boolean; hiddenSoon?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const hiddenTotal = hiddenSoon ? Object.values(d.hiddenSoon).reduce((a, b) => a + (b || 0), 0) : 0
  // COORDINATION: the live list as text for the group chat — written by the engine that ranks it.
  const copyHandoff = async () => {
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const lines: string[] = ['LIGHTHOUSE — ' + when, d.verdict.headline + ' — ' + d.verdict.detail, '']
    const live = d.next.filter(i => !i.dismissed)
    for (const g of SEV) {
      const rs = live.filter(i => i.severity === g.key)
      if (!rs.length) continue
      lines.push(g.label.toUpperCase() + ' (' + rs.length + ')')
      for (const i of rs) lines.push('• ' + i.unit + ' — ' + i.title + ' · ' + OWNER_LABEL[i.owner] + ' · ' + i.due)
      lines.push('')
    }
    lines.push(d.verdict.tomorrow)
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }
  return (
    <section>
      <div className="flex items-center gap-2 flex-wrap mb-1.5 px-1">
        <h2 className="text-[15px] font-bold text-ink tracking-tight">{title} <span className="text-muted font-semibold tabular-nums">{count}</span></h2>
        <span className="ml-auto flex items-center gap-1.5">
          {showOwnerFilter && (
            <select value={owner} onChange={e => setOwner(e.target.value as any)} aria-label="Filter both lists by owner"
              className="text-[12px] font-semibold rounded-lg border border-line bg-white px-2 py-1.5 text-ink min-h-[32px]">
              <option value="all">All lanes · {d.next.filter(i => !i.dismissed).length}</option>
              {(Object.keys(OWNER_LABEL) as Owner[]).map(o => <option key={o} value={o}>{OWNER_LABEL[o]} · {d.byOwner[o]}</option>)}
            </select>
          )}
          {handoff && d.next.some(i => !i.dismissed) && (
            <button onClick={copyHandoff} className={ICON_BTN + ' border border-line bg-white text-muted hover:text-ink'} title="Copy the whole live list as text for the group chat" aria-label="Copy handoff">
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
            </button>
          )}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className={CARD + ' px-4 py-4 text-[13px] text-muted flex items-center gap-2'}>
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" /> {allRows.length === 0 ? empty : 'Nothing on the ' + (owner === 'all' ? '' : OWNER_LABEL[owner as Owner] + ' ') + 'lane.'}
        </div>
      ) : (
        <div className={CARD}>
          {SEV.map(g => {
            const rs = rows.filter(i => i.severity === g.key)
            if (!rs.length) return null
            return (
              <div key={g.key}>
                <div className="px-3 py-1.5 flex items-center gap-1.5 bg-app/50 border-b border-line">
                  <span className={'w-1.5 h-1.5 rounded-full ' + g.dot} aria-hidden />
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink/70">{g.label}</span>
                  <span className="text-[10.5px] text-muted tabular-nums">{rs.length}</span>
                </div>
                <div className="divide-y divide-line">
                  {rs.map(i => <Row key={i.key} item={i} roster={roster} onChanged={onChanged} />)}
                </div>
              </div>
            )
          })}
          {hiddenTotal > 0 && (
            <div className="px-3 py-2 text-[11.5px] text-muted border-t border-line">
              + {hiddenTotal} more in the next 48 hours not shown ({Object.entries(d.hiddenSoon).map(([k, n]) => n + ' ' + KIND_LABEL[k as NextItem['kind']].toLowerCase()).join(', ')}) — <Link href="/plan" className="font-semibold text-brand-700">Today in Ops</Link> has the full board.
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Row({ item: i, roster, onChanged }: { item: NextItem; roster: Roster[]; onChanged: () => void }) {
  const [mode, setMode] = useState<'' | 'assign' | 'cancel' | 'note'>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const [pw, setPw] = useState('')
  const [note, setNote] = useState('')
  const [quote, setQuote] = useState(false)

  const post = async (url: string, method: string, body: any) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false || j.error) throw new Error(j.error || 'Request failed'); return j
  }
  const wrap = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e: any) { setErr(String(e?.message || e)) } setBusy(false) }
  // Clear the row for everyone. done = it counts under Completed; skipped = not relevant today.
  const clear = (outcome: 'done' | 'skipped') => post('/api/command/dismiss', 'POST', { key: i.key, outcome, title: i.title, unit: i.unit })
  const markDone = () => wrap(async () => { await clear('done'); onChanged() })
  const skip = () => wrap(async () => { await clear('skipped'); onChanged() })
  const run = (a: NextAction) => {
    if (a.type === 'open') return
    if (a.type === 'assign') { setMode(mode === 'assign' ? '' : 'assign'); return }
    if (a.type === 'cancel_task') { setMode(mode === 'cancel' ? '' : 'cancel'); return }
    // Creating the task IS doing the recommendation — it lands under Completed as done.
    wrap(async () => { await post('/api/ops-today/add-task', 'POST', a.payload); await clear('done').catch(() => {}); setDone('Filed in Breezeway'); onChanged() })
  }
  const cancelDup = () => wrap(async () => {
    if (i.action?.type !== 'cancel_task') return
    await post('/api/ops-today/task-action', 'POST', { taskId: i.action.taskId, action: 'delete', adminPassword: pw })
    await clear('done').catch(() => {})
    setDone('Duplicate cancelled'); setMode(''); onChanged()
  })
  const sendNote = () => wrap(async () => {
    if (!i.bzTaskId || !note.trim()) return
    await post('/api/comments', 'POST', { type: 'task', id: i.bzTaskId, body: note.trim(), label: i.unit, link: '/command' })
    setDone('Note sent to the task'); setNote(''); setMode('')
  })
  const a = i.action
  const ev = i.evidence

  return (
    <div className="px-3 py-2">
      <div className="flex items-start gap-2.5 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="text-[13px] leading-snug">
            <span className="font-bold text-ink">{i.unit}</span>
            <span className="text-ink/85"> — {i.title}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted leading-snug flex items-center gap-x-1.5 flex-wrap">
            <span className="font-semibold text-ink/70">{KIND_LABEL[i.kind]}</span>
            <span>·</span><span className="inline-flex items-center gap-1"><Clock size={10} aria-hidden /> {i.due}</span>
            <span>·</span><span>{OWNER_LABEL[i.owner]}</span>
            {i.market && <><span>·</span><span>{i.market}</span></>}
            <span className="basis-full sm:basis-auto sm:before:content-['·'] sm:before:mr-1.5">{i.why}</span>
            {ev && (
              <button onClick={() => setQuote(q => !q)} className="inline-flex items-center gap-0.5 font-semibold text-brand-700 min-h-[24px]" aria-expanded={quote}>
                <Star size={10} /> {ev.stars != null ? (/booking/i.test(ev.channel) ? Math.round(ev.stars * 20) / 10 + '/10' : ev.stars + '★') : 'review'} {quote ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            )}
          </div>
          {ev && quote && <p className="text-[12px] text-ink/70 italic mt-1 leading-snug border-l-2 border-line pl-2">&ldquo;{ev.quote}&rdquo; <span className="not-italic text-muted">— {ev.channel}{ev.date ? ' · ' + ev.date : ''}</span></p>}
          {err && <p className="text-[11.5px] text-rose-600 font-semibold mt-1">{err}</p>}
          {done && <p className="text-[11.5px] text-emerald-700 font-semibold mt-1 inline-flex items-center gap-1"><Check size={12} /> {done}</p>}
        </div>
        <span className="flex items-center gap-1 shrink-0 w-full justify-end sm:w-auto">
          {!done && a && (a.type === 'open'
            ? (a.external
              ? <a href={a.href} target="_blank" rel="noreferrer" className={BTN + ' border border-line bg-white text-ink hover:border-ink/40'}>{a.label} <ExternalLink size={11} /></a>
              : <Link href={a.href} className={BTN + ' border border-line bg-white text-ink hover:border-ink/40'}>{a.label} →</Link>)
            : <button onClick={() => run(a)} disabled={busy} className={BTN + ' ' + (mode === 'assign' || mode === 'cancel' ? 'bg-white border border-ink text-ink' : 'bg-ink text-white')}>
                {busy ? <Loader2 size={11} className="animate-spin" /> : a.type === 'assign' ? <UserPlus size={11} /> : null} {a.label}
              </button>)}
          {i.bzTaskId && (
            <button onClick={() => setMode(mode === 'note' ? '' : 'note')} aria-expanded={mode === 'note'} title="Send a note to whoever holds this task" className={ICON_BTN + ' text-muted hover:text-ink' + (mode === 'note' ? ' bg-app text-ink' : '')}><MessageSquare size={14} /></button>
          )}
          {i.bzTaskId && a?.type !== 'open' && <a href={bz(i.bzTaskId)} target="_blank" rel="noreferrer" aria-label="Open in Breezeway" title="Open in Breezeway" className={ICON_BTN + ' text-muted hover:text-ink'}><ExternalLink size={13} /></a>}
          <button onClick={markDone} disabled={busy} aria-label="Done — it happened" title="Done (lands under Completed, for everyone)" className={ICON_BTN + ' text-muted hover:text-emerald-600 hover:bg-emerald-50'}><CheckCircle2 size={16} /></button>
          <button onClick={skip} disabled={busy} aria-label="Skip for today" title="Skip for today (everyone sees it go)" className={ICON_BTN + ' text-muted/70 hover:text-ink'}><X size={14} /></button>
        </span>
      </div>
      {mode === 'assign' && a?.type === 'assign' && <InlineAssign taskId={a.taskId} dept={a.dept} roster={roster} onDone={async () => { setMode(''); setDone('Assigned'); await clear('done').catch(() => {}); onChanged() }} />}
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

// ── MY TASKS — every Projects board, your name on it ───────────────────────────────────────────
type MineItem = { id: string; projectId: string; title: string; status: string; due: string | null; priority: string; section: string | null; project: string; oneOnOne: boolean; where: string | null; mine?: boolean }
type Mine = { ok: boolean; today: string; total: number; groups: { overdue: MineItem[]; today: MineItem[]; week: MineItem[]; later: MineItem[]; someday: MineItem[] }; board?: { id: string; title: string } | null; error?: string }
const MINE_ICON: Record<string, any> = { todo: Circle, doing: CircleDot, blocked: Ban, done: Check }
const MINE_CLS: Record<string, string> = { todo: 'text-muted border-line hover:border-ink', doing: 'text-amber-600 border-amber-300 bg-amber-50', blocked: 'text-rose-600 border-rose-300 bg-rose-50', done: 'text-white bg-emerald-500 border-emerald-500' }
const niceDay = (ymd: string | null) => { if (!ymd) return ''; try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }

function MyTasksCard() {
  const { data, loading, error, refresh } = useCachedFetch<Mine>(MINE_URL, { ttl: 60_000 })
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const [showLater, setShowLater] = useState(false)
  const reload = () => { invalidateCache(MINE_URL); refresh() }
  // No Projects access → no card. A card explaining why it is empty is furniture.
  if (error && /403|forbidden|not allowed|permission/i.test(error)) return null
  const g = data?.groups
  const soon = g ? [...g.overdue.map(x => ({ ...x, late: true })), ...g.today, ...g.week] : []
  const later = g ? [...g.later, ...g.someday] : []
  const shown = showLater ? [...soon, ...later] : soon
  const total = data?.total || 0

  const toggle = async (it: MineItem) => {
    setBusy(it.id); setErr('')
    try {
      const r = await fetch('/api/projects/' + it.projectId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'taskSet', taskId: it.id, status: it.status === 'done' ? 'todo' : 'done' }) })
      const j = await r.json().catch(() => ({})); if (!r.ok || j?.error) throw new Error(j?.message || j?.error || 'Could not update.')
      reload()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }
  const add = async () => {
    const title = draft.trim(); if (!title) return
    setBusy('add'); setErr('')
    try {
      const r = await fetch(MINE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
      const j = await r.json().catch(() => ({})); if (!r.ok || j?.error) throw new Error(j?.message || j?.error || 'Could not add.')
      setDraft(''); reload()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }

  return (
    <section className={CARD}>
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
        <ListChecks size={14} className="text-muted" />
        <h2 className="text-[13.5px] font-bold text-ink">My tasks <span className="text-muted font-semibold tabular-nums">{total}</span></h2>
        <Link href="/projects/mine" className="ml-auto text-[11.5px] font-semibold text-brand-700">All boards →</Link>
      </div>
      {loading && !data && <div className="px-4 py-3 text-[12.5px] text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Reading your boards…</div>}
      {error && !data && <div className="px-4 py-3 text-[12px] text-rose-700">{error}</div>}
      {data && shown.length === 0 && (
        <div className="px-4 py-3 text-[12.5px] text-muted flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> {total === 0 ? 'Nothing has your name on it.' : 'Nothing due this week' + (later.length ? ' — ' + later.length + ' later.' : '.')}</div>
      )}
      {shown.length > 0 && (
        <div className="divide-y divide-line">
          {shown.map(it => {
            const I = MINE_ICON[it.status] || Circle
            const late = (it as any).late
            return (
              <div key={it.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-app/50">
                <button onClick={() => toggle(it)} disabled={busy === it.id} title="Mark done" aria-label={'Mark done: ' + it.title}
                  className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + MINE_CLS[it.status]}>
                  {busy === it.id ? <Loader2 size={10} className="animate-spin" /> : <I size={11} strokeWidth={3} />}
                </button>
                <Link href={'/projects/' + it.projectId} className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-ink truncate">{it.title}</span>
                  <span className="block text-[10.5px] text-muted truncate">
                    {it.oneOnOne && <Lock size={9} className="inline -mt-0.5 mr-0.5" />}{it.mine ? 'My board' : it.project}
                    {it.where && <> · <MapPin size={9} className="inline -mt-0.5" /> {it.where}</>}
                  </span>
                </Link>
                {(it.priority === 'urgent' || it.priority === 'high') && <span className={'text-[9.5px] font-bold uppercase px-1 py-0.5 rounded shrink-0 ' + (it.priority === 'urgent' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}>{it.priority}</span>}
                <span className={'text-[10.5px] tabular-nums shrink-0 inline-flex items-center gap-1 ' + (late ? 'text-rose-600 font-bold' : 'text-muted')}><CalendarDays size={10} />{it.due ? niceDay(it.due) : '—'}</span>
              </div>
            )
          })}
        </div>
      )}
      {data && later.length > 0 && soon.length > 0 && (
        <button onClick={() => setShowLater(s => !s)} className="w-full text-left px-4 py-1.5 text-[11.5px] font-semibold text-muted hover:text-ink border-t border-line">
          {showLater ? 'Hide' : 'Show'} {later.length} later / undated
        </button>
      )}
      <div className="px-3 py-2 border-t border-line flex items-center gap-2">
        <Plus size={13} className="text-muted shrink-0" />
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} disabled={busy === 'add'}
          placeholder="Add a task for yourself…" className="flex-1 min-w-0 bg-transparent text-[12.5px] py-1 focus:outline-none placeholder:text-muted/70" />
        {draft.trim() && <button onClick={add} disabled={busy === 'add'} className="text-[11.5px] font-bold rounded-lg bg-ink text-white px-2.5 py-1">{busy === 'add' ? <Loader2 size={11} className="animate-spin" /> : 'Add'}</button>}
      </div>
      {err && <p className="px-4 pb-2 text-[11.5px] text-rose-700">{err}</p>}
    </section>
  )
}

// ── COMPLETED TODAY ─────────────────────────────────────────────────────────────────────────────
function CompletedCard({ d, onChanged, tick }: { d: CommandDay; onChanged: () => void; tick: number }) {
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

// ── EVE — one line; the floating bubble is on every page ──────────────────────────────────────
function EveLine() {
  return (
    <div className="flex items-center gap-1.5 flex-wrap px-1 text-[12px]">
      <button onClick={() => openEve()} className="inline-flex items-center gap-1.5 font-bold text-brand-700 min-h-[32px] mr-1"><Sparkles size={13} /> Ask Eve</button>
      <button onClick={() => openEve('What needs my attention today?')} className="rounded-full border border-line bg-white px-2.5 py-1 text-muted hover:text-ink whitespace-nowrap">What needs me?</button>
      <button onClick={() => openEve("Summarize today's arrivals")} className="rounded-full border border-line bg-white px-2.5 py-1 text-muted hover:text-ink whitespace-nowrap">Today&rsquo;s arrivals</button>
    </div>
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
        <Link href="/messages">Messages →</Link><Link href="/welcome-calls">Calls →</Link><Link href="/requests">Approvals →</Link><Link href="/reviews">Reviews →</Link>
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
      <div className="px-4 py-2"><Link href="/plan?tab=people" className="text-[12px] font-semibold text-brand-700">Open the People view on the board →</Link></div>
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
          className="text-[12px] font-semibold px-3 py-1.5 rounded-full border border-line bg-white hover:border-ink/40 disabled:opacity-50 min-h-[34px]">
          {busy === p.id ? <Loader2 size={11} className="animate-spin inline" /> : null} {p.name}
        </button>
      ))}
      {!all && roster.length > ppl.length && <button onClick={() => setAll(true)} className="text-[12px] font-semibold text-brand-700 min-h-[34px] px-2">everyone ({roster.length})</button>}
      {err && <span className="text-[11.5px] text-rose-600 font-semibold">{err}</span>}
    </div>
  )
}

function CockpitSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-pulse">
      <div className="lg:col-span-2 space-y-4">
        <div className="h-[76px] rounded-2xl bg-white border border-line" />
        <div className="flex gap-1.5">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[44px] w-24 rounded-xl bg-white border border-line" />)}</div>
        <div className="h-6 w-48 rounded bg-app" />
        <div className="h-40 rounded-2xl bg-white border border-line" />
        <div className="h-6 w-32 rounded bg-app" />
        <div className="h-28 rounded-2xl bg-white border border-line" />
      </div>
      <div className="space-y-4">
        <div className="h-40 rounded-2xl bg-white border border-line" />
        <div className="h-24 rounded-2xl bg-white border border-line" />
      </div>
    </div>
  )
}

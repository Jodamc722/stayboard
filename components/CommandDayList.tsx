'use client'
// COMMAND CENTER v5 — "MY DAY, ONE SCREEN" (Jon, 2026-09-18: v4 was "not actionable enough, wrong
// content/noise, visual/layout bad, rethink from scratch").
//
// ONE ranked list of everything that needs JON today, in four bands, each row with its one-tap
// action. Nothing informational above the fold — the numbers strip and the tile drawers still
// exist, behind "How's the day".
//
//   DECIDE  things only Jon can do: Eve's questions (answer in place), spend approvals (approve /
//           reject), claims in his review or near a filing deadline (review), Slack messages waiting
//           to send (send / skip).
//   FIX     exceptions only, from the engine's `next` list: a late clean, a turn nobody is on, a
//           guest waiting on a reply, a big arrival with no inspection, an overdue guest issue.
//   CLEAR   batches, one row per batch: cancel every duplicate (admin password once), copy one vendor
//           note for every vendor-run arrival with a bad past review, open the overdue-backlog units
//           in Today in Ops.
//   YOURS   the Projects tasks with Jon's name on them (/api/projects/mine), done-toggle, quick add.
//
// WHAT v4 SHOWED THAT IS NOT HERE, AND WHY (what the live page looked like on 2026-09-18):
//   · 8 of 9 "create inspection for an arrival into a unit with an old low review" rows said "an
//     inspection is already done on this unit" — those are dropped entirely (`isCoveredFeedback`).
//   · 11 same-day turns that were assigned and on track — that is Today in Ops' board, not a decision.
//   · 8 Botanica "flag it to the vendor" rows with no button — folded into ONE Clear batch that
//     writes the vendor note and copies it.
//   · 8 duplicate-task cancels, one password prompt each — one batch, one password.
//   · "Eve is asking you 35" in a collapsed right-rail card — now the top of Decide.
//   · the numbers strip + Completed card + pulse line taking the top third — behind two disclosures.
//   · the 3-column layout — one column, max-w 760, phone first.
//   · EveLine, VendorVisitsCard (→ "· N vendors on site" on the day line), the owner-lane filter.
//
// Data: the same one read (/api/command/day, lib/command-day unchanged). Everything is derived here.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  RefreshCw, ExternalLink, UserPlus, Loader2, Check, X, AlertTriangle, ChevronDown, ChevronRight,
  Send, Copy, Circle, Plus, Lock, MapPin, CalendarDays, ClipboardCheck, Star,
} from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { CommandDay, NextItem, NextAction, GuestDeskRow } from '@/lib/command-day'
import {
  Stat, TilePanel, InlineAssign, CompletedCard,
  BTN, ICON_BTN, CARD, DAY_URL, MINE_URL, MINE_ICON, MINE_CLS, niceDay,
  type Roster, type TileKey, type Tone, type Mine, type MineItem,
} from '@/components/CommandCockpit'
import { useSlackQueue, EVENT_LABEL, expiresIn, type Pending as SlackPending } from '@/components/SlackQueueCard'
import { AvailabilityAlert } from '@/components/AvailabilityAlert'

type Sev = NextItem['severity']
type Ranked = { key: string; sev: Sev; rank: number; node: ReactNode }
type EveQ = { id: string; question: string; why: string | null; scope: string; asked_count: number; source: string }
type VendorVisit = { id: string; tone: 'today' | 'soon' | 'later' | 'missed' | 'done' }

const EVE_COUNT_URL = '/api/eve/questions?count=1'
const HOW_KEY = 'cc5.how'
const SEV_RANK: Record<Sev, number> = { now: 0, today: 1, soon: 2 }
const bz = (id: string) => 'https://app.breezeway.io/task/' + id
const fmtLeft = (m: number) => { const a = Math.abs(m); const h = Math.floor(a / 60); return (h ? h + 'h ' : '') + (a % 60) + 'm' }
const ago = (iso: string, tick: number) => { void tick; const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago' }
const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : (many || one + 's'))
const PRIMARY = BTN + ' bg-ink text-white whitespace-nowrap'
const SECONDARY = ICON_BTN + ' text-muted hover:text-ink'

async function post(url: string, body: any, method = 'POST') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false || j.error) throw new Error(j.error || j.message || 'Request failed')
  return j
}
/** The shared clear mechanism — a row cleared here counts under "cleared here", for everyone. */
const clearRow = (i: { key: string; title?: string; unit?: string }, outcome: 'done' | 'skipped') =>
  post('/api/command/dismiss', { key: i.key, outcome, title: i.title, unit: i.unit })

// ── THE EXCLUSION RULES (the noise v4 showed) ───────────────────────────────────────────────────
/** A feedback row whose own `why` says an inspection already covers it. Pure noise; dropped. */
const isCoveredFeedback = (i: NextItem) => i.kind === 'feedback' && /inspection is already/i.test(i.why)
/** A feedback row in a vendor-run building: no button, only a note to the vendor. Batched in Clear. */
const isVendorFeedback = (i: NextItem) => i.kind === 'feedback' && !i.action && /vendor/i.test(i.why)
/** A same-day turn somebody is already on. Today in Ops' job, not a decision. */
const isOnTrackTurn = (i: NextItem) => i.kind === 'turn' && i.action?.type !== 'assign'
/** Glitch rows: only overdue ones and incidents are exceptions; "no task yet" is the desk's routine. */
const isGlitchException = (i: NextItem) => i.kind === 'glitch' && (i.severity === 'now' || /past its due date|incident/i.test(i.title))

function isFixRow(i: NextItem): boolean {
  if (i.kind === 'late' || i.kind === 'unassigned' || i.kind === 'guest' || i.kind === 'inspection') return true
  if (i.kind === 'turn') return !isOnTrackTurn(i)
  if (i.kind === 'glitch') return isGlitchException(i)
  if (i.kind === 'feedback') return !isCoveredFeedback(i) && !isVendorFeedback(i) && i.action?.type === 'create_task'
  return false
}
/** The one word on the button, by what the row is. */
function fixLabel(i: NextItem): string {
  const a = i.action
  if (!a) return 'Open'
  if (a.type === 'assign') return 'Assign'
  if (a.type === 'create_task') return 'Create inspection'
  if (i.kind === 'guest') return 'Reply'
  if (i.kind === 'glitch') return 'Open'
  return a.label || 'Open'
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function CommandDayList() {
  const { data, loading, error, refresh } = useCachedFetch<CommandDay & { error?: string }>(DAY_URL, { ttl: 60_000 })
  const { data: rosterRes } = useCachedFetch<{ people: Roster[] }>('/api/breezeway/people', { ttl: 10 * 60_000 })
  const { data: vendorRes } = useCachedFetch<{ visits: VendorVisit[] }>('/api/projects/vendor-visits', { ttl: 120_000 })
  const roster = useMemo(() => Array.isArray(rosterRes?.people) ? rosterRes!.people : [], [rosterRes])
  const vendorsOnSite = useMemo(() => (Array.isArray(vendorRes?.visits) ? vendorRes!.visits : []).filter(v => v.tone === 'today').length, [vendorRes])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') refresh() }
    const t = setInterval(onShow, 5 * 60 * 1000)
    const t2 = setInterval(() => setTick(x => x + 1), 30_000)
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(t); clearInterval(t2); document.removeEventListener('visibilitychange', onShow) }
  }, [refresh])
  const reload = () => { invalidateCache(DAY_URL); refresh() }
  /** Rows cleared from this screen since the last read — so a cleared row leaves at once. */
  const [gone, setGone] = useState<Record<string, boolean>>({})
  const hide = (key: string) => setGone(g => ({ ...g, [key]: true }))
  useEffect(() => { setGone({}) }, [data?.generatedAt])

  if (!data && loading) return <Skeleton />
  if (!data || !data.ok) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 flex items-center gap-3">
        <AlertTriangle size={15} /> <span className="flex-1">Could not read the day{error || (data as any)?.error ? ' — ' + (error || (data as any)?.error) : ''}.</span>
        <button onClick={reload} className="font-bold underline">Retry</button>
      </div>
    )
  }
  const live = data.next.filter(i => !i.dismissed && !gone[i.key])
  const fixRows = live.filter(isFixRow).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.rank - b.rank)
  const claims = live.filter(i => i.kind === 'claim')
  const dups = live.filter(i => i.kind === 'duplicate')
  const vendorNotes = live.filter(isVendorFeedback)
  const backlog = live.filter(i => i.kind === 'pending')
  const approvals = data.tiles.guestDesk.rows.filter(r => r.kind === 'approval' && !gone[r.key])

  return (
    <div className="max-w-[760px] mx-auto space-y-5">
      <DayLine d={data} loading={loading} tick={tick} reload={reload} roster={roster} vendorsOnSite={vendorsOnSite} />
      <DecideBand d={data} claims={claims} approvals={approvals} onCleared={hide} onChanged={reload} />
      <FixBand rows={fixRows} roster={roster} onCleared={hide} onChanged={reload} />
      <ClearBand d={data} dups={dups} vendorNotes={vendorNotes} backlog={backlog} onCleared={hide} onChanged={reload} />
      <YoursBand />
      <CompletedLine d={data} onChanged={reload} tick={tick} />
      <AvailabilityAlert />
    </div>
  )
}

// ── THE DAY — one line, and "How's the day" behind it ──────────────────────────────────────────
function DayLine({ d, loading, tick, reload, roster, vendorsOnSite }: { d: CommandDay; loading: boolean; tick: number; reload: () => void; roster: Roster[]; vendorsOnSite: number }) {
  const v = d.verdict, p = d.pulse, t = d.tiles
  const [how, setHow] = useState(false)
  const [tile, setTile] = useState<TileKey | null>(null)
  useEffect(() => { try { setHow(localStorage.getItem(HOW_KEY) === '1') } catch { /* private mode */ } }, [])
  const toggleHow = () => { setHow(o => { try { localStorage.setItem(HOW_KEY, o ? '0' : '1') } catch { /* ignore */ } return !o }) }
  const occ = p.active ? Math.round((p.occupiedTonight / p.active) * 100) : null
  const dot = v.state === 'behind' ? 'bg-rose-600' : v.state === 'at_risk' ? 'bg-amber-500' : v.state === 'closing' ? 'bg-slate-500' : 'bg-emerald-600'
  const text = v.state === 'behind' ? 'text-rose-800' : v.state === 'at_risk' ? 'text-amber-800' : v.state === 'closing' ? 'text-slate-800' : 'text-emerald-800'
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
  return (
    <section aria-live="polite">
      <div className="flex items-start gap-2.5">
        <span className={'w-2.5 h-2.5 rounded-full shrink-0 mt-[7px] ' + dot} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-[17px] leading-snug">
            <span className={'font-bold ' + text}>{v.headline}</span>
            <span className="text-[14px] text-ink/80"> — {v.detail}{vendorsOnSite > 0 ? ' · ' + plural(vendorsOnSite, 'vendor') + ' on site' : ''}</span>
          </div>
          <div className="mt-1 flex items-center gap-x-3 flex-wrap text-[11.5px] text-muted">
            <button onClick={toggleHow} aria-expanded={how} className="inline-flex items-center gap-0.5 font-semibold text-ink/70 hover:text-ink min-h-[28px]">
              How&rsquo;s the day {how ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            <button onClick={reload} aria-label="Refresh the day" title="Refresh" className="inline-flex items-center gap-1 text-muted hover:text-ink min-h-[28px]">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {ago(d.generatedAt, tick)}
            </button>
          </div>
        </div>
      </div>
      {d.degraded.length > 0 && (
        <div className="mt-2 text-[11.5px] font-semibold text-rose-800 flex items-center gap-1.5"><AlertTriangle size={12} /> Some numbers are incomplete — could not read: {d.degraded.join(', ')}.</div>
      )}
      {how && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[12.5px] text-muted px-1">
            {occ != null && <span><b className="text-ink">{occ}%</b> tonight</span>}
            <span><b className="text-ink">{p.arrivals}</b> in</span>
            <span><b className="text-ink">{p.departures}</b> out</span>
            <span className={p.sameDayTurns > 0 ? 'font-bold text-ink' : ''}>{p.sameDayTurns} same-day</span>
            <span><b className="text-ink">{p.cleansDone}/{p.cleansTotal}</b> cleans{p.cleansTotal > p.cleansDone ? ' · ' + (p.minsLeft < 0 ? fmtLeft(p.minsLeft) + ' past 4pm' : fmtLeft(p.minsLeft) + ' to 4pm') : ''}</span>
            <span>{p.vacant} vacant</span>
            <span>· {v.tomorrow}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {stats.map(({ key, ...s }) => <Stat key={key} {...s} active={tile === key} onClick={() => setTile(tile === key ? null : key)} />)}
          </div>
          {tile && (
            <div className={CARD}>
              <div className="px-4 py-2 border-b border-line bg-app/60 flex items-center gap-2">
                <span className="text-[12.5px] font-bold text-ink">{stats.find(x => x.key === tile)?.label}</span>
                <span className="text-[11.5px] text-muted">{stats.find(x => x.key === tile)?.sub}</span>
                <button onClick={() => setTile(null)} className={ICON_BTN + ' ml-auto text-muted hover:text-ink'} aria-label="Close"><X size={15} /></button>
              </div>
              <TilePanel key={tile} k={tile} d={d} roster={roster} onChanged={reload} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ── BAND + ROW primitives ───────────────────────────────────────────────────────────────────────
function Band({ name, count, empty, children }: { name: string; count: number; empty: string; children?: ReactNode }) {
  return (
    <section>
      <h2 className="px-1 mb-1.5 text-[15px] font-bold text-ink tracking-tight">{name} <span className="text-muted font-semibold tabular-nums">{count || ''}</span></h2>
      {count === 0 ? <p className="px-1 text-[12.5px] text-muted">{empty}</p> : <div className={CARD + ' divide-y divide-line'}>{children}</div>}
    </section>
  )
}
function SevDot({ sev }: { sev: Sev | null }) {
  return <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (sev === 'now' ? 'bg-rose-500' : sev === 'today' ? 'bg-amber-400' : 'bg-transparent')} aria-hidden />
}
/** One row: dot · title (one line) · meta (one line) · ONE primary button · at most one icon. */
function Row({ sev, title, meta, primary, secondary, onTap, expanded, children, note, err }: {
  sev: Sev | null; title: ReactNode; meta?: ReactNode; primary?: ReactNode; secondary?: ReactNode
  onTap?: () => void; expanded?: boolean; children?: ReactNode; note?: string; err?: string
}) {
  const body = (
    <>
      <span className="block text-[13px] font-semibold text-ink truncate leading-snug">{title}</span>
      {meta ? <span className="block text-[11.5px] text-muted truncate leading-snug">{meta}</span> : null}
    </>
  )
  return (
    <div className="px-3 py-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        <SevDot sev={sev} />
        {onTap
          ? <button onClick={onTap} aria-expanded={!!expanded} className="flex-1 min-w-0 text-left">{body}</button>
          : <div className="flex-1 min-w-0">{body}</div>}
        {primary}
        {secondary}
      </div>
      {(note || err) && <p className={'text-[11.5px] font-semibold mt-1 pl-3.5 ' + (err ? 'text-rose-600' : 'text-emerald-700')}>{err || note}</p>}
      {children}
    </div>
  )
}

// ── 1. DECIDE ───────────────────────────────────────────────────────────────────────────────────
function DecideBand({ d, claims, approvals, onCleared, onChanged }: { d: CommandDay; claims: NextItem[]; approvals: GuestDeskRow[]; onCleared: (key: string) => void; onChanged: () => void }) {
  const eve = useEveQuestions()
  const slack = useSlackQueue()
  const [allEve, setAllEve] = useState(false)
  const slackLive = slack.live || []
  const eveShown = allEve ? eve.rows : eve.rows.slice(0, 5)
  const eveMore = eve.rows.length - eveShown.length
  const eveCount = eve.rows.length || (eve.loaded ? 0 : eve.count)
  const approvalsHidden = Math.max(0, d.tiles.guestDesk.approvals - d.tiles.guestDesk.rows.filter(r => r.kind === 'approval').length)
  const count = slackLive.length + approvals.length + claims.length + eveCount

  const rows: Ranked[] = []
  for (const it of slackLive) rows.push({ key: 'slack:' + it.id, sev: 'now', rank: 0, node: <SlackRow item={it} q={slack} /> })
  for (const c of claims) rows.push({ key: c.key, sev: c.severity, rank: c.rank, node: <ClaimRow item={c} onCleared={onCleared} /> })
  for (const a of approvals) rows.push({ key: a.key, sev: 'today', rank: 3, node: <ApprovalRow row={a} onCleared={onCleared} onChanged={onChanged} /> })
  if (approvalsHidden > 0) rows.push({ key: 'ap:more', sev: 'today', rank: 3.5, node: <Row sev={null} title={plural(approvalsHidden, 'more approval') + ' waiting'} meta="Only the first few are listed here" primary={<Link href="/requests" className={PRIMARY}>Approvals</Link>} /> })
  for (const q of eveShown) rows.push({ key: 'eve:' + q.id, sev: 'today', rank: 9, node: <EveRow q={q} act={eve.act} busy={eve.busy === q.id} /> })
  if (!eve.loaded && eve.count > 0) rows.push({ key: 'eve:loading', sev: 'today', rank: 9, node: <Row sev={null} title={'Eve is asking you ' + eve.count} meta={<span className="inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> getting them</span>} /> })
  if (eveMore > 0) rows.push({ key: 'eve:more', sev: 'today', rank: 9.5, node: <button onClick={() => setAllEve(true)} className="w-full text-left px-3 py-2 min-h-[40px] text-[12px] font-semibold text-muted hover:text-ink">{eveMore} more from Eve</button> })
  rows.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || a.rank - b.rank)

  return (
    <Band name="Decide" count={count} empty="Nothing to decide.">
      {slack.err && <p className="px-3 py-2 text-[12px] text-rose-700">{slack.err}</p>}
      {rows.map(r => <div key={r.key}>{r.node}</div>)}
    </Band>
  )
}

/** Eve's open questions: a count first (cheap, 5 min), the rows only once the count says so. */
function useEveQuestions() {
  const { data, error } = useCachedFetch<{ count: number }>(EVE_COUNT_URL, { ttl: 300_000 })
  const count = error ? 0 : Number(data?.count || 0)
  const [qs, setQs] = useState<EveQ[] | null>(null)
  const [busy, setBusy] = useState('')
  useEffect(() => {
    if (count > 0 && qs === null) {
      fetch('/api/eve/questions').then(r => r.json()).then(r => setQs(Array.isArray(r?.questions) ? r.questions : [])).catch(() => setQs([]))
    }
  }, [count, qs])
  const act = async (id: string, op: 'answer' | 'dismiss', answer: string) => {
    setBusy(id)
    try {
      const res = await fetch('/api/eve/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id, answer }) })
      if (!res.ok) return false
      setQs(x => (x || []).filter(q => q.id !== id))
      invalidateCache(EVE_COUNT_URL)
      return true
    } finally { setBusy('') }
  }
  return { count, rows: qs || [], loaded: qs !== null || count === 0, busy, act }
}

function EveRow({ q, act, busy }: { q: EveQ; act: (id: string, op: 'answer' | 'dismiss', answer: string) => Promise<boolean>; busy: boolean }) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const send = async () => { if (!draft.trim()) return; setErr(''); const ok = await act(q.id, 'answer', draft.trim()); if (!ok) setErr('Could not save that answer.') }
  const meta = [q.scope, Number(q.asked_count) > 1 ? 'asked ' + q.asked_count + ' times' : '', q.source === 'eve' ? 'came up in conversation' : ''].filter(Boolean).join(' · ')
  return (
    <Row sev={null} title={q.question} meta={open && q.why ? 'Why: ' + q.why : meta} onTap={() => setOpen(o => !o)} expanded={open} err={err}
      secondary={<button onClick={() => act(q.id, 'dismiss', '')} disabled={busy} className={SECONDARY} aria-label="Later" title="Later — not worth answering now"><X size={14} /></button>}>
      {open && <p className="text-[12.5px] text-ink/80 mt-1 pl-3.5 leading-snug">{q.question}</p>}
      <div className="mt-1.5 pl-3.5 flex items-center gap-1.5">
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }} placeholder="Tell her…" aria-label={'Answer: ' + q.question}
          className="flex-1 min-w-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] min-h-[34px] focus:outline-none focus:ring-2 focus:ring-brand-200" />
        <button onClick={send} disabled={busy || !draft.trim()} className={PRIMARY}>{busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send</button>
      </div>
    </Row>
  )
}

function SlackRow({ item, q }: { item: SlackPending; q: ReturnType<typeof useSlackQueue> }) {
  const [open, setOpen] = useState(false)
  const busy = !!q.busy[item.id]
  const meta = [EVENT_LABEL[item.eventKey] || item.eventKey, expiresIn(item.expiresAt), item.itemCount > 1 ? item.itemCount + ' grouped' : '', item.audience?.length ? item.audience.length + ' tagged' : ''].filter(Boolean).join(' · ')
  return (
    <Row sev="now" title={item.summary || item.building || 'Slack message'} meta={meta} onTap={() => setOpen(o => !o)} expanded={open}
      primary={<button onClick={() => q.decide(item, true)} disabled={busy} className={PRIMARY}>{busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send</button>}
      secondary={<button onClick={() => q.decide(item, false)} disabled={busy} className={SECONDARY} aria-label="Skip" title="Skip — do not send"><X size={14} /></button>}>
      {open && <pre className="mt-2 ml-3.5 rounded-xl border border-line bg-app/40 p-3 text-[12px] text-ink whitespace-pre-wrap font-sans leading-relaxed">{q.preview(item)}</pre>}
    </Row>
  )
}

function ClaimRow({ item: i, onCleared }: { item: NextItem; onCleared: (k: string) => void }) {
  const [busy, setBusy] = useState(false)
  const done = async () => { setBusy(true); try { await clearRow(i, 'done'); onCleared(i.key) } catch { /* shown on reload */ } setBusy(false) }
  return (
    <Row sev={i.severity} title={i.unit + ' — ' + i.title} meta={i.why + ' · ' + i.due}
      primary={<Link href="/claims" className={PRIMARY}>Review</Link>}
      secondary={<button onClick={done} disabled={busy} className={SECONDARY + ' hover:text-emerald-600'} aria-label="Done" title="Done — it happened"><Check size={15} /></button>} />
  )
}

/** field_requests spend approvals — the same decide call /requests uses (approver stamped server-side). */
function ApprovalRow({ row, onCleared, onChanged }: { row: GuestDeskRow; onCleared: (k: string) => void; onChanged: () => void }) {
  const id = row.key.replace(/^ap:/, '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const decide = async (approved: boolean) => {
    setBusy(true); setErr('')
    try { await post('/api/requests/update', { action: 'decide', id, approved }); onCleared(row.key); onChanged() }
    catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <Row sev="today" title={row.who + (row.unit ? ' · ' + row.unit : '') + ' — ' + row.text} meta={row.meta + ' · spend approval'} err={err}
      primary={<button onClick={() => decide(true)} disabled={busy} className={PRIMARY}>{busy ? <Loader2 size={11} className="animate-spin" /> : <ClipboardCheck size={11} />} Approve</button>}
      secondary={<button onClick={() => decide(false)} disabled={busy} className={SECONDARY + ' hover:text-rose-600'} aria-label="Reject" title="Reject"><X size={14} /></button>} />
  )
}

// ── 2. FIX ──────────────────────────────────────────────────────────────────────────────────────
function FixBand({ rows, roster, onCleared, onChanged }: { rows: NextItem[]; roster: Roster[]; onCleared: (k: string) => void; onChanged: () => void }) {
  return (
    <Band name="Fix" count={rows.length} empty="Nothing to fix.">
      {rows.map(i => <FixRow key={i.key} item={i} roster={roster} onCleared={onCleared} onChanged={onChanged} />)}
    </Band>
  )
}

function FixRow({ item: i, roster, onCleared, onChanged }: { item: NextItem; roster: Roster[]; onCleared: (k: string) => void; onChanged: () => void }) {
  const [assign, setAssign] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [quote, setQuote] = useState(false)
  const a = i.action
  const wrap = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e: any) { setErr(String(e?.message || e)) } setBusy(false) }
  const finish = async (msg: string) => { await clearRow(i, 'done').catch(() => {}); setNote(msg); setTimeout(() => onCleared(i.key), 900); onChanged() }
  const run = (act: NextAction) => {
    if (act.type === 'assign') { setAssign(o => !o); return }
    if (act.type === 'create_task') wrap(async () => { await post('/api/ops-today/add-task', act.payload); await finish('Filed in Breezeway') })
  }
  const markDone = () => wrap(() => finish('Done'))
  const label = fixLabel(i)
  const meta = i.due + ' · ' + i.why
  const primary = !a ? null
    : a.type === 'open'
      ? (a.external
        ? <a href={a.href} target="_blank" rel="noreferrer" className={PRIMARY}>{label} <ExternalLink size={11} /></a>
        : <Link href={a.href} className={PRIMARY}>{label}</Link>)
      : <button onClick={() => run(a)} disabled={busy} className={assign ? BTN + ' bg-white border border-ink text-ink whitespace-nowrap' : PRIMARY}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : a.type === 'assign' ? <UserPlus size={11} /> : null} {label}
        </button>
  return (
    <Row sev={i.severity} title={i.unit + ' — ' + i.title} meta={meta} note={note} err={err}
      onTap={i.evidence ? () => setQuote(q => !q) : undefined} expanded={quote}
      primary={primary}
      secondary={<button onClick={markDone} disabled={busy} className={SECONDARY + ' hover:text-emerald-600'} aria-label="Done" title="Done — it happened (counts as cleared here)"><Check size={15} /></button>}>
      {quote && i.evidence && (
        <p className="text-[12px] text-ink/70 italic mt-1 ml-3.5 leading-snug border-l-2 border-line pl-2">
          <Star size={10} className="inline -mt-0.5 mr-0.5 not-italic" />&ldquo;{i.evidence.quote}&rdquo; <span className="not-italic text-muted">— {i.evidence.channel}{i.evidence.date ? ' · ' + i.evidence.date : ''}</span>
        </p>
      )}
      {assign && a?.type === 'assign' && (
        <div className="ml-3.5"><InlineAssign taskId={a.taskId} dept={a.dept} roster={roster} onDone={() => { setAssign(false); wrap(() => finish('Assigned')) }} /></div>
      )}
    </Row>
  )
}

// ── 3. CLEAR — batches ──────────────────────────────────────────────────────────────────────────
function ClearBand({ d, dups, vendorNotes, backlog, onCleared, onChanged }: { d: CommandDay; dups: NextItem[]; vendorNotes: NextItem[]; backlog: NextItem[]; onCleared: (k: string) => void; onChanged: () => void }) {
  const count = (dups.length ? 1 : 0) + (vendorNotes.length ? 1 : 0) + (backlog.length ? 1 : 0)
  return (
    <Band name="Clear" count={count} empty="Nothing to clear.">
      {dups.length > 0 && <DupBatch rows={dups} onCleared={onCleared} onChanged={onChanged} />}
      {vendorNotes.length > 0 && <VendorNoteBatch today={d.today} rows={vendorNotes} onCleared={onCleared} onChanged={onChanged} />}
      {backlog.length > 0 && <BacklogBatch rows={backlog} />}
    </Band>
  )
}

function BatchItems({ rows, receipts }: { rows: NextItem[]; receipts?: Record<string, string> }) {
  return (
    <ul className="mt-1.5 ml-3.5 divide-y divide-line/70 border-t border-line/70">
      {rows.map(i => (
        <li key={i.key} className="py-1.5 flex items-center gap-2 text-[12px]">
          {receipts && receipts[i.key] && (receipts[i.key] === 'ok' ? <Check size={12} className="text-emerald-600 shrink-0" /> : <X size={12} className="text-rose-600 shrink-0" />)}
          <span className="min-w-0 flex-1 truncate"><b className="text-ink">{i.unit}</b> <span className="text-ink/80">— {i.title}</span></span>
          {receipts && receipts[i.key] && receipts[i.key] !== 'ok' && <span className="text-[11px] text-rose-600 truncate max-w-[40%]">{receipts[i.key]}</span>}
          {i.bzTaskId && <a href={bz(i.bzTaskId)} target="_blank" rel="noreferrer" aria-label="Open in Breezeway" className="text-muted hover:text-ink shrink-0"><ExternalLink size={12} /></a>}
        </li>
      ))}
    </ul>
  )
}

/** N duplicates → one password, applied to all, sequentially, with a receipt per item. */
function DupBatch({ rows, onCleared, onChanged }: { rows: NextItem[]; onCleared: (k: string) => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipts, setReceipts] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState('')
  const cancelAll = async () => {
    setBusy(true); setSummary('')
    let ok = 0
    for (const i of rows) {
      if (i.action?.type !== 'cancel_task') continue
      try {
        await post('/api/ops-today/task-action', { taskId: i.action.taskId, action: 'delete', adminPassword: pw })
        await clearRow(i, 'done').catch(() => {})
        setReceipts(r => ({ ...r, [i.key]: 'ok' })); ok++
      } catch (e: any) {
        setReceipts(r => ({ ...r, [i.key]: String(e?.message || e) }))
        // A wrong password fails every item the same way — stop after the first, keep the receipt.
        if (/password|unauthori|forbidden/i.test(String(e?.message || e))) break
      }
    }
    setSummary(ok + ' of ' + rows.length + ' cancelled')
    setBusy(false)
    if (ok) { onChanged(); if (ok === rows.length) setTimeout(() => rows.forEach(i => onCleared(i.key)), 1200) }
  }
  return (
    <Row sev="today" title={plural(rows.length, 'duplicate task') + ' open twice'} meta="Keep the one with a name on it, cancel the extra · admin password once" onTap={() => setOpen(o => !o)} expanded={open}
      note={summary}
      primary={<button onClick={() => setOpen(true)} className={open ? BTN + ' bg-white border border-ink text-ink whitespace-nowrap' : PRIMARY}>Cancel all</button>}>
      {open && (
        <>
          <div className="mt-2 ml-3.5 flex items-center gap-1.5">
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Admin password" aria-label="Admin password" onKeyDown={e => { if (e.key === 'Enter' && pw) cancelAll() }}
              className="flex-1 min-w-0 rounded-lg border border-line px-2.5 py-1.5 text-[13px] min-h-[34px]" />
            <button onClick={cancelAll} disabled={busy || !pw} className={BTN + ' bg-rose-600 text-white whitespace-nowrap'}>{busy ? <Loader2 size={11} className="animate-spin" /> : null} Cancel {rows.length}</button>
          </div>
          <BatchItems rows={rows} receipts={receipts} />
        </>
      )}
    </Row>
  )
}

/** N vendor-run arrivals with a bad past review → one plain-text note, copied, all marked handled. */
function VendorNoteBatch({ today, rows, onCleared, onChanged }: { today: string; rows: NextItem[]; onCleared: (k: string) => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const text = useMemo(() => {
    const lines = ['Vendor note — arrivals with past complaints — ' + today, '']
    for (const i of rows) {
      const ev = i.evidence
      lines.push('• ' + i.unit + ' — ' + i.title + '.')
      if (ev) lines.push('  "' + ev.quote + '" (' + (ev.stars != null ? ev.stars + '★, ' : '') + ev.channel + (ev.date ? ', ' + ev.date : '') + ')')
      lines.push('  Please check the unit before the guest lands.')
    }
    lines.push('', 'Sent from Lighthouse Command Center.')
    return lines.join('\n')
  }, [rows, today])
  const copy = async () => {
    setBusy(true); setErr('')
    try { await navigator.clipboard.writeText(text) } catch { setErr('Clipboard blocked — open the batch and copy the text by hand.'); setOpen(true); setBusy(false); return }
    for (const i of rows) await clearRow(i, 'done').catch(() => {})
    setNote('Copied · ' + rows.length + ' marked handled'); setBusy(false); onChanged()
    setTimeout(() => rows.forEach(i => onCleared(i.key)), 1200)
  }
  return (
    <Row sev="today" title={plural(rows.length, 'vendor-run arrival') + ' with low past reviews'} meta="No Breezeway in these buildings — one note to the vendor covers all of them" onTap={() => setOpen(o => !o)} expanded={open} note={note} err={err}
      primary={<button onClick={copy} disabled={busy} className={PRIMARY}>{busy ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />} Copy vendor note</button>}>
      {open && (
        <>
          <BatchItems rows={rows} />
          <pre className="mt-2 ml-3.5 rounded-xl border border-line bg-app/40 p-3 text-[12px] text-ink whitespace-pre-wrap font-sans leading-relaxed">{text}</pre>
        </>
      )}
    </Row>
  )
}

/** N overdue tasks in units a guest lands in → one link to the board that holds them. */
function BacklogBatch({ rows }: { rows: NextItem[] }) {
  const [open, setOpen] = useState(false)
  const allToday = rows.every(i => i.severity !== 'soon')
  return (
    <Row sev={rows.some(i => i.severity === 'today') ? 'today' : 'soon'} title={plural(rows.length, 'unit') + ' with overdue tasks and an arrival ' + (allToday ? 'today' : 'today or tomorrow')} meta="Backlog scheduled before the arrival day, still open" onTap={() => setOpen(o => !o)} expanded={open}
      primary={<Link href="/plan" className={PRIMARY}>Today in Ops</Link>}>
      {open && <BatchItems rows={rows} />}
    </Row>
  )
}

// ── 4. YOURS — every Projects board, your name on it ───────────────────────────────────────────
function YoursBand() {
  const { data, loading, error, refresh } = useCachedFetch<Mine>(MINE_URL, { ttl: 60_000 })
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const [showLater, setShowLater] = useState(false)
  const reload = () => { invalidateCache(MINE_URL); refresh() }
  if (error && /403|forbidden|not allowed|permission/i.test(error)) return null
  const g = data?.groups
  const soon: (MineItem & { late?: boolean })[] = g ? [...g.overdue.map(x => ({ ...x, late: true })), ...g.today, ...g.week] : []
  const later = g ? [...g.later, ...g.someday] : []
  const shown = showLater ? [...soon, ...later] : soon
  const total = data?.total || 0

  const toggle = async (it: MineItem) => {
    setBusy(it.id); setErr('')
    try {
      await post('/api/projects/' + it.projectId, { action: 'taskSet', taskId: it.id, status: it.status === 'done' ? 'todo' : 'done' })
      reload()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }
  const add = async () => {
    const title = draft.trim(); if (!title) return
    setBusy('add'); setErr('')
    try { await post(MINE_URL, { title }); setDraft(''); reload() }
    catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }
  const adder = (
    <div className="px-3 py-1.5 flex items-center gap-2 min-h-[44px]">
      <Plus size={13} className="text-muted shrink-0" />
      <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} disabled={busy === 'add'}
        placeholder="Add a task for yourself…" className="flex-1 min-w-0 bg-transparent text-[13px] py-1 focus:outline-none placeholder:text-muted/70" />
      {draft.trim() && <button onClick={add} disabled={busy === 'add'} className={PRIMARY}>{busy === 'add' ? <Loader2 size={11} className="animate-spin" /> : 'Add'}</button>}
    </div>
  )

  return (
    <section>
      <h2 className="px-1 mb-1.5 text-[15px] font-bold text-ink tracking-tight flex items-center gap-2">
        <span>Yours <span className="text-muted font-semibold tabular-nums">{total || ''}</span></span>
        <Link href="/projects/mine" className="ml-auto text-[11.5px] font-semibold text-brand-700">All boards</Link>
      </h2>
      {loading && !data && <p className="px-1 text-[12.5px] text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Reading your boards…</p>}
      {error && !data && <p className="px-1 text-[12px] text-rose-700">{error}</p>}
      {data && shown.length === 0 && <p className="px-1 text-[12.5px] text-muted">{total === 0 ? 'Nothing has your name on it.' : 'Nothing due this week' + (later.length ? ' — ' + later.length + ' later.' : '.')}</p>}
      <div className={CARD + ' divide-y divide-line' + (data && shown.length === 0 ? ' mt-1.5' : '')}>
        {shown.map(it => {
          const I = MINE_ICON[it.status] || Circle
          const late = !!(it as any).late
          return (
            <div key={it.id} className="flex items-center gap-2.5 px-3 py-1.5 min-h-[44px] hover:bg-app/50">
              <button onClick={() => toggle(it)} disabled={busy === it.id} title="Mark done" aria-label={'Mark done: ' + it.title}
                className={'w-6 h-6 rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + MINE_CLS[it.status]}>
                {busy === it.id ? <Loader2 size={10} className="animate-spin" /> : <I size={11} strokeWidth={3} />}
              </button>
              <Link href={'/projects/' + it.projectId} className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink truncate">{it.title}</span>
                <span className="block text-[11.5px] text-muted truncate">
                  {it.oneOnOne && <Lock size={9} className="inline -mt-0.5 mr-0.5" />}{it.mine ? 'My board' : it.project}
                  {it.where && <> · <MapPin size={9} className="inline -mt-0.5" /> {it.where}</>}
                  {(it.priority === 'urgent' || it.priority === 'high') && <> · <span className={it.priority === 'urgent' ? 'text-rose-700 font-bold' : 'text-amber-800 font-bold'}>{it.priority}</span></>}
                </span>
              </Link>
              <span className={'text-[11px] tabular-nums shrink-0 inline-flex items-center gap-1 ' + (late ? 'text-rose-600 font-bold' : 'text-muted')}><CalendarDays size={10} />{it.due ? niceDay(it.due) : '—'}</span>
            </div>
          )
        })}
        {data && later.length > 0 && soon.length > 0 && (
          <button onClick={() => setShowLater(s => !s)} className="w-full text-left px-3 py-2 min-h-[40px] text-[12px] font-semibold text-muted hover:text-ink">
            {showLater ? 'Hide' : 'Show'} {later.length} later / undated
          </button>
        )}
        {adder}
      </div>
      {err && <p className="px-1 pt-1 text-[11.5px] text-rose-700">{err}</p>}
    </section>
  )
}

// ── COMPLETED — one line, the card behind it ───────────────────────────────────────────────────
function CompletedLine({ d, onChanged, tick }: { d: CommandDay; onChanged: () => void; tick: number }) {
  const [open, setOpen] = useState(false)
  const c = d.completed
  return (
    <section>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="px-1 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink min-h-[32px]">
        Completed today: <b className="text-ink/80 font-semibold">{c.cleansDone}</b> cleans · <b className="text-ink/80 font-semibold">{c.tasksDone}</b> tasks · <b className="text-ink/80 font-semibold">{c.handledDone}</b> cleared here
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && <div className="mt-1.5"><CompletedCard d={d} onChanged={onChanged} tick={tick} /></div>}
    </section>
  )
}

function Skeleton() {
  return (
    <div className="max-w-[760px] mx-auto space-y-5 animate-pulse">
      <div className="h-12 rounded-xl bg-white border border-line" />
      {[0, 1, 2, 3].map(i => (
        <div key={i}>
          <div className="h-5 w-24 rounded bg-app mb-1.5" />
          <div className="h-24 rounded-2xl bg-white border border-line" />
        </div>
      ))}
    </div>
  )
}

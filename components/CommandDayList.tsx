'use client'
// COMMAND CENTER v5 — "MY DAY, ONE SCREEN" (Jon, 2026-09-18: v4 was "not actionable enough, wrong
// content/noise, visual/layout bad, rethink from scratch").
//
// ONE ranked list of everything that needs JON today, in four bands, each row with its one-tap
// action. Nothing informational about THE DAY above the fold — the numbers strip and the tile
// drawers still exist, behind "How's the day". THE WEEK's KPIs (welcome calls, claims, glitches,
// labor per clean, maintenance/billable labor, checklist) were the Scoreboard strip (2026-09-18);
// on 2026-10-06 Jon swapped it for the Bulletin board (components/command/Bulletin) — the tiles'
// API stays, the Hub and the board's "Did you know" read it.
//
//   DECIDE  things only Jon can do: Eve's inbox head (one line + her top three, decided in place —
//           /eve?tab=inbox has the rest; 2026-11-10), spend approvals (approve /
//           reject), claims in his review or near a filing deadline (review), refunds over the cap
//           waiting on a sign-off (open the card), a short-staffed day 1–3 days out (open /team),
//           Slack messages waiting to send (send / skip).
//   FIX     exceptions only, from the engine's `next` list: a late clean, a turn nobody is on, a
//           guest waiting on a reply, a big arrival with no inspection, an overdue guest issue.
//   CLEAR   batches, one row per batch: cancel every duplicate (admin password once), copy one vendor
//           note for every vendor-run arrival with a bad past review, open the overdue-backlog units
//           in Today in Ops.
//   YOURS   the Leadership-board tasks with Jon's name on them (/api/projects/mine), done-toggle, quick add.
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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  RefreshCw, ExternalLink, UserPlus, Loader2, Check, X, AlertTriangle, ChevronDown, ChevronRight,
  Send, Copy, Circle, Plus, MapPin, CalendarDays, ClipboardCheck, Star, Settings2,
} from 'lucide-react'
import { LeanHead, Pill, Tag, IconBtn, Tip, type Tone as LeanTone } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { CommandDay, NextItem, NextAction, GuestDeskRow } from '@/lib/command-day'
import {
  TilePanel, InlineAssign, CompletedCard,
  BTN, CARD, DAY_URL, MINE_URL, MINE_ICON, MINE_CLS, niceDay,
  type Roster, type TileKey, type Tone, type Mine, type MineItem,
} from '@/components/CommandCockpit'
import { useSlackQueue, EVENT_LABEL, expiresIn, type Pending as SlackPending } from '@/components/SlackQueueCard'
import { AvailabilityAlert } from '@/components/AvailabilityAlert'
import { BulletinBoard } from '@/components/command/Bulletin'
import { BULLETIN_URL } from '@/components/command/Bulletin'
import { dueState, type Post as BoardPost } from '@/lib/bulletin'
import { EveInboxToday, useEveInboxToday } from '@/components/EveInboxToday'
import { CommandHub, ApprovalRow } from '@/components/command/Hub'

type Sev = NextItem['severity']
type Ranked = { key: string; sev: Sev; rank: number; node: ReactNode }
type VendorVisit = { id: string; tone: 'today' | 'soon' | 'later' | 'missed' | 'done' }

const HOW_KEY = 'cc5.how'
const SEV_RANK: Record<Sev, number> = { now: 0, today: 1, soon: 2 }
const bz = (id: string) => 'https://app.breezeway.io/task/' + id
const fmtLeft = (m: number) => { const a = Math.abs(m); const h = Math.floor(a / 60); return (h ? h + 'h ' : '') + (a % 60) + 'm' }
/** A 30-second tick owned by the component that shows a relative time, so the page does not re-render for it (2026-10-01 audit). */
function useTick(ms = 30_000): number { const [t, setT] = useState(0); useEffect(() => { const i = setInterval(() => setT(x => x + 1), ms); return () => clearInterval(i) }, [ms]); return t }
const ago = (iso: string, tick: number) => { void tick; const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago' }
const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : (many || one + 's'))
const PRIMARY = BTN + ' bg-ink text-white whitespace-nowrap'
/** Already done — the button is still there to undo it, but it stops shouting. */
const SECONDARY = BTN + ' border border-line text-muted hover:text-ink whitespace-nowrap'
/** A band's list. No overflow-hidden (unlike CARD): it would clip the hover labels on the top row. */
const LIST = 'rounded-2xl border border-line bg-white divide-y divide-line'

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
/** Decide rows whose decision is made on another page, one tap away — the tag, and what the clear button means there. */
const DECIDE_LINK: Partial<Record<NextItem['kind'], { tag: string; tone: LeanTone; hover: string; clear: 'done' | 'skipped'; clearTitle: string }>> = {
  refund: { tag: 'Refund', tone: 'violet', hover: 'A refund over the cap — Approve or Reject it on the glitch card', clear: 'skipped', clearTitle: 'Not today — hide it until tomorrow' },
  staffing: { tag: 'Staffing', tone: 'amber', hover: 'The 14-day staffing forecast: checkouts on the books, priced in cleaning minutes, against the housekeepers rostered', clear: 'done', clearTitle: 'Handled — somebody is covering it' },
}
const isDecideLink = (i: NextItem) => !!DECIDE_LINK[i.kind]

/** Task ids of cleans the engine already calls late or at risk — a same-day turn with a name on it
 *  still belongs in Fix when the clock says it will not land (review found it hidden otherwise). */
function troubledCleanIds(d: CommandDay): Record<string, true> {
  const out: Record<string, true> = {}
  for (const c of d.tiles.cleans.rows) if (c.status === 'late' || c.status === 'atRisk') out[c.taskId] = true
  return out
}
function isFixRow(i: NextItem, troubled: Record<string, true>): boolean {
  // THE HUB BANDS OWN THESE NOW (2026-09-30): cleans (late / turn), inspections, guests waiting,
  // glitches and channel breaks each have their own band — Fix keeps what none of them shows:
  // other tasks nobody is on, and targeted looks after guest feedback.
  void troubled
  if (i.kind === 'unassigned') return !(i.bzTaskId && troubled[i.bzTaskId])
  if (i.kind === 'late' || i.kind === 'turn' || i.kind === 'guest' || i.kind === 'inspection' || i.kind === 'channel' || i.kind === 'glitch') return false
  if (i.kind === 'feedback') return !isCoveredFeedback(i) && !isVendorFeedback(i) && i.action?.type === 'create_task'
  return false
}
/** The one word on the button, by what the row is. */
function fixLabel(i: NextItem): string {
  const a = i.action
  if (!a) return 'Open'
  if (a.type === 'assign') return 'Assign'
  if (i.kind === 'turn') return 'Open task'
  if (a.type === 'create_task') return 'Create inspection'
  if (i.kind === 'guest') return 'Reply'
  if (i.kind === 'glitch') return 'Open'
  return a.label || 'Open'
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function CommandDayList() {
  const { data, loading, error, refresh } = useCachedFetch<CommandDay & { error?: string }>(DAY_URL, { ttl: 60_000, persist: true })
  // The day first, everything else behind it (2026-10-01, load time): these two used to race the day read.
  const { data: rosterRes } = useCachedFetch<{ people: Roster[] }>(data ? '/api/breezeway/people' : null, { ttl: 10 * 60_000 })
  const { data: vendorRes } = useCachedFetch<{ visits: VendorVisit[] }>(data ? '/api/projects/vendor-visits' : null, { ttl: 120_000 })
  const roster = useMemo(() => Array.isArray(rosterRes?.people) ? rosterRes!.people : [], [rosterRes])
  const vendorsOnSite = useMemo(() => (Array.isArray(vendorRes?.visits) ? vendorRes!.visits : []).filter(v => v.tone === 'today').length, [vendorRes])
  // No timer of its own (2026-11-09 audit): useCachedFetch already re-reads the day every ttl while
  // the tab is visible and on coming back to it when stale — the 5-minute interval and the second
  // visibility listener that lived here asked for the same read again.
  const reload = useCallback(() => { invalidateCache(DAY_URL); refresh() }, [refresh])
  /** Rows cleared from this screen since the last read — so a cleared row leaves at once. */
  const [gone, setGone] = useState<Record<string, boolean>>({})
  /** The Eve & Slack rows inside "Needs you" report their own count (2026-11-10). */
  const [decideN, setDecideN] = useState(0)
  const hide = useCallback((key: string) => setGone(g => ({ ...g, [key]: true })), [])
  // Every new read carries the server's own cleared rows, so the local ones reset on each response.
  // Keyed on the response, not on generatedAt: the day core is shared and cached now, so two reads a
  // few seconds apart carry the same generatedAt — and a row brought back ("Bring it back") must
  // reappear on the very next read.
  useEffect(() => { setGone({}) }, [data])
  // ONE PASS over the day per read (2026-10-01 audit): these buckets were rebuilt on every render.
  const derived = useMemo(() => {
    if (!data || !data.ok) return null
    const live = data.next.filter(i => !i.dismissed && !gone[i.key])
    const troubled = troubledCleanIds(data)
    const handledKeys: Record<string, true> = {}
    for (const h of data.handled || []) handledKeys[h.key] = true
    return {
      live,
      fixRows: live.filter(i => isFixRow(i, troubled)).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.rank - b.rank),
      claims: live.filter(i => i.kind === 'claim'),
      links: live.filter(isDecideLink),
      dups: live.filter(i => i.kind === 'duplicate'),
      vendorNotes: live.filter(isVendorFeedback),
      backlog: live.filter(i => i.kind === 'pending'),
      // A spend decided here is recorded as handled (ApprovalRow), so it stays gone while the shared
      // day core still lists it as pending.
      approvals: data.tiles.guestDesk.rows.filter(r => r.kind === 'approval' && !gone[r.key] && !handledKeys[r.key]),
    }
  }, [data, gone])

  if (!data && loading) return <Skeleton />
  if (!data || !data.ok) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 flex items-center gap-3">
        <AlertTriangle size={15} /> <span className="flex-1">Could not read the day{error || (data as any)?.error ? ' — ' + (error || (data as any)?.error) : ''}.</span>
        <button onClick={reload} className="font-bold underline">Retry</button>
      </div>
    )
  }
  const { live, fixRows, claims, links, dups, vendorNotes, backlog, approvals } = derived!

  return (
    <div className="max-w-[1120px] mx-auto space-y-5">
      <DayLine d={data} loading={loading} reload={reload} roster={roster} vendorsOnSite={vendorsOnSite} />
      {/* THE BULLETIN BOARD (Jon, 2026-10-06) — replaced the week Scoreboard strip: Did you know stats,
          Have to, and what leaders post (Employee of the month, quote, shout-outs, 5★ reviews). At the TOP,
          under the day line — below the Hub it sat ~2,250px down and Jon couldn't find it. */}
      <BulletinBoard d={data} />
      {/* THE OPERATIONAL HUB (Jon, 2026-09-30): KPIs by area, the Now list, four lanes side by side —
          every row actionable in place, no drop-downs. components/command/Hub.tsx. */}
      {/* Eve's inbox head, reminders and Slack posts waiting to send now sit INSIDE the Hub's "Needs you",
          right under the strip (Today revamp, 2026-11-10) — they used to be at the very bottom. */}
      <CommandHub d={data} live={live} roster={roster} fixRows={fixRows} claims={claims} links={links} approvals={approvals} onCleared={hide} onChanged={reload}
        needsCount={decideN} needs={<DecideBand d={data} claims={[]} links={[]} approvals={[]} onCleared={hide} onChanged={reload} bare onCount={setDecideN} />} />
      <ClearBand d={data} dups={dups} vendorNotes={vendorNotes} backlog={backlog} onCleared={hide} onChanged={reload} />
      {/* "Eve is thinking about N things" lived here until 2026-11-10: her thoughts are a filter of
          the one Eve inbox now (/eve?tab=inbox → Would have done), and the band above carries its head. */}
      <CompletedLine d={data} onChanged={reload} />
      <AvailabilityAlert />
    </div>
  )
}

// ── THE DAY — one line, and "How's the day" behind it ──────────────────────────────────────────
function DayLine({ d, loading, reload, roster, vendorsOnSite }: { d: CommandDay; loading: boolean; reload: () => void; roster: Roster[]; vendorsOnSite: number }) {
  const v = d.verdict, p = d.pulse, t = d.tiles
  const tick = useTick()
  const [how, setHow] = useState(false)
  const [tile, setTile] = useState<TileKey | null>(null)
  useEffect(() => { try { setHow(localStorage.getItem(HOW_KEY) === '1') } catch { /* private mode */ } }, [])
  const toggleHow = () => { setHow(o => { try { localStorage.setItem(HOW_KEY, o ? '0' : '1') } catch { /* ignore */ } return !o }) }
  const occ = p.active ? Math.round((p.occupiedTonight / p.active) * 100) : null
  const stats: { key: TileKey; label: string; value: string; sub: string; tone: Tone }[] = [
    { key: 'cleans', label: 'Cleans', value: t.cleans.done + '/' + t.cleans.total, sub: t.cleans.late ? t.cleans.late + ' late' : t.cleans.atRisk ? t.cleans.atRisk + ' at risk' : t.cleans.running ? t.cleans.running + ' running' : '', tone: t.cleans.late ? 'hot' : t.cleans.atRisk ? 'warn' : t.cleans.total && t.cleans.done === t.cleans.total ? 'ok' : 'quiet' },
    { key: 'arrivals', label: 'Arrivals', value: String(t.arrivals.today), sub: t.arrivals.bigToday ? t.arrivals.bigToday + ' big' + (t.arrivals.missingInspection ? ' · ' + t.arrivals.missingInspection + ' uninspected' : '') : '', tone: t.arrivals.missingInspection ? 'warn' : 'quiet' },
    { key: 'tasks', label: 'Tasks', value: t.tasks.open + ' open', sub: [t.tasks.unassigned ? t.tasks.unassigned + ' unowned' : '', t.tasks.urgent ? t.tasks.urgent + ' urgent' : ''].filter(Boolean).join(' · '), tone: t.tasks.unassigned || t.tasks.late ? 'warn' : 'quiet' },
    { key: 'team', label: 'Team', value: t.team.onShift ? t.team.onShift + ' · ' + t.team.utilisationPct + '%' : '0', sub: t.team.onShift ? [t.team.overloaded ? t.team.overloaded + ' over' : '', t.team.idle.length ? t.team.idle.length + ' idle' : ''].filter(Boolean).join(' · ') : 'nobody on shift', tone: t.team.utilisationPct > 100 || t.team.idle.length ? 'warn' : t.team.onShift ? 'quiet' : 'hot' },
    { key: 'glitches', label: 'Glitches', value: String(t.glitches.open), sub: t.glitches.overdue ? t.glitches.overdue + ' overdue' : t.glitches.noTask ? t.glitches.noTask + ' no task' : '', tone: t.glitches.overdue ? 'hot' : t.glitches.noTask ? 'warn' : t.glitches.open ? 'quiet' : 'ok' },
    { key: 'claims', label: 'Claims', value: String(t.claims.open), sub: t.claims.review ? t.claims.review + ' to review' : t.claims.dueSoon ? t.claims.dueSoon + ' due' : '', tone: t.claims.dueSoon ? 'hot' : t.claims.review ? 'warn' : 'quiet' },
    { key: 'overdue', label: 'Overdue', value: String(t.overdue.total), sub: '', tone: t.overdue.total > 40 ? 'hot' : t.overdue.total ? 'warn' : 'ok' },
    { key: 'guestDesk', label: 'Guest desk', value: String(t.guestDesk.total), sub: [t.guestDesk.messages ? t.guestDesk.messages + ' waiting' : '', t.guestDesk.welcome ? t.guestDesk.welcome + ' calls' : '', t.guestDesk.reviews ? t.guestDesk.reviews + ' reviews' : ''].filter(Boolean).slice(0, 2).join(' · '), tone: t.guestDesk.messages || t.guestDesk.approvals ? 'warn' : 'quiet' },
  ]
  const vTone: LeanTone = v.state === 'behind' ? 'rose' : v.state === 'at_risk' ? 'amber' : v.state === 'closing' ? 'slate' : 'emerald'
  const sTone = (x: Tone): LeanTone => x === 'hot' ? 'rose' : x === 'warn' ? 'amber' : x === 'ok' ? 'emerald' : 'slate'
  const left = p.cleansTotal > p.cleansDone ? (p.minsLeft < 0 ? fmtLeft(p.minsLeft) + ' past 4pm' : fmtLeft(p.minsLeft) + ' to 4pm') : ''
  // ONE LINE (lean pass, 2026-09-22): the verdict is a pill, its sentence is the pill's hover and the
  // first line of "How's the day". The eyebrow the page used to print is this title now.
  return (
    <section aria-live="polite">
      <LeanHead title="Today" sub={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' }) + ' · ' + v.detail}>
        <Pill tone={vTone} title={v.detail}>{v.headline}</Pill>
        {/* The cleans pill that sat here repeated the Departure cleans tile directly under it (2026-10-01 audit); the time left rides on the verdict instead. */}
        {left && p.cleansTotal > p.cleansDone && <Pill tone={t.cleans.late ? 'rose' : 'slate'} title="Time left on today's cleans">{left}</Pill>}
        {vendorsOnSite > 0 && <Pill title="Vendor visits booked for today">{plural(vendorsOnSite, 'vendor')} on site</Pill>}
        <Tip label={'Refresh the day · read ' + ago(d.generatedAt, tick)}>
          <button onClick={reload} aria-label="Refresh the day" className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-ink min-h-[28px] px-1">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {ago(d.generatedAt, tick)}
          </button>
        </Tip>
      </LeanHead>
      {d.degraded.length > 0 && (
        <div className="-mt-1 mb-2 text-[11.5px] font-semibold text-amber-800 flex items-center gap-1.5"><AlertTriangle size={12} /> Incomplete — could not read: {d.degraded.join(', ')}.</div>
      )}
    </section>
  )
}

// ── BAND + ROW primitives ───────────────────────────────────────────────────────────────────────
/** Band label on one line; an empty band is that line and nothing else. */
function Band({ name, count, empty, children }: { name: string; count: number; empty: string; children?: ReactNode }) {
  // FOLDED UNTIL ASKED (Jon, 2026-10-02: "clunky, noisy"): these bands sit below the day's work and open
  // from their title, like every other section on the page. A short band (three rows or fewer) stays open.
  const [open, setOpen] = useState(count <= 3)
  return (
    <section>
      <h2 className="px-1 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-2">
        {count > 3
          ? <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 hover:text-ink">{name} <span className="tabular-nums">{count}</span> {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
          : <>{name} {count ? <span className="tabular-nums">{count}</span> : <span className="normal-case tracking-normal font-medium">— {empty.replace(/\.$/, '').toLowerCase()}</span>}</>}
      </h2>
      {count > 0 && open && <div className={LIST}>{children}</div>}
    </section>
  )
}
function SevDot({ sev }: { sev: Sev | null }) {
  const label = sev === 'now' ? 'Needs a person now' : sev === 'today' ? 'Today' : ''
  return <span title={label || undefined} className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (sev === 'now' ? 'bg-rose-500' : sev === 'today' ? 'bg-amber-400' : 'bg-transparent')} aria-hidden />
}
/** One row (lean pass): dot · the verb · title, muted meta and tags on ONE line (meta wraps under
 *  it only on a phone) · at most one icon. Detail lives in the expand. */
function Row({ sev, title, meta, tags, primary, secondary, onTap, expanded, children, note, err }: {
  sev: Sev | null; title: ReactNode; meta?: ReactNode; tags?: ReactNode; primary?: ReactNode; secondary?: ReactNode
  onTap?: () => void; expanded?: boolean; children?: ReactNode; note?: string; err?: string
}) {
  const body = (
    <span className="flex items-center gap-x-1.5 gap-y-0 flex-wrap min-w-0">
      <span className="text-[13px] font-semibold text-ink truncate leading-snug max-w-full">{title}</span>
      {tags}
      {meta ? <span title={typeof meta === 'string' ? meta : undefined} className="text-[11.5px] text-muted truncate leading-snug max-w-full">{meta}</span> : null}
    </span>
  )
  return (
    <div className="px-3 py-1.5 min-h-[44px] flex flex-col justify-center">
      <div className="flex items-center gap-2 min-w-0">
        <SevDot sev={sev} />
        {primary}
        {onTap
          ? <button onClick={onTap} aria-expanded={!!expanded} className="flex-1 min-w-0 text-left">{body}</button>
          : <div className="flex-1 min-w-0">{body}</div>}
        {secondary}
      </div>
      {(note || err) && <p className={'text-[11.5px] font-semibold mt-1 pl-3.5 ' + (err ? 'text-rose-600' : 'text-emerald-700')}>{err || note}</p>}
      {children}
    </div>
  )
}

// ── 1. DECIDE ───────────────────────────────────────────────────────────────────────────────────
// REMINDERS MOVED OUT OF THE BULLETIN (Jon, 2026-10-16). They used to live on a cycling slide,
// which meant a thing somebody had to DO was visible for nine seconds in every ninety. A reminder
// is work, so it sits in the work list and you tick it here.
//
// It reads the same URL the bulletin card already fetched, so the shared cache serves it and the
// page makes no extra request for this.
function useReminders() {
  const { data } = useCachedFetch<{ today?: string; canPost?: boolean; haveTo?: BoardPost[] }>(BULLETIN_URL, { ttl: 300_000 })
  const [busy, setBusy] = useState('')
  const [local, setLocal] = useState<Record<string, boolean>>({})
  const rows = (data?.haveTo || []).filter(p => dueState(p, data?.today || '') !== 'done' || local[p.id] !== undefined)
  const tick = async (id: string, done: boolean) => {
    setBusy(id)
    setLocal(l => ({ ...l, [id]: done }))          // the tick lands before the round trip
    try {
      await fetch(BULLETIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: done ? 'done' : 'undone', id }) })
      invalidateCache(BULLETIN_URL)
    } catch { setLocal(l => ({ ...l, [id]: !done })) }   // it did not land — put the tick back
    finally { setBusy('') }
  }
  return { rows, today: data?.today || '', busy, local, tick }
}

function ReminderRow({ p, today, done, busy, tick }: { p: BoardPost; today: string; done: boolean; busy: boolean; tick: (id: string, done: boolean) => void }) {
  const st = dueState(p, today)
  const meta = [p.owner || '', st === 'overdue' ? 'overdue' : st === 'today' ? 'due today' : p.due ? 'by ' + p.due : ''].filter(Boolean).join(' · ')
  return (
    <Row sev={done ? null : st === 'overdue' ? 'now' : st === 'today' ? 'today' : null}
      title={<span className={done ? 'line-through text-muted' : ''}>{p.title || p.body}</span>} meta={meta}
      tags={<Tag tone="amber" title="A reminder somebody posted on the board">Have to</Tag>}
      primary={
        <button onClick={() => tick(p.id, !done)} disabled={busy}
          className={done ? SECONDARY : PRIMARY} title={done ? 'Mark not done' : 'Mark done'}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} {done ? 'Undo' : 'Done'}
        </button>
      } />
  )
}

function DecideBand({ d, claims, links, approvals, onCleared, onChanged, bare, onCount }: { d: CommandDay; claims: NextItem[]; links: NextItem[]; approvals: GuestDeskRow[]; onCleared: (key: string) => void; onChanged: () => void; bare?: boolean; onCount?: (n: number) => void }) {
  // EVE IS ONE INBOX NOW (2026-11-10). Her questions, plans and reply drafts used to be rows of their
  // own here, each read from its own endpoint; they are all in /eve?tab=inbox, ranked, and this band
  // shows its head: one line ("Eve: N for you — top: …") and the top three with their main button.
  const eve = useEveInboxToday()
  const slack = useSlackQueue()
  const reminders = useReminders()
  const slackLive = slack.live || []
  const approvalsHidden = Math.max(0, d.tiles.guestDesk.approvals - d.tiles.guestDesk.rows.filter(r => r.kind === 'approval').length)
  // Counted the way it is drawn: the Eve line carries her number, the band counts the rows it shows.
  const eveRows = eve.ok && eve.total > 0 ? Math.max(1, eve.items.length) : 0
  const count = reminders.rows.length + slackLive.length + approvals.length + claims.length + links.length + eveRows

  const rows: Ranked[] = []
  // Reminders first: somebody wrote these down because they must happen today.
  for (const p of reminders.rows) {
    const done = reminders.local[p.id] ?? (dueState(p, reminders.today) === 'done')
    rows.push({ key: 'rem:' + p.id, sev: done ? 'today' : 'now', rank: -1, node: <ReminderRow p={p} today={reminders.today} done={done} busy={reminders.busy === p.id} tick={reminders.tick} /> })
  }
  for (const it of slackLive) rows.push({ key: 'slack:' + it.id, sev: 'now', rank: 0, node: <SlackRow item={it} q={slack} /> })
  for (const c of claims) rows.push({ key: c.key, sev: c.severity, rank: c.rank, node: <ClaimRow item={c} onCleared={onCleared} /> })
  for (const l of links) rows.push({ key: l.key, sev: l.severity, rank: l.rank, node: <DecideLinkRow item={l} onCleared={onCleared} /> })
  for (const a of approvals) rows.push({ key: a.key, sev: 'today', rank: 3, node: <ApprovalRow row={a} onCleared={onCleared} onChanged={onChanged} /> })
  if (approvalsHidden > 0) rows.push({ key: 'ap:more', sev: 'today', rank: 3.5, node: <Row sev={null} title={plural(approvalsHidden, 'more approval') + ' waiting'} primary={<Link href="/requests" className={PRIMARY}>Approvals</Link>} /> })
  if (eveRows) rows.push({ key: 'eve:inbox', sev: eve.items[0]?.urgency.level === 'now' ? 'now' : 'today', rank: 2.5, node: <EveInboxToday q={eve} /> })
  rows.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || a.rank - b.rank)
  // BARE: just the rows, drawn inside Today's "Needs you" (2026-11-10) — the section counts them.
  useEffect(() => { onCount?.(rows.length) }, [rows.length, onCount])
  if (bare) return (
    <>
      {slack.err && <p className="px-3 py-2 text-[12px] text-rose-700">{slack.err}</p>}
      {rows.map(r => <div key={r.key}>{r.node}</div>)}
    </>
  )

  return (
    <Band name="Eve & Slack — your call" count={count} empty="Nothing waiting on you.">
      {slack.err && <p className="px-3 py-2 text-[12px] text-rose-700">{slack.err}</p>}
      {rows.map(r => <div key={r.key}>{r.node}</div>)}
    </Band>
  )
}

function SlackRow({ item, q }: { item: SlackPending; q: ReturnType<typeof useSlackQueue> }) {
  const [open, setOpen] = useState(false)
  const busy = !!q.busy[item.id]
  const meta = [EVENT_LABEL[item.eventKey] || item.eventKey, expiresIn(item.expiresAt), item.itemCount > 1 ? item.itemCount + ' grouped' : '', item.audience?.length ? item.audience.length + ' tagged' : ''].filter(Boolean).join(' · ')
  return (
    <Row sev="now" title={item.summary || item.building || 'Slack message'} tags={<Tag tone="sky" title="A Slack message waiting for your OK">Slack</Tag>} meta={meta} onTap={() => setOpen(o => !o)} expanded={open}
      primary={<button onClick={() => q.decide(item, true)} disabled={busy} className={PRIMARY}>{busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send</button>}
      secondary={<IconBtn title="Skip — do not send" onClick={() => q.decide(item, false)} disabled={busy}><X size={14} /></IconBtn>}>
      {open && <pre className="mt-2 ml-3.5 rounded-xl border border-line bg-app/40 p-3 text-[12px] text-ink whitespace-pre-wrap font-sans leading-relaxed">{q.preview(item)}</pre>}
    </Row>
  )
}

function ClaimRow({ item: i, onCleared }: { item: NextItem; onCleared: (k: string) => void }) {
  const [busy, setBusy] = useState(false)
  const done = async () => { setBusy(true); try { await clearRow(i, 'done'); onCleared(i.key) } catch { /* shown on reload */ } setBusy(false) }
  return (
    <Row sev={i.severity} title={i.unit + ' — ' + i.title} meta={i.why + ' · ' + i.due}
      primary={<Link href={i.href || '/claims'} className={PRIMARY}>Review</Link>}
      secondary={<IconBtn title="Mark done — it happened" tone="ok" onClick={done} disabled={busy}><Check size={15} /></IconBtn>} />
  )
}

/** A decision made one tap away (DECIDE_LINK): the row opens the page it is made on. */
function DecideLinkRow({ item: i, onCleared }: { item: NextItem; onCleared: (k: string) => void }) {
  const [busy, setBusy] = useState(false)
  const m = DECIDE_LINK[i.kind]
  if (!m) return null
  const clear = async () => { setBusy(true); try { await clearRow(i, m.clear); onCleared(i.key) } catch { /* shown on reload */ } setBusy(false) }
  return (
    <Row sev={i.severity} title={i.title} tags={<Tag tone={m.tone} title={m.hover}>{m.tag}</Tag>} meta={i.why}
      primary={<Link href={i.href || '/'} className={PRIMARY}>{i.action && i.action.type === 'open' ? i.action.label : 'Open'}</Link>}
      secondary={<IconBtn title={m.clearTitle} tone={m.clear === 'done' ? 'ok' : undefined} onClick={clear} disabled={busy}>{m.clear === 'done' ? <Check size={15} /> : <X size={14} />}</IconBtn>} />
  )
}

// ── 2. FIX ──────────────────────────────────────────────────────────────────────────────────────
function FixBand({ rows, roster, onCleared, onChanged }: { rows: NextItem[]; roster: Roster[]; onCleared: (k: string) => void; onChanged: () => void }) {
  return (
    <Band name="Other tasks to fix" count={rows.length} empty="Nothing else to fix.">
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
  // A guest row's reply-by state ("Late 25m") is one of its tags — not said twice.
  const tags = i.tags && i.tags.length ? <>{i.tags.map(t => <Tag key={t.label} tone={t.tone} title={t.title}>{t.label}</Tag>)}</> : undefined
  const meta = (i.tags && i.tags.some(t => t.label === i.due) ? '' : i.due + ' · ') + i.why
  const primary = !a ? null
    : a.type === 'open'
      ? (a.external
        ? <a href={a.href} target="_blank" rel="noreferrer" className={PRIMARY}>{label} <ExternalLink size={11} /></a>
        : <Link href={a.href} className={PRIMARY}>{label}</Link>)
      : <button onClick={() => run(a)} disabled={busy} className={assign ? BTN + ' bg-white border border-ink text-ink whitespace-nowrap' : PRIMARY}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : a.type === 'assign' ? <UserPlus size={11} /> : null} {label}
        </button>
  return (
    <Row sev={i.severity} title={i.unit + ' — ' + i.title} tags={tags} meta={meta} note={note} err={err}
      onTap={i.evidence ? () => setQuote(q => !q) : undefined} expanded={quote}
      primary={primary}
      secondary={<>
        {/* An inspection row only exists when Task automation is off — this is where to switch it on. */}
        {(i.kind === 'inspection' || i.kind === 'feedback') && i.href && a?.type !== 'open'
          ? <IconBtn title="Automate inspections — Admin → Users & admin → Settings → Task automation" href={i.href}><Settings2 size={14} /></IconBtn> : null}
        <IconBtn title="Mark done — counts as cleared here" tone="ok" onClick={markDone} disabled={busy}><Check size={15} /></IconBtn>
      </>}>
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
          {i.bzTaskId && <Tip label="Open in Breezeway"><a href={bz(i.bzTaskId)} target="_blank" rel="noreferrer" aria-label="Open in Breezeway" className="text-muted hover:text-ink shrink-0"><ExternalLink size={12} /></a></Tip>}
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
    if (busy || !pw) return   // Enter twice / a double-tap must not run two batches over the same tasks
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
        // A wrong (or unset) password fails every item the same way — stop after the first, keep
        // the receipt. Only THOSE two: "Departure cleans can only be deleted … (admin password
        // required)" also says "password" but is per-task, and must not stop the rest of the batch.
        if (/wrong admin password|delete is locked/i.test(String(e?.message || e))) break
      }
    }
    setSummary(ok + ' of ' + rows.length + ' cancelled')
    setBusy(false)
    if (ok) { onChanged(); if (ok === rows.length) setTimeout(() => rows.forEach(i => onCleared(i.key)), 1200) }
  }
  return (
    <Row sev="today" title={plural(rows.length, 'duplicate task') + ' open twice'} meta="keep the named one · admin password once" onTap={() => setOpen(o => !o)} expanded={open}
      note={summary}
      primary={<button onClick={() => setOpen(true)} className={open ? BTN + ' bg-white border border-ink text-ink whitespace-nowrap' : PRIMARY}>Cancel all</button>}>
      {open && (
        <>
          <div className="mt-2 ml-3.5 flex items-center gap-1.5">
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Admin password" aria-label="Admin password" onKeyDown={e => { if (e.key === 'Enter' && pw && !busy) cancelAll() }}
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
    <Row sev="today" title={plural(rows.length, 'vendor-run arrival') + ' with low past reviews'} meta="no Breezeway here · one vendor note covers all" onTap={() => setOpen(o => !o)} expanded={open} note={note} err={err}
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
    <Row sev={rows.some(i => i.severity === 'today') ? 'today' : 'soon'} title={plural(rows.length, 'unit') + ' with overdue tasks and an arrival ' + (allToday ? 'today' : 'today or tomorrow')} meta="backlog still open before the arrival" onTap={() => setOpen(o => !o)} expanded={open}
      primary={<Link href="/plan" className={PRIMARY}>Today in Ops</Link>}>
      {open && <BatchItems rows={rows} />}
    </Row>
  )
}

// ── 4. YOURS — every Projects board, your name on it ───────────────────────────────────────────
function YoursBand() {
  const { data, loading, error, refresh } = useCachedFetch<Mine>(MINE_URL, { ttl: 120_000 })
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
      await post('/api/leadership', { action: 'set', id: it.id, status: it.status === 'done' ? 'open' : 'done' })
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
        placeholder="Add a task for yourself…" aria-label="Add a task for yourself" className="flex-1 min-w-0 bg-transparent text-[13px] py-1 focus:outline-none placeholder:text-muted/70" />
      {draft.trim() && <button onClick={add} disabled={busy === 'add'} className={PRIMARY}>{busy === 'add' ? <Loader2 size={11} className="animate-spin" /> : 'Add'}</button>}
    </div>
  )

  return (
    <section>
      <h2 className="px-1 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-2">
        <span>Yours {total ? <span className="tabular-nums">{total}</span> : null}</span>
        {loading && !data && <Loader2 size={11} className="animate-spin" />}
        {data && shown.length === 0 && <span className="normal-case tracking-normal font-medium">— {total === 0 ? 'nothing has your name on it' : 'nothing due this week' + (later.length ? ', ' + later.length + ' later' : '')}</span>}
        <Link href="/leadership" className="ml-auto normal-case tracking-normal text-[11.5px] font-semibold text-brand-700">Leadership board</Link>
      </h2>
      {error && !data && <p className="px-1 text-[12px] text-rose-700">{error}</p>}
      <div className={LIST}>
        {shown.map(it => {
          const I = MINE_ICON[it.status] || Circle
          const late = !!(it as any).late
          return (
            <div key={it.id} className="flex items-center gap-2.5 px-3 py-1.5 min-h-[44px] hover:bg-app/50 first:rounded-t-2xl">
              <Tip label={it.status === 'done' ? 'Reopen' : 'Mark done'}>
                <button onClick={() => toggle(it)} disabled={busy === it.id} aria-label={'Mark done: ' + it.title}
                  className={'w-6 h-6 rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + MINE_CLS[it.status]}>
                  {busy === it.id ? <Loader2 size={10} className="animate-spin" /> : <I size={11} strokeWidth={3} />}
                </button>
              </Tip>
              <Link href={'/leadership?item=' + it.id} className="min-w-0 flex-1 flex items-center gap-x-1.5 flex-wrap">
                <span className="text-[13px] font-semibold text-ink truncate max-w-full">{it.title}</span>
                {it.priority === 'urgent' && <Tag tone="rose">urgent</Tag>}
                {it.priority === 'high' && <Tag tone="amber">high</Tag>}
                {it.oneOnOne && <Tag title="Private 1:1 task">1:1</Tag>}
                <span className="text-[11.5px] text-muted truncate max-w-full">
                  {it.project}
                  {it.where && <> · <MapPin size={9} className="inline -mt-0.5" /> {it.where}</>}
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
function CompletedLine({ d, onChanged }: { d: CommandDay; onChanged: () => void }) {
  const tick = useTick()
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
    <div className="max-w-[1120px] mx-auto space-y-5 animate-pulse">
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

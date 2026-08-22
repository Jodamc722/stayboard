'use client'
// TODAY IN OPS v2 — Board · People · Push (Jon, 2026-08-14: "complete revamp... think highest
// level", then "feels a bit busy, love the push section" on v1).
//
// ── WHY THIS SHAPE ──────────────────────────────────────────────────────────────────────────────
// Researched against the hotel ops platforms (Optii, HotSOS, ALICE, Flexkeeping), the STR tools
// (Breezeway, Operto Teams, Properly, Turno) and ServiceTitan's dispatch board. Two findings drove
// the rebuild:
//
//   MANAGEMENT BY EXCEPTION. Every mature tool lands the manager on deviations, not the full list.
//   The old page stacked seven sections before the first unit. This one opens with ONE sentence and
//   only the rows that need a human; the complete board is one tap away behind "Show all".
//
//   TWO AXES. Optii's central screen is a timeline of attendants; ALICE assigns "by person rather
//   than room"; ServiceTitan is technicians × capacity. Ours was unit-only. The People tab is the
//   missing axis — and it is where push belongs, because push always starts with "who has room?".
//
// The Push tab promotes the suggestion queue (the part Jon loves) from a collapsed section at the
// bottom of the page to a destination: every suggestion grouped by REASON with its evidence, filed
// into Breezeway one tap at a time or in bulk.
//
// REUSE, NOT REWRITE: the full board (TodayInOps) is untouched and mounts inside "Show all".
// Assignment uses /api/breezeway/assign, creation /api/ops-today/add-task (which already takes
// assigneeIds), pushes /api/health/push-task (which already picks the next vacant day). This file
// is a new front door on machinery that already works.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Plus, Search, ChevronDown, Users, Send, X, Loader2, Check, Phone,
  CheckCircle2, ExternalLink, UserPlus, MessageSquare,
} from 'lucide-react'
import { TodayInOps } from '@/components/TodayInOps'
import { useCachedFetch } from '@/lib/swr'

// ── types (mirrors of what the APIs actually send) ──────────────────────────────────────────────
type Task = { id: string; listingId: string; unit: string; market: string; dept: string; type: string; name: string; status: string; assignees: string[]; startedAt: string | null; finishedAt: string | null; minutes: number | null; done: boolean; running: boolean; late: boolean; atRisk: boolean; guestyOnly?: boolean }
type Unit = { listingId: string; unit: string; market: string; market2?: string | null; guestOut: string | null; sameDayTurn: boolean; tasks: Task[]; late: boolean; atRisk: boolean; unassigned: boolean; allDone: boolean }
type Deadline = { dueBy: string; minsLeft: number; passed: boolean; cleans: number; done: number; late: number; atRisk: number }
type BehindRow = { taskId: string; unit: string; checkOutTime: string | null; arrivingAt: string | null; assignee: string | null }
type VacantU = { listingId: string; unit: string; market: string; leftToday: string | null; nextArrival: string | null; openTasks: number }
type OpsData = { ok: boolean; today: string; deadline: Deadline; behind?: { notStarted: number; units: BehindRow[] } | null; units: Unit[]; vacants?: VacantU[]; error?: string }
type CareItem = { key: string; label: string; short: string; template: string; monthsAgo: number | null; every: number; neverSeen: boolean; due: boolean }
type Glitch = { id: string; unit: string; issue: string; ageDays?: number; running?: boolean; unassigned?: boolean; assignees?: string[] }
type StaffPerson = { name: string; role: string | null; clockedIn: boolean; shift: string | null; bzAlias: string | null; tasks: number; cleans: number }
type Staffing = { ok: boolean; people: StaffPerson[]; summary: { clockedIn: number; nothingAssigned: number; idleNames: string[] } }
type Roster = { id: number; name: string; departments: string[] }
type PlanPush = { status: string } | null
type PlanTask = { key: string; category: string; title: string; detail: string; severity: string; department: string | null; pushable: boolean; push: PlanPush; metric?: string | null; checklist?: string[]; evidence?: { quote: string; channel: string; date: string; stars: number | null }[] }
type PlanUnit = { listingId: string; listing: string; internalName?: string | null; market: string; tasks: PlanTask[] }
type PlanData = { ok: boolean; days: { date: string; label: string; units: PlanUnit[] }[] }
type Listing = { id: string; nickname?: string | null; title?: string | null; building?: string | null }

const fmtLeft = (m: number) => { const a = Math.abs(m); const h = Math.floor(a / 60); return (h ? h + 'h ' : '') + (a % 60) + 'm' }

// One exception row: something on today that needs a human, whatever mechanism noticed it.
type Exc = {
  key: string
  kind: 'turn' | 'late' | 'guest' | 'unassigned' | 'idle'
  rank: number
  who: string           // unit name, or the person for 'idle'
  what: string
  taskId?: string       // when there is a Breezeway task to act on
  dept?: string
  assignee?: string | null
  // Which activity this belongs to, so the Cleans / Maintenance / Inspections switch can scope the
  // list (Jon, 2026-08-14: the segmented control from the approved mockup — "super important").
  // 'any' = rows that should survive every filter (an idle cleaner matters whichever lens is on).
  act: 'cleans' | 'maintenance' | 'inspections' | 'any'
  market?: string
  market2?: string | null
}
/** Which activity a Breezeway task belongs to — same buckets the full board's chips use. */
function actOf(t: Task | undefined | null): Exc['act'] {
  if (!t) return 'cleans'
  if (t.type === 'departure_clean' || t.type === 'deep_clean' || t.type === 'strip' || t.dept === 'housekeeping') return 'cleans'
  if (t.type === 'inspection' || t.type === 'audit' || t.dept === 'inspection') return 'inspections'
  return 'maintenance'
}
const KIND_LABEL: Record<Exc['kind'], string> = { turn: 'Same-day', late: 'Late', guest: 'Guest issue', unassigned: 'Unassigned', idle: 'Idle' }
const KIND_CLS: Record<Exc['kind'], string> = {
  turn: 'bg-rose-600 text-white', late: 'bg-rose-100 text-rose-700',
  guest: 'bg-pink-100 text-pink-700', unassigned: 'bg-amber-100 text-amber-800', idle: 'bg-violet-100 text-violet-700',
}

/** One definition of "needs a human", shared by the ops board and Command Center. */
function buildExcs(data: OpsData | undefined, units: Unit[], glitches: Glitch[], staff: Staffing | null | undefined): Exc[] {
  const out: Exc[] = []
  const behindBy: Record<string, BehindRow> = {}
  for (const b of (data?.behind?.units || [])) behindBy[b.unit] = b

  for (const u of units) {
    if (u.allDone) continue
    const open = u.tasks.filter(t => !t.done && !t.guestyOnly)
    const clean = open.find(t => t.type === 'departure_clean' || t.type === 'deep_clean')
    const b = behindBy[u.unit]
    if (u.sameDayTurn) {
      out.push({
        key: 'turn:' + u.listingId, kind: 'turn', rank: 0, who: u.unit,
        what: 'Guest arriving today' + (b?.arrivingAt ? ' at ' + b.arrivingAt : '') +
          (clean ? (clean.running ? ' · clean in progress' : clean.assignees.length ? ' · clean not started (' + clean.assignees.join(', ') + ')' : ' · clean not started, nobody on it') : ' · open work remains'),
        taskId: clean?.id, dept: clean?.dept || 'housekeeping', assignee: clean?.assignees[0] || null,
        act: actOf(clean), market: u.market, market2: u.market2,
      }); continue
    }
    if (u.late) {
      const t = open.find(x => x.late) || clean
      out.push({
        key: 'late:' + u.listingId, kind: 'late', rank: 1, who: u.unit,
        what: (b?.checkOutTime ? 'Out ' + b.checkOutTime + ' · ' : '') + (t ? t.name : 'departure clean') +
          (t && t.assignees.length ? ' · ' + t.assignees.join(', ') + ' assigned, not started' : ' · unassigned'),
        taskId: t?.id, dept: t?.dept || 'housekeeping', assignee: t?.assignees[0] || null,
        act: actOf(t), market: u.market, market2: u.market2,
      }); continue
    }
    if (u.unassigned) {
      const t = open.find(x => x.assignees.length === 0)
      out.push({
        key: 'un:' + u.listingId, kind: 'unassigned', rank: 3, who: u.unit,
        what: (t ? t.name : 'open work') + (u.guestOut ? ' · guest leaves ' + u.guestOut : ''),
        taskId: t?.id, dept: t?.dept || 'housekeeping',
        act: actOf(t), market: u.market, market2: u.market2,
      })
    }
  }
  for (const g of glitches) {
    out.push({
      key: 'gl:' + g.id, kind: 'guest', rank: g.unassigned ? 2 : 4, who: g.unit,
      what: '“' + g.issue + '”' + (g.ageDays ? ' · ' + g.ageDays + 'd' : '') +
        (g.unassigned ? ' · unassigned' : (g.assignees && g.assignees.length ? ' · ' + g.assignees.join(', ') + (g.running ? ' on it' : '') : '')),
      taskId: g.id, dept: 'maintenance', assignee: (g.assignees || [])[0] || null,
      act: 'maintenance', market: (g as any).market, market2: (g as any).market2,
    })
  }
  for (const n of (staff?.summary?.idleNames || [])) {
    out.push({ key: 'idle:' + n, kind: 'idle', rank: 3, who: n, what: 'Clocked in, nothing assigned in Breezeway', act: 'any' })
  }
  return out.sort((a, b) => a.rank - b.rank || a.who.localeCompare(b.who))
}

// ── MARK HANDLED (Jon, 2026-08-18: "needs a human... feels hard to take action on"). ──────────
// The cheapest real action is being able to say "dealt with it": a tap hides the row for the rest
// of the day, on this device. Deliberately local — it clears YOUR list without closing anyone
// else's alarm, and everything is back tomorrow. The count of handled rows stays on the header,
// so a cleared list never silently pretends the day had nothing in it.
const ackKey = () => 'ops_ack:' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
function loadAcks(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(ackKey()) || '[]')) } catch { return new Set() }
}
function saveAcks(s: Set<string>) { try { localStorage.setItem(ackKey(), JSON.stringify(Array.from(s))) } catch { /* private mode */ } }

// The three groups a supervisor actually triages in order. Grouping ≠ hiding: every row is still
// on screen, the groups just say WHY each one matters and what kind of action clears it.
const EXC_GROUPS: { key: string; label: string; sub: string; rail: string; match: (e: Exc) => boolean }[] = [
  { key: 'now', label: 'Act now', sub: 'a guest feels this today', rail: 'border-l-rose-500', match: e => e.kind === 'turn' || e.kind === 'late' },
  { key: 'own', label: 'Needs an owner', sub: 'work or people with nobody attached', rail: 'border-l-amber-500', match: e => e.kind === 'unassigned' || e.kind === 'idle' },
  { key: 'guest', label: 'Guest issues', sub: 'open complaints in-house', rail: 'border-l-pink-500', match: e => e.kind === 'guest' },
]

/**
 * ONE exception row, everywhere — board and Command Center render the same component so an
 * action learned on one page works on the other. Every row carries at least one direct verb:
 * Assign / Reassign (inline roster), Give work (idle), + Task (prefilled sheet), open-in-Breezeway,
 * and Handled. No row is ever a dead end you can only read.
 */
function ExcRow({ e, roster, open, onToggleAssign, onDone, onGiveWork, onAddTask, onAck, compact }: {
  e: Exc; roster: Roster[]; open: boolean
  onToggleAssign: () => void; onDone: () => void
  onGiveWork: () => void; onAddTask?: (unit: string) => void; onAck?: () => void; compact?: boolean
}) {
  const btn = 'text-[12px] font-bold px-2.5 py-1.5 rounded-lg shrink-0'
  return (
    <div className={'pl-3 pr-3 ' + (compact ? 'py-2' : 'py-2.5') + ' border-l-4 ' +
      (e.kind === 'turn' || e.kind === 'late' ? 'border-l-rose-500' : e.kind === 'guest' ? 'border-l-pink-400' : 'border-l-amber-400')}>
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={'text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 w-[70px] text-center ' + KIND_CLS[e.kind]}>{KIND_LABEL[e.kind]}</span>
        <span className="text-[13.5px] font-bold text-ink shrink-0">{e.who}</span>
        {e.market ? <span className="text-[10px] font-semibold text-muted bg-app rounded px-1.5 py-0.5 shrink-0">{e.market}</span> : null}
        <span className={'text-[13px] text-ink/75 flex-1 min-w-[180px] leading-snug' + (compact ? ' truncate' : '')}>{e.what}</span>
        <span className="flex items-center gap-1.5 shrink-0 ml-auto">
          {e.kind === 'idle' ? (
            <button onClick={onGiveWork} className={btn + ' bg-ink text-white'}>Give work</button>
          ) : e.taskId && !e.assignee ? (
            <button onClick={onToggleAssign} className={btn + ' ' + (open ? 'bg-white border border-ink text-ink' : 'bg-ink text-white')}>
              <UserPlus size={12} className="inline mr-1 -mt-0.5" />Assign
            </button>
          ) : e.taskId ? (
            <button onClick={onToggleAssign} title={'With ' + (e.assignee || 'someone') + ' — tap to reassign'}
              className={btn + ' border border-line bg-white text-ink hover:border-ink/40'}>{e.assignee ? e.assignee.split(' ')[0] : 'Reassign'} ↺</button>
          ) : null}
          {/* + Task only where NO task exists yet (Jon, 2026-08-18: "if task is there, should not
              let me create a task"). A row with a taskId already IS a task — the actions there are
              assign and open, and offering "create" was an invitation to duplicates. */}
          {!compact && e.kind !== 'idle' && !e.taskId && onAddTask ? (
            <button onClick={() => onAddTask(e.who)} title="File a new task on this unit"
              className={btn + ' border border-line bg-white text-ink hover:border-ink/40'}>+ Task</button>
          ) : null}
          {e.taskId ? (
            <a href={'https://app.breezeway.io/task/' + e.taskId} target="_blank" rel="noreferrer" title="Open in Breezeway"
              className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink shrink-0"><ExternalLink size={12} /></a>
          ) : null}
          {onAck ? (
            <button onClick={onAck} title="Handled — hide it for today (on this device)"
              className="p-1.5 rounded-lg text-muted hover:text-emerald-600 shrink-0"><CheckCircle2 size={15} /></button>
          ) : null}
        </span>
      </div>
      {open && e.taskId && (
        <InlineAssign taskId={e.taskId} dept={e.dept || ''} roster={roster} onDone={onDone} />
      )}
    </div>
  )
}

/**
 * NEEDS A HUMAN, on Mission Control (Jon, 2026-08-14). The same list the ops board leads with —
 * same fetches (shared 30s cache, so bouncing between the two pages costs one request), same rows,
 * same inline Assign. Renders NOTHING when the day is clean: Mission Control is a priority feed,
 * and an empty all-clear box would just push real work down the page.
 */
export function NeedsHumanPanel() {
  const { data, refresh } = useCachedFetch<OpsData>('/api/ops-today')
  const { data: gl } = useCachedFetch<{ glitches: Glitch[] }>('/api/ops-today/glitches')
  const { data: staff } = useCachedFetch<Staffing>('/api/ops-today/staffing')
  const [roster, setRoster] = useState<Roster[]>([])
  const [assignFor, setAssignFor] = useState('')
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setRoster(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])

  const units: Unit[] = Array.isArray(data?.units) ? data!.units : []
  const glitches: Glitch[] = (gl && Array.isArray(gl.glitches)) ? gl.glitches : []
  const excs = useMemo(() => buildExcs(data, units, glitches, staff), [data, units, glitches, staff])
  if (!excs.length) return null

  const shown = excs.slice(0, 8)
  return (
    <div className="rounded-2xl border border-rose-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-rose-50/70 border-b border-rose-200 flex items-center gap-2">
        <AlertTriangle size={14} className="text-rose-700" />
        <span className="text-[13px] font-bold text-rose-800">Needs a human — {excs.length}</span>
        <Link href="/plan" className="ml-auto text-[12px] font-semibold text-rose-700 hover:underline">Open the board →</Link>
      </div>
      <div className="divide-y divide-line">
        {shown.map(e => (
          <ExcRow key={e.key} e={e} roster={roster} open={assignFor === e.key} compact
            onToggleAssign={() => setAssignFor(assignFor === e.key ? '' : e.key)}
            onDone={() => { setAssignFor(''); refresh() }}
            onGiveWork={() => { window.location.href = '/plan' }} />
        ))}
        {excs.length > shown.length && (
          <Link href="/plan" className="block px-4 py-2 text-[12px] font-semibold text-muted hover:text-ink">+ {excs.length - shown.length} more on the board</Link>
        )}
      </div>
    </div>
  )
}

export function OpsV2() {
  // The three fetches the summary needs. Cached (30s) so tab flips are instant, and so the full
  // board opening underneath does not mean the page paid for the data twice in a row.
  const { data, loading, refresh } = useCachedFetch<OpsData>('/api/ops-today')
  const { data: gl } = useCachedFetch<{ glitches: Glitch[] }>('/api/ops-today/glitches')
  const { data: staff } = useCachedFetch<Staffing>('/api/ops-today/staffing')
  const [roster, setRoster] = useState<Roster[]>([])
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setRoster(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 5 * 60 * 1000); return () => clearInterval(t) }, [refresh])

  // Which tab. Remembered per person — the research point about role-shaped views, cheaply.
  const [tab, setTab] = useState<'board' | 'people' | 'push'>('board')
  useEffect(() => { try { const t = localStorage.getItem('opsv2_tab'); if (t === 'people' || t === 'push') setTab(t) } catch {} }, [])
  const pick = (t: 'board' | 'people' | 'push') => { setTab(t); try { localStorage.setItem('opsv2_tab', t) } catch {} }

  // null = closed; '' = open blank; a unit name = open with that unit pre-searched (the "+ Task"
  // button on a Needs-a-human row lands you one keystroke from filing, not five).
  const [addFor, setAddFor] = useState<string | null>(null)

  const units: Unit[] = Array.isArray(data?.units) ? data!.units : []
  const glitches: Glitch[] = (gl && Array.isArray(gl.glitches)) ? gl.glitches : []
  const d = data?.deadline

  // ── THE EXCEPTIONS, MERGED AND RANKED ─────────────────────────────────────────────────────────
  // Five mechanisms used to answer "what needs a human" in five idioms (behind band, glitch panel,
  // needs-attention group, signal chips, staffing block). One list now, worst first. Extracted to
  // buildExcs so Command Center renders the SAME list (Jon, 2026-08-14: "Command center should
  // show... needs a human section") — one definition of urgent, two doors to it.
  const excs: Exc[] = useMemo(() => buildExcs(data, units, glitches, staff), [units, glitches, staff, data])

  return (
    <div>
      {/* ── ONE row of chrome: the tabs and Add task. Everything else belongs to the board
          itself — Jon, 2026-08-17, on the stacked v2+v1 screen: "the Board tab is a mess. The
          Today in Ops board that we had was much better." So the board IS the board again; this
          layer only adds the tabs, the triage and the Add button. ── */}
      {/* Three tabs plus the Add-task button is ~400px of chrome; on a 375px screen it pushed the
          page sideways. It wraps below 640px (the button drops to its own line, still right-
          aligned by ml-auto) and is one line from sm: up, where it always fitted. */}
      <div className="flex items-center gap-6 flex-wrap border-b border-line mb-4">
        {([['board', 'Board', excs.length, 'bg-rose-100 text-rose-700'],
           ['people', 'People', staff?.summary?.clockedIn || 0, 'bg-app text-muted'],
           ['push', 'Push', null, 'bg-violet-100 text-violet-700']] as const).map(([k, label, n, cls]) => (
          <button key={k} onClick={() => pick(k as any)}
            className={'pb-2.5 pt-1 text-[14px] font-bold inline-flex items-center gap-2 border-b-2 -mb-px ' +
              (tab === k ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink')}>
            {label}
            {n != null && n > 0 && <span className={'text-[11px] font-bold rounded-full px-2 py-0.5 ' + cls}>{n}</span>}
            {k === 'push' && <PushCount />}
          </button>
        ))}
        <button onClick={() => setAddFor('')}
          className="ml-auto mb-1.5 inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3.5 py-2 text-[13px] font-bold hover:opacity-90">
          <Plus size={14} /> Add task
        </button>
      </div>

      {tab === 'board' && (
        <BoardTab excs={excs} roster={roster} onRefresh={refresh} onPeople={() => pick('people')} onAddTask={u => setAddFor(u)} />
      )}
      {tab === 'people' && <PeopleTab staff={staff || null} units={units} roster={roster} onRefresh={refresh} />}
      {tab === 'push' && <PushTab roster={roster} />}

      {addFor !== null && <AddTaskSheet roster={roster} initialQuery={addFor} onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); refresh() }} />}
    </div>
  )
}

/** The Push tab count badge — fetched lazily so the Board pays nothing for it. */
function PushCount() {
  const { data } = useCachedFetch<PlanData>('/api/ops-plan/daily', { ttl: 5 * 60_000 })
  const n = useMemo(() => {
    let c = 0
    for (const day of data?.days || []) for (const u of day.units) for (const t of u.tasks)
      if (t.pushable && !(t.push && t.push.status)) c++
    return c
  }, [data])
  if (!n) return null
  return <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-violet-100 text-violet-700">{n}</span>
}

// ── BOARD: the triage, then THE board ──────────────────────────────────────────────────────────
//
// v2 history, honestly: the first cut hid the board behind "Show all" (too hidden), the second
// stacked a flat task list on top of the old board (Jon, 2026-08-17: "a mess... The Today in Ops
// board that we had was much better"). This is the landing that survived contact: the simplified
// Needs-a-human list, then the full original board — its own market tabs, chips, status strip,
// date picker and unit cards, untouched. The board's internal not-started band and staffing check
// are suppressed here because the triage above already says both.
function BoardTab({ excs, roster, onRefresh, onPeople, onAddTask }: {
  excs: Exc[]; roster: Roster[]; onRefresh: () => void; onPeople: () => void; onAddTask: (unit: string) => void
}) {
  const [assignFor, setAssignFor] = useState('')
  const [folded, setFolded] = useState(false)
  // Handled rows: hidden for today on this device, never silently — the header keeps the count
  // and one tap brings them back.
  const [acks, setAcks] = useState<Set<string>>(new Set())
  const [showAcked, setShowAcked] = useState(false)
  useEffect(() => { setAcks(loadAcks()) }, [])
  const ack = (k: string) => setAcks(prev => { const n = new Set(prev); n.add(k); saveAcks(n); return n })
  const unack = () => { setAcks(new Set()); saveAcks(new Set()) }

  const liveExcs = excs.filter(e => !acks.has(e.key))
  const ackedCount = excs.length - liveExcs.length
  const visible = showAcked ? excs : liveExcs

  return (
    <div>
      {excs.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-white overflow-hidden mb-3">
          <button onClick={() => setFolded(f => !f)} className="w-full px-4 py-2.5 bg-rose-50/70 flex items-center gap-2 text-left">
            <AlertTriangle size={14} className="text-rose-700 shrink-0" />
            <span className="text-[13.5px] font-bold text-rose-800">Needs a human</span>
            <span className="text-[11px] font-bold text-white bg-rose-600 rounded-full px-2 py-0.5">{liveExcs.length}</span>
            {ackedCount > 0 && (
              <span onClick={ev => { ev.stopPropagation(); setShowAcked(s => !s) }}
                className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 cursor-pointer">
                {ackedCount} handled{showAcked ? ' · hide' : ''}
              </span>
            )}
            <ChevronDown size={14} className={'ml-auto text-rose-700/60 transition-transform shrink-0 ' + (folded ? '' : 'rotate-180')} />
          </button>
          {!folded && (
            <div className="border-t border-rose-200">
              {liveExcs.length === 0 && !showAcked ? (
                <div className="px-4 py-3 text-[13px] flex items-center gap-2 flex-wrap">
                  <CheckCircle2 size={15} className="text-emerald-600" />
                  <span className="font-semibold text-ink">All handled.</span>
                  <span className="text-muted">{ackedCount} item{ackedCount === 1 ? '' : 's'} marked done today on this device.</span>
                  <button onClick={unack} className="text-[12px] font-bold text-brand-700 ml-auto">Bring them back</button>
                </div>
              ) : EXC_GROUPS.map(g => {
                const rows = visible.filter(g.match)
                if (!rows.length) return null
                return (
                  <div key={g.key}>
                    <div className="px-4 pt-2.5 pb-1 flex items-baseline gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-ink/80">{g.label}</span>
                      <span className="text-[11px] text-muted">· {rows.length} — {g.sub}</span>
                    </div>
                    <div className="divide-y divide-line">
                      {rows.map(e => (
                        <div key={e.key} className={acks.has(e.key) ? 'opacity-45' : ''}>
                          <ExcRow e={e} roster={roster} open={assignFor === e.key}
                            onToggleAssign={() => setAssignFor(assignFor === e.key ? '' : e.key)}
                            onDone={() => { setAssignFor(''); onRefresh() }}
                            onGiveWork={onPeople} onAddTask={onAddTask}
                            onAck={acks.has(e.key) ? undefined : () => ack(e.key)} />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* THE BOARD — the original, full-strength. One set of controls, its own. */}
      <TodayInOps hideBands />
    </div>
  )
}

/** Assign a Breezeway task inline: filtered roster, one tap, done. */
function InlineAssign({ taskId, dept, roster, onDone }: { taskId: string; dept: string; roster: Roster[]; onDone: () => void }) {
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const ppl = useMemo(() => {
    const inDept = roster.filter(p => !p.departments?.length || p.departments.some(x => x.toLowerCase().includes((dept || '').toLowerCase())))
    return (inDept.length ? inDept : roster).slice(0, 14)
  }, [roster, dept])
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
      {ppl.map(p => (
        <button key={p.id} onClick={() => go(p.id)} disabled={!!busy}
          className="text-[12px] font-semibold px-2.5 py-1.5 rounded-full border border-line bg-white hover:border-ink/40 disabled:opacity-50">
          {busy === p.id ? <Loader2 size={11} className="animate-spin inline" /> : null} {p.name}
        </button>
      ))}
      {err && <span className="text-[11.5px] text-rose-600 font-semibold">{err}</span>}
    </div>
  )
}

// ── PEOPLE: the missing axis ───────────────────────────────────────────────────────────────────
// One lane per person on today: their queue from the board's own tasks, a done/total bar, and —
// for anyone idle — the open unassigned work pushed to them in one tap. Load is measured in TASKS,
// not invented minutes: we do not have predicted durations, and a bar built on made-up numbers
// would be read as truth. (Optii earns its minutes with an ML model; until we have one, count.)
function PeopleTab({ staff, units, roster, onRefresh }: { staff: Staffing | null; units: Unit[]; roster: Roster[]; onRefresh: () => void }) {
  const [busyKey, setBusyKey] = useState('')
  const allTasks = useMemo(() => units.flatMap(u => u.tasks.map(t => ({ ...t, unit: u.unit }))), [units])
  const unassignedOpen = useMemo(() =>
    allTasks.filter(t => !t.done && !t.guestyOnly && t.assignees.length === 0)
      .sort((a, b) => (a.type === 'departure_clean' ? 0 : 1) - (b.type === 'departure_clean' ? 0 : 1)),
    [allTasks])

  const lanes = useMemo(() => {
    const people = staff?.people || []
    return people.map(p => {
      const alias = (p.bzAlias || p.name).toLowerCase()
      const mine = allTasks.filter(t => t.assignees.some(a => {
        const an = a.toLowerCase()
        return an === alias || an.includes(alias.split(' ')[0]) && alias.split(' ')[0].length > 3
      }))
      const done = mine.filter(t => t.done).length
      return { p, mine, done }
    }).sort((a, b) => (a.p.clockedIn ? 0 : 1) - (b.p.clockedIn ? 0 : 1) || (a.mine.length === 0 ? 0 : 1) - (b.mine.length === 0 ? 0 : 1))
  }, [staff, allTasks])

  const rosterIdFor = (name: string): number | null => {
    const n = name.toLowerCase()
    const hit = roster.find(r => r.name.toLowerCase() === n) || roster.find(r => r.name.toLowerCase().includes(n.split(' ')[0]) && n.split(' ')[0].length > 3)
    return hit ? hit.id : null
  }

  const pushTo = async (person: StaffPerson, task: Task & { unit: string }) => {
    const rid = rosterIdFor(person.bzAlias || person.name)
    if (!rid) { alert('Could not match "' + person.name + '" to the Breezeway roster — assign from the board instead.'); return }
    setBusyKey(person.name + task.id)
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, assigneeIds: [rid] }) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'failed')
      onRefresh()
    } catch (e: any) { alert(String(e?.message || e)) }
    setBusyKey('')
  }

  if (!staff || !staff.people.length) return <div className="text-sm text-muted py-8 text-center">No one on the Homebase schedule today.</div>
  return (
    <div className="space-y-2.5">
      <p className="text-[12.5px] text-muted px-1">
        Everyone on today, their queue, and who has room. An amber lane is spare capacity — push the nearest open work onto it.
      </p>
      {lanes.map(({ p, mine, done }) => {
        const idle = p.clockedIn && mine.length === 0
        const pct = mine.length ? Math.round((done / mine.length) * 100) : 0
        return (
          <div key={p.name} className={'rounded-2xl border overflow-hidden ' + (idle ? 'border-amber-300' : 'border-line')}>
            <div className="flex items-center gap-3 px-4 py-2.5 bg-white flex-wrap">
              <span className="w-9 h-9 rounded-full bg-app grid place-items-center text-[12px] font-bold text-ink/60 shrink-0">
                {p.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-ink leading-tight">{p.name}</span>
                <span className="block text-[11px] text-muted">
                  {p.role || 'Field'}{p.shift ? ' · ' + p.shift : ''} · {p.clockedIn ? 'clocked in' : 'not clocked in'}
                  {p.bzAlias && p.bzAlias !== p.name ? ' · bz: ' + p.bzAlias : ''}
                </span>
              </span>
              <span className="ml-auto flex items-center gap-2 shrink-0">
                <span className="text-[11.5px] font-semibold text-muted tabular-nums">{done}/{mine.length} done</span>
                <span className="w-24 h-2 rounded-full bg-app overflow-hidden">
                  <span className={'block h-full ' + (idle ? 'bg-neutral-200' : pct === 100 ? 'bg-emerald-500' : 'bg-sky-400')} style={{ width: (mine.length ? Math.max(6, pct) : 100) + '%' }} />
                </span>
              </span>
            </div>
            {idle ? (
              <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-200 flex items-center gap-2 flex-wrap">
                <AlertTriangle size={13} className="text-amber-700 shrink-0" />
                <span className="text-[12.5px] font-semibold text-amber-900 flex-1 min-w-[160px]">
                  Idle — {unassignedOpen.length ? 'open unassigned work:' : 'no unassigned work open right now.'}
                </span>
                {unassignedOpen.slice(0, 3).map(t => (
                  <button key={t.id} onClick={() => pushTo(p, t)} disabled={busyKey === p.name + t.id}
                    className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-50 inline-flex items-center gap-1">
                    {busyKey === p.name + t.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                    {t.unit} · {t.name.length > 24 ? t.name.slice(0, 24) + '…' : t.name}
                  </button>
                ))}
              </div>
            ) : mine.length > 0 ? (
              <div className="px-4 py-2 bg-app/40 border-t border-line flex items-center gap-1.5 flex-wrap">
                {mine.slice(0, 8).map(t => (
                  <span key={t.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink/80">
                    <span className={'w-1.5 h-1.5 rounded-full ' + (t.done ? 'bg-emerald-500' : t.late ? 'bg-rose-500' : t.running ? 'bg-sky-500' : 'bg-neutral-300')} />
                    {t.unit} · {t.type === 'departure_clean' ? 'clean' : t.name.length > 18 ? t.name.slice(0, 18) + '…' : t.name}
                  </span>
                ))}
                {mine.length > 8 && <span className="text-[11px] text-muted">+{mine.length - 8}</span>}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ── PUSH: the suggestion queue, promoted ───────────────────────────────────────────────────────
// Everything the plan engine can suggest, grouped by REASON with evidence, filed one tap at a time.
// The scheduled date defaults to the unit's next vacant day (the push API already computes it).
function PushTab({ roster }: { roster: Roster[] }) {
  const { data, loading, refresh } = useCachedFetch<PlanData>('/api/ops-plan/daily', { ttl: 5 * 60_000 })
  const [busy, setBusy] = useState('')
  const [filed, setFiled] = useState<Record<string, boolean>>({})
  const [who, setWho] = useState<Record<string, number | 0>>({})
  // A pushed task can carry the pusher's own words (Jon, 2026-08-18: "allow you to add comments /
  // descriptions"), and go to ANYONE on Breezeway — the select shows the whole roster, with the
  // people whose department fits listed first, never instead.
  const [note, setNote] = useState<Record<string, string>>({})
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({})
  const rosterFor = (dept?: string | null) => {
    const d = String(dept || '').toLowerCase()
    const fits = d ? roster.filter(p => p.departments?.some(x => x.toLowerCase().includes(d))) : []
    const fitIds = new Set(fits.map(p => p.id))
    return { fits, rest: roster.filter(p => !fitIds.has(p.id)) }
  }

  // ── THE AM PUSH (Jon, 2026-08-14: "push activities in the AM based on vacant room and guest
  // feedback or inspection needed, pm needed, batteries needed... or open tasks in unit"). ──
  // A vacant unit is a free work slot. This crosses today's vacants with (a) open tasks already in
  // the unit and (b) recurring care that has aged out — batteries, A/C filter, PM, audit, deep
  // clean, inspection — and files the catch-up work TODAY, while nobody is in the way.
  const { data: ops } = useCachedFetch<OpsData>('/api/ops-today')
  const [sig, setSig] = useState<Record<string, { care?: CareItem[]; pending?: any[] }>>({})
  const vacants = useMemo(() => (ops?.vacants || []).slice(0, 40), [ops])
  useEffect(() => {
    const ids = vacants.map(v => v.listingId)
    if (!ids.length) { setSig({}); return }
    let alive = true
    fetch('/api/ops-today/signals?ids=' + encodeURIComponent(ids.join(',')), { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (alive && j && j.ok) setSig(j.signals || {}) }).catch(() => {})
    return () => { alive = false }
  }, [vacants.map(v => v.listingId).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const vacantRows = useMemo(() => vacants.map(v => {
    const s = sig[v.listingId] || {}
    const due = (s.care || []).filter(c => c.due)
    const pending = (s.pending || []).length
    return { v, due, pending }
  }).filter(r => r.due.length > 0 || r.pending > 0 || r.v.openTasks > 0), [vacants, sig])

  const fileCare = async (v: VacantU, c: CareItem) => {
    const t = SHEET_TEMPLATES.find(x => x.key === c.template)
    const key = 'care:' + v.listingId + ':' + c.key
    const uKey = 'unit:' + v.listingId
    setBusy(key)
    try {
      const extra = (note[uKey] || '').trim()
      const r = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: v.listingId, title: t ? t.title : c.label,
          department: t ? t.department : 'maintenance', priority: t ? t.priority : 'normal',
          description: (t ? t.base + '\n\n' : '')
            + (extra ? 'Note from the team: ' + extra + '\n\n' : '')
            + 'Pushed from Today in Ops: unit is vacant today and this is ' +
            (c.neverSeen ? 'not on record as ever done.' : String(c.monthsAgo) + ' months old (cadence: every ' + c.every + ').'),
          date: ops?.today,
          assigneeIds: who[uKey] ? [who[uKey]] : [],
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'could not file')
      setFiled(f => ({ ...f, [key]: true }))
    } catch (e: any) { alert(String(e?.message || e)) }
    setBusy('')
  }

  const groups = useMemo(() => {
    const g: Record<string, { unit: PlanUnit; task: PlanTask; day: string }[]> = {}
    for (const day of data?.days || []) for (const u of day.units) for (const t of u.tasks) {
      if (!t.pushable || (t.push && t.push.status)) continue
      ;(g[t.category] = g[t.category] || []).push({ unit: u, task: t, day: day.label })
    }
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length)
  }, [data])

  const push = async (unit: PlanUnit, task: PlanTask, key: string) => {
    setBusy(key)
    try {
      const ids = who[key] ? [who[key]] : []
      const r = await fetch('/api/health/push-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: unit.listingId, issueKey: task.key, issueTitle: task.title,
          action: task.detail, unitName: unit.internalName || unit.listing,
          severity: task.severity, department: task.department, assigneeIds: ids, confirm: true,
          note: (note[key] || '').trim() || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'push failed')
      setFiled(f => ({ ...f, [key]: true }))
    } catch (e: any) { alert(String(e?.message || e)) }
    setBusy('')
  }

  if (loading && !data) return <div className="text-sm text-muted py-8 text-center">Reading the suggestion engine…</div>
  if (!groups.length && !vacantRows.length) return (
    <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">
      Nothing to suggest right now — no vacant catch-up work, and feedback, PM and audit cadences are all clear.
      <button onClick={() => refresh()} className="block mx-auto mt-2 text-[12px] font-bold text-brand-700 underline">Check again</button>
    </div>
  )
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted px-1">
        Work the system recommends before anyone asks for it — vacant units to catch up in, guest feedback,
        PM age and audit cadence. Pushing files it in Breezeway; pick a person to assign it in the same tap.
      </p>

      {/* ── VACANT TODAY: the AM push ── */}
      {vacantRows.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-emerald-50/70 border-b border-emerald-200 flex items-center gap-2">
            <span className="text-[13px] font-bold text-emerald-900">Vacant today — catch-up day</span>
            <span className="text-[11.5px] text-emerald-800/70">empty units with open work or care that has aged out</span>
          </div>
          <div className="divide-y divide-line">
            {vacantRows.map(({ v, due, pending }) => (
              <div key={v.listingId} className="px-4 py-2.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-[13px] font-bold text-ink shrink-0">{v.unit}</span>
                  <span className="text-[11.5px] text-muted shrink-0">
                    {v.market}{v.nextArrival ? ' · next guest ' + v.nextArrival.slice(5) : ' · no upcoming booking'}
                  </span>
                  {v.openTasks > 0 && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">{v.openTasks} task{v.openTasks === 1 ? '' : 's'} today</span>}
                  {pending > 0 && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">{pending} overdue in unit</span>}
                </div>
                {due.length > 0 && (() => {
                  const uKey = 'unit:' + v.listingId
                  const { fits, rest } = rosterFor('maintenance')
                  return (
                    <>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        {due.map(c => {
                          const key = 'care:' + v.listingId + ':' + c.key
                          return filed[key] ? (
                            <span key={c.key} className="text-[11.5px] font-bold text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> {c.short} filed</span>
                          ) : (
                            <button key={c.key} onClick={() => fileCare(v, c)} disabled={busy === key}
                              title={c.neverSeen ? 'Never on record' : c.monthsAgo + ' months since last (every ' + c.every + ')'}
                              className="text-[11.5px] font-bold px-2.5 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1">
                              {busy === key ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                              {c.short}{c.neverSeen ? ' · never' : ' · ' + Math.round(c.monthsAgo || 0) + 'mo'}
                            </button>
                          )
                        })}
                        {/* Anyone on Breezeway + your own words, applied to whatever gets filed
                            from this unit's chips (Jon, 2026-08-18). */}
                        <select value={who[uKey] || 0} onChange={e => setWho(w => ({ ...w, [uKey]: Number(e.target.value) }))}
                          className="text-[11.5px] border border-line rounded-lg px-1.5 py-1.5 bg-white text-muted max-w-[140px]">
                          <option value={0}>Assign to…</option>
                          {fits.length ? <optgroup label="Fits the job">{fits.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null}
                          {rest.length ? <optgroup label="Everyone">{rest.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null}
                        </select>
                        <button onClick={() => setNoteOpen(o => ({ ...o, [uKey]: !o[uKey] }))}
                          className={'text-[11.5px] font-semibold px-2 py-1.5 rounded-lg border inline-flex items-center gap-1 ' +
                            ((note[uKey] || '').trim() ? 'border-violet-300 text-violet-700 bg-violet-50' : 'border-line text-muted hover:text-ink')}>
                          <MessageSquare size={11} /> {noteOpen[uKey] ? 'Hide note' : (note[uKey] || '').trim() ? 'Note added' : '+ Note'}
                        </button>
                      </div>
                      {noteOpen[uKey] ? (
                        <textarea value={note[uKey] || ''} onChange={e => setNote(n => ({ ...n, [uKey]: e.target.value }))} rows={2}
                          placeholder="What the person doing this should know — goes into the Breezeway description."
                          className="mt-1.5 w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
                      ) : null}
                    </>
                  )
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      {groups.map(([cat, rows]) => (
        <div key={cat} className="rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-app/60 border-b border-line flex items-center gap-2">
            <span className="text-[13px] font-bold text-ink">{cat}</span>
            <span className="text-[11.5px] text-muted">{rows.length} suggestion{rows.length === 1 ? '' : 's'}</span>
          </div>
          <div className="divide-y divide-line">
            {rows.map(({ unit, task, day }) => {
              const key = unit.listingId + '|' + task.key
              const ev = task.evidence && task.evidence[0]
              // The WHOLE Breezeway roster (Jon, 2026-08-18: "assign whoever on breezeway") —
              // department fits float to the top, everyone else stays reachable below them.
              const { fits, rest } = rosterFor(task.department)
              return (
                <div key={key} className="px-4 py-2.5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-bold text-ink">{unit.internalName || unit.listing}</span>
                        <span className="text-[13px] text-ink/80">{task.title}</span>
                        {task.severity === 'critical' || task.severity === 'high'
                          ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">{task.severity}</span> : null}
                        <span className="text-[11px] text-muted">checkout {day}</span>
                      </div>
                      {ev && <p className="text-[12px] text-muted mt-0.5 italic truncate">&ldquo;{ev.quote}&rdquo;{ev.stars != null ? ' · ' + ev.stars + '★' : ''}{ev.date ? ' · ' + ev.date : ''}</p>}
                      {!ev && task.metric && <p className="text-[12px] text-muted mt-0.5">{task.metric}</p>}
                    </div>
                    {/* The action cluster below (a 150px select + Note + Push, ~300px) was held at
                        shrink-0, which is wider than a phone row and spilled out of the card. It
                        wraps and may shrink below 640px; from sm: up it is the same one-line row. */}
                    {filed[key] ? (
                      <span className="text-[12px] font-bold text-emerald-700 inline-flex items-center gap-1 shrink-0"><Check size={13} /> Filed</span>
                    ) : (
                      <span className="flex items-center gap-1.5 flex-wrap shrink sm:flex-nowrap sm:shrink-0">
                        <select value={who[key] || 0} onChange={e => setWho(w => ({ ...w, [key]: Number(e.target.value) }))}
                          className="text-[12px] border border-line rounded-lg px-1.5 py-1.5 bg-white text-muted max-w-[150px]">
                          <option value={0}>Default crew</option>
                          {fits.length ? <optgroup label="Fits the job">{fits.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null}
                          {rest.length ? <optgroup label="Everyone">{rest.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null}
                        </select>
                        <button onClick={() => setNoteOpen(o => ({ ...o, [key]: !o[key] }))}
                          title="Add your own words to the task description"
                          className={'text-[12px] font-semibold px-2 py-1.5 rounded-lg border inline-flex items-center gap-1 ' +
                            ((note[key] || '').trim() ? 'border-violet-300 text-violet-700 bg-violet-50' : 'border-line text-muted hover:text-ink')}>
                          <MessageSquare size={12} /> {(note[key] || '').trim() ? 'Note' : '+ Note'}
                        </button>
                        <button onClick={() => push(unit, task, key)} disabled={busy === key}
                          className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1">
                          {busy === key ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Push
                        </button>
                      </span>
                    )}
                  </div>
                  {noteOpen[key] && !filed[key] ? (
                    <textarea value={note[key] || ''} onChange={e => setNote(n => ({ ...n, [key]: e.target.value }))} rows={2}
                      placeholder="What the person doing this should know — rides into the Breezeway description with your name."
                      className="mt-1.5 w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── ADD TASK, FROM ANYWHERE ────────────────────────────────────────────────────────────────────
// The sheet Jon asked for: type-ahead over the WHOLE portfolio (not just vacant units), the smart
// templates with guest-feedback intel, assignment in the same tap. Creation + assignment is one
// call — /api/ops-today/add-task already takes assigneeIds and writes through to the sync mirror.
const SHEET_TEMPLATES: { key: string; label: string; hint: string; department: string; priority: string; title: string; base: string; useIntel?: boolean }[] = [
  { key: 'inspection', label: 'Inspection', hint: 'standard unit check', department: 'inspection', priority: 'high', title: 'Unit Check', useIntel: true, base: 'Standard unit inspection: cleanliness vs. the photos, damage / wear, all amenities present and working, consumables restocked, photos still match reality.' },
  { key: 'deepclean', label: 'Deep clean', hint: 'beyond turnover', department: 'housekeeping', priority: 'normal', title: 'Deep Clean', base: 'Deep clean (beyond the turnover standard): inside appliances, behind and under furniture, grout and caulk, vents, baseboards, windows and tracks, upholstery and mattress protectors.' },
  { key: 'pm', label: 'PM check', hint: 'A/C, plumbing, detectors', department: 'maintenance', priority: 'normal', title: 'Preventative Maintenance Task', base: 'Preventative maintenance pass: A/C, plumbing under sinks, water heater, smoke / CO detectors, light bulbs, door hardware.' },
  { key: 'batteries', label: 'Lock batteries', hint: 'annual', department: 'maintenance', priority: 'normal', title: 'Replace lock batteries', base: 'Annual lock battery replacement. Replace batteries in every door lock, re-test the lock and codes afterwards, and log the date.' },
  { key: 'acfilter', label: 'A/C filter', hint: 'size + date', department: 'maintenance', priority: 'normal', title: 'Change A/C filter', base: 'Change the central A/C filter. Note the filter size used and log the date.' },
  { key: 'audit', label: 'Annual audit', hint: 'files the audit link', department: 'inspection', priority: 'normal', title: 'Annual Quality Audit', useIntel: true, base: 'Annual quality audit (done once per year): score the unit against the standard checklist, log any damage or wear, confirm inventory counts, and photograph anything below standard.' },
  { key: 'custom', label: 'Custom', hint: 'type it yourself', department: 'maintenance', priority: 'normal', title: '', base: '' },
]
type Intel = { lastFeedback?: { rating: number | null; date: string | null; excerpt: string | null } | null; checklist?: string[] }

function AddTaskSheet({ roster, onClose, onDone, initialQuery }: { roster: Roster[]; onClose: () => void; onDone: () => void; initialQuery?: string }) {
  const [listings, setListings] = useState<Listing[]>([])
  const [uq, setUq] = useState(initialQuery || '')
  const [unit, setUnit] = useState<Listing | null>(null)
  const [tpl, setTpl] = useState('custom')
  const [title, setTitle] = useState('')
  const [dept, setDept] = useState('maintenance')
  const [prio, setPrio] = useState('normal')
  const [date, setDate] = useState('')
  const [desc, setDesc] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [intel, setIntel] = useState<Intel | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const boxRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/listings', { cache: 'no-store' }).then(r => r.json())
      .then(j => setListings(Array.isArray(j.results) ? j.results : [])).catch(() => {})
    setTimeout(() => boxRef.current?.focus(), 60)
  }, [])
  useEffect(() => {
    if (!unit) { setIntel(null); return }
    fetch('/api/schedule/listing-ops?listingId=' + encodeURIComponent(unit.id), { cache: 'no-store' })
      .then(r => r.json()).then(j => setIntel(j || null)).catch(() => {})
  }, [unit])

  const hits = useMemo(() => {
    const n = uq.trim().toLowerCase()
    if (!n) return []
    return listings.filter(l => ((l.nickname || l.title || '') + ' ' + (l.building || '')).toLowerCase().includes(n)).slice(0, 7)
  }, [uq, listings])

  const useTpl = (k: string) => {
    const t = SHEET_TEMPLATES.find(x => x.key === k)!
    setTpl(k); setTitle(t.title); setDept(t.department); setPrio(t.priority)
    let body = t.base
    if (t.useIntel && intel) {
      const cl = intel.checklist || []
      if (cl.length) body += '\n\nLook specifically at (from this unit’s recent guest feedback):\n' + cl.map(c => '- ' + c).join('\n')
      const lf = intel.lastFeedback
      if (lf && lf.excerpt) body += '\n\nLast guest feedback' + (lf.rating ? ' (' + lf.rating + '★)' : '') + ': “' + String(lf.excerpt).slice(0, 240) + '”'
    }
    setDesc(body)
  }

  const create = async () => {
    if (!unit || !title.trim()) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: unit.id, title: title.trim(), department: dept, priority: prio, description: desc, date: date || undefined, assigneeIds: picked }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not create the task')
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }

  const uname = (l: Listing) => l.nickname || l.title || l.id
  return (
    /* PHONE: a full-screen sheet, not a floating card. The 16px gutter plus a 6vh top inset left
       a narrow box with the template grid and the roster chips fighting for width, and its last
       control (Create in Breezeway) sat under the home indicator. Full-bleed and full-height
       below 640px; the floating dialog is unchanged from sm: up. */
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-0 sm:p-4 sm:pt-[6vh] overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-none sm:rounded-2xl w-full max-w-xl min-h-dvh sm:min-h-0 p-4 pb-10 sm:p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-bold text-ink flex-1">Add a task</h2>
          <button onClick={onClose} className="text-muted hover:text-ink p-1"><X size={16} /></button>
        </div>
        <p className="text-[12px] text-muted mb-3">Any unit in the portfolio. It files straight into Breezeway — assigned, if you pick someone.</p>

        {!unit ? (
          <div>
            <input ref={boxRef} value={uq} onChange={e => setUq(e.target.value)} placeholder="Which unit? Start typing…"
              className="w-full rounded-xl border-2 border-line px-3.5 py-2.5 text-[14px] focus:outline-none focus:border-ink" />
            {hits.length > 0 && (
              <div className="mt-1.5 rounded-xl border border-line overflow-hidden">
                {hits.map(l => (
                  <button key={l.id} onClick={() => setUnit(l)}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left text-[13.5px] bg-white hover:bg-app border-b border-line last:border-0">
                    <span className="font-semibold text-ink">{uname(l)}</span>
                    {l.building && <span className="text-[11.5px] text-muted ml-auto">{l.building}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-app px-3.5 py-2.5">
            <span className="text-[14px] font-bold text-ink">{uname(unit)}</span>
            {unit.building && <span className="text-[11.5px] text-muted">{unit.building}</span>}
            <button onClick={() => { setUnit(null); setUq('') }} className="ml-auto text-muted hover:text-ink"><X size={14} /></button>
          </div>
        )}

        {unit && (
          <>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mt-4 mb-1.5">What kind of work</p>
            <div className="flex flex-wrap gap-1.5">
              {SHEET_TEMPLATES.map(t => (
                <button key={t.key} onClick={() => useTpl(t.key)}
                  className={'px-3 py-2 rounded-xl border-2 text-left ' + (tpl === t.key ? 'bg-ink border-ink text-white' : 'bg-white border-line text-ink hover:border-ink/30')}>
                  <span className="block text-[12.5px] font-bold leading-tight">{t.label}</span>
                  <span className={'block text-[10px] ' + (tpl === t.key ? 'text-white/70' : 'text-muted')}>{t.hint}</span>
                </button>
              ))}
            </div>

            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mt-4 mb-1.5">The task</p>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?"
              className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] mb-2" />
            {/* Three across is ~90px a column on a phone — a native date picker does not fit in
                that, so the date takes its own full-width row below 640px. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <select value={dept} onChange={e => setDept(e.target.value)} className="rounded-xl border border-line px-2 py-2 text-[12.5px] bg-white">
                {['maintenance', 'housekeeping', 'inspection', 'safety'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
              </select>
              <select value={prio} onChange={e => setPrio(e.target.value)} className="rounded-xl border border-line px-2 py-2 text-[12.5px] bg-white">
                {['normal', 'high', 'urgent', 'low'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
              </select>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="col-span-2 sm:col-span-1 rounded-xl border border-line px-2 py-2 text-[12.5px] bg-white" title="Blank = today" />
            </div>
            {desc && (
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4}
                className="w-full mt-2 rounded-xl border border-line px-3 py-2 text-[12px] font-mono text-muted" />
            )}

            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mt-3.5 mb-1.5">Who takes it (optional)</p>
            <div className="flex flex-wrap gap-1.5">
              {roster.filter(p => !p.departments?.length || p.departments.some(x => x.toLowerCase().includes(dept))).slice(0, 12).map(p => (
                <button key={p.id} onClick={() => setPicked(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id])}
                  className={'px-3 py-1.5 rounded-full border text-[12.5px] font-semibold ' + (picked.includes(p.id) ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-ink hover:border-ink/30')}>
                  {p.name}
                </button>
              ))}
            </div>

            {err && <p className="text-[12px] text-rose-600 font-semibold mt-2">{err}</p>}
            <button onClick={create} disabled={busy || !title.trim()}
              className="w-full mt-4 rounded-xl bg-ink text-white py-3 text-[14px] font-bold disabled:opacity-40 inline-flex items-center justify-center gap-2">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              {busy ? 'Creating…' : picked.length ? 'Create & assign in Breezeway' : 'Create in Breezeway'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

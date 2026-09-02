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
// 2026-09-02 (Jon: "get rid of the needs a human tab" + "Grid + Staffing only"): the Board tab
// (Needs-a-human triage over the old TodayInOps board) and the Push tab (a 114-item queue that
// fired a fixed Audit + PM for every turnover) LEFT this page. Their job — what needs a person,
// with evidence and one action — is the Command Center's "Do next" list now (lib/command-day),
// with dismissals shared server-side instead of per-device localStorage ticks. Two tabs remain:
// GRID (the board, the default) and STAFFING (the person axis + the capacity model).
//
// Assignment uses /api/breezeway/assign, creation /api/ops-today/add-task (which already takes
// assigneeIds). This file is a front door on machinery that already works.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Plus, ChevronDown, Users, Send, X, Loader2, Check, FileText, ChevronLeft, ChevronRight, CalendarDays,
} from 'lucide-react'
import { OpsGrid } from '@/components/OpsGrid'
import { useCachedFetch } from '@/lib/swr'
import { matchRoster, samePerson } from '@/lib/roster-match'


// ── types (mirrors of what the APIs actually send) ──────────────────────────────────────────────
type Task = { id: string; listingId: string; unit: string; market: string; dept: string; type: string; name: string; status: string; assignees: string[]; startedAt: string | null; finishedAt: string | null; minutes: number | null; done: boolean; running: boolean; late: boolean; atRisk: boolean; guestyOnly?: boolean }
type Unit = { listingId: string; unit: string; market: string; market2?: string | null; guestOut: string | null; sameDayTurn: boolean; tasks: Task[]; late: boolean; atRisk: boolean; unassigned: boolean; allDone: boolean }
type Deadline = { dueBy: string; minsLeft: number; passed: boolean; cleans: number; done: number; late: number; atRisk: number }
type BehindRow = { taskId: string; unit: string; checkOutTime: string | null; arrivingAt: string | null; assignee: string | null }
type VacantU = { listingId: string; unit: string; market: string; leftToday: string | null; nextArrival: string | null; openTasks: number }
type OpsData = { ok: boolean; today: string; deadline: Deadline; behind?: { notStarted: number; units: BehindRow[] } | null; units: Unit[]; vacants?: VacantU[]; error?: string }
type Glitch = { id: string; unit: string; issue: string; ageDays?: number; running?: boolean; unassigned?: boolean; assignees?: string[] }
type StaffPerson = { name: string; role: string | null; clockedIn: boolean; shift: string | null; bzAlias: string | null; tasks: number; cleans: number }
type Staffing = { ok: boolean; people: StaffPerson[]; summary: { clockedIn: number; nothingAssigned: number; idleNames: string[] } }
type Roster = { id: number; name: string; departments: string[] }
type Listing = { id: string; nickname?: string | null; title?: string | null; building?: string | null }

// ── The efficiency model (/api/capacity — lib/capacity-day). Built 2026-08-27, measured from
// 1,372 timed cleans; this page is its first surface. Shapes mirror DayLoad / Suggestion / DayKpi.
type CapPerson = { person: string; cleans: number; otherTasks: number; workMinutes: number; travelMinutes: number; loadMinutes: number; capacityMinutes: number; utilisationPct: number; headroomCleans: number; verdict?: string }
type CapSug = { kind: 'assign' | 'move'; stopId: string; unit: string; toPerson: string; fromPerson?: string | null; toBeforePct: number; toAfterPct: number; fromBeforePct?: number; fromAfterPct?: number; addedMinutes: number; why: string }
type CapKpi = { peopleOnShift: number; cleans: number; otherTasks: number; unassignedCount: number; workMinutes: number; travelMinutes: number; capacityMinutes: number; utilisationPct: number; spreadPct: number; overloaded: number; underloaded: number; implausible: number; closedOutToday: number }
type CapData = { ok?: boolean; people?: CapPerson[]; suggestions?: CapSug[]; kpi?: CapKpi; notes?: string[]; error?: string }

const fmtH = (mins: number) => {
  const m = Math.max(0, Math.round(mins))
  const h = Math.floor(m / 60), r = m % 60
  return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'
}


/** Today in the market's own timezone — the board is a New York clock, not the browser's. */
function ymdET(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}
function shiftYmd(ymd: string, n: number) {
  return ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000))
}

export function OpsV2() {
  // The three fetches the summary needs. Cached (30s) so tab flips are instant, and so the full
  // board opening underneath does not mean the page paid for the data twice in a row.
  // ── WHICH DAY ────────────────────────────────────────────────────────────────────────────────
  // The route has accepted ?date= since it was written and the board never sent one, so it was
  // permanently pinned to today with no way to tell. That is a plain gap on its own — but it also
  // made a feature actively misleading: the suggestions layer can schedule work onto a future date,
  // and the moment you did, the thing you had just created became invisible.
  const todayYmd = ymdET(new Date())
  const [date, setDate] = useState(todayYmd)
  const isToday = date === todayYmd
  const { data, loading, error, refresh } = useCachedFetch<OpsData>(
    isToday ? '/api/ops-today' : `/api/ops-today?date=${date}`)
  const { data: gl } = useCachedFetch<{ glitches: Glitch[] }>('/api/ops-today/glitches')
  const { data: staff } = useCachedFetch<Staffing>('/api/ops-today/staffing')
  // The capacity model prices the same day the board is showing — today or a planned date.
  const { data: cap } = useCachedFetch<CapData>(
    isToday ? '/api/capacity' : `/api/capacity?date=${date}`, { ttl: 5 * 60_000 })
  const [roster, setRoster] = useState<Roster[]>([])
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setRoster(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])
  // FIVE MINUTES, PLUS THE MOMENT YOU LOOK AT IT AGAIN.
  // The interval alone meant a phone that had been in a pocket for forty minutes showed forty-minute
  // -old rows for up to five minutes more — on the one screen where a stale row is how a walk-in
  // happens. The suggestions provider already listened for this; the board did not.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 5 * 60 * 1000)
    const onShow = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
  }, [refresh])

  // Which tab. Remembered per person — the research point about role-shaped views, cheaply.
  // GRID IS THE LANDING (Jon, 2026-08-25: "the Today in Ops board that I created with the Breezeway
  // should be the default mode"). The storage key is deliberately a NEW one: the old key already
  // holds 'board' for everyone who used this page before today, and there is no way to tell "chose
  // Board" apart from "never chose". Bumping the key gives everybody the new landing once, and
  // whatever they pick after that is theirs and sticks.
  // TWO TABS (2026-09-02). ?tab=people deep-links from the Command Center; otherwise the last
  // choice on this device. Anyone whose stored choice was the retired Board or Push tab lands on
  // the Grid.
  const [tab, setTab] = useState<'grid' | 'people'>('grid')
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('tab')
      if (q === 'people') { setTab('people'); return }
      const t = localStorage.getItem('opsv2_tab_v2'); if (t === 'people') setTab(t)
    } catch {}
  }, [])
  const pick = (t: 'grid' | 'people') => { setTab(t); try { localStorage.setItem('opsv2_tab_v2', t) } catch {} }

  // null = closed; '' = open blank; a unit name = open with that unit pre-searched (the "+ Task"
  // button on a Needs-a-human row lands you one keystroke from filing, not five).
  const [addFor, setAddFor] = useState<string | null>(null)

  const units: Unit[] = Array.isArray(data?.units) ? data!.units : []
  const glitches: Glitch[] = (gl && Array.isArray(gl.glitches)) ? gl.glitches : []

  return (
    <div>
      {/* ── ONE row of chrome: the tabs and Add task. Everything else belongs to the board
          itself — Jon, 2026-08-17, on the stacked v2+v1 screen: "the Board tab is a mess. The
          Today in Ops board that we had was much better." So the board IS the board again; this
          layer only adds the tabs, the triage and the Add button. ── */}
      {/* Four tabs plus the Add-task button is ~400px of chrome, and this is the screen the app now
          opens on, so it has to be right. Wrapping stranded Add task in an empty band; putting the
          WHOLE row in one scroller pushed Add task half off the right edge, which is worse — it is
          the primary action here. So: the tabs scroll, the button does not. It stays pinned to the
          right at every width, and from sm: up this is the same one-line row it always was. */}
      <div className="flex items-end gap-2 border-b border-line mb-2 sm:mb-4">
      <div className="flex items-center gap-4 sm:gap-6 flex-1 min-w-0 overflow-x-auto sm:overflow-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {([['grid', 'Grid', null, 'bg-app text-muted'],
           ['people', 'Staffing', staff?.summary?.clockedIn || 0, 'bg-app text-muted']] as const).map(([k, label, n, cls]) => (
          <button key={k} onClick={() => pick(k as any)}
            className={'pb-2.5 pt-1 text-[14px] font-bold inline-flex shrink-0 items-center gap-2 border-b-2 -mb-px ' +
              (tab === k ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink')}>
            {label}
            {n != null && n > 0 && <span className={'text-[11px] font-bold rounded-full px-2 py-0.5 ' + cls}>{n}</span>}
          </button>
        ))}
      </div>
        {/* The day sheet lives in the page header on a desktop. On a phone that header is hidden
            (the app bar already says "Today in Ops"), so the link rides here instead of costing a
            whole row of screen to itself. */}
        <Link href="/plan/print" prefetch={false} aria-label="Day sheet"
          title="Printable day sheet"
          className="sm:hidden shrink-0 mb-1.5 w-9 h-9 rounded-xl border border-line bg-white grid place-items-center text-muted active:bg-app">
          <FileText size={15} />
        </Link>
        {/* ── THE DAY ──────────────────────────────────────────────────────────────────────
            Only shows itself once you have moved off today: on the normal morning it is a single
            chevron, and the moment you are looking at another day the board says so loudly, because
            a board silently showing tomorrow is worse than one that cannot show tomorrow at all. */}
        <div className="shrink-0 mb-1.5 inline-flex items-center rounded-xl border border-line bg-white overflow-hidden">
          <button onClick={() => setDate(d => shiftYmd(d, -1))} title="Previous day"
            className="px-1.5 py-2 text-muted hover:text-ink hover:bg-app"><ChevronLeft size={14} /></button>
          {!isToday && (
            <button onClick={() => setDate(todayYmd)} title="Back to today"
              className="px-2 py-2 text-[12px] font-bold text-brand-700 hover:bg-brand-50 whitespace-nowrap border-x border-line">
              {new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
            </button>
          )}
          <button onClick={() => setDate(d => shiftYmd(d, 1))} title="Next day"
            className="px-1.5 py-2 text-muted hover:text-ink hover:bg-app"><ChevronRight size={14} /></button>
        </div>
        <button onClick={() => setAddFor('')}
          className="shrink-0 mb-1.5 inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 sm:px-3.5 py-2 text-[13px] font-bold hover:opacity-90">
          <Plus size={14} /> Add task
        </button>
      </div>

      {!isToday && (
        <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 flex items-center gap-2 flex-wrap">
          <CalendarDays size={13} className="text-brand-700 shrink-0" />
          <span className="text-[12.5px] font-bold text-brand-800">
            You are looking at {new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
          </span>
          <span className="text-[11.5px] text-brand-700/80">not today</span>
          <button onClick={() => setDate(todayYmd)} className="ml-auto text-[12px] font-bold text-brand-700 hover:underline shrink-0">Back to today</button>
        </div>
      )}

      <CapacityStrip cap={cap || null} roster={roster} onRefresh={refresh} onPeople={() => pick('people')} />

      {tab === 'grid' && (
        <OpsGrid data={data as any} glitches={glitches as any} roster={roster} staff={staff as any}
          loading={loading} error={error ? String(error) : null}
          onRefresh={refresh} onAddTask={u => setAddFor(u)} />
      )}
      {tab === 'people' && <PeopleTab staff={staff || null} units={units} roster={roster} onRefresh={refresh} cap={cap || null} />}

      {addFor !== null && <AddTaskSheet roster={roster} initialQuery={addFor} onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); refresh() }} />}
    </div>
  )
}

// ── THE DAY IN ONE SENTENCE (Jon, 2026-08-31: "we need AI to learn how many tasks are doable,
// how long things should take"). The learning already happened — lib/capacity measures clean
// duration per market and bedroom count and each person's real day — this strip is where the
// answer finally faces the person deciding. One line; the moves live behind the chevron.
function CapacityStrip({ cap, roster, onRefresh, onPeople }: { cap: CapData | null; roster: Roster[]; onRefresh: () => void; onPeople: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [filed, setFiled] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const k = cap?.kpi
  if (!cap || !k || !cap.ok) return null
  const load = k.workMinutes + k.travelMinutes
  const over = k.utilisationPct > 100
  const warm = !over && k.utilisationPct >= 85
  const tone = over ? 'border-rose-200 bg-rose-50' : warm ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
  const toneText = over ? 'text-rose-800' : warm ? 'text-amber-900' : 'text-emerald-900'
  const sugs = (cap.suggestions || []).slice(0, 6)

  const file = async (s: CapSug) => {
    // The model recommends; a person commits. Assign-kind moves file through the same endpoint
    // every other assign on this page uses. Move-kind stays a recommendation — moving a task
    // between people mid-day is a conversation, not a click.
    const hit = matchRoster(roster, s.toPerson)
    if (!hit.ok) { setErr(hit.reason); return }
    setBusy(s.stopId + s.toPerson); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: s.stopId, assigneeIds: [hit.id] }) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'failed')
      setFiled(f => ({ ...f, [s.stopId]: true }))
      onRefresh()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

  return (
    <div className={'mb-3 rounded-xl border ' + tone}>
      <button onClick={() => setOpen(o => !o)} className="w-full px-3 py-2 flex items-center gap-2 flex-wrap text-left">
        <span className={'text-[12.5px] font-bold ' + toneText}>
          {fmtH(load)} of work on {k.peopleOnShift} {k.peopleOnShift === 1 ? 'person' : 'people'} ≈ {fmtH(k.capacityMinutes)} capacity — {k.utilisationPct}% loaded
        </span>
        <span className={'text-[11.5px] ' + toneText + ' opacity-80'}>
          {k.overloaded > 0 && <>· <b>{k.overloaded} over</b> </>}
          {k.underloaded > 0 && <>· {k.underloaded} light </>}
          {k.unassignedCount > 0 && <>· <b>{k.unassignedCount} unowned</b> </>}
          {k.closedOutToday > 0 && <>· {k.closedOutToday} closed-out </>}
        </span>
        <span className={'ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold ' + toneText}>
          {sugs.length > 0 ? sugs.length + (sugs.length === 1 ? ' move' : ' moves') : 'balanced'}
          <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </span>
      </button>
      {open && (
        <div className="border-t border-line/60 bg-white/60 rounded-b-xl px-3 py-2 space-y-1.5">
          {sugs.length === 0 && <p className="text-[12px] text-muted py-1">Nothing worth moving — the day is spread as well as the model can see.</p>}
          {sugs.map(s => (
            <div key={s.stopId + s.toPerson} className="flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-bold text-ink">{s.unit}</span>
              <span className="text-muted">→ {s.toPerson}</span>
              <span className="text-muted tabular-nums">{s.toBeforePct}%→{s.toAfterPct}%</span>
              <span className="text-muted flex-1 min-w-[140px]">{s.why}</span>
              {s.kind === 'assign' ? (
                filed[s.stopId] ? (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-700"><Check size={12} /> assigned</span>
                ) : (
                  <button onClick={() => file(s)} disabled={busy === s.stopId + s.toPerson}
                    className="text-[11.5px] font-bold px-2.5 py-1 rounded-lg bg-ink text-white disabled:opacity-50 inline-flex items-center gap-1">
                    {busy === s.stopId + s.toPerson ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                    Assign · {s.toPerson.split(' ')[0]}
                  </button>
                )
              ) : (
                <button onClick={onPeople} className="text-[11.5px] font-semibold text-muted border border-line rounded-lg px-2 py-1 hover:text-ink">
                  from {s.fromPerson ? s.fromPerson.split(' ')[0] : '—'} · view lanes
                </button>
              )}
            </div>
          ))}
          {err && <p className="text-[11.5px] text-rose-600 font-semibold">{err}</p>}
          {Array.isArray(cap.notes) && cap.notes.length > 0 && (
            <p className="text-[11px] text-muted pt-1">{cap.notes.join(' · ')}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── PEOPLE: the missing axis ───────────────────────────────────────────────────────────────────
// One lane per person on today: their queue from the board's own tasks, a done/total bar, and —
// for anyone idle — the open unassigned work pushed to them in one tap. Load is measured in TASKS,
// not invented minutes: we do not have predicted durations, and a bar built on made-up numbers
// would be read as truth. (Optii earns its minutes with an ML model; until we have one, count.)
function PeopleTab({ staff, units, roster, onRefresh, cap }: { staff: Staffing | null; units: Unit[]; roster: Roster[]; onRefresh: () => void; cap: CapData | null }) {
  const [busyKey, setBusyKey] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})
  const allTasks = useMemo(() => units.flatMap(u => u.tasks.map(t => ({ ...t, unit: u.unit }))), [units])
  const unassignedOpen = useMemo(() =>
    allTasks.filter(t => !t.done && !t.guestyOnly && t.assignees.length === 0)
      .sort((a, b) => (a.type === 'departure_clean' ? 0 : 1) - (b.type === 'departure_clean' ? 0 : 1)),
    [allTasks])

  const lanes = useMemo(() => {
    const people = staff?.people || []
    return people.map(p => {
      const mine = allTasks.filter(t => t.assignees.some(a => samePerson(a, p.bzAlias || p.name) || samePerson(a, p.name)))
      const done = mine.filter(t => t.done).length
      return { p, mine, done }
    }).sort((a, b) => (a.p.clockedIn ? 0 : 1) - (b.p.clockedIn ? 0 : 1) || (a.mine.length === 0 ? 0 : 1) - (b.mine.length === 0 ? 0 : 1))
  }, [staff, allTasks])

  const pushTo = async (person: StaffPerson, task: Task & { unit: string }) => {
    const m = matchRoster(roster, person.bzAlias || person.name)
    if (!m.ok) { setErr(e => ({ ...e, [person.name]: m.reason })); return }
    const rid = m.id
    setBusyKey(person.name + task.id); setErr(e => ({ ...e, [person.name]: '' }))
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, assigneeIds: [rid] }) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'failed')
      onRefresh()
    } catch (e: any) { setErr(x => ({ ...x, [person.name]: String(e?.message || e) })) }
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
        // The model's pricing of this person's day, when it knows them. Matched by name the same
        // loose way lanes match tasks — both sides ultimately come from Homebase names.
        const price = (cap?.people || []).find(c => samePerson(c.person, p.name) || samePerson(c.person, p.bzAlias)) || null
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
                {/* The model excludes a person whose day is credited with more than a day can hold
                    (tasks closed out on the team's behalf) — printing "0% · room for 3 more cleans"
                    for someone holding 22 tasks was the strip's most-noticed lie (2026-09-02). */}
                {price && price.verdict === 'implausible' && (
                  <span className="block text-[11px] font-semibold text-muted">not priced — {mine.length} tasks is more than a day holds; likely closed out on the team&rsquo;s behalf</span>
                )}
                {price && price.verdict !== 'implausible' && price.capacityMinutes > 0 && (
                  <span className={'block text-[11px] font-semibold ' + (price.utilisationPct > 100 ? 'text-rose-700' : price.utilisationPct >= 85 ? 'text-amber-700' : 'text-emerald-700')}>
                    ≈ {fmtH(price.loadMinutes)} of {fmtH(price.capacityMinutes)} · {price.utilisationPct}%
                    {price.travelMinutes > 0 ? ' · ' + fmtH(price.travelMinutes) + ' travel' : ''}
                    {price.utilisationPct > 100 ? ' · over' : price.headroomCleans > 0 ? ' · room for ' + price.headroomCleans + ' more clean' + (price.headroomCleans === 1 ? '' : 's') : ' · full'}
                  </span>
                )}
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
                {err[p.name] && <span className="w-full text-[11.5px] text-rose-600 font-semibold">{err[p.name]}</span>}
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
type BzTpl = { id: number; name: string; department: string; description: string }

function AddTaskSheet({ roster, onClose, onDone, initialQuery }: { roster: Roster[]; onClose: () => void; onDone: () => void; initialQuery?: string }) {
  const [listings, setListings] = useState<Listing[]>([])
  const [uq, setUq] = useState(initialQuery || '')
  const [unit, setUnit] = useState<Listing | null>(null)
  const [tpl, setTpl] = useState('custom')
  // OUR templates, live from Breezeway (Jon, 2026-08-25). The seven presets below stay as the
  // fallback and as the quick path, but the preventative-maintenance template, the field report and
  // the inspection checklists are edited in Breezeway by the people who run the work — so the sheet
  // reads them rather than keeping a stale copy in this repo. Picking one sends template_id, which
  // is what puts the actual checklist in front of whoever opens the task in the field app.
  const [bzTpls, setBzTpls] = useState<BzTpl[]>([])
  const [tplId, setTplId] = useState<number | null>(null)
  const [tplQ, setTplQ] = useState('')
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
    fetch('/api/breezeway/templates', { cache: 'no-store' }).then(r => r.json())
      .then(j => setBzTpls(Array.isArray(j.templates) ? j.templates : [])).catch(() => {})
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
    setTpl(k); setTplId(null); setTitle(t.title); setDept(t.department); setPrio(t.priority)
    let body = t.base
    if (t.useIntel && intel) {
      const cl = intel.checklist || []
      if (cl.length) body += '\n\nLook specifically at (from this unit’s recent guest feedback):\n' + cl.map(c => '- ' + c).join('\n')
      const lf = intel.lastFeedback
      if (lf && lf.excerpt) body += '\n\nLast guest feedback' + (lf.rating ? ' (' + lf.rating + '★)' : '') + ': “' + String(lf.excerpt).slice(0, 240) + '”'
    }
    setDesc(body)
  }

  /** Pick a real Breezeway template: its checklist travels with the task, so the description here
      is context for the person opening it, not a re-typing of the checklist. */
  const useBzTpl = (t: BzTpl) => {
    setTpl('bz:' + t.id); setTplId(t.id); setTitle(t.name)
    if (t.department) setDept(t.department)
    let body = t.description || ''
    if (intel) {
      const cl = intel.checklist || []
      if (cl.length) body += (body ? '\n\n' : '') + 'Look specifically at (from this unit\u2019s recent guest feedback):\n' + cl.map(c => '- ' + c).join('\n')
    }
    setDesc(body)
  }

  const bzHits = useMemo(() => {
    const n = tplQ.trim().toLowerCase()
    const pool = bzTpls.filter(t => !n || (t.name + ' ' + t.department).toLowerCase().includes(n))
    return n ? pool.slice(0, 24) : pool.slice(0, 12)
  }, [bzTpls, tplQ])

  const create = async () => {
    if (!unit || !title.trim()) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: unit.id, title: title.trim(), department: dept, priority: prio, description: desc, date: date || undefined, assigneeIds: picked, templateId: tplId || undefined }),
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
            {bzTpls.length > 0 && (
              <>
                <div className="flex items-baseline gap-2 mt-4 mb-1.5">
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Our Breezeway templates</p>
                  <span className="text-[10.5px] text-muted">&middot; the crew gets the real checklist</span>
                  {bzTpls.length > 12 && (
                    <input value={tplQ} onChange={e => setTplQ(e.target.value)} placeholder="filter&hellip;"
                      className="ml-auto w-28 rounded-lg border border-line px-2 py-1 text-[11px]" />
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {bzHits.map(t => (
                    <button key={t.id} onClick={() => useBzTpl(t)}
                      className={'px-3 py-2 rounded-xl border-2 text-left max-w-full ' + (tplId === t.id ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-ink hover:border-brand-500/50')}>
                      <span className="block text-[12.5px] font-bold leading-tight truncate">{t.name}</span>
                      <span className={'block text-[10px] ' + (tplId === t.id ? 'text-white/70' : 'text-muted')}>{t.department || 'Breezeway template'}</span>
                    </button>
                  ))}
                  {tplQ && bzHits.length === 0 && <span className="text-[11.5px] text-muted py-2">No template matches &ldquo;{tplQ}&rdquo;.</span>}
                </div>
              </>
            )}

            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mt-4 mb-1.5">
              {bzTpls.length > 0 ? 'Or a quick preset' : 'What kind of work'}
            </p>
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

            {tplId != null && (
              <p className="text-[11px] text-muted mt-2">Files with the Breezeway template attached &mdash; whoever opens it in the field app gets that checklist.</p>
            )}
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

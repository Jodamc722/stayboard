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
  Plus, ChevronDown, Users, Send, X, Loader2, Check, FileText, ChevronLeft, ChevronRight, CalendarDays,
} from 'lucide-react'
import { OpsGrid } from '@/components/OpsGrid'
import { useModal } from '@/components/Modal'
import { useCachedFetch } from '@/lib/swr'
import { matchRoster } from '@/lib/roster-match'
import { AddTaskSheet } from '@/components/AddTaskSheet'


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
type Listing = { id: string; nickname?: string | null; title?: string | null; building?: string | null; status?: string | null }

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
  // THE BOARD'S DATE, NOT TODAY'S (2026-09-09 audit). The route has taken ?date= since it was
  // written and the client never sent one, so planning tomorrow was done against today's clock-ins.
  const { data: staff, error: staffErr } = useCachedFetch<Staffing>(
    isToday ? '/api/ops-today/staffing' : `/api/ops-today/staffing?date=${date}`)
  // The capacity model prices the same day the board is showing — today or a planned date.
  const { data: cap } = useCachedFetch<CapData>(
    isToday ? '/api/capacity' : `/api/capacity?date=${date}`, { ttl: 5 * 60_000 })
  // THE ROSTER IS THE SAME LIST ALL DAY (2026-09-14, the tab-by-tab walk). This was an uncached
  // `no-store` fetch fired on every mount, while every other read on this page goes through the
  // 30s cache — and CapacityPanel on the Scheduler fired the identical request again on its own.
  // Ten minutes, through the shared cache, so the second mount is free.
  const { data: rosterRes } = useCachedFetch<{ people: Roster[] }>('/api/breezeway/people', { ttl: 10 * 60_000 })
  const roster = useMemo<Roster[]>(() => (Array.isArray(rosterRes?.people) ? rosterRes!.people : []), [rosterRes])
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
  // ONE VIEW (2026-09-09). The Staffing tab is retired; ?tab=people from the Command Center, and a
  // stored choice from the old tab, both deep-link the Grid onto its People axis instead.
  const [wantPeople, setWantPeople] = useState(false)
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('tab')
      // A LINK IS A VISIT, NOT A PREFERENCE. Writing the stored mode here meant one click on the
      // Command Center's "lanes" link changed which axis the board opened on every morning after.
      if (q === 'people') { setWantPeople(true); return }
      // Anybody whose remembered choice was the old Staffing tab lands on the People axis once.
      const t = localStorage.getItem('opsv2_tab_v2')
      if (t === 'people') { setWantPeople(true); try { localStorage.setItem('opsgrid_mode', 'people'); localStorage.removeItem('opsv2_tab_v2') } catch {} }
    } catch {}
  }, [])
  // "View lanes" from the crew chip now means: the Grid, on the People axis.
  const pick = () => { setWantPeople(true); window.setTimeout(() => setWantPeople(false), 120) }

  // null = closed; '' = open blank; a unit name = open with that unit pre-searched (the "+ Task"
  // button on a Needs-a-human row lands you one keystroke from filing, not five).
  const [addFor, setAddForRaw] = useState<string | null>(null)
  // ONE SHEET AT A TIME. `sheet` is the single owner of what is open over the board; opening one
  // closes the other rather than stacking on it.
  const [sheet, setSheet] = useState<'add' | 'plan' | null>(null)
  const setAddFor = (v: string | null) => { setAddForRaw(v); setSheet(v === null ? null : 'add') }
  const onSheet = (s: 'add' | 'plan' | null) => { setSheet(s); if (s !== 'add') setAddForRaw(null) }

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
      {/* ── ONE ROW OF CHROME (2026-09-09 audit) ─────────────────────────────────────────────
          The Staffing tab is gone: it and the Grid's People axis were the same crew twice, and
          under a market filter they contradicted each other about who was free. `?tab=people` and
          the old stored choice now deep-link the Grid onto its People axis, so nothing breaks. */}
      <div className="flex items-end gap-2 mb-2 sm:mb-3">
        <div className="flex-1" />
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

      {/* The crew line rides on the grid's day line (one strip: clock · cleans · crew). On the
          Staffing tab it stands alone, in full, because staffing IS the question there. */}
      <OpsGrid data={data as any} glitches={glitches as any} roster={roster} staff={staff as any}
          loading={loading} error={error ? String(error) : null}
          onRefresh={refresh} onAddTask={u => setAddFor(u)} openSheet={sheet} onSheet={onSheet} boardDate={date} cap={cap || null}
          wantPeople={wantPeople} staffErr={staffErr ? String(staffErr) : null}
          aside={<CapacityStrip cap={cap || null} roster={roster} onRefresh={refresh} onPeople={pick} compact />} />

      {sheet === 'add' && addFor !== null && <AddTaskSheet roster={roster} initialQuery={addFor} boardDate={date} onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); refresh() }} />}
    </div>
  )
}

// ── THE DAY IN ONE SENTENCE (Jon, 2026-08-31: "we need AI to learn how many tasks are doable,
// how long things should take"). The learning already happened — lib/capacity measures clean
// duration per market and bedroom count and each person's real day — this strip is where the
// answer finally faces the person deciding. One line; the moves live behind the chevron.
// The Turnover Schedule's door to the same strip. Self-feeding, with its own ‹ date › pager —
// the Scheduler plans TOMORROW, and "does Thursday fit the people we have on Thursday" is
// exactly the question the model answers. Mount with <CapacityPanel pager />.
export function CapacityPanel({ pager }: { pager?: boolean }) {
  const todayYmd = ymdET(new Date())
  const [date, setDate] = useState(todayYmd)
  const isToday = date === todayYmd
  const { data: cap, refresh } = useCachedFetch<CapData>(
    isToday ? '/api/capacity' : `/api/capacity?date=${date}`, { ttl: 5 * 60_000 })
  // THE ROSTER IS THE SAME LIST ALL DAY (2026-09-14, the tab-by-tab walk). This was an uncached
  // `no-store` fetch fired on every mount, while every other read on this page goes through the
  // 30s cache — and CapacityPanel on the Scheduler fired the identical request again on its own.
  // Ten minutes, through the shared cache, so the second mount is free.
  const { data: rosterRes } = useCachedFetch<{ people: Roster[] }>('/api/breezeway/people', { ttl: 10 * 60_000 })
  const roster = useMemo<Roster[]>(() => (Array.isArray(rosterRes?.people) ? rosterRes!.people : []), [rosterRes])
  const strip = <CapacityStrip cap={cap || null} roster={roster} onRefresh={refresh} onPeople={() => { window.location.href = '/plan' }} />
  if (!pager) return strip
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[11px] uppercase tracking-wide font-semibold text-muted">
          Can {isToday ? 'today' : new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })} hold its plan?
        </span>
        <span className="ml-auto inline-flex items-center rounded-lg border border-line bg-white overflow-hidden">
          <button onClick={() => setDate(d => shiftYmd(d, -1))} className="px-1.5 py-1 text-muted hover:text-ink hover:bg-app" title="Previous day"><ChevronLeft size={12} /></button>
          {!isToday && <button onClick={() => setDate(todayYmd)} className="px-2 py-1 text-[11px] font-bold text-brand-700 hover:bg-brand-50 border-x border-line">Today</button>}
          <button onClick={() => setDate(d => shiftYmd(d, 1))} className="px-1.5 py-1 text-muted hover:text-ink hover:bg-app" title="Next day"><ChevronRight size={12} /></button>
        </span>
      </div>
      {strip}
    </div>
  )
}

function CapacityStrip({ cap, roster, onRefresh, onPeople, compact }: { cap: CapData | null; roster: Roster[]; onRefresh: () => void; onPeople: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(true)
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

  const moves = (
    <div className={compact ? 'px-3 py-2 space-y-1.5' : 'border-t border-line/60 bg-white/60 rounded-b-xl px-3 py-2 space-y-1.5'}>
      {compact && <p className={'text-[12px] font-bold ' + toneText}>{fmtH(load)} of work on {k.peopleOnShift} {k.peopleOnShift === 1 ? 'person' : 'people'} ≈ {fmtH(k.capacityMinutes)} capacity</p>}
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
  )

  // COMPACT (2026-09-09): one chip on the day line — "crew 88% · 5 over · 3 moves" — with the
  // moves in a popover, so the capacity model costs no band of its own above the board.
  if (compact) {
    // The panel opens toward whichever side has room — the chip can sit at the far left (no cleans
    // on the board) or wrap onto a new line on a phone, and a right-anchored 480px panel would then
    // hang off the left edge of the page.
    const chipTone = over ? 'border-rose-300 bg-rose-100 text-rose-800' : warm ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-emerald-300 bg-emerald-100 text-emerald-900'
    return (
      <span className="relative inline-flex">
        <button onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setAlignRight(r.left + 480 > window.innerWidth); setOpen(o => !o) }} aria-expanded={open} title={fmtH(load) + ' of work on ' + k.peopleOnShift + ' people ≈ ' + fmtH(k.capacityMinutes) + ' capacity'}
          className={'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ' + chipTone}>
          <Users size={11} /> crew {k.utilisationPct}%
          {k.overloaded > 0 && <span className="opacity-80">· {k.overloaded} over</span>}
          {k.unassignedCount > 0 && <span className="opacity-80">· {k.unassignedCount} unowned</span>}
          <span className="opacity-80">· {sugs.length ? sugs.length + (sugs.length === 1 ? ' move' : ' moves') : 'balanced'}</span>
          <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
        {open && (
          <>
            <span className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
            <span className={'absolute top-full mt-1 z-30 w-[min(480px,calc(100vw-2rem))] rounded-xl border border-line bg-white shadow-xl text-left ' + (alignRight ? 'right-0' : 'left-0')}>{moves}</span>
          </>
        )}
      </span>
    )
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
      {open && moves}
    </div>
  )
}

// PeopleTab lived here until 2026-09-09. Retired with the Staffing tab: it and the Grid's People
// axis were the same question answered twice, in two visual languages, and under a market filter
// they disagreed about who was free. The capacity sentence it existed to show now rides on the
// People rows themselves (components/OpsGrid).

// ── ADD TASK ───────────────────────────────────────────────────────────────────────────────────
// The sheet moved to components/AddTaskSheet on 2026-09-14 (Jon: "add a way to add a task easy,
// should feel like breezeway"). It lived here, which meant it existed on this page and nowhere
// else in the app; it is mounted once in the shell now and opens from any screen. This page keeps
// its own button because Add task belongs beside the board, and hands the sheet the roster it
// already has plus the day the board is showing — filing tomorrow's task onto today is a wasted
// trip.

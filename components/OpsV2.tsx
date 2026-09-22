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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Plus, ChevronDown, Users, Send, Loader2, Check, FileText, ChevronLeft, ChevronRight, CalendarDays, ClipboardList,
} from 'lucide-react'
import { Pill, Tag, IconBtn, Tip } from '@/components/lean'
import { OpsGrid } from '@/components/OpsGrid'
import { useModal } from '@/components/Modal'
import { useCachedFetch } from '@/lib/swr'
import { matchRoster } from '@/lib/roster-match'
import { AddTaskSheet, type AddTaskSeed } from '@/components/AddTaskSheet'


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

export function OpsV2({ unitsFooter, peopleFooter }: { unitsFooter?: ReactNode; peopleFooter?: ReactNode } = {}) {
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
  const [addFor, setAddForRaw] = useState<AddTaskSeed | null>(null)
  // ONE SHEET AT A TIME. `sheet` is the single owner of what is open over the board; opening one
  // closes the other rather than stacking on it.
  const [sheet, setSheet] = useState<'add' | 'plan' | null>(null)
  const setAddFor = (v: AddTaskSeed | null) => { setAddForRaw(v); setSheet(v === null ? null : 'add') }
  const onSheet = (s: 'add' | 'plan' | null) => { setSheet(s); if (s !== 'add') setAddForRaw(null) }

  const glitches: Glitch[] = (gl && Array.isArray(gl.glitches)) ? gl.glitches : []

  return (
    <div>
      {/* ── ONE ROW OF CHROME. The board IS the board (Jon, 2026-08-17: "the Board tab is a mess");
          this layer only adds the header and Add task, which must never wrap off the right edge.
          The Staffing tab is gone (2026-09-09): `?tab=people` and the old stored choice deep-link
          the Grid onto its People axis, so nothing breaks. */}
      {/* LEAN PASS (2026-09-22): the page title joins this row, so title · day sheet · day pager ·
          Add task are ONE line. The title hides on a phone (the app bar already says "Today in
          Ops"); Add task stays pinned right at every width — it is the primary action here. */}
      <div className="flex items-center gap-2 mb-2 sm:mb-3">
        <h1 className="hidden sm:inline-flex text-2xl font-bold text-ink tracking-tight items-center gap-2 mr-auto"><ClipboardList size={18} className="text-brand-600" /> Today in Ops</h1>
        <div className="flex-1 sm:hidden" />
        <IconBtn title="Printable day sheet" href="/plan/print"><FileText size={15} /></IconBtn>
        {/* ── THE DAY ── on a normal morning it is two chevrons; off today the date shows in the
            pager AND as a pill below, because a board silently showing tomorrow is worse than one
            that cannot show tomorrow at all. */}
        <div className="shrink-0 inline-flex items-center rounded-lg border border-line bg-white h-8">
          <Tip label="Previous day">
            <button onClick={() => setDate(d => shiftYmd(d, -1))} aria-label="Previous day"
              className="px-1.5 h-8 text-muted hover:text-ink hover:bg-app rounded-l-lg"><ChevronLeft size={14} /></button>
          </Tip>
          {/* A REAL DATE PICKER (Jon, 2026-09-22: "It also should have a date selector so we can choose
              different dates and see all of the activities from there"). The chevrons step a day;
              the calendar jumps anywhere. */}
          <Tip label="Pick a day">
            <input type="date" value={date} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDate(e.target.value) }}
              aria-label="Board date"
              className={'h-8 border-x border-line bg-transparent px-1.5 text-[12.5px] font-semibold tabular-nums focus:outline-none ' + (isToday ? 'text-ink' : 'text-brand-700')} />
          </Tip>
          <Tip label="Next day">
            <button onClick={() => setDate(d => shiftYmd(d, 1))} aria-label="Next day"
              className="px-1.5 h-8 text-muted hover:text-ink hover:bg-app rounded-r-lg"><ChevronRight size={14} /></button>
          </Tip>
        </div>
        <button onClick={() => setAddFor({})}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 h-8 text-[13px] font-bold hover:opacity-90">
          <Plus size={14} /> Add task
        </button>
      </div>

      {!isToday && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <Pill tone="brand" title="The board is showing another day">
            <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} · not today</span>
          </Pill>
          <button onClick={() => setDate(todayYmd)} className="text-[12px] font-bold text-brand-700 hover:underline">Back to today</button>
        </div>
      )}

      {/* The crew line rides on the grid's day line (one strip: clock · cleans · crew). On the
          Staffing tab it stands alone, in full, because staffing IS the question there. */}
      <OpsGrid data={data as any} glitches={glitches as any} roster={roster} staff={staff as any}
          loading={loading} error={error ? String(error) : null}
          onRefresh={refresh} onAddTask={seed => setAddFor(seed)} openSheet={sheet} onSheet={onSheet} boardDate={date} cap={cap || null}
          wantPeople={wantPeople} staffErr={staffErr ? String(staffErr) : null}
          aside={<CapacityStrip cap={cap || null} roster={roster} onRefresh={refresh} onPeople={pick} compact />}
          unitsFooter={unitsFooter} peopleFooter={peopleFooter} />

      {sheet === 'add' && addFor !== null && (
        // Keyed on the seed so a ＋ on a different row remounts the sheet for THAT row rather than
        // reopening on whatever the last one left behind.
        <AddTaskSheet key={JSON.stringify(addFor)} roster={roster} seed={addFor} boardDate={date}
          onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); refresh() }} />
      )}
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
  // LEAN PASS (2026-09-22): the "Can today hold its plan?" eyebrow became the strip's own day tag,
  // and the pager rides at the right end of the same line.
  const dayLabel = isToday ? 'Today' : new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const pagerEl = !pager ? null : (
    <span className="inline-flex items-center rounded-lg border border-line bg-white" onClick={e => e.stopPropagation()}>
      <Tip label="Previous day"><button onClick={() => setDate(d => shiftYmd(d, -1))} aria-label="Previous day" className="px-1.5 py-1 text-muted hover:text-ink hover:bg-app rounded-l-lg"><ChevronLeft size={12} /></button></Tip>
      {!isToday && <Tip label="Back to today"><button onClick={() => setDate(todayYmd)} className="px-2 py-1 text-[11px] font-bold text-brand-700 hover:bg-brand-50 border-x border-line">Today</button></Tip>}
      <Tip label="Next day"><button onClick={() => setDate(d => shiftYmd(d, 1))} aria-label="Next day" className="px-1.5 py-1 text-muted hover:text-ink hover:bg-app rounded-r-lg"><ChevronRight size={12} /></button></Tip>
    </span>
  )
  const strip = <CapacityStrip cap={cap || null} roster={roster} onRefresh={refresh} onPeople={() => { window.location.href = '/plan' }} dayLabel={pager ? dayLabel : undefined} pager={pagerEl} />
  return strip
}

function CapacityStrip({ cap, roster, onRefresh, onPeople, compact, dayLabel, pager }: { cap: CapData | null; roster: Roster[]; onRefresh: () => void; onPeople: () => void; compact?: boolean; dayLabel?: string; pager?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(true)
  const [busy, setBusy] = useState('')
  const [filed, setFiled] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const k = cap?.kpi
  // No model for this day: keep the pager so a planner can step back off a day that failed to price.
  if (!cap || !k || !cap.ok) return pager ? <div className="mb-3 flex items-center gap-2 text-[12px] text-muted">{dayLabel && <Tag>{dayLabel}</Tag>} no capacity read yet <span className="ml-auto">{pager}</span></div> : null
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
      {sugs.length === 0 && <p className="text-[12px] text-muted py-1">Nothing worth moving.</p>}
      {sugs.map(s => (
        <div key={s.stopId + s.toPerson} className="flex items-center gap-1.5 flex-wrap text-[12px]">
          <span className="font-bold text-ink">{s.unit}</span>
          <span className="text-muted">→ {s.toPerson}</span>
          <Tag title={s.toPerson + "'s load before and after this move"}>{s.toBeforePct}%→{s.toAfterPct}%</Tag>
          <span title={s.why} className="text-muted flex-1 min-w-[120px] truncate">{s.why}</span>
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

  // ONE LINE (lean pass): "Crew 88%" + tags; the sentence is the hover; moves open underneath.
  const sentence = fmtH(load) + ' of work on ' + k.peopleOnShift + ' ' + (k.peopleOnShift === 1 ? 'person' : 'people') + ' ≈ ' + fmtH(k.capacityMinutes) + ' capacity — ' + k.utilisationPct + '% loaded'
  return (
    <div className={'mb-3 rounded-xl border ' + tone}>
      <div className="px-3 py-1.5 flex items-center gap-2">
        <button onClick={() => setOpen(o => !o)} title={sentence} aria-expanded={open} className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap text-left">
          {dayLabel && <Tag>{dayLabel}</Tag>}
          <span className={'text-[12.5px] font-bold inline-flex items-center gap-1 ' + toneText}><Users size={12} /> Crew {k.utilisationPct}%</span>
          <span className={'text-[11.5px] ' + toneText + ' opacity-80'}>{fmtH(load)} / {fmtH(k.capacityMinutes)}</span>
          {k.overloaded > 0 && <Tag tone="rose" title="People loaded past their capacity">{k.overloaded} over</Tag>}
          {k.underloaded > 0 && <Tag title="People with room for more">{k.underloaded} light</Tag>}
          {k.unassignedCount > 0 && <Tag tone="amber" title="Cleans and tasks nobody is on">{k.unassignedCount} unowned</Tag>}
          {k.closedOutToday > 0 && <Tag title="Tasks closed out today">{k.closedOutToday} closed-out</Tag>}
          <span className={'ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold ' + toneText}>
            {sugs.length > 0 ? sugs.length + (sugs.length === 1 ? ' move' : ' moves') : 'balanced'}
            <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </span>
        </button>
        {pager}
      </div>
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

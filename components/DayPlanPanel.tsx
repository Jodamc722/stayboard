'use client'
// PLAN THE DAY.
//
// Jon, 2026-08-27: "need the AI systems to help assign or build tasks to ensure we give the team a
// full and directional day."
//
// The board already answers "who should take THIS one?" well — that is the assign panel. What it
// could not answer is the question a coordinator actually has at 7am: given everything nobody owns
// and everybody who owns nothing, what does the whole day look like? Answering that fourteen times
// in a row, one task at a time, is how one cleaner ends up with six jobs and another with none —
// not one bad decision, fourteen locally-good ones.
//
// So this reads the board that is already on screen (no refetch, no second source of truth), runs
// the planner, and shows the result the way a supervisor will drive it: PER PERSON, with the shape
// of each day in a sentence. Work it could not place is listed with the reason. People it could not
// use are named. Nothing is hidden to make the plan look tidier than it is.
//
// IT APPLIES NOTHING UNTIL SOMEBODY PRESSES A BUTTON, and every line has a checkbox. Jon's standing
// rule from the suggestion engine — "we can't have 200 tasks just auto populate" — matters more
// here, because these are real jobs with real names going onto them.
import { useMemo, useState } from 'react'
import { X, Wand2, Loader2, Check, AlertTriangle, MapPin, Users, ArrowRight } from 'lucide-react'
import { planDay, type PlanTask, type PlanUnitRow, type Assignment } from '@/lib/day-plan'
import type { GUnit, GRoster, GStaff } from '@/components/OpsGrid'

const PROX: Record<Assignment['proximity'], { label: string; cls: string }> = {
  unit:     { label: 'in the unit',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  building: { label: 'in the building', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  area:     { label: 'in the area',     cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  // Not a warning — most maintenance work is nowhere near anybody, and painting every one of
  // those rows amber makes the block that IS a warning (nothing placed) stop reading as one.
  none:     { label: 'not nearby',      cls: 'bg-white text-muted border-line' },
}

export function DayPlanPanel({ units, roster, staff, today, onClose, onApplied }: {
  units: GUnit[]
  roster: GRoster[]
  staff?: GStaff | null
  today: string
  onClose: () => void
  onApplied: () => void
}) {
  const [maxPer, setMaxPer] = useState(6)
  const [onlyScheduled, setOnlyScheduled] = useState(true)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<{ n: number; of: number } | null>(null)

  const people = staff?.people || []
  const clockedIn = useMemo(() => people.filter(p => p.clockedIn).map(p => p.name), [people])
  const onShift = useMemo(() => people.filter(p => p.shift || p.clockedIn).map(p => p.name), [people])

  // ── WHAT COUNTS AS UNPLACED WORK ──────────────────────────────────────────────────────────────
  // Open, nobody's name on it, and real. Guesty-only rows are calendar shadows, not tasks; a task
  // already finished obviously needs nobody. Anything already applied in this session drops out so
  // a second look at the plan does not propose it twice.
  const planTasks: PlanTask[] = useMemo(() => {
    const out: PlanTask[] = []
    for (const u of units) {
      if (u.guestyOnly) continue
      for (const t of u.tasks) {
        if (t.done || t.guestyOnly) continue
        if ((t.assignees || []).length) continue
        if (doneIds.has(t.id)) continue
        out.push({
          id: t.id, name: t.name, unit: u.unit, listingId: u.listingId,
          building: u.building, market: u.market, dept: t.dept,
          late: !!t.late, atRisk: !!t.atRisk, sameDayTurn: !!u.sameDayTurn,
          isClean: /clean/i.test(t.name) || /housekeep/i.test(t.dept),
        })
      }
    }
    return out
  }, [units, doneIds])

  const planUnits: PlanUnitRow[] = useMemo(() => units.map(u => ({
    listingId: u.listingId, building: u.building, market: u.market,
    tasks: u.tasks.map(t => ({ assignees: t.assignees || [], done: !!t.done })),
  })), [units])

  const plan = useMemo(() => planDay({
    unassigned: planTasks, units: planUnits,
    roster: roster.map(r => ({ id: r.id, name: r.name, departments: r.departments })),
    clockedIn, onShift, options: { maxPerPerson: maxPer, onlyScheduled },
  }), [planTasks, planUnits, roster, clockedIn, onShift, maxPer, onlyScheduled])

  const chosen = plan.assignments.filter(a => !skip.has(a.taskId) && !doneIds.has(a.taskId))
  const toggle = (id: string) => setSkip(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // ── APPLY ─────────────────────────────────────────────────────────────────────────────────────
  // One at a time, against the same route the per-task assign uses. Sequential on purpose: a
  // half-applied plan where you cannot tell WHICH half landed is worse than a slow one, and the
  // per-row tick is the receipt.
  async function apply(list: Assignment[]) {
    if (!list.length || busy) return
    setBusy(true); setProgress({ n: 0, of: list.length })
    const ok = new Set(doneIds); const bad: Record<string, string> = { ...failed }
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      try {
        const r = await fetch('/api/breezeway/assign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: a.taskId, assigneeIds: [a.toId] }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || j?.error) throw new Error(j?.error || 'assign failed')
        ok.add(a.taskId); delete bad[a.taskId]
      } catch (e: any) {
        bad[a.taskId] = String(e?.message || e).slice(0, 120)
      }
      setProgress({ n: i + 1, of: list.length })
      setDoneIds(new Set(ok)); setFailed({ ...bad })
    }
    setBusy(false); setProgress(null)
    onApplied()
  }

  const nothingToDo = planTasks.length === 0

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[1px]" onClick={busy ? undefined : onClose} />
      <div className="fixed z-50 inset-x-0 bottom-0 sm:inset-0 sm:m-auto w-full sm:max-w-[760px] sm:h-fit sm:max-h-[86vh] max-h-[92vh]
                      rounded-t-2xl sm:rounded-2xl border border-line bg-white shadow-2xl flex flex-col overflow-hidden">

        {/* ── HEADER ── */}
        <div className="px-4 py-3 border-b border-line flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-ink inline-flex items-center gap-1.5">
              <Wand2 size={14} className="text-brand-500" /> Plan the day
            </p>
            <p className="text-[12px] text-muted mt-0.5">
              {nothingToDo
                ? 'Every open task on this board already has somebody on it.'
                : <>
                    <b className="text-ink">{plan.summary.placed}</b> of {plan.summary.unassignedBefore} unowned {plan.summary.unassignedBefore === 1 ? 'job' : 'jobs'} placed
                    {' '}across <b className="text-ink">{plan.summary.peopleUsed}</b> {plan.summary.peopleUsed === 1 ? 'person' : 'people'}
                    {plan.summary.onRoute > 0 && <> &middot; {plan.summary.onRoute} keep somebody in a building they are already working</>}
                  </>}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-muted hover:text-ink disabled:opacity-40 shrink-0 mt-0.5"><X size={16} /></button>
        </div>

        {/* ── THE TWO KNOBS THAT CHANGE THE ANSWER ── */}
        <div className="px-4 py-2 border-b border-line bg-app/60 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 border border-line rounded-lg px-2.5 py-1 bg-white text-[11.5px] text-muted">
            No more than
            <input type="number" min={1} max={20} value={maxPer} disabled={busy}
              onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) setMaxPer(Math.round(n)) }}
              className="w-[50px] rounded-md border border-line bg-white px-1.5 py-0.5 text-[12px] font-semibold text-ink tabular-nums" />
            jobs each
          </span>
          <label className="inline-flex items-center gap-1.5 border border-line rounded-lg px-2.5 py-1 bg-white text-[11.5px] text-muted cursor-pointer">
            <input type="checkbox" checked={onlyScheduled} disabled={busy} onChange={e => setOnlyScheduled(e.target.checked)} />
            Only people working today
          </label>
          <span className="text-[11px] text-muted ml-auto tabular-nums">{today}</span>
        </div>

        {/* ── THE PLAN ── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {nothingToDo && (
            <p className="text-[12.5px] text-muted py-6 text-center">Nothing to plan. Come back when the board has work nobody owns.</p>
          )}

          {plan.perPerson.map(p => {
            const rows = p.added.filter(a => !doneIds.has(a.taskId))
            const live = rows.filter(a => !skip.has(a.taskId))
            return (
              <div key={p.name} className="rounded-xl border border-line overflow-hidden">
                <div className="px-3 py-2 bg-app/70 border-b border-line flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] font-bold text-ink">{p.name}</span>
                  <span className="text-[11.5px] text-muted flex-1 min-w-[140px]">{p.shape}</span>
                  {live.length > 0 && (
                    <button onClick={() => apply(live)} disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 py-1 text-[11.5px] font-bold disabled:opacity-40 shrink-0">
                      Assign {live.length} <ArrowRight size={11} />
                    </button>
                  )}
                </div>
                <div className="divide-y divide-line">
                  {p.added.map(a => {
                    const applied = doneIds.has(a.taskId)
                    const err = failed[a.taskId]
                    const off = skip.has(a.taskId)
                    return (
                      <label key={a.taskId}
                        className={'flex items-start gap-2.5 px-3 py-2 ' + (applied ? 'bg-emerald-50/50' : off ? 'opacity-45' : 'hover:bg-app/40 cursor-pointer')}>
                        {applied
                          ? <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                          : <input type="checkbox" className="mt-0.5 shrink-0" checked={!off} disabled={busy} onChange={() => toggle(a.taskId)} />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] text-ink truncate">
                            {a.urgent && (
                              <span className="align-[1px] mr-1.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-rose-100 text-rose-700">Late</span>
                            )}
                            {a.task}
                          </span>
                          <span className="block text-[11px] text-muted truncate">
                            <MapPin size={9} className="inline -mt-0.5 mr-0.5" />{a.unit} &middot; {a.why}
                          </span>
                          {err && <span className="block text-[11px] text-rose-600 mt-0.5">Did not assign: {err}</span>}
                        </span>
                        <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ' + PROX[a.proximity].cls}>
                          {PROX[a.proximity].label}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* ── WHAT IT COULD NOT PLACE ──────────────────────────────────────────────────────
              Never silently dropped. A planner that quietly loses six cleans is worse than no
              planner, because the empty column reads as "handled". */}
          {plan.unplaced.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden">
              <p className="px-3 py-2 text-[12px] font-bold text-amber-900 inline-flex items-center gap-1.5">
                <AlertTriangle size={12} /> {plan.unplaced.length} still {plan.unplaced.length === 1 ? 'has' : 'have'} nobody
              </p>
              <div className="divide-y divide-amber-200/60">
                {plan.unplaced.slice(0, 40).map(u => (
                  <div key={u.taskId} className="px-3 py-1.5 flex items-baseline gap-2">
                    <span className="text-[12px] text-ink truncate flex-1">{u.task} <span className="text-muted">&middot; {u.unit}</span></span>
                    <span className="text-[11px] text-amber-800 shrink-0">{u.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The other half of "full": people the plan ends with nothing for. */}
          {plan.stillFree.length > 0 && (
            <p className="text-[11.5px] text-muted inline-flex items-start gap-1.5">
              <Users size={12} className="mt-0.5 shrink-0" />
              <span>Nothing for <b className="text-ink">{plan.stillFree.join(', ')}</b> — either the work is not near them, or their trade is not what is open.</span>
            </p>
          )}
        </div>

        {/* ── FOOTER ── */}
        {!nothingToDo && (
          <div className="px-4 py-2.5 border-t border-line bg-app/60 flex items-center gap-2">
            <p className="text-[11.5px] text-muted flex-1">
              {busy && progress
                ? `Assigning ${progress.n} of ${progress.of}…`
                : doneIds.size > 0
                  ? `${doneIds.size} assigned. Nothing else is applied until you press the button.`
                  : 'Nothing is applied until you press the button.'}
            </p>
            <button onClick={onClose} disabled={busy} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-muted hover:text-ink disabled:opacity-40">
              Close
            </button>
            <button onClick={() => apply(chosen)} disabled={busy || chosen.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3.5 py-1.5 text-[12.5px] font-bold disabled:opacity-40">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Assign all {chosen.length}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

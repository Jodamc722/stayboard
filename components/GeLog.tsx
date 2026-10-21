'use client'
// components/GeLog.tsx — THE GE LOG. The day's work read as the TEAM, not as a list of units.
//
// Jon, 2026-10-21, with the Google Sheet the office has kept by hand for years:
//   "build a tab in the scheduler page that allows team to have this view ... organized is whole
//    team separated by departments a then each market area and vendor as well"
//   "It should allow us to select any cleaner but should show who is scheduled for the day too."
//   "It pushes it to the assigned task in breezeway. The GE log is a reflection of tasks —
//    checkouts always have a task unless we block and move clean, but the GE log is where we can
//    document that."
//   "The goal is to see all task assigned, organized by department (We can also have a way to
//    organize it by team member like a full list). We should also have a glitches section as well
//    with pending field activities. From there they can be assigned and managed and will go to the
//    department section based on who the main first assignee is."
//
// WHAT MAKES THIS DIFFERENT FROM THE DAY BOARD. The day board answers "what has to be cleaned
// today" and sorts by building, so a person's day is scattered down it, a person with NOTHING on
// their day never appears, and work that is not a departure clean — the inspections, the repairs,
// the pending field activity behind a glitch — is not on it at all. This view answers the other
// question, the one the office kept a spreadsheet to answer: WHAT IS EACH OF MY PEOPLE DOING. So
// it starts from the roster and the full task list, not from the checkouts.
//
// IT IS NOT A SECOND SOURCE OF TRUTH. Every task comes from lib/team-schedule — the same builder
// behind /team and the public crew links, which already resolves Breezeway assignees against the
// market roster, drops unassigned vendor work and carries the long-stay / big-booking tags from
// the one place those thresholds are set. Glitches come from the glitch board. Assignment writes
// through /api/breezeway/assign and /api/glitches/action, which are the same endpoints the rest of
// the app uses. Nothing here is stored separately; a screen that kept its own copy of the day is
// exactly the spreadsheet we are replacing.
//
// ASSIGNMENT IS LIVE, NOT STAGED. On the day board a cleaner is staged and pushed in a batch,
// because planning a turnover day is a dozen decisions you want to review before the crew's phones
// light up. Here you are looking at one person's day and fixing it, so the pick goes straight to
// Breezeway and the row says so. Two different jobs, deliberately two behaviours.
//
// THE NOTE GOES TO BREEZEWAY. A row with a task opens the shared CommentThread pointed at it,
// which writes the comment the crew reads in the field. Rows without one — a glitch not yet
// pushed — take a note into the app's own thread, which is Jon's "the GE log is where we can
// document that": the exception is the thing most worth writing down.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, MessageSquare, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react'
import CleanerPicker, { sameRosterPerson, type Person as PickPerson } from './CleanerPicker'
import CommentThread from './CommentThread'

type Tag = { key: string; label: string; tone: 'amber' | 'violet' | 'emerald' | 'sky' }
type Job = {
  id: string; url: string; reportUrl: string | null; date: string; unit: string; listingId: string
  market: string; task: string; dept: string; status: 'done' | 'in progress' | 'scheduled'
  isClean: boolean; vendor: string | null; departure: boolean; tags: Tag[]
}
type SchedPerson = {
  name: string; dept: string; byDay: Record<string, Job[]>
  roster: Record<string, string>; clashes: Record<string, string>
  unrostered: boolean; daysWorked: number; daysOn: number; jobs: number; cleans: number
}
type MarketBlock = { market: string; people: SchedPerson[]; jobs: number; cleans: number }
type Sched = { from: string; to: string; markets: MarketBlock[]; partial?: boolean }

type Glitch = {
  id: number | string; unit: string | null; status: string; priority?: string | null
  overview?: string | null; category?: string | null; glitch_type?: string | null
  assignee?: string | null; assignee_person_id?: number | null
  breezeway_task_id?: string | number | null; task_status?: string | null
  due_date?: string | null; market?: string | null; created_at?: string | null
}

// Department order and labels mirror lib/crew.ts — housekeeping is the bulk of the day so it
// leads; 'other' is last, being the bucket for anyone nobody has filed yet.
const DEPT_ORDER = ['housekeeping', 'supervision', 'inspection', 'maintenance', 'ccs', 'other']
const DEPT_LABEL: Record<string, string> = {
  housekeeping: 'Housekeeping', supervision: 'Supervisors', inspection: 'Inspections',
  maintenance: 'Maintenance', ccs: 'CCS team', other: 'Other',
}
const deptKey = (d: string) => { const k = String(d || '').toLowerCase(); return DEPT_ORDER.indexOf(k) >= 0 ? k : 'other' }
const statusTone = (v: string) => {
  const s = String(v || '').toLowerCase()
  if (/req\s*off/.test(s)) return 'bg-rose-50 text-rose-700 border-rose-200'
  if (/on\s*call/.test(s)) return 'bg-amber-50 text-amber-800 border-amber-200'
  if (/off/.test(s)) return 'bg-neutral-100 text-neutral-500 border-neutral-200'
  if (/work/.test(s)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-white text-muted border-line'
}
const isOn = (v: string) => /work|on\s*call/i.test(String(v || ''))
const tagTone: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-800 border-amber-200', violet: 'bg-violet-50 text-violet-700 border-violet-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200', sky: 'bg-sky-50 text-sky-700 border-sky-200',
}
const jobTone = (j: Job) =>
  j.status === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : j.status === 'in progress' ? 'bg-sky-50 text-sky-800 border-sky-200'
      : 'bg-white text-muted border-line'
const shortName = (n: string) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || '') }
const prettyDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
const glitchText = (g: Glitch) => String(g.overview || g.glitch_type || g.category || 'Guest issue').replace(/\s+/g, ' ').slice(0, 160)
const OPEN_GLITCH = (g: Glitch) => String(g.status || '') !== 'closed'

export default function GeLog({ date }: { date: string }) {
  const [sched, setSched] = useState<Sched | null>(null)
  const [glitches, setGlitches] = useState<Glitch[]>([])
  const [crew, setCrew] = useState<PickPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<'dept' | 'person'>('dept')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [noteFor, setNoteFor] = useState('')
  const [showEmpty, setShowEmpty] = useState(true)
  const [tick, setTick] = useState(0)

  // ONE DAY, EVERY DEPARTMENT, OURS AND THE VENDORS'. dept=all and crew=all are what make this the
  // whole day rather than the cleaning half of it — the planner at /team defaults to cleaning only.
  useEffect(() => {
    if (!date) return
    let dead = false
    setLoading(true); setErr('')
    Promise.all([
      fetch('/api/team-schedule?dept=all&crew=all&from=' + date + '&to=' + date, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      fetch('/api/glitches', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      // The FULL Breezeway roster, not just housekeepers — a repair has to be assignable to a tech.
      fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([s, g, p]) => {
      if (dead) return
      if (s && s.ok) setSched(s as Sched); else setErr((s && s.error) || 'Could not load the day.')
      const gl: Glitch[] = (g && g.ok && Array.isArray(g.glitches) ? g.glitches : []) as Glitch[]
      setGlitches(gl.filter(OPEN_GLITCH))
      const ppl = (p && Array.isArray(p.people) ? p.people : []) as any[]
      setCrew(ppl.map(x => ({ id: Number(x.id), name: String(x.name || ''), region: x.region ? String(x.region) : null })).filter(x => x.id && x.name))
    }).finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [date, tick])

  /** Everyone the day knows about, flattened out of the market blocks with their market kept. */
  const roster = useMemo(() => {
    const out: { name: string; dept: string; market: string; status: string; clash: string; unrostered: boolean; jobs: Job[] }[] = []
    const seen = new Set<string>()
    for (const mb of (sched?.markets || [])) {
      for (const p of mb.people) {
        const k = p.name.toLowerCase(); if (seen.has(k)) continue
        seen.add(k)
        out.push({
          name: p.name, dept: deptKey(p.dept), market: mb.market,
          status: String(p.roster?.[date] || ''), clash: String(p.clashes?.[date] || ''),
          unrostered: !!p.unrostered, jobs: Array.isArray(p.byDay?.[date]) ? p.byDay[date] : [],
        })
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [sched, date])

  const scheduledToday = useMemo(() => { const s = new Set<string>(); for (const p of roster) if (isOn(p.status)) s.add(p.name); return s }, [roster])
  const markets = useMemo(() => (sched?.markets || []).map(m => m.market), [sched])

  // A glitch belongs to a person once it has a first assignee (Jon: "will go to the department
  // section based on who the main first assignee is"). Until then it lives in the glitch section,
  // which is the only place anybody would look for work nobody owns yet.
  const glitchFor = useCallback((name: string) => glitches.filter(g => g.assignee && sameRosterPerson(String(g.assignee), name)), [glitches])
  const unowned = useMemo(() => glitches.filter(g => !g.assignee || !roster.some(p => sameRosterPerson(String(g.assignee), p.name))), [glitches, roster])

  const totals = useMemo(() => {
    let jobs = 0, done = 0
    for (const p of roster) for (const j of p.jobs) { jobs++; if (j.status === 'done') done++ }
    return { jobs, done, people: roster.length, on: scheduledToday.size, glitches: glitches.length, unowned: unowned.length }
  }, [roster, scheduledToday, glitches, unowned])

  const toggle = (k: string) => setCollapsed(p => ({ ...p, [k]: !p[k] }))

  async function assignTask(j: Job, p: PickPerson | null) {
    const k = 'task:' + j.id
    setBusy(b => ({ ...b, [k]: true })); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: j.id, assigneeIds: p ? [p.id] : [] }),
      })
      const jj = await r.json().catch(() => null)
      if (!r.ok) throw new Error((jj && (jj.error || jj.refusal)) || 'Breezeway would not take that assignment.')
      setTick(t => t + 1)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(b => ({ ...b, [k]: false })) }
  }

  async function assignGlitch(g: Glitch, p: PickPerson | null) {
    const k = 'glitch:' + g.id
    setBusy(b => ({ ...b, [k]: true })); setErr('')
    try {
      const r = await fetch('/api/glitches/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: g.id, assignee: p ? p.name : '', assigneePersonId: p ? p.id : null }),
      })
      if (!r.ok) throw new Error('Could not assign that glitch.')
      // Optimistic: the glitch moves under its new owner on this render, not after a refetch.
      setGlitches(list => list.map(x => (x.id === g.id ? { ...x, assignee: p ? p.name : null, assignee_person_id: p ? p.id : null } : x)))
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(b => ({ ...b, [k]: false })) }
  }

  // ── one task, one line ────────────────────────────────────────────────────────────────────
  function TaskRow({ j, who }: { j: Job; who: string }) {
    const open = noteFor === 'task:' + j.id
    const b = !!busy['task:' + j.id]
    return (
      <>
        <tr className={'border-t border-line/70 ' + (j.status === 'done' ? 'bg-emerald-50/30' : '')}>
          <td className="px-2 py-1.5 align-middle font-semibold text-ink whitespace-nowrap">{j.unit}</td>
          <td className="px-2 py-1.5 align-middle text-ink/85">
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              {j.task}
              {j.departure ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">turnover</span> : null}
              {j.vendor ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-300">{j.vendor}</span> : null}
              {j.tags.map(t => <span key={t.key} className={'text-[9px] font-bold px-1 py-0.5 rounded border ' + (tagTone[t.tone] || tagTone.sky)}>{t.label}</span>)}
            </span>
          </td>
          <td className="px-2 py-1.5 align-middle whitespace-nowrap">
            <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border bg-app text-muted">{DEPT_LABEL[deptKey(j.dept)] || j.dept}</span>
          </td>
          <td className="px-2 py-1.5 align-middle whitespace-nowrap">
            <span className={'text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border ' + jobTone(j)}>{j.status}</span>
          </td>
          <td className="px-2 py-1.5 align-middle">
            <div className={'flex items-center gap-1.5 ' + (b ? 'opacity-50 pointer-events-none' : '')}>
              <CleanerPicker people={crew} scheduled={scheduledToday} value={null} existing={who}
                onChange={p => assignTask(j, p)} placeholder="Assign…" />
              {b ? <RefreshCw size={11} className="animate-spin text-muted" /> : null}
            </div>
          </td>
          <td className="px-2 py-1.5 align-middle text-right whitespace-nowrap">
            <span className="inline-flex items-center gap-1">
              <button onClick={() => setNoteFor(open ? '' : 'task:' + j.id)} title="Note on this task — it posts as a comment on the Breezeway task the crew reads"
                className={'text-[11px] font-semibold px-1.5 py-1 rounded-md border inline-flex items-center ' + (open ? 'bg-ink text-white border-ink' : 'border-line bg-white text-muted hover:text-ink hover:bg-app')}>
                <MessageSquare size={11} />
              </button>
              {j.url ? <a href={j.url} target="_blank" rel="noreferrer" title="Open in Breezeway" className="text-[11px] px-1.5 py-1 rounded-md border border-line bg-white text-muted hover:text-ink hover:bg-app inline-flex items-center"><ExternalLink size={11} /></a> : null}
            </span>
          </td>
        </tr>
        {open && (
          <tr className="bg-app/40 border-t border-line"><td colSpan={6} className="px-2 py-2">
            <CommentThread type="task" id={String(j.id)} taskId={String(j.id)} label={j.unit + ' — ' + j.task} link="/schedule"
              dept={/maint|inspect/.test(deptKey(j.dept)) ? 'maintenance' : 'housekeeping'} />
          </td></tr>
        )}
      </>
    )
  }

  function GlitchRow({ g }: { g: Glitch }) {
    const open = noteFor === 'glitch:' + g.id
    const b = !!busy['glitch:' + g.id]
    const tid = g.breezeway_task_id ? String(g.breezeway_task_id) : ''
    return (
      <>
        <tr className="border-t border-line/70">
          <td className="px-2 py-1.5 align-middle font-semibold text-ink whitespace-nowrap">{g.unit || '—'}</td>
          <td className="px-2 py-1.5 align-middle text-ink/85">
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">glitch</span>
              {glitchText(g)}
              {g.priority ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">{g.priority}</span> : null}
            </span>
          </td>
          <td className="px-2 py-1.5 align-middle whitespace-nowrap">
            <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border bg-app text-muted">{String(g.status || '').replace(/_/g, ' ') || 'pool'}</span>
          </td>
          <td className="px-2 py-1.5 align-middle whitespace-nowrap">
            {tid ? <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border bg-sky-50 text-sky-800 border-sky-200">{String(g.task_status || 'task').replace(/_/g, ' ')}</span>
              : <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border border-dashed border-line text-muted">no task yet</span>}
          </td>
          <td className="px-2 py-1.5 align-middle">
            <div className={'flex items-center gap-1.5 ' + (b ? 'opacity-50 pointer-events-none' : '')}>
              <CleanerPicker people={crew} scheduled={scheduledToday} value={null} existing={g.assignee || ''}
                onChange={p => assignGlitch(g, p)} placeholder="Assign…" />
              {b ? <RefreshCw size={11} className="animate-spin text-muted" /> : null}
            </div>
          </td>
          <td className="px-2 py-1.5 align-middle text-right whitespace-nowrap">
            <span className="inline-flex items-center gap-1">
              <button onClick={() => setNoteFor(open ? '' : 'glitch:' + g.id)} title={tid ? 'Note — posts as a comment on the Breezeway task' : 'Note — kept on the glitch; there is no Breezeway task yet'}
                className={'text-[11px] font-semibold px-1.5 py-1 rounded-md border inline-flex items-center ' + (open ? 'bg-ink text-white border-ink' : 'border-line bg-white text-muted hover:text-ink hover:bg-app')}>
                <MessageSquare size={11} />
              </button>
              <a href={'/glitches?id=' + g.id} title="Open the glitch" className="text-[11px] px-1.5 py-1 rounded-md border border-line bg-white text-muted hover:text-ink hover:bg-app inline-flex items-center"><ExternalLink size={11} /></a>
            </span>
          </td>
        </tr>
        {open && (
          <tr className="bg-app/40 border-t border-line"><td colSpan={6} className="px-2 py-2">
            {!tid && <p className="text-[10.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">No Breezeway task on this glitch yet — the note stays on the glitch. Push it to Breezeway from the glitch board and later notes reach the field.</p>}
            <CommentThread type={tid ? 'task' : 'glitch'} id={tid || String(g.id)} taskId={tid || undefined}
              label={(g.unit || 'Glitch') + ' — ' + glitchText(g).slice(0, 60)} link={'/glitches?id=' + g.id} dept="maintenance" />
          </td></tr>
        )}
      </>
    )
  }

  const HEAD = (cols: string[]) => (
    <thead><tr className="text-[9.5px] uppercase tracking-wide text-muted font-bold bg-app/60">
      {cols.map((c, i) => <th key={c + i} className={'px-2 py-1.5 font-bold ' + (i === cols.length - 1 ? 'text-right' : 'text-left')}>{c}</th>)}
    </tr></thead>
  )

  /** One person: their roster status for the day, their tasks, and any glitch they own. */
  function PersonBlock({ p, k }: { p: typeof roster[number]; k: string }) {
    const gl = glitchFor(p.name)
    const n = p.jobs.length + gl.length
    const shut = !!collapsed[k]
    if (!n && !showEmpty) return null
    const done = p.jobs.filter(j => j.status === 'done').length
    return (
      <div className="border-t border-line first:border-t-0">
        <button onClick={() => toggle(k)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-app/60">
          {shut ? <ChevronRight size={13} className="text-muted shrink-0" /> : <ChevronDown size={13} className="text-muted shrink-0" />}
          <span className="text-[12.5px] font-semibold text-ink truncate">{shortName(p.name)}</span>
          <span className={'text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ' + statusTone(p.status)}>{p.status || 'not scheduled'}</span>
          {/* The two disagreements lib/team-schedule computes, and the only place they are shown. */}
          {p.clash === 'off-but-assigned' ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0" title="Marked off this day but holding work">off &amp; working</span> : null}
          {p.clash === 'on-but-empty' ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 shrink-0" title="On shift with nothing assigned">on, empty</span> : null}
          {p.unrostered ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 shrink-0" title="Holding work but on no market roster this week">not rostered</span> : null}
          {view === 'person' ? <span className="text-[10px] text-muted shrink-0">{DEPT_LABEL[p.dept]} · {p.market}</span> : null}
          <span className="ml-auto flex items-center gap-2 shrink-0 text-[10.5px] tabular-nums">
            {n ? <>
              <span className="text-muted">{n} task{n === 1 ? '' : 's'}</span>
              {done ? <span className="text-emerald-700">{done} done</span> : null}
              {gl.length ? <span className="text-rose-700 font-semibold">{gl.length} glitch{gl.length === 1 ? '' : 'es'}</span> : null}
            </> : <span className="text-muted italic">nothing on their day</span>}
          </span>
        </button>
        {!shut && n > 0 && (
          <div className="overflow-x-auto border-t border-line/60">
            <table className="w-full text-[11.5px] border-collapse min-w-[760px]">
              {HEAD(['Unit', 'Task', 'Dept', 'Status', 'Assigned to', 'Note'])}
              <tbody>
                {p.jobs.map(j => <TaskRow key={j.id} j={j} who={p.name} />)}
                {gl.map(g => <GlitchRow key={'g' + g.id} g={g} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  const deptGroups = useMemo(() => {
    const out: { dept: string; areas: { area: string; people: typeof roster }[] }[] = []
    for (const dept of DEPT_ORDER) {
      const mine = roster.filter(p => p.dept === dept)
      if (!mine.length) continue
      const areas: { area: string; people: typeof roster }[] = []
      for (const mk of markets) { const ppl = mine.filter(p => p.market === mk); if (ppl.length) areas.push({ area: mk, people: ppl }) }
      const rest = mine.filter(p => markets.indexOf(p.market) < 0)
      if (rest.length) areas.push({ area: 'Other', people: rest })
      out.push({ dept, areas })
    }
    return out
  }, [roster, markets])

  return (
    <section className="space-y-3">
      {/* THE DAY IN ONE LINE. Deliberately not six big tiles: this view is read by somebody who
          already knows what day it is and wants to find their people. */}
      <div className="rounded-xl border border-line bg-white px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
        <span className="font-bold text-ink text-[12.5px]">{date ? prettyDate(date) : ''}</span>
        <span className="text-muted tabular-nums">{totals.jobs} task{totals.jobs === 1 ? '' : 's'}</span>
        {totals.done ? <span className="text-emerald-700 tabular-nums">{totals.done} done</span> : null}
        <span className="text-muted tabular-nums">{totals.on} of {totals.people} on today</span>
        {totals.glitches ? <span className="text-rose-700 font-semibold tabular-nums">{totals.glitches} open glitch{totals.glitches === 1 ? '' : 'es'}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5 border border-line rounded-lg p-0.5 bg-white">
            {([['dept', 'By department'], ['person', 'By team member']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className={'text-[11px] font-semibold px-2 py-1 rounded-md ' + (view === v ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>{l}</button>
            ))}
          </div>
          <button onClick={() => setShowEmpty(s => !s)} className="text-[11px] font-semibold text-brand-700 hover:underline">{showEmpty ? 'Hide empty days' : 'Show everyone'}</button>
          <button onClick={() => setTick(t => t + 1)} title="Reload the day" className="text-muted hover:text-ink"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {err && <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
      {sched?.partial && <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5"><AlertTriangle size={12} />The task read stopped early — some work may be missing from this day.</p>}

      {/* GLITCHES & PENDING FIELD ACTIVITY. First, because it is the only part of the day nobody
          owns yet. Assign one and it moves under that person below, in their department. */}
      <div className="rounded-xl border border-rose-200 bg-white overflow-hidden">
        <div className="px-3 py-2 bg-rose-50 border-b border-rose-200 flex items-center gap-2">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-rose-900">Glitches &amp; pending field activity</h3>
          <span className="text-[10.5px] text-rose-800 tabular-nums">{unowned.length} unassigned{glitches.length !== unowned.length ? ' · ' + (glitches.length - unowned.length) + ' with an owner below' : ''}</span>
        </div>
        {unowned.length === 0 ? (
          <p className="px-3 py-3 text-[11.5px] text-muted">{glitches.length ? 'Every open glitch has an owner — each one sits under their name below.' : 'No open glitches.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px] border-collapse min-w-[760px]">
              {HEAD(['Unit', 'Issue', 'Stage', 'Breezeway', 'Assign to', 'Note'])}
              <tbody>{unowned.map(g => <GlitchRow key={'u' + g.id} g={g} />)}</tbody>
            </table>
          </div>
        )}
      </div>

      {loading && !sched ? <p className="text-[12px] text-muted px-1">Loading the day…</p> : null}
      {!loading && roster.length === 0 && (
        <p className="rounded-xl border border-line bg-white px-3 py-6 text-center text-[12px] text-muted">
          Nobody on the roster for this week yet. Add people on the Day board&rsquo;s Working rail, or let Homebase fill it in.
        </p>
      )}

      {view === 'person' ? (
        // THE FULL LIST. One alphabetical run of everybody, department and market as a label on the
        // row rather than a heading — for the morning question "where is Mirian today".
        roster.length > 0 && (
          <div className="rounded-xl border border-line bg-white overflow-hidden">
            <div className="px-3 py-2 bg-ink/[0.03] border-b border-line">
              <h3 className="text-[11px] uppercase tracking-wider font-bold text-ink">Everyone · {roster.length}</h3>
            </div>
            {roster.map(p => <PersonBlock key={p.name} p={p} k={'all:' + p.name} />)}
          </div>
        )
      ) : (
        deptGroups.map(g => (
          <div key={g.dept} className="rounded-xl border border-line bg-white overflow-hidden">
            <div className="px-3 py-2 bg-ink/[0.03] border-b border-line flex items-center gap-2">
              <h3 className="text-[11px] uppercase tracking-wider font-bold text-ink">{DEPT_LABEL[g.dept] || g.dept}</h3>
              <span className="text-[10.5px] text-muted tabular-nums">
                {g.areas.reduce((n, a) => n + a.people.filter(p => isOn(p.status)).length, 0)} on
                {' · '}{g.areas.reduce((n, a) => n + a.people.reduce((m, p) => m + p.jobs.length, 0), 0)} tasks
              </span>
            </div>
            {g.areas.map(a => (
              <div key={a.area}>
                <p className="px-3 py-1 text-[9.5px] uppercase tracking-wide font-bold text-muted bg-app/50 border-b border-line/70">{a.area}</p>
                {a.people.map(p => <PersonBlock key={p.name} p={p} k={g.dept + ':' + a.area + ':' + p.name} />)}
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  )
}

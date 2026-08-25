'use client'
// THE GRID — Today in Ops, the way Breezeway lays a day out (Jon, 2026-08-25: "there should be
// another view like Breezeway, which shows you the unit and all the tasks assigned to that unit.
// We should also be able to click it by people instead of the listings being on the left").
//
// ── WHAT THIS IS AND WHY IT IS NOT THE BOARD ────────────────────────────────────────────────────
// The Board is management by exception: it leads with what needs a human and hides the rest. That
// is the right landing for a manager and the wrong one for a coordinator working the whole day —
// they need every unit in one scannable list, with the day's work on each row, and the ability to
// flip the same list onto the person axis when the question changes from "is 1418 ready?" to
// "what is Yoslenis carrying?". Breezeway solved that layout well, so this borrows the shape:
// counters on top that double as filters, one dense row per unit, the tasks as a strip of chips.
//
// ── ONE PASS OVER THE DAY, SEVEN COUNTERS ───────────────────────────────────────────────────────
// The old strip counted Cleans / Maintenance / Inspections, which put a departure clean, a strip
// and a linen drop in one number and buried guest-reported problems entirely. Jon asked for the
// real breakdown: Departure, Cleaning, Guest issues, Glitches, Maintenance, Housekeeping audit,
// Inspection. `catOf` is the single definition, used by the tiles, the chips and the filter — so a
// task can never be counted in one place and coloured as something else in another.
//
// Guest issues and glitches are the exception to "today": both are open-until-fixed, carry no
// scheduled date in Breezeway, and matter on the day they are open rather than the day they were
// filed. Their tiles read the open-glitch feed and merge by task id so a glitch that IS scheduled
// today is not counted twice.
//
// Everything actionable here reuses machinery that already works: /api/breezeway/assign for
// assignment, /api/ops-today/add-task for creation (which now carries a Breezeway template_id),
// /api/breezeway/comments for the last comment on a row you open.
import { useEffect, useMemo, useState } from 'react'
import {
  Search, Plus, Loader2, ChevronRight, ExternalLink, MessageSquare, AlertTriangle,
  LayoutGrid, Users, X,
} from 'lucide-react'

// ── types (mirrors of /api/ops-today) ───────────────────────────────────────────────────────────
export type GTask = {
  id: string; listingId: string; unit: string; market: string; dept: string; type: string
  name: string; status: string; assignees: string[]; assigneeIds?: number[]
  startedAt: string | null; finishedAt: string | null; minutes: number | null
  reportUrl?: string | null
  done: boolean; running: boolean; late: boolean; atRisk: boolean; untracked?: boolean; guestyOnly?: boolean
}
export type GUnit = {
  listingId: string; unit: string; market: string; market2?: string | null; building?: string | null
  city?: string | null; address?: string | null; bedrooms?: number | null
  guestOut: string | null; arrivingGuest?: string | null; arrivingAt?: string | null
  checkOutTime?: string | null; sameDayTurn: boolean; nights?: number | null; arrivingNights?: number | null
  qc?: { issue: string; status: string; reportUrl: string | null }[]
  tasks: GTask[]; late: boolean; atRisk: boolean; unassigned: boolean; allDone: boolean; guestyOnly?: boolean
}
export type GVacant = { listingId: string; unit: string; market: string; leftToday: string | null; nextArrival: string | null; openTasks: number; needsClean?: boolean }
export type GData = { ok: boolean; today: string; units: GUnit[]; vacants?: GVacant[] }
export type GGlitch = { id: string; unit: string; issue: string; rawName?: string; ageDays?: number | null; running?: boolean; unassigned?: boolean; assignees?: string[]; reportUrl?: string | null; done?: boolean }
export type GRoster = { id: number; name: string; departments: string[] }

// ── CATEGORIES — the one definition ─────────────────────────────────────────────────────────────
export type Cat = 'departure' | 'cleaning' | 'hkaudit' | 'inspection' | 'maintenance' | 'guest' | 'glitch'
const CATS: { key: Cat; label: string; short: string; dot: string; soft: string }[] = [
  { key: 'departure', label: 'Departure', short: 'Dep', dot: 'bg-rose-500', soft: 'bg-rose-50 text-rose-700 border-rose-200' },
  { key: 'cleaning', label: 'Cleaning', short: 'Clean', dot: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700 border-sky-200' },
  { key: 'guest', label: 'Guest issues', short: 'Guest', dot: 'bg-pink-500', soft: 'bg-pink-50 text-pink-700 border-pink-200' },
  { key: 'glitch', label: 'Glitches', short: 'Glitch', dot: 'bg-orange-500', soft: 'bg-orange-50 text-orange-700 border-orange-200' },
  { key: 'maintenance', label: 'Maintenance', short: 'Maint', dot: 'bg-amber-500', soft: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'hkaudit', label: 'Housekeeping audit', short: 'HK audit', dot: 'bg-teal-500', soft: 'bg-teal-50 text-teal-700 border-teal-200' },
  { key: 'inspection', label: 'Inspection', short: 'Inspect', dot: 'bg-violet-500', soft: 'bg-violet-50 text-violet-700 border-violet-200' },
]
const CAT_BY: Record<Cat, typeof CATS[number]> = CATS.reduce((m, c) => { m[c.key] = c; return m }, {} as any)

/**
 * Which counter a task belongs to. ORDER MATTERS and is not arbitrary:
 * a glitch is filed as a maintenance task named "Guest Reported / Glitch — ...", so matching on
 * department first would file every guest-impacting problem under Maintenance, which is exactly
 * the burial Jon asked to undo. Name wins over department here, deliberately.
 */
export function catOf(t: { name?: string; dept?: string; type?: string }): Cat {
  const n = String(t.name || '').toLowerCase()
  const dept = String(t.dept || '').toLowerCase()
  const type = String(t.type || '')
  if (/glitch/.test(n)) return 'glitch'
  if (/guest\s*reported/.test(n)) return 'guest'
  if (type === 'departure_clean' || /departure clean|turnover clean/.test(n)) return 'departure'
  // "Housekeeping Audit" is a cleanliness score, not a maintenance walk — its own counter because
  // it is the number the housekeeping standard is measured on.
  if (/housekeep\w*\s*audit|audit\s*\W*\s*housekeep/.test(n) || (type === 'audit' && dept === 'housekeeping')) return 'hkaudit'
  if (dept === 'housekeeping' || type === 'strip' || type === 'deep_clean') return 'cleaning'
  if (type === 'inspection' || type === 'audit' || dept === 'inspection' || /unit check|inspect/.test(n)) return 'inspection'
  return 'maintenance'
}

const bzTask = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)
const isReal = (t: GTask) => !t.guestyOnly && /^\d+$/.test(String(t.id))
function daysBetween(a: string, b: string) { const x = new Date(a + 'T12:00:00'), y = new Date(b + 'T12:00:00'); return Math.round((+y - +x) / 86400000) }
function shortTime(iso: string | null): string {
  if (!iso) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) } catch { return '' }
}

// ── the donut ───────────────────────────────────────────────────────────────────────────────────
// Three states on one ring: finished, in progress, not started. The track IS "not started", so a
// day with nothing done reads as an empty grey circle at a glance — which is the point.
function Donut({ done, running, total, size = 52, stroke = 6 }: { done: number; running: number; total: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const C = 2 * Math.PI * r
  const d = total > 0 ? Math.min(1, done / total) : 0
  const g = total > 0 ? Math.min(1 - d, running / total) : 0
  return (
    <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} className="shrink-0">
      <g transform={'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-200" />
        {g > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="butt"
          className="stroke-amber-400" strokeDasharray={(g * C) + ' ' + C} strokeDashoffset={-d * C} />}
        {d > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="butt"
          className="stroke-emerald-500" strokeDasharray={(d * C) + ' ' + C} />}
      </g>
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-ink font-bold" style={{ fontSize: size * 0.34 }}>{total}</text>
    </svg>
  )
}

type Counts = { total: number; done: number; running: number; open: number }
const zero = (): Counts => ({ total: 0, done: 0, running: 0, open: 0 })

function Tile({ cat, c, active, onClick }: { cat: typeof CATS[number] | null; c: Counts; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={'text-left rounded-2xl border-2 px-3 py-2.5 bg-white transition-colors min-w-[170px] flex-1 ' +
        (active ? 'border-ink shadow-sm' : 'border-line hover:border-ink/25')}>
      <div className="flex items-center gap-2.5">
        <Donut done={c.done} running={c.running} total={c.total} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {cat && <span className={'w-2 h-2 rounded-full shrink-0 ' + cat.dot} />}
            <span className="text-[12.5px] font-bold text-ink truncate">{cat ? cat.label : 'Everything open'}</span>
          </div>
          <div className="mt-1 space-y-[1px]">
            <div className="text-[10.5px] text-muted leading-tight"><span className="font-bold text-emerald-600">{c.done}</span> finished</div>
            <div className="text-[10.5px] text-muted leading-tight"><span className="font-bold text-amber-600">{c.running}</span> in progress</div>
            <div className="text-[10.5px] text-muted leading-tight"><span className="font-bold text-ink">{c.open}</span> not started</div>
          </div>
        </div>
      </div>
    </button>
  )
}

// ── STATUS — the unit-level word, Breezeway's vocabulary ────────────────────────────────────────
// Ready / Dirty / In progress / Open. "Dirty" is reserved for the one that costs money: the guest
// has gone and the turnover has not been touched.
function unitStatus(u: GUnit): { label: string; cls: string } {
  const open = u.tasks.filter(t => !t.done)
  const clean = u.tasks.find(t => t.type === 'departure_clean')
  if (!open.length) return { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  if (u.tasks.some(t => t.running && !t.done)) return { label: 'In progress', cls: 'bg-amber-50 text-amber-800 border-amber-200' }
  if (u.guestOut && clean && !clean.done) return { label: 'Dirty', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
  return { label: 'Open', cls: 'bg-app text-muted border-line' }
}

/** One task, as the little coloured square Breezeway puts in the Tasks-today column. */
function TaskChip({ t, onOpen }: { t: GTask; onOpen: () => void }) {
  const c = CAT_BY[catOf(t)]
  const title = t.name + (t.assignees.length ? ' — ' + t.assignees.join(', ') : ' — unassigned') +
    ' · ' + (t.done ? 'finished' + (t.finishedAt ? ' ' + shortTime(t.finishedAt) : '') : t.running ? 'in progress' : 'not started')
  return (
    <button onClick={onOpen} title={title}
      className={'w-5 h-5 rounded-[5px] border-2 shrink-0 transition-transform hover:scale-110 ' +
        (t.done ? c.dot + ' border-transparent opacity-90'
          : t.running ? 'border-amber-400 bg-amber-100'
            : t.assignees.length ? 'border-slate-300 bg-white' : 'border-dashed border-rose-300 bg-white')} />
  )
}

// ── THE ROW ─────────────────────────────────────────────────────────────────────────────────────
type Row = {
  key: string
  title: string
  sub: string
  reservation: string
  status: { label: string; cls: string }
  tasks: GTask[]
  issues: { text: string; kind: 'qc' | 'glitch' | 'guest' }[]
  gapNights: number | null
  urgent: number
  listingId?: string
}

function GridRow({ row, roster, mode, onRefresh, onAdd }: {
  row: Row; roster: GRoster[]; mode: 'units' | 'people'; onRefresh: () => void; onAdd: (unit: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<Record<string, { body: string; at: string } | null> | null>(null)
  const done = row.tasks.filter(t => t.done).length
  const total = row.tasks.length

  // Comments cost a Breezeway call each, so they are fetched when a row is opened and never before.
  useEffect(() => {
    if (!open || comments) return
    const ids = row.tasks.filter(isReal).slice(0, 6).map(t => t.id)
    if (!ids.length) { setComments({}); return }
    fetch('/api/breezeway/comments?taskIds=' + ids.join(','), { cache: 'no-store' })
      .then(r => r.json()).then(j => setComments(j && j.comments ? j.comments : {})).catch(() => setComments({}))
  }, [open, comments, row.tasks])

  const lastComment = useMemo(() => {
    if (!comments) return null
    const all = Object.values(comments).filter(Boolean) as { body: string; at: string }[]
    return all.sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null
  }, [comments])

  return (
    <div className="border-b border-line last:border-0">
      {/* THE ROW. 12 columns from lg: up; below that it stacks into a card, because a coordinator
          on a phone in a hallway needs the same information and cannot scroll a table sideways. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 lg:gap-3 items-center px-3 py-2.5 hover:bg-app/60 cursor-pointer"
        onClick={() => setOpen(o => !o)}>
        {/* who / what */}
        <div className="lg:col-span-3 min-w-0 flex items-center gap-2">
          <ChevronRight size={14} className={'text-muted shrink-0 transition-transform ' + (open ? 'rotate-90' : '')} />
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold text-ink truncate">{row.title}</div>
            {row.sub && <div className="text-[11px] text-muted truncate">{row.sub}</div>}
          </div>
        </div>
        {/* reservation / shift context */}
        <div className="lg:col-span-3 min-w-0">
          <span className="text-[11.5px] text-muted lg:whitespace-nowrap lg:truncate lg:block">{row.reservation}</span>
        </div>
        {/* status */}
        <div className="lg:col-span-2 flex items-center gap-2">
          <span className={'text-[10.5px] font-bold px-2 py-0.5 rounded-full border ' + row.status.cls}>{row.status.label}</span>
          {total > 0 && (
            <span className="text-[10.5px] font-semibold text-muted tabular-nums" title={done + ' of ' + total + ' finished'}>
              {done}/{total}
            </span>
          )}
        </div>
        {/* the day's work */}
        <div className="lg:col-span-3 flex items-center gap-1 flex-wrap">
          {row.tasks.length === 0
            ? <span className="text-[11px] text-muted">No tasks today</span>
            : row.tasks.slice(0, 14).map(t => (
              <TaskChip key={t.id} t={t} onOpen={() => { if (isReal(t)) window.open(bzTask(t.id), '_blank') }} />
            ))}
          {row.tasks.length > 14 && <span className="text-[10.5px] text-muted font-semibold">+{row.tasks.length - 14}</span>}
        </div>
        {/* issues + gap */}
        <div className="lg:col-span-1 flex items-center gap-2 lg:justify-end">
          {row.issues.length > 0 && (
            <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 inline-flex items-center gap-1"
              title={row.issues.map(i => i.text).join(' · ')}>
              <AlertTriangle size={10} />{row.issues.length}
            </span>
          )}
          {row.gapNights != null && (
            <span className="text-[10.5px] text-muted font-semibold tabular-nums" title="Nights free before the next arrival">
              {row.gapNights}n
            </span>
          )}
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 bg-app/40" onClick={e => e.stopPropagation()}>
          {row.issues.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {row.issues.map((i, n) => (
                <span key={n} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">{i.text}</span>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-line bg-white divide-y divide-line overflow-hidden">
            {row.tasks.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-muted">Nothing scheduled on this {mode === 'people' ? 'person' : 'unit'} today.</div>}
            {row.tasks.map(t => <TaskLine key={t.id} t={t} roster={roster} mode={mode} onRefresh={onRefresh} comment={comments ? comments[t.id] || null : null} />)}
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {mode === 'units' && (
              <button onClick={() => onAdd(row.title)}
                className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:border-ink/30 inline-flex items-center gap-1.5">
                <Plus size={12} /> Add a task here
              </button>
            )}
            {lastComment && (
              <span className="text-[11.5px] text-muted inline-flex items-start gap-1.5 min-w-0">
                <MessageSquare size={12} className="mt-0.5 shrink-0" />
                <span className="truncate">{lastComment.body}</span>
              </span>
            )}
            {open && !comments && <span className="text-[11px] text-muted inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> reading comments…</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/** One task inside an opened row: what it is, who has it, where it stands, and one-tap assign. */
function TaskLine({ t, roster, mode, onRefresh, comment }: {
  t: GTask; roster: GRoster[]; mode: 'units' | 'people'; onRefresh: () => void; comment: { body: string; at: string } | null
}) {
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const c = CAT_BY[catOf(t)]
  const ppl = useMemo(() => {
    const inDept = roster.filter(p => !p.departments?.length || p.departments.some(x => x.toLowerCase().includes(String(t.dept || '').toLowerCase())))
    return (inDept.length ? inDept : roster).slice(0, 14)
  }, [roster, t.dept])
  const assign = async (id: number) => {
    setBusy(id); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, assigneeIds: [id] }) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'assign failed')
      setAssigning(false); onRefresh()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(0)
  }
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={'w-2 h-2 rounded-full shrink-0 ' + c.dot} />
        <span className="text-[12.5px] font-semibold text-ink">{t.name}</span>
        <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-md border ' + c.soft}>{c.short}</span>
        {t.done
          ? <span className="text-[10.5px] font-bold text-emerald-700">Finished{t.finishedAt ? ' ' + shortTime(t.finishedAt) : ''}{t.minutes ? ' · ' + t.minutes + 'm' : ''}</span>
          : t.running
            ? <span className="text-[10.5px] font-bold text-amber-700">In progress{t.startedAt ? ' since ' + shortTime(t.startedAt) : ''}</span>
            : <span className="text-[10.5px] font-bold text-muted">Not started</span>}
        {t.late && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-600 text-white">Late</span>}
        {mode === 'units' && (
          t.assignees.length
            ? <span className="text-[11.5px] text-muted">{t.assignees.join(', ')}</span>
            : <span className="text-[11px] font-bold text-rose-600">Unassigned</span>
        )}
        {mode === 'people' && <span className="text-[11.5px] text-muted">{t.unit}</span>}
        <span className="ml-auto flex items-center gap-2">
          {isReal(t) && !t.done && (
            <button onClick={() => setAssigning(a => !a)} className="text-[11.5px] font-bold text-brand-700 hover:underline">
              {t.assignees.length ? 'Reassign' : 'Assign'}
            </button>
          )}
          {t.reportUrl && <a href={t.reportUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-muted hover:underline" title="Read-only field report">Report</a>}
          {isReal(t) && <a href={bzTask(t.id)} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="Open in Breezeway"><ExternalLink size={12} /></a>}
        </span>
      </div>
      {comment && (
        <div className="mt-1 text-[11.5px] text-muted flex items-start gap-1.5">
          <MessageSquare size={11} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{comment.body}</span>
        </div>
      )}
      {assigning && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {ppl.map(p => (
            <button key={p.id} onClick={() => assign(p.id)} disabled={!!busy}
              className="text-[11.5px] font-semibold px-2 py-1 rounded-full border border-line bg-white hover:border-ink/40 disabled:opacity-50">
              {busy === p.id ? <Loader2 size={10} className="animate-spin inline" /> : null} {p.name}
            </button>
          ))}
          {err && <span className="text-[11px] text-rose-600 font-semibold">{err}</span>}
        </div>
      )}
    </div>
  )
}

// ── THE GRID ────────────────────────────────────────────────────────────────────────────────────
export function OpsGrid({ data, glitches, roster, onRefresh, onAddTask }: {
  data: GData | undefined
  glitches: GGlitch[]
  roster: GRoster[]
  onRefresh: () => void
  onAddTask: (unit: string) => void
}) {
  const [mode, setMode] = useState<'units' | 'people'>('units')
  const [cat, setCat] = useState<Cat | null>(null)
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  useEffect(() => { try { const m = localStorage.getItem('opsgrid_mode'); if (m === 'people') setMode('people') } catch {} }, [])
  const pickMode = (m: 'units' | 'people') => { setMode(m); try { localStorage.setItem('opsgrid_mode', m) } catch {} }

  const units: GUnit[] = Array.isArray(data?.units) ? data!.units : []
  const today = data?.today || ''
  const allTasks = useMemo(() => units.flatMap(u => u.tasks), [units])

  // ── COUNTERS ────────────────────────────────────────────────────────────────────────────────
  // Today's Breezeway tasks by category, plus the open guest/glitch backlog merged in by id so a
  // glitch scheduled for today is counted once, not twice.
  const counts = useMemo(() => {
    const m: Record<string, Counts> = { all: zero() }
    for (const c of CATS) m[c.key] = zero()
    const bump = (k: string, done: boolean, running: boolean) => {
      const c = m[k]; if (!c) return
      c.total++; if (done) c.done++; else if (running) c.running++; else c.open++
    }
    const seen: Record<string, true> = {}
    for (const t of allTasks) {
      seen[t.id] = true
      bump('all', t.done, t.running)
      bump(catOf(t), t.done, t.running)
    }
    for (const g of glitches) {
      if (seen[g.id] || g.done) continue
      const k: Cat = /glitch/i.test(String(g.rawName || g.issue || '')) ? 'glitch' : 'guest'
      bump('all', false, !!g.running)
      bump(k, false, !!g.running)
    }
    return m
  }, [allTasks, glitches])

  // Open issues per unit: the QC items the board already carries plus the open guest/glitch feed.
  const issuesByUnit = useMemo(() => {
    const m: Record<string, { text: string; kind: 'qc' | 'glitch' | 'guest' }[]> = {}
    for (const u of units) for (const q2 of (u.qc || [])) (m[u.unit] = m[u.unit] || []).push({ text: q2.issue, kind: 'qc' })
    for (const g of glitches) {
      if (g.done) continue
      const kind: 'glitch' | 'guest' = /glitch/i.test(String(g.rawName || g.issue || '')) ? 'glitch' : 'guest'
      ;(m[g.unit] = m[g.unit] || []).push({ text: g.issue, kind })
    }
    return m
  }, [units, glitches])

  const gapByListing = useMemo(() => {
    const m: Record<string, number> = {}
    for (const v of (data?.vacants || [])) if (v.nextArrival && today) m[v.listingId] = Math.max(0, daysBetween(today, v.nextArrival))
    return m
  }, [data, today])

  // ── ROWS ────────────────────────────────────────────────────────────────────────────────────
  const rows: Row[] = useMemo(() => {
    const catMatch = (t: GTask) => !cat || catOf(t) === cat
    if (mode === 'units') {
      const rowsForUnits: Row[] = units.map(u => {
        const tasks = u.tasks.filter(catMatch)
        const res = u.sameDayTurn
          ? 'TURN · out ' + (u.checkOutTime || '') + ' → in ' + (u.arrivingAt || '4:00 PM') + (u.arrivingGuest ? ' · ' + u.arrivingGuest : '')
          : u.guestOut
            ? 'Out today' + (u.checkOutTime ? ' ' + u.checkOutTime : '') + ' · ' + u.guestOut + (u.nights ? ' · ' + u.nights + 'n stay' : '')
            : u.arrivingAt
              ? 'Arriving ' + u.arrivingAt + (u.arrivingGuest ? ' · ' + u.arrivingGuest : '')
              : 'In-house / no movement'
        // Under a Guest issues / Glitches filter the row should show only the issues of that
        // kind — otherwise tapping "Glitches" hands back a row whose badge is counting QC items.
        const issues = (cat === 'guest' || cat === 'glitch')
          ? (issuesByUnit[u.unit] || []).filter(i => i.kind === cat)
          : (issuesByUnit[u.unit] || [])
        return {
          key: 'u:' + u.listingId, title: u.unit,
          sub: [u.building, u.city].filter(Boolean).join(' · ') || u.market,
          reservation: res, status: unitStatus(u), tasks, issues,
          gapNights: gapByListing[u.listingId] ?? null,
          urgent: (u.late ? 100 : 0) + (u.atRisk ? 50 : 0) + (u.sameDayTurn ? 20 : 0) + (u.unassigned ? 10 : 0) + issues.length,
          listingId: u.listingId,
        } as Row
      })
      // A UNIT WITH A PROBLEM AND NO WORK ON IT IS THE WHOLE POINT OF A GLITCH.
      // /api/ops-today builds its unit list from today's Breezeway tasks, so a unit with an open
      // guest-reported issue but nothing scheduled today never appears — which would leave the
      // Guest issues and Glitches counters pointing at rows that do not exist. These units get a
      // row of their own, carrying the issue and no task strip.
      const have: Record<string, true> = {}
      for (const u of units) have[u.unit] = true
      for (const g of glitches) {
        if (g.done || have[g.unit]) continue
        have[g.unit] = true
        const issues = (issuesByUnit[g.unit] || []).filter(i => (cat === 'guest' || cat === 'glitch') ? i.kind === cat : true)
        if (!issues.length) continue
        rowsForUnits.push({
          key: 'g:' + g.unit, title: g.unit, sub: 'open issue \u00b7 nothing scheduled today',
          reservation: 'No work on the board today',
          status: { label: 'Issue open', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
          tasks: [], issues, gapNights: null, urgent: 40 + issues.length,
        })
      }
      return rowsForUnits
    }
    // PEOPLE AXIS — the same day, re-pivoted. Unassigned work is a row of its own and sorts to the
    // top: it is the only row on this screen nobody is carrying, which makes it the first question.
    const byPerson: Record<string, GTask[]> = {}
    const unassigned: GTask[] = []
    for (const u of units) for (const t of u.tasks) {
      if (!catMatch(t)) continue
      if (!t.assignees.length) { if (!t.done) unassigned.push(t); continue }
      for (const n of t.assignees) (byPerson[n] = byPerson[n] || []).push(t)
    }
    const out: Row[] = Object.keys(byPerson).sort().map(name => {
      const tasks = byPerson[name]
      const doneN = tasks.filter(t => t.done).length
      const running = tasks.filter(t => t.running && !t.done).length
      const late = tasks.filter(t => t.late).length
      const dep = tasks.filter(t => catOf(t) === 'departure').length
      const status = doneN === tasks.length
        ? { label: 'Done for today', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
        : running
          ? { label: 'Working', cls: 'bg-amber-50 text-amber-800 border-amber-200' }
          : { label: 'Not started', cls: 'bg-app text-muted border-line' }
      const roles = roster.find(p => p.name.toLowerCase() === name.toLowerCase())
      return {
        key: 'p:' + name, title: name,
        sub: (roles && roles.departments && roles.departments.length ? roles.departments.join(' · ') : ''),
        reservation: [dep ? dep + ' departure clean' + (dep === 1 ? '' : 's') : '', tasks.length - doneN + ' left of ' + tasks.length,
        Array.from(new Set(tasks.map(t => t.unit))).length + ' units'].filter(Boolean).join(' · '),
        status, tasks, issues: [], gapNights: null,
        urgent: late * 100 + (tasks.length - doneN),
      } as Row
    })
    if (unassigned.length) out.unshift({
      key: 'p:unassigned', title: 'Nobody assigned', sub: 'open work with no name on it',
      reservation: unassigned.length + ' task' + (unassigned.length === 1 ? '' : 's') + ' · ' + Array.from(new Set(unassigned.map(t => t.unit))).length + ' units',
      status: { label: 'Needs a name', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
      tasks: unassigned, issues: [], gapNights: null, urgent: 1e6,
    })
    return out
  }, [mode, units, cat, issuesByUnit, gapByListing, roster, glitches])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    let r = rows
    if (n) r = r.filter(x => (x.title + ' ' + x.sub + ' ' + x.tasks.map(t => t.name + ' ' + t.assignees.join(' ')).join(' ')).toLowerCase().includes(n))
    // "Active" is Breezeway's word for "still has something on it". Off = the whole portfolio,
    // finished units included, which is what you want at 6pm when you are checking the day closed.
    if (activeOnly) r = r.filter(x => x.tasks.some(t => !t.done) || x.issues.length > 0)
    // A filtered row earns its place with a matching task OR a matching issue — dropping the
    // issue-only rows here is what made the Glitches tile filter to an empty list.
    if (cat) r = r.filter(x => x.tasks.length > 0 || x.issues.length > 0)
    return r.slice().sort((a, b) => b.urgent - a.urgent || a.title.localeCompare(b.title))
  }, [rows, q, activeOnly, cat])

  const tiles: { key: string; cat: typeof CATS[number] | null }[] = [{ key: 'all', cat: null }, ...CATS.map(c => ({ key: c.key, cat: c }))]

  return (
    <div>
      {/* ── COUNTERS. Every tile is a filter — the number you are worried about is one tap from
          the list of rows behind it, which is the whole reason to put counters on a screen. ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 lh-actions">
        {tiles.map(t => (
          <Tile key={t.key} cat={t.cat} c={counts[t.key] || zero()}
            active={t.key === 'all' ? cat === null : cat === t.key}
            onClick={() => setCat(t.key === 'all' ? null : (cat === t.key ? null : (t.key as Cat)))} />
        ))}
      </div>

      {/* ── CONTROLS ── */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line bg-white p-0.5">
          {([['units', 'Units', LayoutGrid], ['people', 'People', Users]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => pickMode(k as any)}
              className={'px-3 py-1.5 rounded-[10px] text-[12.5px] font-bold inline-flex items-center gap-1.5 ' +
                (mode === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder={mode === 'units' ? 'Find a unit, a task, a name…' : 'Find a person…'}
            className="w-full rounded-xl border border-line bg-white pl-7 pr-7 py-1.5 text-[12.5px] focus:outline-none focus:border-ink" />
          {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={12} /></button>}
        </div>
        <button onClick={() => setActiveOnly(a => !a)}
          className={'px-2.5 py-1.5 rounded-xl border text-[12px] font-bold ' + (activeOnly ? 'bg-ink border-ink text-white' : 'bg-white border-line text-muted hover:text-ink')}>
          {activeOnly ? 'Active' : 'All'}
        </button>
        {cat && (
          <button onClick={() => setCat(null)}
            className={'px-2.5 py-1.5 rounded-xl border text-[12px] font-bold inline-flex items-center gap-1 ' + CAT_BY[cat].soft}>
            {CAT_BY[cat].label} <X size={11} />
          </button>
        )}
        <button onClick={() => onAddTask('')}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-1.5 text-[12.5px] font-bold hover:opacity-90">
          <Plus size={13} /> Add
        </button>
      </div>

      {/* ── HEADER + ROWS ── */}
      <div className="mt-2.5 rounded-2xl border border-line bg-white overflow-hidden">
        <div className="hidden lg:grid grid-cols-12 gap-3 px-3 py-2 bg-app border-b border-line text-[10px] font-bold uppercase tracking-wider text-muted">
          <div className="col-span-3 pl-5">{mode === 'units' ? 'Property' : 'Person'}</div>
          <div className="col-span-3">{mode === 'units' ? 'Reservation' : 'Load today'}</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-3">Tasks today</div>
          <div className="col-span-1 text-right">Issues</div>
        </div>
        {shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted">
            {rows.length === 0 ? 'Nothing on the board for today yet.' : 'Nothing matches. Clear the filters to see the rest.'}
          </div>
        ) : shown.map(r => (
          <GridRow key={r.key} row={r} roster={roster} mode={mode} onRefresh={onRefresh} onAdd={onAddTask} />
        ))}
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {shown.length} {mode === 'units' ? 'unit' : 'person'}{shown.length === 1 ? '' : 's'} shown ·
        squares are the day&rsquo;s tasks, filled when finished · tap a row to open it, tap a square to open the task in Breezeway.
        {' '}Guest issues and glitches count everything still open, not only what is scheduled today &mdash; they stay open until somebody fixes them.
      </p>
    </div>
  )
}

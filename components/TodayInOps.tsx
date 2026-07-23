'use client'
// Today in Ops — the day's workflow, organised BY UNIT. One card per unit shows every activity
// on it today (strip, departure clean, inspection, maintenance) so a coordinator manages the
// unit, not four separate lists. Departure cleans are tracked against the 4pm check-in deadline.
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, AlertTriangle, Plus, Clock, DoorOpen, ChevronUp, ChevronDown, ListChecks, X, ClipboardCheck } from 'lucide-react'

type Task = { id: string; listingId: string; unit: string; market: string; dept: string; type: string; name: string; status: string; assignees: string[]; startedAt: string | null; finishedAt: string | null; minutes: number | null; reportUrl: string | null; done: boolean; running: boolean; clocked: boolean; late: boolean; atRisk: boolean; missed: boolean; untracked?: boolean }
type Qc = { issue: string; status: string; reportUrl: string | null }
type Unit = { listingId: string; unit: string; market: string; guestOut: string | null; sameDayTurn: boolean; qc: Qc[]; tasks: Task[]; late: boolean; atRisk: boolean; unassigned: boolean; allDone: boolean; openTasks: number; untracked?: boolean ; city?: string | null; lat?: number | null; lng?: number | null }
type Deadline = { dueBy: string; minsLeft: number; passed: boolean; cleans: number; done: number; running: number; remaining: number; late: number; atRisk: number; missed: number; untracked?: number }
type Person = { id: number; name: string; departments: string[] }
type Vacant = { listingId: string; unit: string; market: string; leftToday: string | null; nextArrival: string | null; openTasks: number }
type Data = { ok: boolean; today: string; isToday?: boolean; lastSync?: string | null; deadline: Deadline; totals: any; byMarket: any[]; units: Unit[]; vacants?: Vacant[]; error?: string }

const TYPE_LABEL: Record<string, string> = {
  departure_clean: 'Departure clean', strip: 'Strip', deep_clean: 'Deep clean', inspection: 'Inspection',
  audit: 'Audit', pm: 'PM', field: 'Field-reported', pool_pest: 'Pool / Pest', maintenance: 'Maintenance', other: 'Other',
}
const TYPE_CLS: Record<string, string> = {
  departure_clean: 'bg-brand-50 text-brand-700 border-brand-200',
  strip: 'bg-sky-50 text-sky-700 border-sky-200',
  deep_clean: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  inspection: 'bg-violet-50 text-violet-700 border-violet-200',
  audit: 'bg-violet-50 text-violet-700 border-violet-200',
  pm: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  field: 'bg-rose-50 text-rose-700 border-rose-200',
  pool_pest: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  maintenance: 'bg-amber-50 text-amber-700 border-amber-200',
  other: 'bg-app text-muted border-line',
}
const DEPTS = [['maintenance', 'Maintenance'], ['housekeeping', 'Housekeeping'], ['inspection', 'Inspection'], ['safety', 'Safety']] as const
const PRIOS = [['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent'], ['low', 'Low']] as const

// Breezeway ADMIN task view (where you can actually edit/assign). report_url is the field report.
function adminUrl(taskId: string) { return 'https://app.breezeway.io/task/' + taskId }
function hhmm(iso: string | null) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return ''; return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
function fmtDay(iso: string) { const d = new Date(iso + 'T12:00:00'); if (isNaN(d.getTime())) return iso; return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function shiftDay(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function fmtLeft(m: number) { const a = Math.abs(m); const h = Math.floor(a / 60); const mm = a % 60; return (h ? h + 'h ' : '') + mm + 'm' }
function statusCls(t: Task) {
  if (t.untracked && !t.done) return 'bg-app text-muted border-line'
  if (t.done) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (t.late) return 'bg-rose-100 text-rose-800 border-rose-300'
  if (t.running) return 'bg-sky-50 text-sky-700 border-sky-200'
  if (t.atRisk) return 'bg-amber-100 text-amber-800 border-amber-300'
  return 'bg-app text-muted border-line'
}
function statusText(t: Task) {
  if (t.untracked && !t.done) return 'Vendor'
  if (t.done) return t.missed ? 'Done (after 4pm)' : 'Done'
  if (t.late) return 'LATE'
  if (t.running) return 'In progress'
  if (t.atRisk) return 'At risk'
  return 'Not started'
}

// Order units by LOCATION: group by city (Pompano vs Fort Lauderdale), and within each city put
// the properties closest to each other next to each other (nearest-neighbour chain on lat/lng).
function dist2(a: Unit, b: Unit) { const dx = Number(a.lat) - Number(b.lat); const dy = Number(a.lng) - Number(b.lng); return dx * dx + dy * dy }
function sortByArea(list: Unit[]): Unit[] {
  const byCity: Record<string, Unit[]> = {}
  for (const u of list) { const c = u.city || 'Other'; if (!byCity[c]) byCity[c] = []; byCity[c].push(u) }
  const cities = Object.keys(byCity).sort()
  const out: Unit[] = []
  for (const c of cities) {
    const geo = byCity[c].filter(u => u.lat != null && u.lng != null)
    const rest = byCity[c].filter(u => u.lat == null || u.lng == null)
    if (geo.length) {
      const ordered: Unit[] = [geo[0]]
      const remaining = geo.slice(1)
      while (remaining.length) {
        const last = ordered[ordered.length - 1]
        let bi = 0, bd = Infinity
        for (let i = 0; i < remaining.length; i++) { const dd = dist2(last, remaining[i]); if (dd < bd) { bd = dd; bi = i } }
        ordered.push(remaining.splice(bi, 1)[0])
      }
      for (const u of ordered) out.push(u)
    }
    for (const u of rest) out.push(u)
  }
  return out
}

export function TodayInOps() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')
  const [showDone, setShowDone] = useState(false)
  const [addFor, setAddFor] = useState('')
  const [itemsFor, setItemsFor] = useState('')
  const [tf, setTf] = useState('all')  // click a stat card to filter to that kind of work
  const [people, setPeople] = useState<Person[]>([])
  const [showVacant, setShowVacant] = useState(false)
  const [groupBy, setGroupBy] = useState<'urgency' | 'area'>('urgency')
  const [taskOrder, setTaskOrder] = useState<Record<string, string[]>>({})
  const [addVacant, setAddVacant] = useState('')
  const [dateSel, setDateSel] = useState('')  // '' = today

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/ops-today' + (dateSel ? '?date=' + dateSel : ''), { cache: 'no-store' })
      const j: Data = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [dateSel])

  useEffect(() => { load() }, [load])
  // roster for assigning — fetched once, filtered per task department
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setPeople(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5 * 60 * 1000); return () => clearInterval(t) }, [load])
  // manual task order (up/down arrows), persisted per day in the browser
  useEffect(() => { try { const raw = localStorage.getItem('ops_taskorder_' + (data && data.today ? data.today : '')); if (raw) setTaskOrder(JSON.parse(raw)) } catch {} }, [data && data.today])

  if (loading && !data) return <div className="text-sm text-muted py-10 text-center">Loading today&rsquo;s operations&hellip;</div>
  if (err) return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>
  if (!data) return null

  // Never trust the payload shape: a deploy race (new page bundle + old API response) crashed this
  // page once already. Degrade to empty rather than throw.
  const srcUnits: Unit[] = Array.isArray(data.units) ? data.units : []
  const totals = data.totals || {}
  const inFilter = (t: Task) => tf === 'all'
    || (tf === 'cleans' && t.type === 'departure_clean')
    || (tf === 'strips' && t.type === 'strip')
    || (tf === 'maintenance' && t.dept === 'maintenance')
    || (tf === 'inspection' && t.dept === 'inspection')
    || (tf === 'unassigned' && t.assignees.length === 0 && !t.done)
    || (tf === 'running' && t.running && !t.done)
    || (tf === 'notstarted' && !t.done && !t.running)
  const vacAll: Vacant[] = Array.isArray(data.vacants) ? data.vacants : []
  const vacants = market === 'all' ? vacAll : vacAll.filter(x => x.market === market)
  const byMkt = market === 'all' ? srcUnits : srcUnits.filter(u => u.market === market)
  const all = tf === 'all' ? byMkt : byMkt.map(u => Object.assign({}, u, { tasks: u.tasks.filter(inFilter) })).filter(u => u.tasks.length > 0)
  const baseUnits = showDone ? all : all.filter(u => !u.allDone)
  const units = groupBy === 'area' ? sortByArea(baseUnits) : baseUnits
  const doneCount = all.filter(u => u.allDone).length
  const markets = ['all'].concat((data.byMarket || []).map(m => m.market))
  const d: Deadline = data.deadline || ({ dueBy: '4:00 PM', minsLeft: 0, passed: false, cleans: 0, done: 0, running: 0, remaining: 0, late: 0, atRisk: 0, missed: 0 } as Deadline)
  const behind = d.late > 0 || d.atRisk > 0
  // apply the saved manual order to a unit's tasks (falls back to the API order)
  const orderedTasks = (u: Unit): Task[] => {
    const ids = taskOrder[u.listingId]
    // Default: not-completed work on top, finished sinks (stable). Manual arrows override.
    if (!ids || !ids.length) return u.tasks.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
    const pos: Record<string, number> = {}
    ids.forEach((id, i) => { pos[id] = i })
    return u.tasks.slice().sort((a, b) => (pos[a.id] == null ? 999 : pos[a.id]) - (pos[b.id] == null ? 999 : pos[b.id]))
  }
  const vendorFlag = async (t: Task) => {
    const on = !/vendor needed/i.test(t.name)
    try {
      const r = await fetch('/api/ops-today/task-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, action: 'vendor', on }) })
      const j = await r.json(); if (!r.ok || !j.ok) { setErr(j.error || 'Could not update'); return }
      load()
    } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const delTask = async (t: Task) => {
    if (!window.confirm('Delete \u201c' + t.name + '\u201d on ' + t.unit + ' from Breezeway?')) return
    try {
      const r = await fetch('/api/ops-today/task-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, action: 'delete' }) })
      const j = await r.json(); if (!r.ok || !j.ok) { setErr(j.error || 'Could not delete'); return }
      load()
    } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const moveTask = (u: Unit, taskId: string, dir: number) => {
    const cur = orderedTasks(u).map(t => t.id)
    const i = cur.indexOf(taskId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= cur.length) return
    const tmp = cur[i]; cur[i] = cur[j]; cur[j] = tmp
    const next = Object.assign({}, taskOrder, { [u.listingId]: cur })
    setTaskOrder(next)
    try { localStorage.setItem('ops_taskorder_' + (data && data.today ? data.today : ''), JSON.stringify(next)) } catch {}
  }

  return (
    <div>
      {/* searchable assignee options — the FULL roster, so search finds anyone regardless of the task's department */}
      <datalist id="ppl-all">
        {people.map(p => <option key={p.id} value={p.name + (p.departments && p.departments.length ? ' (' + p.departments.join('/') + ')' : '')} />)}
      </datalist>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {markets.map(m => (
          <button key={m} onClick={() => setMarket(m)} className={'text-sm font-medium px-3 py-1.5 rounded-lg border transition ' + (market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
        ))}
        <button onClick={() => setShowDone(!showDone)} className="text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white text-muted hover:bg-app">{showDone ? 'Hide finished' : 'Show finished (' + doneCount + ')'}</button>
        <button onClick={() => setGroupBy(groupBy === 'area' ? 'urgency' : 'area')} className={'text-sm font-medium px-3 py-1.5 rounded-lg border ' + (groupBy === 'area' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>{groupBy === 'area' ? 'By area' : 'Sort by area'}</button>
        <span className="ml-auto inline-flex items-center gap-1">
          <button onClick={() => { setDateSel(shiftDay(data.today, -1)); setLoading(true) }} title="Previous day" className="text-sm font-medium px-2 py-1.5 rounded-lg border border-line bg-white hover:bg-app">&lsaquo;</button>
          <input type="date" value={data.today} onChange={e => { if (e.target.value) { setDateSel(e.target.value); setLoading(true) } }} className="text-sm border border-line rounded-lg px-2 py-1.5 bg-white" />
          <button onClick={() => { setDateSel(shiftDay(data.today, 1)); setLoading(true) }} title="Next day" className="text-sm font-medium px-2 py-1.5 rounded-lg border border-line bg-white hover:bg-app">&rsaquo;</button>
          {data.isToday === false && <button onClick={() => { setDateSel(''); setLoading(true) }} className="text-sm font-medium px-2.5 py-1.5 rounded-lg border border-ink bg-ink text-white">Back to today</button>}
        </span>
        <button onClick={() => { setLoading(true); load() }} className="text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refresh</button>
      </div>

      {/* THE CLOCK: departure cleans must be finished by 4pm (next check-in) */}
      <div className={'rounded-2xl border p-4 mb-4 ' + (d.late > 0 ? 'border-rose-300 bg-rose-50' : d.atRisk > 0 ? 'border-amber-300 bg-amber-50' : 'border-line bg-white')}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock size={16} className={d.late > 0 ? 'text-rose-700' : d.atRisk > 0 ? 'text-amber-700' : 'text-muted'} />
            <span className="font-semibold text-ink">Departure cleans &middot; due by {d.dueBy}</span>
            <span className="text-sm text-muted">{data.isToday === false ? 'planning ' + fmtDay(data.today) : d.passed ? fmtLeft(d.minsLeft) + ' past deadline' : fmtLeft(d.minsLeft) + ' left'}</span>
          </div>
          <div className="text-sm font-medium text-ink">{d.done} of {d.cleans} done{d.running ? ' · ' + d.running + ' in progress' : ''}{d.remaining ? ' · ' + d.remaining + ' to go' : ''}</div>
        </div>
        <div className="mt-2 h-2 rounded-full bg-app overflow-hidden">
          <div className={'h-full ' + (d.late > 0 ? 'bg-rose-500' : 'bg-emerald-500')} style={{ width: (d.cleans ? Math.round((d.done / d.cleans) * 100) : 0) + '%' }} />
        </div>
        {behind && (
          <div className={'mt-3 text-sm font-semibold inline-flex items-center gap-1.5 ' + (d.late > 0 ? 'text-rose-800' : 'text-amber-800')}>
            <AlertTriangle size={14} />
            {d.late > 0 ? 'RUNNING BEHIND — ' + d.late + ' clean' + (d.late > 1 ? 's' : '') + ' past the 4pm deadline' : d.atRisk + ' clean' + (d.atRisk > 1 ? 's' : '') + ' at risk of missing 4pm'}
          </div>
        )}
        {d.missed > 0 && <div className="mt-1 text-xs text-muted">{d.missed} finished after 4pm today</div>}
        {(d.untracked || 0) > 0 && <div className="mt-1 text-xs text-muted">Excludes {d.untracked} vendor-cleaned unit{(d.untracked || 0) > 1 ? 's' : ''} (Botanica) — the vendor doesn&rsquo;t close tasks in Breezeway, so they can&rsquo;t be tracked against 4pm.</div>}
      </div>

      {/* stat cards double as filters — click Maintenance to see only maintenance, etc. */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 mb-5">
        <Stat label="All work" value={srcUnits.length + ''} sub={(totals.tasks || 0) + ' tasks'} active={tf === 'all'} onClick={() => setTf('all')} />
        <Stat label="Cleans" value={d.cleans + ''} sub={d.done + ' done'} active={tf === 'cleans'} onClick={() => setTf('cleans')} />
        <Stat label="Strips" value={(totals.strips || 0) + ''} active={tf === 'strips'} onClick={() => setTf('strips')} />
        <Stat label="Maintenance" value={(totals.maintenance || 0) + ''} active={tf === 'maintenance'} onClick={() => setTf('maintenance')} />
        <Stat label="Inspections" value={(totals.inspection || 0) + ''} active={tf === 'inspection'} onClick={() => setTf('inspection')} />
        <Stat label="In progress" value={(totals.running || 0) + ''} active={tf === 'running'} onClick={() => setTf('running')} />
        <Stat label="Not started" value={(totals.notStarted || 0) + ''} sub={(totals.done || 0) + ' done'} active={tf === 'notstarted'} onClick={() => setTf('notstarted')} />
        <Stat label="Unassigned" value={(totals.unassigned || 0) + ''} warn={(totals.unassigned || 0) > 0} active={tf === 'unassigned'} onClick={() => setTf('unassigned')} />
      </div>

      {units.length === 0 && <div className="text-sm text-muted py-10 text-center">Nothing outstanding{market === 'all' ? '' : ' in ' + market} right now.</div>}

      {/* VACANT UNITS — safe to work in. Conservative by design: anything with a live reservation
          spanning today (including arrivals today) is treated as occupied and never listed here. */}
      <div className="rounded-2xl border border-line bg-white mb-3 overflow-hidden">
        <button onClick={() => setShowVacant(!showVacant)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
          <DoorOpen size={15} className="text-muted" />
          <span className="font-semibold text-ink text-sm">Vacant units</span>
          <span className="text-xs text-muted">{vacants.length} empty{market === 'all' ? '' : ' in ' + market} &middot; free to work in</span>
          <span className="ml-auto text-xs text-muted">{data.lastSync ? 'reservations synced ' + hhmm(data.lastSync) : 'sync time unknown'}</span>
          <span className="text-muted text-xs">{showVacant ? '\u25b2' : '\u25bc'}</span>
        </button>
        {showVacant && (
          <div className="border-t border-line">
            <div className="px-4 py-2 text-[11px] text-muted bg-app">Empty per Guesty as of the sync above. A unit is only listed when no live reservation covers today &mdash; guests arriving today are treated as occupied.</div>
            {vacants.length === 0 && <div className="px-4 py-4 text-sm text-muted">No vacant units{market === 'all' ? '' : ' in ' + market} today.</div>}
            <div className="divide-y divide-line">
              {vacants.map(vu => (
                <div key={vu.listingId}>
                  <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate">{vu.unit}</div>
                      <div className="text-xs text-muted">{vu.market}{vu.leftToday ? ' · checked out today' : ''}{vu.openTasks ? ' · ' + vu.openTasks + ' task' + (vu.openTasks > 1 ? 's' : '') + ' today' : ''}</div>
                    </div>
                    <div className="text-xs text-muted shrink-0">{vu.nextArrival ? 'next in ' + fmtDay(vu.nextArrival) : 'no upcoming booking'}</div>
                    <button onClick={() => setAddVacant(addVacant === vu.listingId ? '' : vu.listingId)} className="text-xs font-medium px-2 py-1 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1 shrink-0"><Plus size={12} /> Add task</button>
                  </div>
                  {addVacant === vu.listingId && <AddTask listingId={vu.listingId} unit={vu.unit} date={data.today} onDone={() => { setAddVacant(''); load() }} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <AuditsDue market={market} />

      <div className="space-y-3">
        {units.map(u => (
          <div key={u.listingId} className={'rounded-2xl border bg-white overflow-hidden ' + (u.late ? 'border-rose-300' : u.atRisk ? 'border-amber-300' : 'border-line')}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-app/60 flex-wrap">
              <span className="font-semibold text-ink">{u.unit}</span>
              <span className="text-xs text-muted">{u.market}</span>
              {u.city && <span className="text-xs text-muted">&middot; {u.city}</span>}
              {u.sameDayTurn && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">Same-day turn</span>}
              {u.untracked && <span title="Vendor-cleaned. The vendor doesn't close tasks in Breezeway, so status here isn't reliable and these aren't tracked against 4pm." className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-app text-muted border border-line">Vendor clean</span>}
              {u.guestOut && <span className="text-xs text-muted">out: {u.guestOut}</span>}
              {u.qc.map((q, i) => (
                <span key={i} className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">QC: {q.issue}</span>
              ))}
              <span className={'ml-auto text-xs font-medium ' + (u.allDone ? 'text-emerald-700' : 'text-muted')}>{u.allDone ? 'All done' : u.tasks.filter(t => t.done).length + '/' + u.tasks.length + ' done'}</span>
              <button onClick={() => setItemsFor(itemsFor === u.listingId ? '' : u.listingId)} className={'text-xs font-medium px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1 ' + (itemsFor === u.listingId ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-app')}>{itemsFor === u.listingId ? <><X size={12} /> Hide items</> : <><ListChecks size={12} /> Open items</>}</button>
              <button onClick={() => setAddFor(addFor === u.listingId ? '' : u.listingId)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1"><Plus size={12} /> Add task</button>
            </div>
            <div className="divide-y divide-line">
              {orderedTasks(u).map((t, ti, arr) => (
                <div key={t.id} className={'flex items-center gap-3 px-4 py-3 text-sm ' + (t.done ? 'bg-emerald-50/40' : t.late ? 'bg-rose-50/50' : t.atRisk ? 'bg-amber-50/40' : '')}>
                  <div className="flex flex-col shrink-0 -my-1 text-muted">
                    <button onClick={() => moveTask(u, t.id, -1)} disabled={ti === 0} title="Move up" className="hover:text-ink disabled:opacity-20 leading-none p-1"><ChevronUp size={16} /></button>
                    <button onClick={() => moveTask(u, t.id, 1)} disabled={ti === arr.length - 1} title="Move down" className="hover:text-ink disabled:opacity-20 leading-none p-1"><ChevronDown size={16} /></button>
                  </div>
                  <span className={'text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border shrink-0 w-28 text-center ' + (TYPE_CLS[t.type] || TYPE_CLS.other)}>{TYPE_LABEL[t.type] || 'Task'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-ink truncate">{t.name}</div>
                    <div className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
                      <Assign task={t} people={people} onDone={load} />
                      <span>{t.finishedAt ? '· done ' + hhmm(t.finishedAt) : t.startedAt ? '· started ' + hhmm(t.startedAt) : ''}{t.minutes ? ' · ' + t.minutes + 'm' : ''}</span>
                    </div>
                  </div>
                  <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ' + statusCls(t)}>{statusText(t)}</span>
                  <a href={adminUrl(t.id)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline shrink-0">admin</a>
                  {t.reportUrl && <a href={t.reportUrl} target="_blank" rel="noreferrer" className="text-xs text-muted hover:underline shrink-0">report</a>}
                  {!t.done && <button onClick={() => vendorFlag(t)} title={/vendor needed/i.test(t.name) ? 'Vendor flag is ON \u2014 click to remove (task becomes billable-checkable again)' : 'Flag that a VENDOR is needed \u2014 adds it to the task title so it is tracked and not billed to the owner'} className={'text-[10px] font-semibold px-1.5 py-1 rounded border shrink-0 ' + (/vendor needed/i.test(t.name) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-violet-700 border-violet-300 hover:bg-violet-50')}>{/vendor needed/i.test(t.name) ? 'Vendor \u2713' : 'Vendor'}</button>}
                  {!t.done && t.type !== 'departure_clean' && t.type !== 'strip' && <button onClick={() => delTask(t)} title="Delete this task from Breezeway (cleans can only be deleted on the scheduler with the admin password)" className="text-xs font-semibold text-muted hover:text-rose-700 shrink-0 px-1 py-1">\u2715</button>}
                </div>
              ))}
            </div>
            {addFor === u.listingId && <AddTask listingId={u.listingId} unit={u.unit} date={data.today} onDone={() => { setAddFor(''); load() }} />}
            {itemsFor === u.listingId && <UnitItems listingId={u.listingId} unit={u.unit} people={people} onDone={load} onClose={() => setItemsFor('')} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ANNUAL AUDITS DUE — units whose last completed quality audit is >1 year old (or never).
// One click files the Annual Quality Audit in Breezeway (explicit click only, never automatic).
function AuditsDue({ market }: { market: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [created, setCreated] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!open || data) return
    fetch('/api/ops-today/audits-due', { cache: 'no-store' }).then(r => r.json()).then(setData).catch(() => {})
  }, [open, data])
  const rows = ((data && data.due) || []).filter((x: any) => market === 'all' || x.market === market)
  const createAudit = async (listingId: string, unit: string) => {
    setBusy(listingId); setMsg('')
    try {
      const description = 'Annual quality audit (done once per year): score the unit against the standard checklist, log any damage or wear, confirm inventory counts, and photograph anything below standard.'
      const r = await fetch('/api/ops-today/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, title: 'Annual Quality Audit', department: 'inspection', priority: 'normal', description }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setMsg(j.error || 'Could not create for ' + unit); setBusy(''); return }
      setCreated(prev => Object.assign({}, prev, { [listingId]: true }))
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy('')
  }
  const count = data ? rows.filter((x: any) => !created[x.listingId]).length : null
  return (
    <div className="rounded-2xl border border-line bg-white mb-3 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
        <ClipboardCheck size={15} className="text-muted" />
        <span className="font-semibold text-ink text-sm">Annual audits due</span>
        <span className="text-xs text-muted">{data ? count + ' unit' + (count === 1 ? '' : 's') + ' past 1 year (or never audited)' : 'quality audit once a year per unit'}</span>
        <span className="ml-auto text-muted text-xs">{open ? '\u25b2' : '\u25bc'}</span>
      </button>
      {open && (
        <div className="border-t border-line">
          {!data && <div className="px-4 py-4 text-sm text-muted">Checking audit history\u2026</div>}
          {data && rows.length === 0 && <div className="px-4 py-4 text-sm text-muted">Every unit{market === 'all' ? '' : ' in ' + market} has been audited within the last year. Nice.</div>}
          <div className="divide-y divide-line">
            {rows.map((x: any) => (
              <div key={x.listingId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-ink truncate">{x.unit}</div>
                  <div className="text-xs text-muted">{x.market} &middot; {x.lastAudit ? 'last audit ' + fmtShort(x.lastAudit) + ' (' + Math.round((x.ageDays || 0) / 30) + ' months ago)' : 'never audited'}</div>
                </div>
                {created[x.listingId]
                  ? <span className="text-xs font-medium text-emerald-700 shrink-0">Created in Breezeway \u2713</span>
                  : <button onClick={() => createAudit(x.listingId, x.unit)} disabled={busy === x.listingId} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40 shrink-0">{busy === x.listingId ? 'Creating\u2026' : 'Create audit'}</button>}
              </div>
            ))}
          </div>
          {msg && <div className="px-4 py-2 text-xs text-rose-700">{msg}</div>}
        </div>
      )}
    </div>
  )
}

// Smart Add Task: pick WHY, and the task builds itself — standard template for that kind of work,
// plus unit-specific things to look at pulled from recent guest feedback (reuses /api/schedule/listing-ops,
// the same intel engine the scheduler ops panel + Push already use).
type Intel = { inspection?: { recommended: boolean; reasons: string[] }; lastFeedback?: { rating: number | null; guest: string | null; date: string | null; excerpt: string | null } | null; checklist?: string[] }
const TEMPLATES: { key: string; label: string; department: string; priority: string; title: string; base: string; useIntel?: boolean }[] = [
  { key: 'inspection', label: 'Inspection', department: 'inspection', priority: 'high', title: 'Unit Check', useIntel: true, base: 'Standard unit inspection: cleanliness vs. the photos, damage / wear, all amenities present and working, consumables restocked, photos still match reality.' },
  { key: 'audit', label: 'Quality audit', department: 'inspection', priority: 'normal', title: 'Annual Quality Audit', useIntel: true, base: 'Annual quality audit (done once per year): score the unit against the standard checklist, log any damage or wear, confirm inventory counts, and photograph anything below standard.' },
  { key: 'feedback', label: 'Audit from guest feedback', department: 'inspection', priority: 'high', title: 'Guest-feedback inspection', useIntel: true, base: 'Inspection raised from guest feedback. Verify and fix what guests reported.' },
  { key: 'batteries', label: 'Lock batteries', department: 'maintenance', priority: 'normal', title: 'Replace lock batteries', base: 'Annual lock battery replacement. Replace batteries in every door lock, re-test the lock and codes afterwards, and log the date.' },
  { key: 'acfilter', label: 'A/C filter', department: 'maintenance', priority: 'normal', title: 'Change A/C filter', base: 'Change the central A/C filter. Note the filter size used and log the date.' },
  { key: 'pm', label: 'PM check', department: 'maintenance', priority: 'normal', title: 'Preventative Maintenance Task', base: 'Preventative maintenance pass: A/C, plumbing under sinks, water heater, smoke / CO detectors, light bulbs, door hardware.' },
]

function fmtShort(iso: string | null) { if (!iso) return '\u2014'; const d = new Date(iso + 'T12:00:00'); if (isNaN(d.getTime())) return iso; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) }
function UnitItems({ listingId, unit, people, onDone, onClose }: { listingId: string; unit: string; people: Person[]; onDone: () => void; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const reload = () => { fetch('/api/ops-today/unit-items?listingId=' + encodeURIComponent(listingId), { cache: 'no-store' }).then(r => r.json()).then(j => { setData(j); setLoading(false) }).catch(e => { setMsg(String(e)); setLoading(false) }) }
  useEffect(() => { reload() }, [listingId])
  const doToday = async (taskId: string) => {
    setBusy(taskId); setMsg('')
    try {
      const r = await fetch('/api/ops-today/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, listingId, date: data.today }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setMsg(j.error || 'Could not move'); setBusy(''); return }
      setMsg('Moved to today'); onDone(); reload()
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy('')
  }
  const assign = async (taskId: string, personId: number) => {
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, assigneeIds: [personId] }) })
      const j = await r.json(); if (!r.ok || !j.ok) { setMsg(j.error || 'Assign failed'); return }
      onDone(); reload()
    } catch (e: any) { setMsg(String(e?.message || e)) }
  }
  const addToToday = async (title: string, department: string) => {
    setBusy(title); setMsg('')
    try {
      const r = await fetch('/api/ops-today/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, title, department, date: data.today }) })
      const j = await r.json(); if (!r.ok || !j.ok) { setMsg(j.error || 'Could not add'); setBusy(''); return }
      setMsg('Added to today'); onDone(); reload()
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy('')
  }
  if (loading) return <div className="px-4 py-3 bg-app border-t border-line text-xs text-muted">Loading open items for {unit}…</div>
  const h = (data && data.history) || {}
  const open = (data && data.open) || []
  const suggested: { title: string; dept: string; kind: string }[] = []
  for (const q of (data && data.qc) || []) suggested.push({ title: 'QC: ' + q.issue, dept: q.dept || 'inspection', kind: 'QC' })
  for (const a of (data && data.audits) || []) suggested.push({ title: (a.kind ? a.kind[0].toUpperCase() + a.kind.slice(1) + ': ' : '') + a.title + (a.room ? ' (' + a.room + ')' : ''), dept: 'maintenance', kind: 'Audit' })
  const rec = data && data.recommended
  return (
    <div className="px-4 py-3 bg-app border-t border-line space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-muted font-medium">Open items — {unit}</div>
        <button onClick={onClose} className="text-xs font-medium px-2 py-1 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1 text-muted"><X size={12} /> Close</button>
      </div>
      <div className="text-[11px] text-muted flex flex-wrap gap-x-4 gap-y-1">
        <span>Last audit: <span className="text-ink font-medium">{fmtShort(h.lastAudit)}</span></span>
        <span>Last PM: <span className="text-ink font-medium">{fmtShort(h.lastPM)}</span></span>
        <span>Last batteries: <span className="text-ink font-medium">{fmtShort(h.lastBattery)}</span></span>
        {h.lastAcFilter && <span>Last A/C filter: <span className="text-ink font-medium">{fmtShort(h.lastAcFilter)}</span></span>}
      </div>
      {rec && rec.inspection && (rec.reasons || []).length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">Inspection recommended &middot; {(rec.reasons || []).join(' &middot; ')}</div>
      )}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Open non-clean work</div>
        {open.length === 0 && <div className="text-xs text-muted">Nothing open besides the clean.</div>}
        <div className="space-y-1">
          {open.map((it: any) => (
            <div key={it.id} className="flex items-center gap-2 text-sm bg-white border border-line rounded-lg px-2 py-1.5">
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-app text-muted border border-line shrink-0">{it.type}</span>
              <span className="flex-1 min-w-0 truncate text-ink">{it.title}</span>
              <span className="text-[11px] text-muted shrink-0">{it.onToday ? 'today' : fmtShort(it.scheduledDate)}</span>
              <input list="ppl-all" defaultValue="" placeholder={it.assignees.length ? it.assignees.join(', ') : 'assign\u2026'} onChange={e => { const inp = e.target as HTMLInputElement; const nm = inp.value.trim().replace(/\s*\([^)]*\)\s*$/, ''); const p = people.find(x => x.name === nm); if (p) { inp.value = ''; assign(it.id, p.id) } }} className="text-xs border border-line rounded px-2 py-1.5 w-[130px] shrink-0" />
              {!it.onToday && <button onClick={() => doToday(it.id)} disabled={busy === it.id} className="text-xs font-medium px-2 py-1 rounded bg-ink text-white disabled:opacity-40 shrink-0">{busy === it.id ? '\u2026' : 'Do today'}</button>}
            </div>
          ))}
        </div>
      </div>
      {suggested.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Suggested — add to today</div>
          <div className="flex flex-wrap gap-1.5">
            {suggested.map((sg, i) => (
              <button key={i} onClick={() => addToToday(sg.title, sg.dept)} disabled={busy === sg.title} className="text-xs px-2 py-1 rounded-lg border border-line bg-white hover:bg-app disabled:opacity-40 inline-flex items-center gap-1"><Plus size={11} />{sg.title}</button>
            ))}
          </div>
        </div>
      )}
      {msg && <div className="text-xs text-emerald-700">{msg}</div>}
    </div>
  )
}

function AddTask({ listingId, unit, date, onDone }: { listingId: string; unit: string; date?: string; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [department, setDepartment] = useState('maintenance')
  const [priority, setPriority] = useState('normal')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [intel, setIntel] = useState<Intel | null>(null)
  const [picked, setPicked] = useState('')

  useEffect(() => {
    fetch('/api/schedule/listing-ops?listingId=' + encodeURIComponent(listingId), { cache: 'no-store' })
      .then(r => r.json()).then(j => setIntel(j || null)).catch(() => {})
  }, [listingId])

  const pick = (key: string) => {
    const t = TEMPLATES.filter(x => x.key === key)[0]
    if (!t) return
    setPicked(key); setTitle(t.title); setDepartment(t.department); setPriority(t.priority)
    let body = t.base
    if (t.useIntel && intel) {
      const cl = intel.checklist || []
      if (cl.length) body += '\n\nLook specifically at (from this unit\u2019s recent guest feedback):\n' + cl.map(c => '- ' + c).join('\n')
      const lf = intel.lastFeedback
      if (lf && lf.excerpt) body += '\n\nLast guest feedback' + (lf.rating ? ' (' + lf.rating + '\u2605)' : '') + (lf.date ? ' ' + String(lf.date).slice(0, 10) : '') + ': \u201c' + String(lf.excerpt).slice(0, 240) + '\u201d'
    }
    setDescription(body)
  }

  const save = async () => {
    const t = title.trim()
    if (!t) return
    setBusy(true); setErr(''); setOk('')
    try {
      const r = await fetch('/api/ops-today/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, title: t, department, priority, description, date }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not create the task'); setBusy(false); return }
      setOk('Created in Breezeway')
      setTitle(''); setDescription(''); setPicked('')
      setTimeout(onDone, 700)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const rec = intel && intel.inspection && intel.inspection.recommended
  return (
    <div className="px-4 py-3 bg-app border-t border-line">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">Add a task to {unit} &mdash; what&rsquo;s the reason?</div>
      {rec && (intel!.inspection!.reasons || []).length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2 inline-block">Inspection recommended &middot; {(intel!.inspection!.reasons || []).join(' &middot; ')}</div>
      )}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {TEMPLATES.map(t => (
          <button key={t.key} onClick={() => pick(t.key)} className={'text-xs font-medium px-2.5 py-1 rounded-lg border transition ' + (picked === t.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:border-ink/30')}>{t.label}{t.key === 'inspection' && rec ? ' \u2022' : ''}</button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" className="flex-1 min-w-[200px] text-sm border border-line rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
        <select value={department} onChange={e => setDepartment(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-2 bg-white">
          {DEPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-2 bg-white">
          {PRIOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button onClick={save} disabled={busy || !title.trim()} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{busy ? 'Creating…' : 'Create in Breezeway'}</button>
      </div>
      {description && (
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} className="w-full mt-2 text-xs border border-line rounded-lg px-3 py-2 bg-white font-mono text-muted" />
      )}
      {err && <div className="text-xs text-rose-700 mt-2">{err}</div>}
      {ok && <div className="text-xs text-emerald-700 mt-2">{ok}</div>}
    </div>
  )
}

// Assign straight from the board — pick a person and it writes to Breezeway immediately.
// Roster is filtered to people in that task's department (or with no department set).
function Assign({ task, people, onDone }: { task: Task; people: Person[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const opts = people.filter(p => !p.departments || p.departments.length === 0 || p.departments.indexOf(task.dept) >= 0)
  const assign = async (id: number) => {
    if (!Number.isFinite(id)) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, assigneeIds: [id] }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Assign failed'); setBusy(false); return }
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const cur = task.assignees.length ? task.assignees.join(', ') : 'Unassigned'
  return (
    <span className="inline-flex items-center gap-1">
      <input
        list="ppl-all"
        defaultValue=""
        disabled={busy}
        placeholder={busy ? 'Saving…' : cur}
        onChange={e => { const inp = e.target as HTMLInputElement; const nm = inp.value.trim().replace(/\s*\([^)]*\)\s*$/, ''); const p = people.find(x => x.name === nm); if (p) { inp.value = ''; assign(p.id) } }}
        title={'Search a name to assign this ' + task.dept + ' task'}
        className={'text-xs rounded border px-2 py-1.5 bg-white w-[150px] ' + (task.assignees.length ? 'border-line text-ink placeholder:text-ink' : 'border-amber-300 text-amber-800 placeholder:text-amber-800 font-medium')}
      />
      {err && <span className="text-[10px] text-rose-700">{err}</span>}
    </span>
  )
}

function Stat({ label, value, sub, warn, active, onClick }: { label: string; value: string; sub?: string; warn?: boolean; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={'text-left w-full rounded-2xl border p-3 transition ' + (active ? 'border-ink ring-1 ring-ink/20 bg-white' : warn ? 'border-amber-200 bg-amber-50 hover:border-amber-300' : 'border-line bg-white hover:border-ink/30')}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={'text-2xl font-bold ' + (warn ? 'text-amber-800' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </button>
  )
}

// redeploy-nudge 2026-07-23

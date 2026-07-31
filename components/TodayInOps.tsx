'use client'
// Today in Ops — the day's workflow, organised BY UNIT. One card per unit shows every activity
// on it today (strip, departure clean, inspection, maintenance) so a coordinator manages the
// unit, not four separate lists. Departure cleans are tracked against the 4pm check-in deadline.
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { RefreshCw, AlertTriangle, Plus, Clock, DoorOpen, ChevronUp, ChevronDown, ListChecks, X, ClipboardCheck, MessageSquare, Search, MapPin } from 'lucide-react'
import CommentThread from '@/components/CommentThread'
import RowMenu, { type RowAction } from '@/components/RowMenu'
import { clusterAreas } from '@/lib/geo-areas'

type Task = { id: string; listingId: string; unit: string; market: string; market2?: string | null; dept: string; type: string; name: string; status: string; assignees: string[]; startedAt: string | null; finishedAt: string | null; minutes: number | null; reportUrl: string | null; done: boolean; running: boolean; clocked: boolean; late: boolean; atRisk: boolean; missed: boolean; untracked?: boolean; guestyOnly?: boolean }
type Qc = { issue: string; status: string; reportUrl: string | null }
type Unit = { listingId: string; unit: string; market: string; market2?: string | null; fullTasks?: Task[]; guestOut: string | null; sameDayTurn: boolean; nights?: number | null; arrivingNights?: number | null; arrivingGuest?: string | null; qc: Qc[]; tasks: Task[]; late: boolean; atRisk: boolean; unassigned: boolean; allDone: boolean; openTasks: number; untracked?: boolean; guestyOnly?: boolean; city?: string | null; address?: string | null; bedrooms?: number | null; building?: string | null; lat?: number | null; lng?: number | null }
type Deadline = { dueBy: string; minsLeft: number; passed: boolean; cleans: number; done: number; running: number; remaining: number; late: number; atRisk: number; missed: number; untracked?: number }
type Person = { id: number; name: string; departments: string[] }
type Vacant = { listingId: string; unit: string; market: string; market2?: string | null; leftToday: string | null; nextArrival: string | null; openTasks: number }
type BehindRow = { taskId: string; unit: string; market?: string | null; checkOutTime: string | null; arrivingAt: string | null; assignee: string | null }
type Behind = { notStarted: number; sameDay: number; earliestIn: string | null; unassigned: number; waiting: number; units: BehindRow[]; level: '' | 'warn' | 'urgent' }
type Data = { longStayNights?: number; areaRadiusKm?: number; ok: boolean; today: string; isToday?: boolean; lastSync?: string | null; deadline: Deadline; behind?: Behind; totals: any; byMarket: any[]; units: Unit[]; vacants?: Vacant[]; error?: string }

// TWO AXES, NOT ONE. "Not started" on its own returns every kind of task and is useless for finding
// a late clean; the question is always "departure cleans, not started" or "inspections, in progress".
// Every task falls in exactly ONE job bucket so the chip counts add up to the total.
const JOBS: Array<[string, string]> = [['all', 'All work'], ['departure_clean', 'Cleans'], ['strip', 'Strips'], ['inspection', 'Inspections'], ['maintenance', 'Maintenance'], ['other', 'Other']]
const STATUSES: Array<[string, string]> = [['all', 'Any'], ['notstarted', 'Not started'], ['running', 'In progress'], ['done', 'Done'], ['unassigned', 'Unassigned']]
function jobKey(t: Task): string {
  if (t.type === 'departure_clean' || t.type === 'deep_clean') return 'departure_clean'
  if (t.type === 'strip') return 'strip'
  if (t.type === 'inspection' || t.type === 'audit' || t.dept === 'inspection') return 'inspection'
  if (t.type === 'maintenance' || t.type === 'pm' || t.type === 'field' || t.dept === 'maintenance') return 'maintenance'
  return 'other'
}
function matchJob(t: Task, jf: string) { return jf === 'all' || jobKey(t) === jf }
// Unassigned is a status people ask for by name ("who has nobody on it") even though it overlaps
// not-started and in-progress — it is a chip, not a fifth exclusive bucket.
function matchStatus(t: Task, sf: string) {
  if (sf === 'all') return true
  // Vendor/Guesty-only rows have no Breezeway task — nobody can assign, start or finish them, so
  // they must not sit in the actionable chips (they made "Unassigned" permanently amber).
  if (t.guestyOnly) return false
  if (sf === 'unassigned') return t.assignees.length === 0 && !t.done
  if (sf === 'done') return t.done
  if (sf === 'running') return t.running && !t.done
  return !t.done && !t.running
}

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
export function TodayInOps() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')
  const [showDone, setShowDone] = useState(false)
  const [addFor, setAddFor] = useState('')
  const [itemsFor, setItemsFor] = useState('')
  // two independent filter axes: WHAT kind of job, and WHERE it stands
  const [jf, setJf] = useState('all')
  const [sf, setSf] = useState('all')
  const [people, setPeople] = useState<Person[]>([])
  const [panel, setPanel] = useState<'' | 'glitches' | 'vacant'>('')
  // 23 open guest issues older than the 14-day window were completely invisible — this is the door
  const [showOlder, setShowOlder] = useState(false)
  // active glitches live in the status strip — fetched here so the count shows without opening
  const [gl, setGl] = useState<any>(null)
  const [glStage, setGlStage] = useState<Record<string, string>>({})
  const [groupBy, setGroupBy] = useState<'urgency' | 'area'>('urgency')
  // One box to find anything on the day: unit, guest, cleaner, or task name.
  const [q, setQ] = useState('')
  // Comment threads on Breezeway tasks: which row is open + how many comments each row has,
  // so the team can talk about a task in the app and get the replies as notifications.
  const [cmtFor, setCmtFor] = useState('')
  const [cmtCounts, setCmtCounts] = useState<Record<string, number>>({})
  // Proactive unit signals: overdue Breezeway work, bad recent review, upkeep that has aged out.
  const [sig, setSig] = useState<Record<string, any>>({})
  const [actFor, setActFor] = useState('')      // listingId whose action panel is open
  const [actSeed, setActSeed] = useState<any>(null) // {template,title,reason} preloaded from a chip
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
  useEffect(() => {
    fetch('/api/ops-today/glitches', { cache: 'no-store' }).then(r => r.json()).then(setGl).catch(() => {})
    fetch('/api/glitches', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const m: Record<string, string> = {}
      for (const g of (j && Array.isArray(j.glitches) ? j.glitches : [])) if (g.breezeway_task_id) m[String(g.breezeway_task_id)] = STAGE_LABEL[g.status] || ''
      setGlStage(m)
    }).catch(() => {})
  }, [])
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5 * 60 * 1000); return () => clearInterval(t) }, [load])
  // manual task order (up/down arrows), persisted per day in the browser
  useEffect(() => { try { const raw = localStorage.getItem('ops_taskorder_' + (data && data.today ? data.today : '')); if (raw) setTaskOrder(JSON.parse(raw)) } catch {} }, [data && data.today])

  // Comment counts for the badge on each task row. MUST live above the early returns below:
  // a hook after a conditional return changes the hook count between renders (React #310).
  const taskIdKey = (data && Array.isArray((data as any).units) ? (data as any).units : [])
    .flatMap((u: any) => (Array.isArray(u && u.tasks) ? u.tasks : []).map((t: any) => String(t.id))).join(',')
  useEffect(() => {
    const ids = Array.from(new Set(taskIdKey.split(',').filter(Boolean))).slice(0, 300)
    if (!ids.length) { setCmtCounts({}); return }
    let alive = true
    fetch('/api/comments/counts?type=task&ids=' + encodeURIComponent(ids.join(',')), { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (alive && j && j.ok) setCmtCounts(j.counts || {}) }).catch(() => {})
    return () => { alive = false }
  }, [taskIdKey])

  // Signals ride on the same unit list; one call per board refresh, capped server-side.
  const listingKey = (data && Array.isArray((data as any).units) ? (data as any).units : []).map((u: any) => String(u.listingId)).join(',')
  useEffect(() => {
    const ids = Array.from(new Set(listingKey.split(',').filter(Boolean))).slice(0, 150)
    if (!ids.length) { setSig({}); return }
    let alive = true
    fetch('/api/ops-today/signals?ids=' + encodeURIComponent(ids.join(',')), { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (alive && j && j.ok) setSig(j.signals || {}) }).catch(() => {})
    return () => { alive = false }
  }, [listingKey])

  if (loading && !data) return <div className="text-sm text-muted py-10 text-center">Loading today&rsquo;s operations&hellip;</div>
  // A failure must never replace a working board (it used to eat the page, date picker and all).
  // No data yet -> error box WITH a retry. Data on screen -> the error renders as a banner below.
  if (!data) return (
    <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
      <span className="flex-1">{err || 'Could not load the board.'}</span>
      <button onClick={() => { setErr(''); setLoading(true); load() }} className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white border border-rose-200 hover:bg-rose-100">Retry</button>
    </div>
  )

  // Never trust the payload shape: a deploy race (new page bundle + old API response) crashed this
  // page once already. Degrade to empty rather than throw.
  const srcUnits: Unit[] = Array.isArray(data.units) ? data.units : []
  // ONE market rule: a vendor-cleaned unit belongs to its vendor bucket AND its geography
  // (Capri/Lucerne/Amrit under both North and Vendor — Jon's call, 2026-07-31).
  const inMkt = (m: any, m2: any) => market === 'all' || m === market || m2 === market
  const byMkt = srcUnits.filter(u => inMkt(u.market, u.market2))
  const glRows = ((gl && gl.glitches) || []).filter((g: any) => inMkt(g.market, g.market2))
  const vacAll: Vacant[] = Array.isArray(data.vacants) ? data.vacants : []
  const vacants = vacAll.filter(x => inMkt(x.market, x.market2))
  // THE "NOT STARTED" BAND — server-computed so the board and the ops alert agree, then narrowed
  // to the selected market so the band never names units from a tab you are not looking at.
  const bhAll: Behind | null = (data.behind && data.isToday !== false) ? data.behind : null
  let bh: Behind | null = bhAll
  if (bhAll && market !== 'all') {
    const rows = (bhAll.units || []).filter(r => r.market === market)
    bh = rows.length === 0 ? null : {
      notStarted: rows.length,
      sameDay: rows.filter(r => !!r.arrivingAt).length,
      earliestIn: (rows.find(r => !!r.arrivingAt) || ({} as any)).arrivingAt || null,
      unassigned: rows.filter(r => !r.assignee).length,
      waiting: 0, units: rows,
      level: rows.some(r => !!r.arrivingAt) ? 'urgent' : 'warn',
    }
  }
  // "Show them" filters to EXACTLY the cleans the band counted (checkout + grace has passed) —
  // a plain not-started filter showed more rows than the band's number and looked like a lie.
  const bhIds = new Set<string>((bh ? bh.units : []).map(r => r.taskId))
  const inFilter = (t: Task) => matchJob(t, jf) && (sf === 'behind' ? bhIds.has(t.id) : matchStatus(t, sf))
  // CHIPS COUNT THE BOARD YOU SEE. Finished-hiding and search apply FIRST, so a chip that says 12
  // gives you 12 rows when you press it. (They used to count every task in the market — the chips
  // said 111 while 56 tasks were on screen.)
  const needle = q.trim().toLowerCase()
  const hit = (u: Unit) => {
    if (!needle) return true
    const hay = [u.unit, u.guestOut || '', u.market, u.city || '', (u as any).arrivingGuest || '']
      .concat(u.tasks.map(t => t.name))
      .concat(u.tasks.flatMap(t => t.assignees))
      .join(' ').toLowerCase()
    return hay.includes(needle)
  }
  // asking for Done explicitly must show finished units, whatever the Finished toggle says
  const visUnits = byMkt.filter(u => (showDone || sf === 'done') ? true : !u.allDone).filter(hit)
  const visTasks: Task[] = visUnits.flatMap(u => u.tasks)
  const jobCount = (k: string) => visTasks.filter(t => (k === 'all' || jobKey(t) === k) && (sf === 'behind' ? bhIds.has(t.id) : matchStatus(t, sf))).length
  const statusCount = (k: string) => visTasks.filter(t => matchJob(t, jf) && matchStatus(t, k)).length
  const filtering = jf !== 'all' || sf !== 'all'
  // fullTasks keeps the unit's REAL day so progress ("3/5", the bar) never collapses to 0/1 when a
  // status chip narrows the visible rows.
  const all = !filtering ? visUnits : visUnits.map(u => Object.assign({}, u, { tasks: u.tasks.filter(inFilter), fullTasks: u.tasks })).filter(u => u.tasks.length > 0)
  // AREA = mini-market, worked out from real coordinates (a Broward building next to Eden belongs
  // with Eden, whatever city string Guesty carries). Each area is a run the team can drive.
  const areas = groupBy === 'area' ? clusterAreas(all as any, data.areaRadiusKm || 4) : []
  const units = groupBy === 'area' ? (areas.flatMap(a => a.units) as Unit[]) : all
  // Finished counts finished units in the MARKET (not the filtered view, where it was stuck at 0)
  const doneCount = byMkt.filter(u => u.allDone).length
  // hide market tabs that have nothing today (North sat dead for weeks) — but never hide the one
  // that is currently selected, or there would be no way to see why the board is empty
  const mktList = (data.byMarket || []).filter(m => (m.total || 0) > 0 || m.market === market).map(m => m.market)
  const markets = ['all'].concat(mktList)
  // THE TOP STRIP OBEYS THE MARKET TAB: pick Broward and the clean count is Broward's, not the
  // whole portfolio's. Recomputed from this market's tasks; the clock fields stay global.
  const dAll: Deadline = data.deadline || ({ dueBy: '4:00 PM', minsLeft: 0, passed: false, cleans: 0, done: 0, running: 0, remaining: 0, late: 0, atRisk: 0, missed: 0 } as Deadline)
  let d: Deadline = dAll
  if (market !== 'all') {
    const mt = byMkt.flatMap(u => u.tasks)
    const clk = mt.filter(t => t.clocked)
    d = {
      dueBy: dAll.dueBy, minsLeft: dAll.minsLeft, passed: dAll.passed,
      cleans: clk.length, done: clk.filter(t => t.done).length,
      running: clk.filter(t => t.running && !t.done).length, remaining: clk.filter(t => !t.done).length,
      late: clk.filter(t => t.late).length, atRisk: clk.filter(t => t.atRisk).length,
      missed: clk.filter(t => t.missed).length,
      untracked: mt.filter(t => t.type === 'departure_clean' && t.untracked).length,
    }
  }
  const behind = d.late > 0 || d.atRisk > 0
  const renderUnit = (u: Unit) => (
          <div key={u.listingId} className={'rounded-2xl border bg-white overflow-hidden ' + (u.late ? 'border-rose-300' : u.atRisk ? 'border-amber-300' : 'border-line')}>
            {/* HEADER — one line that says WHAT and HOW BAD, one quiet line that says WHERE. */}
            <div className="px-4 pt-2.5 pb-2 border-b border-line bg-app/60">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-[15px] text-ink leading-none">{u.unit}</span>
                {u.sameDayTurn && <span title="A guest checks in here today — this clean cannot slip" className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-600 text-white">Same-day turn</span>}
                {(() => {
                  const LS = data.longStayNights || 10
                  const n = Number(u.nights)
                  if (!Number.isFinite(n) || n <= 0) return null
                  if (n < LS) return null
                  return <span title={n + '-night stay just ended — heavier clean (laundry, kitchen, fridge, bins). Give it extra time.'} className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white">{n} nt long stay</span>
                })()}
                {(() => {
                  const LS = data.longStayNights || 10
                  const n = Number(u.arrivingNights)
                  if (!Number.isFinite(n) || n < LS) return null
                  return <span title={'Arriving today: ' + n + '-night booking' + (u.arrivingGuest ? ' (' + u.arrivingGuest + ')' : '') + ' — check the unit is fully ready.'} className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-600 text-white">{n} nt arrival {'\u00b7'} check ready</span>
                })()}
                {u.qc.map((q, i) => (
                  <span key={i} className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">QC: {q.issue}</span>
                ))}
                <SignalChips s={sig[u.listingId]} onAct={(seed: any) => { setActSeed(seed); setActFor(actFor === u.listingId && actSeed && seed && actSeed.key === seed.key ? '' : u.listingId) }} />
                <span className="ml-auto flex items-center gap-2">
                  <span className={'text-xs font-semibold tabular-nums ' + (u.allDone ? 'text-emerald-700' : u.late ? 'text-rose-700' : 'text-muted')}>{u.allDone ? 'All done' : (u.fullTasks || u.tasks).filter(t => t.done).length + '/' + (u.fullTasks || u.tasks).length}</span>
                  <button onClick={() => setItemsFor(itemsFor === u.listingId ? '' : u.listingId)} className={'text-xs font-medium px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1 ' + (itemsFor === u.listingId ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-app')}>{itemsFor === u.listingId ? <><X size={12} /> Hide items</> : <><ListChecks size={12} /> Open items</>}</button>
                  <button onClick={() => setAddFor(addFor === u.listingId ? '' : u.listingId)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1"><Plus size={12} /> Add task</button>
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-muted">
                <span>{u.market}</span>
                {u.city && <span>{'\u00b7'} {u.city}</span>}
                {u.bedrooms != null && <span>{'\u00b7'} {u.bedrooms === 0 ? 'Studio' : u.bedrooms + 'BR'}</span>}
                {u.nights != null && u.nights > 0 && <span>{'\u00b7'} {u.nights} nt stay</span>}
                {u.guestOut && <span>{'\u00b7'} out: <span className="text-ink/70">{u.guestOut}</span></span>}
                {u.untracked && <span title="Vendor-cleaned. The vendor does not close tasks in Breezeway, so status here is not reliable and these are not tracked against 4pm." className="text-slate-500">{'\u00b7'} vendor-cleaned</span>}
                {u.address && <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(u.address)} target="_blank" rel="noreferrer" title={u.address} className="hover:text-ink hover:underline inline-flex items-center gap-0.5">{'\u00b7'} <MapPin size={10} />map</a>}
              </div>
            </div>
            <div className="h-1 bg-app"><div className={'h-full transition-all ' + (u.late ? 'bg-rose-400' : u.atRisk ? 'bg-amber-400' : 'bg-emerald-500/70')} style={{ width: ((u.fullTasks || u.tasks).length ? Math.round(((u.fullTasks || u.tasks).filter(t => t.done).length / (u.fullTasks || u.tasks).length) * 100) : 0) + '%' }} /></div>
            <div className="divide-y divide-line">
              {orderedTasks(u).map((t, ti, arr) => (
                <div key={t.id} className={(t.done ? 'bg-emerald-50/40' : t.late ? 'bg-rose-50/50' : t.atRisk ? 'bg-amber-50/40' : '')}>
                <div className="group flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="flex flex-col shrink-0 -my-1 text-muted opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => moveTask(u, t.id, -1)} disabled={ti === 0} title="Move up" className="hover:text-ink disabled:opacity-20 leading-none p-1"><ChevronUp size={16} /></button>
                    <button onClick={() => moveTask(u, t.id, 1)} disabled={ti === arr.length - 1} title="Move down" className="hover:text-ink disabled:opacity-20 leading-none p-1"><ChevronDown size={16} /></button>
                  </div>
                  <span className={'text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border shrink-0 w-24 text-center ' + (TYPE_CLS[t.type] || TYPE_CLS.other)}>{TYPE_LABEL[t.type] || 'Task'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-ink truncate">{t.name}</div>
                    <div className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
                      {t.guestyOnly ? <span className="text-[11px] text-muted">Vendor-cleaned {'\u00b7'} no Breezeway task</span> : <Assign task={t} people={people} onDone={load} />}
                      <span>{t.finishedAt ? '· done ' + hhmm(t.finishedAt) : t.startedAt ? '· started ' + hhmm(t.startedAt) : ''}{t.minutes ? ' · ' + t.minutes + 'm' : ''}</span>
                    </div>
                  </div>
                  <span className={'text-[11px] font-bold px-2 py-0.5 rounded-md border shrink-0 ' + statusCls(t)}>{t.guestyOnly ? 'Vendor' : statusText(t)}</span>
                  {t.guestyOnly && <span title="This building is not in Breezeway - the checkout comes from Guesty and the vendor cleans it. Nothing to assign or track here." className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-300 shrink-0">Guesty only</span>}
                  {/vendor needed/i.test(t.name) && <span title="A vendor is needed on this task - it is tracked and not billed to the owner" className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-violet-600 text-white shrink-0">Vendor needed</span>}
                  <button onClick={() => setCmtFor(cmtFor === t.id ? '' : t.id)} title="Comment on this task — teammates you tag get a notification, and everyone on the thread hears about replies" className={'text-[10px] font-semibold px-1.5 py-1 rounded border shrink-0 inline-flex items-center gap-1 ' + (cmtFor === t.id ? 'bg-ink text-white border-ink' : cmtCounts[t.id] ? 'bg-sky-50 text-sky-700 border-sky-300' : 'bg-white text-muted border-line hover:bg-app opacity-70 group-hover:opacity-100')}><MessageSquare size={11} />{cmtCounts[t.id] ? cmtCounts[t.id] : ''}</button>
                  <RowMenu title={'Actions for ' + t.name} actions={taskActions(t)} />
                </div>
                {cmtFor === t.id && <div className="px-4 pb-3"><CommentThread type="task" id={String(t.id)} label={u.unit + ' — ' + t.name} link="/plan" taskId={t.guestyOnly ? '' : String(t.id)} onCount={n => setCmtCounts(prev => ({ ...prev, [t.id]: n }))} /></div>}
                </div>
              ))}
            </div>
            {actFor === u.listingId && <SignalPanel s={sig[u.listingId]} seed={actSeed} listingId={u.listingId} unit={u.unit} today={data.today} people={people} onClose={() => setActFor('')} onDone={() => { setActFor(''); load() }} />}
            {addFor === u.listingId && <AddTask listingId={u.listingId} unit={u.unit} date={data.today} onDone={() => { setAddFor(''); load() }} />}
            {itemsFor === u.listingId && <UnitItems listingId={u.listingId} unit={u.unit} people={people} onDone={load} onClose={() => setItemsFor('')} />}
          </div>
  )


  // apply the saved manual order to a unit's tasks (falls back to the API order)
  const orderedTasks = (u: Unit): Task[] => {
    const ids = taskOrder[u.listingId]
    // Default: not-completed work on top, finished sinks (stable). Manual arrows override.
    if (!ids || !ids.length) return u.tasks.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
    const pos: Record<string, number> = {}
    ids.forEach((id, i) => { pos[id] = i })
    return u.tasks.slice().sort((a, b) => (pos[a.id] == null ? 999 : pos[a.id]) - (pos[b.id] == null ? 999 : pos[b.id]))
  }
  // ONE MENU PER ROW, IN PLAIN ENGLISH. The row carried four more controls repeated down the page
  // (admin, report, Vendor, ✕) and every one of them named a system rather than an action. They all
  // still exist, one click deeper, with the destructive one alone at the bottom in red.
  const taskActions = (t: Task): RowAction[] => {
    const out: RowAction[] = []
    if (t.guestyOnly) return out      // vendor-cleaned: there is no Breezeway task to act on
    out.push({ key: 'admin', label: 'Open in Breezeway', hint: 'Edit, assign or change the task itself', href: adminUrl(t.id) })
    if (t.reportUrl) out.push({ key: 'report', label: 'View the field report', hint: 'Read-only - photos and checklist, safe to share', href: t.reportUrl })
    if (!t.done) {
      const on = /vendor needed/i.test(t.name)
      out.push({
        key: 'vendor',
        label: on ? 'Remove the vendor flag' : 'Flag that a vendor is needed',
        hint: on ? 'Goes back to being our own billable work' : 'Tracked as vendor work and not billed to the owner',
        onClick: () => vendorFlag(t),
      })
    }
    if (!t.done && t.type !== 'departure_clean' && t.type !== 'strip') {
      out.push({ key: 'delete', label: 'Delete this task', hint: 'Removes it from Breezeway - admin password required. Cleans are deleted on the scheduler.', onClick: () => delTask(t), danger: true })
    }
    return out
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
    // NOTHING deletes without the embedded admin password (set in Users & access).
    const adminPassword = window.prompt('Admin password required to delete \u201c' + t.name + '\u201d on ' + t.unit + ':')
    if (!adminPassword) return
    try {
      const r = await fetch('/api/ops-today/task-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, action: 'delete', adminPassword }) })
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
      {/* CONTROL BAR — everything you SET, one tidy line */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line shadow-soft">
          {markets.map(m => (
            <button key={m} onClick={() => setMarket(m)} className={'text-[13px] font-medium px-3 py-1.5 transition ' + (market === m ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
          ))}
        </span>
        <span className="inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line">
          <button onClick={() => setShowDone(!showDone)} disabled={sf !== 'all' && sf !== 'done'} className={'text-[13px] font-medium px-3 py-1.5 disabled:opacity-40 ' + (showDone ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')} title={sf !== 'all' && sf !== 'done' ? 'The status filter already decides what shows — clear it to use this' : 'Show or hide units where everything is already done'}>Finished {doneCount}</button>
          <button onClick={() => setGroupBy(groupBy === 'area' ? 'urgency' : 'area')} className={'text-[13px] font-medium px-3 py-1.5 ' + (groupBy === 'area' ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')} title="Group units by neighbourhood so runners drive less">By area</button>
        </span>
        <span className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, guest, cleaner, task…" title="Filters the board — matches the unit, the guest leaving or arriving, the person assigned, or the task name"
            className="text-[13px] pl-7 pr-7 py-1.5 rounded-lg border border-line bg-white w-60 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          {q && <button onClick={() => setQ('')} title="Clear" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={12} /></button>}
        </span>
        {q && <span className="text-[12px] text-muted">{units.length} match{units.length === 1 ? '' : 'es'}</span>}
        <span className="ml-auto inline-flex items-center rounded-lg border border-line overflow-hidden divide-x divide-line">
          <button onClick={() => { setDateSel(shiftDay(data.today, -1)); setLoading(true) }} title="Previous day" className="text-[13px] font-medium px-2.5 py-1.5 bg-white hover:bg-app">&lsaquo;</button>
          <input type="date" value={data.today} onChange={e => { if (e.target.value) { setDateSel(e.target.value); setLoading(true) } }} className="text-[13px] px-2 py-1.5 bg-white border-0 focus:outline-none" />
          <button onClick={() => { setDateSel(shiftDay(data.today, 1)); setLoading(true) }} title="Next day" className="text-[13px] font-medium px-2.5 py-1.5 bg-white hover:bg-app">&rsaquo;</button>
          {data.isToday === false && <button onClick={() => { setDateSel(''); setLoading(true) }} className="text-[13px] font-medium px-2.5 py-1.5 bg-ink text-white">Today</button>}
          <button onClick={() => { setLoading(true); load() }} title="Refresh" className="px-2.5 py-1.5 bg-white text-muted hover:bg-app hover:text-ink"><RefreshCw size={13} /></button>
        </span>
      </div>

      {/* STATUS STRIP — everything you READ, one card: cleans progress | glitches | vacant */}
      <div className={'rounded-2xl border mb-3 overflow-hidden bg-white ' + (d.late > 0 ? 'border-rose-300' : d.atRisk > 0 ? 'border-amber-300' : 'border-line')}>
        <div className="grid md:grid-cols-[1fr_auto_auto] divide-y md:divide-y-0 md:divide-x divide-line">
          <div className="px-4 py-3 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Clock size={14} className={d.late > 0 ? 'text-rose-700' : d.atRisk > 0 ? 'text-amber-700' : 'text-muted'} />
              <span className="font-semibold text-ink text-sm">Departure cleans</span>
              <span className="text-sm font-bold text-ink tabular-nums">{d.done}/{d.cleans}</span>
              <span className="text-[12px] text-muted">due {d.dueBy}{data.isToday === false ? ' \u00b7 planning ' + fmtDay(data.today) : d.passed ? ' \u00b7 ' + fmtLeft(d.minsLeft) + ' past' : ' \u00b7 ' + fmtLeft(d.minsLeft) + ' left'}</span>
              {behind && <span className={'text-[11px] font-bold px-1.5 py-0.5 rounded ' + (d.late > 0 ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')}>{d.late > 0 ? d.late + ' LATE' : d.atRisk + ' at risk'}</span>}
              {(d.missed > 0 || (d.untracked || 0) > 0) && <span className="ml-auto text-[11px] text-muted" title={(d.missed > 0 ? d.missed + ' finished after 4pm today. ' : '') + ((d.untracked || 0) > 0 ? 'Excludes ' + d.untracked + ' vendor-cleaned units (Botanica) \u2014 the vendor does not close tasks in Breezeway, so they cannot be tracked against 4pm.' : '')}>{d.missed > 0 ? d.missed + ' after 4pm' : ''}{(d.untracked || 0) > 0 ? (d.missed > 0 ? ' \u00b7 ' : '') + d.untracked + ' vendor-cleaned' : ''}</span>}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-app overflow-hidden">
              <div className={'h-full ' + (d.late > 0 ? 'bg-rose-500' : 'bg-emerald-500')} style={{ width: (d.cleans ? Math.round((d.done / d.cleans) * 100) : 0) + '%' }} />
            </div>
          </div>
          <button onClick={() => setPanel(panel === 'glitches' ? '' : 'glitches')} className={'px-5 py-3 text-left flex items-center gap-2 transition ' + (panel === 'glitches' ? 'bg-rose-50/70' : 'hover:bg-app/50')} title="Guest-reported problems happening right now \u2014 click to see them">
            <AlertTriangle size={14} className={glRows.length > 0 ? 'text-rose-700' : 'text-muted'} />
            <span className="text-sm font-semibold text-ink">Glitches</span>
            {glRows.length > 0 ? <span className="text-xs font-bold text-white bg-rose-600 rounded-full px-2 py-0.5">{glRows.length}</span> : <span className="text-xs text-muted">0</span>}
            <span className="text-muted text-[10px]">{panel === 'glitches' ? '\u25b2' : '\u25bc'}</span>
          </button>
          <button onClick={() => setPanel(panel === 'vacant' ? '' : 'vacant')} className={'px-5 py-3 text-left flex items-center gap-2 transition ' + (panel === 'vacant' ? 'bg-app/70' : 'hover:bg-app/50')} title={'Units empty today, safe to work in' + (data.lastSync ? ' \u00b7 reservations synced ' + hhmm(data.lastSync) : '')}>
            <DoorOpen size={14} className="text-muted" />
            <span className="text-sm font-semibold text-ink">Vacant</span>
            <span className="text-xs font-bold text-ink tabular-nums">{vacants.length}</span>
            <span className="text-muted text-[10px]">{panel === 'vacant' ? '\u25b2' : '\u25bc'}</span>
          </button>
        </div>
        {panel === 'glitches' && (
          <div className="border-t border-line">
            {glRows.length === 0 && <div className="px-4 py-4 text-sm text-muted">No active glitches{market === 'all' ? '' : ' in ' + market} right now.</div>}
            <div className="divide-y divide-line">
              {glRows.map((g: any) => (
                <div key={g.id} className="flex items-center gap-2.5 px-4 py-2.5 text-sm flex-wrap">
                  <span className="font-medium text-ink shrink-0">{g.unit}</span>
                  <span className="text-[13px] text-ink/80 flex-1 min-w-[160px] truncate">{g.issue}</span>
                  {glStage[g.id] && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 border-violet-200 shrink-0">{glStage[g.id]}</span>}
                  <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ' + (g.running ? 'bg-sky-50 text-sky-700 border-sky-200' : (g.ageDays || 0) >= 2 ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-200')}>{g.running ? 'In progress' : 'Open' + (g.ageDays ? ' \u00b7 ' + g.ageDays + 'd' : '')}</span>
                  <span className={'text-xs shrink-0 ' + (g.unassigned ? 'font-medium text-rose-700' : 'text-muted')}>{g.unassigned ? 'Unassigned' : (g.assignees || []).join(', ')}</span>
                  <a href={adminUrl(g.id)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline shrink-0" title="Open the admin task in Breezeway \u2014 edit, assign, check">admin</a>
                  {g.reportUrl && <a href={g.reportUrl} target="_blank" rel="noreferrer" className="text-xs text-muted hover:underline shrink-0" title="View the field report">report</a>}
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-line bg-app/40 flex items-center gap-3">
              <Link href="/glitches" className="text-xs font-semibold text-brand-700 hover:underline">Manage the full glitch board &rarr;</Link>
              {gl && (gl.olderOpen || 0) > 0 && !showOlder && (
                <button onClick={() => { setShowOlder(true); fetch('/api/ops-today/glitches?all=1', { cache: 'no-store' }).then(r => r.json()).then(setGl).catch(() => {}) }}
                  className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  title="Open guest issues reported more than 14 days ago — still open, just old">
                  Show {gl.olderOpen} older open {gl.olderOpen === 1 ? 'issue' : 'issues'}
                </button>
              )}
              {showOlder && <span className="ml-auto text-[11px] text-muted">showing all open, including 15+ days old</span>}
            </div>
          </div>
        )}
        {panel === 'vacant' && (
          <div className="border-t border-line">
            <div className="px-4 py-2 text-[11px] text-muted bg-app">Empty per Guesty{data.lastSync ? ' (synced ' + hhmm(data.lastSync) + ')' : ''}. A unit only shows when no live reservation covers today &mdash; guests arriving today count as occupied.</div>
            {vacants.length === 0 && <div className="px-4 py-4 text-sm text-muted">No vacant units{market === 'all' ? '' : ' in ' + market} today.</div>}
            <div className="divide-y divide-line">
              {vacants.map(vu => (
                <div key={vu.listingId}>
                  <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate">{vu.unit}</div>
                      <div className="text-xs text-muted">{vu.market}{vu.leftToday ? ' \u00b7 checked out today' : ''}{vu.openTasks ? ' \u00b7 ' + vu.openTasks + ' task' + (vu.openTasks > 1 ? 's' : '') + ' today' : ''}</div>
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

      {err && (
        <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">
          <span className="flex-1">{err}</span>
          <button onClick={() => { setErr(''); setLoading(true); load() }} className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white border border-rose-200 hover:bg-rose-100">Retry</button>
          <button onClick={() => setErr('')} className="text-xs text-rose-700/70 hover:text-rose-900" title="Dismiss">&times;</button>
        </div>
      )}

      {/* NOT STARTED — the band Jon asked for. Only appears when it is a real problem: the guest has
          checked out (plus grace) and nobody has started. Reads PROBLEM then ACTION, like the
          exceptions do, and one press puts the board on exactly those cleans. */}
      {bh && bh.notStarted > 0 && (
        <div className={'rounded-2xl border mb-3 overflow-hidden ' + (bh.level === 'urgent' ? 'border-rose-300 bg-rose-50/70' : 'border-amber-300 bg-amber-50/60')}>
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <AlertTriangle size={15} className={bh.level === 'urgent' ? 'text-rose-700' : 'text-amber-700'} />
              <span className={'font-bold text-sm ' + (bh.level === 'urgent' ? 'text-rose-800' : 'text-amber-900')}>
                {bh.notStarted} departure clean{bh.notStarted === 1 ? '' : 's'} not started
              </span>
              <button onClick={() => { setJf('all'); setSf(sf === 'behind' ? 'all' : 'behind') }} className="ml-auto text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-ink text-white hover:opacity-90">{sf === 'behind' ? 'Show everything' : 'Show them'}</button>
            </div>
            <div className="mt-1.5 text-[13px] text-ink/80">
              <span className="font-semibold">Problem:</span> the guests have checked out and nobody has started
              {bh.sameDay > 0 ? '. ' + bh.sameDay + ' of them ' + (bh.sameDay === 1 ? 'has a guest' : 'have guests') + ' arriving today' + (bh.earliestIn ? ', the first at ' + bh.earliestIn : '') : ''}
              {bh.unassigned > 0 ? '. ' + bh.unassigned + ' still ' + (bh.unassigned === 1 ? 'has' : 'have') + ' nobody assigned' : ''}.
            </div>
            <div className="mt-1 text-[13px] text-ink/80">
              <span className="font-semibold">Action:</span> {bh.unassigned > 0 ? 'assign the unassigned ones first, then call the team on the rest' : 'call the team and get someone moving'}
              {bh.sameDay > 0 ? ' — start with the units that have a check-in today.' : '.'}
              {bh.waiting > 0 ? ' (' + bh.waiting + ' more not started, but those guests have not checked out yet — not a problem.)' : ''}
            </div>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {bh.units.slice(0, 12).map(b => (
                <button key={b.taskId} onClick={() => setQ(b.unit)} title={'Filter the board to ' + b.unit} className="text-[11px] font-medium px-2 py-1 rounded-lg border bg-white border-line hover:border-ink/30 inline-flex items-center gap-1.5">
                  <span className="font-semibold text-ink">{b.unit}</span>
                  {b.arrivingAt && <span className="text-rose-700">in {b.arrivingAt}</span>}
                  <span className={b.assignee ? 'text-muted' : 'text-amber-700 font-semibold'}>{b.assignee || 'Unassigned'}</span>
                </button>
              ))}
              {bh.notStarted > 12 && <span className="text-[11px] text-muted">+{bh.notStarted - 12} more</span>}
            </div>
          </div>
        </div>
      )}

      {/* WORK FILTERS — two axes together: WHAT kind of job, and WHERE it stands. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        <span className="text-[11px] uppercase tracking-wide text-muted font-semibold mr-0.5">Show</span>
        {JOBS.map(j => <Chip key={j[0]} label={j[1]} n={jobCount(j[0])} active={jf === j[0]} onClick={() => setJf(j[0])} />)}
        <span className="h-5 w-px bg-line mx-1" />
        <span className="text-[11px] uppercase tracking-wide text-muted font-semibold mr-0.5">Status</span>
        {STATUSES.map(s => <Chip key={s[0]} label={s[1]} n={statusCount(s[0])} warn={s[0] === 'unassigned'} active={sf === s[0]} onClick={() => setSf(s[0])} />)}
        {sf === 'behind' && <Chip label="Checked out, not started" n={bhIds.size} warn active onClick={() => setSf('all')} />}
        {filtering && <button onClick={() => { setJf('all'); setSf('all') }} className="text-[12px] font-medium text-muted hover:text-ink underline ml-1">Clear</button>}
      </div>

      {units.length === 0 && (
        <div className="text-sm text-muted py-10 text-center">
          {filtering || needle ? (
            <>Nothing matches{market === 'all' ? '' : ' in ' + market} with these filters. <button onClick={() => { setJf('all'); setSf('all'); setQ('') }} className="font-semibold text-brand-700 underline">Clear filters</button></>
          ) : ('Nothing outstanding' + (market === 'all' ? '' : ' in ' + market) + ' right now.')}
        </div>
      )}

      <div className="space-y-3">
        {/* BY AREA: units grouped into mini-markets worked out from coordinates, each block a run. */}
        {groupBy === 'area' && areas.map(a => (
          <div key={a.key} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <MapPin size={13} className="text-muted" />
              <span className="text-[13px] font-bold text-ink">{a.label}</span>
              {a.city && a.city !== a.label && <span className="text-[11px] text-muted">{a.city}</span>}
              <span className="text-[11px] font-semibold text-muted">{a.units.length} unit{a.units.length === 1 ? '' : 's'}</span>
              <span className="flex-1 h-px bg-line" />
              {a.units.filter((u: any) => u.late).length > 0 && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">{a.units.filter((u: any) => u.late).length} late</span>}
              <span className="text-[11px] text-muted">{a.units.reduce((s: number, u: any) => s + u.tasks.filter((t: any) => !t.done).length, 0)} open</span>
            </div>
            <div className="space-y-3">{(a.units as Unit[]).map(u => renderUnit(u))}</div>
          </div>
        ))}
        {groupBy !== 'area' && units.map(u => renderUnit(u))}
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
  { key: 'deepclean', label: 'Deep clean', department: 'housekeeping', priority: 'normal', title: 'Deep Clean', base: 'Deep clean (beyond the turnover standard): inside appliances, behind and under furniture, grout and caulk, vents, baseboards, windows and tracks, upholstery and mattress protectors.' },
]

// COPY AND SEND. A bad review usually needs two things: a task for the field, and a message to a
// person — the owner, the GM, the cleaner's lead — pasted into Slack or a text. Building that by
// hand from the review panel is exactly the friction that stops it happening, so the board writes
// it. Plain text, no markdown, because it has to survive SMS as well as Slack.
function reviewMessage(unit: string, rev: any): string {
  const stars = (rev.rating != null ? rev.rating + '-star' : 'low') + ' review'
  const when = rev.at ? ' on ' + new Date(String(rev.at) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const who = rev.guest ? ' from ' + rev.guest : ''
  const via = rev.channel ? ' (' + rev.channel + ')' : ''
  const quote = rev.excerpt ? '\n\n"' + String(rev.excerpt).trim().replace(/\s+/g, ' ').slice(0, 400) + '"' : ''
  return [
    unit + ' — ' + stars + who + when + via + '.',
    quote,
    '\n\nCan we walk the unit before the next guest and confirm this is fixed? Reply here with what you find.',
  ].join('')
}
async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
    } catch { return false }
  }
}

// WHAT DID WE SEE LAST TIME WE WERE IN HERE? The coordinator's own inspection notes, on the unit,
// next to the tasks — so a pattern ("third time the mirrors") is visible at the moment somebody is
// deciding what to do about this unit today.
function UnitInspections({ unit }: { unit: string }) {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => {
    let dead = false
    fetch('/api/inspections?days=180&unit=' + encodeURIComponent(unit), { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (!dead && j && j.ok) setRows((j.rows || []).slice(0, 3)) }).catch(() => {})
    return () => { dead = true }
  }, [unit])
  if (!rows.length) return null
  return (
    <div className="mb-2 bg-white border border-line rounded-md px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">Last inspections</div>
      {rows.map(r => (
        <div key={r.id} className="text-[12px] text-ink py-0.5">
          <span className="text-muted">{String(r.inspected_on).slice(5)}</span>
          {r.rating != null && <span className={'ml-1.5 font-semibold ' + (r.rating <= 2 ? 'text-rose-700' : r.rating === 3 ? 'text-amber-700' : 'text-emerald-700')}>{r.rating}/5</span>}
          {r.cleaner && <span className="text-muted"> {'\u00b7'} {r.cleaner}</span>}
          {r.follow_up && !r.taskId && <span className="ml-1.5 text-[9.5px] uppercase font-bold px-1 py-0.5 rounded bg-amber-500 text-white">open</span>}
          <div className="text-muted">{String(r.notes).slice(0, 140)}</div>
        </div>
      ))}
      <a href="/inspections" className="text-[11px] font-semibold text-ink underline">Log another {'\u2192'}</a>
    </div>
  )
}

// Two buttons, one decision each: send someone, or tell someone.
function ReviewActions({ unit, rev }: { unit: string; rev: any }) {
  const [copied, setCopied] = useState<'msg' | 'sms' | null>(null)
  const msg = reviewMessage(unit, rev)
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
      <button onClick={async () => { const ok = await copyText(msg); setCopied(ok ? 'msg' : null); setTimeout(() => setCopied(null), 2000) }} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white border border-line text-ink hover:bg-slate-50">{copied === 'msg' ? 'Copied \u2713' : 'Copy message'}</button>
      <a href={'sms:?&body=' + encodeURIComponent(msg)} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white border border-line text-ink hover:bg-slate-50">Text it</a>
      <span className="text-[10.5px] text-muted">paste into Slack, or send as a text {'\u2014'} the inspection task is the button below</span>
    </div>
  )
}

// A signal is something the board noticed on its own. Each one is a CHIP on the unit header that
// opens the action panel pre-loaded with the right task - see it, decide, schedule it, move on.
function SignalChips({ s, onAct }: { s: any; onAct: (seed: any) => void }) {
  if (!s) return null
  const pending = (s.pending || []).length
  const rev = s.review
  const up = s.upkeep || []
  return (
    <>
      {pending > 0 && (
        <button onClick={() => onAct({ key: 'pending' })} title={'Open Breezeway work on this unit from the last 60 days that was never finished - oldest is ' + ((s.pending[0] || {}).daysOld || 0) + ' days old'} className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100">{pending} pending task{pending === 1 ? '' : 's'}</button>
      )}
      {rev && (
        <button onClick={() => onAct({ key: 'review', template: 'feedback', title: 'Guest-feedback inspection', reason: rev.rating + '\u2605 review ' + (rev.at || '') + (rev.excerpt ? ' \u2014 \u201c' + String(rev.excerpt).slice(0, 120) + '\u201d' : '') })} title={'Recent review ' + rev.rating + '\u2605' + (rev.at ? ' on ' + rev.at : '') + ' - inspect before the next guest'} className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100">Review inspection {'\u00b7'} {rev.rating}{'\u2605'}</button>
      )}
      {up.map((x: any) => (
        <button key={x.key} onClick={() => onAct({ key: x.key, template: x.template, title: x.label, reason: x.neverSeen ? 'No record of this being done in the last 2 years' : 'Last done ' + x.lastAt + ' (' + x.monthsAgo + ' months ago, due every ' + x.every + ')' })} title={x.neverSeen ? 'No completed ' + x.short + ' task found in the last 2 years' : 'Last ' + x.short + ': ' + x.lastAt + ' - ' + x.monthsAgo + ' months ago, cadence is every ' + x.every + ' months'} className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200">{x.short}{x.neverSeen ? ' \u00b7 never' : ' \u00b7 ' + Math.round(x.monthsAgo) + 'mo'}</button>
      ))}
    </>
  )
}

// The decide-and-schedule panel: what the board found, the open work behind it, and a 14-day
// strip showing which days the unit is EMPTY so the task lands on a day someone can actually work.
function SignalPanel({ s, seed, listingId, unit, today, people, onClose, onDone }: { s: any; seed: any; listingId: string; unit: string; today: string; people: Person[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(today)
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const tpl = TEMPLATES.filter(t => t.key === (seed && seed.template))[0] || null
  const [title, setTitle] = useState(tpl ? tpl.title : '')
  const [desc, setDesc] = useState(tpl ? tpl.base + (seed && seed.reason ? '\n\nWhy: ' + seed.reason : '') : '')
  useEffect(() => {
    const t2 = TEMPLATES.filter(t => t.key === (seed && seed.template))[0] || null
    setTitle(t2 ? t2.title : ''); setDesc(t2 ? t2.base + (seed && seed.reason ? '\n\nWhy: ' + seed.reason : '') : ''); setMsg(''); setErr('')
  }, [seed])
  if (!s) return null
  const days = s.days || []
  const dow = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
  const dnum = (d: string) => new Date(d + 'T12:00:00').getDate()
  const create = async () => {
    if (!title.trim()) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const person = people.filter(p => p.name === who)[0]
      const r = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, title: title.trim(), department: tpl ? tpl.department : 'maintenance', priority: tpl ? tpl.priority : 'normal', description: desc, date, assigneeIds: person ? [person.id] : [] })
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not create the task'); setBusy(false); return }
      setMsg('Created in Breezeway for ' + date + (person ? ' \u00b7 assigned to ' + person.name : '') + (j.assigned === false ? ' (assign failed, do it in Breezeway)' : ''))
      setTimeout(onDone, 1200)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="px-4 py-3 bg-app border-t border-line">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs uppercase tracking-wide text-muted">What the board found on {unit}</div>
        <button onClick={onClose} className="ml-auto text-xs text-muted hover:text-ink">Close</button>
      </div>

      {(s.pending || []).length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 mb-1">Still open from the last 60 days</div>
          <div className="space-y-1">
            {(s.pending || []).slice(0, 6).map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 bg-white border border-amber-200 rounded-md px-2 py-1 text-[12px]">
                <span className="text-ink truncate">{t.name}</span>
                <span className="text-muted whitespace-nowrap">{t.date} {'\u00b7'} {t.daysOld}d old</span>
                <a href={'https://app.breezeway.io/task/' + t.id} target="_blank" rel="noreferrer" className="ml-auto text-brand-600 hover:underline whitespace-nowrap">admin</a>
                {t.reportUrl && <a href={t.reportUrl} target="_blank" rel="noreferrer" className="text-muted hover:underline whitespace-nowrap">report</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      <UnitInspections unit={unit} />

      {s.review && (
        <div className="mb-2 text-[12px] bg-white border border-rose-200 rounded-md px-2 py-1.5">
          <span className="font-semibold text-rose-700">{s.review.rating}{'\u2605'}</span>
          <span className="text-muted"> {'\u00b7'} {s.review.at}{s.review.guest ? ' \u00b7 ' + s.review.guest : ''}{s.review.channel ? ' \u00b7 ' + s.review.channel : ''}</span>
          {s.review.excerpt && <div className="text-ink mt-0.5">{'\u201c'}{s.review.excerpt}{'\u201d'}</div>}
          <ReviewActions unit={unit} rev={s.review} />
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap mb-2 items-center">
        {(s.upkeep || []).map((x: any) => (
          <span key={x.key} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-line text-muted">{x.short}: <span className="text-ink font-medium">{x.lastAt + ' (' + x.monthsAgo + 'mo)'}</span></span>
        ))}
        {(s.unknown || []).length > 0 && (
          <span className="text-[11px] text-muted">Never logged in Breezeway: {(s.unknown || []).map((x: any) => x.short).join(', ')}</span>
        )}
      </div>

      <div className="rounded-lg border border-line bg-white p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">Pick a day {'\u00b7'} green = unit empty, amber = guest in-house{s.nextCheckout ? ', next checkout ' + s.nextCheckout : ''}</div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {days.map((d: any) => (
            <button key={d.date} onClick={() => setDate(d.date)} title={d.date + (d.occupied ? ' \u2014 guest in-house' : ' \u2014 unit empty') + (d.checkout ? ' \u00b7 checkout' : '') + (d.checkin ? ' \u00b7 check-in' : '')}
              className={'shrink-0 w-12 rounded-md border px-1 py-1 text-center ' + (date === d.date ? 'bg-ink text-white border-ink' : d.occupied ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:border-emerald-400')}>
              <div className="text-[9px] uppercase leading-none">{dow(d.date)}</div>
              <div className="text-[13px] font-bold leading-tight">{dnum(d.date)}</div>
              <div className="text-[8px] leading-none">{d.checkout ? 'out' : d.checkin ? 'in' : d.occupied ? '\u00b7' : 'free'}</div>
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center mt-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" className="flex-1 min-w-[200px] text-sm border border-line rounded-lg px-3 py-2 bg-white" />
          <input list="ppl-all" value={who} onChange={e => setWho(e.target.value.trim().replace(/\s*\([^)]*\)\s*$/, ''))} placeholder="Assign to\u2026" className="text-sm border border-line rounded-lg px-3 py-2 bg-white w-[170px]" />
          <button onClick={create} disabled={busy || !title.trim()} className="text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{busy ? 'Creating\u2026' : 'Create for ' + date.slice(5)}</button>
        </div>
        {desc && <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} className="w-full mt-2 text-xs border border-line rounded-lg px-3 py-2 bg-white font-mono text-muted" />}
        {msg && <div className="text-xs text-emerald-700 mt-2">{msg}</div>}
        {err && <div className="text-xs text-rose-700 mt-2">{err}</div>}
      </div>
    </div>
  )
}

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
      {(() => { const la = h.lastAudit; const due = !la || ((Date.now() - new Date(la + 'T12:00:00').getTime()) / 86400000) > 365; if (!due) return null; return (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">Annual audit due &middot; {la ? 'last ' + fmtShort(la) : 'never audited'}</span>
          <button onClick={() => addToToday('Annual Quality Audit', 'inspection')} disabled={busy === 'Annual Quality Audit'} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">{busy === 'Annual Quality Audit' ? 'Creating\u2026' : 'Create annual audit'}</button>
        </div>
      ) })()}
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

function Chip({ label, n, warn, active, onClick }: { label: string; n: number; warn?: boolean; active?: boolean; onClick?: () => void }) {
  const hot = warn && n > 0 && !active
  return (
    <button onClick={onClick} title="Filter the board" className={'inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-full border transition ' + (active ? 'bg-ink text-white border-ink' : hot ? 'bg-amber-50 text-amber-800 border-amber-300 hover:border-amber-400' : 'bg-white text-muted border-line hover:text-ink hover:bg-app')}>
      {label}
      <span className={'tabular-nums font-semibold ' + (active ? 'text-white' : hot ? 'text-amber-800' : 'text-ink')}>{n}</span>
    </button>
  )
}

// Board-stage labels for glitches shown in the status strip.
const STAGE_LABEL: Record<string, string> = { pool: 'New', ops: 'With ops', guest_followup: 'Guest follow-up', refund: 'Refund request', manager_review: 'Manager review', incident: 'Incident report', closed: 'Closed' }

// redeploy-nudge 2026-07-23

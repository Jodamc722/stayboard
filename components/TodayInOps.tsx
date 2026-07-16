'use client'
// Today in Ops — the day's workflow, organised BY UNIT. One card per unit shows every activity
// on it today (strip, departure clean, inspection, maintenance) so a coordinator manages the
// unit, not four separate lists. Departure cleans are tracked against the 4pm check-in deadline.
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, AlertTriangle, Plus, Clock, DoorOpen, CalendarDays } from 'lucide-react'

type Task = { id: string; listingId: string; unit: string; market: string; dept: string; type: string; name: string; status: string; assignees: string[]; startedAt: string | null; finishedAt: string | null; minutes: number | null; reportUrl: string | null; done: boolean; running: boolean; clocked: boolean; late: boolean; atRisk: boolean; missed: boolean; untracked?: boolean }
type Qc = { issue: string; status: string; reportUrl: string | null }
type Unit = { listingId: string; unit: string; market: string; guestOut: string | null; sameDayTurn: boolean; qc: Qc[]; tasks: Task[]; late: boolean; atRisk: boolean; unassigned: boolean; allDone: boolean; openTasks: number; untracked?: boolean }
type Deadline = { dueBy: string; minsLeft: number; passed: boolean; cleans: number; done: number; running: number; remaining: number; late: number; atRisk: number; missed: number; untracked?: number }
type Person = { id: number; name: string; departments: string[] }
type Vacant = { listingId: string; unit: string; market: string; leftToday: string | null; nextArrival: string | null; openTasks: number }
type Data = { ok: boolean; today: string; lastSync?: string | null; deadline: Deadline; totals: any; byMarket: any[]; units: Unit[]; vacants?: Vacant[]; error?: string }

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

export function TodayInOps() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')
  const [showDone, setShowDone] = useState(false)
  const [addFor, setAddFor] = useState('')
  const [tf, setTf] = useState('all')  // click a stat card to filter to that kind of work
  const [people, setPeople] = useState<Person[]>([])
  const [moveFor, setMoveFor] = useState('')
  const [showVacant, setShowVacant] = useState(false)
  const [addVacant, setAddVacant] = useState('')

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/ops-today', { cache: 'no-store' })
      const j: Data = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  // roster for assigning — fetched once, filtered per task department
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setPeople(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5 * 60 * 1000); return () => clearInterval(t) }, [load])

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
  const vacAll: Vacant[] = Array.isArray(data.vacants) ? data.vacants : []
  const vacants = market === 'all' ? vacAll : vacAll.filter(x => x.market === market)
  const byMkt = market === 'all' ? srcUnits : srcUnits.filter(u => u.market === market)
  const all = tf === 'all' ? byMkt : byMkt.map(u => Object.assign({}, u, { tasks: u.tasks.filter(inFilter) })).filter(u => u.tasks.length > 0)
  const units = showDone ? all : all.filter(u => !u.allDone)
  const doneCount = all.filter(u => u.allDone).length
  const markets = ['all'].concat((data.byMarket || []).map(m => m.market))
  const d: Deadline = data.deadline || ({ dueBy: '4:00 PM', minsLeft: 0, passed: false, cleans: 0, done: 0, running: 0, remaining: 0, late: 0, atRisk: 0, missed: 0 } as Deadline)
  const behind = d.late > 0 || d.atRisk > 0

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {markets.map(m => (
          <button key={m} onClick={() => setMarket(m)} className={'text-sm font-medium px-3 py-1.5 rounded-lg border transition ' + (market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
        ))}
        <button onClick={() => setShowDone(!showDone)} className="text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white text-muted hover:bg-app">{showDone ? 'Hide finished' : 'Show finished (' + doneCount + ')'}</button>
        <button onClick={() => { setLoading(true); load() }} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refresh</button>
      </div>

      {/* THE CLOCK: departure cleans must be finished by 4pm (next check-in) */}
      <div className={'rounded-2xl border p-4 mb-4 ' + (d.late > 0 ? 'border-rose-300 bg-rose-50' : d.atRisk > 0 ? 'border-amber-300 bg-amber-50' : 'border-line bg-white')}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock size={16} className={d.late > 0 ? 'text-rose-700' : d.atRisk > 0 ? 'text-amber-700' : 'text-muted'} />
            <span className="font-semibold text-ink">Departure cleans &middot; due by {d.dueBy}</span>
            <span className="text-sm text-muted">{d.passed ? fmtLeft(d.minsLeft) + ' past deadline' : fmtLeft(d.minsLeft) + ' left'}</span>
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
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-5">
        <Stat label="All work" value={srcUnits.length + ''} sub={(totals.tasks || 0) + ' tasks'} active={tf === 'all'} onClick={() => setTf('all')} />
        <Stat label="Cleans" value={d.cleans + ''} sub={d.done + ' done'} active={tf === 'cleans'} onClick={() => setTf('cleans')} />
        <Stat label="Strips" value={(totals.strips || 0) + ''} active={tf === 'strips'} onClick={() => setTf('strips')} />
        <Stat label="Maintenance" value={(totals.maintenance || 0) + ''} active={tf === 'maintenance'} onClick={() => setTf('maintenance')} />
        <Stat label="Inspections" value={(totals.inspection || 0) + ''} active={tf === 'inspection'} onClick={() => setTf('inspection')} />
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
                  {addVacant === vu.listingId && <AddTask listingId={vu.listingId} unit={vu.unit} onDone={() => { setAddVacant(''); load() }} />}
                </div>
                {moveFor === t.id && <MoveCalendar task={t} onClose={() => setMoveFor('')} onMoved={() => { setMoveFor(''); load() }} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {units.map(u => (
          <div key={u.listingId} className={'rounded-2xl border bg-white overflow-hidden ' + (u.late ? 'border-rose-300' : u.atRisk ? 'border-amber-300' : 'border-line')}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-app/60 flex-wrap">
              <span className="font-semibold text-ink">{u.unit}</span>
              <span className="text-xs text-muted">{u.market}</span>
              {u.sameDayTurn && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">Same-day turn</span>}
              {u.untracked && <span title="Vendor-cleaned. The vendor doesn't close tasks in Breezeway, so status here isn't reliable and these aren't tracked against 4pm." className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-app text-muted border border-line">Vendor clean</span>}
              {u.guestOut && <span className="text-xs text-muted">out: {u.guestOut}</span>}
              {u.qc.map((q, i) => (
                <span key={i} className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">QC: {q.issue}</span>
              ))}
              <span className="ml-auto text-xs text-muted">{u.allDone ? 'All done' : u.openTasks + ' open'}</span>
              <button onClick={() => setAddFor(addFor === u.listingId ? '' : u.listingId)} className="text-xs font-medium px-2 py-1 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1"><Plus size={12} /> Add task</button>
            </div>
            <div className="divide-y divide-line">
              {u.tasks.map(t => (
                <div key={t.id}>
                <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
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
                  {!t.done && <button onClick={() => setMoveFor(moveFor === t.id ? '' : t.id)} className="text-xs font-medium text-muted hover:text-ink shrink-0">move</button>}
                </div>
              ))}
            </div>
            {addFor === u.listingId && <AddTask listingId={u.listingId} unit={u.unit} onDone={() => { setAddFor(''); load() }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// Smart Add Task: pick WHY, and the task builds itself — standard template for that kind of work,
// plus unit-specific things to look at pulled from recent guest feedback (reuses /api/schedule/listing-ops,
// the same intel engine the scheduler ops panel + Push already use).
type Intel = { inspection?: { recommended: boolean; reasons: string[] }; lastFeedback?: { rating: number | null; guest: string | null; date: string | null; excerpt: string | null } | null; checklist?: string[] }
const TEMPLATES: { key: string; label: string; department: string; priority: string; title: string; base: string; useIntel?: boolean }[] = [
  { key: 'inspection', label: 'Inspection', department: 'inspection', priority: 'high', title: 'Unit Check', useIntel: true, base: 'Standard unit inspection: cleanliness vs. the photos, damage / wear, all amenities present and working, consumables restocked, photos still match reality.' },
  { key: 'audit', label: 'Quality audit', department: 'inspection', priority: 'normal', title: 'Quality Audit', useIntel: true, base: 'Full quality audit: score the unit against the standard checklist, log any damage or wear, confirm inventory counts.' },
  { key: 'feedback', label: 'Audit from guest feedback', department: 'inspection', priority: 'high', title: 'Guest-feedback inspection', useIntel: true, base: 'Inspection raised from guest feedback. Verify and fix what guests reported.' },
  { key: 'batteries', label: 'Lock batteries', department: 'maintenance', priority: 'normal', title: 'Replace lock batteries', base: 'Annual lock battery replacement. Replace batteries in every door lock, re-test the lock and codes afterwards, and log the date.' },
  { key: 'acfilter', label: 'A/C filter', department: 'maintenance', priority: 'normal', title: 'Change A/C filter', base: 'Change the central A/C filter. Note the filter size used and log the date.' },
  { key: 'pm', label: 'PM check', department: 'maintenance', priority: 'normal', title: 'Preventative Maintenance Task', base: 'Preventative maintenance pass: A/C, plumbing under sinks, water heater, smoke / CO detectors, light bulbs, door hardware.' },
]

function AddTask({ listingId, unit, onDone }: { listingId: string; unit: string; onDone: () => void }) {
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
      const r = await fetch('/api/ops-today/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, title: t, department, priority, description }) })
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

// Calendar of the unit's real availability, straight from the task. A task may only land on a
// CHECKOUT or VACANT day; days with a guest in the unit are blocked and named. The server
// re-checks on submit, so this picker is a convenience, not the safety net.
type Day = { date: string; state: string; guest: string | null; allowed: boolean }
function MoveCalendar({ task, onClose, onMoved }: { task: Task; onClose: () => void; onMoved: () => void }) {
  const [days, setDays] = useState<Day[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/ops-today/reschedule?listingId=' + encodeURIComponent(task.listingId), { cache: 'no-store' })
      .then(r => r.json()).then(j => { setDays(Array.isArray(j.days) ? j.days : []); setLoading(false) })
      .catch(e => { setErr(String(e)); setLoading(false) })
  }, [task.listingId])
  const move = async (date: string) => {
    setBusy(date); setErr('')
    try {
      const r = await fetch('/api/ops-today/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, listingId: task.listingId, date }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not move the task'); setBusy(''); return }
      onMoved()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  return (
    <div className="px-4 py-3 bg-app border-t border-line">
      <div className="flex items-center gap-2 mb-2">
        <CalendarDays size={13} className="text-muted" />
        <span className="text-xs uppercase tracking-wide text-muted">Move {task.name} &mdash; {task.unit} availability</span>
        <button onClick={onClose} className="ml-auto text-xs text-muted hover:text-ink">close</button>
      </div>
      {loading && <div className="text-xs text-muted">Loading availability&hellip;</div>}
      <div className="flex gap-1 flex-wrap">
        {days.map(dd => (
          <button key={dd.date} disabled={!dd.allowed || !!busy} onClick={() => move(dd.date)}
            title={dd.allowed ? (dd.state === 'checkout' ? 'Checkout day — free after the guest leaves' : 'Vacant all day') : 'Active reservation — ' + (dd.guest || 'guest') + ' is in the unit'}
            className={'text-[11px] rounded-lg border px-2 py-1 text-left min-w-[74px] ' + (!dd.allowed ? 'bg-rose-50 border-rose-200 text-rose-700 cursor-not-allowed' : dd.state === 'checkout' ? 'bg-white border-brand-300 text-brand-700 hover:border-brand-500' : 'bg-white border-line text-ink hover:border-ink/40')}>
            <div className="font-semibold">{fmtDay(dd.date).replace(/,.*/, '')} {dd.date.slice(8)}</div>
            <div className="opacity-80">{busy === dd.date ? 'moving…' : !dd.allowed ? (dd.guest || 'booked') : dd.state === 'checkout' ? 'checkout' : 'vacant'}</div>
          </button>
        ))}
      </div>
      {err && <div className="text-xs text-rose-700 mt-2 font-medium">{err}</div>}
      <div className="text-[11px] text-muted mt-2">Only checkout and vacant days can be picked. Red = active reservation.</div>
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
      <select
        value=""
        disabled={busy || opts.length === 0}
        onChange={e => assign(Number(e.target.value))}
        title={'Assign this ' + task.dept + ' task'}
        className={'text-xs rounded border px-1 py-0.5 bg-white max-w-[150px] ' + (task.assignees.length ? 'border-line text-ink' : 'border-amber-300 text-amber-800 font-medium')}
      >
        <option value="">{busy ? 'Saving…' : cur}</option>
        {opts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
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

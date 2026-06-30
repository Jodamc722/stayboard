'use client'
// Push a single Ops Plan task into Breezeway. Clicking Push opens a full task-creation form
// (just like creating a task in Breezeway): editable title, description, department, priority,
// scheduled date, and assignees. The form is a FIXED-position popover anchored to the button
// (so it's never clipped by the card's overflow and always fully scrollable). On Create it POSTs
// to /api/health/push-task and the row tracks live status, flipping to "Action taken" when done.
import { useRef, useState } from 'react'
import { Send, CheckCircle2, Clock, Loader2, FileText, User, X } from 'lucide-react'

type Push = { status: string; scheduledDate?: string | null; reportUrl?: string | null; actionTakenAt?: string | null; taskId?: string | null } | null
type Person = { id: number; name: string; departments: string[]; region: string | null }
type Task = { key: string; title: string; detail?: string; severity: string; department: string | null; pushable: boolean; push: Push }

const DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
const PRIS = ['urgent', 'high', 'normal', 'low', 'watch']
const PRI_FROM_SEV: Record<string, string> = { critical: 'urgent', high: 'high', medium: 'normal', low: 'low' }
const PANEL_W = 380
// Standard/default assignees the team prefers. region helps pick the right one per market.
const STANDARD = [
  { label: 'Yoslenis · Miami — Inspections Supervisor', match: 'yoslenis' },
  { label: 'Roberto · Miami', match: 'roberto' },
  { label: 'Guillermo · Broward', match: 'guillermo' },
]

export function OpsTaskPush({ listingId, task }: { listingId: string; task: Task }) {
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [push, setPush] = useState<Push>(task.push || null)
  const [state, setState] = useState<'idle' | 'panel' | 'pushing' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number }>({ top: 0, left: 0, maxH: 460 })
  // Editable task fields.
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.detail || '')
  const [dept, setDept] = useState(task.department || 'housekeeping')
  const [pri, setPri] = useState(PRI_FROM_SEV[task.severity] || 'normal')
  const [sched, setSched] = useState('')

  if (!task.pushable || !task.department) {
    return <span className="text-[10px] text-muted italic shrink-0 whitespace-nowrap">desk task</span>
  }

  const status = push?.status
  const taken = status === 'completed' || status === 'approved'
  const pushed = !!push && (status === 'created' || status === 'in_progress' || taken)

  function placePanel() {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const vw = window.innerWidth, vh = window.innerHeight
    let left = r.right - PANEL_W
    if (left < 8) left = 8
    if (left + PANEL_W > vw - 8) left = vw - 8 - PANEL_W
    const maxH = Math.min(vh - 16, 480)
    let top = r.bottom + 6
    if (top + maxH > vh - 8) top = Math.max(8, vh - 8 - maxH)
    setPos({ top, left, maxH })
  }

  async function loadPeople(d: string) {
    setPeople(null); setPicked([])
    const pp = await fetch(`/api/breezeway/people?department=${encodeURIComponent(d)}`).then(r => r.json()).catch(() => null)
    setPeople(pp?.people || [])
  }

  async function openPanel() {
    placePanel()
    setState('panel'); setMsg(''); setPicked([]); setQ('')
    setTitle(task.title); setDesc(task.detail || ''); setDept(task.department || 'housekeeping'); setPri(PRI_FROM_SEV[task.severity] || 'normal')
    try {
      const [pv] = await Promise.all([
        fetch('/api/health/push-task', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId, issueKey: task.key, issueTitle: task.title, severity: task.severity, department: task.department, confirm: false }) }).then(r => r.json()).catch(() => null),
        loadPeople(task.department || 'housekeeping'),
      ])
      if (pv?.already) { setPush(pv); setState('idle'); return }
      if (pv?.scheduled_date) setSched(pv.scheduled_date)
    } catch (e: any) { setMsg(String(e?.message || e)) }
  }

  function changeDept(d: string) { setDept(d); loadPeople(d) }

  async function create() {
    if (!title.trim()) { setMsg('Title is required'); return }
    setState('pushing'); setMsg('')
    try {
      const r = await fetch('/api/health/push-task', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, issueKey: task.key, issueTitle: title.trim(), action: desc.trim(), severity: task.severity, department: dept, priority: pri, scheduledDate: sched, assigneeIds: picked, confirm: true }) })
      const d = await r.json()
      if (!r.ok) { setState('error'); setMsg(d.error || 'Failed'); return }
      setPush(d); setState('idle')
    } catch (e: any) { setState('error'); setMsg(String(e?.message || e)) }
  }

  function toggle(id: number) { setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]) }

  // Quick-add a standard assignee by name. If they're not in the current department's list, fetch the
  // full team, find them, and surface the chip so it shows selected.
  async function addStandard(matchName: string) {
    if (!matchName) return
    const m = matchName.toLowerCase()
    let found = (people || []).find(p => p.name.toLowerCase().includes(m))
    if (!found) {
      const all = await fetch('/api/breezeway/people').then(r => r.json()).catch(() => null)
      found = (all?.people || []).find((p: Person) => p.name.toLowerCase().includes(m))
      if (found) setPeople(pl => [found as Person, ...((pl || []).filter(x => x.id !== (found as Person).id))])
    }
    if (found) setPicked(pk => pk.includes(found!.id) ? pk : [...pk, found!.id])
  }

  if (taken) return (
    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold shrink-0 whitespace-nowrap"><CheckCircle2 size={12} /> Action taken{push?.reportUrl && <a href={push.reportUrl} target="_blank" rel="noreferrer" className="ml-1 text-brand-700 hover:underline inline-flex items-center gap-0.5"><FileText size={10} />report</a>}</span>
  )
  if (pushed) return (
    <span className="inline-flex items-center gap-1 text-[11px] text-brand-700 font-medium shrink-0 whitespace-nowrap"><Clock size={12} /> In Breezeway{push?.scheduledDate ? ` · ${push.scheduledDate}` : ''}{status ? ` · ${status}` : ''}</span>
  )
  if (state === 'pushing') return <span className="inline-flex items-center gap-1 text-[11px] text-muted shrink-0 whitespace-nowrap"><Loader2 size={12} className="animate-spin" /> Creating…</span>

  const fieldC = 'w-full text-[12px] rounded-md border border-line bg-white px-2 py-1 text-ink focus:outline-none focus:ring-1 focus:ring-brand-400'

  return (
    <div className="shrink-0">
      <button ref={btnRef} onClick={() => state === 'panel' ? setState('idle') : openPanel()} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 inline-flex items-center gap-1 whitespace-nowrap"><Send size={10} /> Push</button>
      {state === 'error' && <span className="ml-1 text-[10px] text-rose-600">{msg}</span>}
      {state === 'panel' && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setState('idle')} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_W, maxHeight: pos.maxH }} className="z-40 max-w-[92vw] overflow-auto rounded-xl border border-brand-200 bg-white shadow-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-ink">New Breezeway task</span>
              <button onClick={() => setState('idle')} className="text-muted hover:text-ink"><X size={14} /></button>
            </div>

            <label className="block text-[10px] uppercase tracking-wider text-muted font-semibold mb-0.5">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={fieldC} />

            <label className="block text-[10px] uppercase tracking-wider text-muted font-semibold mb-0.5 mt-2">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} className={`${fieldC} resize-none`} />

            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted font-semibold mb-0.5">Department</label>
                <select value={dept} onChange={e => changeDept(e.target.value)} className={fieldC}>
                  {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted font-semibold mb-0.5">Priority</label>
                <select value={pri} onChange={e => setPri(e.target.value)} className={fieldC}>
                  {PRIS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <label className="block text-[10px] uppercase tracking-wider text-muted font-semibold mb-0.5 mt-2">Scheduled date</label>
            <input type="date" value={sched} onChange={e => setSched(e.target.value)} className={fieldC} />

            <label className="block text-[10px] uppercase tracking-wider text-muted font-semibold mb-1 mt-2">Assign to {picked.length ? `(${picked.length})` : ''}</label>
            <select value="" onChange={e => { addStandard(e.target.value); e.currentTarget.value = '' }} className={`${fieldC} mb-1.5`}>
              <option value="">+ Standard assignee…</option>
              {STANDARD.map(o => <option key={o.match} value={o.match}>{o.label}</option>)}
            </select>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search team…" className={`${fieldC} mb-1.5`} />
            {people === null ? (
              <div className="text-[11px] text-muted inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> loading team…</div>
            ) : people.length === 0 ? (
              <div className="text-[11px] text-muted">No {dept} team members found — search or pick a standard assignee above.</div>
            ) : (
              <div className="max-h-32 overflow-auto flex flex-wrap gap-1 pr-1">
                {people.filter(p => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || String(p.region || '').toLowerCase().includes(q.trim().toLowerCase())).map(p => (
                  <button key={p.id} onClick={() => toggle(p.id)} className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 whitespace-nowrap ${picked.includes(p.id) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:bg-app'}`}>
                    <User size={9} />{p.name}{p.region ? ` · ${p.region}` : ''}
                  </button>
                ))}
              </div>
            )}

            {msg && <div className="text-[10px] text-rose-600 mt-1.5">{msg}</div>}
            <div className="flex items-center gap-1.5 mt-3">
              <button onClick={create} className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 inline-flex items-center gap-1"><Send size={11} /> Create task</button>
              <button onClick={() => setState('idle')} className="text-[12px] font-medium px-2.5 py-1.5 rounded-md border border-line text-muted hover:bg-app">Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

'use client'
// Push a single Ops Plan task into Breezeway and track it. Flow: click Push -> panel opens and
// (in parallel) previews the scheduled next-vacant day + loads assignable people for the task's
// department -> you assign one or more -> Create makes the Breezeway task -> the row shows its
// live status, flipping to "Action taken" when Breezeway completes it. Reuses /api/health/push-task.
import { useState } from 'react'
import { Send, CheckCircle2, Clock, Loader2, FileText, User, X } from 'lucide-react'

type Push = { status: string; scheduledDate?: string | null; reportUrl?: string | null; actionTakenAt?: string | null; taskId?: string | null } | null
type Person = { id: number; name: string; departments: string[]; region: string | null }
type Task = { key: string; title: string; detail?: string; severity: string; department: string | null; pushable: boolean; push: Push }

export function OpsTaskPush({ listingId, task }: { listingId: string; task: Task }) {
  const [push, setPush] = useState<Push>(task.push || null)
  const [state, setState] = useState<'idle' | 'panel' | 'pushing' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [preview, setPreview] = useState<{ scheduled_date?: string; priority?: string } | null>(null)

  if (!task.pushable || !task.department) {
    return <span className="text-[10px] text-muted italic shrink-0">desk task</span>
  }

  const status = push?.status
  const taken = status === 'completed' || status === 'approved'
  const pushed = !!push && (status === 'created' || status === 'in_progress' || taken)

  async function openPanel() {
    setState('panel'); setMsg(''); setPicked([])
    // Preview (creates nothing) + people in parallel.
    try {
      const [pv, pp] = await Promise.all([
        fetch('/api/health/push-task', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId, issueKey: task.key, issueTitle: task.title, action: task.detail || '', severity: task.severity, department: task.department, confirm: false }) }).then(r => r.json()).catch(() => null),
        fetch(`/api/breezeway/people?department=${encodeURIComponent(task.department!)}`).then(r => r.json()).catch(() => null),
      ])
      if (pv?.already) { setPush(pv); setState('idle'); return }
      if (pv?.preview) setPreview({ scheduled_date: pv.scheduled_date, priority: pv.priority })
      if (pp?.people) setPeople(pp.people)
    } catch (e: any) { setMsg(String(e?.message || e)) }
  }

  async function create() {
    setState('pushing'); setMsg('')
    try {
      const r = await fetch('/api/health/push-task', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, issueKey: task.key, issueTitle: task.title, action: task.detail || '', severity: task.severity, department: task.department, assigneeIds: picked, confirm: true }) })
      const d = await r.json()
      if (!r.ok) { setState('error'); setMsg(d.error || 'Failed'); return }
      setPush(d); setState('idle')
    } catch (e: any) { setState('error'); setMsg(String(e?.message || e)) }
  }

  function toggle(id: number) { setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]) }

  if (taken) return (
    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold shrink-0"><CheckCircle2 size={12} /> Action taken{push?.reportUrl && <a href={push.reportUrl} target="_blank" rel="noreferrer" className="ml-1 text-brand-700 hover:underline inline-flex items-center gap-0.5"><FileText size={10} />report</a>}</span>
  )
  if (pushed) return (
    <span className="inline-flex items-center gap-1 text-[11px] text-brand-700 font-medium shrink-0"><Clock size={12} /> In Breezeway{push?.scheduledDate ? ` · ${push.scheduledDate}` : ''}{status ? ` · ${status}` : ''}</span>
  )
  if (state === 'pushing') return <span className="inline-flex items-center gap-1 text-[11px] text-muted shrink-0"><Loader2 size={12} className="animate-spin" /> Creating…</span>

  if (state === 'panel') return (
    <div className="mt-1.5 w-full rounded-lg border border-brand-200 bg-brand-50/40 p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-ink">Create {preview?.priority || task.severity} {task.department} task{preview?.scheduled_date ? ` · ${preview.scheduled_date}` : ''}</span>
        <button onClick={() => setState('idle')} className="text-muted hover:text-ink"><X size={13} /></button>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">Assign to</div>
      {people === null ? (
        <div className="text-[11px] text-muted inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> loading team…</div>
      ) : people.length === 0 ? (
        <div className="text-[11px] text-muted">No {task.department} team members found — will use Breezeway defaults.</div>
      ) : (
        <div className="max-h-32 overflow-auto flex flex-wrap gap-1 mb-2">
          {people.map(p => (
            <button key={p.id} onClick={() => toggle(p.id)} className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${picked.includes(p.id) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-ink border-line hover:bg-app'}`}>
              <User size={9} />{p.name}{p.region ? ` · ${p.region}` : ''}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-1">
        <button onClick={create} className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 inline-flex items-center gap-1"><Send size={10} /> {picked.length ? `Create + assign (${picked.length})` : 'Create unassigned'}</button>
        <button onClick={() => setState('idle')} className="text-[11px] font-medium px-2 py-1 rounded-md border border-line text-muted hover:bg-app">Cancel</button>
      </div>
    </div>
  )

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <button onClick={openPanel} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 inline-flex items-center gap-1"><Send size={10} /> Push</button>
      {state === 'error' && <span className="text-[10px] text-rose-600">{msg}</span>}
    </span>
  )
}

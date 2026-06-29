'use client'
// Push a weekly Action-Plan item into Breezeway (with a confirm step) and show its status,
// flipping to "Action taken" when Breezeway completes it. Reuses /api/health/push-task.
import { useState } from 'react'
import { Send, CheckCircle2, Clock, Loader2, FileText } from 'lucide-react'

type Pushed = { status: string; scheduledDate?: string | null; reportUrl?: string | null } | null
const PRI_SEV: Record<number, string> = { 1: 'high', 2: 'medium', 3: 'low' }

export function PlanItemPush({ listingId, issueKey, issueTitle, detail, priority, pushed }:
  { listingId: string; issueKey: string; issueTitle: string; detail?: string; priority: number; pushed?: Pushed }) {
  const [plan, setPlan] = useState<any>(pushed || null)
  const [state, setState] = useState<'idle' | 'previewing' | 'confirm' | 'pushing' | 'done' | 'error'>(pushed ? 'done' : 'idle')
  const [msg, setMsg] = useState('')
  if (!listingId || !issueKey) return null
  const status = plan?.status
  const taken = status === 'completed' || status === 'approved'

  async function call(confirm: boolean) {
    setState(confirm ? 'pushing' : 'previewing'); setMsg('')
    try {
      const r = await fetch('/api/health/push-task', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, issueKey, issueTitle, action: detail || '', severity: PRI_SEV[priority] || 'medium', owner: '', confirm }) })
      const d = await r.json()
      if (!r.ok) { setState('error'); setMsg(d.error || 'Failed'); return }
      if (d.already) { setPlan(d); setState('done'); return }
      if (d.preview) { setPlan(d); setState('confirm'); return }
      setPlan(d); setState('done')
    } catch (e: any) { setState('error'); setMsg(String(e?.message || e)) }
  }

  if (state === 'done' && taken) return (
    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold"><CheckCircle2 size={12} /> Action taken{plan?.reportUrl && <a href={plan.reportUrl} target="_blank" rel="noreferrer" className="ml-1 text-brand-700 hover:underline inline-flex items-center gap-0.5"><FileText size={10} />report</a>}</span>
  )
  if (state === 'done') return (
    <span className="inline-flex items-center gap-1 text-[11px] text-brand-700 font-medium"><Clock size={12} /> In Breezeway{(plan?.scheduledDate || plan?.scheduled_date) ? ` · ${plan.scheduledDate || plan.scheduled_date}` : ''}{status ? ` · ${status}` : ''}</span>
  )
  if (state === 'pushing' || state === 'previewing') return <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Loader2 size={12} className="animate-spin" /> Working…</span>
  if (state === 'confirm' && plan) return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span className="text-amber-800">{plan.message}</span>
      <button onClick={() => call(true)} className="font-semibold px-2 py-0.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 inline-flex items-center gap-1"><Send size={10} /> Confirm</button>
      <button onClick={() => setState('idle')} className="font-medium px-2 py-0.5 rounded-md border border-line text-muted hover:bg-app">Cancel</button>
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={() => call(false)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 inline-flex items-center gap-1"><Send size={10} /> Push to Breezeway</button>
      {state === 'error' && <span className="text-[10px] text-rose-600">{msg}</span>}
    </span>
  )
}

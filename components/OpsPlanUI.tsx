'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Check, Clock, CircleDot, Lock } from 'lucide-react'

export function GeneratePlanButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/ops-plan/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      router.push(`/plan/${d.id}`)
    } catch (e: any) { setErr(e?.message || String(e)); setBusy(false) }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={go} disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-brand-700 disabled:opacity-50">
        <Sparkles size={16} /> {busy ? 'Generating plan…' : 'Generate ops plan'}
      </button>
      {err && <span className="text-[11px] text-red-600 max-w-xs text-right">{err}</span>}
    </div>
  )
}

const STEPS: { k: string; l: string; Icon: any }[] = [
  { k: 'open', l: 'Open', Icon: CircleDot },
  { k: 'in_progress', l: 'In progress', Icon: Clock },
  { k: 'breezeway_done', l: 'Done', Icon: Check },
  { k: 'closed', l: 'Closed', Icon: Lock },
]

export function PlanItemStatus({ itemId, initial }: { itemId: string; initial: string }) {
  const [status, setStatus] = useState(initial || 'open')
  const [busy, setBusy] = useState(false)
  async function set(k: string) {
    if (busy || k === status) return
    setBusy(true); const prev = status; setStatus(k)
    try {
      const res = await fetch('/api/ops-plan/item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, status: k }) })
      const d = await res.json(); if (!res.ok || d.error) throw new Error(d.error || 'failed')
    } catch { setStatus(prev) } finally { setBusy(false) }
  }
  return (
    <div className="inline-flex items-center gap-1 flex-wrap">
      {STEPS.map(s => {
        const active = status === s.k
        const tone = active
          ? (s.k === 'closed' ? 'bg-ink text-white' : s.k === 'breezeway_done' ? 'bg-emerald-600 text-white' : s.k === 'in_progress' ? 'bg-amber-500 text-white' : 'bg-brand-600 text-white')
          : 'text-muted border border-line hover:bg-app'
        return (
          <button key={s.k} onClick={() => set(s.k)} disabled={busy}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg ${tone} disabled:opacity-60`}>
            <s.Icon size={11} /> {s.l}
          </button>
        )
      })}
    </div>
  )
}

export function BuildWeeklyPlanButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/ops-plan/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'weekly' }) })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      router.push(`/plan/${d.id}`)
    } catch (e: any) { setErr(e?.message || String(e)); setBusy(false) }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={go} disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-brand-700 disabled:opacity-50">
        <Sparkles size={16} /> {busy ? 'Building this week’s plan…' : 'Build this week’s plan'}
      </button>
      {err && <span className="text-[11px] text-red-600 max-w-xs text-right">{err}</span>}
    </div>
  )
}

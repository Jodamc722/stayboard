'use client'
// AI MODELS — which model performs which task (Jon, 2026-09-09: "create a setting where we can
// update the model that performs this task").
//
// One row per job the app hands to Claude. Each says what the model is asked to do and who reads
// the answer, because that — not the price — is how to choose: put the money where a miss has a
// cost. The price column is there so the trade is visible, and the "Default" mark shows what the
// cost pass chose, so a row can always be put back.
//
// Saving takes effect within a minute, no deploy. Owner-only, like every setting that spends money.
import { useCallback, useEffect, useState } from 'react'
import { Cpu, Loader2, Save, Check, AlertTriangle, RotateCcw, Clock } from 'lucide-react'

type Tier = { key: string; label: string; id: string; price: { in: number; out: number } }
type Task = { key: string; title: string; what: string; matters: string; group: string; background?: boolean; def: string; tier: string; overridden: boolean }

const GROUPS = ['Eve', 'Guests', 'Listings & reports', 'Operations', 'Background']

export function AiModelsAdmin({ isOwner }: { isOwner: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tiers, setTiers] = useState<Tier[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/settings/ai-models', { cache: 'no-store' })
    const j = await r.json()
    if (!r.ok) { setMsg({ kind: 'err', text: j?.error || 'Could not load.' }); return }
    setTasks(j.tasks || []); setTiers(j.tiers || []); setDraft({}); setLoaded(true)
  }, [])
  useEffect(() => { load() }, [load])

  const tierOf = (t: Task) => draft[t.key] ?? t.tier
  const dirty = Object.keys(draft).some(k => { const t = tasks.find(x => x.key === k); return t && draft[k] !== t.tier })
  const price = (k: string) => tiers.find(t => t.key === k)?.price
  const label = (k: string) => tiers.find(t => t.key === k)?.label || k

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/settings/ai-models', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides: draft }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Save failed.')
      setTasks(j.tasks || []); setDraft({}); setMsg({ kind: 'ok', text: 'Saved. Every call picks this up within a minute.' })
    } catch (e: any) { setMsg({ kind: 'err', text: e.message || String(e) }) } finally { setBusy(false) }
  }
  function resetAll() {
    const d: Record<string, string> = {}
    for (const t of tasks) if (t.tier !== t.def) d[t.key] = t.def
    setDraft(d)
  }

  if (!loaded) return <div className="py-8 flex items-center justify-center gap-2 text-muted text-[13px]"><Loader2 size={14} className="animate-spin" /> Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-muted max-w-2xl">
          Put the money where a miss has a cost. Anything a guest or an owner reads, and anything Eve reasons over, earns the bigger model; a reworded task title does not.
          Prices are per million tokens, in / out. <b>Default</b> is what the September cost pass chose.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={resetAll} disabled={!isOwner || busy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-40"><RotateCcw size={12} /> All defaults</button>
          <button onClick={save} disabled={!isOwner || busy || !dirty} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
        </div>
      </div>
      {msg && <div className={`rounded-lg px-3 py-2 text-[12.5px] inline-flex items-center gap-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>{msg.kind === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}</div>}

      <div className="flex flex-wrap gap-1.5 text-[11.5px]">
        {tiers.map(t => <span key={t.key} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1 text-muted"><Cpu size={11} /> <b className="text-ink">{t.label}</b> ${t.price.in} / ${t.price.out}</span>)}
      </div>

      {GROUPS.map(g => {
        const rows = tasks.filter(t => t.group === g)
        if (!rows.length) return null
        return (
          <div key={g} className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-3.5 py-2 border-b border-line text-[10.5px] font-bold uppercase tracking-wider text-muted">{g}</div>
            <ul className="divide-y divide-line">
              {rows.map(t => {
                const cur = tierOf(t); const p = price(cur); const changed = draft[t.key] != null && draft[t.key] !== t.tier
                return (
                  <li key={t.key} className={`px-3.5 py-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-[1fr_auto] items-start ${changed ? 'bg-amber-50/50' : ''}`}>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-ink flex items-center gap-2 flex-wrap">
                        {t.title}
                        {t.background && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 inline-flex items-center gap-0.5"><Clock size={9} /> runs on its own</span>}
                        {cur !== t.def ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">changed from {label(t.def)}</span> : <span className="text-[10px] font-semibold uppercase tracking-wide text-muted/70">default</span>}
                      </div>
                      <div className="text-[12px] text-muted mt-0.5">{t.what}</div>
                      <div className="text-[11.5px] text-ink/80 mt-0.5"><b>Why it matters:</b> {t.matters}</div>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <select value={cur} disabled={!isOwner} onChange={e => setDraft(d => ({ ...d, [t.key]: e.target.value }))}
                        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-60">
                        {tiers.map(x => <option key={x.key} value={x.key}>{x.label}{x.key === t.def ? ' (default)' : ''}</option>)}
                      </select>
                      {p && <span className="text-[11px] text-muted tabular-nums whitespace-nowrap">${p.in} / ${p.out}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {!isOwner && <p className="text-[11.5px] text-muted">View only — the owner changes these.</p>}
    </div>
  )
}

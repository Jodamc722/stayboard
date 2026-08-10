'use client'
// PROJECT BOARD — kanban for the work that is not a task.
//
// Tasks live in Today in Ops and Breezeway and finish inside a day. A PROJECT runs for weeks, has
// a lead, usually has money attached and often needs an owner to say yes. So the card answers four
// questions without being opened: how far along, is it late, does it need approval, and is there a
// vendor on it. Everything else waits behind the drawer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Loader2, X, Link2, Camera, Mail, Check, AlertTriangle, Clock, DollarSign,
  Trash2, Copy, ExternalLink, ChevronRight, Search, Archive, RefreshCw,
} from 'lucide-react'

type Health = { state: 'ok' | 'due' | 'late' | 'blocked' | 'done'; daysLeft: number | null; reason: string | null }
type Progress = { done: number; total: number; pct: number | null; basis: string }
type P = {
  id: string; ref: string | null; title: string; summary: string | null
  category: string; stage: string; priority: string
  lead_email: string | null; market: string | null; building: string | null
  starts_on: string | null; due_on: string | null
  budget_cents: number | null; spent_cents: number; billable: boolean
  owner_name: string | null; approval: string
  share_token: string | null; vendor_name: string | null
  links: any[]; steps: any[]; progress: Progress; health: Health
}

const STAGES: [string, string][] = [
  ['idea', 'Idea'], ['planned', 'Planned'], ['in_progress', 'In progress'],
  ['blocked', 'Blocked'], ['review', 'Review'], ['done', 'Done'],
]
const LEVELS = ['low', 'normal', 'high', 'urgent']
const APPROVAL_LABEL: Record<string, string> = {
  not_needed: 'Not needed', needed: 'Needs approval', requested: 'Awaiting owner',
  approved: 'Approved', declined: 'Declined',
}
const money = (cents: number | null | undefined) =>
  cents == null ? null : '$' + (Math.round(Number(cents)) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
const dayLabel = (iso: string | null) =>
  !iso ? null : new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// Status colours are reserved for status. Category gets its own quiet dot so the two never fight.
const CAT_DOT: Record<string, string> = {
  amber: 'bg-amber-400', rose: 'bg-rose-400', violet: 'bg-violet-400', indigo: 'bg-indigo-400',
  emerald: 'bg-emerald-400', cyan: 'bg-cyan-400', slate: 'bg-slate-400',
}

export function ProjectBoard({ canEdit, canFull, me }: { canEdit: boolean; canFull: boolean; me: string }) {
  const [projects, setProjects] = useState<P[]>([])
  const [cats, setCats] = useState<any[]>([])
  const [listings, setListings] = useState<any[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const r = await fetch(`/api/projects?archived=${showArchived ? 1 : 0}&category=${encodeURIComponent(cat)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load projects.')
      setProjects(j.projects || []); setCats(j.categories || [])
      setListings(j.listings || []); setPeople(j.people || [])
    } catch (e: any) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }, [cat, showArchived])
  useEffect(() => { load() }, [load])

  const patch = async (body: any) => {
    try {
      const r = await fetch('/api/projects', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Update failed.')
      load()
    } catch (e: any) { setErr(String(e.message || e)) }
  }

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => projects.filter(p => !needle
    || p.title.toLowerCase().includes(needle)
    || (p.ref || '').toLowerCase().includes(needle)
    || (p.building || '').toLowerCase().includes(needle)
    || (p.lead_email || '').toLowerCase().includes(needle)
    || (p.owner_name || '').toLowerCase().includes(needle)), [projects, needle])

  const byStage = (s: string) => shown.filter(p => p.stage === s)
  const catOf = (k: string) => cats.find(c => c.key === k)

  // The three counts worth pinning at the top: what is late, what is waiting on an owner, and what
  // money is committed but not yet spent.
  const summary = useMemo(() => {
    const open = shown.filter(p => p.stage !== 'done' && p.stage !== 'cancelled')
    return {
      open: open.length,
      late: open.filter(p => p.health.state === 'late').length,
      awaiting: open.filter(p => p.approval === 'requested' || p.approval === 'needed').length,
      budget: open.reduce((a, p) => a + (p.budget_cents || 0), 0),
      spent: open.reduce((a, p) => a + (p.spent_cents || 0), 0),
    }
  }, [shown])

  const openProject = projects.find(p => p.id === openId) || null

  return (
    <div>
      {/* CONTROLS — pinned, same rule as the ops board: filters you scroll past are filters you stop using. */}
      <div className="sticky top-0 z-30 bg-app border-b border-line pt-1 pb-2 mb-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects, buildings, leads…"
              className="text-[13px] pl-7 pr-7 py-1.5 rounded-lg border border-line bg-white w-72 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={12} /></button>}
          </span>
          <select value={cat} onChange={e => setCat(e.target.value)}
            className="text-[13px] bg-white border border-line rounded-lg px-2 py-1.5">
            <option value="all">All categories</option>
            {cats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <button onClick={() => setShowArchived(!showArchived)}
            className={'text-[12px] font-medium px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ' + (showArchived ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:bg-app')}>
            <Archive size={12} /> Archived
          </button>
          <button onClick={() => { setLoading(true); load() }} title="Refresh" className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><RefreshCw size={13} /></button>
          {canEdit && (
            <button onClick={() => setCreating(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white text-[13px] font-semibold px-3 py-1.5 hover:bg-brand-700">
              <Plus size={14} /> New project
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="inline-flex items-baseline gap-1 rounded-full px-2 py-0.5 border border-line bg-white text-ink font-semibold"><b className="tabular-nums">{summary.open}</b>open</span>
          <span className={'inline-flex items-baseline gap-1 rounded-full px-2 py-0.5 border ' + (summary.late ? 'border-rose-200 bg-rose-50 text-rose-700 font-semibold' : 'border-line bg-app text-muted')}><b className="tabular-nums">{summary.late}</b>late</span>
          <span className={'inline-flex items-baseline gap-1 rounded-full px-2 py-0.5 border ' + (summary.awaiting ? 'border-amber-200 bg-amber-50 text-amber-700 font-semibold' : 'border-line bg-app text-muted')}><b className="tabular-nums">{summary.awaiting}</b>awaiting owner</span>
          {summary.budget > 0 && (
            <span className="inline-flex items-baseline gap-1 rounded-full px-2 py-0.5 border border-line bg-white text-muted">
              <b className="tabular-nums text-ink">{money(summary.spent)}</b>of {money(summary.budget)} committed
            </span>
          )}
        </div>
      </div>

      {err && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{err}</div>}
      {loading && <div className="py-16 text-center text-muted text-sm inline-flex items-center gap-2 w-full justify-center"><Loader2 size={15} className="animate-spin" /> Loading projects…</div>}

      {!loading && !projects.length && (
        <div className="rounded-2xl border border-line bg-white py-16 text-center">
          <p className="text-sm font-semibold text-ink">No projects yet.</p>
          <p className="text-[13px] text-muted mt-1 max-w-md mx-auto">
            Projects are the work that does not fit a task — a renovation, a rollout across a building,
            onboarding a new property, an SOP someone owns for a month.
          </p>
          {canEdit && <button onClick={() => setCreating(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white text-[13px] font-semibold px-3 py-1.5"><Plus size={14} /> Create the first one</button>}
        </div>
      )}

      {/* BOARD */}
      {!loading && !!projects.length && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.map(([key, label]) => {
            const col = byStage(key)
            return (
              <div key={key} className="w-[290px] shrink-0"
                onDragOver={e => { if (drag) e.preventDefault() }}
                onDrop={e => { e.preventDefault(); if (drag && canEdit) { patch({ id: drag, stage: key }); setDrag(null) } }}>
                <div className="flex items-center gap-2 px-1 pb-1.5 sticky top-[86px] bg-app z-10">
                  <span className="text-[12px] font-bold text-ink">{label}</span>
                  <span className="text-[11px] font-semibold text-muted tabular-nums">{col.length}</span>
                  <span className="flex-1 h-px bg-line" />
                </div>
                <div className="space-y-2 min-h-[80px]">
                  {col.map(p => (
                    <Card key={p.id} p={p} cat={catOf(p.category)} canEdit={canEdit}
                      onOpen={() => setOpenId(p.id)}
                      onDragStart={() => setDrag(p.id)} onDragEnd={() => setDrag(null)} />
                  ))}
                  {!col.length && <div className="rounded-xl border border-dashed border-line py-6 text-center text-[11px] text-muted">Nothing here</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {creating && <NewProject cats={cats} listings={listings} people={people} me={me}
        onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />}
      {openProject && <Drawer id={openProject.id} canEdit={canEdit} canFull={canFull} listings={listings} people={people} cats={cats}
        onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  )
}

// ---------------------------------------------------------------- card
function Card({ p, cat, canEdit, onOpen, onDragStart, onDragEnd }: {
  p: P; cat: any; canEdit: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void
}) {
  const h = p.health
  const accent = h.state === 'late' ? 'border-l-rose-500' : h.state === 'blocked' ? 'border-l-slate-400'
    : h.state === 'due' ? 'border-l-amber-400' : h.state === 'done' ? 'border-l-emerald-500' : 'border-l-transparent'
  const budget = money(p.budget_cents), spent = money(p.spent_cents)
  const over = p.budget_cents != null && p.spent_cents > p.budget_cents
  return (
    <div draggable={canEdit} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onOpen}
      style={{ borderLeftWidth: 3 }}
      className={'rounded-xl border border-line bg-white px-3 py-2.5 cursor-pointer hover:border-brand-300 hover:shadow-sm transition ' + accent}>
      <div className="flex items-start gap-2">
        <span className={'w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ' + (CAT_DOT[cat?.color] || 'bg-slate-400')} title={cat?.label || p.category} />
        <span className="flex-1 text-[13px] font-semibold text-ink leading-snug">{p.title}</span>
        {p.priority === 'urgent' && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-600 text-white shrink-0">Urgent</span>}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[11px] text-muted">
        {p.ref && <span className="tabular-nums">{p.ref}</span>}
        {(p.building || p.market) && <span>· {p.building || p.market}</span>}
        {p.lead_email && <span>· {p.lead_email.split('@')[0]}</span>}
      </div>
      {/* Progress: units for a rollout, checklist for everything else. */}
      {p.progress.total > 0 && (
        <div className="mt-2">
          <span className="block h-1.5 rounded-full bg-app overflow-hidden">
            <span className="block h-full bg-emerald-500" style={{ width: (p.progress.pct || 0) + '%' }} />
          </span>
          <span className="block text-[10px] text-muted mt-1 tabular-nums">
            {p.progress.done}/{p.progress.total} {p.progress.basis === 'units' ? 'units' : 'steps'} done
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {h.reason && (
          <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ' + (
            h.state === 'late' ? 'bg-rose-50 text-rose-700 border border-rose-200'
              : h.state === 'blocked' ? 'bg-slate-100 text-slate-700 border border-slate-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200')}>
            <Clock size={10} />{h.reason}
          </span>
        )}
        {p.due_on && h.state === 'ok' && <span className="text-[10px] text-muted inline-flex items-center gap-1"><Clock size={10} />{dayLabel(p.due_on)}</span>}
        {(p.approval === 'needed' || p.approval === 'requested') && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">{APPROVAL_LABEL[p.approval]}</span>
        )}
        {p.approval === 'approved' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1"><Check size={10} />Approved</span>}
        {budget && (
          <span className={'text-[10px] px-1.5 py-0.5 rounded border tabular-nums ' + (over ? 'bg-rose-50 text-rose-700 border-rose-200 font-semibold' : 'bg-app text-muted border-line')}>
            {spent} / {budget}
          </span>
        )}
        {p.share_token && <span title={'Shared with ' + (p.vendor_name || 'a vendor')} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 inline-flex items-center gap-1"><Link2 size={10} />Vendor</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- new project
function NewProject({ cats, listings, people, me, onClose, onDone }: any) {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [category, setCategory] = useState('renovation')
  const [lead, setLead] = useState(me)
  const [due, setDue] = useState('')
  const [budget, setBudget] = useState('')
  const [approval, setApproval] = useState('not_needed')
  const [units, setUnits] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (!title.trim()) { setErr('Give it a title.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, summary, category, lead_email: lead, due_on: due, budget, approval, listingIds: units }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not create.')
      onDone()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      {err && <p className="text-[12px] text-rose-700 mb-2">{err}</p>}
      <Field label="Title">
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Eden 1101 — bathroom remodel"
          className="w-full text-[13px] rounded-lg border border-line px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
      </Field>
      <Field label="What is it">
        <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} placeholder="A sentence the owner would understand."
          className="w-full text-[13px] rounded-lg border border-line px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Category">
          <select value={category} onChange={e => setCategory(e.target.value)} className="w-full text-[13px] rounded-lg border border-line px-2 py-1.5">
            {cats.map((c: any) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Lead">
          <select value={lead} onChange={e => setLead(e.target.value)} className="w-full text-[13px] rounded-lg border border-line px-2 py-1.5">
            <option value="">Nobody yet</option>
            {people.map((p: string) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Due"><input type="date" value={due} onChange={e => setDue(e.target.value)} className="w-full text-[13px] rounded-lg border border-line px-2 py-1.5" /></Field>
        <Field label="Budget"><input value={budget} onChange={e => setBudget(e.target.value)} placeholder="$0" className="w-full text-[13px] rounded-lg border border-line px-2.5 py-1.5" /></Field>
      </div>
      <Field label="Owner approval">
        <select value={approval} onChange={e => setApproval(e.target.value)} className="w-full text-[13px] rounded-lg border border-line px-2 py-1.5">
          <option value="not_needed">Not needed</option>
          <option value="needed">Needs approval</option>
          <option value="requested">Already asked the owner</option>
          <option value="approved">Already approved</option>
        </select>
      </Field>
      <Field label={`Units this touches${units.length ? ` (${units.length})` : ''}`}>
        <UnitPicker listings={listings} value={units} onChange={setUnits} />
      </Field>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-lg border border-line">Cancel</button>
        <button onClick={save} disabled={busy} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={13} className="animate-spin" />} Create
        </button>
      </div>
    </Modal>
  )
}

function UnitPicker({ listings, value, onChange }: { listings: any[]; value: string[]; onChange: (v: string[]) => void }) {
  const [f, setF] = useState('')
  const hits = useMemo(() => {
    const n = f.trim().toLowerCase()
    return (n ? listings.filter(l => l.label.toLowerCase().includes(n) || (l.building || '').toLowerCase().includes(n)) : listings).slice(0, 60)
  }, [listings, f])
  return (
    <div className="rounded-lg border border-line bg-white">
      <input value={f} onChange={e => setF(e.target.value)} placeholder="Filter units or a whole building…"
        className="w-full text-[12px] px-2.5 py-1.5 border-b border-line focus:outline-none" />
      {/* Bulk-add by building is what makes a 34-unit rollout one action instead of thirty-four. */}
      {f.trim() && (
        <button onClick={() => onChange(Array.from(new Set([...value, ...hits.map(h => h.id)])))}
          className="w-full text-left text-[11px] font-semibold text-brand-700 px-2.5 py-1.5 border-b border-line hover:bg-app">
          + Add all {hits.length} matching
        </button>
      )}
      <div className="max-h-40 overflow-y-auto divide-y divide-line">
        {hits.map(l => {
          const on = value.includes(l.id)
          return (
            <button key={l.id} onClick={() => onChange(on ? value.filter(v => v !== l.id) : [...value, l.id])}
              className={'w-full flex items-center gap-2 text-left text-[12px] px-2.5 py-1.5 hover:bg-app ' + (on ? 'text-ink font-medium' : 'text-muted')}>
              <span className={'w-3.5 h-3.5 rounded border flex items-center justify-center ' + (on ? 'bg-brand-600 border-brand-600' : 'border-line')}>
                {on && <Check size={10} className="text-white" />}
              </span>
              {l.label}
            </button>
          )
        })}
        {!hits.length && <p className="text-[12px] text-muted px-2.5 py-3">No matches.</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- drawer
function Drawer({ id, canEdit, canFull, listings, people, cats, onClose, onChanged }: any) {
  const [p, setP] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'work' | 'money' | 'photos' | 'share' | 'log'>('work')
  const [note, setNote] = useState('')
  const [stepTitle, setStepTitle] = useState('')
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load.')
      setP(j.project)
    } catch (e: any) { setErr(String(e.message || e)) }
  }, [id])
  useEffect(() => { load() }, [load])

  const act = async (body: any, key = 'x') => {
    setBusy(key); setErr(null)
    try {
      const r = await fetch(`/api/projects/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Failed.')
      if (j.draft) setDraft(j.draft)
      if (j.project) setP(j.project)
      onChanged()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }
  const patch = async (body: any, key = 'p') => {
    setBusy(key); setErr(null)
    try {
      const r = await fetch('/api/projects', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Failed.')
      await load(); onChanged()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  const upload = async (f: File) => {
    setBusy('photo'); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('projectId', id); fd.append('phase', 'during')
      const r = await fetch('/api/projects/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed.')
      await load()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  if (!p) {
    return <Modal title="Loading…" onClose={onClose}><div className="py-10 text-center text-muted"><Loader2 size={16} className="animate-spin inline" /></div></Modal>
  }

  const shareUrl = p.share_token ? `${location.origin}/project/${p.share_token}` : null
  const units = p.links.filter((l: any) => l.kind === 'listing')

  return (
    <Modal title={p.title} sub={[p.ref, cats.find((c: any) => c.key === p.category)?.label, p.building || p.market].filter(Boolean).join(' · ')} wide onClose={onClose}>
      {err && <p className="text-[12px] text-rose-700 mb-2">{err}</p>}

      {/* Stage + approval sit above the tabs: they are the two things anyone opening this wants. */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select value={p.stage} disabled={!canEdit} onChange={e => patch({ stage: e.target.value })}
          className="text-[12px] font-semibold rounded-lg border border-line bg-white px-2 py-1.5">
          {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={p.priority} disabled={!canEdit} onChange={e => patch({ priority: e.target.value })}
          className="text-[12px] rounded-lg border border-line bg-white px-2 py-1.5">
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={p.approval} disabled={!canEdit} onChange={e => patch({ approval: e.target.value })}
          className={'text-[12px] rounded-lg border px-2 py-1.5 ' + (p.approval === 'approved' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : p.approval === 'requested' || p.approval === 'needed' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-line bg-white')}>
          {Object.entries(APPROVAL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="date" value={p.due_on || ''} disabled={!canEdit} onChange={e => patch({ due_on: e.target.value })}
          className="text-[12px] rounded-lg border border-line bg-white px-2 py-1.5" />
        {busy && <Loader2 size={13} className="animate-spin text-muted" />}
      </div>

      <div className="flex items-center gap-1 border-b border-line mb-3">
        {(['work', 'money', 'photos', 'share', 'log'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={'text-[12px] font-semibold px-3 py-1.5 -mb-px border-b-2 capitalize ' + (tab === t ? 'border-brand-600 text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {t === 'work' ? 'Work' : t === 'log' ? 'Activity' : t}
          </button>
        ))}
      </div>

      {tab === 'work' && (
        <div className="space-y-4">
          {p.summary && <p className="text-[13px] text-ink/80 leading-relaxed">{p.summary}</p>}
          <section>
            <h4 className="text-[11px] uppercase tracking-wide font-bold text-muted mb-1.5">Checklist</h4>
            <div className="rounded-lg border border-line divide-y divide-line bg-white">
              {p.steps.map((s: any) => (
                <label key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] cursor-pointer hover:bg-app">
                  <input type="checkbox" checked={s.done} disabled={!canEdit} onChange={e => act({ action: 'stepSet', stepId: s.id, done: e.target.checked }, 'step' + s.id)} />
                  <span className={s.done ? 'line-through text-muted' : 'text-ink'}>{s.title}</span>
                  {s.due_on && <span className="ml-auto text-[11px] text-muted">{dayLabel(s.due_on)}</span>}
                  {canFull && <button onClick={e => { e.preventDefault(); act({ action: 'stepDelete', stepId: s.id }) }} className="text-muted hover:text-rose-600"><Trash2 size={11} /></button>}
                </label>
              ))}
              {!p.steps.length && <p className="text-[12px] text-muted px-2.5 py-3">No steps yet.</p>}
            </div>
            {canEdit && (
              <form onSubmit={e => { e.preventDefault(); if (stepTitle.trim()) { act({ action: 'stepAdd', title: stepTitle }); setStepTitle('') } }} className="flex gap-2 mt-2">
                <input value={stepTitle} onChange={e => setStepTitle(e.target.value)} placeholder="Add a step…"
                  className="flex-1 text-[12px] rounded-lg border border-line px-2.5 py-1.5" />
                <button className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-app">Add</button>
              </form>
            )}
          </section>

          <section>
            <h4 className="text-[11px] uppercase tracking-wide font-bold text-muted mb-1.5">
              Units {units.length ? <span className="tabular-nums">· {units.filter((u: any) => u.done).length}/{units.length} done</span> : null}
            </h4>
            <div className="rounded-lg border border-line divide-y divide-line bg-white max-h-52 overflow-y-auto">
              {units.map((l: any) => (
                <label key={l.ref_id} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] cursor-pointer hover:bg-app">
                  <input type="checkbox" checked={l.done} disabled={!canEdit} onChange={e => act({ action: 'linkDone', kind: 'listing', refId: l.ref_id, done: e.target.checked })} />
                  <span className={l.done ? 'line-through text-muted' : 'text-ink'}>{l.label || listings.find((x: any) => x.id === l.ref_id)?.label || l.ref_id}</span>
                  {canEdit && <button onClick={e => { e.preventDefault(); act({ action: 'unlink', kind: 'listing', refId: l.ref_id }) }} className="ml-auto text-muted hover:text-rose-600"><X size={11} /></button>}
                </label>
              ))}
              {!units.length && <p className="text-[12px] text-muted px-2.5 py-3">Not linked to any unit.</p>}
            </div>
            {canEdit && <AddUnits listings={listings} onAdd={ids => act({ action: 'link', kind: 'listing', refIds: ids })} />}
          </section>
        </div>
      )}

      {tab === 'money' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Budget"><input defaultValue={p.budget_cents == null ? '' : (p.budget_cents / 100).toFixed(2)} disabled={!canEdit}
              onBlur={e => patch({ budget: e.target.value })} className="w-full text-[13px] rounded-lg border border-line px-2.5 py-1.5" /></Field>
            <Field label="Spent so far"><div className="text-[15px] font-bold text-ink tabular-nums py-1.5">{money(p.spent_cents)}</div></Field>
          </div>
          {p.budget_cents != null && (
            <div>
              <span className="block h-2 rounded-full bg-app overflow-hidden">
                <span className={'block h-full ' + (p.spent_cents > p.budget_cents ? 'bg-rose-500' : 'bg-emerald-500')}
                  style={{ width: Math.min(100, Math.round((p.spent_cents / Math.max(1, p.budget_cents)) * 100)) + '%' }} />
              </span>
              <span className="block text-[11px] text-muted mt-1 tabular-nums">
                {money(p.spent_cents)} of {money(p.budget_cents)}
                {p.spent_cents > p.budget_cents && <b className="text-rose-700"> · over by {money(p.spent_cents - p.budget_cents)}</b>}
              </span>
            </div>
          )}
          {canEdit && <AddSpend onAdd={(amount, note) => act({ action: 'spend', amount, note })} busy={busy === 'x'} />}
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={p.billable} disabled={!canEdit} onChange={e => patch({ billable: e.target.checked })} />
            Rebill this to the owner
          </label>

          <section className="rounded-xl border border-line bg-app/40 p-3">
            <h4 className="text-[12px] font-bold text-ink mb-1.5 inline-flex items-center gap-1.5"><Mail size={13} className="text-brand-600" /> Owner approval email</h4>
            <p className="text-[11px] text-muted mb-2">
              Drafted from this project — the scope and the number come from the record, not from memory.
              Nothing is sent: copy it, edit it, send it yourself.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input defaultValue={p.owner_name || ''} disabled={!canEdit} onBlur={e => patch({ owner_name: e.target.value })} placeholder="Owner name"
                className="text-[12px] rounded-lg border border-line px-2.5 py-1.5" />
              <button onClick={() => act({ action: 'ownerEmail' }, 'mail')} disabled={busy === 'mail'}
                className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                {busy === 'mail' ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Draft it
              </button>
            </div>
            {draft && (
              <div className="rounded-lg border border-line bg-white p-2.5">
                <p className="text-[12px] font-semibold text-ink mb-1">{draft.subject}</p>
                <textarea readOnly value={draft.body} rows={10} className="w-full text-[12px] text-ink/80 bg-transparent resize-y focus:outline-none" />
                <div className="flex gap-2 mt-1.5">
                  <button onClick={() => navigator.clipboard?.writeText(draft.subject + '\n\n' + draft.body)}
                    className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line inline-flex items-center gap-1"><Copy size={11} /> Copy</button>
                  <a href={`mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                    className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line inline-flex items-center gap-1"><ExternalLink size={11} /> Open in mail</a>
                  {canEdit && <button onClick={() => patch({ approval: 'requested' })} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-800 border border-amber-200 ml-auto">Mark as asked</button>}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'photos' && (
        <div>
          {canEdit && (
            <div className="mb-3">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy === 'photo'}
                className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-line inline-flex items-center gap-1.5 hover:bg-app disabled:opacity-50">
                {busy === 'photo' ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} Add photo
              </button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {p.photos.map((ph: any) => (
              <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-line group relative">
                <img src={ph.url} alt={ph.caption || ''} className="w-full h-28 object-cover" />
                <span className="absolute top-1 left-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-black/60 text-white">{ph.phase}</span>
                {ph.via_share && <span className="absolute top-1 right-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-600 text-white">vendor</span>}
              </a>
            ))}
            {!p.photos.length && <p className="col-span-3 text-[12px] text-muted py-6 text-center">No photos yet.</p>}
          </div>
        </div>
      )}

      {tab === 'share' && (
        <div className="space-y-3">
          <p className="text-[12px] text-muted">
            A vendor link shows <b className="text-ink">only this project</b> — the scope, the checklist, the dates and
            the photos. It never shows the budget, what has been spent, the owner, or your internal notes.
          </p>
          <Field label="Vendor name">
            <input defaultValue={p.vendor_name || ''} disabled={!canEdit} onBlur={e => patch({ vendor_name: e.target.value })}
              placeholder="Who is this link for?" className="w-full text-[13px] rounded-lg border border-line px-2.5 py-1.5" />
          </Field>
          {shareUrl ? (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-app px-2.5 py-2">
                <code className="flex-1 text-[11px] text-ink truncate">{shareUrl}</code>
                <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="text-muted hover:text-ink" title="Copy"><Copy size={13} /></button>
                <a href={shareUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="Open"><ExternalLink size={13} /></a>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <button onClick={() => patch({ share: 'rotate' })} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-app">Rotate link</button>
                  <button onClick={() => patch({ share: 'revoke' })} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50">Revoke</button>
                </div>
              )}
              <p className="text-[11px] text-muted">Rotating gives you a new link and kills the old one immediately.</p>
            </>
          ) : canEdit ? (
            <button onClick={() => patch({ share: 'new' })} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white inline-flex items-center gap-1.5">
              <Link2 size={13} /> Create vendor link
            </button>
          ) : <p className="text-[12px] text-muted">No vendor link.</p>}
        </div>
      )}

      {tab === 'log' && (
        <div className="space-y-3">
          {canEdit && (
            <form onSubmit={e => { e.preventDefault(); if (note.trim()) { act({ action: 'note', body: note }); setNote('') } }} className="flex gap-2">
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note…" className="flex-1 text-[12px] rounded-lg border border-line px-2.5 py-1.5" />
              <button className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-app">Post</button>
            </form>
          )}
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {p.notes.map((n: any) => (
              <div key={n.id} className={'rounded-lg px-2.5 py-1.5 text-[12px] ' + (n.kind === 'event' ? 'bg-app text-muted' : 'bg-white border border-line text-ink')}>
                <p>{n.body}</p>
                <p className="text-[10px] text-muted mt-0.5">
                  {n.author || 'system'}{n.via_share ? ' (vendor)' : ''} · {new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            ))}
            {!p.notes.length && <p className="text-[12px] text-muted py-4 text-center">Nothing yet.</p>}
          </div>
        </div>
      )}

      {canFull && (
        <div className="border-t border-line mt-4 pt-3">
          <button onClick={async () => {
            if (!window.confirm('Archive this project? It stays searchable but leaves the board.')) return
            await fetch('/api/projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
            onChanged(); onClose()
          }} className="text-[12px] text-rose-700 hover:underline inline-flex items-center gap-1.5"><Archive size={12} /> Archive project</button>
        </div>
      )}
    </Modal>
  )
}

function AddUnits({ listings, onAdd }: { listings: any[]; onAdd: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  if (!open) return <button onClick={() => setOpen(true)} className="mt-2 text-[12px] font-semibold text-brand-700 hover:underline inline-flex items-center gap-1"><Plus size={12} /> Link units</button>
  return (
    <div className="mt-2">
      <UnitPicker listings={listings} value={sel} onChange={setSel} />
      <div className="flex gap-2 mt-1.5">
        <button onClick={() => { if (sel.length) onAdd(sel); setSel([]); setOpen(false) }} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-brand-600 text-white">Add {sel.length || ''}</button>
        <button onClick={() => { setSel([]); setOpen(false) }} className="text-[12px] px-2.5 py-1 rounded-lg border border-line">Cancel</button>
      </div>
    </div>
  )
}

function AddSpend({ onAdd, busy }: { onAdd: (a: string, n: string) => void; busy: boolean }) {
  const [amt, setAmt] = useState(''); const [n, setN] = useState('')
  return (
    <form onSubmit={e => { e.preventDefault(); if (amt.trim()) { onAdd(amt, n); setAmt(''); setN('') } }} className="flex gap-2">
      <input value={amt} onChange={e => setAmt(e.target.value)} placeholder="$ amount" className="w-28 text-[12px] rounded-lg border border-line px-2.5 py-1.5" />
      <input value={n} onChange={e => setN(e.target.value)} placeholder="What for?" className="flex-1 text-[12px] rounded-lg border border-line px-2.5 py-1.5" />
      <button disabled={busy} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-app inline-flex items-center gap-1.5 disabled:opacity-50">
        <DollarSign size={12} /> Log
      </button>
    </form>
  )
}

// ---------------------------------------------------------------- chrome
function Field({ label, children }: { label: string; children: any }) {
  return <div className="mb-2"><label className="block text-[11px] font-semibold text-muted mb-0.5">{label}</label>{children}</div>
}
function Modal({ title, sub, children, onClose, wide }: { title: string; sub?: string; children: any; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/30" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className={'bg-white rounded-2xl border border-line shadow-xl w-full overflow-hidden max-h-[90vh] flex flex-col ' + (wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="px-4 py-3 border-b border-line flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-bold text-ink truncate">{title}</h3>
            {sub && <p className="text-[11px] text-muted truncate">{sub}</p>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink p-1"><X size={16} /></button>
        </div>
        <div className="px-4 py-3 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

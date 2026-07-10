'use client'
// Property Audit - desktop review desk: create/share unit audit links, review captured items,
// and create + assign ONE Breezeway task per item (approval-gated; the mobile link never does this).
import { useEffect, useState } from 'react'

type Counts = { total: number; open: number; tasks: number }
type Audit = { id: string; listingId: string; shareCode: string; status: string; createdAt: string; unit: string; building: string; counts: Counts }
type ListingOpt = { id: string; name: string; building: string }
type Person = { id: number | string; name?: string; first_name?: string; last_name?: string; department?: string | null }
type Item = { id: string; room: string; kind: string; item_type?: string | null; title?: string | null; note?: string | null; photo_url?: string | null; severity?: string | null; status: string; breezeway_task_id?: string | null; report_url?: string | null; ai_assessment?: any }
type Cfg = { department: string; priority: string; assignee: string }

const KIND_CLS: Record<string, string> = { maintenance: 'bg-amber-100 text-amber-800 border-amber-300', replace: 'bg-rose-100 text-rose-700 border-rose-300', add: 'bg-sky-100 text-sky-800 border-sky-300' }
const KIND_LABEL: Record<string, string> = { maintenance: 'Fix', replace: 'Replace', add: 'Add' }
const DEPTS = ['maintenance', 'inspection', 'housekeeping', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']

function personName(p: Person): string { return p.name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || String(p.id) }
function defCfg(it: Item): Cfg { return { department: it.kind === 'maintenance' ? 'maintenance' : 'inspection', priority: it.severity === 'high' ? 'high' : 'normal', assignee: '' } }

export function AuditDesk() {
  const [audits, setAudits] = useState<Audit[]>([])
  const [listings, setListings] = useState<ListingOpt[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [itemsBusy, setItemsBusy] = useState(false)
  const [taskCfg, setTaskCfg] = useState<Record<string, Cfg>>({})
  const [taskBusy, setTaskBusy] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState('')

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/audit')
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Failed to load audits'); setLoading(false); return }
      setAudits(j.audits || []); setListings(j.listings || []); setErr('')
    } catch { setErr('Network error') }
    setLoading(false)
  }
  useEffect(() => { load(); fetch('/api/audit/task').then(r => r.json()).then(j => setPeople((j && j.people) || [])).catch(() => {}) }, [])

  async function openAudit(a: Audit) {
    if (openId === a.id) { setOpenId(''); return }
    setOpenId(a.id); setItemsBusy(true); setItems([])
    try {
      const r = await fetch('/api/audit?code=' + encodeURIComponent(a.shareCode))
      const j = await r.json()
      setItems((j && j.items) || [])
    } catch {}
    setItemsBusy(false)
  }

  async function createAudit() {
    if (!pick || creating) return
    setCreating(true)
    try {
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createAudit', listingId: pick }) })
      const j = await r.json()
      if (r.ok && j.ok) { await load(); if (j.url && j.audit) { try { await navigator.clipboard.writeText(j.url); setCopied(j.audit.id); setTimeout(() => setCopied(''), 2500) } catch {} } }
      else alert(j.error || 'Failed to create the audit link')
    } catch { alert('Failed - retry') }
    setCreating(false)
  }

  function copyLink(a: Audit) {
    const url = location.origin + '/audit/' + a.shareCode
    try { navigator.clipboard.writeText(url); setCopied(a.id); setTimeout(() => setCopied(''), 2000) } catch { prompt('Copy the link:', url) }
  }

  function setCfg(it: Item, patch: Partial<Cfg>) {
    setTaskCfg(c => { const cur = c[it.id] || defCfg(it); const n = { ...c }; n[it.id] = { ...cur, ...patch }; return n })
  }

  async function createTask(it: Item) {
    if (taskBusy[it.id]) return
    const cfg = taskCfg[it.id] || defCfg(it)
    if (!confirm('Create a Breezeway ' + cfg.department + ' task for ' + (it.title || it.item_type || 'this item') + '?')) return
    setTaskBusy(b => { const n = { ...b }; n[it.id] = true; return n })
    try {
      const body: any = { itemId: it.id, department: cfg.department, priority: cfg.priority }
      if (cfg.assignee) body.assigneeIds = [Number(cfg.assignee)]
      const r = await fetch('/api/audit/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (r.ok && j.ok) setItems(list => list.map(x => x.id === it.id ? { ...x, status: 'task_created', breezeway_task_id: j.taskId, report_url: j.reportUrl } : x))
      else alert(j.error || 'Task creation failed')
    } catch { alert('Task creation failed - retry') }
    setTaskBusy(b => { const n = { ...b }; n[it.id] = false; return n })
  }

  const sorted = audits.slice().sort((a, b) => (a.building || '').localeCompare(b.building || '') || a.unit.localeCompare(b.unit))
  const roomNames: string[] = []
  for (const it of items) if (roomNames.indexOf(it.room) < 0) roomNames.push(it.room)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={pick} onChange={e => setPick(e.target.value)} className="text-sm border border-line rounded-lg px-2.5 py-2 bg-white max-w-[320px]">
          <option value="">Pick a listing\u2026</option>
          {listings.map(l => <option key={l.id} value={l.id}>{l.name}{l.building ? ' \u00b7 ' + l.building : ''}</option>)}
        </select>
        <button onClick={createAudit} disabled={!pick || creating} className="text-sm font-semibold px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-40">{creating ? 'Creating\u2026' : '+ New audit link'}</button>
        <span className="text-xs text-muted">Links are mobile-friendly — send to a supervisor or manager.</span>
      </div>
      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{err}</div> : null}
      {loading ? <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">Loading audits…</div> : null}
      {!loading && sorted.length === 0 ? <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">No audits yet — pick a listing above to create the first link.</div> : null}
      {sorted.map(a => (
        <div key={a.id} className="rounded-xl border border-line bg-white overflow-hidden">
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <button onClick={() => openAudit(a)} className="text-left flex-1 min-w-0">
              <span className="text-sm font-semibold text-ink">{a.unit}</span>
              {a.building ? <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">{a.building}</span> : null}
            </button>
            <span className="text-xs text-muted shrink-0">{a.counts.total} items · {a.counts.open} open · {a.counts.tasks} tasks</span>
            <button onClick={() => copyLink(a)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-neutral-50 shrink-0">{copied === a.id ? 'Copied \u2713' : 'Copy link'}</button>
            <button onClick={() => openAudit(a)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-neutral-50 shrink-0">{openId === a.id ? 'Close' : 'Review'}</button>
          </div>
          {openId === a.id ? (
            <div className="border-t border-line px-3.5 py-3 space-y-3 bg-neutral-50/50">
              {itemsBusy ? <div className="text-sm text-muted">Loading items…</div> : null}
              {!itemsBusy && items.length === 0 ? <div className="text-sm text-muted">Nothing captured yet on this audit.</div> : null}
              {roomNames.map(room => (
                <div key={room}>
                  <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1.5">{room}</div>
                  <div className="space-y-2">
                    {items.filter(x => x.room === room).map(it => {
                      const cfg = taskCfg[it.id] || defCfg(it)
                      const ai = it.ai_assessment && typeof it.ai_assessment === 'object' ? it.ai_assessment : null
                      return (
                        <div key={it.id} className="flex gap-3 rounded-lg border border-line bg-white p-2.5">
                          {it.photo_url ? <a href={it.photo_url} target="_blank" rel="noreferrer"><img src={it.photo_url} alt="" className="w-16 h-16 rounded-md object-cover shrink-0" /></a> : <div className="w-16 h-16 rounded-md bg-neutral-100 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border ' + (KIND_CLS[it.kind] || KIND_CLS.replace)}>{KIND_LABEL[it.kind] || 'Replace'}</span>
                              <span className="text-sm font-semibold text-ink">{it.title || it.item_type || 'Item'}</span>
                              {it.severity ? <span className={'text-[10px] px-1.5 py-0.5 rounded-full ' + (it.severity === 'high' ? 'bg-rose-100 text-rose-700' : it.severity === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-500')}>{it.severity}</span> : null}
                            </div>
                            {it.note ? <div className="text-xs text-neutral-600 mt-0.5">{it.note}</div> : null}
                            {ai && ai.condition ? <div className="text-[11px] text-violet-700 mt-0.5">AI: {String(ai.condition)}</div> : null}
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-1.5">
                            {it.status === 'task_created' ? (
                              <div className="text-right">
                                <div className="text-xs font-semibold text-emerald-700">Task created ✓</div>
                                {it.report_url ? <a href={it.report_url} target="_blank" rel="noreferrer" className="text-[11px] text-brand-700 hover:underline">Open in Breezeway</a> : null}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <select value={cfg.department} onChange={e => setCfg(it, { department: e.target.value })} className="text-[11px] border border-line rounded-lg px-1.5 py-1 bg-white">
                                  {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                                <select value={cfg.priority} onChange={e => setCfg(it, { priority: e.target.value })} className="text-[11px] border border-line rounded-lg px-1.5 py-1 bg-white">
                                  {PRIOS.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <select value={cfg.assignee} onChange={e => setCfg(it, { assignee: e.target.value })} className="text-[11px] border border-line rounded-lg px-1.5 py-1 bg-white max-w-[140px]">
                                  <option value="">Unassigned</option>
                                  {people.map(p => <option key={String(p.id)} value={String(p.id)}>{personName(p)}</option>)}
                                </select>
                                <button onClick={() => createTask(it)} disabled={!!taskBusy[it.id]} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{taskBusy[it.id] ? 'Creating\u2026' : 'Create task'}</button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

'use client'
// Property Audit - desktop review desk: create/share unit audit links, review captured items,
// and create + assign ONE Breezeway task per item (approval-gated; the mobile link never does this).
import { useEffect, useState } from 'react'

type Counts = { total: number; open: number; tasks: number }
type Audit = { id: string; listingId: string; shareCode: string; status: string; createdAt: string; unit: string; nextCheckout?: string | null; building: string; counts: Counts }
type ListingOpt = { id: string; name: string; building: string }
type Person = { id: number | string; name?: string; first_name?: string; last_name?: string; department?: string | null }
type Item = { id: string; room: string; kind: string; item_type?: string | null; title?: string | null; note?: string | null; photo_url?: string | null; severity?: string | null; status: string; qty?: number; breezeway_task_id?: string | null; report_url?: string | null; task_status?: string | null; ai_assessment?: any }
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
  const [showDone, setShowDone] = useState(false)

  async function createAllAudits() {
    if (!confirm('Create an audit link for every active listing that does not have one yet?')) return
    setCreating(true)
    try {
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createAll' }) })
      const j = await r.json()
      if (r.ok && j.ok) { await load(); alert('Created ' + j.created + ' audit links.') } else alert(j.error || 'Failed')
    } catch { alert('Failed - retry') }
    setCreating(false)
  }

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

  async function setItemStatus(it: Item, status: string) {
    try {
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', itemId: it.id, fields: { status } }) })
      const j = await r.json()
      if (r.ok && j.ok) setItems(list => list.map(x => x.id === it.id ? { ...x, status } : x))
      else alert(j.error || 'Update failed')
    } catch { alert('Update failed') }
  }

  async function setQty(it: Item, qty: number) {
    const q = Math.max(1, Math.min(50, qty))
    setItems(list => list.map(x => x.id === it.id ? { ...x, qty: q } : x))
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', itemId: it.id, fields: { qty: q } }) }) } catch {}
  }

  function copyOrder(a: Audit) {
    const order = items.filter(x => (x.kind === 'replace' || x.kind === 'add') && x.status !== 'dismissed' && x.status !== 'done')
    if (order.length === 0) { alert('No replace/add items on this audit yet.'); return }
    const lines: string[] = ['ORDER LIST - ' + a.unit + (a.building ? ' (' + a.building + ')' : ''), '']
    for (const it of order) {
      lines.push('- ' + (it.qty || 1) + 'x ' + (it.title || it.item_type || 'Item') + ' [' + it.room + ']' + (it.kind === 'add' ? ' (new)' : ''))
      if (it.note) lines.push('    note: ' + it.note)
      if (it.photo_url) lines.push('    photo: ' + it.photo_url)
    }
    try { navigator.clipboard.writeText(lines.join('\n')); setCopied('order-' + a.id); setTimeout(() => setCopied(''), 2500) } catch { prompt('Copy:', lines.join('\n')) }
  }

  async function markComplete(a: Audit, reopen: boolean) {
    try {
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: reopen ? 'reopenAudit' : 'completeAudit', auditId: a.id }) })
      const j = await r.json()
      if (r.ok && j.ok) await load(); else alert(j.error || 'Failed')
    } catch { alert('Failed') }
  }

  const sorted = audits.slice().sort((a, b) => (a.building || '').localeCompare(b.building || '') || a.unit.localeCompare(b.unit))
  const roomNames: string[] = []
  for (const it of items) if (roomNames.indexOf(it.room) < 0) roomNames.push(it.room)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={pick} onChange={e => setPick(e.target.value)} className="text-sm border border-line rounded-lg px-2.5 py-2 bg-white max-w-[320px]">
          <option value="">Pick a listing…</option>
          {listings.map(l => <option key={l.id} value={l.id}>{l.name}{l.building ? ' · ' + l.building : ''}</option>)}
        </select>
        <button onClick={createAudit} disabled={!pick || creating} className="text-sm font-semibold px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-40">{creating ? 'Creating…' : '+ New audit link'}</button>
        <button onClick={createAllAudits} disabled={creating} className="text-sm font-semibold px-3 py-2 rounded-lg border border-line hover:bg-neutral-50 disabled:opacity-40">Create all</button>
        <span className="text-xs text-muted">Links are mobile-friendly — send to a supervisor or manager.</span>
        <label className="text-xs text-muted inline-flex items-center gap-1.5 ml-auto cursor-pointer"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show completed</label>
      </div>
      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{err}</div> : null}
      {loading ? <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">Loading audits…</div> : null}
      {!loading && sorted.length === 0 ? <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">No audits yet — pick a listing above to create the first link.</div> : null}
      {(() => { const visible = sorted.filter(x => showDone || x.status !== 'completed'); const bldgs: string[] = []; for (const x of visible) { const b = x.building || 'Other'; if (bldgs.indexOf(b) < 0) bldgs.push(b) } return bldgs.map(bld => (
        <div key={bld}>
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mt-2 mb-1.5">{bld} · {visible.filter(x => (x.building || 'Other') === bld).length}</div>
          <div className="space-y-2">
          {visible.filter(x => (x.building || 'Other') === bld).map(a => (
        <div key={a.id} className="rounded-xl border border-line bg-white overflow-hidden">
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <button onClick={() => openAudit(a)} className="text-left flex-1 min-w-0">
              <span className="text-sm font-semibold text-ink">{a.unit}</span>
              {a.building ? <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">{a.building}</span> : null}{a.nextCheckout ? <span className="ml-2 text-[10px] text-amber-700">next checkout {a.nextCheckout.slice(5)}</span> : <span className="ml-2 text-[10px] text-neutral-300">no upcoming checkout</span>}
            </button>
            <span className="text-xs text-muted shrink-0">{a.counts.total} items · {a.counts.open} open · {a.counts.tasks} tasks</span>
            <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ' + (a.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{a.status === 'completed' ? 'COMPLETED' : 'OPEN'}</span>
            <button onClick={() => markComplete(a, a.status === 'completed')} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-neutral-50 shrink-0">{a.status === 'completed' ? 'Reopen' : 'Mark complete'}</button>
            <button onClick={() => copyLink(a)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-neutral-50 shrink-0">{copied === a.id ? 'Copied ✓' : 'Copy link'}</button>
            <button onClick={() => openAudit(a)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line hover:bg-neutral-50 shrink-0">{openId === a.id ? 'Close' : 'Review'}</button>
          </div>
          {openId === a.id ? (
            <div className="border-t border-line px-3.5 py-3 space-y-3 bg-neutral-50/50">
              {(() => { const order = items.filter(x => (x.kind === 'replace' || x.kind === 'add') && x.status !== 'dismissed'); if (order.length === 0) return null; return (
                <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="text-[12px] font-bold text-sky-900">Order list ({order.length})</div>
                    <button onClick={() => copyOrder(a)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-sky-700 text-white">{copied === 'order-' + a.id ? 'Copied ✓' : 'Generate order'}</button>
                  </div>
                  <div className="space-y-1">
                    {order.map(it => (
                      <div key={'o' + it.id} className="flex items-center gap-2 text-xs text-sky-950">
                        <span className="inline-flex items-center gap-1 shrink-0">
                          <button onClick={() => setQty(it, (it.qty || 1) - 1)} className="w-5 h-5 rounded border border-sky-200 bg-white leading-none">-</button>
                          <span className="w-6 text-center font-semibold">{it.qty || 1}</span>
                          <button onClick={() => setQty(it, (it.qty || 1) + 1)} className="w-5 h-5 rounded border border-sky-200 bg-white leading-none">+</button>
                        </span>
                        <span className="flex-1 truncate">{it.title || it.item_type || 'Item'} <span className="text-sky-700/60">· {it.room}{it.kind === 'add' ? ' · new' : ''}</span></span>
                        <select value={it.status === 'ordered' || it.status === 'done' ? it.status : 'open'} onChange={e => setItemStatus(it, e.target.value)} className="text-[11px] border border-sky-200 rounded-lg px-1.5 py-0.5 bg-white shrink-0">
                          <option value="open">to order</option>
                          <option value="ordered">ordered</option>
                          <option value="done">done</option>
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-sky-700/70 mt-1.5">Replace + Add items join this list automatically. AI product suggestions come in P2.</div>
                </div>
              ) })()}
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
                        <div key={it.id} className={'flex gap-3 rounded-lg border border-line bg-white p-2.5' + (it.status === 'dismissed' ? ' opacity-60' : '')}>
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
                            {it.status === 'dismissed' ? <div className="text-xs text-neutral-400 font-semibold">Dismissed</div> : it.status === 'task_created' ? (
                              <div className="text-right">
                                <div className={'text-xs font-semibold ' + (it.task_status === 'completed' ? 'text-emerald-700' : 'text-sky-700')}>{it.task_status === 'completed' ? 'Task done ✓' : it.task_status === 'in_progress' ? 'Task in progress' : 'Task created ✓'}</div>
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
                                <button onClick={() => createTask(it)} disabled={!!taskBusy[it.id]} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{taskBusy[it.id] ? 'Creating…' : 'Create task'}</button>
                                <button onClick={() => { if (confirm('Close this item (owner declined / will not fix)?')) setItemStatus(it, 'dismissed') }} className="text-[11px] px-2 py-1.5 rounded-lg border border-line text-neutral-400 hover:text-rose-600">Dismiss</button>
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
        </div>
      )) })()}
    </div>
  )
}

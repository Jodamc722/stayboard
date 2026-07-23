'use client'
// Property-wide ORDER DESK - every Replace/Add need captured on audits, as a buying command center.
// Two toggleable views of the same orders:
//   - BY ITEM  : identical needs rolled up across the whole portfolio (Cutting board x7 - 7 units),
//                so you price once, attach one link, and act on the whole batch.
//   - BY UNIT  : everything a building / unit needs (the classic grouped list).
// Guided buying lifecycle per line: Ready -> Ordered -> Arriving -> Received -> Installed.
// Approval-aware: only GM/owner-approved items are buyable (details.approval); unapproved show greyed
// with GM approve / send-to-owner. On "Received" we create a per-unit place-it Breezeway task (one
// call flips the item to task_created AND dispatches the install task) so it closes out in the field
// worklist with a proof photo. Data: /api/audit?orders=1 (session-auth).
import { useEffect, useState } from 'react'

type Row = { id: string; audit_id: string; listing_id: string; room: string; kind: string; title: string | null; qty: number | null; note: string | null; photo_url: string | null; status: string; details: any; created_at: string; unit: string; building: string; breezeway_task_id?: string | null; report_url?: string | null }

type Stage = 'blocked' | 'owner' | 'ready' | 'ordered' | 'arriving' | 'received' | 'installed'

const STAGE_LABEL: Record<Stage, string> = { blocked: 'Needs approval', owner: 'Awaiting owner', ready: 'Ready to buy', ordered: 'Ordered', arriving: 'Arriving', received: 'Received', installed: 'Installed' }
const STAGE_CLS: Record<Stage, string> = { blocked: 'bg-amber-100 text-amber-800', owner: 'bg-violet-100 text-violet-700', ready: 'bg-emerald-100 text-emerald-800', ordered: 'bg-sky-100 text-sky-800', arriving: 'bg-indigo-100 text-indigo-800', received: 'bg-teal-100 text-teal-800', installed: 'bg-neutral-200 text-neutral-600' }
// The filter strip, left to right, and which stages roll into each bucket.
const FILTERS: { key: string; label: string; stages: Stage[] }[] = [
  { key: 'all', label: 'All open', stages: ['blocked', 'owner', 'ready', 'ordered', 'arriving', 'received'] },
  { key: 'blocked', label: 'Needs approval', stages: ['blocked', 'owner'] },
  { key: 'ready', label: 'Ready to buy', stages: ['ready'] },
  { key: 'ordered', label: 'Ordered', stages: ['ordered'] },
  { key: 'arriving', label: 'Arriving', stages: ['arriving'] },
  { key: 'received', label: 'Received', stages: ['received'] },
  { key: 'installed', label: 'Installed', stages: ['installed'] },
]

function approvalOf(it: Row): string { return String((it.details && it.details.approval) || '') }
function isBuyable(it: Row): boolean {
  const a = approvalOf(it)
  if (a === 'gm_approved' || a === 'owner_approved') return true
  // Legacy items approved before the ladder existed: infer from a status that is past approval.
  if (!a && ['approved', 'ordered', 'arriving', 'done', 'task_created'].includes(it.status)) return true
  return false
}
function stageOf(it: Row): Stage {
  if (it.status === 'done') return 'installed'
  if (it.status === 'task_created') return 'received'
  if (it.status === 'arriving') return 'arriving'
  if (it.status === 'ordered') return 'ordered'
  if (approvalOf(it) === 'declined') return 'blocked'
  if (approvalOf(it) === 'owner_pending') return 'owner'
  return isBuyable(it) ? 'ready' : 'blocked'
}
function estOf(it: Row): number { const n = Number(it.details && it.details.est); return Number.isFinite(n) && n > 0 ? n : 0 }
function lineCost(it: Row): number { return estOf(it) * Math.max(1, Number(it.qty) || 1) }

export function OrderDesk() {
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [view, setView] = useState<'item' | 'unit'>('item')
  const [tf, setTf] = useState('all')
  const [q, setQ] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [openGrp, setOpenGrp] = useState<Record<string, boolean>>({})
  const [moreFor, setMoreFor] = useState('')
  const [sugFor, setSugFor] = useState('')
  const [sugList, setSugList] = useState<any[]>([])
  const [sugBusy, setSugBusy] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [xlBldg, setXlBldg] = useState('all')
  const [xlUnit, setXlUnit] = useState('all')
  const [xlBusy, setXlBusy] = useState(false)
  const [planCopied, setPlanCopied] = useState(false)
  const [ownerCopied, setOwnerCopied] = useState(false)
  const [estBusy, setEstBusy] = useState(false)
  const [estMsg, setEstMsg] = useState('')
  const [owners, setOwners] = useState<{ id: string; name: string; listingIds: string[] }[]>([])
  const [ownerId, setOwnerId] = useState('')

  async function load() {
    try {
      const r = await fetch('/api/audit?orders=1')
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not load orders.'); setLoading(false); return }
      setRows(j.orders || [])
    } catch { setErr('Network error - reload to retry.') }
    setLoading(false)
  }
  useEffect(() => { load(); fetch('/api/orders/owners').then(r => r.json()).then(j => setOwners((j && Array.isArray(j.owners)) ? j.owners : [])).catch(() => {}) }, [])

  // Optimistic local patch so the desk feels instant; the POST is fire-and-forget.
  function patchLocal(ids: string[], fn: (it: Row) => Row) { const s = new Set(ids); setRows(list => list.map(x => s.has(x.id) ? fn(x) : x)) }
  async function saveItem(itemId: string, fields: any) {
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', itemId, fields }) }) } catch {}
  }
  async function setStatus(it: Row, status: string) {
    patchLocal([it.id], x => ({ ...x, status }))
    await saveItem(it.id, { status })
  }
  async function setApproval(it: Row, approval: string) {
    patchLocal([it.id], x => ({ ...x, details: { ...(x.details || {}), approval: approval === 'none' ? null : approval } }))
    await saveItem(it.id, { approval, approvedBy: approval === 'owner_pending' ? 'gm' : 'gm' })
  }
  // Received: create the per-unit place-it Breezeway task. That one call also flips status to
  // task_created server-side, so the item reads "Received" here and appears in the field worklist.
  async function markReceived(it: Row) {
    if (busy) return
    setBusy(it.id)
    try {
      const r = await fetch('/api/audit/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: it.id, department: 'housekeeping' }) })
      const j = await r.json()
      if (r.ok && j.ok) patchLocal([it.id], x => ({ ...x, status: 'task_created', breezeway_task_id: j.taskId, report_url: j.reportUrl || null }))
      else { alert(j.error || 'Could not create the install task. Marking received anyway.'); patchLocal([it.id], x => ({ ...x, status: 'task_created' })); await saveItem(it.id, { status: 'arriving' }) }
    } catch { alert('Network error - retry.') }
    setBusy('')
  }
  function advance(it: Row) {
    const st = stageOf(it)
    if (st === 'ready') setStatus(it, 'ordered')
    else if (st === 'ordered') setStatus(it, 'arriving')
    else if (st === 'arriving') markReceived(it)
    else if (st === 'received') setStatus(it, 'done')
  }
  function advLabel(st: Stage): string { return st === 'ready' ? 'Mark ordered' : st === 'ordered' ? 'Arriving' : st === 'arriving' ? 'Received' : st === 'received' ? 'Installed ✓' : '' }

  async function setLink(it: Row, link: string) { patchLocal([it.id], x => ({ ...x, details: { ...(x.details || {}), link: link || null } })); await saveItem(it.id, { link }) }
  function askLink(it: Row) {
    const cur = it.details && it.details.link ? String(it.details.link) : ''
    const v = window.prompt('Paste the product link for: ' + (it.title || ''), cur)
    if (v !== null) setLink(it, v.trim())
  }
  function askEst(it: Row) {
    const cur = it.details && it.details.est ? String(it.details.est) : ''
    const v = window.prompt('Estimated price in USD for ONE ' + (it.title || 'item') + ':', cur)
    if (v === null) return
    const n = Math.round(Number(v))
    if (!Number.isFinite(n) || n < 0) { alert('Enter a number.'); return }
    patchLocal([it.id], x => ({ ...x, details: { ...(x.details || {}), est: n } }))
    saveItem(it.id, { est: n })
  }
  async function suggest(it: Row) {
    if (sugBusy) return
    if (sugFor === it.id) { setSugFor(''); setSugList([]); return }
    setSugFor(it.id); setSugList([]); setSugBusy(true)
    try {
      const r = await fetch('/api/orders/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: it.title, qty: it.qty || 1, note: it.note || '', room: it.room || '', building: it.building || '' }) })
      const j = await r.json()
      setSugList((j && j.options) || [])
    } catch {}
    setSugBusy(false)
  }

  // Bulk over the current selection - each action only touches lines it is valid for.
  const selIds = Object.keys(sel).filter(k => sel[k])
  function clearSel() { setSel({}) }
  async function bulk(action: 'approve' | 'order' | 'arriving' | 'received') {
    const targets = rows.filter(it => sel[it.id])
    if (!targets.length || bulkBusy) return
    setBulkBusy(true)
    for (const it of targets) {
      const st = stageOf(it)
      if (action === 'approve' && st === 'blocked') await setApproval(it, 'gm_approved')
      else if (action === 'order' && st === 'ready') await setStatus(it, 'ordered')
      else if (action === 'arriving' && st === 'ordered') await setStatus(it, 'arriving')
      else if (action === 'received' && st === 'arriving') await markReceived(it)
    }
    setBulkBusy(false); clearSel()
  }

  const nrm = (s: any) => String(s || '').toLowerCase()
  // Owner filter (real Guesty owner -> their listing ids). Selecting an owner scopes the whole desk
  // to their units and drives the owner-scoped share link.
  const selOwner = owners.find(o => o.id === ownerId) || null
  const ownerSet = selOwner ? new Set(selOwner.listingIds.map(String)) : null
  const visible = rows.filter(it => {
    const st = stageOf(it)
    if (st === 'installed' && !showDone && tf !== 'installed') return false
    const f = FILTERS.find(x => x.key === tf)
    if (f && tf !== 'all' && f.stages.indexOf(st) < 0) return false
    if (tf === 'all' && st === 'installed') return false
    if (ownerSet && !ownerSet.has(String(it.listing_id))) return false
    if (q && nrm(it.unit + ' ' + it.building + ' ' + it.title).indexOf(nrm(q)) < 0) return false
    return true
  })
  // Counts for the status strip (over ALL rows, not just the current filter).
  const counts: Record<string, number> = { all: 0, blocked: 0, ready: 0, ordered: 0, arriving: 0, received: 0, installed: 0 }
  let outstanding = 0
  for (const it of rows) {
    const st = stageOf(it)
    if (st !== 'installed') counts.all++
    if (st === 'blocked' || st === 'owner') counts.blocked++
    else if (st === 'ready') counts.ready++
    else if (st === 'ordered') counts.ordered++
    else if (st === 'arriving') counts.arriving++
    else if (st === 'received') counts.received++
    else if (st === 'installed') counts.installed++
    if (isBuyable(it) && st !== 'installed') outstanding += lineCost(it)
  }
  const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

  // ---- BY UNIT grouping ----
  const byBldg: Record<string, Record<string, Row[]>> = {}
  for (const it of visible) { const b = it.building || 'Other'; if (!byBldg[b]) byBldg[b] = {}; if (!byBldg[b][it.unit]) byBldg[b][it.unit] = []; byBldg[b][it.unit].push(it) }
  const bldgs = Object.keys(byBldg).sort()

  // ---- BY ITEM grouping (rolled up across the portfolio) ----
  const groups: Record<string, Row[]> = {}
  for (const it of visible) { const k = nrm(it.title) || '(untitled)'; if (!groups[k]) groups[k] = []; groups[k].push(it) }
  const groupKeys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b))

  async function groupSetLink(key: string) {
    const items = groups[key]; if (!items.length) return
    const cur = items[0].details && items[0].details.link ? String(items[0].details.link) : ''
    const v = window.prompt('Product link for ALL ' + items.length + ' "' + (items[0].title || '') + '" lines:', cur)
    if (v === null) return
    const link = v.trim()
    patchLocal(items.map(i => i.id), x => ({ ...x, details: { ...(x.details || {}), link: link || null } }))
    for (const it of items) await saveItem(it.id, { link })
  }
  async function groupSetPrice(key: string) {
    const items = groups[key]; if (!items.length) return
    const v = window.prompt('Estimated price for ONE "' + (items[0].title || '') + '" (applies to all ' + items.length + ' lines):', '')
    if (v === null) return
    const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0) { alert('Enter a number.'); return }
    patchLocal(items.map(i => i.id), x => ({ ...x, details: { ...(x.details || {}), est: n } }))
    for (const it of items) await saveItem(it.id, { est: n })
  }
  async function groupAct(key: string, action: 'approve' | 'order') {
    const items = groups[key].filter(it => action === 'approve' ? stageOf(it) === 'blocked' : stageOf(it) === 'ready')
    if (!items.length || bulkBusy) return
    setBulkBusy(true)
    for (const it of items) { if (action === 'approve') await setApproval(it, 'gm_approved'); else await setStatus(it, 'ordered') }
    setBulkBusy(false)
  }

  // ---- Exports (unchanged behaviour, tucked into the Tools panel) ----
  function copySheet() {
    const chosen = rows.filter(it => { const s = stageOf(it); return isBuyable(it) && (s === 'ready' || s === 'ordered' || s === 'arriving' || s === 'received') })
    const lines: string[] = ['PROPERTY ORDER SHEET - approved + in flight', '']
    const bb: Record<string, Row[]> = {}
    for (const it of chosen) { const k = (it.building ? it.building + ' - ' : '') + it.unit; if (!bb[k]) bb[k] = []; bb[k].push(it) }
    for (const k of Object.keys(bb).sort()) {
      lines.push(k)
      for (const it of bb[k]) lines.push('  - ' + (it.qty && it.qty > 1 ? it.qty + 'x ' : '') + (it.title || '') + (it.room ? ' (' + it.room + ')' : '') + ' [' + STAGE_LABEL[stageOf(it)] + ']' + (it.details && it.details.link ? ' ' + it.details.link : ''))
      lines.push('')
    }
    const totals: Record<string, number> = {}
    for (const it of chosen) { const t = nrm(it.title); totals[t] = (totals[t] || 0) + (Number(it.qty) || 1) }
    lines.push('TOTALS BY ITEM')
    for (const t of Object.keys(totals).sort()) lines.push('  - ' + t + ': ' + totals[t])
    try { navigator.clipboard.writeText(lines.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch {}
  }
  function loadXLSX(): Promise<any> {
    return new Promise((resolve, reject) => {
      const w: any = window as any
      if (w.XLSX) { resolve(w.XLSX); return }
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
      s.onload = () => resolve((window as any).XLSX)
      s.onerror = () => reject(new Error('xlsx load failed'))
      document.head.appendChild(s)
    })
  }
  async function exportExcel() {
    if (xlBusy) return
    setXlBusy(true)
    try {
      const XLSX = await loadXLSX()
      const chosen = rows.filter(it => {
        if (stageOf(it) === 'installed') return false
        if (xlBldg !== 'all' && (it.building || 'Other') !== xlBldg) return false
        if (xlUnit !== 'all' && it.unit !== xlUnit) return false
        return true
      }).sort((a, b) => ((a.building || '') + a.unit).localeCompare((b.building || '') + b.unit))
      const head = ['Building', 'Unit', 'Room', 'Action', 'Item', 'Qty', 'Stage', 'Est $ each', 'Product link', 'Notes']
      const aoa: any[][] = [head]
      for (const it of chosen) aoa.push([it.building || '', it.unit, it.room || '', it.kind === 'add' ? 'Add' : 'Replace', it.title || '', Number(it.qty) || 1, STAGE_LABEL[stageOf(it)], estOf(it) || '', it.details && it.details.link ? String(it.details.link) : '', it.note || ''])
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 8 }, { wch: 34 }, { wch: 5 }, { wch: 14 }, { wch: 10 }, { wch: 40 }, { wch: 36 }]
      const totals: Record<string, number> = {}
      for (const it of chosen) { const t = String(it.title || '').trim(); if (t) totals[t] = (totals[t] || 0) + (Number(it.qty) || 1) }
      const taoa: any[][] = [['Item', 'Total qty']]
      for (const t of Object.keys(totals).sort()) taoa.push([t, totals[t]])
      const ws2 = XLSX.utils.aoa_to_sheet(taoa)
      ws2['!cols'] = [{ wch: 40 }, { wch: 10 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Order sheet')
      XLSX.utils.book_append_sheet(wb, ws2, 'Totals by item')
      const scope = xlUnit !== 'all' ? xlUnit : (xlBldg !== 'all' ? xlBldg : 'All properties')
      const d = new Date()
      const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      XLSX.writeFile(wb, ('Order sheet - ' + scope + ' - ' + ds).replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.xlsx')
    } catch { alert('Excel export failed - retry') }
    setXlBusy(false)
  }
  function copyPlanLink() { try { navigator.clipboard.writeText(window.location.origin + '/delivery'); setPlanCopied(true); setTimeout(() => setPlanCopied(false), 1600) } catch {} }
  function ownerScope(): string {
    // A picked owner wins: share exactly their listings (multi-listing scope).
    if (selOwner && selOwner.listingIds.length) return 'm:' + selOwner.listingIds.join(',')
    if (xlUnit !== 'all') { const row = rows.find(it => it.unit === xlUnit); return row ? 'u:' + row.listing_id : '' }
    if (xlBldg !== 'all') return 'b:' + xlBldg
    return ''
  }
  async function copyOwnerLink() {
    const scope = ownerScope()
    if (!scope) { alert('Pick a property or unit first - owner links are per property or per unit.'); return }
    try {
      const r = await fetch('/api/orders/share?scope=' + encodeURIComponent(scope))
      const j = await r.json()
      if (!r.ok || !j.ok) { alert(j.error || 'Could not build the link.'); return }
      await navigator.clipboard.writeText(j.url)
      setOwnerCopied(true); setTimeout(() => setOwnerCopied(false), 1600)
    } catch { alert('Could not build the link - retry.') }
  }
  async function estimateCosts() {
    if (estBusy) return
    setEstBusy(true); setEstMsg('')
    try {
      const r = await fetch('/api/orders/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: ownerScope() || 'all' }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setEstMsg(j.error || 'failed'); setEstBusy(false); return }
      setEstMsg(j.estimated + ' price' + (j.estimated === 1 ? '' : 's') + ' estimated ✓')
      await load()
    } catch { setEstMsg('failed - retry') }
    setEstBusy(false)
  }

  if (loading) return <div className="text-sm text-muted">Loading orders…</div>
  if (err) return <div className="text-sm text-rose-600">{err}</div>

  // ---- shared bits ----
  const actionBtn = (it: Row) => {
    const st = stageOf(it)
    if (st === 'blocked') return (
      <span className="flex items-center gap-1">
        <button onClick={() => setApproval(it, 'gm_approved')} disabled={busy === it.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-600 text-white disabled:opacity-50">GM approve</button>
        <button onClick={() => setApproval(it, 'owner_pending')} disabled={busy === it.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-violet-300 text-violet-700">→ Owner</button>
      </span>
    )
    if (st === 'owner') return <button onClick={() => setApproval(it, 'gm_approved')} disabled={busy === it.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted disabled:opacity-50">Override ✓</button>
    if (st === 'installed') return <span className="text-[11px] font-semibold text-emerald-700">Installed ✓</span>
    return <button onClick={() => advance(it)} disabled={busy === it.id} className={'text-[11px] font-semibold px-2 py-1 rounded-lg text-white disabled:opacity-50 ' + (st === 'ready' ? 'bg-emerald-600' : 'bg-ink')}>{busy === it.id ? '…' : advLabel(st)}</button>
  }

  const rowCard = (it: Row, showUnit: boolean) => {
    const st = stageOf(it)
    const link = it.details && it.details.link ? String(it.details.link) : ''
    const dim = st === 'blocked' || st === 'owner'
    return (
      <div key={it.id} className={'rounded-lg border border-line p-2 ' + (dim ? 'bg-neutral-50/60' : '')}>
        <div className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={!!sel[it.id]} onChange={e => setSel(s => ({ ...s, [it.id]: e.target.checked }))} className="shrink-0" />
          <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border ' + (it.kind === 'add' ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-rose-100 text-rose-700 border-rose-300')}>{it.kind === 'add' ? 'Add' : 'Replace'}</span>
          <span className={'text-sm font-semibold ' + (dim ? 'text-muted' : 'text-ink')}>{it.qty && it.qty > 1 ? it.qty + '× ' : ''}{it.title}</span>
          {showUnit ? <span className="text-[11px] text-muted">{it.unit}</span> : null}
          {it.room ? <span className="text-[11px] text-muted">{it.room}</span> : null}
          <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + STAGE_CLS[st]}>{STAGE_LABEL[st]}</span>
          {estOf(it) ? <span className="text-[11px] text-muted">{money(lineCost(it))}</span> : null}
          <span className="ml-auto flex items-center gap-1">
            {actionBtn(it)}
            <button onClick={() => setMoreFor(m => m === it.id ? '' : it.id)} className="text-[11px] font-semibold px-1.5 py-1 rounded-lg border border-line text-muted">⋯</button>
          </span>
        </div>
        {moreFor === it.id ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
            {it.photo_url ? <a href={it.photo_url} target="_blank" rel="noreferrer"><img src={it.photo_url} alt="" className="h-7 w-7 rounded object-cover" /></a> : null}
            <button onClick={() => askEst(it)} className={'text-[11px] font-semibold px-2 py-1 rounded-lg border ' + (estOf(it) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-line text-muted')}>{estOf(it) ? '~' + money(estOf(it)) + ' ea' : '$ price'}</button>
            {link ? <a href={link} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-brand-600">open link</a> : null}
            <button onClick={() => askLink(it)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted">{link ? 'edit link' : '+ link'}</button>
            <button onClick={() => suggest(it)} disabled={sugBusy} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted disabled:opacity-50">{sugFor === it.id && sugBusy ? '…' : '✨ Options'}</button>
            {st === 'received' && it.report_url ? <a href={it.report_url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-teal-700">install task ↗</a> : null}
            {st !== 'installed' ? <button onClick={() => setStatus(it, 'dismissed')} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted">Dismiss</button> : null}
            {it.note ? <span className="text-[11px] text-muted w-full">{it.note}</span> : null}
            {sugFor === it.id && sugList.length ? (
              <div className="w-full mt-1 rounded-lg bg-neutral-50 border border-line p-2 space-y-1">
                {sugList.map((o: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="font-semibold text-ink">{o.name}</span>
                    {o.why ? <span className="text-muted">{o.why}</span> : null}
                    {o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-600">search</a> : null}
                    {o.url ? <button onClick={() => setLink(it, o.url)} className="font-semibold text-[11px] px-1.5 py-0.5 rounded border border-line text-muted">use link</button> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      {/* status strip */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setTf(f.key)} className={'text-xs font-semibold px-2.5 py-1.5 rounded-lg border ' + (tf === f.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>
            {f.label}{' · '}{counts[f.key] === undefined ? 0 : counts[f.key]}
          </button>
        ))}
        <span className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200" title="Estimated cost of all approved, not-yet-installed items">{money(outstanding)} outstanding</span>
      </div>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-lg border border-line overflow-hidden">
          <button onClick={() => setView('item')} className={'text-xs font-semibold px-3 py-1.5 ' + (view === 'item' ? 'bg-ink text-white' : 'bg-white text-muted')}>By item</button>
          <button onClick={() => setView('unit')} className={'text-xs font-semibold px-3 py-1.5 ' + (view === 'unit' ? 'bg-ink text-white' : 'bg-white text-muted')}>By unit</button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit / building / item" className="text-xs border border-line rounded-lg px-2.5 py-1.5 w-52" />
        <select value={ownerId} onChange={e => setOwnerId(e.target.value)} className="text-xs border border-line rounded-lg px-2 py-1.5 bg-white max-w-[220px]" title="Filter to one owner's units and share their link">
          <option value="">All owners</option>
          {owners.slice().sort((a, b) => a.name.localeCompare(b.name)).map(o => <option key={o.id} value={o.id}>{o.name} ({o.listingIds.length})</option>)}
        </select>
        {selOwner ? <button onClick={copyOwnerLink} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white">{ownerCopied ? 'Owner link copied ✓' : 'Share owner link'}</button> : null}
        <label className="text-xs text-muted flex items-center gap-1"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> show installed</label>
        <button onClick={() => setToolsOpen(o => !o)} className="ml-auto text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted">Tools {toolsOpen ? '▴' : '▾'}</button>
      </div>
      {toolsOpen ? (
        <div className="mb-4 rounded-xl border border-line bg-white p-3 flex flex-wrap items-center gap-2">
          <a href="/delivery" target="_blank" rel="noreferrer" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted">Delivery plan</a>
          <button onClick={copyPlanLink} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted">{planCopied ? 'Link copied ✓' : 'Copy plan link'}</button>
          <button onClick={copySheet} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white">{copied ? 'Copied ✓' : 'Copy order sheet'}</button>
          <span className="w-px h-5 bg-line mx-1" />
          <span className="text-xs font-semibold text-ink">Owner:</span>
          <select value={xlBldg} onChange={e => { setXlBldg(e.target.value); setXlUnit('all') }} className="text-xs border border-line rounded-lg px-2 py-1.5 bg-white">
            <option value="all">All properties</option>
            {Array.from(new Set(rows.map(it => it.building || 'Other'))).sort().map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={xlUnit} onChange={e => setXlUnit(e.target.value)} className="text-xs border border-line rounded-lg px-2 py-1.5 bg-white">
            <option value="all">All units</option>
            {Array.from(new Set(rows.filter(it => xlBldg === 'all' || (it.building || 'Other') === xlBldg).map(it => it.unit))).sort().map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <button onClick={exportExcel} disabled={xlBusy} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">{xlBusy ? 'Building…' : 'Download .xlsx'}</button>
          <button onClick={estimateCosts} disabled={estBusy} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted disabled:opacity-50">{estBusy ? 'Estimating…' : '✨ Estimate costs'}</button>
          <button onClick={copyOwnerLink} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white">{ownerCopied ? 'Owner link copied ✓' : 'Copy owner link'}</button>
          {estMsg ? <span className="text-[11px] font-semibold text-emerald-700">{estMsg}</span> : null}
        </div>
      ) : null}
      {/* bulk bar */}
      {selIds.length ? (
        <div className="mb-4 rounded-xl border border-ink/20 bg-ink/[0.03] p-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-ink">{selIds.length} selected</span>
          <button onClick={() => bulk('approve')} disabled={bulkBusy} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">GM approve</button>
          <button onClick={() => bulk('order')} disabled={bulkBusy} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white disabled:opacity-50">Mark ordered</button>
          <button onClick={() => bulk('arriving')} disabled={bulkBusy} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted disabled:opacity-50">Arriving</button>
          <button onClick={() => bulk('received')} disabled={bulkBusy} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted disabled:opacity-50">Received</button>
          <button onClick={clearSel} className="ml-auto text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted">Clear</button>
        </div>
      ) : null}

      {visible.length === 0 ? <div className="text-sm text-muted">No order items match. Replace / Add needs captured on audits land here automatically.</div> : null}

      {/* BY ITEM */}
      {view === 'item' && visible.length > 0 ? (
        <div className="space-y-3">
          {groupKeys.map(key => {
            const items = groups[key]
            const title = items[0].title || '(untitled)'
            const totalQty = items.reduce((s, it) => s + Math.max(1, Number(it.qty) || 1), 0)
            const units = Array.from(new Set(items.map(it => it.unit))).length
            const brk: Record<string, number> = {}
            for (const it of items) { const s = stageOf(it); brk[s] = (brk[s] || 0) + 1 }
            const est = estOf(items.find(it => estOf(it)) || items[0])
            const open = !!openGrp[key]
            const nNeeds = items.filter(it => stageOf(it) === 'blocked').length
            const nReady = items.filter(it => stageOf(it) === 'ready').length
            return (
              <div key={key} className="rounded-xl border border-line bg-white shadow-soft">
                <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-line">
                  <button onClick={() => setOpenGrp(g => ({ ...g, [key]: !g[key] }))} className="text-sm font-bold text-ink flex items-center gap-1.5">
                    <span className="text-muted">{open ? '▾' : '▸'}</span>{title}
                    <span className="text-muted font-semibold">×{totalQty} · {units} unit{units === 1 ? '' : 's'}</span>
                  </button>
                  <span className="flex items-center gap-1">
                    {(['blocked', 'owner', 'ready', 'ordered', 'arriving', 'received', 'installed'] as Stage[]).filter(s => brk[s]).map(s => (
                      <span key={s} className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + STAGE_CLS[s]}>{brk[s]} {STAGE_LABEL[s].toLowerCase()}</span>
                    ))}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {est ? <span className="text-[11px] text-muted">~{money(est)} ea</span> : null}
                    <button onClick={() => groupSetPrice(key)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted">Price all</button>
                    <button onClick={() => groupSetLink(key)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted">Link all</button>
                    {nNeeds ? <button onClick={() => groupAct(key, 'approve')} disabled={bulkBusy} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-600 text-white disabled:opacity-50">Approve {nNeeds}</button> : null}
                    {nReady ? <button onClick={() => groupAct(key, 'order')} disabled={bulkBusy} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-ink text-white disabled:opacity-50">Order {nReady}</button> : null}
                  </span>
                </div>
                {open ? <div className="p-2.5 space-y-1.5">{items.slice().sort((a, b) => (a.building || '').localeCompare(b.building || '') || a.unit.localeCompare(b.unit)).map(it => rowCard(it, true))}</div> : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* BY UNIT */}
      {view === 'unit' && visible.length > 0 ? (
        <div className="space-y-4">
          {bldgs.map(b => {
            const units = Object.keys(byBldg[b]).sort()
            let n = 0; for (const u of units) n += byBldg[b][u].length
            return (
              <div key={b} className="rounded-xl border border-line bg-white shadow-soft">
                <div className="px-4 py-2.5 border-b border-line text-sm font-bold text-ink">{b} <span className="text-muted font-semibold">· {n} item{n === 1 ? '' : 's'}</span></div>
                <div className="divide-y divide-line">
                  {units.map(u => (
                    <div key={u} className="px-4 py-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">{u}</div>
                      <div className="space-y-1.5">{byBldg[b][u].map(it => rowCard(it, false))}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

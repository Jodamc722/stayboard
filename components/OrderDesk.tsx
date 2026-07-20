'use client'
// Property-wide ORDER SHEET - every Replace/Add need captured on audits, with a lifecycle:
// approval FIRST (nothing gets bought unapproved), then Ordered -> Arriving -> Complete.
// Product links per line + AI options. Data: /api/audit?orders=1 (session-auth).
import { useEffect, useState } from 'react'

type Row = { id: string; audit_id: string; listing_id: string; room: string; kind: string; title: string | null; qty: number | null; note: string | null; photo_url: string | null; status: string; details: any; created_at: string; unit: string; building: string }

const FLOW = ['open', 'approved', 'ordered', 'arriving', 'done']
const STATUS_LABEL: Record<string, string> = { open: 'Needs approval', approved: 'Approved', ordered: 'Ordered', arriving: 'Arriving', done: 'Complete' }
const STATUS_CLS: Record<string, string> = { open: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800', ordered: 'bg-sky-100 text-sky-800', arriving: 'bg-indigo-100 text-indigo-800', done: 'bg-neutral-200 text-neutral-600' }
const NEXT_LABEL: Record<string, string> = { open: 'Approve', approved: 'Mark ordered', ordered: 'Arriving', arriving: 'Complete' }

export function OrderDesk() {
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [tf, setTf] = useState('all')
  const [q, setQ] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [sugFor, setSugFor] = useState('')
  const [sugList, setSugList] = useState<any[]>([])
  const [sugBusy, setSugBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [xlOpen, setXlOpen] = useState(false)
  const [xlBldg, setXlBldg] = useState('all')
  const [xlUnit, setXlUnit] = useState('all')
  const [xlBusy, setXlBusy] = useState(false)
  const [planCopied, setPlanCopied] = useState(false)
  const [ownerCopied, setOwnerCopied] = useState(false)
  const [estBusy, setEstBusy] = useState(false)
  const [estMsg, setEstMsg] = useState('')

  async function load() {
    try {
      const r = await fetch('/api/audit?orders=1')
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not load orders.'); setLoading(false); return }
      setRows(j.orders || [])
    } catch { setErr('Network error - reload to retry.') }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setStatus(it: Row, status: string) {
    if (busy) return
    setBusy(it.id)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', itemId: it.id, fields: { status } }) }) } catch {}
    setBusy('')
    await load()
  }
  async function setLink(it: Row, link: string) {
    setBusy(it.id)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', itemId: it.id, fields: { link } }) }) } catch {}
    setBusy('')
    await load()
  }
  function askLink(it: Row) {
    const cur = it.details && it.details.link ? String(it.details.link) : ''
    const v = window.prompt('Paste the product link for: ' + (it.title || ''), cur)
    if (v !== null) setLink(it, v.trim())
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

  const nrm = (s: any) => String(s || '').toLowerCase()
  const visible = rows.filter(it => {
    if (it.status === 'done' && !showDone && tf !== 'done') return false
    if (tf !== 'all' && it.status !== tf) return false
    if (q && nrm(it.unit + ' ' + it.building + ' ' + it.title).indexOf(nrm(q)) < 0) return false
    return true
  })
  const byBldg: Record<string, Record<string, Row[]>> = {}
  for (const it of visible) {
    const b = it.building || 'Other'
    if (!byBldg[b]) byBldg[b] = {}
    if (!byBldg[b][it.unit]) byBldg[b][it.unit] = []
    byBldg[b][it.unit].push(it)
  }
  const bldgs = Object.keys(byBldg).sort()
  const counts: Record<string, number> = { all: 0, open: 0, approved: 0, ordered: 0, arriving: 0, done: 0 }
  for (const it of rows) { counts[it.status] = (counts[it.status] || 0) + 1; if (it.status !== 'done') counts.all++ }

  function copySheet() {
    const chosen = rows.filter(it => it.status === 'approved' || it.status === 'ordered' || it.status === 'arriving')
    const lines: string[] = ['PROPERTY ORDER SHEET - approved + in flight', '']
    const bb: Record<string, Row[]> = {}
    for (const it of chosen) { const k = (it.building ? it.building + ' - ' : '') + it.unit; if (!bb[k]) bb[k] = []; bb[k].push(it) }
    const keys = Object.keys(bb).sort()
    for (const k of keys) {
      lines.push(k)
      for (const it of bb[k]) lines.push('  - ' + (it.qty && it.qty > 1 ? it.qty + 'x ' : '') + (it.title || '') + (it.room ? ' (' + it.room + ')' : '') + ' [' + (STATUS_LABEL[it.status] || it.status) + ']' + (it.details && it.details.link ? ' ' + it.details.link : ''))
      lines.push('')
    }
    const totals: Record<string, number> = {}
    for (const it of chosen) { const t = nrm(it.title); totals[t] = (totals[t] || 0) + (Number(it.qty) || 1) }
    lines.push('TOTALS BY ITEM')
    const tk = Object.keys(totals).sort()
    for (const t of tk) lines.push('  - ' + t + ': ' + totals[t])
    try { navigator.clipboard.writeText(lines.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch {}
  }

  // OWNER EXCEL EXPORT - real .xlsx via SheetJS (loaded on demand from the CDN, no bundle
  // weight). Scope is selectable: whole portfolio, one property (building), or one unit.
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
        if (it.status === 'done') return false
        if (xlBldg !== 'all' && (it.building || 'Other') !== xlBldg) return false
        if (xlUnit !== 'all' && it.unit !== xlUnit) return false
        return true
      }).sort((a, b) => ((a.building || '') + a.unit).localeCompare((b.building || '') + b.unit))
      const head = ['Building', 'Unit', 'Room', 'Action', 'Item', 'Qty', 'Status', 'Product link', 'Notes']
      const aoa: any[][] = [head]
      for (const it of chosen) aoa.push([it.building || '', it.unit, it.room || '', it.kind === 'add' ? 'Add' : 'Replace', it.title || '', Number(it.qty) || 1, STATUS_LABEL[it.status] || it.status, it.details && it.details.link ? String(it.details.link) : '', it.note || ''])
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 8 }, { wch: 34 }, { wch: 5 }, { wch: 14 }, { wch: 40 }, { wch: 36 }]
      const totals: Record<string, number> = {}
      for (const it of chosen) { const t = String(it.title || '').trim(); if (t) totals[t] = (totals[t] || 0) + (Number(it.qty) || 1) }
      const taoa: any[][] = [['Item', 'Total qty']]
      const tkeys = Object.keys(totals).sort()
      for (const t of tkeys) taoa.push([t, totals[t]])
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
  function copyPlanLink() {
    try { navigator.clipboard.writeText(window.location.origin + '/delivery'); setPlanCopied(true); setTimeout(() => setPlanCopied(false), 1600) } catch {}
  }

  // OWNER APPROVAL LINK - signed share URL for the selected property or unit. The owner
  // opens it, sees just their items with estimated costs, and taps Approve per line.
  function ownerScope(): string {
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
  function askEst(it: Row) {
    const cur = it.details && it.details.est ? String(it.details.est) : ''
    const v = window.prompt('Estimated price in USD for ONE ' + (it.title || 'item') + ':', cur)
    if (v === null) return
    const n = Math.round(Number(v))
    if (!Number.isFinite(n) || n < 0) { alert('Enter a number.'); return }
    setBusy(it.id)
    fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', itemId: it.id, fields: { est: n } }) }).catch(() => {}).then(() => { setBusy(''); load() })
  }

  if (loading) return <div className="text-sm text-muted">Loading orders…</div>
  if (err) return <div className="text-sm text-rose-600">{err}</div>

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {['all', 'open', 'approved', 'ordered', 'arriving', 'done'].map(k => (
          <button key={k} onClick={() => setTf(k)} className={'text-xs font-semibold px-2.5 py-1.5 rounded-lg border ' + (tf === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>
            {k === 'all' ? 'All open' : STATUS_LABEL[k]}{' · '}{counts[k] || 0}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit / building / item" className="text-xs border border-line rounded-lg px-2.5 py-1.5 w-52" />
        <label className="text-xs text-muted flex items-center gap-1"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> show completed</label>
        <span className="ml-auto flex items-center gap-2">
          <a href="/delivery" target="_blank" rel="noreferrer" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted">Delivery plan</a>
          <button onClick={copyPlanLink} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted">{planCopied ? 'Link copied ✓' : 'Copy plan link'}</button>
          <button onClick={() => setXlOpen(o => !o)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted">Excel for owner</button>
          <button onClick={copySheet} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white">{copied ? 'Copied ✓' : 'Copy order sheet'}</button>
        </span>
      </div>
      {xlOpen ? (
        <div className="mb-4 rounded-xl border border-line bg-white p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">Export scope:</span>
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
          <span className="text-[11px] text-muted">Owner link = pick a property or unit, estimate costs, copy - the owner approves right on the page.</span>
        </div>
      ) : null}
      {bldgs.length === 0 ? <div className="text-sm text-muted">No order items match. Replace / Add needs captured on audits land here automatically.</div> : null}
      <div className="space-y-4">
        {bldgs.map(b => {
          const units = Object.keys(byBldg[b]).sort()
          let n = 0
          for (const u of units) n += byBldg[b][u].length
          return (
            <div key={b} className="rounded-xl border border-line bg-white shadow-soft">
              <div className="px-4 py-2.5 border-b border-line text-sm font-bold text-ink">{b} <span className="text-muted font-semibold">· {n} item{n === 1 ? '' : 's'}</span></div>
              <div className="divide-y divide-line">
                {units.map(u => (
                  <div key={u} className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">{u}</div>
                    <div className="space-y-1.5">
                      {byBldg[b][u].map(it => {
                        const link = it.details && it.details.link ? String(it.details.link) : ''
                        return (
                          <div key={it.id} className="rounded-lg border border-line p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border ' + (it.kind === 'add' ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-rose-100 text-rose-700 border-rose-300')}>{it.kind === 'add' ? 'Add' : 'Replace'}</span>
                              <span className="text-sm font-semibold text-ink">{it.qty && it.qty > 1 ? it.qty + '× ' : ''}{it.title}</span>
                              {it.room ? <span className="text-[11px] text-muted">{it.room}</span> : null}
                              <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + (STATUS_CLS[it.status] || STATUS_CLS.open)}>{STATUS_LABEL[it.status] || it.status}</span>
                              {it.details && it.details.reorder ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-800" title="Matched to a previous order of the same product - link reused">↻ reorder</span> : null}
                              <button onClick={() => askEst(it)} disabled={busy === it.id} className={'text-[11px] font-semibold px-1.5 py-0.5 rounded border disabled:opacity-50 ' + (it.details && it.details.est ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-line text-muted')} title="Estimated price per unit - shown to owners">{it.details && it.details.est ? '~$' + Number(it.details.est).toLocaleString('en-US') : '$ est'}</button>
                              <span className="ml-auto flex items-center gap-1">
                                {it.photo_url ? <a href={it.photo_url} target="_blank" rel="noreferrer"><img src={it.photo_url} alt="" className="h-7 w-7 rounded object-cover" /></a> : null}
                                {link ? <a href={link} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-brand-600">open link</a> : null}
                                <button onClick={() => askLink(it)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted">{link ? 'edit link' : '+ link'}</button>
                                <button onClick={() => suggest(it)} disabled={sugBusy} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted disabled:opacity-50">{sugFor === it.id && sugBusy ? '…' : '✨ Options'}</button>
                                {NEXT_LABEL[it.status] ? <button onClick={() => setStatus(it, FLOW[FLOW.indexOf(it.status) + 1])} disabled={busy === it.id} className={'text-[11px] font-semibold px-2 py-1 rounded-lg text-white disabled:opacity-50 ' + (it.status === 'open' ? 'bg-emerald-600' : 'bg-ink')}>{NEXT_LABEL[it.status]}</button> : null}
                                {it.status !== 'done' ? <button onClick={() => setStatus(it, 'dismissed')} disabled={busy === it.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-muted disabled:opacity-50">Dismiss</button> : null}
                              </span>
                            </div>
                            {it.note ? <div className="text-[11px] text-muted mt-1">{it.note}</div> : null}
                            {sugFor === it.id && sugList.length ? (
                              <div className="mt-1.5 rounded-lg bg-neutral-50 border border-line p-2 space-y-1">
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
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

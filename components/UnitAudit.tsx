'use client'
import { useEffect, useState } from 'react'

type Audit = { id: string; listingId: string; shareCode: string; status: string; createdAt: string; updatedAt?: string | null; auditType?: string | null; counts: { total: number; open: number; tasks: number } }

export function UnitAudit({ listingId }: { listingId: string }) {
  const [audits, setAudits] = useState<Audit[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('quality')
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState('')

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/audit')
      const j = await r.json()
      const mine = (((j && j.audits) || []) as Audit[]).filter(a => String(a.listingId) === String(listingId)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      setAudits(mine)
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [listingId])

  async function createAudit() {
    if (creating) return
    setCreating(true)
    try {
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createAudit', listingId, type, carryForward: type === 'quality' }) })
      const j = await r.json()
      if (r.ok && j.ok) { await load(); if (j.url) { try { await navigator.clipboard.writeText(j.url); setCopied(j.audit ? j.audit.id : 'new'); setTimeout(() => setCopied(''), 2500) } catch {} } }
      else alert(j.error || 'Failed to create audit link')
    } catch { alert('Failed - retry') }
    setCreating(false)
  }
  async function copyLink(a: Audit) {
    try { await navigator.clipboard.writeText(location.origin + '/audit/' + a.shareCode); setCopied(a.id); setTimeout(() => setCopied(''), 2000) } catch {}
  }
  function due(a: Audit): string {
    if (a.status !== 'completed') return ''
    const d = a.updatedAt || a.createdAt
    if (!d) return ''
    const days = (Date.now() - new Date(d).getTime()) / 86400000
    if (days >= 365) return 'OVERDUE'
    if (days >= 183) return 'DUE'
    return ''
  }

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-muted font-semibold">Property Audit</h2>
        <div className="flex items-center gap-2">
          <select value={type} onChange={e => setType(e.target.value)} className="text-xs rounded-lg border border-line bg-white px-2 py-1.5 focus:outline-none focus:border-brand-500">
            <option value="quality">Quality</option>
            <option value="onboarding">Onboarding</option>
          </select>
          <button onClick={createAudit} disabled={creating} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-neutral-900 text-white disabled:opacity-40">{creating ? 'Creating…' : '+ New audit link'}</button>
        </div>
      </div>
      <div className="px-4">
        {loading ? <div className="py-6 text-sm text-muted text-center">Loading…</div> : audits.length === 0 ? <div className="py-6 text-sm text-muted text-center">No audits yet — create a link to start.</div> : audits.map(a => (
          <div key={a.id} className="py-2.5 border-b border-line last:border-0 flex items-center gap-2.5 flex-wrap">
            <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded ' + (a.auditType === 'onboarding' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700')}>{a.auditType === 'onboarding' ? 'ONBOARDING' : 'QUALITY'}</span>
            <span className="text-sm text-ink">{String((a.status === 'completed' ? (a.updatedAt || a.createdAt) : a.createdAt) || '').slice(0, 10)}</span>
            <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + (a.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{a.status === 'completed' ? 'COMPLETED' : 'OPEN'}</span>
            {due(a) ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">{due(a)}</span> : null}
            <span className="text-xs text-muted">{a.counts.total} items · {a.counts.open} open</span>
            <button onClick={() => copyLink(a)} className="ml-auto text-xs font-semibold text-brand-600">{copied === a.id ? 'Copied ✓' : 'Copy form link'}</button>
            <a href={'/audit/' + a.shareCode} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-600">Open</a>
          </div>
        ))}
      </div>
    </div>
  )
}

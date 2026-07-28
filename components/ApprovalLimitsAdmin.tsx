'use client'
// Admin console — GM SPEND LIMITS. The dollar ceiling under which an order line approves itself.
//
// Priced lines at or under the limit for that unit's owner become GM-approved automatically and
// move to Ready to buy; anything above goes to the owner instead. Set a per-owner override where
// an owner wants a tighter or looser leash; $0 means that owner reviews every purchase.
//
// Owner-only to edit — this is the control that decides how much money moves without a human.
import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, Loader2, Check, AlertTriangle, Save, Zap, Trash2 } from 'lucide-react'

type Owner = { id: string; name: string; listingIds?: string[] }
type Limits = { default: number; owners: Record<string, number> }
type Preview = { pending: number; gmApprove: number; gmTotal: number; toOwner: number; ownerTotal: number; defaultLimit: number }

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

export function ApprovalLimitsAdmin({ isOwner }: { isOwner: boolean }) {
  const [lim, setLim] = useState<Limits>({ default: 250, owners: {} })
  const [saved, setSaved] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [owners, setOwners] = useState<Owner[]>([])
  const [prev, setPrev] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [routing, setRouting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [addId, setAddId] = useState('')

  function loadPreview() {
    fetch('/api/orders/auto-route', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j && j.ok) setPrev(j) }).catch(() => {})
  }
  useEffect(() => {
    fetch('/api/settings/approval-limits', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const l: Limits = (j && j.limits) ? { default: Number(j.limits.default) || 0, owners: j.limits.owners || {} } : { default: 250, owners: {} }
      setLim(l); setSaved(JSON.stringify(l)); setLoaded(true)
    }).catch(() => setLoaded(true))
    fetch('/api/orders/owners', { cache: 'no-store' }).then(r => r.json()).then(j => setOwners(Array.isArray(j && j.owners) ? j.owners : [])).catch(() => {})
    loadPreview()
  }, [])

  const dirty = useMemo(() => loaded && JSON.stringify(lim) !== saved, [lim, saved, loaded])
  const byId = useMemo(() => { const m: Record<string, Owner> = {}; for (const o of owners) m[o.id] = o; return m }, [owners])
  const overrides = Object.keys(lim.owners).sort((a, b) => String((byId[a] || {}).name || a).localeCompare(String((byId[b] || {}).name || b)))
  const unset = owners.filter(o => !Object.prototype.hasOwnProperty.call(lim.owners, o.id)).sort((a, b) => a.name.localeCompare(b.name))

  async function save() {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/settings/approval-limits', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limits: lim }) })
      const j = await r.json(); if (!r.ok) throw new Error((j && j.error) || 'Could not save.')
      const l: Limits = { default: Number(j.limits.default) || 0, owners: j.limits.owners || {} }
      setLim(l); setSaved(JSON.stringify(l))
      setMsg('Saved. New prices route themselves from here on.')
      loadPreview()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  async function runRoute() {
    setRouting(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/orders/auto-route', { method: 'POST' })
      const j = await r.json(); if (!r.ok) throw new Error((j && j.error) || 'Could not route.')
      setMsg(j.routed ? ('Routed ' + j.routed + ' line' + (j.routed > 1 ? 's' : '') + ' — ' + j.gmApproved + ' GM-approved, ' + j.toOwner + ' sent to owners.') : (j.note || 'Nothing to route.'))
      loadPreview()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setRouting(false) }
  }

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <BadgeDollarSign size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">GM spend limits</span>
        {dirty && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Unsaved</span>}
        <button onClick={save} disabled={!isOwner || busy || !dirty}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save limits
        </button>
      </div>

      <div className="p-4 space-y-4">
        <p className="text-[13px] text-muted">When an order line gets a price, it routes itself: at or under the limit for that unit&apos;s owner it is GM-approved and ready to buy; above it, the owner is asked. A limit of $0 sends everything to the owner. Approvals a person made by hand are never overwritten.</p>
        {!isOwner && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> Only the owner can change spend limits.
          </div>
        )}
        {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}
        {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-line bg-app px-3.5 py-3">
          <span className="text-[13px] font-semibold text-ink">Portfolio default</span>
          <span className="text-muted text-[13px]">$</span>
          <input type="number" min={0} max={100000} value={lim.default} disabled={!isOwner}
            onChange={e => setLim(l => ({ ...l, default: Math.max(0, Math.min(100000, Math.round(Number(e.target.value) || 0))) }))}
            className="w-28 rounded-lg border border-line px-2 py-1.5 text-[13px] bg-white disabled:bg-app" />
          <span className="text-[12px] text-muted">applies to every owner without an override</span>
        </div>

        {prev && (
          <div className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-ink">Backlog</span>
              <span className="text-[12px] text-muted">{prev.pending} priced line{prev.pending === 1 ? '' : 's'} with no approval decision</span>
              <button onClick={runRoute} disabled={!isOwner || routing || !prev.pending}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-brand-300 text-brand-700 px-2.5 py-1.5 text-[12px] font-semibold hover:bg-brand-50 disabled:opacity-40">
                {routing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Route them now
              </button>
            </div>
            {prev.pending > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold">{prev.gmApprove} auto-approve &middot; {money(prev.gmTotal)}</span>
                <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 font-semibold">{prev.toOwner} to owners &middot; {money(prev.ownerTotal)}</span>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">Per-owner overrides</div>
          {overrides.length === 0 && <div className="text-[13px] text-muted mb-2">None &mdash; every owner uses the portfolio default.</div>}
          <div className="space-y-1.5">
            {overrides.map(id => (
              <div key={id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <span className="flex-1 text-[13px] text-ink truncate">{(byId[id] || {}).name || id}<span className="text-muted text-[11px]"> &middot; {((byId[id] || {}).listingIds || []).length} units</span></span>
                <span className="text-muted text-[13px]">$</span>
                <input type="number" min={0} max={100000} value={lim.owners[id]} disabled={!isOwner}
                  onChange={e => setLim(l => ({ ...l, owners: { ...l.owners, [id]: Math.max(0, Math.min(100000, Math.round(Number(e.target.value) || 0))) } }))}
                  className="w-24 rounded-lg border border-line px-2 py-1 text-[13px] disabled:bg-app" />
                <button onClick={() => setLim(l => { const o = { ...l.owners }; delete o[id]; return { ...l, owners: o } })} disabled={!isOwner}
                  className="text-muted hover:text-rose-600 disabled:opacity-30" title="Use the default instead"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <select value={addId} onChange={e => setAddId(e.target.value)} disabled={!isOwner || unset.length === 0}
              className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[13px] disabled:bg-app">
              <option value="">{unset.length ? 'Add an override for…' : (owners.length ? 'Every owner has an override' : 'No owners synced yet — sync them on the order desk')}</option>
              {unset.map(o => <option key={o.id} value={o.id}>{o.name} ({(o.listingIds || []).length})</option>)}
            </select>
            <button onClick={() => { if (addId) { setLim(l => ({ ...l, owners: { ...l.owners, [addId]: l.default } })); setAddId('') } }} disabled={!isOwner || !addId}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-line text-muted hover:border-brand-300 hover:text-ink disabled:opacity-40">Add</button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
// ONBOARDING DESK — mint links, watch progress, assign to the live listing (Jon, 2026-09-02).
import { useEffect, useMemo, useState } from 'react'
import { Plus, Copy, Check, Link2, ExternalLink, Loader2, Archive, Unlink, Search, Camera, Settings2, ShoppingCart, Trash2, RotateCcw, X } from 'lucide-react'
import { describeUnit, CATEGORIES, ROOM_KIND_LABEL, ONLY_LABEL, qtyFor, type UnitDetails, type InventoryStandard, type StandardItem, type RoomKind, type Category } from '@/lib/onboarding'

type Progress = { rooms: number; roomsChecked: number; roomsPhotographed: number; items: number; confirmed: number; photos: number; pct: number }
type Unit = { id: string; code: string; name: string; building: string | null; unit_no: string | null; owner_name: string | null; details: UnitDetails; status: string; listing_id: string | null; listing_name: string | null; created_at: string; updated_at: string; completed_at: string | null; progress: Progress; buy: number; order_id?: string | null }
type Listing = { id: string; name: string; building: string }

const BTN = 'inline-flex items-center gap-1.5 rounded-xl font-bold text-[13px] min-h-[38px] px-3.5 disabled:opacity-50'
const INPUT = 'rounded-xl border border-line bg-white px-3 py-2.5 text-[14px] focus:outline-none focus:border-ink'

export function OnboardingDesk() {
  const [units, setUnits] = useState<Unit[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)
  const [standardOpen, setStandardOpen] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'open' | 'all'>('open')

  const load = async () => {
    try {
      const r = await fetch('/api/onboard?list=1', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load')
      setUnits(j.units || []); setListings(j.listings || []); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const shown = useMemo(() => units.filter(u => (filter === 'all' || (u.status !== 'linked' && u.status !== 'archived')) && (!q.trim() || (u.name + ' ' + (u.building || '') + ' ' + (u.owner_name || '')).toLowerCase().includes(q.trim().toLowerCase()))), [units, filter, q])
  const stats = useMemo(() => ({ open: units.filter(u => u.status === 'draft' || u.status === 'in_progress').length, complete: units.filter(u => u.status === 'complete').length, linked: units.filter(u => u.status === 'linked').length }), [units])

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button onClick={() => setCreating(true)} className={BTN + ' bg-ink text-white'}><Plus size={15} /> New onboarding link</button>
        <button onClick={() => setStandardOpen(true)} className={BTN + ' border border-line bg-white text-ink'}><Settings2 size={15} /> Inventory standard</button>
        <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, building, owner" className={INPUT + ' pl-8 w-64'} /></div>
        <div className="ml-auto flex items-center gap-1.5 text-[12.5px]">
          {(['open', 'all'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={'px-3 py-1.5 rounded-full border font-semibold ' + (filter === f ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line')}>{f === 'open' ? 'In progress + ready' : 'All'}</button>)}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4 max-w-lg">
        {[['In progress', stats.open, 'text-amber-800'], ['Ready to assign', stats.complete, 'text-emerald-800'], ['Assigned to a listing', stats.linked, 'text-ink']].map(([l, n, c]) => (
          <div key={l as string} className="rounded-2xl border border-line bg-white px-3 py-2.5"><div className="text-[11px] uppercase tracking-wide text-muted font-semibold">{l}</div><div className={'text-[24px] font-bold tabular-nums ' + c}>{n}</div></div>
        ))}
      </div>

      {standardOpen && <StandardSheet onClose={() => setStandardOpen(false)} />}
      {creating && <CreateSheet onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await load() }} />}
      {err && <p className="text-[13px] text-rose-600 font-semibold mb-2">{err}</p>}
      {loading ? <div className="py-10 text-center text-muted text-[14px]"><Loader2 className="animate-spin inline mr-2" size={16} />Loading…</div>
        : shown.length === 0 ? <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-[14px] text-muted">{units.length ? 'Nothing matches.' : 'No onboarding links yet. Mint one for the next unit and send it to whoever walks it.'}</div>
        : <div className="space-y-2">{shown.map(u => <UnitCard key={u.id} u={u} listings={listings} onChanged={load} />)}</div>}
    </div>
  )
}

function CreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState(''); const [building, setBuilding] = useState(''); const [unitNo, setUnitNo] = useState(''); const [address, setAddress] = useState(''); const [ownerName, setOwnerName] = useState(''); const [ownerContact, setOwnerContact] = useState('')
  const [bedrooms, setBedrooms] = useState<string>(''); const [bathrooms, setBathrooms] = useState<string>('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [made, setMade] = useState<{ url: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const create = async () => {
    setBusy(true); setErr('')
    try {
      const details: any = {}
      if (bedrooms !== '') details.bedrooms = Number(bedrooms)
      if (bathrooms !== '') details.bathrooms = Number(bathrooms)
      const r = await fetch('/api/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', name, building, unitNo, address, ownerName, ownerContact, details }) })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not create')
      setMade({ url: window.location.origin + j.url, name })
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const copy = async () => { if (!made) return; try { await navigator.clipboard.writeText(made.url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-0 sm:p-4 sm:pt-[8vh] overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-none sm:rounded-2xl w-full max-w-lg min-h-dvh sm:min-h-0 p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        {made ? (
          <div>
            <h2 className="text-[17px] font-bold text-ink">Link ready — {made.name}</h2>
            <p className="text-[13px] text-muted mt-1">Send it to whoever walks the unit. It opens on any phone, no login. The walker fills in the details, the rooms generate, and the photos and inventory land here.</p>
            <div className="mt-3 flex gap-2"><input readOnly value={made.url} className={INPUT + ' flex-1 text-[13px]'} onFocus={e => e.currentTarget.select()} /><button onClick={copy} className={BTN + ' bg-ink text-white'}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button></div>
            <div className="mt-4 flex gap-2"><a href={made.url} target="_blank" rel="noreferrer" className={BTN + ' border border-line bg-white text-ink'}>Open it <ExternalLink size={13} /></a><button onClick={onCreated} className={BTN + ' bg-ink text-white ml-auto'}>Done</button></div>
          </div>
        ) : (
          <div>
            <h2 className="text-[17px] font-bold text-ink">New onboarding link</h2>
            <p className="text-[13px] text-muted mt-1 mb-3">Only a name is required — everything else can be filled in on the phone, in the unit.</p>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Unit name (e.g. Elser 3707)" className={INPUT + ' col-span-2'} autoFocus />
              <input value={building} onChange={e => setBuilding(e.target.value)} placeholder="Building" className={INPUT} />
              <input value={unitNo} onChange={e => setUnitNo(e.target.value)} placeholder="Unit #" className={INPUT} />
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Address" className={INPUT + ' col-span-2'} />
              <input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Owner" className={INPUT} />
              <input value={ownerContact} onChange={e => setOwnerContact(e.target.value)} placeholder="Owner contact" className={INPUT} />
              <select value={bedrooms} onChange={e => setBedrooms(e.target.value)} className={INPUT}><option value="">Bedrooms (fill later)</option><option value="0">Studio</option>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} BR</option>)}</select>
              <select value={bathrooms} onChange={e => setBathrooms(e.target.value)} className={INPUT}><option value="">Bathrooms (fill later)</option>{['1', '1.5', '2', '2.5', '3', '3.5', '4'].map(n => <option key={n} value={n}>{n} BA</option>)}</select>
            </div>
            {err && <p className="text-[13px] text-rose-600 font-semibold mt-2">{err}</p>}
            <div className="mt-4 flex gap-2"><button onClick={onClose} className={BTN + ' border border-line bg-white text-ink'}>Cancel</button><button onClick={create} disabled={busy || !name.trim()} className={BTN + ' bg-ink text-white ml-auto'}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Create link</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

function UnitCard({ u, listings, onChanged }: { u: Unit; listings: Listing[]; onChanged: () => Promise<void> }) {
  const [assigning, setAssigning] = useState(false)
  const [pick, setPick] = useState('')
  const [lq, setLq] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const url = typeof window !== 'undefined' ? window.location.origin + '/onboard/' + u.code : '/onboard/' + u.code
  const post = async (body: any) => { setBusy(true); try { const r = await fetch('/api/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'failed'); await onChanged() } catch (e: any) { alert(String(e?.message || e)) } setBusy(false) }
  const hits = useMemo(() => { const n = lq.trim().toLowerCase(); return (n ? listings.filter(l => (l.name + ' ' + l.building).toLowerCase().includes(n)) : listings).slice(0, 8) }, [listings, lq])
  const st = u.status === 'linked' ? ['Assigned', 'bg-ink text-white'] : u.status === 'complete' ? ['Ready to assign', 'bg-emerald-100 text-emerald-800'] : u.status === 'in_progress' ? ['In progress', 'bg-amber-100 text-amber-800'] : ['Not started', 'bg-app text-muted']
  const p = u.progress
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={'text-[10.5px] font-bold uppercase px-2 py-0.5 rounded ' + st[1]}>{st[0]}</span>
        <span className="text-[15px] font-bold text-ink">{u.name}</span>
        <span className="text-[12.5px] text-muted">{[u.building, u.unit_no && '#' + u.unit_no, describeUnit(u.details || {}), u.owner_name].filter(Boolean).join(' · ')}</span>
        {u.listing_name && <span className="text-[12px] font-semibold text-ink/80 inline-flex items-center gap-1"><Link2 size={12} /> {u.listing_name}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <button onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }} className={BTN + ' border border-line bg-white text-ink'} title={url}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy link'}</button>
          <a href={'/onboard/' + u.code} target="_blank" rel="noreferrer" className={BTN + ' border border-line bg-white text-ink'}>Open <ExternalLink size={13} /></a>
          {u.status !== 'linked'
            ? <button onClick={() => setAssigning(a => !a)} className={BTN + ' ' + (assigning ? 'border border-ink bg-white text-ink' : 'bg-ink text-white')}><Link2 size={13} /> Assign to property</button>
            : <button onClick={() => post({ action: 'unassign', id: u.id })} disabled={busy} className={BTN + ' border border-line bg-white text-muted'}><Unlink size={13} /> Unassign</button>}
          <button onClick={() => { if (confirm('Archive "' + u.name + '"? The link stops working.')) post({ action: 'archive', id: u.id }) }} disabled={busy} className="w-9 h-9 rounded-lg border border-line bg-white text-muted grid place-items-center" aria-label="Archive"><Archive size={14} /></button>
        </span>
      </div>
      {p.rooms > 0 && (
        <div className="mt-2 flex items-center gap-3 text-[12px] text-muted">
          <span className="w-40 h-1.5 rounded-full bg-app overflow-hidden"><span className={'block h-full ' + (p.pct === 100 ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: Math.max(2, p.pct) + '%' }} /></span>
          <span><b className="text-ink">{p.confirmed}</b>/{p.items} items confirmed</span>
          <span><b className="text-ink">{p.roomsChecked}</b>/{p.rooms} rooms done</span>
          <span className="inline-flex items-center gap-1"><Camera size={12} /> {p.photos}</span>
          {u.buy > 0 && <span className="inline-flex items-center gap-1 text-amber-800 font-semibold"><ShoppingCart size={12} /> {u.buy} to buy</span>}
          {u.order_id && <a href={'/ffe/order/' + u.order_id} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">Purchase order <ExternalLink size={11} /></a>}
          {u.buy > 0 && !u.order_id && <button onClick={() => post({ action: 'order', code: u.code })} disabled={busy} className="font-semibold text-brand-700 hover:underline">Create purchase order</button>}
          <span className="ml-auto">updated {new Date(u.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
      )}
      {assigning && (
        <div className="mt-3 pt-3 border-t border-line">
          <div className="text-[12.5px] text-muted mb-1.5">Pick the live Guesty listing this unit became. Nothing in the inventory changes — it just becomes readable by listing.</div>
          <div className="flex gap-2 flex-wrap items-center">
            <input value={lq} onChange={e => { setLq(e.target.value); setPick('') }} placeholder="Search listings…" className={INPUT + ' w-64'} />
            <div className="flex gap-1.5 flex-wrap">{hits.map(l => <button key={l.id} onClick={() => setPick(l.id)} className={'px-3 py-1.5 rounded-full border text-[12.5px] font-semibold ' + (pick === l.id ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line')}>{l.name}</button>)}</div>
            <button onClick={() => post({ action: 'assign', id: u.id, listingId: pick })} disabled={busy || !pick} className={BTN + ' bg-ink text-white'}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Assign</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── THE INVENTORY STANDARD (settings) ──────────────────────────────────────────────────────────
// Jon, 2026-09-02: "we should be able to add and account for that in user settings". One row per
// item per room kind; the quantity is a fixed count or a per-guest rule. This is what every NEW
// room is generated from — a unit already walked keeps its own numbers (the walker can correct
// "need" on any item there).
const ONLY_KEYS = Object.keys(ONLY_LABEL) as (keyof typeof ONLY_LABEL)[]
const KIND_ORDER: RoomKind[] = ['kitchen', 'dining', 'living', 'bedroom', 'bathroom', 'entry', 'laundry', 'balcony', 'other']

function StandardSheet({ onClose }: { onClose: () => void }) {
  const [std, setStd] = useState<InventoryStandard | null>(null)
  const [edited, setEdited] = useState(false)
  const [kind, setKind] = useState<RoomKind>('kitchen')
  const [occ, setOcc] = useState(6)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [dirty, setDirty] = useState(false)
  useEffect(() => { (async () => {
    try { const r = await fetch('/api/onboard?standard=1', { cache: 'no-store' }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load'); setStd(j.standard); setEdited(!!j.edited) } catch (e: any) { setMsg(String(e?.message || e)) }
  })() }, [])
  const rows = (std && std[kind]) || []
  const update = (i: number, patch: Partial<StandardItem>) => { setStd(s => { const n = { ...(s || {}) }; const list = [...(n[kind] || [])]; list[i] = { ...list[i], ...patch }; n[kind] = list; return n }); setDirty(true) }
  const remove = (i: number) => { setStd(s => { const n = { ...(s || {}) }; n[kind] = (n[kind] || []).filter((_, j) => j !== i); return n }); setDirty(true) }
  const add = () => { setStd(s => { const n = { ...(s || {}) }; n[kind] = [...(n[kind] || []), { name: '', category: kind === 'kitchen' ? 'kitchen' : 'furniture', qty: 1 }]; return n }); setDirty(true) }
  const save = async (reset = false) => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveStandard', standard: reset ? 'reset' : std }) })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save')
      setStd(j.standard); setEdited(!!j.edited); setDirty(false); setMsg(reset ? 'Back to the researched defaults.' : 'Saved — new rooms use this from now on.')
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-4xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center gap-3 flex-wrap">
          <div>
            <h2 className="text-[17px] font-bold text-ink">Inventory standard</h2>
            <p className="text-[12px] text-muted">What every new room is stocked with, and how counts scale with occupancy. {edited ? 'Edited from the defaults.' : 'Using the researched STR defaults (dinnerware and flatware at 2× guests, water glasses guests + 4, towels 2× guests, two sheet sets a bed).'}</p>
          </div>
          <span className="ml-auto flex items-center gap-2">
            <label className="text-[12px] text-muted inline-flex items-center gap-1.5">Preview for <input type="number" min={1} max={20} value={occ} onChange={e => setOcc(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className={INPUT + ' w-16 py-1.5'} /> guests</label>
            <button onClick={onClose} className="w-9 h-9 rounded-lg border border-line grid place-items-center" aria-label="Close"><X size={15} /></button>
          </span>
        </div>
        <div className="px-4 pt-3 flex gap-1.5 flex-wrap">
          {KIND_ORDER.map(k => <button key={k} onClick={() => setKind(k)} className={'px-3 py-1.5 rounded-full border text-[12.5px] font-semibold ' + (kind === k ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line')}>{ROOM_KIND_LABEL[k]} <span className="opacity-60">{(std && std[k] || []).length}</span></button>)}
        </div>
        <div className="flex-1 overflow-auto px-4 py-3">
          {!std ? <div className="py-8 text-center text-muted text-[14px]"><Loader2 className="animate-spin inline mr-2" size={16} />Loading…</div> : (
            <table className="w-full text-[13px]">
              <thead><tr className="text-[11px] uppercase tracking-wide text-muted text-left">
                <th className="py-1.5 pr-2 font-semibold">Item</th><th className="py-1.5 pr-2 font-semibold">Category</th><th className="py-1.5 pr-2 font-semibold">Qty</th><th className="py-1.5 pr-2 font-semibold">Rule</th><th className="py-1.5 pr-2 font-semibold">Min / max</th><th className="py-1.5 pr-2 font-semibold">Only when</th><th className="py-1.5 pr-2 font-semibold text-right">For {occ}</th><th></th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((it, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-2"><input value={it.name} onChange={e => update(i, { name: e.target.value })} className={INPUT + ' w-full py-1.5'} placeholder="Item name" /></td>
                    <td className="py-1.5 pr-2"><select value={it.category} onChange={e => update(i, { category: e.target.value as Category })} className={INPUT + ' py-1.5'}>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></td>
                    <td className="py-1.5 pr-2"><input type="number" step={it.perGuest ? 0.5 : 1} min={0} value={it.qty} onChange={e => update(i, { qty: Number(e.target.value) || 0 })} className={INPUT + ' w-20 py-1.5'} /></td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <select value={it.perGuest ? 'per' : 'fixed'} onChange={e => update(i, { perGuest: e.target.value === 'per' })} className={INPUT + ' py-1.5'}><option value="fixed">fixed</option><option value="per">× guests</option></select>
                      {it.perGuest && <label className="ml-1.5 text-[12px] text-muted">+ <input type="number" value={it.plus ?? 0} onChange={e => update(i, { plus: Number(e.target.value) || 0 })} className={INPUT + ' w-14 py-1.5'} /></label>}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap"><input type="number" value={it.min ?? ''} placeholder="–" onChange={e => update(i, { min: e.target.value === '' ? undefined : Number(e.target.value) })} className={INPUT + ' w-14 py-1.5'} /> / <input type="number" value={it.max ?? ''} placeholder="–" onChange={e => update(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })} className={INPUT + ' w-14 py-1.5'} /></td>
                    <td className="py-1.5 pr-2"><select value={it.only || ''} onChange={e => update(i, { only: (e.target.value || undefined) as any })} className={INPUT + ' py-1.5'}><option value="">always</option>{ONLY_KEYS.map(k => <option key={k} value={k}>{ONLY_LABEL[k]}</option>)}</select></td>
                    <td className="py-1.5 pr-2 text-right font-bold tabular-nums">{qtyFor(it, occ)}</td>
                    <td className="py-1.5"><button onClick={() => remove(i)} className="w-8 h-8 rounded-lg border border-line text-muted grid place-items-center" aria-label="Remove"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {std && <button onClick={add} className="mt-2 text-[13px] font-bold text-brand-700 inline-flex items-center gap-1.5 min-h-[36px]"><Plus size={14} /> Add item to {ROOM_KIND_LABEL[kind]}</button>}
        </div>
        <div className="px-4 py-3 border-t border-line flex items-center gap-2 flex-wrap">
          <button onClick={() => save(false)} disabled={busy || !dirty} className={BTN + ' bg-ink text-white'}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save standard</button>
          <button onClick={() => { if (confirm('Put the researched defaults back? Your edits to the standard are discarded.')) save(true) }} disabled={busy} className={BTN + ' border border-line bg-white text-muted'}><RotateCcw size={13} /> Reset to defaults</button>
          {msg && <span className="text-[12.5px] text-ink/80">{msg}</span>}
          <span className="ml-auto text-[11.5px] text-muted">Applies to rooms generated from now on. Units already walked keep their numbers.</span>
        </div>
      </div>
    </div>
  )
}

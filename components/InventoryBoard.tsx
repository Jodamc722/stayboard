'use client'
// INVENTORY — the menu and the shelf in one place (Jon, 2026-08-25: "need to be edit by hub,
// adjust cost, have the order links for easy ordering… we need to be able to update, we need to be
// able to add descriptions… why can't I add items, or edit items or delete items").
//
// WHY THIS SHAPE: the old Stock tab was a matrix of every shelf at once. With two shelves the
// Global column read OUT on all nine rows — nine red badges about a shelf nobody stocks — while the
// things that actually needed restocking were invisible. Someone restocking stands in ONE storeroom
// with ONE list, so this shows one shelf, worst-first, and puts the buy-it-again link on the row.
//
// EVERYTHING about an item is editable here: its name, the description the guest reads, category,
// unit, photo, guest price, what we pay, the order link — plus adding and removing items. It runs
// at 'edit' level on purpose. Only the settings card is owner-gated, because that is what switches
// on automation that charges cards; locking the menu behind the same gate meant the people who
// actually run the shelf could not fix a typo.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PhotoEditor } from '@/components/PhotoEditor'
import { Package, Loader2, Save, ExternalLink, ImagePlus, AlertTriangle, Search, ShoppingCart, Check, Plus, Trash2, ChevronDown, ChevronRight, X, Pencil, Tag, ClipboardList, Wand2 } from 'lucide-react'

type Per = { scope: string; label: string; onHand: number; reserved: number; lowAt: number; available: number; state: 'unset' | 'out' | 'low' | 'ok' | 'untracked'; updatedAt: string | null; updatedBy: string | null }
type Item = {
  id: string; sku: string; name: string; category: string | null; image: string | null; active: boolean; tracked: boolean
  hubs: string[] | null; buildings: string[] | null; per: Per[]
  description: string | null; unit: string | null; maxQty: number
  price: number; cost: number | null; reorderUrl: string | null; supplier: string | null; packNote: string | null
  /** Pack economics and the price ladder — see PricePanel below. */
  packSize: number | null; packCost: number | null; tiers: Tier[]
  imageOriginal: string | null
  salePrice: number | null; badge: string | null
  /** Sold in multiples of N on the guest form (coffee pods in 5s). Blank = any quantity. */
  soldIn: number | null
  /** What one item holds, in the guest's words — 1 = 5 pods. */
  pieces: number | null; pieceName: string | null
  /** How much is in ONE — 500 mL, 12 oz. Not the pack size. */
  sizeValue: number | null; sizeUnit: string | null
}
export type Tier = { min_qty: number; unit_price_usd: number }
const SIZE_UNITS = ['mL', 'L', 'fl oz', 'oz', 'g', 'kg', 'ct']
/** Per 100 for the small measures, per 1 for the rest — nobody quotes a price per millilitre. */
function perMeasure(price: number, size: number, unit: string): string | null {
  if (!(price > 0) || !(size > 0) || !unit) return null
  const per100 = unit === 'mL' || unit === 'g'
  const amount = per100 ? 100 : 1
  const v = price / size * amount
  return '$' + (v < 0.1 ? v.toFixed(3) : v.toFixed(2)) + ' per ' + (per100 ? '100 ' : '') + unit
}
type Scope = { id: string; label: string; buildings: string[]; listings: string[] }
type Listing = { id: string; name: string; building: string }
type Data = { scopes: Scope[]; items: Item[]; untracked: number; listings: Listing[]; buildings: string[] }
type NewItem = { key: string; name: string; description: string; category: string; unit: string; price: string; cost: string; onHand: string; reorderUrl: string }

const money = (n: number | null | undefined) => n === null || n === undefined ? '—' : '$' + (Math.round(n * 100) / 100).toFixed(2)
const box = 'text-[12.5px] px-2 py-1.5 rounded-lg border border-line bg-white text-ink focus:outline-none focus:border-brand-300'

/**
 * `view` lets the Guest Orders tabs drive this board (Jon, 2026-09-10: "the count and costs should
 * be done in the guest order tab"). Left out, the board shows its own Stock / Pricing switch — the
 * standalone page still works that way.
 */
export function InventoryBoard({ canEdit, view: fixedView }: { canEdit: boolean; view?: 'stock' | 'pricing' }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [scope, setScope] = useState<string>('')
  const [q, setQ] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [stockEdits, setStockEdits] = useState<Record<string, { onHand?: number; lowAt?: number }>>({})
  const [itemEdits, setItemEdits] = useState<Record<string, Partial<Item>>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})   // which rows have details expanded
  const [adds, setAdds] = useState<NewItem[]>([])
  const [removing, setRemoving] = useState<string | null>(null)   // two-step delete
  const [coverOpen, setCoverOpen] = useState(false)
  const [unitQ, setUnitQ] = useState('')
  const [hubMenu, setHubMenu] = useState(false)
  const [editPhoto, setEditPhoto] = useState<Item | null>(null)
  // TWO JOBS, TWO VIEWS. Counting is per shelf and happens in a storeroom; pricing is per item and
  // happens at a desk. Mixing them is what made one dense board that did neither well.
  const [ownView, setOwnView] = useState<'stock' | 'pricing'>('stock')
  const view = fixedView || ownView

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/guest-orders/stock', { cache: 'no-store' }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not load inventory'); return }
      setData(j); setErr(''); setStockEdits({}); setItemEdits({}); setAdds([]); setRemoving(null)
      // Open on a real shelf. The global one is the fallback for anything outside a hub and is
      // usually empty, which is a misleading first impression.
      setScope(s => s || (j.scopes.find((x: Scope) => x.id !== 'global')?.id ?? 'global'))
    } catch { setErr('Network error') }
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = Object.keys(stockEdits).length > 0 || Object.keys(itemEdits).length > 0 || adds.some(a => a.name.trim())

  async function save() {
    if (!data || !dirty) return
    setBusy('save'); setMsg(null)
    const rows = Object.entries(stockEdits).map(([k, v]) => {
      const sc = k.slice(0, k.lastIndexOf('|')), itemId = k.slice(k.lastIndexOf('|') + 1)
      const cur = data.items.find(i => i.id === itemId)?.per.find(p => p.scope === sc)
      return { itemId, scope: sc, onHand: v.onHand ?? cur?.onHand ?? 0, lowAt: v.lowAt ?? cur?.lowAt ?? 3 }
    })
    const items = Object.entries(itemEdits).map(([id, v]) => ({ id, name: v.name ?? data.items.find(i => i.id === id)?.name, ...v }))
    const newItems = adds.filter(a => a.name.trim()).map(a => ({
      name: a.name, description: a.description, category: a.category, unit: a.unit,
      price: a.price === '' ? 0 : Number(a.price), cost: a.cost === '' ? null : Number(a.cost),
      reorderUrl: a.reorderUrl, scope, onHand: a.onHand === '' ? 0 : Number(a.onHand), trackStock: true,
    }))
    try {
      const j = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, items, newItems }) }).then(r => r.json())
      const bits = [rows.length ? rows.length + ' count' + (rows.length === 1 ? '' : 's') : '', items.length ? items.length + ' edited' : '', j?.created ? j.created + ' added' : ''].filter(Boolean)
      if (j?.ok) setMsg({ tone: 'ok', text: 'Saved · ' + (bits.join(', ') || 'nothing to do') })
      else setMsg({ tone: 'bad', text: (j?.errors || []).join(' · ') || j?.error || 'Could not save' })
      await load()
    } catch { setMsg({ tone: 'bad', text: 'Network error' }) } finally { setBusy(null) }
  }

  // WHICH PROPERTIES AND UNITS THIS SHELF FILLS. The guest's link resolves its hub from the unit
  // first, then the property — so a unit named here gets THIS shelf even if its building is
  // elsewhere. Saved immediately: it is a toggle, not a form.
  async function setCoverage(next: { buildings?: string[]; listings?: string[] }) {
    if (!data || scope === 'global') return
    const cur = data.scopes.find(s => s.id === scope)
    if (!cur) return
    setBusy('cover'); setMsg(null)
    try {
      const j = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        rows: [], items: [], coverage: { hubId: scope.replace(/^hub:/, ''), buildings: next.buildings ?? cur.buildings, listings: next.listings ?? cur.listings },
      }) }).then(r => r.json())
      if (!j?.ok) setMsg({ tone: 'bad', text: (j?.errors || []).join(' · ') || 'Could not change what this shelf covers' })
      await load()
    } catch { setMsg({ tone: 'bad', text: 'Network error' }) } finally { setBusy(null) }
  }

  // Shelves are created, renamed and removed from here too, so "where do I add a hub" has an
  // answer on the page where hubs are used.
  async function hubOp(payload: Record<string, any>, okText: string) {
    setBusy('hub'); setMsg(null)
    try {
      const j = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [], items: [], ...payload }) }).then(r => r.json())
      if (j?.ok) setMsg({ tone: 'ok', text: okText })
      else setMsg({ tone: 'bad', text: (j?.errors || []).join(' · ') || 'Could not do that' })
      if (payload.deleteHub) setScope('global')
      await load()
    } catch { setMsg({ tone: 'bad', text: 'Network error' }) } finally { setBusy(null); setHubMenu(false) }
  }

  async function removeItem(item: Item) {
    setBusy('del:' + item.id); setMsg(null)
    try {
      const j = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [], items: [], deleteIds: [item.id] }) }).then(r => r.json())
      setMsg(j?.ok ? { tone: 'ok', text: 'Removed ' + item.name } : { tone: 'bad', text: (j?.errors || []).join(' · ') || 'Could not remove it' })
      await load()
    } catch { setMsg({ tone: 'bad', text: 'Network error' }) } finally { setBusy(null); setRemoving(null) }
  }

  async function uploadPhoto(item: Item, file: File) {
    setBusy('photo:' + item.id)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('sku', item.sku)
      const up = await fetch('/api/settings/guest-orders/photo', { method: 'POST', body: fd }).then(r => r.json())
      if (!up?.ok || !up.url) { setMsg({ tone: 'bad', text: up?.error || 'Could not upload that photo' }); return }
      // Attach through THIS endpoint, not the settings PUT — that one is owner-only, so anyone
      // else uploading a photo got a silent 403 after the file had already been stored.
      const j = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [], items: [{ id: item.id, name: item.name, imageUrl: up.url, ...(up.originalUrl ? { imageOriginal: up.originalUrl } : {}) }] }) }).then(r => r.json())
      if (j?.ok) { setMsg({ tone: 'ok', text: 'Photo added to ' + item.name }); await load() }
      else setMsg({ tone: 'bad', text: (j?.errors || []).join(' · ') || 'Photo uploaded but not attached' })
    } catch { setMsg({ tone: 'bad', text: 'Network error' }) } finally { setBusy(null) }
  }

  const rows = useMemo(() => {
    if (!data) return []
    const withPer = data.items.map(i => ({ i, p: i.per.find(x => x.scope === scope) })).filter(x => !!x.p) as { i: Item; p: Per }[]
    const rank = (i: Item, p: Per) => !i.tracked ? 4 : p.state === 'out' ? 0 : p.state === 'low' ? 1 : p.state === 'unset' ? 2 : 3
    return withPer
      .filter(x => !q || (x.i.name + ' ' + (x.i.category || '') + ' ' + (x.i.description || '') + ' ' + (x.i.supplier || '')).toLowerCase().includes(q.toLowerCase()))
      .filter(x => !onlyLow || (x.i.tracked && (x.p.state === 'out' || x.p.state === 'low')))
      .sort((a, b) => rank(a.i, a.p) - rank(b.i, b.p) || a.i.name.localeCompare(b.i.name))
  }, [data, scope, q, onlyLow])

  const needs = useMemo(() => data ? data.items.filter(i => i.tracked).map(i => i.per.find(p => p.scope === scope)).filter(p => p && (p.state === 'out' || p.state === 'low')).length : 0, [data, scope])

  if (err) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err}</div>
  if (!data) return <div className="text-sm text-muted py-8 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading inventory…</div>

  const here = data.scopes.find(s => s.id === scope)
  const val = (i: Item, k: keyof Item) => (itemEdits[i.id] && (itemEdits[i.id] as any)[k] !== undefined ? (itemEdits[i.id] as any)[k] : (i as any)[k])
  const setItem = (id: string, patch: Partial<Item>) => setItemEdits(x => ({ ...x, [id]: { ...x[id], ...patch } }))
  const cats = Array.from(new Set(data.items.map(i => i.category).filter(Boolean))) as string[]

  return (
    <div className="space-y-4">
      {msg ? <div className={'rounded-xl px-3 py-2 text-[12.5px] ' + (msg.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200')}>{msg.text}</div> : null}

      {fixedView ? null : (
        <div className="flex items-center gap-1.5">
          {(['stock', 'pricing'] as const).map(v => (
            <button key={v} onClick={() => setOwnView(v)} className={'px-3.5 py-1.5 rounded-lg text-[13px] font-semibold border ' + (view === v ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-brand-300')}>
              {v === 'stock' ? 'Stock' : 'Pricing'}
            </button>
          ))}
          <span className="text-[11.5px] text-muted ml-1">{view === 'stock' ? 'what is on each shelf' : 'what everything costs and sells for'}</span>
        </div>
      )}

      {view === 'stock' ? <CountLinkCard /> : null}

      {view === 'pricing' ? <PricingTable items={data.items} val={val} setItem={setItem} canEdit={canEdit} onEditPhoto={canEdit ? setEditPhoto : undefined} /> : null}

      <div className={'flex flex-wrap items-center gap-2 ' + (view === 'pricing' ? 'hidden' : '')}>
        <div className="flex flex-wrap gap-1.5">
          {data.scopes.map(s => (
            <button key={s.id} onClick={() => setScope(s.id)} className={'px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ' + (scope === s.id ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-brand-300')}>
              {s.id === 'global' ? 'Global shelf' : s.label}
            </button>
          ))}
          {canEdit ? (
            <button onClick={() => { const label = window.prompt('Name the new shelf — a hub is a storeroom that a group of properties or units draws from.\n\ne.g. "Salato", "Downtown store", "Beach cupboard"'); if (label && label.trim()) hubOp({ newHub: { label: label.trim() } }, 'Added the ' + label.trim() + ' shelf — now say what it covers') }}
              disabled={busy === 'hub'} className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border border-dashed border-line bg-white text-ink hover:border-brand-300 inline-flex items-center gap-1 disabled:opacity-50">
              {busy === 'hub' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} New shelf
            </button>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…" className="text-[12.5px] pl-7 pr-2 py-1.5 rounded-lg border border-line bg-white w-40" />
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink"><input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} /> Needs restocking{needs ? ' (' + needs + ')' : ''}</label>
          {canEdit ? <button onClick={() => setAdds(a => [...a, { key: 'n' + Date.now() + a.length, name: '', description: '', category: '', unit: '', price: '', cost: '', onHand: '', reorderUrl: '' }])} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300"><Plus size={13} /> Add item</button> : null}
          {canEdit ? <button onClick={save} disabled={!dirty || busy === 'save'} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">{busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save changes</button> : null}
        </div>
      </div>

      {view === 'pricing' ? null : scope === 'global' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 flex gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>This is the fallback shelf for any property not in a hub. If it reads zero, those properties show an <b>empty order form</b> — put the property in a hub, or count it here.</div>
        </div>
      ) : here ? (
        <div className="rounded-xl border border-line bg-white px-3 py-2.5">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="text-[12.5px] text-ink">
              <b>{here.label}</b> fills{' '}
              {here.buildings.length ? <>{here.buildings.length} propert{here.buildings.length === 1 ? 'y' : 'ies'}</> : 'no property'}
              {here.listings.length ? <> and {here.listings.length} individual unit{here.listings.length === 1 ? '' : 's'}</> : ''}
              . <span className="text-muted">A guest's order link uses the shelf its unit sits on.</span>
            </div>
            {canEdit ? (
              <div className="flex items-center gap-2.5">
                <button onClick={() => { setCoverOpen(o => !o); setUnitQ('') }} className="text-[12px] font-semibold text-brand-700 hover:underline">{coverOpen ? 'done' : 'change what it covers'}</button>
                <button onClick={() => { const label = window.prompt('Rename this shelf', here.label); if (label && label.trim()) hubOp({ renameHub: { hubId: scope.replace(/^hub:/, ''), label: label.trim() } }, 'Renamed') }} className="text-[12px] text-muted hover:text-ink">rename</button>
                <button onClick={() => { if (window.confirm('Remove the ' + here.label + ' shelf?\n\nIts counts go with it. The items themselves stay on the menu, and anything that pointed here falls back to the global shelf.')) hubOp({ deleteHub: { hubId: scope.replace(/^hub:/, '') } }, 'Removed the ' + here.label + ' shelf') }} className="text-[12px] text-muted hover:text-rose-700">remove shelf</button>
              </div>
            ) : null}
          </div>
          {here.buildings.length || here.listings.length ? (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {here.buildings.map(b => <span key={b} className="px-2 py-0.5 rounded-full bg-ink text-white text-[11px]">{b}</span>)}
              {here.listings.map(id => { const u = data.listings.find(x => x.id === id); return <span key={id} className="px-2 py-0.5 rounded-full border border-ink text-ink text-[11px]">{u ? u.name : id.slice(0, 8)}</span> })}
            </div>
          ) : <div className="text-[11.5px] text-amber-700 font-semibold mt-1">Nothing points at this shelf yet — no guest will see these items.</div>}

          {coverOpen && canEdit ? (
            <div className="mt-2.5 border-t border-line pt-2.5">
              <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">Whole properties</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {data.buildings.map(b => {
                  const on = here.buildings.indexOf(b) >= 0
                  const elsewhere = !on && data.scopes.some(s => s.id !== scope && s.buildings.indexOf(b) >= 0)
                  return <button key={b} type="button" disabled={elsewhere || busy === 'cover'} title={elsewhere ? 'on another shelf' : ''}
                    onClick={() => setCoverage({ buildings: on ? here.buildings.filter(x => x !== b) : [...here.buildings, b] })}
                    className={'px-2 py-0.5 rounded-full border text-[11.5px] ' + (on ? 'bg-ink text-white border-ink' : elsewhere ? 'bg-app text-muted border-line opacity-50' : 'bg-white border-line text-ink hover:border-brand-300')}>{b}</button>
                })}
              </div>
              <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold mt-2.5">Individual units <span className="normal-case tracking-normal font-normal">— a unit named here beats its property</span></div>
              <input value={unitQ} onChange={e => setUnitQ(e.target.value)} placeholder="Search units…" className={box + ' w-full sm:w-72 mt-1'} />
              <div className="max-h-48 overflow-y-auto mt-1 space-y-0.5">
                {data.listings.filter(u => !unitQ || (u.name + ' ' + u.building).toLowerCase().includes(unitQ.toLowerCase())).slice(0, 100).map(u => {
                  const on = here.listings.indexOf(u.id) >= 0
                  const elsewhere = !on && data.scopes.some(s => s.id !== scope && s.listings.indexOf(u.id) >= 0)
                  const viaBuilding = !on && here.buildings.indexOf(u.building) >= 0
                  return <button key={u.id} type="button" disabled={elsewhere || busy === 'cover'} title={elsewhere ? 'on another shelf' : viaBuilding ? 'already included via its property' : ''}
                    onClick={() => setCoverage({ listings: on ? here.listings.filter(x => x !== u.id) : [...here.listings, u.id] })}
                    className={'w-full text-left px-2 py-1 rounded text-[12px] flex items-center gap-2 ' + (on ? 'bg-ink text-white' : elsewhere ? 'text-muted opacity-50' : 'hover:bg-app text-ink')}>
                    <span className="flex-1 truncate">{u.name}</span>
                    <span className={'text-[10.5px] ' + (on ? 'text-white/70' : 'text-muted')}>{u.building}{viaBuilding ? ' · via property' : ''}</span>
                  </button>
                })}
                {!data.listings.length ? <div className="text-[12px] text-muted px-1 py-2">No listings loaded.</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {(view === 'pricing' ? [] : adds).map((a, ai) => (
        <div key={a.key} className="rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12.5px] font-semibold text-ink">New item on {here ? here.label : 'this shelf'}</div>
            <button onClick={() => setAdds(x => x.filter((_, i) => i !== ai))} className="text-muted hover:text-rose-600" title="Discard"><X size={14} /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input autoFocus value={a.name} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, name: e.target.value } : y))} placeholder="Name the guest sees *" className={box + ' w-56'} />
            <input value={a.category} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, category: e.target.value } : y))} placeholder="Category" list="inv-cats" className={box + ' w-36'} />
            <input value={a.unit} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, unit: e.target.value } : y))} placeholder="unit (case of 12)" className={box + ' w-36'} />
            <input type="number" min={0} step="0.01" value={a.price} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, price: e.target.value } : y))} placeholder="guest pays" className={box + ' w-28'} />
            <input type="number" min={0} step="0.01" value={a.cost} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, cost: e.target.value } : y))} placeholder="we pay" className={box + ' w-24'} />
            <input type="number" min={0} value={a.onHand} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, onHand: e.target.value } : y))} placeholder="on hand" className={box + ' w-24'} />
          </div>
          <textarea value={a.description} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, description: e.target.value } : y))} placeholder="Description the guest reads — what it is, what they get" rows={2} className={box + ' w-full mt-2 resize-y'} />
          <input value={a.reorderUrl} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, reorderUrl: e.target.value } : y))} placeholder="Where to buy it again (https://…)" className={box + ' w-full sm:w-[340px] mt-2'} />
          <div className="text-[11.5px] text-muted mt-2">Press <b>Save changes</b> to create it. Add its photo afterwards from its row.</div>
        </div>
      ))}
      <datalist id="inv-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>

      <div className={'rounded-2xl border border-line bg-white overflow-hidden ' + (view === 'pricing' ? 'hidden' : '')}>
        <div className="px-4 py-2.5 bg-app/60 border-b border-line flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12.5px] font-semibold text-ink flex items-center gap-1.5"><Package size={14} /> {here ? here.label : 'Shelf'} · {rows.length} item{rows.length === 1 ? '' : 's'}</div>
          <div className="text-[11.5px] text-muted">Use <b>Edit</b> on a row for its name, description, photo and removal.</div>
        </div>

        {rows.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-muted">Nothing here{onlyLow ? ' needs restocking right now.' : ' yet — use Add item.'}</div> : (
          <div className="divide-y divide-line/60">
            {rows.map(({ i, p }) => {
              const onHand = stockEdits[scope + '|' + i.id]?.onHand ?? p.onHand
              const lowAt = stockEdits[scope + '|' + i.id]?.lowAt ?? p.lowAt
              const avail = Math.max(0, onHand - p.reserved)
              const tracked = (val(i, 'tracked') as boolean) ?? i.tracked
              const state = !tracked ? 'untracked' : avail <= 0 ? 'out' : avail <= lowAt ? 'low' : 'ok'
              const price = Number(val(i, 'price') ?? 0)
              const cost = val(i, 'cost')
              // Margin uses the PACK cost when there is one — a case price off an invoice is the
              // number people actually have, and a stale per-unit field beside it read as truth.
              const pSize = Number(val(i, 'packSize') || 0), pCost = Number(val(i, 'packCost') || 0)
              const unitCost = pSize > 0 && pCost > 0 ? pCost / pSize : (cost === null || cost === undefined || cost === '' ? null : Number(cost))
              const margin = unitCost === null ? null : Math.round((price - unitCost) * 100) / 100
              const ladder: Tier[] = ((val(i, 'tiers') as Tier[]) || []).slice().sort((a, b) => a.min_qty - b.min_qty)
              const url = val(i, 'reorderUrl') as string | null
              const isOpen = !!open[i.id]
              const active = (val(i, 'active') as boolean) ?? i.active
              return (
                <div key={i.id} className={'px-4 py-3 ' + (state === 'out' ? 'bg-rose-50/40' : state === 'low' ? 'bg-amber-50/40' : '')}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="relative flex-shrink-0 group">
                      {/* object-CONTAIN, not cover. A tall bottle in a square crop loses its cap and
                          its base — which is exactly what "looks so bad from guest side" was. */}
                      {i.image
                        ? <img src={i.image} alt="" className="w-14 h-14 rounded-xl object-contain bg-app border border-line" />
                        : <div className="w-14 h-14 rounded-xl border border-dashed border-line bg-app flex items-center justify-center text-muted"><ImagePlus size={16} /></div>}
                      {canEdit ? (
                        <label className="absolute inset-0 cursor-pointer rounded-xl hover:bg-ink/10 flex items-center justify-center" title={i.image ? 'Replace photo' : 'Add a photo'}>
                          <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(i, f); e.currentTarget.value = '' }} />
                          {busy === 'photo:' + i.id ? <Loader2 size={14} className="animate-spin text-ink" /> : null}
                        </label>
                      ) : null}
                      {canEdit && i.image ? (
                        <button onClick={() => setEditPhoto(i)} title="Edit this photo" className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-ink text-white flex items-center justify-center shadow"><Wand2 size={11} /></button>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))} className="text-left text-[14px] font-semibold text-ink hover:text-brand-700 inline-flex items-center gap-1.5">
                          {isOpen ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                          {String(val(i, 'name') ?? i.name)}
                        </button>
                        <span className={'text-[10.5px] font-bold px-1.5 py-0.5 rounded ' + (state === 'untracked' ? 'bg-app text-muted border border-line' : state === 'out' ? 'bg-rose-100 text-rose-700' : state === 'low' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700')}>
                          {state === 'untracked' ? 'not counted' : state === 'out' ? 'OUT — hidden from guests' : state === 'low' ? 'LOW · ' + avail + ' left' : avail + ' available'}
                        </span>
                        {!active ? <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-app text-muted border border-line">hidden from the form</span> : null}
                      </div>
                      <div className="text-[11.5px] text-muted mt-0.5 truncate">
                        {String(val(i, 'category') ?? '') || 'Extras'}{val(i, 'sizeValue') && val(i, 'sizeUnit') ? ' · ' + (Math.round(Number(val(i, 'sizeValue')) * 100) / 100) + ' ' + val(i, 'sizeUnit') : ''}{val(i, 'unit') ? ' · ' + val(i, 'unit') : ''}
                        {p.reserved ? ' · ' + p.reserved + ' held for paid orders' : ''}
                        {tracked ? (p.updatedAt ? ' · counted ' + new Date(p.updatedAt).toLocaleDateString() : ' · never counted') : ''}
                      </div>
                      {!isOpen && val(i, 'description') ? <div className="text-[11.5px] text-muted mt-0.5 italic truncate">{String(val(i, 'description'))}</div> : null}
                    </div>

                    <div className="flex flex-wrap items-end gap-2 flex-shrink-0">
                      {tracked ? (<>
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">On hand
                          <input type="number" min={0} value={onHand} disabled={!canEdit} onChange={e => setStockEdits(x => ({ ...x, [scope + '|' + i.id]: { ...x[scope + '|' + i.id], onHand: Number(e.target.value) } }))} className={box + ' w-20 mt-0.5'} />
                        </label>
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Warn at
                          <input type="number" min={0} value={lowAt} disabled={!canEdit} onChange={e => setStockEdits(x => ({ ...x, [scope + '|' + i.id]: { ...x[scope + '|' + i.id], lowAt: Number(e.target.value) } }))} className={box + ' w-16 mt-0.5'} />
                        </label>
                      </>) : (
                        canEdit ? <button onClick={() => setItem(i.id, { tracked: true, trackStock: true } as any)} className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300">Start counting</button> : null
                      )}
                      <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Guest pays
                        <input type="number" min={0} step="0.01" value={price} disabled={!canEdit} onChange={e => setItem(i.id, { price: Number(e.target.value) } as any)} className={box + ' w-24 mt-0.5'} />
                      </label>
                      {/* The ladder at a glance. Editing it — and the pack cost behind the margin —
                          is one click away under Edit, so this dense row stays readable. */}
                      <div className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Bulk
                        <div className="flex items-center gap-1 mt-1 h-[22px]">
                          {ladder.length
                            ? ladder.slice(0, 3).map(t => <span key={t.min_qty} className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 tabular-nums normal-case tracking-normal">{t.min_qty}+ {price > 0 ? Math.round((1 - t.unit_price_usd / price) * 100) + '% off' : money(t.unit_price_usd)}</span>)
                            : <button type="button" disabled={!canEdit} onClick={() => setOpen(o => ({ ...o, [i.id]: true }))} className="text-[11px] text-muted hover:text-brand-700 normal-case tracking-normal disabled:opacity-50">one price for any qty</button>}
                          {ladder.length > 3 ? <span className="text-[11px] text-muted">+{ladder.length - 3}</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold min-w-[52px]">Margin
                        <div className={'text-[13px] font-bold tabular-nums mt-1 ' + (margin === null ? 'text-muted' : margin < 0 ? 'text-rose-700' : 'text-emerald-700')}>{margin === null ? '—' : money(margin)}</div>
                      </div>
                      {canEdit ? (
                        <div className="flex items-center gap-1.5 self-end">
                          <button onClick={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 h-9 rounded-lg border border-line bg-white text-ink hover:border-brand-300">
                            <Pencil size={12} /> {isOpen ? 'Done' : 'Edit'}
                          </button>
                          <button onClick={() => { setOpen(o => ({ ...o, [i.id]: true })); setRemoving(i.id) }} title={'Remove ' + i.name} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-white text-muted hover:text-rose-700 hover:border-rose-300">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 sm:pl-[68px] space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Name
                          <input value={String(val(i, 'name') ?? '')} disabled={!canEdit} onChange={e => setItem(i.id, { name: e.target.value } as any)} className={box + ' w-56 mt-0.5'} />
                        </label>
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Category
                          <input value={String(val(i, 'category') ?? '')} disabled={!canEdit} list="inv-cats" onChange={e => setItem(i.id, { category: e.target.value } as any)} className={box + ' w-36 mt-0.5'} />
                        </label>
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">How it is packaged
                          <input value={String(val(i, 'unit') ?? '')} disabled={!canEdit} placeholder="case of 12" onChange={e => setItem(i.id, { unit: e.target.value } as any)} className={box + ' w-36 mt-0.5'} />
                        </label>
                        {/* SIZE OF ONE — a different fact from how it is packaged, and the one a
                            guest compares on: 500 mL against 330 mL. */}
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Size of one
                          <span className="inline-flex items-center gap-1 mt-0.5">
                            <input type="number" min={0} step="0.01" value={(val(i, 'sizeValue') as number | null) ?? ''} placeholder="500" disabled={!canEdit} onChange={e => setItem(i.id, { sizeValue: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={box + ' w-[78px]'} />
                            <select value={(val(i, 'sizeUnit') as string | null) ?? ''} disabled={!canEdit} onChange={e => setItem(i.id, { sizeUnit: e.target.value || null } as any)} className={box + ' w-[86px]'}>
                              <option value="">unit…</option>
                              {SIZE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </span>
                        </label>
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Max per order
                          <input type="number" min={1} max={99} value={Number(val(i, 'maxQty') ?? 10)} disabled={!canEdit} onChange={e => setItem(i.id, { maxQty: Number(e.target.value) } as any)} className={box + ' w-24 mt-0.5'} />
                        </label>
                        <label className="flex items-center gap-1.5 text-[12px] text-ink self-end pb-1.5">
                          <input type="checkbox" checked={active} disabled={!canEdit} onChange={e => setItem(i.id, { active: e.target.checked } as any)} /> Show on the guest form
                        </label>
                      </div>
                      <PriceLadder item={i} val={val} setItem={setItem} canEdit={canEdit} />
                      <label className="block text-[10.5px] uppercase tracking-wide text-muted font-semibold">Description the guest reads
                        <textarea value={String(val(i, 'description') ?? '')} disabled={!canEdit} rows={2} placeholder="What it is and what they get — one or two lines." onChange={e => setItem(i.id, { description: e.target.value } as any)} className={box + ' w-full mt-0.5 resize-y normal-case tracking-normal'} />
                      </label>
                      {canEdit ? (
                        <div className="flex items-center gap-2 pt-1">
                          {removing === i.id ? (
                            <>
                              <span className="text-[12px] text-rose-700 font-semibold">Remove “{i.name}” from the menu?</span>
                              <button onClick={() => removeItem(i)} disabled={busy === 'del:' + i.id} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-rose-600 text-white disabled:opacity-50">{busy === 'del:' + i.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Yes, remove</button>
                              <button onClick={() => setRemoving(null)} className="text-[12px] text-muted hover:text-ink px-2">Keep it</button>
                              <span className="text-[11px] text-muted">Past orders keep their own record and are not changed.</span>
                            </>
                          ) : (
                            <button onClick={() => setRemoving(i.id)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-rose-700"><Trash2 size={12} /> Remove this item</button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:pl-[68px]">
                    <input value={(url as string) || ''} disabled={!canEdit} onChange={e => setItem(i.id, { reorderUrl: e.target.value } as any)} placeholder="Where to buy it again — paste the link" className={box + ' w-full sm:w-[300px]'} />
                    {url && /^https?:\/\//i.test(String(url))
                      ? <a href={String(url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700"><ShoppingCart size={12} /> Order <ExternalLink size={11} /></a>
                      : <span className="text-[11.5px] text-muted">no order link yet</span>}
                    <input value={(val(i, 'supplier') as string) || ''} disabled={!canEdit} onChange={e => setItem(i.id, { supplier: e.target.value } as any)} placeholder="supplier" className={box + ' w-[130px]'} />
                    <input value={(val(i, 'packNote') as string) || ''} disabled={!canEdit} onChange={e => setItem(i.id, { packNote: e.target.value } as any)} placeholder="arrives as (case of 24…)" className={box + ' w-[165px]'} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editPhoto && editPhoto.image ? (
        <PhotoEditor itemId={editPhoto.id} name={editPhoto.name} url={editPhoto.image}
          onDone={u => setData(d => d ? { ...d, items: d.items.map(x => x.id === editPhoto.id ? { ...x, image: u } : x) } : d)}
          onClose={() => setEditPhoto(null)} />
      ) : null}

      {canEdit && dirty ? (
        <div className="sticky bottom-3 flex justify-end">
          <button onClick={save} disabled={busy === 'save'} className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2.5 rounded-xl bg-ink text-white shadow-lg disabled:opacity-50">
            {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save changes
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ── PRICING ───────────────────────────────────────────────────────────────────────────────────
// Jon, 2026-09-10, on the first version: "this does not make sense to me, can we make this easier
// to calculate… This should be a very simple process. It should ask cost per item, our team can
// calculate this independently. From there, we can figure out the cost savings for more purchases.
// Just need a simple way to calculate and allow guests to benefit from bulk orders."
//
// So the whole panel is now three ideas in a straight line:
//
//   COST PER ITEM  →  PRICE FOR ONE  →  A DISCOUNT FOR BUYING MORE
//
// One cost field, typed by whoever worked it out — no pack-size arithmetic here, because that is a
// calculation the team already does and a second way to enter it only invites the two numbers to
// disagree. (Pack size and pack cost still live in the form builder for anyone who wants them.)
//
// A bulk break is now ONE number: the percent off. Everything else on the row — what a guest pays
// each, what they pay in total, what we keep — is printed, not typed. The old row had two number
// boxes that recomputed each other on every keystroke, which is what "does not make sense" meant.
//
// Percentages also hold their meaning when the price changes: raise the price for one and every
// break moves with it, so "6+ is 30% off" stays 30% off instead of quietly becoming 12%.
function PriceLadder({ item, val, setItem, canEdit }: { item: Item; val: (i: Item, k: keyof Item) => any; setItem: (id: string, patch: Partial<Item>) => void; canEdit: boolean }) {
  const price = Number(val(item, 'price') ?? 0)
  const maxQty = Number(val(item, 'maxQty') ?? 10)
  const packSize = val(item, 'packSize') as number | null
  const packCost = val(item, 'packCost') as number | null
  const rawCost = val(item, 'cost') as number | null
  const sizeValue = val(item, 'sizeValue') as number | null
  const sizeUnit = val(item, 'sizeUnit') as string | null
  const tiers: Tier[] = (val(item, 'tiers') as Tier[]) || []
  const sorted = tiers.slice().sort((a, b) => a.min_qty - b.min_qty)

  // Cost per item. A pack cost set earlier in the form builder still wins, because it is derived
  // from an invoice — but this panel only ever asks for the one number.
  const unitCost = packSize && packCost ? Math.round((Number(packCost) / Number(packSize)) * 100) / 100 : (rawCost === null || rawCost === undefined || (rawCost as any) === '' ? null : Number(rawCost))
  const keepAt = (p: number) => unitCost === null ? null : Math.round((p - unitCost) * 100) / 100
  const pctOf = (unit: number) => price > 0 ? Math.round((1 - unit / price) * 100) : 0
  const priceAt = (pct: number) => Math.round(price * (1 - pct / 100) * 100) / 100

  const put = (next: Tier[]) => setItem(item.id, { tiers: next.filter(t => t.min_qty >= 2).sort((a, b) => a.min_qty - b.min_qty).slice(0, 6) } as any)
  const setPct = (idx: number, pct: number) => put(sorted.map((t, i) => i === idx ? { ...t, unit_price_usd: priceAt(Math.min(90, Math.max(0, Math.round(pct)))) } : t))
  const setQty = (idx: number, q: number) => put(sorted.map((t, i) => i === idx ? { ...t, min_qty: Math.max(2, Math.floor(q || 2)) } : t))
  const add = (qty: number) => {
    if (sorted.some(t => t.min_qty === qty)) return
    const below = sorted.filter(t => t.min_qty < qty).pop()
    put([...sorted, { min_qty: qty, unit_price_usd: priceAt(Math.min(50, (below ? pctOf(below.unit_price_usd) : 0) + 10)) }])
  }
  // Changing the price for one keeps every discount at the percentage it was set to.
  const setBasePrice = (next: number) => {
    const pcts = sorted.map(t => pctOf(t.unit_price_usd))
    const rescaled = sorted.map((t, i) => ({ ...t, unit_price_usd: Math.round(next * (1 - pcts[i] / 100) * 100) / 100 }))
    setItem(item.id, { price: next, ...(sorted.length ? { tiers: rescaled } : {}) } as any)
  }

  const nextQty = () => { for (const q of [3, 6, 12, 24]) if (!sorted.some(t => t.min_qty === q)) return q; return (sorted.length ? sorted[sorted.length - 1].min_qty : 2) + 1 }
  const unreachable = sorted.filter(t => t.min_qty > maxQty)
  const below = (idx: number) => idx > 0 ? sorted[idx - 1].unit_price_usd : price
  const goesUpAt = (idx: number) => { const p = below(idx); return p > 0 && sorted[idx].unit_price_usd >= p }

  return (
    <div className="rounded-xl border border-line bg-app/40 p-3">
      {/* 1 — the two numbers everything else is worked out from. */}
      <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold flex items-center gap-1.5"><Tag size={12} /> Pricing</div>
      <div className="flex flex-wrap items-end gap-3 mt-2">
        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Cost per item
          <input type="number" min={0} step="0.01" value={packSize && packCost ? (unitCost ?? '') : (rawCost ?? '')} placeholder="what one costs us"
            disabled={!canEdit || !!(packSize && packCost)} onChange={e => setItem(item.id, { cost: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={box + ' w-32 mt-0.5'} />
        </label>
        <span className="text-muted text-[13px] pb-1.5">→</span>
        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Guest pays for one
          <input type="number" min={0} step="0.01" value={price} disabled={!canEdit} onChange={e => setBasePrice(Math.max(0, Number(e.target.value)))} className={box + ' w-32 mt-0.5 font-semibold'} />
        </label>
        <div className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold pb-0.5">We keep
          <div className={'text-[15px] font-bold tabular-nums mt-0.5 ' + (keepAt(price) === null ? 'text-muted' : keepAt(price)! < 0 ? 'text-rose-700' : 'text-emerald-700')}>
            {keepAt(price) === null ? '—' : money(keepAt(price)!) + (price > 0 ? '  ·  ' + Math.round(keepAt(price)! / price * 100) + '%' : '')}
          </div>
        </div>
        {packSize && packCost ? <div className="text-[11px] text-muted pb-1.5 max-w-[260px]">Worked out from the case below: {money(Number(packCost))} ÷ {packSize}.</div> : null}
      </div>
      {/* Cost and price per measure — the only fair way to compare two suppliers, or two sizes. */}
      {sizeValue && sizeUnit ? (
        <div className="text-[11.5px] text-muted mt-1.5">
          Each one is <b className="text-ink">{Math.round(Number(sizeValue) * 100) / 100} {sizeUnit}</b>
          {unitCost !== null ? <> · costs us {perMeasure(unitCost, Number(sizeValue), sizeUnit)}</> : null}
          {price > 0 ? <> · sells at {perMeasure(price, Number(sizeValue), sizeUnit)}</> : null}
        </div>
      ) : null}

      {/* SOLD IN MULTIPLES (Jon, 2026-09-10: "coffee pods — can't order one… customizable per item
          at the stock or inventory"). The guest form steps by this and the server rounds up to it.
          Nothing to do with the case we buy, below. */}
      {/* WHAT ONE ITEM HOLDS (Jon, 2026-09-10: "1 = 5 pods"). The guest sees "1 = 5 pods" under the
          name and "10 pods" on a bundle of 2. Quantity is still in items. */}
      <div className="mt-2.5 pt-2.5 border-t border-line/70 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">One item is
          <div className="flex items-center gap-1.5 mt-0.5">
            <input type="number" min={0} max={9999} value={(val(item, 'pieces') as number | null) ?? ''} placeholder="5" disabled={!canEdit}
              onChange={e => setItem(item.id, { pieces: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) } as any)} className={box + ' w-20'} />
            <input value={String(val(item, 'pieceName') ?? '')} placeholder="pods" disabled={!canEdit} maxLength={24}
              onChange={e => setItem(item.id, { pieceName: e.target.value } as any)} className={box + ' w-28 normal-case tracking-normal'} />
          </div>
        </label>
        {(() => { const n = Number(val(item, 'pieces')), nm = String(val(item, 'pieceName') || '').trim(); return n > 0 && nm
          ? <div className="text-[11.5px] text-muted pb-1.5">Guest reads <b className="text-ink">1 = {n} {nm}</b>; 3 items show as {n * 3} {nm}.</div>
          : <div className="text-[11.5px] text-muted pb-1.5">Optional — say what one item contains, e.g. 5 pods, 12 bottles.</div> })()}
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-line/70 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Guests order in multiples of
          <input type="number" min={0} max={999} value={(val(item, 'soldIn') as number | null) ?? ''} placeholder="any" disabled={!canEdit}
            onChange={e => setItem(item.id, { soldIn: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) } as any)} className={box + ' w-24 mt-0.5'} />
        </label>
        {(() => { const si = Number(val(item, 'soldIn')); if (!(si > 1)) return <div className="text-[11.5px] text-muted pb-1.5">Blank = any quantity. Type 5 and a guest can only add 5, 10, 15…</div>
          const cap = Math.floor(maxQty / si) * si
          return <div className="text-[11.5px] text-muted pb-1.5 max-w-[420px] leading-snug">The Add button puts <b>{si}</b> in the basket and +/− step by {si}.{cap < si ? <> <b className="text-rose-700">Max per order ({maxQty}) is below {si}, so nobody can order this.</b></> : cap < maxQty ? <> Max per order ({maxQty}) rounds down to <b>{cap}</b>.</> : null}</div> })()}
      </div>

      {/* BUY BY THE CASE. Optional, and it only ever feeds "cost per item" above — two ways to say
          what one costs, never two competing answers. */}
      <div className="mt-2.5 pt-2.5 border-t border-line/70">
        <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">Or buy by the case <span className="normal-case tracking-normal font-normal">— we work out the cost per item</span></div>
        <div className="flex flex-wrap items-end gap-2 mt-1.5">
          <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Units per case
            <input type="number" min={0} value={packSize ?? ''} placeholder="24" disabled={!canEdit} onChange={e => setItem(item.id, { packSize: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) } as any)} className={box + ' w-24 mt-0.5'} />
          </label>
          <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">The case costs us
            <input type="number" min={0} step="0.01" value={packCost ?? ''} placeholder="11.88" disabled={!canEdit} onChange={e => setItem(item.id, { packCost: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={box + ' w-28 mt-0.5'} />
          </label>
          {packSize && packCost && price > 0 ? (() => {
            // WHAT A CASE ACTUALLY BRINGS IN. The first version multiplied the single-unit price by
            // the case size, which quietly ignored every bulk discount — a guest buying a whole
            // case is exactly the guest who earns the biggest one. This prices the case the way
            // the server does: highest qualifying break, applied to the whole line.
            const size = Number(packSize)
            const sellQty = Math.min(size, maxQty)
            let unit = price; for (const t of sorted) if (sellQty >= t.min_qty) unit = t.unit_price_usd
            const revenue = Math.round(unit * sellQty * 100) / 100
            const outlay = Math.round(Number(packCost) * (sellQty / size) * 100) / 100
            const profit = Math.round((revenue - outlay) * 100) / 100
            const discounted = unit < price
            return (
              <div className="text-[11.5px] text-muted pb-1 max-w-[420px] leading-snug">
                {money(Number(packCost) / size)} a unit.{' '}
                {sellQty < size ? <>A guest can only order <b>{sellQty}</b> at once (max per order), and </> : <>Sold as a whole case of {size}, </>}
                {discounted ? <>the {Math.round((1 - unit / price) * 100)}% bulk price applies — </> : null}
                that is {money(revenue)} in, {money(outlay)} out, <b className={profit < 0 ? 'text-rose-700' : 'text-emerald-700'}>{money(profit)} to us</b>.
              </div>
            )
          })() : <div className="text-[11.5px] text-muted pb-1.5">Leave these blank and just type the cost per item above.</div>}
        </div>
      </div>

      {/* 2 — the bulk discount. One number per row; the rest is printed. */}
      <div className="mt-3 pt-2.5 border-t border-line/70">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">Bulk discount <span className="normal-case tracking-normal font-normal">— set the % off, we work out the rest</span></div>
          {canEdit ? (
            <div className="flex items-center gap-1">
              {[3, 6, 12].map(q => sorted.some(t => t.min_qty === q) ? null : (
                <button key={q} type="button" onClick={() => add(q)} className="text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-line bg-white text-ink hover:border-brand-300">{q}+</button>
              ))}
              {packSize && packSize > 1 && !sorted.some(t => t.min_qty === Number(packSize)) ? (
                <button type="button" onClick={() => add(Number(packSize))} className="text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-line bg-white text-ink hover:border-brand-300">Full pack ({packSize})</button>
              ) : null}
              <button type="button" onClick={() => add(nextQty())} disabled={sorted.length >= 6} className="text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-dashed border-line bg-white text-ink hover:border-brand-300 disabled:opacity-40"><Plus size={11} className="inline" /> another</button>
            </div>
          ) : null}
        </div>

        {sorted.length === 0 ? (
          <div className="text-[11.5px] text-muted mt-1.5">Everyone pays {money(price)} whatever they order. Add a discount to reward a bigger order.</div>
        ) : (
          <div className="mt-2 space-y-1">
            {sorted.map((t, idx) => {
              const each = Number(t.unit_price_usd) || 0
              const pct = pctOf(each)
              const total = Math.round(each * t.min_qty * 100) / 100
              const keep = keepAt(each)
              const up = goesUpAt(idx)
              return (
                <div key={idx} className={'rounded-lg px-2 py-1.5 -mx-1 ' + (up ? 'bg-rose-50 border border-rose-200' : '')}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="text-muted">Buy</span>
                    <input type="number" min={2} max={99} value={t.min_qty} disabled={!canEdit} onChange={e => setQty(idx, Number(e.target.value))} className={box + ' w-[58px]'} />
                    <span className="text-muted">or more →</span>
                    <span className="inline-flex items-center gap-1">
                      <input type="number" min={0} max={90} step={5} value={pct} disabled={!canEdit} onChange={e => setPct(idx, Number(e.target.value))} className={box + ' w-[68px] font-semibold'} />
                      <span className="text-muted">% off</span>
                    </span>
                    <span className="text-ink">= <b className="tabular-nums">{money(each)}</b> each</span>
                    <span className="text-muted tabular-nums">·  {money(total)} for {t.min_qty}</span>
                    {keep !== null ? <span className={'text-[11.5px] ' + (keep < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>{keep < 0 ? 'below cost' : 'we keep ' + money(keep) + ' each'}</span> : null}
                    {canEdit ? <button type="button" onClick={() => put(sorted.filter((_, i) => i !== idx))} className="text-muted hover:text-rose-600 ml-auto" title="Remove"><X size={13} /></button> : null}
                  </div>
                  {/* A discount that shrinks as the order grows — the one mistake here that costs money. */}
                  {up ? (
                    <div className="text-[11.5px] text-rose-800 mt-1 leading-snug">
                      Buying {t.min_qty} would cost <b>more</b> each ({money(each)}) than buying {idx > 0 ? sorted[idx - 1].min_qty : 1} ({money(below(idx))}). Give this row a bigger discount than the one above it.
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {unreachable.length ? (
          <div className="mt-2 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <div>
              No one can reach {unreachable.map(t => t.min_qty).join(', ')} — <b>max per order</b> is {maxQty}.
              {canEdit ? <button type="button" onClick={() => setItem(item.id, { maxQty: Math.min(99, Math.max(...unreachable.map(t => t.min_qty))) } as any)} className="ml-1 font-semibold underline">raise it to {Math.min(99, Math.max(...unreachable.map(t => t.min_qty)))}</button> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── PRICING, AS A TABLE ───────────────────────────────────────────────────────────────────────
// Jon, 2026-09-10: "the way we set up the pricing looks terrible and it's time consuming." And:
// "make it simple, easy and not complicated."
//
// The panel it replaces asked you to open one item, read six labelled boxes, close it, open the
// next. With fifteen snacks to price that is fifteen round trips. This is the same numbers as one
// row per item: cost, price, margin, bulk — type, Tab, type, Tab. Nothing expands unless you ask
// for the bulk ladder, which is the only part that is not a single number.
//
// Pricing is a fact about the ITEM, not about a shelf, so this lists the whole menu and ignores the
// shelf picker above it — otherwise the same price would appear to have two homes.
function PricingTable({ items, val, setItem, canEdit, onEditPhoto }: { items: Item[]; val: (i: Item, k: keyof Item) => any; setItem: (id: string, patch: Partial<Item>) => void; canEdit: boolean; onEditPhoto?: (i: Item) => void }) {
  const [openBulk, setOpenBulk] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const rows = items
    .filter(i => !q || (i.name + ' ' + (i.category || '')).toLowerCase().includes(q.toLowerCase()))
    .slice().sort((a, b) => (a.category || 'zz').localeCompare(b.category || 'zz') || a.name.localeCompare(b.name))

  const costOf = (i: Item) => {
    const ps = Number(val(i, 'packSize') || 0), pc = Number(val(i, 'packCost') || 0)
    if (ps > 0 && pc > 0) return Math.round(pc / ps * 100) / 100
    const c = val(i, 'cost')
    return c === null || c === undefined || c === '' ? null : Number(c)
  }
  const th = 'text-[10.5px] uppercase tracking-wide text-muted font-semibold px-2 py-1.5 text-left'
  const cell = 'text-[12.5px] px-1.5 py-1 rounded-lg border border-line bg-white text-ink focus:outline-none focus:border-brand-300 tabular-nums'

  const unpriced = rows.filter(i => !(Number(val(i, 'price')) > 0)).length

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-app/60 border-b border-line flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[12.5px] font-semibold text-ink">Pricing · {rows.length} item{rows.length === 1 ? '' : 's'}
          {unpriced ? <span className="ml-2 text-[11.5px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{unpriced} with no price — hidden from guests</span> : null}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…" className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-line bg-white w-44" />
      </div>

      <div className="overflow-x-auto">
        <datalist id="inv-badges"><option value="New" /><option value="Limited" /><option value="Last few" /><option value="Popular" /><option value="Guest favourite" /></datalist>
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-line bg-white">
              <th className={th}>Item</th>
              <th className={th + ' w-[130px]'}>Size of one</th>
              <th className={th + ' w-[92px]'}>Costs us</th>
              <th className={th + ' w-[92px]'}>Guest pays</th>
              <th className={th + ' w-[96px]'}>We keep</th>
              <th className={th + ' w-[190px]'}>Offer</th>
              <th className={th}>Buy more, pay less</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(i => {
              const price = Number(val(i, 'price') ?? 0)
              const cost = costOf(i)
              const keep = cost === null ? null : Math.round((price - cost) * 100) / 100
              const tiers: Tier[] = ((val(i, 'tiers') as Tier[]) || []).slice().sort((a, b) => a.min_qty - b.min_qty)
              const packed = !!(Number(val(i, 'packSize')) > 0 && Number(val(i, 'packCost')) > 0)
              const isOpen = openBulk === i.id
              return (
                <tr key={i.id} className={'border-b border-line/60 align-middle ' + (isOpen ? 'bg-brand-50/30' : '')}>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2 min-w-[190px]">
                      {i.image
                        ? <button type="button" onClick={() => onEditPhoto && onEditPhoto(i)} title="Edit this photo" className="flex-shrink-0"><img src={i.image} alt="" className="w-8 h-8 rounded-lg object-contain bg-app border border-line hover:border-brand-400" /></button>
                        : <div className="w-8 h-8 rounded-lg border border-dashed border-line bg-app flex-shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ink truncate">{String(val(i, 'name') ?? i.name)}</div>
                        <div className="text-[11px] text-muted truncate">{String(val(i, 'category') ?? '') || 'Extras'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1">
                      <input type="number" min={0} step="0.01" value={(val(i, 'sizeValue') as number | null) ?? ''} placeholder="—" disabled={!canEdit}
                        onChange={e => setItem(i.id, { sizeValue: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={cell + ' w-[62px]'} />
                      <select value={(val(i, 'sizeUnit') as string | null) ?? ''} disabled={!canEdit} onChange={e => setItem(i.id, { sizeUnit: e.target.value || null } as any)} className={cell + ' w-[64px]'}>
                        <option value="">—</option>
                        {SIZE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min={0} step="0.01" value={packed ? (cost ?? '') : ((val(i, 'cost') as number | null) ?? '')} placeholder="—"
                      disabled={!canEdit || packed} title={packed ? 'From the case: ' + money(Number(val(i, 'packCost'))) + ' ÷ ' + val(i, 'packSize') : ''}
                      onChange={e => setItem(i.id, { cost: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={cell + ' w-[80px]' + (packed ? ' bg-app text-muted' : '')} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min={0} step="0.01" value={price} disabled={!canEdit}
                      onChange={e => {
                        // Raise the price and every discount keeps its percentage, instead of a
                        // "30% off" quietly becoming 12% because the base moved underneath it.
                        const next = Math.max(0, Number(e.target.value))
                        const pcts = tiers.map(t => price > 0 ? 1 - t.unit_price_usd / price : 0)
                        setItem(i.id, { price: next, ...(tiers.length ? { tiers: tiers.map((t, k) => ({ ...t, unit_price_usd: Math.round(next * (1 - pcts[k]) * 100) / 100 })) } : {}) } as any)
                      }} className={cell + ' w-[80px] font-semibold'} />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={'text-[12.5px] font-bold tabular-nums ' + (keep === null ? 'text-muted' : keep < 0 ? 'text-rose-700' : 'text-emerald-700')}>
                      {keep === null ? '—' : money(keep)}{keep !== null && price > 0 ? <span className="font-normal text-muted"> · {Math.round(keep / price * 100)}%</span> : null}
                    </span>
                  </td>
                  {/* ON OFFER. The list price stays put so the guest can see what it was — a discount
                      nobody can see is not a discount, it is just a lower price. */}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <input type="number" min={0} step="0.01" value={(val(i, 'salePrice') as number | null) ?? ''} placeholder="now $" disabled={!canEdit}
                        onChange={e => setItem(i.id, { salePrice: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={cell + ' w-[74px]'} />
                      <input value={String(val(i, 'badge') ?? '')} placeholder="badge" list="inv-badges" disabled={!canEdit}
                        onChange={e => setItem(i.id, { badge: e.target.value.slice(0, 16) } as any)} className={cell + ' w-[88px] tabular-nums-none'} />
                    </div>
                    {(() => { const sp = Number(val(i, 'salePrice')); if (!(sp > 0) || !(price > 0)) return null
                      const off = Math.round((1 - sp / price) * 100)
                      const m = cost === null ? null : Math.round((sp - cost) * 100) / 100
                      return <div className={'text-[10.5px] mt-0.5 ' + (m !== null && m < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>
                        {off > 0 ? off + '% off · was ' + money(price) : 'not a discount'}{m !== null ? (m < 0 ? ' · BELOW COST' : ' · keep ' + money(m)) : ''}
                      </div> })()}
                  </td>
                  <td className="px-2 py-1.5">
                    <button type="button" onClick={() => setOpenBulk(o => o === i.id ? null : i.id)} className="text-left inline-flex items-center gap-1.5 flex-wrap">
                      {tiers.length
                        ? tiers.map(t => <span key={t.min_qty} className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 tabular-nums">{t.min_qty}+ {price > 0 ? Math.round((1 - t.unit_price_usd / price) * 100) + '% off' : money(t.unit_price_usd)}</span>)
                        : <span className="text-[11.5px] text-muted hover:text-brand-700">one price · add a discount</span>}
                      {isOpen ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
                    </button>
                    {isOpen ? <BulkEditor item={i} price={price} cost={cost} tiers={tiers} setItem={setItem} canEdit={canEdit} maxQty={Number(val(i, 'maxQty') ?? 10)} /> : null}
                  </td>
                </tr>
              )
            })}
            {!rows.length ? <tr><td colSpan={7} className="px-4 py-8 text-center text-[13px] text-muted">Nothing matches “{q}”.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** One number per break — the percent off. Everything else on the line is printed, not typed. */
function BulkEditor({ item, price, cost, tiers, setItem, canEdit, maxQty }: { item: Item; price: number; cost: number | null; tiers: Tier[]; setItem: (id: string, patch: Partial<Item>) => void; canEdit: boolean; maxQty: number }) {
  const put = (next: Tier[]) => setItem(item.id, { tiers: next.filter(t => t.min_qty >= 2).sort((a, b) => a.min_qty - b.min_qty).slice(0, 6) } as any)
  const priceAt = (pct: number) => Math.round(price * (1 - Math.min(90, Math.max(0, pct)) / 100) * 100) / 100
  const pctOf = (u: number) => price > 0 ? Math.round((1 - u / price) * 100) : 0
  const add = (qty: number) => {
    if (tiers.some(t => t.min_qty === qty)) return
    const belowT = tiers.filter(t => t.min_qty < qty).pop()
    put([...tiers, { min_qty: qty, unit_price_usd: priceAt(Math.min(50, (belowT ? pctOf(belowT.unit_price_usd) : 0) + 10)) }])
  }
  const nextQty = () => { for (const q of [3, 6, 12, 24]) if (!tiers.some(t => t.min_qty === q)) return q; return (tiers.length ? tiers[tiers.length - 1].min_qty : 2) + 1 }
  const b = 'text-[12px] px-1.5 py-1 rounded-lg border border-line bg-white text-ink focus:outline-none focus:border-brand-300 tabular-nums'
  return (
    <div className="mt-2 space-y-1.5 pb-1">
      {tiers.map((t, idx) => {
        const each = t.unit_price_usd
        const prev = idx > 0 ? tiers[idx - 1].unit_price_usd : price
        const up = prev > 0 && each >= prev
        const keep = cost === null ? null : Math.round((each - cost) * 100) / 100
        return (
          <div key={idx} className={'flex items-center gap-1.5 text-[12px] rounded-lg px-1.5 py-1 ' + (up ? 'bg-rose-50 border border-rose-200' : '')}>
            <span className="text-muted">Buy</span>
            <input type="number" min={2} max={99} value={t.min_qty} disabled={!canEdit} onChange={e => put(tiers.map((x, k) => k === idx ? { ...x, min_qty: Math.max(2, Math.floor(Number(e.target.value) || 2)) } : x))} className={b + ' w-[50px]'} />
            <span className="text-muted">+ →</span>
            <input type="number" min={0} max={90} step={5} value={pctOf(each)} disabled={!canEdit} onChange={e => put(tiers.map((x, k) => k === idx ? { ...x, unit_price_usd: priceAt(Number(e.target.value)) } : x))} className={b + ' w-[56px] font-semibold'} />
            <span className="text-muted">% off =</span>
            <b className="tabular-nums">{money(each)}</b>
            <span className="text-muted">each</span>
            {up ? <span className="text-[11px] font-semibold text-rose-800">costs more than buying {idx > 0 ? tiers[idx - 1].min_qty : 1}</span>
              : keep !== null ? <span className={'text-[11px] ' + (keep < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>{keep < 0 ? 'below cost' : 'keep ' + money(keep)}</span> : null}
            {t.min_qty > maxQty ? <span className="text-[11px] font-semibold text-amber-800">max per order is {maxQty}</span> : null}
            {canEdit ? <button type="button" onClick={() => put(tiers.filter((_, k) => k !== idx))} className="text-muted hover:text-rose-600 ml-auto"><X size={12} /></button> : null}
          </div>
        )
      })}
      {canEdit ? (
        <div className="flex items-center gap-1 pt-0.5">
          {[3, 6, 12].map(q => tiers.some(t => t.min_qty === q) ? null : <button key={q} type="button" onClick={() => add(q)} className="text-[11px] font-semibold px-1.5 py-0.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300">{q}+</button>)}
          <button type="button" onClick={() => add(nextQty())} disabled={tiers.length >= 6} className="text-[11px] font-semibold px-1.5 py-0.5 rounded-lg border border-dashed border-line bg-white text-ink hover:border-brand-300 disabled:opacity-40">+ another</button>
        </div>
      ) : null}
    </div>
  )
}

// ── THE COUNTING LINK ─────────────────────────────────────────────────────────────────────────
// One link, always there, minted the first time this card loads — nobody should have to decide to
// "create" it. Beside it, who counted what and when, because Jon asked for exactly that: "it should
// show who did the count."
function CountLinkCard() {
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)
  const load = useCallback(async () => { try { setD(await fetch('/api/inventory-count', { cache: 'no-store' }).then(r => r.json())) } catch { /* offline */ } }, [])
  useEffect(() => { load() }, [load])
  async function put(body: any, key: string) {
    setBusy(key)
    try { await fetch('/api/inventory-count', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()); await load() } finally { setBusy('') }
  }
  if (!d?.ok) return null
  const link = d.link
  const counts = (d.counts || []) as any[]
  const ago = (s: string) => { const m = Math.round((Date.now() - new Date(s).getTime()) / 60000); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago' }
  return (
    <div className="rounded-2xl border border-line bg-white p-3.5">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[12.5px] font-semibold text-ink flex items-center gap-1.5"><ClipboardList size={14} /> Counting link</div>
          <div className="text-[11.5px] text-muted mt-0.5">Send it to whoever is standing in the storeroom. No login — they pick the shelf, put a number next to what they see, and their name goes on the count.</div>
        </div>
        <div className="flex items-center gap-2">
          <a href={link.url} target="_blank" rel="noreferrer" className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300 inline-flex items-center gap-1">Open <ExternalLink size={11} /></a>
          <button onClick={() => { navigator.clipboard?.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 1600) }} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-ink text-white inline-flex items-center gap-1">{copied ? <><Check size={12} /> Copied</> : 'Copy link'}</button>
        </div>
      </div>
      <div className="mt-2 text-[12px] font-mono text-muted break-all">{link.url}</div>
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-[12px] text-ink">
          Passcode
          <input defaultValue={link.passcode || ''} placeholder="none" onBlur={e => { if (e.target.value !== (link.passcode || '')) put({ passcode: e.target.value }, 'pass') }} className="text-[12.5px] px-2 py-1 rounded-lg border border-line bg-white w-28" />
        </label>
        <button onClick={() => { if (window.confirm('Make a new link?\n\nThe one you have already sent out stops working.')) put({ rotate: true }, 'rot') }} disabled={!!busy} className="text-[11.5px] text-muted hover:text-ink">new link</button>
        {link.last_used_at ? <span className="text-[11.5px] text-muted">last used {ago(link.last_used_at)}</span> : <span className="text-[11.5px] text-muted">not used yet</span>}
      </div>

      <div className="mt-3 pt-2.5 border-t border-line">
        <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">Recent counts</div>
        {!counts.length ? <div className="text-[12px] text-muted mt-1">Nobody has counted yet.</div> : (
          <div className="mt-1.5 space-y-1.5">
            {counts.slice(0, 6).map(c => {
              const moved = (c.lines || []).filter((l: any) => l.delta !== 0)
              return (
                <div key={c.id} className="text-[12.5px]">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <b className="text-ink">{String(c.counted_by).split('@')[0]}</b>
                    <span className="text-muted">counted {c.items} on {c.scope_label || c.scope} · {ago(c.created_at)}</span>
                    <span className={'text-[11px] font-semibold px-1.5 py-0.5 rounded-full ' + (c.changed ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')}>{c.changed ? c.changed + ' changed' : 'all matched'}</span>
                  </div>
                  {moved.length ? <div className="text-[11.5px] text-muted mt-0.5 truncate">{moved.slice(0, 5).map((l: any) => l.name + ' ' + l.before + '→' + l.after).join(' · ')}{moved.length > 5 ? ' +' + (moved.length - 5) + ' more' : ''}</div> : null}
                  {c.note ? <div className="text-[11.5px] text-ink italic mt-0.5">“{c.note}”</div> : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

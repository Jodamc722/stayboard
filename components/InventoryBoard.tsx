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
import { CatalogTable, type NewCatalogItem } from '@/components/CatalogTable'
import { Package, Loader2, Save, ExternalLink, ImagePlus, AlertTriangle, Search, Check, Plus, X, Pencil, ClipboardList, Wand2 } from 'lucide-react'

export type Per = { scope: string; label: string; onHand: number; reserved: number; lowAt: number; available: number; state: 'unset' | 'out' | 'low' | 'ok' | 'untracked'; updatedAt: string | null; updatedBy: string | null }
export type Item = {
  id: string; sku: string; name: string; category: string | null; image: string | null; active: boolean; tracked: boolean
  hubs: string[] | null; buildings: string[] | null; markets: string[] | null; feeCode: string; sort: number; per: Per[]
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
type Data = { scopes: Scope[]; items: Item[]; untracked: number; listings: Listing[]; buildings: string[]; markets?: string[] }
type NewItem = { key: string; name: string; description: string; category: string; unit: string; price: string; cost: string; onHand: string; reorderUrl: string }

const money = (n: number | null | undefined) => n === null || n === undefined ? '—' : '$' + (Math.round(n * 100) / 100).toFixed(2)
const box = 'text-[12.5px] px-2 py-1.5 rounded-lg border border-line bg-white text-ink focus:outline-none focus:border-brand-300'

/**
 * `view` lets the Guest Orders tabs drive this board (Jon, 2026-09-10: "the count and costs should
 * be done in the guest order tab"). Left out, the board shows its own Stock / Pricing switch — the
 * standalone page still works that way.
 */
export function InventoryBoard({ canEdit, view: fixedView, onSwitchView }: { canEdit: boolean; view?: 'stock' | 'pricing' | 'catalog'; onSwitchView?: (v: 'stock' | 'catalog') => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [scope, setScope] = useState<string>('')
  const [q, setQ] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [stockEdits, setStockEdits] = useState<Record<string, { onHand?: number; lowAt?: number }>>({})
  const [itemEdits, setItemEdits] = useState<Record<string, Partial<Item>>>({})
  const [adds, setAdds] = useState<NewItem[]>([])
  const [removing, setRemoving] = useState<string | null>(null)   // two-step delete
  const [coverOpen, setCoverOpen] = useState(false)
  const [unitQ, setUnitQ] = useState('')
  const [hubMenu, setHubMenu] = useState(false)
  const [editPhoto, setEditPhoto] = useState<Item | null>(null)
  // TWO JOBS, TWO VIEWS. Counting is per shelf and happens in a storeroom; pricing is per item and
  // happens at a desk. Mixing them is what made one dense board that did neither well.
  const [ownView, setOwnView] = useState<'stock' | 'catalog'>('stock')
  const view: 'stock' | 'catalog' = fixedView === 'pricing' ? 'catalog' : (fixedView || ownView)
  const [catAdds, setCatAdds] = useState<NewCatalogItem[]>([])
  const [openCat, setOpenCat] = useState<string | null>(null)
  const goCatalog = (id: string) => { setOpenCat(id); if (onSwitchView) onSwitchView('catalog'); else setOwnView('catalog') }

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/guest-orders/stock', { cache: 'no-store' }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not load inventory'); return }
      setData(j); setErr(''); setStockEdits({}); setItemEdits({}); setAdds([]); setCatAdds([]); setRemoving(null)
      // Open on a real shelf. The global one is the fallback for anything outside a hub and is
      // usually empty, which is a misleading first impression.
      setScope(s => s || (j.scopes.find((x: Scope) => x.id !== 'global')?.id ?? 'global'))
    } catch { setErr('Network error') }
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = Object.keys(stockEdits).length > 0 || Object.keys(itemEdits).length > 0 || adds.some(a => a.name.trim()) || catAdds.some(a => a.name.trim())

  async function save() {
    if (!data || !dirty) return
    setBusy('save'); setMsg(null)
    const rows = Object.entries(stockEdits).map(([k, v]) => {
      const sc = k.slice(0, k.lastIndexOf('|')), itemId = k.slice(k.lastIndexOf('|') + 1)
      const cur = data.items.find(i => i.id === itemId)?.per.find(p => p.scope === sc)
      return { itemId, scope: sc, onHand: v.onHand ?? cur?.onHand ?? 0, lowAt: v.lowAt ?? cur?.lowAt ?? 3 }
    })
    const items = Object.entries(itemEdits).map(([id, v]) => ({ id, name: v.name ?? data.items.find(i => i.id === id)?.name, ...v }))
    const newItems = [
      ...adds.filter(a => a.name.trim()).map(a => ({
        name: a.name, description: a.description, category: a.category, unit: a.unit,
        price: a.price === '' ? 0 : Number(a.price), cost: a.cost === '' ? null : Number(a.cost),
        reorderUrl: a.reorderUrl, scope, onHand: a.onHand === '' ? 0 : Number(a.onHand), trackStock: true,
      })),
      // From the Catalog: offered everywhere, not counted until someone starts counting on a shelf.
      ...catAdds.filter(a => a.name.trim()).map(a => ({
        name: a.name, description: a.description, category: a.category,
        price: a.price === '' ? 0 : Number(a.price), cost: a.cost === '' ? null : Number(a.cost),
        pieces: a.pieces === '' ? null : Number(a.pieces), pieceName: a.pieceName, trackStock: false,
      })),
    ]
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
          {(['catalog', 'stock'] as const).map(v => (
            <button key={v} onClick={() => setOwnView(v)} className={'px-3.5 py-1.5 rounded-lg text-[13px] font-semibold border ' + (view === v ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-brand-300')}>
              {v === 'stock' ? 'Stock' : 'Catalog'}
            </button>
          ))}
          <span className="text-[11.5px] text-muted ml-1">{view === 'stock' ? 'what is on each shelf' : 'every item — price, photo, where it is sold'}</span>
        </div>
      )}

      {view === 'stock' ? <CountLinkCard /> : null}

      {view === 'catalog' ? (
        <>
          <CatalogTable items={data.items} val={val} setItem={setItem} canEdit={canEdit} buildings={data.buildings} markets={data.markets || []} hubs={data.scopes.filter(s => s.id !== 'global').map(s => ({ id: s.id.replace(/^hub:/, ''), label: s.label }))}
            busy={busy} onUpload={uploadPhoto} onEditPhoto={setEditPhoto} onRemove={removeItem} adds={catAdds} setAdds={setCatAdds} openId={openCat} onOpen={setOpenCat} />
          {canEdit ? <div className="flex justify-end"><button onClick={save} disabled={!dirty || busy === 'save'} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">{busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save changes</button></div> : null}
        </>
      ) : null}

      <div className={'flex flex-wrap items-center gap-2 ' + (view === 'catalog' ? 'hidden' : '')}>
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
          {canEdit ? <button onClick={save} disabled={!dirty || busy === 'save'} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">{busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save changes</button> : null}
        </div>
      </div>

      {view === 'catalog' ? null : scope === 'global' ? (
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

      {(view === 'catalog' ? [] : adds).map((a, ai) => (
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

      <div className={'rounded-2xl border border-line bg-white overflow-hidden ' + (view === 'catalog' ? 'hidden' : '')}>
        <div className="px-4 py-2.5 bg-app/60 border-b border-line flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12.5px] font-semibold text-ink flex items-center gap-1.5"><Package size={14} /> {here ? here.label : 'Shelf'} · {rows.length} item{rows.length === 1 ? '' : 's'}</div>
          <div className="text-[11.5px] text-muted">Counts only. Prices, photos, descriptions and where an item is sold live on the <button onClick={() => { if (onSwitchView) onSwitchView('catalog'); else setOwnView('catalog') }} className="font-semibold text-brand-700 hover:underline">Catalog</button>.</div>
        </div>

        {rows.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-muted">Nothing here{onlyLow ? ' needs restocking right now.' : ' yet — use Add item.'}</div> : (
          <div className="divide-y divide-line/60">
            {rows.map(({ i, p }) => {
              const onHand = stockEdits[scope + '|' + i.id]?.onHand ?? p.onHand
              const lowAt = stockEdits[scope + '|' + i.id]?.lowAt ?? p.lowAt
              const avail = Math.max(0, onHand - p.reserved)
              const tracked = (val(i, 'tracked') as boolean) ?? i.tracked
              const state = !tracked ? 'untracked' : avail <= 0 ? 'out' : avail <= lowAt ? 'low' : 'ok'
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
                        <button onClick={() => goCatalog(i.id)} className="text-left text-[14px] font-semibold text-ink hover:text-brand-700">{String(val(i, 'name') ?? i.name)}</button>
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
                      <button onClick={() => goCatalog(i.id)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 h-9 rounded-lg border border-line bg-white text-ink hover:border-brand-300 self-end" title="Price, photo, description, where it is sold">
                        <Pencil size={12} /> Edit item
                      </button>
                    </div>
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

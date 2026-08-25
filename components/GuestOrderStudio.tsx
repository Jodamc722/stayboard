'use client'
// DESIGN STUDIO — the guest form, live, in a phone frame, editable in place (Jon, 2026-08-24:
// "from the form add and edit design, update feature, add photos, review the sheet").
//
// Left: which property/hub you are looking at, the look & copy, and Save. Middle: the REAL
// GuestOrderForm rendered from the unsaved editor state, so what you see is what ships. Tap any
// card → the item drawer on the right (name, price, photo, where it is offered, stock per hub).
// Nothing reaches the database until Save.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Save, Eye, Trash2, ImagePlus, X, Plus, AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { GuestOrderForm, type FormData, type FormItem } from '@/components/GuestOrderForm'

type Scope = { enabled?: boolean; orderByHoursBefore?: number; leadHours?: number; sameDayCutoffHour?: number }
type Hub = { id: string; label: string; buildings: string[] }
type Cfg = { enabled: boolean; taxPct: number; formTitle: string; formIntro: string; brandLine: string; accentColor: string; footerNote: string; hubs: Hub[]; hubRules: Record<string, Scope>; [k: string]: any }
type Item = { id?: string; sku: string; name: string; description: string | null; price_usd: number; unit_label: string | null; category: string | null; fee_code: string; max_qty: number; sort: number; active: boolean; buildings: string[] | null; markets: string[] | null; hubs: string[] | null; image_url: string | null; track_stock: boolean; _new?: boolean }
type StockRow = { item_id: string; scope: string; on_hand: number; reserved: number; low_at: number }
type Bldg = { label: string; market: string; vendor: boolean }
type Server = { data: FormData; building: string; market: string; hub: string | null; config: Cfg; catalog: Item[]; stock: StockRow[]; buildings: Bldg[]; markets: string[] }

const FEES = ['GUEST_SERVICE', 'BEVERAGE', 'FOOD', 'BREAKFAST', 'MEAL', 'MINIBAR', 'TOWELS', 'LINENS', 'TOILETRIES', 'BABY_BED', 'ADDITIONAL_BED', 'EQUIPMENT_RENTAL', 'LAUNDRY', 'PARKING', 'CONCIERGE', 'GIFT_BASKET', 'MISCELLANEOUS']
const box = 'rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] w-full bg-white'

/** Same scoping as lib/guest-orders loadCatalog, on the UNSAVED editor state. */
function previewCatalog(items: Item[], stock: StockRow[], building: string, market: string, hubId: string | null): FormItem[] {
  const b = building.toLowerCase(), m = market.toLowerCase(), hb = (hubId || '').toLowerCase()
  const has = (list: string[] | null, v: string) => !!list && list.length > 0 && list.some(x => x.toLowerCase() === v)
  const scopedItem = (r: Item) => !!((r.buildings && r.buildings.length) || (r.markets && r.markets.length) || (r.hubs && r.hubs.length))
  const scoped = items.filter(r => r.active && (!(r.buildings && r.buildings.length) || has(r.buildings, b)) && (!(r.hubs && r.hubs.length) || has(r.hubs, hb)) && (!(r.markets && r.markets.length) || has(r.markets, m)))
  const specific: Record<string, boolean> = {}
  for (const r of scoped) if (scopedItem(r)) specific[r.name.trim().toLowerCase()] = true
  const scope = hb ? 'hub:' + hb : 'global'
  return scoped.filter(r => scopedItem(r) || !specific[r.name.trim().toLowerCase()]).sort((a, c) => a.sort - c.sort || a.name.localeCompare(c.name)).flatMap(r => {
    let available: number | null = null
    if (r.track_stock && r.id) {
      const row = stock.find(s => s.item_id === r.id && s.scope === scope) || stock.find(s => s.item_id === r.id && s.scope === 'global')
      available = row ? Math.max(0, row.on_hand - row.reserved) : 0
      if (available <= 0) return []
    }
    return [{ id: r.id, sku: r.sku, name: r.name, description: r.description, price: r.price_usd, unit: r.unit_label, category: r.category || 'Extras', maxQty: available !== null ? Math.min(r.max_qty, available) : r.max_qty, image: r.image_url, fewLeft: available !== null && available <= 3 ? available : null }]
  })
}

export function GuestOrderStudio({ canEdit, isOwner }: { canEdit: boolean; isOwner: boolean }) {
  const [srv, setSrv] = useState<Server | null>(null)
  const [err, setErr] = useState('')
  const [building, setBuilding] = useState('')
  const [inHouse, setInHouse] = useState(false)
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [deleted, setDeleted] = useState<string[]>([])
  const [dirtyStock, setDirtyStock] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState('')
  const [sel, setSel] = useState<string | null>(null)   // sku being edited
  const [copyField, setCopyField] = useState<'title' | 'intro' | 'brand' | 'footer' | null>(null)
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async (b?: string, ih?: boolean) => {
    try {
      const qs = new URLSearchParams(); if (b) qs.set('building', b); if (ih) qs.set('inHouse', '1')
      const r = await fetch('/api/guest-orders/preview?' + qs.toString(), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || j.message || 'Could not load'); return }
      setSrv(j); setBuilding(j.building); setCfg(j.config); setItems(j.catalog); setStock(j.stock); setDeleted([]); setDirtyStock({})
      setSaved(JSON.stringify({ c: j.config, k: j.catalog }))
    } catch { setErr('Network error') }
  }, [])
  useEffect(() => { load() }, [load])

  const market = useMemo(() => srv ? (srv.buildings.find(b => b.label === building)?.market || srv.market) : '', [srv, building])
  const hub = useMemo(() => cfg ? cfg.hubs.find(h => h.buildings.some(x => x.toLowerCase() === building.toLowerCase())) || null : null, [cfg, building])
  const preview: FormData | null = useMemo(() => {
    if (!srv || !cfg) return null
    return {
      ...srv.data,
      stay: { ...srv.data.stay, unit: building + ' 406', building, inHouse },
      copy: { title: cfg.formTitle, intro: cfg.formIntro, taxPct: cfg.taxPct, brand: cfg.brandLine, accent: cfg.accentColor, footer: cfg.footerNote },
      catalog: previewCatalog(items, stock, building, market, hub ? hub.id : null),
    }
  }, [srv, cfg, items, stock, building, market, hub, inHouse])
  const dirty = cfg ? JSON.stringify({ c: cfg, k: items }) !== saved || deleted.length > 0 || Object.keys(dirtyStock).length > 0 : false
  const cur = items.find(i => i.sku === sel) || null
  const setItem = (patch: Partial<Item>) => setItems(k => k.map(i => i.sku === sel ? { ...i, ...patch } : i))
  const setC = (patch: Partial<Cfg>) => setCfg(c => c ? { ...c, ...patch } : c)
  const toggleIn = (list: string[] | null, v: string): string[] | null => { const c = list || []; const n = c.indexOf(v) >= 0 ? c.filter(x => x !== v) : [...c, v]; return n.length ? n : null }

  function addItem(category: string) {
    const cat = category || window.prompt('New category name (e.g. Drinks, Snacks, Comfort)') || ''
    if (!cat) return
    const sku = 'item-' + Date.now().toString(36)
    setItems(k => [...k, { sku, name: 'New item', description: '', price_usd: 10, unit_label: '', category: cat, fee_code: 'GUEST_SERVICE', max_qty: 10, sort: (k.length + 1) * 10, active: true, buildings: null, markets: null, hubs: null, image_url: null, track_stock: false, _new: true }])
    setSel(sku); setCopyField(null)
  }
  function removeItem() {
    if (!cur) return
    if (!window.confirm('Remove "' + cur.name + '" from the catalog?')) return
    if (cur.id) setDeleted(d => [...d, cur.id as string])
    setItems(k => k.filter(i => i.sku !== cur.sku)); setSel(null)
  }
  function stockFor(itemId: string | undefined, scope: string): StockRow {
    return (itemId && stock.find(s => s.item_id === itemId && s.scope === scope)) || { item_id: itemId || '', scope, on_hand: 0, reserved: 0, low_at: 3 }
  }
  function setStockRow(itemId: string, scope: string, patch: Partial<StockRow>) {
    setStock(s => { const i = s.findIndex(r => r.item_id === itemId && r.scope === scope); const row = { ...stockFor(itemId, scope), ...patch }; return i >= 0 ? s.map((r, idx) => idx === i ? row : r) : [...s, row] })
    setDirtyStock(d => ({ ...d, [itemId + '|' + scope]: true }))
  }

  async function uploadPhoto(file: File) {
    if (!cur) return
    setBusy('photo'); setMsg(null)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('sku', cur.sku)
      const r = await fetch('/api/settings/guest-orders/photo', { method: 'POST', body: fd })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j?.error || 'Upload failed')
      setItem({ image_url: j.url })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  async function save() {
    if (!cfg) return
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/guest-orders', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg, catalog: items.map(({ _new, ...rest }) => rest), deleteIds: deleted }) })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not save.')
      // stock rows need the ids the save just minted for new items
      const savedCatalog: Item[] = j.catalog || items
      const rows = Object.keys(dirtyStock).map(k => { const [itemId, scope] = k.split('|'); const row = stock.find(s => s.item_id === itemId && s.scope === scope); return row ? { itemId, scope, onHand: row.on_hand, lowAt: row.low_at } : null }).filter(Boolean)
      if (rows.length) {
        const r2 = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) })
        const j2 = await r2.json(); if (!r2.ok || !j2.ok) throw new Error((j2.errors || []).join(', ') || 'Stock save failed')
      }
      setMsg({ tone: 'ok', text: 'Saved — this is what guests see now.' })
      const keepSel = sel
      await load(building, inHouse)
      // a new item gets a real id from the server; keep it selected by sku
      setSel(savedCatalog.find(i => i.sku === keepSel) ? keepSel : null)
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  if (err) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>
  if (!srv || !cfg || !preview) return <div className="text-sm text-muted py-8 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading the studio…</div>
  const ro = !canEdit || !isOwner
  const scopesForStock = [{ id: 'global', label: 'Global shelf' }, ...cfg.hubs.map(h => ({ id: 'hub:' + h.id, label: h.label }))]
  const hiddenOut = items.filter(i => i.active && i.track_stock && !preview.catalog.some(c => c.sku === i.sku) && previewCatalog([{ ...i, track_stock: false }], [], building, market, hub ? hub.id : null).length).map(i => i.name)

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px] lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* LEFT — scope, look & copy, save */}
      <div className="space-y-3">
        {ro ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">Read-only: saving the catalog and look needs the owner account.</div> : null}
        <div className="rounded-2xl border border-line bg-white p-3.5 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Previewing as a guest at</div>
          <select value={building} onChange={e => { setBuilding(e.target.value) }} className={box}>
            {srv.buildings.map(b => <option key={b.label} value={b.label}>{b.label} · {b.market}</option>)}
          </select>
          <div className="text-[11.5px] text-muted">{hub ? 'Hub: ' + hub.label : 'No hub — uses the global shelf'} · timing: {preview.deadline.hoursBefore}h before / {preview.deadline.leadHours}h lead</div>
          <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={inHouse} onChange={e => setInHouse(e.target.checked)} /> Guest is already in-house</label>
          <div className="flex gap-2">
            <button onClick={() => setReview(r => !r)} className="flex-1 inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white hover:border-brand-300"><Eye size={13} /> {review ? 'Close sheet' : 'Review the sheet'}</button>
            <button onClick={() => load(building, inHouse)} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] px-2.5 py-1.5 rounded-lg border border-line bg-white" title="Reload from saved"><RefreshCw size={13} /></button>
          </div>
          {hiddenOut.length ? <div className="text-[11.5px] text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5 flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> Hidden here — out of stock: {hiddenOut.join(', ')}</div> : null}
        </div>

        <div className="rounded-2xl border border-line bg-white p-3.5 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Look & copy <span className="normal-case font-normal">— or tap the text on the phone</span></div>
          <input value={cfg.brandLine} onChange={e => setC({ brandLine: e.target.value })} className={box + (copyField === 'brand' ? ' ring-2 ring-ink' : '')} placeholder="Brand line" disabled={ro} />
          <input value={cfg.formTitle} onChange={e => setC({ formTitle: e.target.value })} className={box + ' font-semibold' + (copyField === 'title' ? ' ring-2 ring-ink' : '')} placeholder="Headline (guest's name is added)" disabled={ro} />
          <textarea value={cfg.formIntro} onChange={e => setC({ formIntro: e.target.value })} rows={3} className={box + (copyField === 'intro' ? ' ring-2 ring-ink' : '')} placeholder="Intro" disabled={ro} />
          <input value={cfg.footerNote} onChange={e => setC({ footerNote: e.target.value })} className={box + (copyField === 'footer' ? ' ring-2 ring-ink' : '')} placeholder="Footer note" disabled={ro} />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[12.5px] text-muted"><input type="color" value={cfg.accentColor} onChange={e => setC({ accentColor: e.target.value })} className="h-8 w-10 rounded border border-line p-0.5" disabled={ro} /> Button colour</label>
            <label className="flex items-center gap-1.5 text-[12.5px] text-muted">Tax <input type="number" min={0} max={30} step={0.5} value={cfg.taxPct} onChange={e => setC({ taxPct: Number(e.target.value) })} className={box + ' max-w-[70px]'} disabled={ro} />%</label>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={save} disabled={ro || busy === 'save' || !dirty} className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-xl bg-ink text-white disabled:opacity-50">{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save{dirty ? ' changes' : 'd'}</button>
          {msg ? <span className={'text-[12.5px] ' + (msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700')}>{msg.tone === 'ok' ? <Check size={12} className="inline mr-1" /> : <AlertTriangle size={12} className="inline mr-1" />}{msg.text}</span> : null}
        </div>
        <p className="text-[11px] text-muted">Hubs, timing per property, charge mode and the Guesty field live in <a href="/users" className="underline">App settings → Guest orders</a>. Stock counts live on the <a href="/guest-orders?tab=stock" className="underline">Stock tab</a> too.</p>
      </div>

      {/* MIDDLE — the phone */}
      <div className="flex justify-center">
        <div className="relative w-[390px] max-w-full h-[780px] rounded-[40px] border-[10px] border-neutral-900 bg-neutral-900 shadow-[0_30px_60px_-20px_rgba(0,0,0,.5)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-6 flex justify-center z-50 pointer-events-none"><div className="w-28 h-5 bg-neutral-900 rounded-b-2xl" /></div>
          <div className="absolute inset-0 overflow-y-auto overscroll-contain bg-[#FBF7F0] rounded-[30px]">
            <GuestOrderForm data={preview} frame reviewOpen={review} onReviewChange={setReview}
              edit={ro ? undefined : { selectedSku: sel, onItem: it => { setSel(it.sku); setCopyField(null) }, onAdd: addItem, onCopy: f => { setCopyField(f); setSel(null) } }} />
          </div>
        </div>
      </div>

      {/* RIGHT — item drawer (slides over on narrower screens, sits in its own column on wide ones) */}
      <div className="xl:col-span-1">
        {cur ? (
          <div className="fixed inset-y-0 right-0 z-40 w-[380px] max-w-full overflow-y-auto bg-white border-l border-line shadow-lifted p-4 space-y-3 xl:static xl:inset-auto xl:w-auto xl:max-w-none xl:overflow-visible xl:rounded-2xl xl:border xl:shadow-none xl:sticky xl:top-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">{cur._new ? 'New item' : 'Edit item'}</div>
              <button onClick={() => setSel(null)} className="text-muted hover:text-ink"><X size={16} /></button>
            </div>
            <div className="flex gap-3">
              <label className={'relative block w-24 h-24 rounded-2xl overflow-hidden border border-line bg-app flex-shrink-0 ' + (ro ? '' : 'cursor-pointer hover:border-brand-300')} title="Photo">
                {cur.image_url ? <img src={cur.image_url} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex flex-col items-center justify-center text-muted text-[11px] gap-1">{busy === 'photo' ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={18} />}Add photo</span>}
                {!ro ? <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files && e.target.files[0]; if (f) uploadPhoto(f); e.target.value = '' }} /> : null}
              </label>
              <div className="flex-1 space-y-2">
                <input value={cur.name} onChange={e => setItem({ name: e.target.value })} className={box + ' font-semibold'} placeholder="Name" disabled={ro} />
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 text-[12px] text-muted">$<input type="number" min={0} step={0.5} value={cur.price_usd} onChange={e => setItem({ price_usd: Number(e.target.value) })} className={box + ' w-20'} disabled={ro} /></label>
                  <input value={cur.unit_label || ''} onChange={e => setItem({ unit_label: e.target.value })} className={box} placeholder="case of 12" disabled={ro} />
                </div>
                {cur.image_url && !ro ? <button onClick={() => setItem({ image_url: null })} className="text-[11px] text-muted hover:text-rose-600">remove photo</button> : null}
              </div>
            </div>
            <textarea value={cur.description || ''} onChange={e => setItem({ description: e.target.value })} rows={2} className={box} placeholder="One line the guest reads" disabled={ro} />
            <div className="grid grid-cols-2 gap-2">
              <input value={cur.category || ''} onChange={e => setItem({ category: e.target.value })} className={box} placeholder="Category" list="go-cats" disabled={ro} />
              <datalist id="go-cats">{Array.from(new Set(items.map(i => i.category).filter(Boolean))).map(c => <option key={c as string} value={c as string} />)}</datalist>
              <select value={FEES.indexOf(cur.fee_code) >= 0 ? cur.fee_code : 'GUEST_SERVICE'} onChange={e => setItem({ fee_code: e.target.value })} className={box} disabled={ro}>{FEES.map(f => <option key={f} value={f}>{f}</option>)}</select>
              <label className="flex items-center gap-1.5 text-[12px] text-muted">Max<input type="number" min={1} max={99} value={cur.max_qty} onChange={e => setItem({ max_qty: Number(e.target.value) })} className={box} disabled={ro} /></label>
              <label className="flex items-center gap-1.5 text-[12px] text-muted">Order<input type="number" value={cur.sort} onChange={e => setItem({ sort: Number(e.target.value) })} className={box} disabled={ro} /></label>
            </div>
            <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={cur.active} onChange={e => setItem({ active: e.target.checked })} disabled={ro} /> Live on the form</label>

            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">Offered in <span className="normal-case font-normal">(nothing = everywhere)</span></div>
              {cfg.hubs.length ? <div className="flex flex-wrap gap-1 mb-1.5">{cfg.hubs.map(h => <button key={h.id} type="button" onClick={() => setItem({ hubs: toggleIn(cur.hubs, h.id) })} disabled={ro} className={'px-2 py-0.5 rounded-full border text-[11.5px] ' + ((cur.hubs || []).indexOf(h.id) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line')}>⌂ {h.label}</button>)}</div> : null}
              <div className="flex flex-wrap gap-1 mb-1.5">{srv.markets.map(m => <button key={m} type="button" onClick={() => setItem({ markets: toggleIn(cur.markets, m) })} disabled={ro} className={'px-2 py-0.5 rounded-full border text-[11.5px] ' + ((cur.markets || []).indexOf(m) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line')}>{m}</button>)}</div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">{srv.buildings.map(b => <button key={b.label} type="button" onClick={() => setItem({ buildings: toggleIn(cur.buildings, b.label) })} disabled={ro} className={'px-2 py-0.5 rounded-full border text-[11px] ' + ((cur.buildings || []).indexOf(b.label) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line')}>{b.label}</button>)}</div>
              <div className="text-[11px] text-muted mt-1">A scoped item replaces the general item with the same name there — duplicate to price a building differently.</div>
              {!ro ? <button type="button" onClick={() => { const copy = { ...cur, id: undefined, sku: cur.sku + '-' + Date.now().toString(36).slice(-3), _new: true, buildings: [building], hubs: null, markets: null }; setItems(k => [...k, copy]); setSel(copy.sku) }} className="mt-1 text-[12px] font-semibold text-brand-700">Duplicate for {building}</button> : null}
            </div>

            <div>
              <label className="flex items-center gap-2 text-[12.5px] font-semibold"><input type="checkbox" checked={cur.track_stock} onChange={e => setItem({ track_stock: e.target.checked })} disabled={ro} /> Track stock <span className="font-normal text-muted">— out of stock hides it from guests</span></label>
              {cur.track_stock ? (
                cur.id ? (
                  <table className="w-full text-[12px] mt-2">
                    <thead><tr className="text-[10.5px] uppercase tracking-wide text-muted text-left"><th className="py-1">Shelf</th><th className="py-1 w-16">On hand</th><th className="py-1 w-14">Held</th><th className="py-1 w-14">Low at</th></tr></thead>
                    <tbody>{scopesForStock.map(sc => { const r = stockFor(cur.id, sc.id); const avail = Math.max(0, r.on_hand - r.reserved); return (
                      <tr key={sc.id} className="border-t border-line/60">
                        <td className="py-1">{sc.label} <span className={'text-[10.5px] font-semibold ' + (avail <= 0 ? 'text-rose-700' : avail <= r.low_at ? 'text-amber-700' : 'text-emerald-700')}>{avail <= 0 ? 'OUT' : avail <= r.low_at ? 'LOW' : avail + ' free'}</span></td>
                        <td className="py-1"><input type="number" min={0} value={r.on_hand} onChange={e => setStockRow(cur.id as string, sc.id, { on_hand: Number(e.target.value) })} className={box} disabled={ro} /></td>
                        <td className="py-1 tabular-nums text-muted">{r.reserved}</td>
                        <td className="py-1"><input type="number" min={0} value={r.low_at} onChange={e => setStockRow(cur.id as string, sc.id, { low_at: Number(e.target.value) })} className={box} disabled={ro} /></td>
                      </tr>) })}</tbody>
                  </table>
                ) : <div className="text-[11.5px] text-muted mt-1">Save first, then set the counts.</div>
              ) : null}
            </div>

            {!ro ? <button onClick={removeItem} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-rose-600"><Trash2 size={12} /> Remove item</button> : null}
          </div>
        ) : (
          <div className="hidden xl:block rounded-2xl border border-dashed border-line bg-white p-5 text-[13px] text-muted sticky top-4">
            <div className="font-semibold text-ink mb-1">Tap a card on the phone to edit it.</div>
            Name, price, photo, where it is offered, and stock per hub. Tap the headline or intro to edit the copy. Use <b>+ Add item</b> under any category to add one.
            {!ro ? <button onClick={() => addItem('')} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white hover:border-brand-300"><Plus size={13} /> New item</button> : null}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'
// GUEST ORDERS — settings + catalog (Jon, 2026-08-24). Every number in the timing rule, the Guesty
// custom field name, the charge mode, and the vending-machine catalog itself live here.
// SAFE BY DEFAULT: enabled:false until the owner flips it, like every other automation.
import { useCallback, useEffect, useState } from 'react'
import { ShoppingBag, Loader2, Save, Plus, Trash2, Check, AlertTriangle, ImagePlus, X } from 'lucide-react'

type Scope = { enabled?: boolean; orderByHoursBefore?: number; leadHours?: number; sameDayCutoffHour?: number; taxPct?: number }
type Cfg = {
  enabled: boolean; createDaysBefore: number; customFieldName: string; orderByHoursBefore: number; leadHours: number; sameDayCutoffHour: number
  checkInHour: number; taxPct: number; chargeMode: 'auto' | 'manual'; emailRecipients: string[]; publicBase: string; formTitle: string; formIntro: string; brandLine: string; accentColor: string; footerNote: string; skipSourcesRe: string
  marketRules: Record<string, Scope>; buildingRules: Record<string, Scope>
  hubs: Hub[]; hubRules: Record<string, Scope>
}
type Hub = { id: string; label: string; buildings: string[]; listings: string[] }
type Listing = { id: string; name: string; building: string; market: string }
type HubStock = { itemId: string; sku: string; name: string; onHand: number; reserved: number; lowAt: number; available: number; state: string }
type Item = { id?: string; sku: string; name: string; description: string | null; price_usd: number; unit_label: string | null; category: string | null; fee_code: string; max_qty: number; sort: number; active: boolean; buildings: string[] | null; markets: string[] | null; hubs?: string[] | null; image_url: string | null; track_stock?: boolean }
type Bldg = { label: string; market: string; vendor: boolean }

const FEES = ['GUEST_SERVICE', 'BEVERAGE', 'FOOD', 'BREAKFAST', 'MEAL', 'MINIBAR', 'TOWELS', 'LINENS', 'TOILETRIES', 'BABY_BED', 'ADDITIONAL_BED', 'EQUIPMENT_RENTAL', 'LAUNDRY', 'PARKING', 'CONCIERGE', 'GIFT_BASKET', 'MISCELLANEOUS']

export function GuestOrdersAdmin({ isOwner }: { isOwner: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [catalog, setCatalog] = useState<Item[]>([])
  const [deleted, setDeleted] = useState<string[]>([])
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [probe, setProbe] = useState<any | null>(null)
  const [probeRes, setProbeRes] = useState('')
  const [buildings, setBuildings] = useState<Bldg[]>([])
  const [markets, setMarkets] = useState<string[]>(['Miami', 'Broward', 'North'])
  const [scopeOpen, setScopeOpen] = useState<number | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [unitOpen, setUnitOpen] = useState<number | null>(null)   // hub index whose unit picker is open
  const [unitQ, setUnitQ] = useState('')
  const [stock, setStock] = useState<Record<string, HubStock[]>>({})   // scope -> rows
  const [stockEdits, setStockEdits] = useState<Record<string, { onHand?: number; lowAt?: number }>>({})

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/guest-orders', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && j.config) { setCfg(j.config); setCatalog(j.catalog || []); setSaved(JSON.stringify({ c: j.config, k: j.catalog })); setBuildings(j.buildings || []); setListings(j.listings || []); if (Array.isArray(j.markets) && j.markets.length) setMarkets(j.markets) }
    } catch { /* stays empty */ }
  }, [])
  useEffect(() => { load() }, [load])

  // THE COUNTS LIVE INSIDE THE HUB (Jon, 2026-08-25). One read of the stock endpoint, re-shaped
  // scope-first so each hub card can show and edit its own shelf without a second request.
  const loadStock = useCallback(async () => {
    try {
      const j = await fetch('/api/guest-orders/stock', { cache: 'no-store' }).then(r => r.json())
      if (!j?.ok) return
      const by: Record<string, HubStock[]> = {}
      for (const sc of (j.scopes || [])) {
        by[sc.id] = (j.items || []).map((it: any) => {
          const p = (it.per || []).find((x: any) => x.scope === sc.id) || { onHand: 0, reserved: 0, lowAt: 3, available: 0, state: 'unset' }
          return { itemId: it.id, sku: it.sku, name: it.name, onHand: p.onHand, reserved: p.reserved, lowAt: p.lowAt, available: p.available, state: p.state }
        })
      }
      setStock(by); setStockEdits({})
    } catch { /* the hub card simply shows no shelf */ }
  }, [])
  useEffect(() => { loadStock() }, [loadStock])

  async function saveHubStock(scope: string) {
    const rows = Object.entries(stockEdits).filter(([k]) => k.startsWith(scope + '|')).map(([k, v]) => {
      const itemId = k.slice(scope.length + 1)
      const cur = (stock[scope] || []).find(r => r.itemId === itemId)
      return { itemId, scope, onHand: v.onHand ?? cur?.onHand ?? 0, lowAt: v.lowAt ?? cur?.lowAt ?? 3 }
    })
    if (!rows.length) return
    setBusy('stock:' + scope)
    try {
      const j = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) }).then(r => r.json())
      setMsg(j?.ok ? { tone: 'ok', text: 'Counted ' + rows.length + ' item' + (rows.length === 1 ? '' : 's') } : { tone: 'bad', text: j?.error || 'Could not save the count' })
      await loadStock()
    } catch { setMsg({ tone: 'bad', text: 'Network error' }) } finally { setBusy(null) }
  }

  const set = (patch: Partial<Cfg>) => setCfg(c => c ? { ...c, ...patch } : c)
  const setScope = (kind: 'marketRules' | 'buildingRules' | 'hubRules', key: string, patch: Scope) => setCfg(c => {
    if (!c) return c
    const cur = { ...(c[kind][key] || {}), ...patch }
    for (const k of Object.keys(cur) as (keyof Scope)[]) if (cur[k] === undefined || (cur[k] as any) === '') delete cur[k]
    if (cur.enabled !== false) delete cur.enabled
    const next = { ...c[kind] }
    if (Object.keys(cur).length) next[key] = cur; else delete next[key]
    return { ...c, [kind]: next }
  })
  const toggleIn = (list: string[] | null, v: string): string[] | null => { const cur = list || []; const next = cur.indexOf(v) >= 0 ? cur.filter(x => x !== v) : [...cur, v]; return next.length ? next : null }
  const setItem = (i: number, patch: Partial<Item>) => setCatalog(k => k.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  const dirty = cfg ? JSON.stringify({ c: cfg, k: catalog }) !== saved || deleted.length > 0 : false

  async function save() {
    if (!cfg) return
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/guest-orders', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg, catalog, deleteIds: deleted }) })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not save.')
      setCfg(j.config || cfg); setCatalog(j.catalog || catalog); setDeleted([]); setSaved(JSON.stringify({ c: j.config || cfg, k: j.catalog || catalog }))
      setMsg({ tone: 'ok', text: (j.config || cfg).enabled ? 'Saved — links are created hourly for arrivals inside the window and paid orders push on their delivery day.' : 'Saved — automation stays OFF until you enable it. The board still works by hand.' })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }
  async function uploadPhoto(i: number, file: File) {
    setBusy('photo:' + i); setMsg(null)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('sku', catalog[i]?.sku || 'item')
      const r = await fetch('/api/settings/guest-orders/photo', { method: 'POST', body: fd })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j?.error || 'Upload failed')
      setItem(i, { image_url: j.url })
      setMsg({ tone: 'ok', text: 'Photo uploaded — press Save to keep it on the item.' })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }
  async function runProbe() {
    setBusy('probe'); setProbe(null)
    try {
      const r = await fetch('/api/guest-orders/probe' + (probeRes.trim() ? '?reservation=' + encodeURIComponent(probeRes.trim()) : ''), { cache: 'no-store' })
      setProbe(await r.json())
    } catch (e: any) { setProbe({ error: String(e?.message || e) }) } finally { setBusy(null) }
  }

  if (!cfg) return <p className="text-[12.5px] text-muted py-2"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Loading…</p>
  const box = 'rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] w-full'
  const ro = !isOwner

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center gap-2.5 flex-wrap">
        <ShoppingBag size={14} className={cfg.enabled ? 'text-emerald-600' : 'text-muted'} />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={e => set({ enabled: e.target.checked })} disabled={ro} />
          <span className="text-[13px] font-bold text-ink">Guest orders automation</span>
        </label>
        <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (cfg.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500')}>{cfg.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="text-[12px] text-muted -mt-2">
        <a href="/guest-orders/design" className="font-semibold text-brand-700 underline">Open the Design studio</a> to edit the form on a live phone preview — items, photos, copy, colours, stock. This card holds the plumbing.
        Hourly: every confirmed arrival within <b>{cfg.createDaysBefore} days</b> gets a private order link written into the Guesty reservation field
        <b> “{cfg.customFieldName}”</b> — add that field to your Guesty pre-arrival message and the guest receives it. A new order posts a notice to the
        CCS/ops Slack channel; approval happens on the <a href="/guest-orders" className="font-semibold text-brand-700 underline">Guest Orders board</a>
        {cfg.chargeMode === 'manual' ? ' (charge mode is manual: approve, collect, then Mark paid)' : ' (charge mode is auto: Approve charges the card Guesty holds)'}.
        Paid orders are pushed to Breezeway + Slack + email on their delivery day.
      </p>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Timing rule</div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Create link</span><input type="number" min={1} max={60} value={cfg.createDaysBefore} onChange={e => set({ createDaysBefore: Number(e.target.value) })} className={box + ' max-w-[70px]'} disabled={ro} /><span className="text-[12.5px] text-muted">days before arrival</span></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Order by</span><input type="number" min={0} max={240} value={cfg.orderByHoursBefore} onChange={e => set({ orderByHoursBefore: Number(e.target.value) })} className={box + ' max-w-[70px]'} disabled={ro} /><span className="text-[12.5px] text-muted">hours before check-in for arrival-day delivery</span></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Lead time after payment</span><input type="number" min={0} max={168} value={cfg.leadHours} onChange={e => set({ leadHours: Number(e.target.value) })} className={box + ' max-w-[70px]'} disabled={ro} /><span className="text-[12.5px] text-muted">hours</span></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Same-day if paid before</span><input type="number" min={0} max={23} value={cfg.sameDayCutoffHour} onChange={e => set({ sameDayCutoffHour: Number(e.target.value) })} className={box + ' max-w-[70px]'} disabled={ro} /><span className="text-[12.5px] text-muted">:00 ET (else next day)</span></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Default check-in hour</span><input type="number" min={0} max={23} value={cfg.checkInHour} onChange={e => set({ checkInHour: Number(e.target.value) })} className={box + ' max-w-[70px]'} disabled={ro} /><span className="text-[12.5px] text-muted">:00 (listing time wins when set)</span></div>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Money & Guesty</div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Charge mode</span>
            <select value={cfg.chargeMode} onChange={e => set({ chargeMode: e.target.value as any })} className={box + ' max-w-[220px]'} disabled={ro}>
              <option value="auto">Auto — charge the card in Guesty on approval</option>
              <option value="manual">Manual — approve, then mark paid by hand</option>
            </select></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Sales tax</span><input type="number" min={0} max={30} step={0.5} value={cfg.taxPct} onChange={e => set({ taxPct: Number(e.target.value) })} className={box + ' max-w-[70px]'} disabled={ro} /><span className="text-[12.5px] text-muted">% (0 = prices are all-in)</span></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Guesty custom field</span><input value={cfg.customFieldName} onChange={e => set({ customFieldName: e.target.value })} className={box + ' max-w-[220px]'} disabled={ro} /></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Email on push</span><input value={cfg.emailRecipients.join(', ')} onChange={e => set({ emailRecipients: e.target.value.split(/[,\s]+/).filter(Boolean) })} className={box} placeholder="a@…, b@…" disabled={ro} /></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Public base URL</span><input value={cfg.publicBase} onChange={e => set({ publicBase: e.target.value })} className={box} disabled={ro} /></div>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted w-44">Skip sources (regex)</span><input value={cfg.skipSourcesRe} onChange={e => set({ skipSourcesRe: e.target.value })} className={box} disabled={ro} /></div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Guest-facing copy</div>
        <div className="grid sm:grid-cols-3 gap-2">
          <input value={cfg.brandLine} onChange={e => set({ brandLine: e.target.value })} className={box} placeholder="Brand line (top of the page)" disabled={ro} />
          <label className="flex items-center gap-2 text-[12.5px] text-muted"><input type="color" value={cfg.accentColor} onChange={e => set({ accentColor: e.target.value })} className="h-8 w-10 rounded border border-line p-0.5" disabled={ro} /> Button colour <span className="font-mono text-[11px]">{cfg.accentColor}</span></label>
        </div>
        <input value={cfg.formTitle} onChange={e => set({ formTitle: e.target.value })} className={box + ' font-semibold'} placeholder="Headline (guest's first name is added)" disabled={ro} />
        <textarea value={cfg.formIntro} onChange={e => set({ formIntro: e.target.value })} rows={2} className={box} placeholder="Intro paragraph" disabled={ro} />
        <input value={cfg.footerNote} onChange={e => set({ footerNote: e.target.value })} className={box} placeholder="Footer note (payment / contact line)" disabled={ro} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Catalog · {catalog.filter(c => c.active).length} live</div>
          {!ro ? <button onClick={() => setCatalog(k => [...k, { sku: '', name: '', description: '', price_usd: 0, unit_label: '', category: 'Extras', fee_code: 'GUEST_SERVICE', max_qty: 10, sort: (k.length + 1) * 10, active: true, buildings: null, markets: null, hubs: null, image_url: null, track_stock: false }])} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line bg-white hover:border-brand-300"><Plus size={12} /> Add item</button> : null}
        </div>
        <div className="rounded-xl border border-line overflow-x-auto">
          <table className="w-full text-[12px] min-w-[1000px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted bg-app/60"><th className="px-2 py-1.5 w-8">On</th><th className="px-2 py-1.5 w-16">Photo</th><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Description</th><th className="px-2 py-1.5 w-20">Price</th><th className="px-2 py-1.5 w-24">Unit</th><th className="px-2 py-1.5 w-24">Category</th><th className="px-2 py-1.5 w-36">Guesty fee</th><th className="px-2 py-1.5 w-14">Max</th><th className="px-2 py-1.5 w-40">Offered in</th><th className="px-2 py-1.5 w-12" title="Track stock — out of stock hides the item">Stock</th><th className="px-2 py-1.5 w-8"></th></tr></thead>
            <tbody>
              {catalog.map((it, i) => (
                <tr key={it.id || 'new' + i} className="border-t border-line/60">
                  <td className="px-2 py-1"><input type="checkbox" checked={it.active} onChange={e => setItem(i, { active: e.target.checked })} disabled={ro} /></td>
                  <td className="px-2 py-1">
                    <label className={'relative block w-12 h-12 rounded-lg overflow-hidden border border-line bg-app ' + (ro ? '' : 'cursor-pointer hover:border-brand-300')} title={it.image_url ? 'Replace photo' : 'Add photo'}>
                      {it.image_url ? <img src={it.image_url} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center text-muted">{busy === 'photo:' + i ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}</span>}
                      {!ro ? <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files && e.target.files[0]; if (f) uploadPhoto(i, f); e.target.value = '' }} /> : null}
                    </label>
                    {it.image_url && !ro ? <button type="button" onClick={() => setItem(i, { image_url: null })} className="text-[10.5px] text-muted hover:text-rose-600 inline-flex items-center gap-0.5 mt-0.5"><X size={10} /> remove</button> : null}
                  </td>
                  <td className="px-2 py-1"><input value={it.name} onChange={e => setItem(i, { name: e.target.value })} className={box + ' font-semibold'} disabled={ro} /></td>
                  <td className="px-2 py-1"><input value={it.description || ''} onChange={e => setItem(i, { description: e.target.value })} className={box} disabled={ro} /></td>
                  <td className="px-2 py-1"><input type="number" min={0} step={0.5} value={it.price_usd} onChange={e => setItem(i, { price_usd: Number(e.target.value) })} className={box} disabled={ro} /></td>
                  <td className="px-2 py-1"><input value={it.unit_label || ''} onChange={e => setItem(i, { unit_label: e.target.value })} className={box} placeholder="case of 12" disabled={ro} /></td>
                  <td className="px-2 py-1"><input value={it.category || ''} onChange={e => setItem(i, { category: e.target.value })} className={box} placeholder="Drinks" disabled={ro} /></td>
                  <td className="px-2 py-1"><select value={FEES.indexOf(it.fee_code) >= 0 ? it.fee_code : 'GUEST_SERVICE'} onChange={e => setItem(i, { fee_code: e.target.value })} className={box} disabled={ro}>{FEES.map(f => <option key={f} value={f}>{f}</option>)}</select></td>
                  <td className="px-2 py-1"><input type="number" min={1} max={99} value={it.max_qty} onChange={e => setItem(i, { max_qty: Number(e.target.value) })} className={box} disabled={ro} /></td>
                  <td className="px-2 py-1 relative">
                    <button type="button" onClick={() => setScopeOpen(scopeOpen === i ? null : i)} className={box + ' text-left truncate ' + ((it.buildings && it.buildings.length) || (it.markets && it.markets.length) ? 'text-brand-700 font-semibold' : 'text-muted')} disabled={ro} title={[...(it.markets || []), ...(it.buildings || [])].join(', ')}>
                      {(it.hubs && it.hubs.length) || (it.markets && it.markets.length) || (it.buildings && it.buildings.length) ? [...(it.hubs || []).map(h => '⌂ ' + (cfg.hubs.find(x => x.id === h)?.label || h)), ...(it.markets || []), ...(it.buildings || [])].join(', ') : 'Everywhere'}
                    </button>
                    {scopeOpen === i ? (
                      <div className="absolute z-20 right-0 mt-1 w-72 rounded-xl border border-line bg-white shadow-lifted p-3 text-[12px]">
                        <div className="flex items-center justify-between mb-1.5"><span className="font-semibold text-ink">Where this item is offered</span><button onClick={() => setScopeOpen(null)} className="text-muted">Done</button></div>
                        {cfg.hubs.length ? <><div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold mb-1">Hubs</div>
                        <div className="flex flex-wrap gap-1 mb-2">{cfg.hubs.map(h => <button key={h.id} type="button" onClick={() => setItem(i, { hubs: toggleIn(it.hubs || null, h.id) })} className={'px-2 py-0.5 rounded-full border ' + ((it.hubs || []).indexOf(h.id) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink')}>⌂ {h.label}</button>)}</div></> : null}
                        <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold mb-1">Locations</div>
                        <div className="flex flex-wrap gap-1 mb-2">{markets.map(m => <button key={m} type="button" onClick={() => setItem(i, { markets: toggleIn(it.markets, m) })} className={'px-2 py-0.5 rounded-full border ' + ((it.markets || []).indexOf(m) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink')}>{m}</button>)}</div>
                        <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold mb-1">Buildings</div>
                        <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">{buildings.map(b => <button key={b.label} type="button" onClick={() => setItem(i, { buildings: toggleIn(it.buildings, b.label) })} className={'px-2 py-0.5 rounded-full border ' + ((it.buildings || []).indexOf(b.label) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink')}>{b.label}</button>)}</div>
                        <div className="text-[11px] text-muted mt-2">Nothing selected = everywhere. A building- or location-specific item <b>replaces</b> the general item with the same name there — duplicate an item, pick a building, change the price.</div>
                        <button type="button" onClick={() => { setCatalog(k => { const copy = { ...it, id: undefined, sku: it.sku + '-' + (k.length + 1), buildings: it.buildings, markets: it.markets }; return [...k.slice(0, i + 1), copy, ...k.slice(i + 1)] }); setScopeOpen(null) }} className="mt-2 text-[12px] font-semibold text-brand-700">Duplicate this item</button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1"><input type="checkbox" checked={!!it.track_stock} onChange={e => setItem(i, { track_stock: e.target.checked })} disabled={ro} /></td>
                  <td className="px-2 py-1">{!ro ? <button onClick={() => { if (it.id) setDeleted(d => [...d, it.id as string]); setCatalog(k => k.filter((_, idx) => idx !== i)) }} className="text-muted hover:text-rose-600" title="Remove"><Trash2 size={13} /></button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted mt-1.5">Guesty fee = the predefined fee type on the folio line (drives Guesty’s tax math). “Offered in” scopes an item to locations or buildings; a scoped item replaces the general one with the same name, which is how prices differ per building.</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Location hubs · {cfg.hubs.length}</div>
          {!ro ? <button onClick={() => set({ hubs: [...cfg.hubs, { id: 'hub-' + Date.now().toString(36), label: 'New hub', buildings: [], listings: [] }] })} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line bg-white hover:border-brand-300"><Plus size={12} /> Add hub</button> : null}
        </div>
        <p className="text-[12px] text-muted mb-2">A hub is where supplies physically sit — <b>a group of listings or whole properties that share one shelf</b>. Add a property to take all of its units, or pick individual units. <b>A unit named directly wins over its property</b>, so one apartment can sit on a different shelf than the rest of its building. Counts are kept per hub right here, and <b>an item at zero disappears from the guest form</b>. Anything outside every hub uses the global shelf.</p>
        {cfg.hubs.length === 0 ? <div className="text-[12px] text-muted rounded-xl border border-dashed border-line px-3 py-3">No hubs yet — everything counts against one global shelf.</div> : (
          <div className="space-y-2">
            {cfg.hubs.map((h, hi) => (
              <div key={h.id} className="rounded-xl border border-line bg-white p-3">
                <div className="flex items-center gap-2">
                  <input value={h.label} onChange={e => set({ hubs: cfg.hubs.map((x, i) => i === hi ? { ...x, label: e.target.value } : x) })} className={box + ' font-semibold max-w-[240px]'} disabled={ro} />
                  <span className="text-[11px] text-muted font-mono">{h.id}</span>
                  {!ro ? <button onClick={() => set({ hubs: cfg.hubs.filter((_, i) => i !== hi) })} className="ml-auto text-muted hover:text-rose-600" title="Remove hub"><Trash2 size={13} /></button> : null}
                </div>
                <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold mt-2.5">Whole properties</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {buildings.map(b => { const on = h.buildings.indexOf(b.label) >= 0; const elsewhere = !on && cfg.hubs.some((o, oi) => oi !== hi && o.buildings.indexOf(b.label) >= 0); return (
                    <button key={b.label} type="button" disabled={ro || elsewhere} title={elsewhere ? 'already in another hub' : ''} onClick={() => set({ hubs: cfg.hubs.map((x, i) => i === hi ? { ...x, buildings: on ? x.buildings.filter(y => y !== b.label) : [...x.buildings, b.label] } : x) })} className={'px-2 py-0.5 rounded-full border text-[11.5px] ' + (on ? 'bg-ink text-white border-ink' : elsewhere ? 'bg-app text-muted border-line opacity-50' : 'bg-white border-line text-ink')}>{b.label}</button>) })}
                </div>

                <div className="flex items-center gap-2 mt-2.5">
                  <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">Individual units · {(h.listings || []).length}</div>
                  {!ro ? <button type="button" onClick={() => { setUnitOpen(unitOpen === hi ? null : hi); setUnitQ('') }} className="text-[11.5px] font-semibold text-brand-700 hover:underline">{unitOpen === hi ? 'done' : '+ pick units'}</button> : null}
                </div>
                {(h.listings || []).length ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(h.listings || []).map(id => { const u = listings.find(x => x.id === id); return (
                      <button key={id} type="button" disabled={ro} onClick={() => set({ hubs: cfg.hubs.map((x, i) => i === hi ? { ...x, listings: x.listings.filter(y => y !== id) } : x) })} className="px-2 py-0.5 rounded-full border border-ink bg-ink text-white text-[11.5px] inline-flex items-center gap-1" title="Remove from this hub">{u ? u.name : id.slice(0, 8)} <X size={10} /></button>) })}
                  </div>
                ) : <div className="text-[11.5px] text-muted mt-1">None — this hub covers whole properties only.</div>}

                {unitOpen === hi ? (
                  <div className="mt-2 rounded-lg border border-line bg-app/40 p-2">
                    <input value={unitQ} onChange={e => setUnitQ(e.target.value)} placeholder="Search units by name or building…" className={box + ' mb-2'} />
                    <div className="max-h-52 overflow-y-auto space-y-0.5">
                      {listings.filter(u => !unitQ || (u.name + ' ' + u.building).toLowerCase().indexOf(unitQ.toLowerCase()) >= 0).slice(0, 120).map(u => {
                        const on = (h.listings || []).indexOf(u.id) >= 0
                        const elsewhere = !on && cfg.hubs.some((o, oi) => oi !== hi && (o.listings || []).indexOf(u.id) >= 0)
                        const viaBuilding = !on && h.buildings.indexOf(u.building) >= 0
                        return (
                          <button key={u.id} type="button" disabled={elsewhere} title={elsewhere ? 'already in another hub' : viaBuilding ? 'already included via its property' : ''}
                            onClick={() => set({ hubs: cfg.hubs.map((x, i) => i === hi ? { ...x, listings: on ? x.listings.filter(y => y !== u.id) : [...(x.listings || []), u.id] } : x) })}
                            className={'w-full text-left px-2 py-1 rounded text-[12px] flex items-center gap-2 ' + (on ? 'bg-ink text-white' : elsewhere ? 'text-muted opacity-50' : 'hover:bg-white text-ink')}>
                            <span className="flex-1 truncate">{u.name}</span>
                            <span className={'text-[10.5px] ' + (on ? 'text-white/70' : 'text-muted')}>{u.building || u.market}{viaBuilding ? ' · via property' : ''}</span>
                          </button>
                        )
                      })}
                      {listings.length === 0 ? <div className="text-[12px] text-muted px-1 py-2">No listings loaded.</div> : null}
                    </div>
                  </div>
                ) : null}

                {(stock['hub:' + h.id] || []).length ? (
                  <div className="mt-3 rounded-lg border border-line overflow-hidden">
                    <div className="px-2 py-1.5 bg-app/60 text-[10.5px] uppercase tracking-wide text-muted font-semibold flex items-center justify-between">
                      <span>What is on this shelf</span>
                      {!ro ? <button type="button" onClick={() => saveHubStock('hub:' + h.id)} disabled={busy === 'stock:hub:' + h.id || !Object.keys(stockEdits).some(k => k.startsWith('hub:' + h.id + '|'))} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border border-line bg-white disabled:opacity-40">{busy === 'stock:hub:' + h.id ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save count</button> : null}
                    </div>
                    <table className="w-full text-[12px]">
                      <thead><tr className="text-left text-[10px] uppercase tracking-wide text-muted"><th className="px-2 py-1">Item</th><th className="px-2 py-1 w-20">On hand</th><th className="px-2 py-1 w-16">Held</th><th className="px-2 py-1 w-20">Warn at</th><th className="px-2 py-1 w-24">Guest sees</th></tr></thead>
                      <tbody>
                        {(stock['hub:' + h.id] || []).map(rw => {
                          const k = 'hub:' + h.id + '|' + rw.itemId
                          const onHand = stockEdits[k]?.onHand ?? rw.onHand
                          const lowAt = stockEdits[k]?.lowAt ?? rw.lowAt
                          const avail = Math.max(0, onHand - rw.reserved)
                          return (
                            <tr key={rw.itemId} className="border-t border-line/60">
                              <td className="px-2 py-1 text-ink">{rw.name}</td>
                              <td className="px-2 py-1"><input type="number" min={0} value={onHand} disabled={ro} onChange={e => setStockEdits(x => ({ ...x, [k]: { ...x[k], onHand: Number(e.target.value) } }))} className="w-16 text-[12px] px-1.5 py-0.5 rounded border border-line" /></td>
                              <td className="px-2 py-1 text-muted tabular-nums">{rw.reserved || 0}</td>
                              <td className="px-2 py-1"><input type="number" min={0} value={lowAt} disabled={ro} onChange={e => setStockEdits(x => ({ ...x, [k]: { ...x[k], lowAt: Number(e.target.value) } }))} className="w-14 text-[12px] px-1.5 py-0.5 rounded border border-line" /></td>
                              <td className={'px-2 py-1 font-semibold ' + (avail <= 0 ? 'text-rose-700' : avail <= lowAt ? 'text-amber-700' : 'text-emerald-700')}>{avail <= 0 ? 'hidden — 0 left' : avail + ' left'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="text-[11.5px] text-muted mt-2">No stock-tracked items yet — tick <b>Stock</b> on an item below to count it here.</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">By location, hub & building</div>
        <p className="text-[12px] text-muted mb-2">Switch the whole program off somewhere, or give a location / hub / building its own timing and <b>sales tax</b>. Blank = inherit. <b>Building beats hub beats location beats default</b> — so one building can stay on inside a location that is switched off, which is how you pilot a single property.</p>
        <div className="rounded-xl border border-line overflow-x-auto">
          <table className="w-full text-[12px] min-w-[640px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted bg-app/60"><th className="px-2 py-1.5">Scope</th><th className="px-2 py-1.5 w-20">Offered</th><th className="px-2 py-1.5 w-32">Order by (h before)</th><th className="px-2 py-1.5 w-32">Lead (h after pay)</th><th className="px-2 py-1.5 w-32">Same-day before (h)</th><th className="px-2 py-1.5 w-24">Sales tax %</th></tr></thead>
            <tbody>
              {markets.map(m => {
                const r = cfg.marketRules[m] || {}
                return (
                  <tr key={'m:' + m} className="border-t border-line/60 bg-brand-50/30">
                    <td className="px-2 py-1 font-bold text-ink">{m} <span className="text-[10.5px] text-muted font-normal">location</span></td>
                    <td className="px-2 py-1"><input type="checkbox" checked={r.enabled !== false} onChange={e => setScope('marketRules', m, { enabled: e.target.checked ? undefined : false })} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={240} value={r.orderByHoursBefore ?? ''} placeholder={String(cfg.orderByHoursBefore)} onChange={e => setScope('marketRules', m, { orderByHoursBefore: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={168} value={r.leadHours ?? ''} placeholder={String(cfg.leadHours)} onChange={e => setScope('marketRules', m, { leadHours: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={23} value={r.sameDayCutoffHour ?? ''} placeholder={String(cfg.sameDayCutoffHour)} onChange={e => setScope('marketRules', m, { sameDayCutoffHour: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={30} step="0.001" value={r.taxPct ?? ''} placeholder={String(cfg.taxPct)} onChange={e => setScope('marketRules', m, { taxPct: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                  </tr>
                )
              })}
              {cfg.hubs.map(h => {
                const r = cfg.hubRules[h.id] || {}
                return (
                  <tr key={'h:' + h.id} className="border-t border-line/60 bg-emerald-50/30">
                    <td className="px-2 py-1 font-semibold text-ink">⌂ {h.label} <span className="text-[10.5px] text-muted font-normal">hub · {h.buildings.length} bldg</span></td>
                    <td className="px-2 py-1"><input type="checkbox" checked={r.enabled !== false} onChange={e => setScope('hubRules', h.id, { enabled: e.target.checked ? undefined : false })} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={240} value={r.orderByHoursBefore ?? ''} placeholder={String(cfg.orderByHoursBefore)} onChange={e => setScope('hubRules', h.id, { orderByHoursBefore: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={168} value={r.leadHours ?? ''} placeholder={String(cfg.leadHours)} onChange={e => setScope('hubRules', h.id, { leadHours: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={23} value={r.sameDayCutoffHour ?? ''} placeholder={String(cfg.sameDayCutoffHour)} onChange={e => setScope('hubRules', h.id, { sameDayCutoffHour: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={30} step="0.001" value={r.taxPct ?? ''} placeholder={String(cfg.taxPct)} onChange={e => setScope('hubRules', h.id, { taxPct: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                  </tr>
                )
              })}
              {buildings.map(b => {
                const r = cfg.buildingRules[b.label] || {}
                const mr = cfg.marketRules[b.market] || {}
                const marketOff = mr.enabled === false
                const inherited = !marketOff                       // what this building does with no rule of its own
                const on = r.enabled !== undefined ? r.enabled : inherited
                const overriding = r.enabled !== undefined && r.enabled !== inherited
                return (
                  <tr key={'b:' + b.label} className={'border-t border-line/60 ' + (on ? '' : 'opacity-50')}>
                    <td className="px-2 py-1 text-ink">{b.label} <span className="text-[10.5px] text-muted">{b.market}{b.vendor ? ' · vendor' : ''}</span>{overriding ? <span className="ml-1 text-[10px] font-semibold text-emerald-700">override</span> : null}</td>
                    <td className="px-2 py-1"><input type="checkbox" checked={on} onChange={e => setScope('buildingRules', b.label, { enabled: e.target.checked === inherited ? undefined : e.target.checked })} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={240} value={r.orderByHoursBefore ?? ''} placeholder={String(mr.orderByHoursBefore ?? cfg.orderByHoursBefore)} onChange={e => setScope('buildingRules', b.label, { orderByHoursBefore: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={168} value={r.leadHours ?? ''} placeholder={String(mr.leadHours ?? cfg.leadHours)} onChange={e => setScope('buildingRules', b.label, { leadHours: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={23} value={r.sameDayCutoffHour ?? ''} placeholder={String(mr.sameDayCutoffHour ?? cfg.sameDayCutoffHour)} onChange={e => setScope('buildingRules', b.label, { sameDayCutoffHour: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                    <td className="px-2 py-1"><input type="number" min={0} max={30} step="0.001" value={r.taxPct ?? ''} placeholder={String(mr.taxPct ?? cfg.taxPct)} onChange={e => setScope('buildingRules', b.label, { taxPct: e.target.value === '' ? undefined : Number(e.target.value) })} className={box} disabled={ro} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {!ro ? <button onClick={save} disabled={busy === 'save' || !dirty} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-50">{busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button> : <span className="text-[12px] text-muted">Owner only</span>}
        {msg ? <span className={'text-[12.5px] ' + (msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700')}>{msg.tone === 'ok' ? <Check size={12} className="inline mr-1" /> : <AlertTriangle size={12} className="inline mr-1" />}{msg.text}</span> : null}
      </div>

      <div className="rounded-xl border border-line bg-app/40 p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1.5">Check Guesty before the first order</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={probeRes} onChange={e => setProbeRes(e.target.value)} placeholder="Guesty reservation id (optional)" className={box + ' max-w-[280px]'} />
          <button onClick={runProbe} disabled={busy === 'probe' || ro} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white disabled:opacity-50">{busy === 'probe' ? <Loader2 size={13} className="animate-spin" /> : null} Check</button>
        </div>
        {probe ? (
          <div className="mt-2 text-[12px] text-ink space-y-1">
            <div>Custom field “{probe.customField?.name}”: {probe.customField?.id ? <span className="text-emerald-700">found (id {probe.customField.id})</span> : <span className="text-rose-700">NOT found — create a Reservation custom field with that exact name in Guesty</span>}</div>
            {probe.reservation ? <div>{probe.reservation.unit} · {probe.reservation.guest} · {probe.reservation.source}: {probe.paymentMethodsError ? <span className="text-rose-700">{probe.paymentMethodsError}</span> : probe.wouldCharge ? <span className="text-emerald-700">would charge {probe.wouldCharge.brand || 'card'} •••• {probe.wouldCharge.last4 || '????'}</span> : <span className="text-amber-700">no chargeable card — orders go to “awaiting payment”</span>}</div> : probe.error ? <div className="text-rose-700">{probe.error}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

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
import { Package, Loader2, Save, ExternalLink, ImagePlus, AlertTriangle, Search, ShoppingCart, Check, Plus, Trash2, ChevronDown, ChevronRight, X } from 'lucide-react'

type Per = { scope: string; label: string; onHand: number; reserved: number; lowAt: number; available: number; state: 'unset' | 'out' | 'low' | 'ok' | 'untracked'; updatedAt: string | null; updatedBy: string | null }
type Item = {
  id: string; sku: string; name: string; category: string | null; image: string | null; active: boolean; tracked: boolean
  hubs: string[] | null; buildings: string[] | null; per: Per[]
  description: string | null; unit: string | null; maxQty: number
  price: number; cost: number | null; reorderUrl: string | null; supplier: string | null; packNote: string | null
}
type Scope = { id: string; label: string }
type Data = { scopes: Scope[]; items: Item[]; untracked: number }
type NewItem = { key: string; name: string; description: string; category: string; unit: string; price: string; cost: string; onHand: string; reorderUrl: string }

const money = (n: number | null | undefined) => n === null || n === undefined ? '—' : '$' + (Math.round(n * 100) / 100).toFixed(2)
const box = 'text-[12.5px] px-2 py-1.5 rounded-lg border border-line bg-white text-ink focus:outline-none focus:border-brand-300'

export function InventoryBoard({ canEdit }: { canEdit: boolean }) {
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
      const j = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [], items: [{ id: item.id, name: item.name, imageUrl: up.url }] }) }).then(r => r.json())
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {data.scopes.map(s => (
            <button key={s.id} onClick={() => setScope(s.id)} className={'px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ' + (scope === s.id ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-brand-300')}>
              {s.id === 'global' ? 'Global shelf' : s.label}
            </button>
          ))}
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

      {scope === 'global' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 flex gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>This is the fallback shelf for any property not in a hub. If it reads zero, those properties show an <b>empty order form</b> — put the property in a hub, or count it here.</div>
        </div>
      ) : null}

      {adds.map((a, ai) => (
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

      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-app/60 border-b border-line flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12.5px] font-semibold text-ink flex items-center gap-1.5"><Package size={14} /> {here ? here.label : 'Shelf'} · {rows.length} item{rows.length === 1 ? '' : 's'}</div>
          <div className="text-[11.5px] text-muted">Tap a row to edit its name, description and photo.</div>
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
              const margin = cost === null || cost === undefined || cost === '' ? null : price - Number(cost)
              const url = val(i, 'reorderUrl') as string | null
              const isOpen = !!open[i.id]
              const active = (val(i, 'active') as boolean) ?? i.active
              return (
                <div key={i.id} className={'px-4 py-3 ' + (state === 'out' ? 'bg-rose-50/40' : state === 'low' ? 'bg-amber-50/40' : '')}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="relative flex-shrink-0">
                      {i.image
                        ? <img src={i.image} alt="" className="w-14 h-14 rounded-xl object-cover border border-line" />
                        : <div className="w-14 h-14 rounded-xl border border-dashed border-line bg-app flex items-center justify-center text-muted"><ImagePlus size={16} /></div>}
                      {canEdit ? (
                        <label className="absolute inset-0 cursor-pointer rounded-xl hover:bg-ink/10 flex items-center justify-center" title={i.image ? 'Replace photo' : 'Add a photo for reference'}>
                          <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(i, f); e.currentTarget.value = '' }} />
                          {busy === 'photo:' + i.id ? <Loader2 size={14} className="animate-spin text-ink" /> : null}
                        </label>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))} className="text-muted hover:text-ink" title={isOpen ? 'Collapse' : 'Edit name, description, photo'}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                        <span className="text-[14px] font-semibold text-ink">{String(val(i, 'name') ?? i.name)}</span>
                        <span className={'text-[10.5px] font-bold px-1.5 py-0.5 rounded ' + (state === 'untracked' ? 'bg-app text-muted border border-line' : state === 'out' ? 'bg-rose-100 text-rose-700' : state === 'low' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700')}>
                          {state === 'untracked' ? 'not counted' : state === 'out' ? 'OUT — hidden from guests' : state === 'low' ? 'LOW · ' + avail + ' left' : avail + ' available'}
                        </span>
                        {!active ? <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-app text-muted border border-line">hidden from the form</span> : null}
                      </div>
                      <div className="text-[11.5px] text-muted mt-0.5 truncate">
                        {String(val(i, 'category') ?? '') || 'Extras'}{val(i, 'unit') ? ' · ' + val(i, 'unit') : ''}
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
                        canEdit ? <button onClick={() => setItem(i.id, { tracked: true } as any)} className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300">Start counting</button> : null
                      )}
                      <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Guest pays
                        <input type="number" min={0} step="0.01" value={price} disabled={!canEdit} onChange={e => setItem(i.id, { price: Number(e.target.value) } as any)} className={box + ' w-24 mt-0.5'} />
                      </label>
                      <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">We pay
                        <input type="number" min={0} step="0.01" value={cost ?? ''} placeholder="—" disabled={!canEdit} onChange={e => setItem(i.id, { cost: e.target.value === '' ? null : Number(e.target.value) } as any)} className={box + ' w-24 mt-0.5'} />
                      </label>
                      <div className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold min-w-[52px]">Margin
                        <div className={'text-[13px] font-bold tabular-nums mt-1 ' + (margin === null ? 'text-muted' : margin < 0 ? 'text-rose-700' : 'text-emerald-700')}>{margin === null ? '—' : money(margin)}</div>
                      </div>
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
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Unit
                          <input value={String(val(i, 'unit') ?? '')} disabled={!canEdit} placeholder="case of 12" onChange={e => setItem(i.id, { unit: e.target.value } as any)} className={box + ' w-36 mt-0.5'} />
                        </label>
                        <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Max per order
                          <input type="number" min={1} max={99} value={Number(val(i, 'maxQty') ?? 10)} disabled={!canEdit} onChange={e => setItem(i.id, { maxQty: Number(e.target.value) } as any)} className={box + ' w-24 mt-0.5'} />
                        </label>
                        <label className="flex items-center gap-1.5 text-[12px] text-ink self-end pb-1.5">
                          <input type="checkbox" checked={active} disabled={!canEdit} onChange={e => setItem(i.id, { active: e.target.checked } as any)} /> Show on the guest form
                        </label>
                      </div>
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

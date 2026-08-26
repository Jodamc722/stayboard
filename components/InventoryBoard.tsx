'use client'
// INVENTORY — one shelf at a time (Jon, 2026-08-25: "need to be edit by hub, adjust cost, have the
// order links for easy ordering… need an inventory section, be able to add photos of the items for
// reference").
//
// WHY THIS REPLACES THE OLD GRID: the Stock tab put every shelf side by side as a matrix. With two
// shelves that was already wide, and the Global column read OUT on every row — nine red badges
// about a shelf nobody stocks — while the things you actually need to restock were invisible. A
// person restocking is standing in ONE storeroom holding ONE list, so this shows one shelf, sorted
// with what needs attention first, and puts the buy-it-again link on the row.
//
// Everything on a row is editable where it is read: the count, the warn-at, the guest price, what
// we pay, and the link. Photos are there because a name like "Snack box" does not tell whoever is
// counting which box is meant.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, Loader2, Save, ExternalLink, ImagePlus, AlertTriangle, Search, ShoppingCart, Check } from 'lucide-react'

type Per = { scope: string; label: string; onHand: number; reserved: number; lowAt: number; available: number; state: 'unset' | 'out' | 'low' | 'ok'; updatedAt: string | null; updatedBy: string | null }
type Item = {
  id: string; sku: string; name: string; category: string | null; image: string | null; active: boolean
  hubs: string[] | null; buildings: string[] | null; per: Per[]
  price: number; cost: number | null; unit: string | null; reorderUrl: string | null; supplier: string | null; packNote: string | null
}
type Scope = { id: string; label: string }
type Data = { scopes: Scope[]; items: Item[]; untracked: number }

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

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/guest-orders/stock', { cache: 'no-store' }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not load inventory'); return }
      setData(j); setErr(''); setStockEdits({}); setItemEdits({})
      // Open on a real shelf, not the global one — the global shelf is the fallback for anything
      // outside a hub and is usually empty, which is a misleading first impression.
      setScope(s => s || (j.scopes.find((x: Scope) => x.id !== 'global')?.id ?? 'global'))
    } catch { setErr('Network error') }
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = Object.keys(stockEdits).length > 0 || Object.keys(itemEdits).length > 0

  async function save() {
    if (!data || !dirty) return
    setBusy('save')
    const rows = Object.entries(stockEdits).map(([k, v]) => {
      const [sc, itemId] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)]
      const cur = data.items.find(i => i.id === itemId)?.per.find(p => p.scope === sc)
      return { itemId, scope: sc, onHand: v.onHand ?? cur?.onHand ?? 0, lowAt: v.lowAt ?? cur?.lowAt ?? 3 }
    })
    const items = Object.entries(itemEdits).map(([id, v]) => ({ id, name: data.items.find(i => i.id === id)?.name, ...v }))
    try {
      const j = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, items }) }).then(r => r.json())
      if (j?.ok) setMsg({ tone: 'ok', text: 'Saved · ' + rows.length + ' count' + (rows.length === 1 ? '' : 's') + ', ' + items.length + ' item' + (items.length === 1 ? '' : 's') })
      else setMsg({ tone: 'bad', text: (j?.errors || []).join(' · ') || j?.error || 'Could not save' })
      await load()
    } catch { setMsg({ tone: 'bad', text: 'Network error' }) } finally { setBusy(null) }
  }

  async function uploadPhoto(item: Item, file: File) {
    setBusy('photo:' + item.id)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('sku', item.sku)
      const j = await fetch('/api/settings/guest-orders/photo', { method: 'POST', body: fd }).then(r => r.json())
      if (!j?.ok || !j.url) { setMsg({ tone: 'bad', text: j?.error || 'Could not upload that photo' }); return }
      const r = await fetch('/api/settings/guest-orders', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalog: [{ id: item.id, sku: item.sku, name: item.name, price_usd: item.price, image_url: j.url }] }) }).then(r => r.json())
      if (r?.ok) { setMsg({ tone: 'ok', text: 'Photo added to ' + item.name }); await load() }
      else setMsg({ tone: 'bad', text: r?.error || 'Photo uploaded but not attached' })
    } catch { setMsg({ tone: 'bad', text: 'Network error' }) } finally { setBusy(null) }
  }

  const rows = useMemo(() => {
    if (!data) return []
    const withPer = data.items.map(i => ({ i, p: i.per.find(x => x.scope === scope) }))
      .filter(x => !!x.p) as { i: Item; p: Per }[]
    const rank = (p: Per) => p.state === 'out' ? 0 : p.state === 'low' ? 1 : p.state === 'unset' ? 2 : 3
    return withPer
      .filter(x => !q || (x.i.name + ' ' + (x.i.category || '') + ' ' + (x.i.supplier || '')).toLowerCase().includes(q.toLowerCase()))
      .filter(x => !onlyLow || x.p.state === 'out' || x.p.state === 'low')
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i.name.localeCompare(b.i.name))
  }, [data, scope, q, onlyLow])

  const needs = useMemo(() => data ? data.items.map(i => i.per.find(p => p.scope === scope)).filter(p => p && (p.state === 'out' || p.state === 'low')).length : 0, [data, scope])

  if (err) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err}</div>
  if (!data) return <div className="text-sm text-muted py-8 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading inventory…</div>

  const here = data.scopes.find(s => s.id === scope)
  const val = (i: Item, k: keyof Item) => (itemEdits[i.id] && (itemEdits[i.id] as any)[k] !== undefined ? (itemEdits[i.id] as any)[k] : (i as any)[k])
  const setItem = (id: string, patch: Partial<Item>) => setItemEdits(x => ({ ...x, [id]: { ...x[id], ...patch } }))

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
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…" className="text-[12.5px] pl-7 pr-2 py-1.5 rounded-lg border border-line bg-white w-44" />
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink"><input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} /> Needs restocking{needs ? ' (' + needs + ')' : ''}</label>
          {canEdit ? <button onClick={save} disabled={!dirty || busy === 'save'} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40">{busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save changes</button> : null}
        </div>
      </div>

      {scope === 'global' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 flex gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>This is the fallback shelf for any property that is not in a hub. If it reads zero, those properties show an <b>empty order form</b> — put the property in a hub, or count it here.</div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-app/60 border-b border-line flex items-center justify-between">
          <div className="text-[12.5px] font-semibold text-ink flex items-center gap-1.5"><Package size={14} /> {here ? here.label : 'Shelf'} · {rows.length} item{rows.length === 1 ? '' : 's'}</div>
          {data.untracked ? <div className="text-[11.5px] text-muted">{data.untracked} item{data.untracked === 1 ? '' : 's'} not stock-tracked — tick <b>Stock</b> on them in the Design studio</div> : null}
        </div>

        {rows.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-muted">Nothing here{onlyLow ? ' needs restocking right now.' : ' yet.'}</div> : (
          <div className="divide-y divide-line/60">
            {rows.map(({ i, p }) => {
              const onHand = stockEdits[scope + '|' + i.id]?.onHand ?? p.onHand
              const lowAt = stockEdits[scope + '|' + i.id]?.lowAt ?? p.lowAt
              const avail = Math.max(0, onHand - p.reserved)
              const state = avail <= 0 ? 'out' : avail <= lowAt ? 'low' : 'ok'
              const price = Number(val(i, 'price') ?? 0)
              const cost = val(i, 'cost')
              const margin = cost === null || cost === undefined || cost === '' ? null : price - Number(cost)
              const url = val(i, 'reorderUrl') as string | null
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
                        <span className="text-[14px] font-semibold text-ink">{i.name}</span>
                        <span className={'text-[10.5px] font-bold px-1.5 py-0.5 rounded ' + (state === 'out' ? 'bg-rose-100 text-rose-700' : state === 'low' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700')}>
                          {state === 'out' ? 'OUT — hidden from guests' : state === 'low' ? 'LOW · ' + avail + ' left' : avail + ' available'}
                        </span>
                        {!i.active ? <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-app text-muted border border-line">off</span> : null}
                      </div>
                      <div className="text-[11.5px] text-muted mt-0.5">
                        {i.category || 'Extras'}{i.unit ? ' · ' + i.unit : ''}{p.reserved ? ' · ' + p.reserved + ' held for paid orders' : ''}
                        {p.updatedAt ? ' · counted ' + new Date(p.updatedAt).toLocaleDateString() + (p.updatedBy ? ' by ' + p.updatedBy.split('@')[0] : '') : ' · never counted'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-2 flex-shrink-0">
                      <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">On hand
                        <input type="number" min={0} value={onHand} disabled={!canEdit} onChange={e => setStockEdits(x => ({ ...x, [scope + '|' + i.id]: { ...x[scope + '|' + i.id], onHand: Number(e.target.value) } }))} className={box + ' w-20 mt-0.5'} />
                      </label>
                      <label className="flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold">Warn at
                        <input type="number" min={0} value={lowAt} disabled={!canEdit} onChange={e => setStockEdits(x => ({ ...x, [scope + '|' + i.id]: { ...x[scope + '|' + i.id], lowAt: Number(e.target.value) } }))} className={box + ' w-16 mt-0.5'} />
                      </label>
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

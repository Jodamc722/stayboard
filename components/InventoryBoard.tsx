'use client'
// INVENTORY — one shelf at a time.
//
// ── WHY THIS LOOKS DIFFERENT (Jon, 2026-08-26: "the visual is so bad, can we make it cleaner and
// easier to look at") ───────────────────────────────────────────────────────────────────────────
// The previous version put SEVEN open input boxes on every row — count, warn-at, guest price, our
// cost, reorder link, supplier, pack note — for every item, all the time. Twenty items meant a
// hundred and forty form fields on one screen. It was not a list you could read; it was a
// spreadsheet with the cursor everywhere at once, and the thing you came to find out (what is
// running out) was the hardest thing on it to see.
//
// So: READ FIRST, EDIT ON PURPOSE.
//   • A row is now a row — photo, name, one status pill, the count, the money. Aligned columns you
//     can scan down. Nothing is an input until you ask for it.
//   • The one number you change while physically counting a shelf — how many are on it — stays
//     directly editable with − / + steppers, because that is the whole job and making somebody
//     open a panel for it would be worse, not better.
//   • Everything else lives behind the row: click it and the details open underneath.
//   • What needs restocking is stated at the top as a sentence and sorted to the front, so the
//     answer arrives before the list does.
//
// ── AND YOU CAN NOW ADD THINGS (same message: "need to be able to edit the inventory, add a hub")
// A hub is a storeroom plus the properties it serves, and adding one used to mean going to the
// guest-orders design studio in settings and finding the right sub-tab. Both live here now: add a
// shelf, add an item to it. The APIs already existed; nothing about how they store changed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Package, Loader2, Save, ExternalLink, ImagePlus, AlertTriangle, Search, ShoppingCart, Check,
  Plus, ChevronDown, Minus, X, Warehouse,
} from 'lucide-react'

type Per = { scope: string; label: string; onHand: number; reserved: number; lowAt: number; available: number; state: 'unset' | 'out' | 'low' | 'ok'; updatedAt: string | null; updatedBy: string | null }
type Item = {
  id: string; sku: string; name: string; category: string | null; image: string | null; active: boolean
  hubs: string[] | null; buildings: string[] | null; per: Per[]
  price: number; cost: number | null; unit: string | null; reorderUrl: string | null; supplier: string | null; packNote: string | null
}
type Scope = { id: string; label: string }
type Data = { scopes: Scope[]; items: Item[]; untracked: number }

const money = (n: number | null | undefined) => n === null || n === undefined ? '—' : '$' + (Math.round(n * 100) / 100).toFixed(2)
const box = 'text-[12.5px] px-2 py-1.5 rounded-lg border border-line bg-white text-ink focus:outline-none focus:border-ink'

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
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<null | 'hub' | 'item'>(null)

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
    const items = Object.entries(itemEdits).map(([id, v]) => ({ id, ...v }))
    try {
      const r = await fetch('/api/guest-orders/stock', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, items }),
      })
      const j = await r.json()
      if (!r.ok || j?.error) throw new Error(j?.error || 'Save failed')
      setMsg({ tone: 'ok', text: 'Saved.' }); await load()
    } catch (e: any) { setMsg({ tone: 'bad', text: String(e?.message || e) }) }
    setBusy(null)
    setTimeout(() => setMsg(null), 3500)
  }

  async function uploadPhoto(i: Item, file: File) {
    setBusy('photo:' + i.id)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('itemId', i.id)
      const r = await fetch('/api/settings/guest-orders/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || j?.error) throw new Error(j?.error || 'Upload failed')
      await load()
    } catch (e: any) { setMsg({ tone: 'bad', text: String(e?.message || e) }) }
    setBusy(null)
  }

  const rows = useMemo(() => {
    if (!data) return [] as { i: Item; p: Per }[]
    const n = q.trim().toLowerCase()
    return data.items
      .map(i => ({ i, p: i.per.find(x => x.scope === scope) as Per }))
      .filter(x => !!x.p)
      .filter(x => !n || (x.i.name + ' ' + (x.i.category || '') + ' ' + x.i.sku).toLowerCase().includes(n))
      .filter(x => !onlyLow || x.p.state === 'out' || x.p.state === 'low')
      // Worst first — the point of the screen is what to buy, not alphabetical order.
      .sort((a, b) => {
        const rank = (s: string) => s === 'out' ? 0 : s === 'low' ? 1 : s === 'unset' ? 2 : 3
        return rank(a.p.state) - rank(b.p.state) || a.i.name.localeCompare(b.i.name)
      })
  }, [data, scope, q, onlyLow])

  const tally = useMemo(() => {
    if (!data) return { out: 0, low: 0, ok: 0 }
    let out = 0, low = 0, ok = 0
    for (const i of data.items) {
      const p = i.per.find(x => x.scope === scope)
      if (!p) continue
      if (p.state === 'out') out++; else if (p.state === 'low') low++; else ok++
    }
    return { out, low, ok }
  }, [data, scope])

  /** Per shelf, how many items need attention — so the switcher itself says where the problem is. */
  const needsByScope = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of (data?.scopes || [])) {
      m[s.id] = (data?.items || []).filter(i => {
        const p = i.per.find(x => x.scope === s.id)
        return p && (p.state === 'out' || p.state === 'low')
      }).length
    }
    return m
  }, [data])

  if (err) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err}</div>
  if (!data) return <div className="text-sm text-muted py-8 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading inventory&hellip;</div>

  const here = data.scopes.find(s => s.id === scope)
  const val = (i: Item, k: keyof Item) => (itemEdits[i.id] && (itemEdits[i.id] as any)[k] !== undefined ? (itemEdits[i.id] as any)[k] : (i as any)[k])
  const setItem = (id: string, patch: Partial<Item>) => setItemEdits(x => ({ ...x, [id]: { ...x[id], ...patch } }))
  const setStock = (id: string, patch: { onHand?: number; lowAt?: number }) =>
    setStockEdits(x => ({ ...x, [scope + '|' + id]: { ...x[scope + '|' + id], ...patch } }))

  return (
    <div className="space-y-3">
      {msg ? <div className={'rounded-xl px-3 py-2 text-[12.5px] ' + (msg.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200')}>{msg.text}</div> : null}

      {/* ── SHELVES. The switcher carries each shelf's problem count, so you can see where to go
          before you go there. ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Warehouse size={14} className="text-muted shrink-0" />
        {data.scopes.map(s => {
          const n = needsByScope[s.id] || 0
          const on = scope === s.id
          return (
            <button key={s.id} onClick={() => { setScope(s.id); setOpen(null) }}
              className={'px-3 py-1.5 rounded-full text-[12.5px] font-bold border inline-flex items-center gap-1.5 ' + (on ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>
              {s.id === 'global' ? 'Global shelf' : s.label}
              {n > 0 && <span className={'text-[10px] font-bold px-1.5 rounded-full ' + (on ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700')}>{n}</span>}
            </button>
          )
        })}
        {canEdit && (
          <button onClick={() => setAdding('hub')}
            className="px-2.5 py-1.5 rounded-full text-[12px] font-bold border border-dashed border-line text-muted hover:text-ink hover:border-ink/40 inline-flex items-center gap-1">
            <Plus size={12} /> Add a shelf
          </button>
        )}
      </div>

      {/* ── THE ANSWER, BEFORE THE LIST. ── */}
      <div className="rounded-2xl border border-line bg-white px-4 py-3 flex items-center gap-3 flex-wrap">
        <Package size={16} className="text-muted shrink-0" />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-ink">
            {tally.out + tally.low === 0
              ? 'Nothing needs restocking on ' + (here ? here.label : 'this shelf') + '.'
              : (tally.out ? tally.out + ' out of stock' : '') + (tally.out && tally.low ? ' · ' : '') + (tally.low ? tally.low + ' running low' : '')}
          </p>
          <p className="text-[11.5px] text-muted mt-0.5">
            {here ? here.label : 'Shelf'} &middot; {tally.out + tally.low + tally.ok} tracked item{tally.out + tally.low + tally.ok === 1 ? '' : 's'}
            {data.untracked ? ' · ' + data.untracked + ' not stock-tracked' : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item&hellip;"
              className="text-[12.5px] pl-7 pr-2 py-1.5 rounded-xl border border-line bg-white w-40 focus:outline-none focus:border-ink" />
          </div>
          {(tally.out + tally.low) > 0 && (
            <button onClick={() => setOnlyLow(v => !v)}
              className={'px-2.5 py-1.5 rounded-xl border text-[12px] font-bold ' + (onlyLow ? 'bg-ink border-ink text-white' : 'bg-white border-line text-muted hover:text-ink')}>
              {onlyLow ? 'Showing what to buy' : 'Just what to buy'}
            </button>
          )}
          {canEdit && (
            <button onClick={() => setAdding('item')}
              className="px-2.5 py-1.5 rounded-xl border border-line bg-white text-[12px] font-bold text-ink hover:border-ink/40 inline-flex items-center gap-1">
              <Plus size={12} /> Add item
            </button>
          )}
        </div>
      </div>

      {scope === 'global' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 flex gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>The fallback shelf for any property not in a hub. If it reads zero, those properties show an <b>empty order form</b> &mdash; put the property in a shelf, or count it here.</div>
        </div>
      )}

      {/* ── THE LIST ── */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted">Nothing here{onlyLow ? ' needs restocking right now.' : ' yet.'}</div>
        ) : (
          <div className="divide-y divide-line">
            {rows.map(({ i, p }) => {
              const onHand = stockEdits[scope + '|' + i.id]?.onHand ?? p.onHand
              const lowAt = stockEdits[scope + '|' + i.id]?.lowAt ?? p.lowAt
              const avail = Math.max(0, onHand - p.reserved)
              const state = avail <= 0 ? 'out' : avail <= lowAt ? 'low' : 'ok'
              const price = Number(val(i, 'price') ?? 0)
              const cost = val(i, 'cost')
              const margin = cost === null || cost === undefined || cost === '' ? null : price - Number(cost)
              const url = val(i, 'reorderUrl') as string | null
              const isOpen = open === i.id
              return (
                <div key={i.id}>
                  {/* A ROW YOU READ. One pill, one count, one money column, aligned. */}
                  <div className="px-3 py-2.5 flex items-center gap-3 hover:bg-app/40 cursor-pointer"
                    onClick={() => setOpen(isOpen ? null : i.id)}>
                    <div className="relative shrink-0">
                      {i.image
                        ? <img src={i.image} alt="" className="w-11 h-11 rounded-xl object-cover border border-line" />
                        : <div className="w-11 h-11 rounded-xl border border-dashed border-line bg-app flex items-center justify-center text-muted"><ImagePlus size={15} /></div>}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-bold text-ink truncate">{i.name}</span>
                        {!i.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-app text-muted border border-line">off</span>}
                      </div>
                      <div className="text-[11px] text-muted truncate">
                        {i.category || 'Extras'}{i.unit ? ' · ' + i.unit : ''}
                        {p.reserved ? ' · ' + p.reserved + ' held for paid orders' : ''}
                      </div>
                    </div>

                    <span className={'text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0 ' +
                      (state === 'out' ? 'bg-rose-100 text-rose-700' : state === 'low' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700')}>
                      {state === 'out' ? 'Out' : state === 'low' ? 'Low' : 'In stock'}
                    </span>

                    {/* The count stays live — it is the thing you are here to change. */}
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <button disabled={!canEdit || onHand <= 0} onClick={() => setStock(i.id, { onHand: Math.max(0, onHand - 1) })}
                        className="w-7 h-7 rounded-lg border border-line bg-white text-muted hover:text-ink disabled:opacity-30 inline-flex items-center justify-center"><Minus size={12} /></button>
                      <input type="number" min={0} value={onHand} disabled={!canEdit}
                        onChange={e => setStock(i.id, { onHand: Math.max(0, Number(e.target.value)) })}
                        className="w-14 text-center text-[13.5px] font-bold tabular-nums px-1 py-1 rounded-lg border border-line bg-white focus:outline-none focus:border-ink" />
                      <button disabled={!canEdit} onClick={() => setStock(i.id, { onHand: onHand + 1 })}
                        className="w-7 h-7 rounded-lg border border-line bg-white text-muted hover:text-ink disabled:opacity-30 inline-flex items-center justify-center"><Plus size={12} /></button>
                    </div>

                    <div className="hidden sm:block text-right shrink-0 w-24">
                      <div className="text-[13px] font-bold text-ink tabular-nums">{money(price)}</div>
                      <div className={'text-[10.5px] tabular-nums ' + (margin === null ? 'text-muted' : margin < 0 ? 'text-rose-600 font-bold' : 'text-muted')}>
                        {margin === null ? 'cost not set' : money(margin) + ' margin'}
                      </div>
                    </div>

                    <ChevronDown size={14} className={'text-muted shrink-0 transition-transform ' + (isOpen ? 'rotate-180' : '')} />
                  </div>

                  {/* EVERYTHING ELSE, ON PURPOSE. */}
                  {isOpen && (
                    <div className="px-3 pb-3 pt-1 bg-app/40" onClick={e => e.stopPropagation()}>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold">Warn at
                          <input type="number" min={0} value={lowAt} disabled={!canEdit}
                            onChange={e => setStock(i.id, { lowAt: Number(e.target.value) })} className={box + ' w-20 mt-0.5'} />
                        </label>
                        <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold">Guest pays
                          <input type="number" min={0} step="0.01" value={price} disabled={!canEdit}
                            onChange={e => setItem(i.id, { price: Number(e.target.value) } as any)} className={box + ' w-24 mt-0.5'} />
                        </label>
                        <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold">We pay
                          <input type="number" min={0} step="0.01" value={cost ?? ''} placeholder="—" disabled={!canEdit}
                            onChange={e => setItem(i.id, { cost: e.target.value === '' ? null : Number(e.target.value) } as any)} className={box + ' w-24 mt-0.5'} />
                        </label>
                        <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold">Supplier
                          <input value={(val(i, 'supplier') as string) || ''} disabled={!canEdit}
                            onChange={e => setItem(i.id, { supplier: e.target.value } as any)} className={box + ' w-32 mt-0.5'} />
                        </label>
                        <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold">Arrives as
                          <input value={(val(i, 'packNote') as string) || ''} disabled={!canEdit} placeholder="case of 24&hellip;"
                            onChange={e => setItem(i.id, { packNote: e.target.value } as any)} className={box + ' w-36 mt-0.5'} />
                        </label>
                        {canEdit && (
                          <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold cursor-pointer">Photo
                            <span className={box + ' mt-0.5 inline-flex items-center gap-1.5 text-muted'}>
                              {busy === 'photo:' + i.id ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                              {i.image ? 'Replace' : 'Add'}
                            </span>
                            <input type="file" accept="image/*" className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(i, f); e.currentTarget.value = '' }} />
                          </label>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input value={(url as string) || ''} disabled={!canEdit}
                          onChange={e => setItem(i.id, { reorderUrl: e.target.value } as any)}
                          placeholder="Where to buy it again — paste the link" className={box + ' flex-1 min-w-[220px]'} />
                        {url && /^https?:\/\//i.test(String(url))
                          ? <a href={String(url)} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700"><ShoppingCart size={12} /> Order <ExternalLink size={11} /></a>
                          : <span className="text-[11.5px] text-muted">no order link yet</span>}
                      </div>
                      <p className="text-[11px] text-muted mt-2">
                        {p.updatedAt
                          ? 'Last counted ' + new Date(p.updatedAt).toLocaleDateString() + (p.updatedBy ? ' by ' + p.updatedBy.split('@')[0] : '')
                          : 'Never counted on this shelf.'}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {canEdit && dirty && (
        <div className="sticky bottom-3 flex justify-end">
          <button onClick={save} disabled={busy === 'save'}
            className="inline-flex items-center gap-2 text-[13px] font-bold px-4 py-2.5 rounded-xl bg-ink text-white shadow-lg disabled:opacity-50">
            {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save changes
          </button>
        </div>
      )}

      {adding && <AddSheet kind={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); load() }} scopeLabel={here ? here.label : ''} scopeId={scope} />}
    </div>
  )
}

// ── ADD A SHELF, OR AN ITEM ─────────────────────────────────────────────────────────────────────
// Both write through /api/settings/guest-orders, which is where hubs and the catalog already live.
// A shelf is read-modify-write on the config (never a blind overwrite — the config carries timing,
// tax and per-building rules this screen knows nothing about and must not clobber).
function AddSheet({ kind, onClose, onDone, scopeLabel, scopeId }: {
  kind: 'hub' | 'item'; onClose: () => void; onDone: () => void; scopeLabel: string; scopeId: string
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const go = async () => {
    const label = name.trim()
    if (!label) return
    setBusy(true); setErr('')
    try {
      const cur = await fetch('/api/settings/guest-orders', { cache: 'no-store' }).then(r => r.json())
      if (!cur?.ok) throw new Error(cur?.error || 'Could not read settings')

      if (kind === 'hub') {
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
        const hubs = Array.isArray(cur.config?.hubs) ? cur.config.hubs : []
        if (hubs.some((h: any) => String(h.id) === id)) throw new Error('There is already a shelf called that.')
        // Read-modify-write: everything else in the config travels untouched.
        const config = { ...cur.config, hubs: [...hubs, { id, label, buildings: [], listings: [] }] }
        const r = await fetch('/api/settings/guest-orders', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }),
        })
        const j = await r.json()
        if (!r.ok || j?.error) throw new Error(j?.error || 'Could not save')
      } else {
        const catalog = Array.isArray(cur.catalog) ? cur.catalog : []
        const item = {
          sku: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36).slice(-4),
          name: label,
          price_usd: Number(price) || 0,
          cost_usd: cost === '' ? null : Number(cost),
          category: category.trim() || null,
          track_stock: true,          // it is being added FROM the inventory screen
          active: true,
          // Scoped to the shelf you were looking at, so it appears where you added it.
          hubs: scopeId.startsWith('hub:') ? [scopeId.slice(4)] : null,
        }
        const r = await fetch('/api/settings/guest-orders', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalog: catalog.concat([item]) }),
        })
        const j = await r.json()
        if (!r.ok || j?.error) throw new Error(j?.error || 'Could not save')
      }
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-0 sm:p-4 sm:pt-[12vh]" onClick={onClose}>
      <div className="bg-white rounded-none sm:rounded-2xl w-full max-w-md min-h-dvh sm:min-h-0 p-4 sm:p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-[16px] font-bold text-ink flex-1">{kind === 'hub' ? 'Add a shelf' : 'Add an item'}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink p-1"><X size={16} /></button>
        </div>
        <p className="text-[12px] text-muted mb-3">
          {kind === 'hub'
            ? 'A shelf is a storeroom and the properties it serves. Create it here, then say which buildings it covers in Guest orders settings.'
            : 'It will be stock-tracked and added to ' + (scopeLabel || 'this shelf') + '.'}
        </p>

        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder={kind === 'hub' ? 'Shelf name, e.g. Elser storeroom' : 'Item name, e.g. Snack box'}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) go() }}
          className="w-full rounded-xl border-2 border-line px-3 py-2.5 text-[14px] focus:outline-none focus:border-ink" />

        {kind === 'item' && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold">Guest pays
              <input type="number" min={0} step="0.01" value={price} onChange={e => setPrice(e.target.value)} className={box + ' mt-0.5'} />
            </label>
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold">We pay
              <input type="number" min={0} step="0.01" value={cost} onChange={e => setCost(e.target.value)} className={box + ' mt-0.5'} />
            </label>
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-muted font-bold">Category
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Extras" className={box + ' mt-0.5'} />
            </label>
          </div>
        )}

        {err && <p className="text-[12px] text-rose-600 font-semibold mt-2">{err}</p>}
        <button onClick={go} disabled={busy || !name.trim()}
          className="w-full mt-4 rounded-xl bg-ink text-white py-2.5 text-[14px] font-bold disabled:opacity-40 inline-flex items-center justify-center gap-2">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {busy ? 'Saving…' : kind === 'hub' ? 'Create the shelf' : 'Add the item'}
        </button>
      </div>
    </div>
  )
}

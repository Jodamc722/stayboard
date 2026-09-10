'use client'
// THE CATALOG — every item on the guest menu, one row each, and the ONE place an item is set up.
//
// Jon, 2026-09-10, on the pricing table: "Love this layout but the cost and pricing should be
// cleaner, and this should be how all inventory is managed… add more of the customization features,
// the order links etc. should all live here. This should be also where we upload the photos too;
// the Salato test is just where the inventory for that hub lives."
//
// So: the row is the clean part — photo, name, what one is, costs us, guest pays, we keep, bulk,
// where it is sold — type, Tab, type, Tab. Everything else about an item lives behind the chevron:
// description, offer and badge, "1 = 5 pods", size, sold-in multiple, max per order, case cost,
// the bulk ladder, where it is sold, the reorder link, the photo, removal. The Stock tab is only
// counts per shelf and never edits an item.
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ImagePlus, Loader2, Plus, Trash2, Wand2, X, ExternalLink, ShoppingCart, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import type { Item, Tier } from '@/components/InventoryBoard'

const SIZE_UNITS = ['mL', 'L', 'fl oz', 'oz', 'g', 'kg', 'ct']
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(2)
const box = 'rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] bg-white text-ink focus:outline-none focus:border-brand-300 disabled:bg-app disabled:text-muted'
const cell = 'text-[12.5px] px-1.5 py-1 rounded-lg border border-line bg-white text-ink focus:outline-none focus:border-brand-300 tabular-nums disabled:bg-app disabled:text-muted'
const lab = 'flex flex-col text-[10.5px] uppercase tracking-wide text-muted font-semibold'
const head = 'text-[10.5px] uppercase tracking-wide text-muted font-semibold'

export type NewCatalogItem = { key: string; name: string; category: string; price: string; cost: string; pieces: string; pieceName: string; description: string }

export function CatalogTable({ items, val, setItem, canEdit, buildings, markets, hubs, busy, onUpload, onEditPhoto, onRemove, adds, setAdds, openId, onOpen }: {
  items: Item[]
  val: (i: Item, k: keyof Item) => any
  setItem: (id: string, patch: Partial<Item>) => void
  canEdit: boolean
  buildings: string[]; markets: string[]; hubs: { id: string; label: string }[]
  busy: string | null
  onUpload: (i: Item, f: File) => void
  onEditPhoto: (i: Item) => void
  onRemove: (i: Item) => void
  adds: NewCatalogItem[]; setAdds: (f: (a: NewCatalogItem[]) => NewCatalogItem[]) => void
  openId: string | null; onOpen: (id: string | null) => void
}) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const cats = useMemo(() => Array.from(new Set(items.map(i => String(val(i, 'category') || '') || 'Extras'))).sort(), [items, val])
  const rows = items
    .filter(i => !q || (i.name + ' ' + (i.category || '') + ' ' + (i.description || '')).toLowerCase().includes(q.toLowerCase()))
    .filter(i => !cat || (String(val(i, 'category') || '') || 'Extras') === cat)
    .slice().sort((a, b) => (a.category || 'zz').localeCompare(b.category || 'zz') || (Number(a.sort) || 100) - (Number(b.sort) || 100) || a.name.localeCompare(b.name))

  const costOf = (i: Item) => {
    const ps = Number(val(i, 'packSize') || 0), pc = Number(val(i, 'packCost') || 0)
    if (ps > 0 && pc > 0) return Math.round(pc / ps * 100) / 100
    const c = val(i, 'cost')
    return c === null || c === undefined || c === '' ? null : Number(c)
  }
  const unpriced = items.filter(i => !(Number(val(i, 'price')) > 0) && (val(i, 'active') ?? i.active)).length
  const toggleIn = (list: string[] | null, v: string): string[] | null => { const cur = list || []; const next = cur.indexOf(v) >= 0 ? cur.filter(x => x !== v) : [...cur, v]; return next.length ? next : null }

  return (
    <div className="space-y-3">
      {/* ── toolbar ─────────────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setCat('')} className={'px-2.5 py-1 rounded-lg text-[12px] font-semibold border ' + (!cat ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>All · {items.length}</button>
          {cats.map(c => <button key={c} onClick={() => setCat(cat === c ? '' : c)} className={'px-2.5 py-1 rounded-lg text-[12px] font-semibold border ' + (cat === c ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{c}</button>)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {unpriced ? <span className="text-[11.5px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{unpriced} with no price</span> : null}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…" className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-line bg-white w-44" />
          {canEdit ? <button onClick={() => setAdds(a => [...a, { key: 'n' + Date.now() + a.length, name: '', category: cat, price: '', cost: '', pieces: '', pieceName: '', description: '' }])} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white"><Plus size={13} /> New item</button> : null}
        </div>
      </div>

      {/* ── new items ───────────────────────────────────────────────────────────────────── */}
      {adds.map((a, ai) => (
        <div key={a.key} className="rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12.5px] font-semibold text-ink">New item</div>
            <button onClick={() => setAdds(x => x.filter((_, i) => i !== ai))} className="text-muted hover:text-rose-600" title="Discard"><X size={14} /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input autoFocus value={a.name} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, name: e.target.value } : y))} placeholder="Name the guest sees *" className={box + ' w-56'} />
            <input value={a.category} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, category: e.target.value } : y))} placeholder="Category" list="cat-cats" className={box + ' w-36'} />
            <input type="number" min={0} step="0.01" value={a.cost} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, cost: e.target.value } : y))} placeholder="costs us" className={box + ' w-28'} />
            <input type="number" min={0} step="0.01" value={a.price} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, price: e.target.value } : y))} placeholder="guest pays *" className={box + ' w-28'} />
            <span className="inline-flex items-center gap-1"><span className="text-[12px] text-muted">1 =</span>
              <input type="number" min={0} value={a.pieces} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, pieces: e.target.value } : y))} placeholder="5" className={box + ' w-16'} />
              <input value={a.pieceName} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, pieceName: e.target.value } : y))} placeholder="pods" className={box + ' w-24'} /></span>
          </div>
          <textarea value={a.description} onChange={e => setAdds(x => x.map((y, i) => i === ai ? { ...y, description: e.target.value } : y))} placeholder="Description the guest reads — what it is, what they get" rows={2} className={box + ' w-full mt-2 resize-y'} />
          <div className="text-[11.5px] text-muted mt-2">Press <b>Save changes</b> to create it, then add its photo from its row. It is offered everywhere until you narrow it, and not counted until you start counting on a shelf.</div>
        </div>
      ))}
      <datalist id="cat-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
      <datalist id="cat-badges"><option value="New" /><option value="Limited" /><option value="Last few" /><option value="Popular" /><option value="Guest favourite" /></datalist>

      {/* ── the table ────────────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse">
            <thead>
              <tr className="border-b border-line bg-app/60">
                <th className={head + ' px-3 py-2 text-left'}>Item</th>
                <th className={head + ' px-2 py-2 text-left w-[96px]'} title="Per item — if one item is 5 pods, this is what 5 pods cost us">Costs us <span className="normal-case tracking-normal font-normal">/ item</span></th>
                <th className={head + ' px-2 py-2 text-left w-[96px]'} title="Per item — the guest pays this for one item, whatever it holds">Guest pays <span className="normal-case tracking-normal font-normal">/ item</span></th>
                <th className={head + ' px-2 py-2 text-left w-[104px]'}>We keep <span className="normal-case tracking-normal font-normal">/ item</span></th>
                <th className={head + ' px-2 py-2 text-left'}>Buy more, pay less</th>
                <th className={head + ' px-2 py-2 text-left w-[150px]'}>Sold at</th>
                <th className="w-[44px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(i => {
                const price = Number(val(i, 'price') ?? 0)
                const cost = costOf(i)
                const keep = cost === null ? null : Math.round((price - cost) * 100) / 100
                const tiers: Tier[] = ((val(i, 'tiers') as Tier[]) || []).slice().sort((a, b) => a.min_qty - b.min_qty)
                const packed = !!(Number(val(i, 'packSize')) > 0 && Number(val(i, 'packCost')) > 0)
                const isOpen = openId === i.id
                const active = (val(i, 'active') as boolean) ?? i.active
                const sale = val(i, 'salePrice') as number | null
                const pieces = Number(val(i, 'pieces') || 0), pieceName = String(val(i, 'pieceName') || '').trim()
                const soldIn = Number(val(i, 'soldIn') || 0)
                const bl = (val(i, 'buildings') as string[] | null) || [], mk = (val(i, 'markets') as string[] | null) || [], hb = (val(i, 'hubs') as string[] | null) || []
                const where = [...mk, ...bl, ...hb.map(h => (hubs.find(x => x.id === h)?.label || h) + ' shelf')]
                const facts = [pieces && pieceName ? '1 = ' + pieces + ' ' + pieceName : null, val(i, 'sizeValue') && val(i, 'sizeUnit') ? (Math.round(Number(val(i, 'sizeValue')) * 100) / 100) + ' ' + val(i, 'sizeUnit') : null, soldIn > 1 ? 'in ' + soldIn + 's' : null, val(i, 'unit') ? String(val(i, 'unit')) : null].filter(Boolean)
                return (
                  <FragmentRow key={i.id}>
                    <tr className={'border-b border-line/60 align-middle ' + (isOpen ? 'bg-brand-50/30' : !active ? 'opacity-60' : '')}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5 min-w-[220px]">
                          <div className="relative flex-shrink-0 group">
                            {i.image ? <img src={i.image} alt="" className="w-10 h-10 rounded-lg object-contain bg-app border border-line" /> : <div className="w-10 h-10 rounded-lg border border-dashed border-line bg-app flex items-center justify-center text-muted"><ImagePlus size={14} /></div>}
                            {canEdit ? <label className="absolute inset-0 cursor-pointer rounded-lg hover:bg-ink/10 flex items-center justify-center" title={i.image ? 'Replace photo' : 'Add a photo'}>
                              <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(i, f); e.currentTarget.value = '' }} />
                              {busy === 'photo:' + i.id ? <Loader2 size={12} className="animate-spin text-ink" /> : null}
                            </label> : null}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <input value={String(val(i, 'name') ?? i.name)} disabled={!canEdit} onChange={e => setItem(i.id, { name: e.target.value } as any)} className="text-[13px] font-semibold text-ink bg-transparent border-b border-transparent hover:border-line focus:border-brand-300 focus:outline-none w-[170px] min-w-0" />
                              {sale !== null && sale !== undefined && Number(sale) > 0 && Number(sale) < price ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#B0342C] text-white whitespace-nowrap">{Math.round((1 - Number(sale) / price) * 100)}% off</span> : null}
                              {val(i, 'badge') ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-600 text-white whitespace-nowrap">{String(val(i, 'badge'))}</span> : null}
                              {!active ? <span title="Hidden from the guest form" className="text-muted"><EyeOff size={12} /></span> : null}
                            </div>
                            <div className="text-[11px] text-muted truncate">{String(val(i, 'category') || '') || 'Extras'}{facts.length ? ' · ' + facts.join(' · ') : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} step="0.01" value={packed ? (cost ?? '') : ((val(i, 'cost') as number | null) ?? '')} placeholder="—"
                          disabled={!canEdit || packed} title={packed ? 'From the case: ' + money(Number(val(i, 'packCost'))) + ' ÷ ' + val(i, 'packSize') : ''}
                          onChange={e => setItem(i.id, { cost: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={cell + ' w-[84px]'} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} step="0.01" value={price} disabled={!canEdit}
                          onChange={e => {
                            // Raise the price and every discount keeps its percentage.
                            const next = Math.max(0, Number(e.target.value))
                            const pcts = tiers.map(t => price > 0 ? 1 - t.unit_price_usd / price : 0)
                            setItem(i.id, { price: next, ...(tiers.length ? { tiers: tiers.map((t, k) => ({ ...t, unit_price_usd: Math.round(next * (1 - pcts[k]) * 100) / 100 })) } : {}) } as any)
                          }} className={cell + ' w-[84px] font-semibold'} />
                      </td>
                      <td className="px-2 py-2">
                        <span className={'text-[12.5px] font-bold tabular-nums ' + (keep === null ? 'text-muted' : keep < 0 ? 'text-rose-700' : 'text-emerald-700')}>
                          {keep === null ? '—' : money(keep)}{keep !== null && price > 0 ? <span className="font-normal text-muted"> · {Math.round(keep / price * 100)}%</span> : null}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <button type="button" onClick={() => onOpen(isOpen ? null : i.id)} className="text-left inline-flex items-center gap-1 flex-wrap">
                          {tiers.length
                            ? tiers.map(t => <span key={t.min_qty} className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 tabular-nums">{t.min_qty}+ {price > 0 ? Math.round((1 - t.unit_price_usd / price) * 100) + '% off' : money(t.unit_price_usd)}</span>)
                            : <span className="text-[11.5px] text-muted hover:text-brand-700">one price</span>}
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        <button type="button" onClick={() => onOpen(isOpen ? null : i.id)} className="text-left text-[11.5px] leading-snug">
                          {where.length ? <span className="text-ink">{where.slice(0, 3).join(', ')}{where.length > 3 ? ' +' + (where.length - 3) : ''}</span> : <span className="text-muted">everywhere</span>}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" onClick={() => onOpen(isOpen ? null : i.id)} className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line bg-white text-muted hover:text-ink hover:border-brand-300" title={isOpen ? 'Close' : 'Everything about this item'}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-line bg-brand-50/20">
                        <td colSpan={7} className="px-3 pb-4 pt-2">
                          <ItemDetail i={i} val={val} setItem={setItem} canEdit={canEdit} price={price} cost={cost} tiers={tiers} buildings={buildings} markets={markets} hubs={hubs} busy={busy}
                            onUpload={onUpload} onEditPhoto={onEditPhoto} toggleIn={toggleIn}
                            removing={removing === i.id} onRemoveAsk={() => setRemoving(i.id)} onRemoveNo={() => setRemoving(null)} onRemove={() => { onRemove(i); setRemoving(null) }} />
                        </td>
                      </tr>
                    ) : null}
                  </FragmentRow>
                )
              })}
              {!rows.length ? <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-muted">{items.length ? 'Nothing matches.' : 'No items yet — press New item.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</> }

// ── EVERYTHING ABOUT ONE ITEM ──────────────────────────────────────────────────────────────────
function ItemDetail({ i, val, setItem, canEdit, price, cost, tiers, buildings, markets, hubs, busy, onUpload, onEditPhoto, toggleIn, removing, onRemoveAsk, onRemoveNo, onRemove }: {
  i: Item; val: (i: Item, k: keyof Item) => any; setItem: (id: string, patch: Partial<Item>) => void; canEdit: boolean
  price: number; cost: number | null; tiers: Tier[]; buildings: string[]; markets: string[]; hubs: { id: string; label: string }[]; busy: string | null
  onUpload: (i: Item, f: File) => void; onEditPhoto: (i: Item) => void; toggleIn: (l: string[] | null, v: string) => string[] | null
  removing: boolean; onRemoveAsk: () => void; onRemoveNo: () => void; onRemove: () => void
}) {
  const maxQty = Number(val(i, 'maxQty') ?? 10)
  const packSize = val(i, 'packSize') as number | null, packCost = val(i, 'packCost') as number | null
  const packed = !!(Number(packSize) > 0 && Number(packCost) > 0)
  const pieces = Number(val(i, 'pieces') || 0), pieceName = String(val(i, 'pieceName') || '').trim()
  const soldIn = Number(val(i, 'soldIn') || 0)
  const sale = val(i, 'salePrice') as number | null
  const active = (val(i, 'active') as boolean) ?? i.active
  const url = String(val(i, 'reorderUrl') || '')
  const bl = (val(i, 'buildings') as string[] | null), mk = (val(i, 'markets') as string[] | null), hb = (val(i, 'hubs') as string[] | null)
  const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className={head}>{title}{hint ? <span className="normal-case tracking-normal font-normal"> — {hint}</span> : null}</div>
      <div className="mt-2">{children}</div>
    </div>
  )
  const chip = (on: boolean, dis = false) => 'px-2 py-0.5 rounded-full border text-[11.5px] ' + (on ? 'bg-ink text-white border-ink' : dis ? 'bg-app text-muted border-line opacity-50' : 'bg-white border-line text-ink hover:border-brand-300')
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Section title="What the guest sees">
        <div className="flex gap-3">
          <div className="relative flex-shrink-0">
            {i.image ? <img src={i.image} alt="" className="w-24 h-24 rounded-xl object-contain bg-app border border-line" /> : <div className="w-24 h-24 rounded-xl border border-dashed border-line bg-app flex items-center justify-center text-muted"><ImagePlus size={18} /></div>}
            {canEdit ? (
              <div className="mt-1.5 flex items-center gap-1">
                <label className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line bg-white text-ink hover:border-brand-300 cursor-pointer inline-flex items-center gap-1">
                  <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(i, f); e.currentTarget.value = '' }} />
                  {busy === 'photo:' + i.id ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />} {i.image ? 'Replace' : 'Add photo'}
                </label>
                {i.image ? <button onClick={() => onEditPhoto(i)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line bg-white text-ink hover:border-brand-300 inline-flex items-center gap-1"><Wand2 size={11} /> Edit</button> : null}
              </div>
            ) : null}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap gap-2">
              <label className={lab}>Name<input value={String(val(i, 'name') ?? i.name)} disabled={!canEdit} onChange={e => setItem(i.id, { name: e.target.value } as any)} className={box + ' w-56 mt-0.5 normal-case tracking-normal'} /></label>
              <label className={lab}>Category<input value={String(val(i, 'category') ?? '')} disabled={!canEdit} list="cat-cats" onChange={e => setItem(i.id, { category: e.target.value } as any)} className={box + ' w-32 mt-0.5 normal-case tracking-normal'} /></label>
              <label className={lab}>Sort<input type="number" min={0} value={Number(val(i, 'sort') ?? 100)} disabled={!canEdit} onChange={e => setItem(i.id, { sort: Number(e.target.value) } as any)} className={box + ' w-16 mt-0.5'} /></label>
            </div>
            <label className={lab}>Description<textarea value={String(val(i, 'description') ?? '')} disabled={!canEdit} rows={2} placeholder="What it is and what they get — one or two lines." onChange={e => setItem(i.id, { description: e.target.value } as any)} className={box + ' w-full mt-0.5 resize-y normal-case tracking-normal'} /></label>
            <div className="flex flex-wrap items-end gap-2">
              <label className={lab}>On offer at $<input type="number" min={0} step="0.01" value={sale ?? ''} placeholder="now $" disabled={!canEdit} onChange={e => setItem(i.id, { salePrice: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={box + ' w-24 mt-0.5'} /></label>
              <label className={lab}>Badge<input value={String(val(i, 'badge') ?? '')} placeholder="New, Popular…" list="cat-badges" disabled={!canEdit} onChange={e => setItem(i.id, { badge: e.target.value.slice(0, 16) } as any)} className={box + ' w-32 mt-0.5 normal-case tracking-normal'} /></label>
              {sale && Number(sale) > 0 && price > 0 ? <span className={'text-[11.5px] pb-1.5 ' + (cost !== null && Number(sale) < cost ? 'text-rose-700 font-semibold' : 'text-muted')}>{Number(sale) < price ? Math.round((1 - Number(sale) / price) * 100) + '% off · was ' + money(price) : 'not a discount'}{cost !== null ? (Number(sale) < cost ? ' · BELOW COST' : ' · keep ' + money(Number(sale) - cost)) : ''}</span> : null}
              <label className="flex items-center gap-1.5 text-[12px] text-ink pb-1.5 ml-auto"><input type="checkbox" checked={active} disabled={!canEdit} onChange={e => setItem(i.id, { active: e.target.checked } as any)} /> {active ? <Eye size={12} /> : <EyeOff size={12} />} Shown on the form</label>
            </div>
          </div>
        </div>
      </Section>

      <Section title="What one is" hint="1 = 5 pods, how big, sold in multiples">
        <div className="flex flex-wrap items-end gap-2">
          <label className={lab}>One item is
            <div className="flex items-center gap-1.5 mt-0.5">
              <input type="number" min={0} max={9999} value={pieces || ''} placeholder="5" disabled={!canEdit} onChange={e => setItem(i.id, { pieces: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) } as any)} className={box + ' w-20'} />
              <input value={pieceName} placeholder="pods" disabled={!canEdit} maxLength={24} onChange={e => setItem(i.id, { pieceName: e.target.value } as any)} className={box + ' w-28 normal-case tracking-normal'} />
            </div>
          </label>
          <label className={lab}>Size of one
            <span className="inline-flex items-center gap-1 mt-0.5">
              <input type="number" min={0} step="0.01" value={(val(i, 'sizeValue') as number | null) ?? ''} placeholder="500" disabled={!canEdit} onChange={e => setItem(i.id, { sizeValue: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={box + ' w-[78px]'} />
              <select value={(val(i, 'sizeUnit') as string | null) ?? ''} disabled={!canEdit} onChange={e => setItem(i.id, { sizeUnit: e.target.value || null } as any)} className={box + ' w-[86px]'}><option value="">unit…</option>{SIZE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select>
            </span>
          </label>
          <label className={lab}>Packaging label<input value={String(val(i, 'unit') ?? '')} disabled={!canEdit} placeholder="case of 12" onChange={e => setItem(i.id, { unit: e.target.value } as any)} className={box + ' w-32 mt-0.5 normal-case tracking-normal'} /></label>
          <label className={lab}>Order in multiples of<input type="number" min={0} max={999} value={soldIn || ''} placeholder="any" disabled={!canEdit} onChange={e => setItem(i.id, { soldIn: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) } as any)} className={box + ' w-24 mt-0.5'} /></label>
          <label className={lab}>Max per order<input type="number" min={1} max={99} value={maxQty} disabled={!canEdit} onChange={e => setItem(i.id, { maxQty: Number(e.target.value) } as any)} className={box + ' w-20 mt-0.5'} /></label>
        </div>
        <div className="text-[11.5px] text-muted mt-2 leading-snug">
          {pieces && pieceName ? <>Guest reads <b className="text-ink">1 = {pieces} {pieceName}</b>; 3 items show as {pieces * 3} {pieceName}. </> : <>Say what one item contains and the form reads "1 = 5 pods". </>}
          {soldIn > 1 ? <>Add puts <b>{soldIn}</b> in the basket and +/− step by {soldIn}{Math.floor(maxQty / soldIn) * soldIn < soldIn ? <b className="text-rose-700"> — max per order is below that, nobody can order it</b> : null}. </> : null}
        </div>
      </Section>

      <Section title="Money" hint={pieces && pieceName ? 'per item — one item is ' + pieces + ' ' + pieceName + ', so these are per ' + pieces + ' ' + pieceName : 'per item'}>
        <div className="flex flex-wrap items-end gap-3">
          <label className={lab}>Costs us, per item<input type="number" min={0} step="0.01" value={packed ? (cost ?? '') : ((val(i, 'cost') as number | null) ?? '')} placeholder="—" disabled={!canEdit || packed} onChange={e => setItem(i.id, { cost: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={box + ' w-28 mt-0.5'} /></label>
          <span className="text-muted pb-2">or by the case:</span>
          <label className={lab}>Items per case<input type="number" min={0} value={packSize ?? ''} placeholder="24" disabled={!canEdit} onChange={e => setItem(i.id, { packSize: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) } as any)} className={box + ' w-20 mt-0.5'} /></label>
          <label className={lab}>Case costs<input type="number" min={0} step="0.01" value={packCost ?? ''} placeholder="11.88" disabled={!canEdit} onChange={e => setItem(i.id, { packCost: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } as any)} className={box + ' w-24 mt-0.5'} /></label>
          {packed ? <span className="text-[11.5px] text-muted pb-2">= {money(cost || 0)} per item</span> : null}
        </div>
        {pieces && pieceName ? (
          <div className="text-[11.5px] text-muted mt-2">
            Per {pieceName.replace(/s$/, '')}: {cost !== null ? <>costs us <b className="text-ink">{money(cost / pieces)}</b></> : 'cost not set'}{price > 0 ? <> · guest pays <b className="text-ink">{money(price / pieces)}</b></> : null}. The guest only ever buys whole items of {pieces}.
          </div>
        ) : null}
        <div className="mt-3 pt-2.5 border-t border-line/70">
          <BulkEditor item={i} price={price} cost={cost} tiers={tiers} setItem={setItem} canEdit={canEdit} maxQty={maxQty} soldIn={soldIn} packSize={Number(packSize) || 0} />
        </div>
      </Section>

      <Section title="Where it is sold" hint="nothing picked = everywhere">
        <div className="space-y-2">
          <div><div className="text-[10.5px] text-muted mb-1">Markets</div><div className="flex flex-wrap gap-1">{markets.map(m => <button key={m} type="button" disabled={!canEdit} onClick={() => setItem(i.id, { markets: toggleIn(mk, m) } as any)} className={chip(!!mk && mk.indexOf(m) >= 0)}>{m}</button>)}</div></div>
          <div><div className="text-[10.5px] text-muted mb-1">Properties</div><div className="flex flex-wrap gap-1">{buildings.map(b => <button key={b} type="button" disabled={!canEdit} onClick={() => setItem(i.id, { buildings: toggleIn(bl, b) } as any)} className={chip(!!bl && bl.indexOf(b) >= 0)}>{b}</button>)}</div></div>
          {hubs.length ? <div><div className="text-[10.5px] text-muted mb-1">Shelves</div><div className="flex flex-wrap gap-1">{hubs.map(h => <button key={h.id} type="button" disabled={!canEdit} onClick={() => setItem(i.id, { hubs: toggleIn(hb, h.id) } as any)} className={chip(!!hb && hb.indexOf(h.id) >= 0)}>{h.label}</button>)}</div></div> : null}
          <div className="text-[11px] text-muted">A building-specific item with the same name replaces the general one there — that is how one building gets its own price.</div>
        </div>
      </Section>

      <Section title="Restocking" hint="for the team, never shown to guests">
        <div className="flex flex-wrap items-end gap-2">
          <label className={lab + ' flex-1 min-w-[240px]'}>Where to buy it again<input value={url} disabled={!canEdit} onChange={e => setItem(i.id, { reorderUrl: e.target.value } as any)} placeholder="https://…" className={box + ' w-full mt-0.5 normal-case tracking-normal'} /></label>
          {url && /^https?:\/\//i.test(url) ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 mb-0.5"><ShoppingCart size={12} /> Order <ExternalLink size={11} /></a> : null}
          <label className={lab}>Supplier<input value={String(val(i, 'supplier') ?? '')} disabled={!canEdit} onChange={e => setItem(i.id, { supplier: e.target.value } as any)} className={box + ' w-36 mt-0.5 normal-case tracking-normal'} /></label>
          <label className={lab}>Arrives as<input value={String(val(i, 'packNote') ?? '')} disabled={!canEdit} placeholder="case of 24" onChange={e => setItem(i.id, { packNote: e.target.value } as any)} className={box + ' w-36 mt-0.5 normal-case tracking-normal'} /></label>
          <label className={lab}>Folio code<input value={String(val(i, 'feeCode') ?? 'GUEST_SERVICE')} disabled={!canEdit} onChange={e => setItem(i.id, { feeCode: e.target.value } as any)} className={box + ' w-36 mt-0.5 normal-case tracking-normal font-mono'} /></label>
          <label className="flex items-center gap-1.5 text-[12px] text-ink pb-1.5"><input type="checkbox" checked={(val(i, 'tracked') as boolean) ?? i.tracked} disabled={!canEdit} onChange={e => setItem(i.id, { tracked: e.target.checked, trackStock: e.target.checked } as any)} /> Counted on shelves</label>
        </div>
      </Section>

      {canEdit ? (
        <div className="lg:col-span-2 flex items-center gap-2">
          {removing ? (
            <>
              <span className="text-[12px] text-rose-700 font-semibold">Remove “{i.name}” from the menu?</span>
              <button onClick={onRemove} disabled={busy === 'del:' + i.id} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-rose-600 text-white disabled:opacity-50">{busy === 'del:' + i.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Yes, remove</button>
              <button onClick={onRemoveNo} className="text-[12px] text-muted hover:text-ink px-2">Keep it</button>
              <span className="text-[11px] text-muted">Past orders keep their own record.</span>
            </>
          ) : <button onClick={onRemoveAsk} className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-rose-700"><Trash2 size={12} /> Remove this item</button>}
        </div>
      ) : null}
    </div>
  )
}

/** One number per break — the percent off. Everything else on the line is printed, not typed. */
function BulkEditor({ item, price, cost, tiers, setItem, canEdit, maxQty, soldIn, packSize }: { item: Item; price: number; cost: number | null; tiers: Tier[]; setItem: (id: string, patch: Partial<Item>) => void; canEdit: boolean; maxQty: number; soldIn: number; packSize: number }) {
  const put = (next: Tier[]) => setItem(item.id, { tiers: next.filter(t => t.min_qty >= 2).sort((a, b) => a.min_qty - b.min_qty).slice(0, 6) } as any)
  const priceAt = (pct: number) => Math.round(price * (1 - Math.min(90, Math.max(0, pct)) / 100) * 100) / 100
  const pctOf = (u: number) => price > 0 ? Math.round((1 - u / price) * 100) : 0
  const add = (qty: number) => {
    if (tiers.some(t => t.min_qty === qty)) return
    const belowT = tiers.filter(t => t.min_qty < qty).pop()
    put([...tiers, { min_qty: qty, unit_price_usd: priceAt(Math.min(50, (belowT ? pctOf(belowT.unit_price_usd) : 0) + 10)) }])
  }
  // Suggested breaks follow the multiple: an item sold in 5s offers 10+ and 20+, not 3+.
  const step = soldIn > 1 ? soldIn : 1
  const suggested = (step > 1 ? [2, 4, 8] : [3, 6, 12]).map(k => k * step).filter(q => q <= 99)
  const nextQty = () => { for (const q of suggested) if (!tiers.some(t => t.min_qty === q)) return q; return (tiers.length ? tiers[tiers.length - 1].min_qty : 2) + step }
  const b = 'text-[12px] px-1.5 py-1 rounded-lg border border-line bg-white text-ink focus:outline-none focus:border-brand-300 tabular-nums disabled:bg-app disabled:text-muted'
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className={head}>Buy more, pay less <span className="normal-case tracking-normal font-normal">— set the % off, we work out the rest</span></div>
        {canEdit ? (
          <div className="flex items-center gap-1">
            {suggested.map(q => tiers.some(t => t.min_qty === q) ? null : <button key={q} type="button" onClick={() => add(q)} className="text-[11px] font-semibold px-1.5 py-0.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300">{q}+</button>)}
            {packSize > 1 && !tiers.some(t => t.min_qty === packSize) && packSize <= 99 ? <button type="button" onClick={() => add(packSize)} className="text-[11px] font-semibold px-1.5 py-0.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300">whole case ({packSize})</button> : null}
            <button type="button" onClick={() => add(nextQty())} disabled={tiers.length >= 6} className="text-[11px] font-semibold px-1.5 py-0.5 rounded-lg border border-dashed border-line bg-white text-ink hover:border-brand-300 disabled:opacity-40">+ another</button>
          </div>
        ) : null}
      </div>
      {!tiers.length ? <div className="text-[11.5px] text-muted mt-1.5">Everyone pays {money(price)} whatever they order.</div> : (
        <div className="mt-2 space-y-1.5">
          {tiers.map((t, idx) => {
            const each = t.unit_price_usd
            const prev = idx > 0 ? tiers[idx - 1].unit_price_usd : price
            const up = prev > 0 && each >= prev
            const keep = cost === null ? null : Math.round((each - cost) * 100) / 100
            const offStep = step > 1 && t.min_qty % step !== 0
            return (
              <div key={idx} className={'flex items-center gap-1.5 text-[12px] rounded-lg px-1.5 py-1 flex-wrap ' + (up ? 'bg-rose-50 border border-rose-200' : '')}>
                <span className="text-muted">Buy</span>
                <input type="number" min={2} max={99} value={t.min_qty} disabled={!canEdit} onChange={e => put(tiers.map((x, k) => k === idx ? { ...x, min_qty: Math.max(2, Math.floor(Number(e.target.value) || 2)) } : x))} className={b + ' w-[54px]'} />
                <span className="text-muted">+ →</span>
                <input type="number" min={0} max={90} step={5} value={pctOf(each)} disabled={!canEdit} onChange={e => put(tiers.map((x, k) => k === idx ? { ...x, unit_price_usd: priceAt(Number(e.target.value)) } : x))} className={b + ' w-[58px] font-semibold'} />
                <span className="text-muted">% off =</span>
                <b className="tabular-nums">{money(each)}</b><span className="text-muted">each · {money(each * t.min_qty)} for {t.min_qty}</span>
                {up ? <span className="text-[11px] font-semibold text-rose-800">costs more than buying {idx > 0 ? tiers[idx - 1].min_qty : 1}</span>
                  : keep !== null ? <span className={'text-[11px] ' + (keep < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>{keep < 0 ? 'below cost' : 'keep ' + money(keep)}</span> : null}
                {t.min_qty > maxQty ? <span className="text-[11px] font-semibold text-amber-800 inline-flex items-center gap-1"><AlertTriangle size={11} /> max per order is {maxQty}</span> : null}
                {offStep ? <span className="text-[11px] font-semibold text-amber-800">not a multiple of {step} — rounds up on the form</span> : null}
                {canEdit ? <button type="button" onClick={() => put(tiers.filter((_, k) => k !== idx))} className="text-muted hover:text-rose-600 ml-auto"><X size={12} /></button> : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

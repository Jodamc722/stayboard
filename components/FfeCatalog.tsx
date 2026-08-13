'use client'
// THE FURNITURE CATALOG (Jon, 2026-08-12: "if we wanted to add lamps, etc. Make the way it
// populates super easy and robust... with furniture codes").
//
// TWO WAYS IN, because the two ways people actually have this information are different:
//   • One at a time — you saw a lamp, you have a link and a price. Type the name, the code writes
//     itself, done in about fifteen seconds.
//   • Paste a block — a vendor sent a quote, or it is already a spreadsheet. Paste the rows, the
//     parser finds the price ($) and the link (http) wherever they sit in the line, and you get one
//     row per product with a code each. Nothing is saved until you have looked at what it read.
//
// The code is the point of this screen. Once a lamp is LMP-001 it stays LMP-001 on the order, on
// the spreadsheet, on the PDF and on the box that arrives — instead of being "lamp" three times in
// three spellings.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Loader2, Search, Package, ExternalLink, Pencil, Archive, RotateCcw, ClipboardPaste, X, Store, Star, Trash2 } from 'lucide-react'
import { FFE_CATEGORIES, FFE_VENDORS, money } from '@/lib/ffe-catalog'

type Source = {
  id: string; catalog_id: string; vendor: string; vendor_sku: string | null; url: string | null
  unit_cost: number | null; lead_time_days: number | null; member_price: boolean
  in_stock: boolean | null; note: string | null; preferred: boolean
}
type Product = {
  id: string; code: string; name_en: string; name_es: string | null; category: string
  room_hint: string | null; item_keys: string[] | null; vendor: string | null; vendor_sku: string | null
  unit_cost: number | null; url: string | null; image_url: string | null
  dimensions: string | null; finish: string | null; lead_time_days: number | null
  notes: string | null; active: boolean
  sources?: Source[]; cheapest?: number | null
}
type RoomOpt = { key: string; en: string; es: string }

const blank = {
  id: '', code: '', nameEn: '', nameEs: '', category: 'lamp', roomHint: '',
  vendor: '', vendorSku: '', unitCost: '', url: '', imageUrl: '',
  dimensions: '', finish: '', leadTimeDays: '', notes: '',
}
type Draft = typeof blank

export function FfeCatalog() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [rooms, setRooms] = useState<RoomOpt[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [term, setTerm] = useState('')
  const [cat, setCat] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  // WHERE TO BUY IT — open per product, because comparing four vendors is a sit-down task and the
  // list has to stay scannable when it is not.
  const [openSources, setOpenSources] = useState('')
  const [srcDraft, setSrcDraft] = useState<{ catalogId: string; id?: string; vendor: string; vendorSku: string; url: string; unitCost: string; leadTimeDays: string; memberPrice: boolean; note: string } | null>(null)
  const [paste, setPaste] = useState<{ text: string; category: string } | null>(null)
  const [pasteResult, setPasteResult] = useState<string>('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await fetch('/api/audit/ffe/catalog?all=1', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load the catalog.')
      setProducts(j.products || [])
      setRooms(j.rooms || [])
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: any) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/audit/ffe/catalog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not save.')
      await load()
      setBusy(false)
      return j
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false); return null }
  }

  // The code the next product in this category would get — shown live so nobody has to guess.
  const nextCodeFor = (category: string) => {
    const c = FFE_CATEGORIES.find(x => x.key === category) || FFE_CATEGORIES[FFE_CATEGORIES.length - 1]
    const re = new RegExp('^' + c.prefix + '-(\\d{3,})$', 'i')
    let max = 0
    for (const p of products || []) { const m = re.exec(String(p.code || '')); if (m) max = Math.max(max, parseInt(m[1], 10) || 0) }
    return c.prefix + '-' + String(max + 1).padStart(3, '0')
  }

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase()
    return (products || [])
      .filter(p => showRetired || p.active)
      .filter(p => !cat || p.category === cat)
      .filter(p => !t || [p.code, p.name_en, p.name_es, p.vendor, p.vendor_sku].some(x => String(x || '').toLowerCase().includes(t)))
  }, [products, term, cat, showRetired])

  const byCategory = useMemo(() => {
    const m: Record<string, Product[]> = {}
    for (const p of shown) (m[p.category] = m[p.category] || []).push(p)
    return m
  }, [shown])

  const save = async () => {
    if (!draft || !draft.nameEn.trim()) return
    const j = await post({ action: 'save', ...draft, itemKeys: [] })
    if (j) setDraft(null)
  }

  const runPaste = async () => {
    if (!paste || !paste.text.trim()) return
    const j = await post({ action: 'bulk', text: paste.text, category: paste.category })
    if (j) {
      setPasteResult(`Added ${j.added} product${j.added === 1 ? '' : 's'}` +
        (j.skipped?.length ? ` · skipped ${j.skipped.length} line(s) with no product name` : ''))
      setPaste(null)
    }
  }

  if (err && !products) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div>
  if (!products) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading catalog…</div>

  return (
    <div className="space-y-3">
      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}
      {pasteResult ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12.5px] text-emerald-800 flex items-center gap-2">
          {pasteResult}
          <button onClick={() => setPasteResult('')} className="ml-auto text-emerald-700"><X className="w-3.5 h-3.5" /></button>
        </div>
      ) : null}

      <p className="text-[12.5px] text-muted">
        The products an order can be built from. Each one gets a code — the code is what goes on the owner&apos;s
        quote, the vendor spreadsheet and the box, so the same lamp is the same lamp in all 53 units.
      </p>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search code, name, vendor…"
            className="rounded-xl border border-line bg-white pl-8 pr-3 py-2 text-[12.5px] w-64" />
        </div>
        <select value={cat} onChange={e => setCat(e.target.value)}
          className="rounded-xl border border-line bg-white px-2.5 py-2 text-[12.5px]">
          <option value="">All categories</option>
          {FFE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label className="text-[12px] text-muted inline-flex items-center gap-1.5">
          <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> Show retired
        </label>
        <div className="flex-1" />
        <button onClick={() => setPaste({ text: '', category: cat || 'lamp' })}
          className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
          <ClipboardPaste className="w-3.5 h-3.5" /> Paste a list
        </button>
        <button onClick={() => setDraft({ ...blank, category: cat || 'lamp' })}
          className="rounded-xl bg-ink text-white px-3 py-2 text-[12px] font-semibold inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add a product
        </button>
      </div>

      {/* paste block */}
      {paste ? (
        <div className="rounded-2xl border border-line bg-white p-4 shadow-soft space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-ink flex-1">Paste from a vendor quote or a spreadsheet</p>
            <select value={paste.category} onChange={e => setPaste(p => p && ({ ...p, category: e.target.value }))}
              className="rounded-lg border border-line px-2 py-1 text-[12px]">
              {FFE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <p className="text-[12px] text-muted">
            One product per line. Columns can be tabs, commas or pipes, in any order — anything starting
            <span className="font-mono"> http</span> is read as the link and anything that looks like <span className="font-mono">$189</span> as
            the price. The first remaining column is the product name. Every row gets the next code in{' '}
            <span className="font-semibold text-ink">{FFE_CATEGORIES.find(c => c.key === paste.category)?.label}</span>.
          </p>
          <textarea value={paste.text} onChange={e => setPaste(p => p && ({ ...p, text: e.target.value }))}
            rows={7} autoFocus placeholder={'Brushed brass table lamp\t$89\thttps://…\nArc floor lamp, matte black, $249, https://…'}
            className="w-full rounded-xl border border-line px-3 py-2 text-[12.5px] font-mono" />
          <div className="flex items-center gap-2">
            <button onClick={runPaste} disabled={busy || !paste.text.trim()}
              className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
              {busy ? 'Adding…' : 'Add these products'}
            </button>
            <button onClick={() => setPaste(null)} className="text-[12px] font-semibold text-muted">Cancel</button>
          </div>
        </div>
      ) : null}

      {/* add / edit one */}
      {draft ? (
        <div className="rounded-2xl border border-line bg-white p-4 shadow-soft space-y-2.5">
          <p className="text-sm font-bold text-ink">{draft.id ? 'Edit product' : 'Add a product'}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={draft.nameEn} onChange={e => setDraft(d => d && ({ ...d, nameEn: e.target.value }))}
              placeholder="Product name, e.g. Brushed brass table lamp" autoFocus
              className="rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
            <input value={draft.nameEs} onChange={e => setDraft(d => d && ({ ...d, nameEs: e.target.value }))}
              placeholder="Nombre en español (optional)"
              className="rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <select value={draft.category} onChange={e => setDraft(d => d && ({ ...d, category: e.target.value }))}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
              {FFE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <div>
              <input value={draft.code} onChange={e => setDraft(d => d && ({ ...d, code: e.target.value.toUpperCase() }))}
                placeholder={nextCodeFor(draft.category)}
                className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-mono" />
              <p className="text-[10.5px] text-muted mt-0.5">
                Leave blank for <span className="font-mono">{nextCodeFor(draft.category)}</span>, or type the vendor&apos;s SKU.
              </p>
            </div>
            <select value={draft.roomHint} onChange={e => setDraft(d => d && ({ ...d, roomHint: e.target.value }))}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
              <option value="">Usual room — any</option>
              {rooms.map(r => <option key={r.key} value={r.key}>{r.en}</option>)}
            </select>
          </div>
          <div className="grid sm:grid-cols-4 gap-2">
            <input value={draft.unitCost} onChange={e => setDraft(d => d && ({ ...d, unitCost: e.target.value }))}
              placeholder="Unit cost, e.g. 89" inputMode="decimal"
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
            <input value={draft.vendor} onChange={e => setDraft(d => d && ({ ...d, vendor: e.target.value }))}
              placeholder="Vendor" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
            <input value={draft.vendorSku} onChange={e => setDraft(d => d && ({ ...d, vendorSku: e.target.value }))}
              placeholder="Vendor SKU" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-mono" />
            <input value={draft.leadTimeDays} onChange={e => setDraft(d => d && ({ ...d, leadTimeDays: e.target.value }))}
              placeholder="Lead time (days)" inputMode="numeric"
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={draft.url} onChange={e => setDraft(d => d && ({ ...d, url: e.target.value }))}
              placeholder="Product link (https://…)" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
            <input value={draft.imageUrl} onChange={e => setDraft(d => d && ({ ...d, imageUrl: e.target.value }))}
              placeholder="Image link (https://…)" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={draft.dimensions} onChange={e => setDraft(d => d && ({ ...d, dimensions: e.target.value }))}
              placeholder='Dimensions, e.g. 26" H x 14" dia' className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
            <input value={draft.finish} onChange={e => setDraft(d => d && ({ ...d, finish: e.target.value }))}
              placeholder="Finish / colour" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
          </div>
          <input value={draft.notes} onChange={e => setDraft(d => d && ({ ...d, notes: e.target.value }))}
            placeholder="Notes — assembly, who it is for, anything the buyer should know"
            className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy || !draft.nameEn.trim()}
              className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
              {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Add product'}
            </button>
            <button onClick={() => setDraft(null)} className="text-[12px] font-semibold text-muted">Cancel</button>
          </div>
        </div>
      ) : null}

      {/* the catalog */}
      {!shown.length ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center">
          <Package className="w-5 h-5 text-muted mx-auto mb-2" />
          <p className="text-sm font-semibold text-ink">Nothing here yet.</p>
          <p className="text-[12.5px] text-muted mt-1">
            Add a product, or paste a vendor list. You need a catalog before an order can carry codes.
          </p>
        </div>
      ) : FFE_CATEGORIES.filter(c => byCategory[c.key]?.length).map(c => (
        <div key={c.key} className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
          <div className="px-4 py-2.5 bg-app/50 flex items-center gap-2 border-b border-line">
            <span className="text-[12.5px] font-bold text-ink">{c.label}</span>
            <span className="text-[10.5px] font-mono text-muted">{c.prefix}-###</span>
            <span className="ml-auto text-[11px] text-muted tabular-nums">{byCategory[c.key].length}</span>
          </div>
          <div className="divide-y divide-line">
            {byCategory[c.key].map(p => (
              <div key={p.id} className={p.active ? '' : 'opacity-50'}>
                <div className="px-4 py-2.5 flex items-center gap-3">
                {p.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.image_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-line shrink-0" />
                  : <div className="w-10 h-10 rounded-lg bg-app border border-line shrink-0 grid place-items-center"><Package className="w-4 h-4 text-muted" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono font-bold text-brand-700">{p.code}</span>
                    <span className="text-[13px] font-semibold text-ink">{p.name_en}</span>
                    {!p.active ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600">retired</span> : null}
                  </div>
                  <div className="text-[11.5px] text-muted truncate">
                    {[p.vendor, p.vendor_sku, p.finish, p.dimensions, p.lead_time_days ? p.lead_time_days + ' day lead' : ''].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <span className="text-[13px] font-bold text-ink tabular-nums shrink-0">{money(p.unit_cost)}</span>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer" title="Open the product page" className="text-muted hover:text-ink p-1">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : null}
                <button title="Edit" className="text-muted hover:text-ink p-1"
                  onClick={() => setDraft({
                    id: p.id, code: p.code, nameEn: p.name_en, nameEs: p.name_es || '', category: p.category,
                    roomHint: p.room_hint || '', vendor: p.vendor || '', vendorSku: p.vendor_sku || '',
                    unitCost: p.unit_cost == null ? '' : String(p.unit_cost), url: p.url || '', imageUrl: p.image_url || '',
                    dimensions: p.dimensions || '', finish: p.finish || '',
                    leadTimeDays: p.lead_time_days == null ? '' : String(p.lead_time_days), notes: p.notes || '',
                  })}>
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button title={p.active ? 'Retire — keeps the code on old orders' : 'Bring it back'}
                  onClick={() => post({ action: p.active ? 'retire' : 'restore', id: p.id })}
                  className="text-muted hover:text-ink p-1">
                  {p.active ? <Archive className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </button>
                </div>

                {/* WHERE WE BUY IT. Several answers per product; the starred one is what a quote
                    prices from, and the rest stay visible so the comparison survives. */}
                <div className="px-4 pb-2.5 -mt-1">
                  <button onClick={() => setOpenSources(o => o === p.id ? '' : p.id)}
                    className="text-[11.5px] font-semibold text-brand-700 inline-flex items-center gap-1">
                    <Store className="w-3 h-3" />
                    {p.sources?.length
                      ? `${p.sources.length} place${p.sources.length === 1 ? '' : 's'} to buy${p.cheapest != null && p.unit_cost != null && Number(p.unit_cost) > p.cheapest ? ` · ${money(p.cheapest)} elsewhere` : ''}`
                      : 'Add where to buy it'}
                  </button>

                  {openSources === p.id ? (
                    <div className="mt-2 rounded-xl border border-line bg-app/40 overflow-hidden">
                      {(p.sources || []).map(sc => (
                        <div key={sc.id} className="px-3 py-2 flex items-center gap-2 border-b border-line last:border-0">
                          <button title={sc.preferred ? 'This is the price quotes use' : 'Use this one for quotes'}
                            onClick={() => post({ action: 'prefer', id: sc.id, catalogId: p.id })}
                            className={sc.preferred ? 'text-amber-500' : 'text-neutral-300 hover:text-amber-500'}>
                            <Star className="w-3.5 h-3.5" fill={sc.preferred ? 'currentColor' : 'none'} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-semibold text-ink flex items-center gap-1.5 flex-wrap">
                              {sc.vendor}
                              {sc.member_price ? <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-emerald-100 text-emerald-700">member rate</span> : null}
                              {sc.url ? <a href={sc.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink"><ExternalLink className="w-3 h-3" /></a> : null}
                            </div>
                            <div className="text-[11px] text-muted">
                              {[sc.vendor_sku, sc.lead_time_days ? sc.lead_time_days + ' day lead' : '', sc.note].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                          <span className={'text-[12.5px] font-bold tabular-nums ' +
                            (p.cheapest != null && sc.unit_cost != null && Number(sc.unit_cost) === p.cheapest ? 'text-emerald-700' : 'text-ink')}>
                            {money(sc.unit_cost)}
                          </span>
                          <button title="Edit" className="text-muted hover:text-ink p-1"
                            onClick={() => setSrcDraft({ catalogId: p.id, id: sc.id, vendor: sc.vendor, vendorSku: sc.vendor_sku || '', url: sc.url || '', unitCost: sc.unit_cost == null ? '' : String(sc.unit_cost), leadTimeDays: sc.lead_time_days == null ? '' : String(sc.lead_time_days), memberPrice: !!sc.member_price, note: sc.note || '' })}>
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button title="Remove" className="text-rose-400 hover:text-rose-600 p-1"
                            onClick={() => post({ action: 'dropSource', id: sc.id })}>
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}

                      {srcDraft && srcDraft.catalogId === p.id ? (
                        <div className="px-3 py-2.5 bg-white space-y-2">
                          <div className="grid sm:grid-cols-3 gap-2">
                            <input list="ffe-vendors" value={srcDraft.vendor} autoFocus
                              onChange={e => setSrcDraft(d => d && ({ ...d, vendor: e.target.value }))}
                              placeholder="Where — Amazon, HostGPO, Wayfair…"
                              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
                            <input value={srcDraft.unitCost} onChange={e => setSrcDraft(d => d && ({ ...d, unitCost: e.target.value }))}
                              placeholder="Price each" inputMode="decimal"
                              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
                            <input value={srcDraft.vendorSku} onChange={e => setSrcDraft(d => d && ({ ...d, vendorSku: e.target.value }))}
                              placeholder="Their SKU" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-mono" />
                          </div>
                          <div className="grid sm:grid-cols-3 gap-2">
                            <input value={srcDraft.url} onChange={e => setSrcDraft(d => d && ({ ...d, url: e.target.value }))}
                              placeholder="Link (https://…)" className="sm:col-span-2 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
                            <input value={srcDraft.leadTimeDays} onChange={e => setSrcDraft(d => d && ({ ...d, leadTimeDays: e.target.value }))}
                              placeholder="Lead days" inputMode="numeric" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
                          </div>
                          <label className="text-[12px] text-muted inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={srcDraft.memberPrice}
                              onChange={e => setSrcDraft(d => d && ({ ...d, memberPrice: e.target.checked }))} />
                            Member / GPO rate — not the public price
                          </label>
                          <div className="flex items-center gap-2">
                            <button disabled={busy || !srcDraft.vendor.trim()}
                              onClick={async () => { const j = await post({ action: 'source', ...srcDraft }); if (j) setSrcDraft(null) }}
                              className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
                              {busy ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setSrcDraft(null)} className="text-[12px] font-semibold text-muted">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setSrcDraft({ catalogId: p.id, vendor: '', vendorSku: '', url: '', unitCost: '', leadTimeDays: '', memberPrice: false, note: '' })}
                          className="w-full px-3 py-2 text-[12px] font-semibold text-brand-700 text-left hover:bg-white">
                          + Add another place to buy this
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <datalist id="ffe-vendors">
        {FFE_VENDORS.map(v => <option key={v.name} value={v.name} />)}
      </datalist>

      <p className="text-[11px] text-muted">
        Products are retired, never deleted — a code that has been on an owner&apos;s approved quote has to keep
        meaning what it meant. Retired products stop appearing in the order builder.
      </p>
    </div>
  )
}

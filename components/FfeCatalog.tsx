'use client'
// THE FURNITURE CATALOG (Jon, 2026-08-12: "if we wanted to add lamps, etc. Make the way it
// populates super easy and robust... with furniture codes").
//
// FOUR WAYS IN, because the four ways people actually have this information are different:
//   • One at a time — you saw a lamp, you have a link and a price. Type the name, the code writes
//     itself, done in about fifteen seconds.
//   • Paste a block — a vendor sent a quote in an email. Paste the rows, the parser finds the price
//     ($) and the link (http) wherever they sit in the line.
//   • Upload a file — .xlsx or .csv, which is what a vendor actually sends (Jon, 2026-08-13: "can we
//     have a place where we can upload a catalog"). It reads the headers, shows you what it found,
//     and writes nothing until you have looked at it.
//   • Load the starter catalog — 200 products a rental unit actually needs, across three tiers,
//     already coded. For the first day, when the catalog is empty and typing it all is the reason
//     nobody ever does.
//
// TWO AXES, NOT ONE. KIND (furniture / amenities / linen / supplies) is what sort of thing it is —
// these are bought by different people from different suppliers, and a sofa buried under trash bags
// is how this screen stops being used. TIER is how good a version of it we are buying: the same role
// at three price points, so "what would the cheaper one cost" is a filter, not a week of re-quoting.
//
// The code is still the point. Once a lamp is LMP-001 it stays LMP-001 on the order, on the
// spreadsheet, on the PDF and on the box that arrives.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Loader2, Search, Package, ExternalLink, Pencil, Archive, RotateCcw, ClipboardPaste, X,
  Store, Star, Trash2, Upload, Sparkles, AlertTriangle, Check, FileSpreadsheet,
} from 'lucide-react'
import { FFE_CATEGORIES, FFE_KINDS, FFE_TIERS, FFE_VENDORS, isSearchLink, money } from '@/lib/ffe-catalog'

type Source = {
  id: string; catalog_id: string; vendor: string; vendor_sku: string | null; url: string | null
  unit_cost: number | null; lead_time_days: number | null; member_price: boolean
  in_stock: boolean | null; note: string | null; preferred: boolean
}
type Product = {
  id: string; code: string; name_en: string; name_es: string | null; category: string
  tier: string; kind: string
  room_hint: string | null; item_keys: string[] | null; vendor: string | null; vendor_sku: string | null
  unit_cost: number | null; url: string | null; image_url: string | null
  dimensions: string | null; finish: string | null; lead_time_days: number | null
  notes: string | null; active: boolean
  sources?: Source[]; cheapest?: number | null
}
type RoomOpt = { key: string; en: string; es: string }

type ImportRow = {
  name: string; code?: string; category?: string; kind?: string; tier?: string
  vendor?: string; sku?: string; price?: number | null; url?: string; image?: string
  spec?: string; notes?: string; duplicate?: boolean
  skip?: boolean
}

const blank = {
  id: '', code: '', nameEn: '', nameEs: '', category: 'lamp', kind: 'furniture', tier: 'tier2', roomHint: '',
  vendor: '', vendorSku: '', unitCost: '', url: '', imageUrl: '',
  dimensions: '', finish: '', leadTimeDays: '', notes: '',
}
type Draft = typeof blank

const TIER_STYLE: Record<string, string> = {
  tier1: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  tier2: 'bg-sky-50 text-sky-700 border-sky-200',
  tier3: 'bg-violet-50 text-violet-700 border-violet-200',
  custom: 'bg-amber-50 text-amber-700 border-amber-200',
}

export function FfeCatalog() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [rooms, setRooms] = useState<RoomOpt[]>([])
  const [tiersReady, setTiersReady] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [term, setTerm] = useState('')
  const [cat, setCat] = useState('')
  const [kind, setKind] = useState('furniture')
  const [tier, setTier] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [openSources, setOpenSources] = useState('')
  const [srcDraft, setSrcDraft] = useState<{ catalogId: string; id?: string; vendor: string; vendorSku: string; url: string; unitCost: string; leadTimeDays: string; memberPrice: boolean; note: string } | null>(null)
  const [paste, setPaste] = useState<{ text: string; category: string } | null>(null)
  const [flash, setFlash] = useState<string>('')

  // UPLOAD — two steps, and the first one writes nothing.
  const fileRef = useRef<HTMLInputElement>(null)
  const [imp, setImp] = useState<{
    filename: string; rows: ImportRow[]; headerFound: boolean; firstRow: string[]
    totalRows: number; truncated: boolean; kind: string; tier: string
  } | null>(null)
  const [seed, setSeed] = useState<{ kinds: string[]; tiers: string[] } | null>(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await fetch('/api/audit/ffe/catalog?all=1', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load the catalog.')
      setProducts(j.products || [])
      setRooms(j.rooms || [])
      setTiersReady(j.tiersReady !== false)
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

  const live = useMemo(() => (products || []).filter(p => showRetired || p.active), [products, showRetired])
  const countByKind = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of live) m[p.kind || 'furniture'] = (m[p.kind || 'furniture'] || 0) + 1
    return m
  }, [live])
  const countByTier = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of live) if (!kind || p.kind === kind) m[p.tier || 'tier2'] = (m[p.tier || 'tier2'] || 0) + 1
    return m
  }, [live, kind])

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase()
    return live
      .filter(p => !kind || (p.kind || 'furniture') === kind)
      .filter(p => !tier || (p.tier || 'tier2') === tier)
      .filter(p => !cat || p.category === cat)
      .filter(p => !t || [p.code, p.name_en, p.name_es, p.vendor, p.vendor_sku, p.dimensions].some(x => String(x || '').toLowerCase().includes(t)))
  }, [live, term, cat, kind, tier])

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
    const j = await post({ action: 'bulk', text: paste.text, category: paste.category, kind, tier: tier || 'tier2' })
    if (j) {
      setFlash(`Added ${j.added} product${j.added === 1 ? '' : 's'}` +
        (j.skipped?.length ? ` · skipped ${j.skipped.length} line(s) with no product name` : ''))
      setPaste(null)
    }
  }

  // ── UPLOAD STEP 1: read it, show it, write nothing ──
  const pickFile = async (f: File | null | undefined) => {
    if (!f) return
    setBusy(true); setErr('')
    try {
      const data: string = await new Promise((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result || '').split(',')[1] || '')
        fr.onerror = () => rej(new Error('Could not read that file.'))
        fr.readAsDataURL(f)
      })
      const r = await fetch('/api/audit/ffe/catalog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', filename: f.name, data, kind, tier: tier || 'tier2' }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not read that file.')
      setImp({
        filename: f.name,
        rows: (j.rows || []).map((x: ImportRow) => ({ ...x, skip: !!x.duplicate })),
        headerFound: !!j.headerFound, firstRow: j.firstRow || [],
        totalRows: j.totalRows || 0, truncated: !!j.truncated,
        kind, tier: tier || 'tier2',
      })
      setSeed(null); setPaste(null); setDraft(null)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── UPLOAD STEP 2: commit what is still ticked ──
  const runImport = async () => {
    if (!imp) return
    const rows = imp.rows.filter(r => !r.skip).map(r => ({ ...r, kind: imp.kind, tier: r.tier || imp.tier }))
    if (!rows.length) { setErr('Nothing is selected to import.'); return }
    const j = await post({ action: 'import', rows, skipDuplicates: false })
    if (j) {
      setFlash(`Imported ${j.added} new product${j.added === 1 ? '' : 's'}` +
        (j.updated ? ` · updated ${j.updated}` : '') + (j.skipped ? ` · skipped ${j.skipped}` : ''))
      setImp(null)
    }
  }

  const runSeed = async () => {
    if (!seed) return
    const j = await post({ action: 'seed', kinds: seed.kinds, tiers: seed.tiers })
    if (j) {
      setFlash(`Loaded ${j.added} starter product${j.added === 1 ? '' : 's'}` +
        (j.skipped ? ` · ${j.skipped} were already in the catalog` : '') +
        '. Prices are estimates and the links are Amazon searches — replace them as you pick real items.')
      setSeed(null)
    }
  }

  const toggle = (list: string[], k: string) => list.indexOf(k) >= 0 ? list.filter(x => x !== k) : [...list, k]

  if (err && !products) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div>
  if (!products) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading catalog…</div>

  const kindMeta = FFE_KINDS.find(k => k.key === kind)

  return (
    <div className="space-y-3">
      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}
      {flash ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12.5px] text-emerald-800 flex items-start gap-2">
          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{flash}</span>
          <button onClick={() => setFlash('')} className="text-emerald-700"><X className="w-3.5 h-3.5" /></button>
        </div>
      ) : null}
      {!tiersReady ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Tiers and kinds are not switched on in the database yet — migration 039 still needs running. Everything
            else works; until then every product reads as Furniture · Tier 2 and those two fields will not save.
          </span>
        </div>
      ) : null}

      <p className="text-[12.5px] text-muted">
        The products an order can be built from. Each one gets a code — the code is what goes on the owner&apos;s
        quote, the vendor spreadsheet and the box, so the same lamp is the same lamp in all 53 units.
      </p>

      {/* KIND TABS — furniture and trash bags are not the same list */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line pb-2">
        <button onClick={() => { setKind(''); setCat('') }}
          className={'rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ' + (!kind ? 'bg-ink text-white' : 'text-muted hover:bg-app')}>
          Everything <span className="tabular-nums opacity-70">{live.length}</span>
        </button>
        {FFE_KINDS.map(k => (
          <button key={k.key} onClick={() => { setKind(k.key); setCat('') }}
            className={'rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ' + (kind === k.key ? 'bg-ink text-white' : 'text-muted hover:bg-app')}>
            {k.label} <span className="tabular-nums opacity-70">{countByKind[k.key] || 0}</span>
          </button>
        ))}
      </div>
      {kindMeta ? <p className="text-[11.5px] text-muted -mt-1">{kindMeta.blurb}</p> : null}

      {/* TIER CHIPS — the same role at three price points */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setTier('')}
          className={'rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ' +
            (!tier ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>
          All tiers
        </button>
        {FFE_TIERS.map(t => (
          <button key={t.key} onClick={() => setTier(tier === t.key ? '' : t.key)} title={t.blurb}
            className={'rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ' +
              (tier === t.key ? 'bg-ink text-white border-ink' : TIER_STYLE[t.key] + ' hover:opacity-80')}>
            {t.label} <span className="tabular-nums opacity-70">{countByTier[t.key] || 0}</span>
          </button>
        ))}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search code, name, size, vendor…"
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
        <button onClick={() => { setSeed({ kinds: ['furniture'], tiers: ['tier2'] }); setImp(null); setPaste(null) }}
          className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Starter catalog
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden"
          onChange={e => pickFile(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5 disabled:opacity-50">
          <Upload className="w-3.5 h-3.5" /> Upload a file
        </button>
        <button onClick={() => { setPaste({ text: '', category: cat || 'lamp' }); setImp(null); setSeed(null) }}
          className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
          <ClipboardPaste className="w-3.5 h-3.5" /> Paste a list
        </button>
        <button onClick={() => setDraft({ ...blank, category: cat || 'lamp', kind: kind || 'furniture', tier: tier || 'tier2' })}
          className="rounded-xl bg-ink text-white px-3 py-2 text-[12px] font-semibold inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add a product
        </button>
      </div>

      {/* ── STARTER CATALOG ─────────────────────────────────────────────────────────── */}
      {seed ? (
        <div className="rounded-2xl border border-line bg-white p-4 shadow-soft space-y-3">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-brand-700 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-ink">Load the starter catalog</p>
              <p className="text-[12px] text-muted mt-0.5">
                200 products a short-term rental unit actually needs, already coded and sized — sofa widths, rug
                dimensions, TV sizes, mount VESA ratings, sheet and towel par levels. Pick what you want.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">Which kinds</p>
              <div className="space-y-1">
                {FFE_KINDS.map(k => (
                  <label key={k.key} className="flex items-start gap-2 text-[12.5px] text-ink">
                    <input type="checkbox" className="mt-0.5" checked={seed.kinds.indexOf(k.key) >= 0}
                      onChange={() => setSeed(s => s && ({ ...s, kinds: toggle(s.kinds, k.key) }))} />
                    <span><span className="font-semibold">{k.label}</span> <span className="text-muted">— {k.blurb}</span></span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">Which tiers</p>
              <div className="space-y-1">
                {FFE_TIERS.filter(t => t.key !== 'custom').map(t => (
                  <label key={t.key} className="flex items-start gap-2 text-[12.5px] text-ink">
                    <input type="checkbox" className="mt-0.5" checked={seed.tiers.indexOf(t.key) >= 0}
                      onChange={() => setSeed(s => s && ({ ...s, tiers: toggle(s.tiers, t.key) }))} />
                    <span><span className="font-semibold">{t.label}</span> <span className="text-muted">— {t.blurb}</span></span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-2">
                Loading all three tiers gives you the price comparison to take to an owner. Loading just Standard
                gives you a clean working list. Nothing stops you adding the others later.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-800">
            <span className="font-semibold">Read this before you press the button.</span> Every link is an Amazon
            <span className="font-semibold"> search</span>, not a product page — I will not invent product URLs, because a dead
            link in a buying catalog is worse than no link. Each search lands on the right query; when somebody picks the
            real item they paste the real URL over it. The prices are <span className="font-semibold">planning estimates</span> for
            budgeting, not quotes — a real price arrives when you add a vendor source, and that is what an owner&apos;s
            quote prices from.
          </div>

          <div className="flex items-center gap-2">
            <button onClick={runSeed} disabled={busy || !seed.kinds.length || !seed.tiers.length}
              className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
              {busy ? 'Loading…' : 'Load these products'}
            </button>
            <button onClick={() => setSeed(null)} className="text-[12px] font-semibold text-muted">Cancel</button>
            <span className="text-[11.5px] text-muted">Anything already in the catalog by name is skipped, so this is safe to run twice.</span>
          </div>
        </div>
      ) : null}

      {/* ── UPLOAD PREVIEW ──────────────────────────────────────────────────────────── */}
      {imp ? (
        <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-brand-700" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-ink truncate">{imp.filename}</p>
              <p className="text-[11.5px] text-muted">
                {imp.headerFound
                  ? `Read the header row and matched your columns. ${imp.rows.length} product${imp.rows.length === 1 ? '' : 's'} found.`
                  : `No header row recognised — read each line by shape instead ($ is the price, http is the link). ${imp.rows.length} found.`}
                {imp.truncated ? ' Showing the first 500.' : ''}
                {' '}Nothing has been saved yet.
              </p>
            </div>
            <select value={imp.kind} onChange={e => setImp(v => v && ({ ...v, kind: e.target.value }))}
              className="rounded-lg border border-line px-2 py-1.5 text-[12px]">
              {FFE_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <select value={imp.tier} onChange={e => setImp(v => v && ({ ...v, tier: e.target.value }))}
              className="rounded-lg border border-line px-2 py-1.5 text-[12px]">
              {FFE_TIERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <button onClick={() => setImp(null)} className="text-muted hover:text-ink p-1"><X className="w-4 h-4" /></button>
          </div>

          <div className="max-h-[22rem] overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-app/60 sticky top-0">
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Size / spec</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {imp.rows.map((r, i) => (
                  <tr key={i} className={r.skip ? 'opacity-40' : ''}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" checked={!r.skip}
                        onChange={() => setImp(v => v && ({ ...v, rows: v.rows.map((x, j) => j === i ? { ...x, skip: !x.skip } : x) }))} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={r.name}
                        onChange={e => setImp(v => v && ({ ...v, rows: v.rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                        className="w-full bg-transparent text-ink font-medium outline-none focus:bg-app rounded px-1" />
                      {r.duplicate ? <span className="text-[10px] font-bold uppercase text-amber-700">already in the catalog</span> : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={r.category || 'misc'}
                        onChange={e => setImp(v => v && ({ ...v, rows: v.rows.map((x, j) => j === i ? { ...x, category: e.target.value } : x) }))}
                        className="bg-transparent text-muted text-[11.5px] outline-none">
                        {FFE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-muted">{r.spec || '—'}</td>
                    <td className="px-3 py-1.5 text-muted">{r.vendor || '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-ink">{r.price == null ? '—' : money(r.price)}</td>
                    <td className="px-3 py-1.5">
                      {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink"><ExternalLink className="w-3.5 h-3.5" /></a> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-line flex flex-wrap items-center gap-2">
            <button onClick={runImport} disabled={busy || !imp.rows.some(r => !r.skip)}
              className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
              {busy ? 'Importing…' : `Import ${imp.rows.filter(r => !r.skip).length} product${imp.rows.filter(r => !r.skip).length === 1 ? '' : 's'}`}
            </button>
            <button onClick={() => setImp(null)} className="text-[12px] font-semibold text-muted">Cancel</button>
            <span className="text-[11.5px] text-muted">
              Rows already in the catalog are unticked by default. Tick one and it updates that product&apos;s price and link
              instead of adding a second copy.
            </span>
          </div>
        </div>
      ) : null}

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
            <span className="font-semibold text-ink">{FFE_CATEGORIES.find(c => c.key === paste.category)?.label}</span>, filed under{' '}
            <span className="font-semibold text-ink">{FFE_KINDS.find(k => k.key === kind)?.label || 'Furniture'}</span>.
            If it is an actual file, use Upload instead — it reads .xlsx and .csv directly.
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
          <div className="grid sm:grid-cols-2 gap-2">
            <select value={draft.kind} onChange={e => setDraft(d => d && ({ ...d, kind: e.target.value }))}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
              {FFE_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <select value={draft.tier} onChange={e => setDraft(d => d && ({ ...d, tier: e.target.value }))}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
              {FFE_TIERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
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
            <input list="ffe-vendors" value={draft.vendor} onChange={e => setDraft(d => d && ({ ...d, vendor: e.target.value }))}
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
              placeholder={`Size — e.g. 8' x 10', or 58"W x 16"D x 22"H`} className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
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
          <p className="text-sm font-semibold text-ink">
            {live.length ? 'Nothing matches those filters.' : 'Nothing here yet.'}
          </p>
          <p className="text-[12.5px] text-muted mt-1">
            {live.length
              ? 'Try another kind or tier, or clear the search.'
              : 'Load the starter catalog to get 200 products in one press, or upload a vendor file. You need a catalog before an order can carry codes.'}
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
                    <span className={'text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded border ' + (TIER_STYLE[p.tier] || TIER_STYLE.tier2)}>
                      {FFE_TIERS.find(t => t.key === p.tier)?.short || 'T2'}
                    </span>
                    {!p.active ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600">retired</span> : null}
                  </div>
                  <div className="text-[11.5px] text-muted truncate">
                    {[p.dimensions, p.vendor, p.vendor_sku, p.finish, p.lead_time_days ? p.lead_time_days + ' day lead' : ''].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <span className="text-[13px] font-bold text-ink tabular-nums shrink-0">{money(p.unit_cost)}</span>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer"
                    title={isSearchLink(p.url) ? 'This is still a search, not a chosen product — open it, pick the item, then paste the real link in' : 'Open the product page'}
                    className={(isSearchLink(p.url) ? 'text-amber-500 hover:text-amber-600' : 'text-muted hover:text-ink') + ' p-1'}>
                    {isSearchLink(p.url) ? <Search className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
                  </a>
                ) : null}
                <button title="Edit" className="text-muted hover:text-ink p-1"
                  onClick={() => setDraft({
                    id: p.id, code: p.code, nameEn: p.name_en, nameEs: p.name_es || '', category: p.category,
                    kind: p.kind || 'furniture', tier: p.tier || 'tier2',
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
        meaning what it meant. Retired products stop appearing in the order builder. A{' '}
        <Search className="w-3 h-3 inline text-amber-500" /> instead of a link icon means that product still points at a
        search rather than a chosen item.
      </p>
    </div>
  )
}

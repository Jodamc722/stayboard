'use client'
// THE PROJECTIONS LIBRARY PAGE — /sales/projections (Jon, 2026-11-11: "where can I upload all the
// different projections and see them, where I can edit them on a page, so we can select them in the
// future when generating a new report or magazine… select building, unit type, adjust name").
//
// One page for the whole library (lib/sales-library):
//   • every building on the left, with its photo, area, floor plans and range;
//   • the building open on the right: its photo (from our own photo library), name, area, website and
//     notes, then every floor plan as a card — name, size, the year's range, a month line, monthly and
//     nightly figures — edited in place, tuned with the same projection builder the magazine uses;
//   • floor plans imported from a spreadsheet (CSV, or pasted straight from Excel or Google Sheets);
//   • the comparable set, and the advanced editor for comps and wording;
//   • "New deck" opens the Sales desk with this building and these unit types ready to pick.
// Saved to the library only; a deck made from it keeps its own copy.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Search, Upload, Sparkles, Trash2, SlidersHorizontal, Image as ImageIcon, Check, X, Copy, Settings2 } from 'lucide-react'
import { ProjectionTuner } from '@/components/ProjectionTuner'
import { SalesCmaEditor } from '@/components/SalesCmaEditor'
import { normalizeCma, blankCma, planNumbers, newId, money, MONTHS, type SalesCma, type PacketPlan } from '@/lib/sales-cma'

type Any = any
type Row = { id: string; name: string; area: string; photo?: string; plans: number; comps: number; range: [number, number] | null; updatedAt: string; updatedBy?: string | null }
type Entry = { id: string | null; name: string; area: string; website?: string; note?: string; photo?: string; cma: SalesCma }

const k = (n: number) => '$' + (n >= 100000 ? Math.round(n / 1000) : (Math.round(n / 100) / 10).toFixed(1)) + 'K'
const dash = (a: number, b: number) => money(a) + '–' + money(b).slice(1)
const SERIF = 'font-serif'

/** A spreadsheet's rows: CSV or tab-separated (a paste from Excel / Google Sheets), quotes honoured. */
function parseTable(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim())
  if (!lines.length) return []
  const tab = lines[0].includes('\t')
  return lines.map(l => {
    if (tab) return l.split('\t').map(c => c.trim())
    const out: string[] = []; let cur = '', q = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (ch === ',' && !q) { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  })
}
const num = (v: string): number => {
  const s = String(v || '').replace(/[$,\s]/g, '')
  const m = s.match(/^(\d+(?:\.\d+)?)(k)?/i)
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : 0
}
/** "52,900–66,000", "$52.9K to $66K" → [lo, hi]. */
const rangeOf = (v: string): [number, number] => {
  const parts = String(v || '').split(/\s*(?:–|—|-|to)\s*/i).map(num).filter(n => n > 0)
  return parts.length >= 2 ? [parts[0], parts[1]] : parts.length === 1 ? [parts[0], parts[0]] : [0, 0]
}
/** Floor plans from a sheet with a header row. Column names are matched loosely. */
function importPlans(rows: string[][], cma: SalesCma): { plans: PacketPlan[]; skipped: number; cols: string[] } {
  if (rows.length < 2) return { plans: [], skipped: 0, cols: [] }
  const head = rows[0].map(h => h.toLowerCase())
  const col = (...keys: RegExp[]) => head.findIndex(h => keys.some(r => r.test(h)))
  const cName = col(/plan|unit|type|name|layout/), cSf = col(/sf|sq|size|interior|area/)
  const cLo = col(/low|min|from/), cHi = col(/high|max|to\b/), cGross = col(/gross|annual|year|revenue|projection/)
  const cNl = col(/nightly.*low|adr.*low|rate.*low/), cNh = col(/nightly.*high|adr.*high|rate.*high/)
  const cOcc = col(/occ/)
  const cols = [cName >= 0 ? 'name' : '', cSf >= 0 ? 'size' : '', cLo >= 0 || cGross >= 0 ? 'year' : '', cOcc >= 0 ? 'occupancy' : ''].filter(Boolean)
  const plans: PacketPlan[] = []
  let skipped = 0
  for (const r of rows.slice(1)) {
    const name = (cName >= 0 ? r[cName] : r[0]) || ''
    let lo = cLo >= 0 && cLo !== cGross ? num(r[cLo]) : 0, hi = cHi >= 0 && cHi !== cGross ? num(r[cHi]) : 0
    if ((!lo || !hi) && cGross >= 0) { const [a, b] = rangeOf(r[cGross]); lo = lo || a; hi = hi || b }
    if (!name.trim() || !lo) { skipped++; continue }
    const occ = cOcc >= 0 ? rangeOf(r[cOcc]) : [70, 75]
    plans.push({
      id: newId(), name: name.trim(), sf: cSf >= 0 ? r[cSf] || '' : '', price: '', rules: 'Short-term rentals allowed',
      compIds: cma.comps.slice(0, 2).map(c => c.id), baseId: cma.comps[0]?.id || '', scale: 1, less: 0, suites: 1,
      occLo: occ[0] || 70, occHi: occ[1] || occ[0] || 75, how: 'Projection imported from the sales team’s sheet.',
      override: { lo, hi: hi || lo },
    })
    void cNl; void cNh
  }
  return { plans, skipped, cols }
}

/** The month line on a floor-plan card: high end in ink, low end dotted. */
function Spark({ months }: { months: { lo: number; hi: number }[] }) {
  const W = 220, H = 44, max = Math.max(1, ...months.map(m => m.hi))
  const pt = (v: number, i: number) => `${(i / 11) * (W - 4) + 2},${H - 3 - (v / max) * (H - 8)}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-11" aria-hidden>
      <polyline points={months.map((m, i) => pt(m.lo, i)).join(' ')} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 3" />
      <polyline points={months.map((m, i) => pt(m.hi, i)).join(' ')} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  )
}

export function ProjectionsLibrary() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tune, setTune] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [photoOpen, setPhotoOpen] = useState(false)
  const [photoQ, setPhotoQ] = useState('')
  const [photoHits, setPhotoHits] = useState<Any[] | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [newName, setNewName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const leaving = useRef<string | null>(null)

  const loadList = () => fetch('/api/sales/buildings', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.ok) setRows(d.buildings) }).catch(() => setRows([]))
  useEffect(() => { loadList() }, [])
  // The first building opens on its own, so the page is never an empty right half.
  useEffect(() => { if (rows && rows.length && sel == null && !entry) open(rows[0].id) }, [rows])

  async function open(id: string) {
    // Unsaved edits are not dropped silently: the first click warns, a second click on the same building leaves.
    if (dirty && leaving.current !== id) { leaving.current = id; setMsg('This building has unsaved changes. Save them, or click that building again to leave without saving.'); return }
    leaving.current = null
    setSel(id); setLoading(true); setTune(null); setAdvanced(false); setMsg(''); setConfirm(null); setImportOpen(false)
    try {
      const d = await fetch('/api/sales/buildings?id=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json())
      const b = d?.building
      if (b) setEntry({ id: b.id, name: b.name, area: b.area, website: b.website, note: b.note, photo: b.photo, cma: normalizeCma(b.cma)! })
      setDirty(false)
    } catch { setMsg('Could not open that building.') }
    setLoading(false)
  }
  function create(name: string) {
    const n = name.trim() || 'New building'
    setSel(null); setTune(null); setAdvanced(false)
    setEntry({ id: null, name: n, area: '', cma: blankCma(n, '') }); setDirty(true); setNewName(''); setMsg('A new building. Add its floor plans, then save.')
  }
  const patch = (f: Partial<Entry>) => { setEntry(e => e ? { ...e, ...f } : e); setDirty(true); setMsg('') }
  const setCma = (f: (c: SalesCma) => SalesCma) => { setEntry(e => e ? { ...e, cma: f(structuredClone(e.cma)) } : e); setDirty(true); setMsg('') }
  const setPlan = (i: number, p: Partial<PacketPlan>) => setCma(c => { c.plans[i] = { ...c.plans[i], ...p }; return c })

  async function save() {
    if (!entry) return
    setBusy(true); setMsg('')
    try {
      const body = { id: entry.id || undefined, name: entry.name, area: entry.area, website: entry.website || '', note: entry.note || '', photo: entry.photo || '', cma: { ...entry.cma, building: entry.name, area: entry.area } }
      const r = await fetch('/api/sales/buildings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Save failed')
      setEntry(e => e ? { ...e, id: d.building.id } : e); setSel(d.building.id); setDirty(false)
      setMsg('Saved. New decks can start from it now; decks already made keep their own copy.')
      loadList()
    } catch (e: Any) { setMsg(e?.message || 'Save failed') }
    setBusy(false)
  }
  async function remove() {
    if (!entry?.id) { setEntry(null); return }
    const r = await fetch('/api/sales/buildings?id=' + encodeURIComponent(entry.id), { method: 'DELETE' })
    const d = await r.json().catch(() => null)
    setConfirm(null)
    if (!d?.ok) { setMsg(d?.error || 'Could not remove it.'); return }
    setEntry(null); setSel(null); setDirty(false); loadList()
  }
  function duplicate() {
    if (!entry) return
    setEntry({ ...structuredClone(entry), id: null, name: entry.name + ' (copy)' }); setSel(null); setDirty(true); setMsg('A copy. Rename it and save.')
  }
  async function searchPhotos(e?: React.FormEvent) {
    e?.preventDefault()
    const term = photoQ.trim() || entry?.name || ''
    if (!term) return
    setPhotoHits(null)
    try { const d = await fetch('/api/sales/photos?q=' + encodeURIComponent(term)).then(r => r.json()); setPhotoHits(d?.ok ? d.hits : []) } catch { setPhotoHits([]) }
  }

  const nums = useMemo(() => entry ? entry.cma.plans.map(p => planNumbers(entry.cma, p)) : [], [entry])
  const preview = useMemo(() => entry && importText.trim() ? importPlans(parseTable(importText), entry.cma) : null, [importText, entry])
  const shown = (rows || []).filter(r => !q.trim() || (r.name + ' ' + r.area).toLowerCase().includes(q.trim().toLowerCase()))
  const allLo = nums.length ? Math.min(...nums.map(n => n.lo)) : 0, allHi = nums.length ? Math.max(...nums.map(n => n.hi)) : 0

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Masthead */}
      <header className="flex flex-wrap items-end gap-3 pb-5 mb-6 border-b border-line">
        <div className="mr-auto">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted font-semibold">Sales · Library</p>
          <h1 className={SERIF + ' text-[40px] leading-none text-ink mt-1'}>Projections library</h1>
          <p className="text-[13.5px] text-muted mt-2 max-w-[60ch]">Every building’s floor plans and rental projections in one place. Edit them here; a new deck or magazine starts from a copy, with the unit types you choose.</p>
        </div>
        <a href="/sales" className="rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] font-semibold text-ink hover:bg-app">Sales decks</a>
      </header>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* The buildings */}
        <aside className="space-y-3 lg:sticky lg:top-4 self-start">
          <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
            <Search size={14} className="text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a building" className="w-full min-w-0 text-[13px] text-ink bg-transparent outline-none" />
          </label>
          <form onSubmit={e => { e.preventDefault(); create(newName) }} className="flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New building name" className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink" />
            <button type="submit" className="inline-flex items-center gap-1 rounded-xl bg-ink text-white px-3 text-[12.5px] font-semibold"><Plus size={13} /> Add</button>
          </form>
          {!rows ? <p className="text-[13px] text-muted py-6 text-center"><Loader2 size={14} className="inline animate-spin" /></p> : (
            <ul className="space-y-2">
              {shown.map(r => (
                <li key={r.id}>
                  <button type="button" onClick={() => open(r.id)}
                    className={'w-full text-left rounded-2xl border overflow-hidden transition ' + (sel === r.id ? 'border-ink ring-1 ring-ink bg-white' : 'border-line bg-white hover:border-ink/40')}>
                    <div className="h-20 bg-app bg-cover bg-center" style={r.photo ? { backgroundImage: `url("${r.photo}")` } : undefined} />
                    <div className="px-3 py-2.5">
                      <p className={SERIF + ' text-[19px] leading-tight text-ink'}>{r.name}</p>
                      <p className="text-[11.5px] text-muted mt-0.5">{[r.area, r.plans + ' floor plan' + (r.plans === 1 ? '' : 's')].filter(Boolean).join(' · ')}</p>
                    </div>
                  </button>
                </li>
              ))}
              {!shown.length && <li className="text-[13px] text-muted px-1">No building matches.</li>}
            </ul>
          )}
        </aside>

        {/* The building */}
        <main className="min-w-0">
          {loading ? <p className="text-[13px] text-muted py-16 text-center"><Loader2 size={16} className="inline animate-spin" /></p>
          : !entry ? <p className="text-[14px] text-muted py-16 text-center">Choose a building, or add one.</p>
          : (
            <div className="space-y-6">
              {/* Hero */}
              <section className="rounded-3xl overflow-hidden border border-line bg-white">
                <div className="relative h-56 sm:h-64 bg-app bg-cover bg-center" style={entry.photo ? { backgroundImage: `url("${entry.photo}")` } : undefined}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                  <button type="button" onClick={() => { setPhotoOpen(o => !o); if (!photoHits) { setPhotoQ(entry.name); } }} className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-white"><ImageIcon size={13} /> {entry.photo ? 'Change photo' : 'Add a photo'}</button>
                  <div className="absolute left-5 right-5 bottom-4 text-white">
                    <input value={entry.name} onChange={e => patch({ name: e.target.value })} aria-label="Building name"
                      className={SERIF + ' w-full bg-transparent text-[38px] sm:text-[44px] leading-none outline-none placeholder-white/60 focus:bg-white/10 rounded'} />
                    <input value={entry.area} onChange={e => patch({ area: e.target.value })} placeholder="Area, e.g. Wynwood" aria-label="Area"
                      className="mt-1.5 w-full bg-transparent text-[12px] uppercase tracking-[0.24em] outline-none placeholder-white/60 focus:bg-white/10 rounded" />
                  </div>
                </div>
                {photoOpen && (
                  <div className="p-4 border-b border-line space-y-3">
                    <form onSubmit={searchPhotos} className="flex gap-2">
                      <input value={photoQ} onChange={e => setPhotoQ(e.target.value)} placeholder="Search our photos: elser pool, 17 west view, brickell kitchen" className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-[13px] text-ink" />
                      <button type="submit" className="rounded-xl bg-ink text-white px-3 text-[12.5px] font-semibold">Search</button>
                    </form>
                    <input placeholder="or paste an image link and press Enter" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (/^https?:\/\/|^\//.test(v)) { patch({ photo: v }); setPhotoOpen(false) } } }} className="w-full rounded-xl border border-line px-3 py-2 text-[12.5px] text-ink" />
                    {photoHits && (photoHits.length
                      ? <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-72 overflow-y-auto">{photoHits.map((h: Any) => (
                          <button key={h.url} type="button" onClick={() => { patch({ photo: h.url }); setPhotoOpen(false) }} title={[h.building, h.unit, h.caption].filter(Boolean).join(' · ')} className="text-left">
                            <span className="block aspect-[4/3] rounded-lg bg-cover bg-center border border-line" style={{ backgroundImage: `url("${h.thumb || h.url}")` }} />
                            <span className="block text-[10.5px] text-muted truncate mt-0.5">{h.building}{h.unit ? ' · ' + h.unit : ''}</span>
                          </button>))}</div>
                      : <p className="text-[12.5px] text-muted">No photos match. Try a building and a room.</p>)}
                  </div>
                )}
                <div className="p-4 sm:p-5 grid gap-3 sm:grid-cols-[1fr_1fr] items-start">
                  <label className="block"><span className="text-[10.5px] uppercase tracking-[0.18em] text-muted font-semibold">Building website</span>
                    <input value={entry.website || ''} onChange={e => patch({ website: e.target.value })} placeholder="theriderresidences.com" className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-[13px] text-ink" /></label>
                  <label className="block"><span className="text-[10.5px] uppercase tracking-[0.18em] text-muted font-semibold">Notes for the team</span>
                    <input value={entry.note || ''} onChange={e => patch({ note: e.target.value })} placeholder="Delivery 2027 · developer contact · rental rules" className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-[13px] text-ink" /></label>
                </div>
                <div className="px-4 sm:px-5 pb-4 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={save} disabled={busy || !dirty} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {dirty ? 'Save' : 'Saved'}</button>
                  {entry.id && <a href={'/sales?from=' + encodeURIComponent(entry.id)} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white px-4 py-2 text-[13px] font-semibold hover:bg-brand-700"><Sparkles size={14} /> New deck from {entry.name}</a>}
                  <button type="button" onClick={duplicate} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-app"><Copy size={13} /> Duplicate</button>
                  <span className="ml-auto" />
                  {confirm === 'building'
                    ? <><button type="button" onClick={remove} className="rounded-xl bg-red-600 text-white px-3 py-2 text-[12.5px] font-semibold">Remove {entry.name} from the library</button><button type="button" onClick={() => setConfirm(null)} className="rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-ink">Keep</button></>
                    : <button type="button" onClick={() => setConfirm('building')} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-muted hover:text-red-700"><Trash2 size={13} /> Remove</button>}
                </div>
                {msg && <p role="status" className="px-5 pb-4 -mt-1 text-[12.5px] text-muted">{msg}</p>}
              </section>

              {/* The floor plans */}
              <section>
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <div className="mr-auto">
                    <h2 className={SERIF + ' text-[28px] leading-none text-ink'}>Floor plans</h2>
                    <p className="text-[12.5px] text-muted mt-1">{entry.cma.plans.length ? `${entry.cma.plans.length} unit types · ${k(allLo)} to ${k(allHi)} gross a year` : 'No floor plans yet. Add one, or import a sheet.'}</p>
                  </div>
                  <button type="button" onClick={() => setImportOpen(o => !o)} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-app"><Upload size={13} /> Import from a sheet</button>
                  <button type="button" onClick={() => { const id = newId(); setCma(c => ({ ...c, plans: [...c.plans, { id, name: 'New floor plan', sf: '', price: '', rules: 'Short-term rentals allowed', compIds: c.comps.slice(0, 2).map(x => x.id), baseId: c.comps[0]?.id || '', scale: 1, less: 0, suites: 1, occLo: 70, occHi: 75, how: '', override: c.comps.length ? null : { lo: 40000, hi: 50000 } }] })); setTune(id) }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[12.5px] font-semibold"><Plus size={13} /> Add a floor plan</button>
                </div>

                {importOpen && (
                  <div className="rounded-2xl border border-line bg-white p-4 mb-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] text-ink font-semibold mr-auto">Import floor plans</p>
                      <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) setImportText(await f.text()); e.target.value = '' }} />
                      <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-app">Choose a CSV file</button>
                      <button type="button" onClick={() => { setImportOpen(false); setImportText('') }} aria-label="Close" className="text-muted hover:text-ink"><X size={16} /></button>
                    </div>
                    <p className="text-[12px] text-muted">A header row, then one floor plan per row. Columns the import understands: <b>Floor plan</b>, <b>Size</b>, <b>Low</b> and <b>High</b> (gross a year), or one <b>Gross</b> column like “$52,900–$66,000”, and <b>Occupancy</b>. Or copy the rows in Excel or Google Sheets and paste them here. To get a CSV from Excel or Numbers, use Save As or Export, then CSV.</p>
                    <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={5} placeholder={'Floor plan,Size,Low,High,Occupancy\nStudio,391 to 599 SF,52900,66000,70-75\n1 Bed,693 to 807 SF,63100,73000,70-75'} className="w-full rounded-xl border border-line px-3 py-2 font-mono text-[12px] text-ink" />
                    {preview && (preview.plans.length ? (
                      <div className="space-y-2">
                        <div className="overflow-x-auto"><table className="w-full text-[12.5px]"><thead><tr className="text-left text-muted"><th className="py-1 pr-3 font-semibold">Floor plan</th><th className="pr-3 font-semibold">Size</th><th className="pr-3 font-semibold text-right">Gross a year</th><th className="font-semibold text-right">Occupancy</th></tr></thead>
                          <tbody>{preview.plans.map(p => <tr key={p.id} className="border-t border-line"><td className="py-1.5 pr-3 text-ink">{p.name}</td><td className="pr-3 text-muted">{p.sf || '—'}</td><td className="pr-3 text-right tabular-nums">{dash(p.override!.lo, p.override!.hi)}</td><td className="text-right tabular-nums">{p.occLo}–{p.occHi}%</td></tr>)}</tbody></table></div>
                        {preview.skipped ? <p className="text-[12px] text-muted">{preview.skipped} row{preview.skipped === 1 ? '' : 's'} skipped (no name or no figure).</p> : null}
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setCma(c => ({ ...c, plans: [...c.plans, ...preview.plans] })); setImportOpen(false); setImportText(''); setMsg(preview.plans.length + ' floor plans added. Save to keep them.') }} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold">Add {preview.plans.length} floor plan{preview.plans.length === 1 ? '' : 's'}</button>
                          {entry.cma.plans.length > 0 && <button type="button" onClick={() => { setCma(c => ({ ...c, plans: preview.plans })); setImportOpen(false); setImportText(''); setMsg('Floor plans replaced. Save to keep them.') }} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink">Replace the {entry.cma.plans.length} there now</button>}
                        </div>
                      </div>
                    ) : <p className="text-[12.5px] text-red-700">No floor plans found. The first row needs column names, and each row a name and a yearly figure.</p>)}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {entry.cma.plans.map((p, i) => {
                    const n = nums[i]
                    return (
                      <article key={p.id} className={'rounded-2xl border bg-white p-4 flex flex-col gap-2 ' + (tune === p.id ? 'border-ink ring-1 ring-ink' : 'border-line')}>
                        <input value={p.name} onChange={e => setPlan(i, { name: e.target.value })} aria-label="Floor plan name" className={SERIF + ' w-full text-[24px] leading-tight text-ink bg-transparent outline-none focus:bg-app rounded'} />
                        <input value={p.sf} onChange={e => setPlan(i, { sf: e.target.value })} placeholder="Size, e.g. 693 to 807 SF" aria-label="Size" className="w-full text-[12px] text-muted bg-transparent outline-none focus:bg-app rounded -mt-1" />
                        <div className="border-t border-line pt-2">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-muted font-semibold">Gross a year{n.manual ? ' · set by hand' : ''}</p>
                          <p className={SERIF + ' text-[26px] leading-tight text-ink tabular-nums'}>{dash(n.lo, n.hi)}</p>
                        </div>
                        <div className="text-ink"><Spark months={n.months} /></div>
                        <div className="grid grid-cols-3 gap-2 text-[11.5px]">
                          <div><p className="text-muted">A month</p><p className="text-ink tabular-nums">{k(n.monthLo)}–{k(n.monthHi).slice(1)}</p></div>
                          <div><p className="text-muted">Peak</p><p className="text-ink tabular-nums">{k(n.peak)} {n.peakMonth}</p></div>
                          <div><p className="text-muted">Nightly</p><p className="text-ink tabular-nums">${n.nightlyLo}–{n.nightlyHi}</p></div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <button type="button" onClick={() => setTune(tune === p.id ? null : p.id)} className={'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold ' + (tune === p.id ? 'bg-ink text-white' : 'border border-line text-ink hover:bg-app')}><SlidersHorizontal size={12} /> {tune === p.id ? 'Done' : 'Adjust'}</button>
                          <span className="ml-auto" />
                          {confirm === p.id
                            ? <><button type="button" onClick={() => { setCma(c => ({ ...c, plans: c.plans.filter(x => x.id !== p.id) })); setConfirm(null) }} className="rounded-lg bg-red-600 text-white px-2 py-1 text-[11.5px] font-semibold">Remove</button><button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-line px-2 py-1 text-[11.5px] font-semibold text-ink">Keep</button></>
                            : <button type="button" onClick={() => setConfirm(p.id)} aria-label={'Remove ' + p.name} className="rounded-lg border border-line px-2 py-1 text-muted hover:text-red-700"><Trash2 size={12} /></button>}
                        </div>
                        {tune === p.id && (
                          <div className="border-t border-line pt-3 mt-1 space-y-3">
                            <div className="grid grid-cols-2 gap-2 text-[12px]">
                              <label className="col-span-2"><span className="text-muted">Built from</span>
                                <select value={n.manual ? '' : p.baseId} onChange={e => setPlan(i, { baseId: e.target.value, override: null })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-ink">
                                  <option value="">Set by hand (no comparable)</option>
                                  {entry.cma.comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select></label>
                              <label><span className="text-muted">Scale ×</span><input inputMode="decimal" value={p.scale} onChange={e => setPlan(i, { scale: Number(e.target.value) || 1 })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-ink" /></label>
                              <label><span className="text-muted">Occupancy %</span><input value={p.occLo + '–' + p.occHi} onChange={e => { const [a, b] = rangeOf(e.target.value); if (a) setPlan(i, { occLo: a, occHi: b || a }) }} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-ink" /></label>
                              <label className="col-span-2"><span className="text-muted">Rental rules</span><input value={p.rules} onChange={e => setPlan(i, { rules: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-ink" /></label>
                            </div>
                            <ProjectionTuner cma={entry.cma} plan={p} onChange={np => setPlan(i, np)} compact />
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>

              {/* The comparable set */}
              <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <div className="mr-auto">
                    <h2 className={SERIF + ' text-[24px] leading-none text-ink'}>Comparable set</h2>
                    <p className="text-[12.5px] text-muted mt-1">What every calculated range is built from. Uplift {entry.cma.uplift.lo}% to {entry.cma.uplift.hi}%.</p>
                  </div>
                  <button type="button" onClick={() => { if (dirty) { setMsg('Save first, then open the full editor.'); return } setAdvanced(a => !a) }} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-app"><Settings2 size={13} /> {advanced ? 'Close the full editor' : 'Edit comps, uplift and wording'}</button>
                </div>
                {entry.cma.comps.length ? (
                  <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[12.5px]">
                    <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.14em] text-muted"><th className="py-1.5 pr-3 font-semibold">Comparable</th><th className="pr-3 font-semibold">Market</th><th className="pr-3 font-semibold text-right">Gross a year</th><th className="pr-3 font-semibold text-right">Nightly</th><th className="font-semibold text-right">Occupancy</th></tr></thead>
                    <tbody>{entry.cma.comps.map(c => <tr key={c.id} className="border-t border-line"><td className="py-2 pr-3 text-ink">{c.name}</td><td className="pr-3 text-muted">{c.market}</td><td className="pr-3 text-right tabular-nums">{c.grossText || dash(c.lo, c.hi)}</td><td className="pr-3 text-right tabular-nums">${c.nightlyLo}–{c.nightlyHi}</td><td className="text-right tabular-nums">{c.occLo}–{c.occHi}%</td></tr>)}</tbody>
                  </table></div>
                ) : <p className="text-[12.5px] text-muted">No comparables yet. Imported floor plans carry their own figures; add comparables to calculate ranges instead.</p>}
              </section>
              {advanced && entry.id && <SalesCmaEditor library={{ id: entry.id, name: entry.name }} onClose={() => setAdvanced(false)} onSaved={() => { if (entry.id) open(entry.id) }} />}
              <p className="text-[11.5px] text-muted text-center pb-4">Months follow {MONTHS.length === 12 ? 'the Miami seasonal shape' : ''} unless a floor plan has been adjusted by hand. Every figure here prints the same in the magazine and the keynote.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

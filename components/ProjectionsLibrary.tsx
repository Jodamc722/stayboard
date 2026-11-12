'use client'
// THE PROJECTIONS LIBRARY PAGE — /sales/projections (Jon, 2026-11-11).
//   "Where can I upload all the different projections and see them, where I can edit them on a page,
//    so we can select them when generating a new report or magazine."
//   "Upload a data sheet in any format and build a projection… use it as comps, or as the actual
//    revenue we share with the owner."
//   "Create new projections on that page: address, website, scan, build the room type list… then
//    projections per unit, manually or upload a deck at property level or unit level."
//
// The flow for a building:
//   1. Add it: name, address, website, photo (from our own photo library).
//   2. Its unit types: scan the building's website, upload a sheet or deck for the whole property,
//      or add them by hand.
//   3. Each unit type's projection: type the yearly low and high, upload a sheet or deck for that one
//      unit type, calculate it from the comparable set, or shape it month by month.
//   4. Any of it can be the revenue we share (unit types) or evidence (comparables); another library
//      building's unit types can be added here as comparables.
// Everything read from a file or a website is shown for review first; nothing is saved until Save.
// A deck made from a building keeps its own copy (lib/sales-library).
import { ProjCalcSettingsPanel } from '@/components/ProjCalcSettings'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Search, Upload, Sparkles, Trash2, SlidersHorizontal, Image as ImageIcon, Check, X, Copy, Settings2, Globe, FileUp, PenLine } from 'lucide-react'
import { ProjectionTuner } from '@/components/ProjectionTuner'
import { SalesCmaEditor } from '@/components/SalesCmaEditor'
import { LibraryCompPicker, attachComps } from '@/components/LibraryCompPicker'
import { normalizeCma, blankCma, planNumbers, newId, money, type SalesCma, type PacketPlan, type PacketComp } from '@/lib/sales-cma'

type Any = any
type Row = { id: string; name: string; area: string; photo?: string; plans: number; comps: number; range: [number, number] | null; updatedAt: string; updatedBy?: string | null }
type Entry = { id: string | null; name: string; area: string; address?: string; website?: string; note?: string; photo?: string; calc?: boolean; cma: SalesCma }
type ReadPlan = { name: string; sf?: string; beds?: number | null; lo?: number | null; hi?: number | null; months?: number[] | null; nightlyLo?: number | null; nightlyHi?: number | null; occLo?: number | null; occHi?: number | null; note?: string }
type ReadComp = { name: string; market?: string; basis?: string; lo?: number | null; hi?: number | null; nightlyLo?: number | null; nightlyHi?: number | null; occLo?: number | null; occHi?: number | null }
type Read = { building?: string; area?: string; address?: string; website?: string; plans: ReadPlan[]; comps: ReadComp[]; summary: string; source: string }

const ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt,.docx,.pdf,.png,.jpg,.jpeg,.webp'
const k = (n: number) => '$' + (n >= 100000 ? Math.round(n / 1000) : (Math.round(n / 100) / 10).toFixed(1)) + 'K'
const dash = (a: number, b: number) => a === b ? money(a) : money(a) + '–' + money(b).slice(1)
const SERIF = 'font-serif'
const lab = 'text-[10.5px] uppercase tracking-[0.18em] text-muted font-semibold'
const field = 'mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink'
const num = (v: string) => { const m = String(v || '').replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)(k)?/i); return m ? Number(m[1]) * (m[2] ? 1000 : 1) : 0 }
const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

/** A unit type from what was read. With figures it is set by hand (override); without, it waits for them. */
function toPlan(r: ReadPlan, how: string): PacketPlan {
  const occLo = r.occLo || (r.lo && r.nightlyLo ? Math.min(95, Math.round(r.lo / r.nightlyLo / 365 * 100)) : 70)
  const occHi = r.occHi || (r.hi && r.nightlyHi ? Math.min(95, Math.round(r.hi / r.nightlyHi / 365 * 100)) : occLo || 75)
  return {
    id: newId(), name: r.name, sf: r.sf || '', price: '', rules: 'Short-term rentals allowed', compIds: [], baseId: 'none', scale: 1, less: 0, suites: 1,
    occLo, occHi, how, override: r.lo ? { lo: r.lo, hi: r.hi || r.lo } : null, season: r.months && r.months.length === 12 ? r.months : null,
  }
}
const toComp = (r: ReadComp): PacketComp => ({ id: newId(), name: r.name, market: r.market || '', basis: r.basis || 'From uploaded material', lo: r.lo || 0, hi: r.hi || r.lo || 0, nightlyLo: r.nightlyLo || 0, nightlyHi: r.nightlyHi || 0, occLo: r.occLo || 0, occHi: r.occHi || r.occLo || 0 })

/** The month line on a unit-type card: high end in ink, low end dotted. */
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

/** Low and high a year, typed. Commits on blur or Enter. */
function YearInput({ lo, hi, onSet }: { lo: number; hi: number; onSet: (lo: number, hi: number) => void }) {
  const [a, setA] = useState(lo ? String(lo) : ''), [b, setB] = useState(hi ? String(hi) : '')
  useEffect(() => { setA(lo ? String(lo) : ''); setB(hi ? String(hi) : '') }, [lo, hi])
  const commit = () => { const x = num(a), y = num(b) || x; if (x > 0) onSet(Math.min(x, y), Math.max(x, y)) }
  const box = 'w-full min-w-0 rounded-lg border border-line bg-white px-2 py-1.5 text-[13px] text-ink tabular-nums'
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
      <input value={a} onChange={e => setA(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} placeholder="Low a year" inputMode="decimal" className={box} />
      <span className="text-muted text-[12px]">to</span>
      <input value={b} onChange={e => setB(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} placeholder="High a year" inputMode="decimal" className={box} />
    </div>
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
  const [photoOpen, setPhotoOpen] = useState(false)
  const [photoQ, setPhotoQ] = useState('')
  const [photoHits, setPhotoHits] = useState<Any[] | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [newName, setNewName] = useState('')
  // The reader: what was read from a file, a paste or the website, waiting for review.
  const [reading, setReading] = useState<string | null>(null)
  const [read, setRead] = useState<Read | null>(null)
  const [pickP, setPickP] = useState<number[]>([])
  const [pickC, setPickC] = useState<number[]>([])
  const [paste, setPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const unitFile = useRef<HTMLInputElement>(null)
  const unitFor = useRef<string | null>(null)
  const leaving = useRef<string | null>(null)

  const loadList = () => fetch('/api/sales/buildings', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.ok) setRows(d.buildings) }).catch(() => setRows([]))
  useEffect(() => { loadList() }, [])
  useEffect(() => { if (rows && rows.length && sel == null && !entry) open(rows[0].id) }, [rows])

  async function open(id: string) {
    // Unsaved edits are not dropped silently: the first click warns, a second click on the same building leaves.
    if (dirty && leaving.current !== id) { leaving.current = id; setMsg('This building has unsaved changes. Save them, or click that building again to leave without saving.'); return }
    leaving.current = null
    setSel(id); setLoading(true); setTune(null); setAdvanced(false); setMsg(''); setConfirm(null); setRead(null); setPhotoOpen(false)
    try {
      const d = await fetch('/api/sales/buildings?id=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json())
      const b = d?.building
      if (b) setEntry({ id: b.id, name: b.name, area: b.area, address: b.address, website: b.website, note: b.note, photo: b.photo, calc: b.calc !== false, cma: normalizeCma(b.cma)! })
      setDirty(false)
    } catch { setMsg('Could not open that building.') }
    setLoading(false)
  }
  function create(name: string) {
    const n = name.trim() || 'New building'
    leaving.current = null
    setSel(null); setTune(null); setAdvanced(false); setRead(null)
    const cma = blankCma(n, '')
    setEntry({ id: null, name: n, area: '', cma: { ...cma, plans: [], comps: [] } }); setDirty(true); setNewName('')
    setMsg('')
  }
  const patch = (f: Partial<Entry>) => { setEntry(e => e ? { ...e, ...f } : e); setDirty(true); setMsg('') }
  const setCma = (f: (c: SalesCma) => SalesCma) => { setEntry(e => e ? { ...e, cma: f(structuredClone(e.cma)) } : e); setDirty(true); setMsg('') }
  const setPlan = (i: number, p: Partial<PacketPlan>) => setCma(c => { c.plans[i] = { ...c.plans[i], ...p }; return c })
  const addUnitType = () => { const id = newId(); setCma(c => ({ ...c, plans: [...c.plans, { id, name: 'New unit type', sf: '', price: '', rules: 'Short-term rentals allowed', compIds: [], baseId: 'none', scale: 1, less: 0, suites: 1, occLo: 70, occHi: 75, how: '', override: null }] })) }

  async function save() {
    if (!entry) return
    setBusy(true); setMsg('')
    try {
      const body = { id: entry.id || undefined, name: entry.name, area: entry.area, address: entry.address || '', website: entry.website || '', note: entry.note || '', photo: entry.photo || '', calc: entry.calc !== false, cma: { ...entry.cma, building: entry.name, area: entry.area } }
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
    if (!entry?.id) { setEntry(null); setDirty(false); return }
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

  // ── the reader ──
  async function runRead(how: 'file' | 'text' | 'website', arg: File | string, unit?: { id: string; name: string }) {
    setReading(how === 'website' ? 'Reading the building’s website…' : how === 'file' ? 'Reading ' + (arg as File).name + '…' : 'Reading what you pasted…')
    setMsg('')
    try {
      let r: Response
      if (how === 'file') { const fd = new FormData(); fd.append('file', arg as File); fd.append('scope', unit ? 'unit' : 'property'); if (unit) fd.append('unit', unit.name); r = await fetch('/api/sales/read', { method: 'POST', body: fd }) }
      else r = await fetch('/api/sales/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(how === 'website' ? { website: arg } : { text: arg, scope: 'property' }) })
      const d = await r.json().catch(() => null)
      if (!d?.ok) throw new Error(d?.error || 'Could not read it.')
      const res: Read = { ...d.read, source: how === 'file' ? (arg as File).name : how === 'website' ? 'the building website' : 'pasted text' }
      if (unit) {
        // One unit type's own sheet or deck: its figures go straight onto that card.
        const p = res.plans[0]
        if (!p || !p.lo) throw new Error('No yearly figure found for ' + unit.name + ' in that file.')
        setCma(c => { const i = c.plans.findIndex(x => x.id === unit.id); if (i >= 0) { const np = toPlan({ ...p, name: c.plans[i].name, sf: c.plans[i].sf || p.sf }, 'From ' + res.source + '.'); c.plans[i] = { ...c.plans[i], override: np.override, season: np.season, occLo: np.occLo, occHi: np.occHi, how: np.how, baseId: 'none' } } return c })
        setMsg(unit.name + ': ' + dash(p.lo!, p.hi || p.lo!) + ' a year, from ' + res.source + '. Save to keep it.')
      } else {
        setRead(res); setPickP(res.plans.map((_, i) => i)); setPickC(res.comps.map((_, i) => i)); setPaste(false); setPasteText('')
        if (!res.plans.length && !res.comps.length) setMsg('Nothing to add was found in ' + res.source + '.')
      }
    } catch (e: Any) { setMsg(e?.message || 'Could not read it.') }
    setReading(null)
  }
  /** Add what was read. Unit types with the same name as one already here are updated, not duplicated. */
  function applyRead(as: 'plans' | 'comps') {
    if (!read || !entry) return
    const plans = read.plans.filter((_, i) => pickP.includes(i))
    const comps = read.comps.filter((_, i) => pickC.includes(i))
    setCma(c => {
      if (as === 'plans') {
        for (const r of plans) {
          const np = toPlan(r, 'From ' + read.source + '.')
          const i = c.plans.findIndex(x => same(x.name, r.name))
          if (i >= 0) c.plans[i] = { ...c.plans[i], sf: c.plans[i].sf || np.sf, ...(np.override ? { override: np.override, season: np.season, occLo: np.occLo, occHi: np.occHi, how: np.how, baseId: 'none' } : {}) }
          else c.plans.push(np)
        }
      } else {
        // Unit types used as evidence: each becomes a comparable to build ranges from.
        for (const r of plans.filter(p => p.lo)) c.comps.push(toComp({ name: (read.building ? read.building + ' ' : '') + r.name, market: read.area || '', basis: 'From ' + read.source, lo: r.lo, hi: r.hi, nightlyLo: r.nightlyLo, nightlyHi: r.nightlyHi, occLo: r.occLo, occHi: r.occHi }))
      }
      for (const r of comps) c.comps.push(toComp(r))
      return c
    })
    // A blank building takes its name, area and address from what was read.
    patch({
      ...(read.building && (!entry.name || /^new building/i.test(entry.name)) ? { name: read.building } : {}),
      ...(read.area && !entry.area ? { area: read.area } : {}),
      ...(read.address && !entry.address ? { address: read.address } : {}),
      ...(read.website && !entry.website ? { website: read.website } : {}),
    })
    setMsg((as === 'plans' ? plans.length + ' unit type' + (plans.length === 1 ? '' : 's') : plans.filter(p => p.lo).length + ' comparable' + (plans.filter(p => p.lo).length === 1 ? '' : 's')) + (comps.length ? ' and ' + comps.length + ' comparable' + (comps.length === 1 ? '' : 's') : '') + ' added. Review, then Save.')
    setRead(null)
  }
  async function compsFrom(id: string) {
    if (!id) return
    try {
      const d = await fetch('/api/sales/buildings?id=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json())
      const b = d?.building; const cm = normalizeCma(b?.cma)
      if (!cm) return
      const add = cm.plans.map(p => ({ p, n: planNumbers(cm, p) })).filter(x => x.n.lo > 0).map(({ p, n }) => ({ id: newId(), name: b.name + ' ' + p.name, market: b.area || '', basis: 'Stay projection', lo: n.lo, hi: n.hi, nightlyLo: n.nightlyLo, nightlyHi: n.nightlyHi, occLo: p.occLo, occHi: p.occHi }))
      setCma(c => ({ ...c, comps: [...c.comps, ...add] }))
      setMsg(add.length + ' comparables added from ' + b.name + '. Point a unit type at one under Adjust, then Save.')
    } catch { setMsg('Could not load that building.') }
  }

  const nums = useMemo(() => entry ? entry.cma.plans.map(p => planNumbers(entry.cma, p)) : [], [entry])
  const shown = (rows || []).filter(r => !q.trim() || (r.name + ' ' + r.area).toLowerCase().includes(q.trim().toLowerCase()))
  const priced = nums.filter(n => n.lo > 0)
  const allLo = priced.length ? Math.min(...priced.map(n => n.lo)) : 0, allHi = priced.length ? Math.max(...priced.map(n => n.hi)) : 0
  const waiting = nums.filter(n => !n.lo).length

  const sourceButtons = (big?: boolean) => (
    <div className={big ? 'grid gap-3 sm:grid-cols-3' : 'flex flex-wrap gap-2'}>
      {[
        { icon: <Globe size={big ? 18 : 13} />, t: 'Scan the website', d: 'Build the unit-type list from the building’s own site.', go: () => { if (!entry?.website?.trim()) { setMsg('Add the building website first, then scan it.'); return } runRead('website', entry.website.trim()) } },
        { icon: <FileUp size={big ? 18 : 13} />, t: 'Upload a sheet or deck', d: 'Excel, CSV, PDF, Word or a screenshot, for the whole property.', go: () => fileRef.current?.click() },
        { icon: <PenLine size={big ? 18 : 13} />, t: 'Add by hand', d: 'Type each unit type and its yearly range.', go: addUnitType },
      ].map(b => big ? (
        <button key={b.t} type="button" onClick={b.go} disabled={!!reading} className="text-left rounded-2xl border border-line bg-white p-4 hover:border-ink/40 disabled:opacity-50">
          <span className="inline-flex w-9 h-9 rounded-full bg-app items-center justify-center text-ink">{b.icon}</span>
          <p className={SERIF + ' text-[21px] text-ink mt-2 leading-tight'}>{b.t}</p>
          <p className="text-[12.5px] text-muted mt-1">{b.d}</p>
        </button>
      ) : (
        <button key={b.t} type="button" onClick={b.go} disabled={!!reading} title={b.d} className={'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50 ' + (b.t === 'Add by hand' ? 'bg-ink text-white' : 'border border-line bg-white text-ink hover:bg-app')}>{b.icon} {b.t}</button>
      ))}
      {!big && <button type="button" onClick={() => setPaste(p => !p)} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-app">Paste a table</button>}
    </div>
  )

  return (
    <div className="max-w-[1400px] mx-auto">
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) runRead('file', f) }} />
      <input ref={unitFile} type="file" accept={ACCEPT} className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; const id = unitFor.current; const p = entry?.cma.plans.find(x => x.id === id); if (f && p) runRead('file', f, { id: p.id, name: p.name }) }} />

      <header className="flex flex-wrap items-end gap-3 pb-5 mb-6 border-b border-line">
        <div className="mr-auto">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted font-semibold">Sales · Library</p>
          <h1 className={SERIF + ' text-[40px] leading-none text-ink mt-1'}>Projections library</h1>
          <p className="text-[13.5px] text-muted mt-2 max-w-[64ch]">Every building’s unit types and rental projections. Scan a building’s website, upload a sheet or deck in any format, or type the figures. Use them as the revenue an owner sees, or as comparables. New decks and magazines start from a copy.</p>
        </div>
        <a href="/sales" className="rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] font-semibold text-ink hover:bg-app">Sales decks</a>
      </header>

      <ProjCalcSettingsPanel />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-4 self-start">
          <form onSubmit={e => { e.preventDefault(); create(newName) }} className="rounded-2xl border border-line bg-white p-3 space-y-2">
            <p className={lab}>New projection</p>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Building name" className="w-full rounded-xl border border-line px-3 py-2 text-[13px] text-ink" />
            <button type="submit" className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[13px] font-semibold"><Plus size={14} /> Create</button>
          </form>
          <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
            <Search size={14} className="text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a building" className="w-full min-w-0 text-[13px] text-ink bg-transparent outline-none" />
          </label>
          {!rows ? <p className="text-[13px] text-muted py-6 text-center"><Loader2 size={14} className="inline animate-spin" /></p> : (
            <ul className="space-y-2">
              {shown.map(r => (
                <li key={r.id}>
                  <button type="button" onClick={() => open(r.id)} className={'w-full text-left rounded-2xl border overflow-hidden transition ' + (sel === r.id ? 'border-ink ring-1 ring-ink bg-white' : 'border-line bg-white hover:border-ink/40')}>
                    <div className="h-20 bg-app bg-cover bg-center" style={r.photo ? { backgroundImage: `url("${r.photo}")` } : undefined} />
                    <div className="px-3 py-2.5">
                      <p className={SERIF + ' text-[19px] leading-tight text-ink'}>{r.name}</p>
                      <p className="text-[11.5px] text-muted mt-0.5">{[r.area, r.plans + ' unit type' + (r.plans === 1 ? '' : 's')].filter(Boolean).join(' · ')}</p>
                    </div>
                  </button>
                </li>
              ))}
              {!shown.length && <li className="text-[13px] text-muted px-1">No building matches.</li>}
            </ul>
          )}
        </aside>

        <main className="min-w-0">
          {loading ? <p className="text-[13px] text-muted py-16 text-center"><Loader2 size={16} className="inline animate-spin" /></p>
          : !entry ? <p className="text-[14px] text-muted py-16 text-center">Choose a building, or create a new projection.</p>
          : (
            <div className="space-y-6">
              {/* 1 · The building */}
              <section className="rounded-3xl overflow-hidden border border-line bg-white">
                <div className="relative h-52 sm:h-60 bg-app bg-cover bg-center" style={entry.photo ? { backgroundImage: `url("${entry.photo}")` } : undefined}>
                  <div className={'absolute inset-0 ' + (entry.photo ? 'bg-gradient-to-t from-black/60 via-black/10 to-transparent' : '')} />
                  <button type="button" onClick={() => { setPhotoOpen(o => !o); if (!photoQ) setPhotoQ(entry.name) }} className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-white"><ImageIcon size={13} /> {entry.photo ? 'Change photo' : 'Add a photo'}</button>
                  <div className={'absolute left-5 right-5 bottom-4 ' + (entry.photo ? 'text-white' : 'text-ink')}>
                    <input value={entry.name} onChange={e => patch({ name: e.target.value })} aria-label="Building name" className={SERIF + ' w-full bg-transparent text-[38px] sm:text-[44px] leading-none outline-none focus:bg-white/10 rounded'} />
                    <input value={entry.area} onChange={e => patch({ area: e.target.value })} placeholder="Area, e.g. Wynwood" aria-label="Area" className="mt-1.5 w-full bg-transparent text-[12px] uppercase tracking-[0.24em] outline-none placeholder-current/60 focus:bg-white/10 rounded" />
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
                <div className="p-4 sm:p-5 grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className={lab}>Address</span><input value={entry.address || ''} onChange={e => patch({ address: e.target.value })} placeholder="2201 N Miami Ave, Miami, FL" className={field} /></label>
                  <div><span className={lab}>Building website</span>
                    <div className="flex gap-2"><input value={entry.website || ''} onChange={e => patch({ website: e.target.value })} placeholder="theriderresidences.com" className={field} />
                      <button type="button" disabled={!!reading || !entry.website?.trim()} onClick={() => runRead('website', entry.website!.trim())} className="mt-1 shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-app disabled:opacity-40"><Globe size={13} /> Scan</button></div></div>
                  <label className="block sm:col-span-2"><span className={lab}>Notes for the team</span><input value={entry.note || ''} onChange={e => patch({ note: e.target.value })} placeholder="Delivery 2027 · developer contact · rental rules" className={field} /></label>
                  <label className="sm:col-span-2 inline-flex items-center gap-2 text-[12.5px] text-ink"><input type="checkbox" checked={entry.calc !== false} onChange={e => patch({ calc: e.target.checked })} /> Use this building in the public projections calculator <span className="text-muted">(unit types marked not approved or not public stay out either way)</span></label>
                </div>
                <div className="px-4 sm:px-5 pb-4 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={save} disabled={busy || !dirty} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {dirty ? 'Save' : 'Saved'}</button>
                  {entry.id && !dirty && <a href={'/sales?from=' + encodeURIComponent(entry.id)} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white px-4 py-2 text-[13px] font-semibold hover:bg-brand-700"><Sparkles size={14} /> New deck from {entry.name}</a>}
                  {entry.id && <button type="button" onClick={duplicate} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-app"><Copy size={13} /> Duplicate</button>}
                  <span className="ml-auto" />
                  {confirm === 'building'
                    ? <><button type="button" onClick={remove} className="rounded-xl bg-red-600 text-white px-3 py-2 text-[12.5px] font-semibold">Remove {entry.name} from the library</button><button type="button" onClick={() => setConfirm(null)} className="rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-ink">Keep</button></>
                    : <button type="button" onClick={() => setConfirm('building')} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-muted hover:text-red-700"><Trash2 size={13} /> Remove</button>}
                </div>
                {(msg || reading) && <p role="status" className="px-5 pb-4 -mt-1 text-[12.5px] text-muted">{reading ? <><Loader2 size={13} className="inline animate-spin mr-1.5" />{reading}</> : msg}</p>}
              </section>

              {/* What was read, for review */}
              {read && (
                <section className="rounded-2xl border-2 border-ink/80 bg-white p-4 sm:p-5 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="mr-auto">
                      <p className={lab}>Read from {read.source}</p>
                      <p className={SERIF + ' text-[22px] text-ink leading-tight mt-0.5'}>{read.summary || 'Here is what was found.'}</p>
                      {(read.building || read.area || read.address) && <p className="text-[12.5px] text-muted mt-1">{[read.building, read.area, read.address].filter(Boolean).join(' · ')}</p>}
                    </div>
                    <button type="button" onClick={() => setRead(null)} aria-label="Discard" className="text-muted hover:text-ink"><X size={18} /></button>
                  </div>
                  {read.plans.length > 0 && (
                    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[12.5px]">
                      <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.14em] text-muted"><th className="py-1.5 w-8"></th><th className="pr-3 font-semibold">Unit type</th><th className="pr-3 font-semibold">Size</th><th className="pr-3 font-semibold text-right">Gross a year</th><th className="pr-3 font-semibold text-right">Nightly</th><th className="font-semibold text-right">Occupancy</th></tr></thead>
                      <tbody>{read.plans.map((p, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="py-2"><input type="checkbox" checked={pickP.includes(i)} onChange={e => setPickP(x => e.target.checked ? [...x, i] : x.filter(y => y !== i))} aria-label={'Include ' + p.name} /></td>
                          <td className="pr-3 text-ink">{p.name}{p.months ? <span className="text-muted"> · by month</span> : null}</td><td className="pr-3 text-muted">{p.sf || '—'}</td>
                          <td className="pr-3 text-right tabular-nums">{p.lo ? dash(p.lo, p.hi || p.lo) : <span className="text-muted">to add</span>}</td>
                          <td className="pr-3 text-right tabular-nums">{p.nightlyLo ? '$' + p.nightlyLo + (p.nightlyHi && p.nightlyHi !== p.nightlyLo ? '–' + p.nightlyHi : '') : '—'}</td>
                          <td className="text-right tabular-nums">{p.occLo ? p.occLo + (p.occHi && p.occHi !== p.occLo ? '–' + p.occHi : '') + '%' : '—'}</td>
                        </tr>))}</tbody></table></div>
                  )}
                  {read.comps.length > 0 && (
                    <div><p className={lab + ' mb-1'}>Comparables in it</p>
                      <div className="flex flex-wrap gap-1.5">{read.comps.map((c, i) => { const on = pickC.includes(i); return <button key={i} type="button" onClick={() => setPickC(x => on ? x.filter(y => y !== i) : [...x, i])} className={'rounded-full border px-3 py-1 text-[12px] ' + (on ? 'border-ink bg-ink text-white' : 'border-line text-muted')}>{c.name}{c.lo ? ' · ' + k(c.lo) + (c.hi && c.hi !== c.lo ? '–' + k(c.hi).slice(1) : '') : ''}</button> })}</div></div>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {read.plans.length > 0 && <button type="button" disabled={!pickP.length && !pickC.length} onClick={() => applyRead('plans')} className="rounded-xl bg-ink text-white px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-40">Add as unit types{read.plans.some(p => p.lo) ? ' (the revenue we share)' : ''}</button>}
                    {read.plans.some(p => p.lo) && <button type="button" onClick={() => applyRead('comps')} className="rounded-xl border border-line px-3.5 py-2 text-[12.5px] font-semibold text-ink hover:bg-app">Use them as comparables instead</button>}
                    {!read.plans.length && read.comps.length > 0 && <button type="button" disabled={!pickC.length} onClick={() => applyRead('plans')} className="rounded-xl bg-ink text-white px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-40">Add {pickC.length} comparable{pickC.length === 1 ? '' : 's'}</button>}
                    <span className="text-[11.5px] text-muted self-center">Unit types already here with the same name are updated, not repeated.</span>
                  </div>
                </section>
              )}

              {/* 2 · Unit types and their projections */}
              <section>
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <div className="mr-auto">
                    <h2 className={SERIF + ' text-[28px] leading-none text-ink'}>Unit types</h2>
                    <p className="text-[12.5px] text-muted mt-1">{entry.cma.plans.length ? `${entry.cma.plans.length} unit type${entry.cma.plans.length === 1 ? '' : 's'}${priced.length ? ` · ${k(allLo)} to ${k(allHi)} gross a year` : ''}${waiting ? ` · ${waiting} waiting for figures` : ''}` : 'Start the list one of three ways.'}</p>
                  </div>
                  {entry.cma.plans.length > 0 && sourceButtons()}
                </div>
                {paste && (
                  <div className="rounded-2xl border border-line bg-white p-4 mb-4 space-y-2">
                    <p className="text-[12.5px] text-muted">Copy the rows in Excel, Google Sheets or a PDF and paste them here, header row included.</p>
                    <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5} placeholder={'Unit type\tSize\tLow\tHigh\tOccupancy\nStudio\t391 to 599 SF\t52900\t66000\t70-75'} className="w-full rounded-xl border border-line px-3 py-2 font-mono text-[12px] text-ink" />
                    <div className="flex gap-2"><button type="button" disabled={!pasteText.trim() || !!reading} onClick={() => runRead('text', pasteText)} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">Read it</button><button type="button" onClick={() => { setPaste(false); setPasteText('') }} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink">Cancel</button></div>
                  </div>
                )}
                {!entry.cma.plans.length ? sourceButtons(true) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {entry.cma.plans.map((p, i) => {
                      const n = nums[i], has = n.lo > 0
                      return (
                        <article key={p.id} className={'rounded-2xl border bg-white p-4 flex flex-col gap-2 ' + (tune === p.id ? 'border-ink ring-1 ring-ink' : has ? 'border-line' : 'border-dashed border-ink/30')}>
                          <input value={p.name} onChange={e => setPlan(i, { name: e.target.value })} aria-label="Unit type name" className={SERIF + ' w-full text-[24px] leading-tight text-ink bg-transparent outline-none focus:bg-app rounded'} />
                          <input value={p.sf} onChange={e => setPlan(i, { sf: e.target.value })} placeholder="Size, e.g. 693 to 807 SF" aria-label="Size" className="w-full text-[12px] text-muted bg-transparent outline-none focus:bg-app rounded -mt-1" />
                          {has ? (
                            <>
                              <div className="border-t border-line pt-2">
                                <p className="text-[10px] uppercase tracking-[0.2em] text-muted font-semibold">Gross a year · {n.manual ? 'our figures' : 'from comparables'}</p>
                                <p className={SERIF + ' text-[26px] leading-tight text-ink tabular-nums'}>{dash(n.lo, n.hi)}</p>
                              </div>
                              <div className="text-ink"><Spark months={n.months} /></div>
                              <div className="grid grid-cols-3 gap-2 text-[11.5px]">
                                <div><p className="text-muted">A month</p><p className="text-ink tabular-nums">{k(n.monthLo)}–{k(n.monthHi).slice(1)}</p></div>
                                <div><p className="text-muted">Peak</p><p className="text-ink tabular-nums">{k(n.peak)} {n.peakMonth}</p></div>
                                <div><p className="text-muted">Nightly</p><p className="text-ink tabular-nums">${n.nightlyLo}–{n.nightlyHi}</p></div>
                              </div>
                            </>
                          ) : (
                            <div className="border-t border-line pt-3 space-y-2">
                              <p className="text-[12px] text-muted">No projection yet. Type the yearly range, upload this unit type’s own sheet or deck, or calculate it from a comparable under Adjust.</p>
                              <YearInput lo={0} hi={0} onSet={(lo, hi) => setPlan(i, { override: { lo, hi }, baseId: 'none' })} />
                            </div>
                          )}
                          {/* THE PROJECTION'S RECORD (Jon, 2026-11-12, the projections folder): approval, units, who it
                              was for, notes and its PDF. Internal: none of this prints on a deck. */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <select value={p.status || 'approved'} onChange={e => setPlan(i, { status: e.target.value as any, ...(e.target.value === 'pending' ? { public: false } : {}) })} aria-label="Status"
                              className={'rounded-full px-2 py-0.5 font-semibold border ' + (p.status === 'pending' ? 'bg-amber-50 text-amber-800 border-amber-200' : p.status === 'caveat' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200')}>
                              <option value="approved">Approved</option><option value="pending">Not approved yet</option><option value="caveat">Use with care</option>
                            </select>
                            <label className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-muted" title="Feeds the public projections calculator">
                              <input type="checkbox" checked={p.public !== false && p.status !== 'pending'} disabled={p.status === 'pending'} onChange={e => setPlan(i, { public: e.target.checked })} /> Public calculator
                            </label>
                            {p.adr && p.adr.length ? <span className="rounded-full bg-app px-2 py-0.5 text-muted">ADR ${p.adr[0]}{p.adr[1] && p.adr[1] !== p.adr[0] ? '–' + p.adr[1] : ''}</span> : null}
                          </div>
                          {(p.units?.length || p.preparedFor?.length || p.notes || p.files?.length) ? (
                            <details className="text-[11.5px] text-muted">
                              <summary className="cursor-pointer">{[p.units?.length ? 'Units ' + p.units.join(', ') : '', p.prepared].filter(Boolean).join(' · ') || 'Details'}</summary>
                              <div className="mt-1.5 space-y-1">
                                {p.preparedFor?.length ? <p><span className="text-ink">Prepared for</span> {p.preparedFor.join('; ')}</p> : null}
                                <textarea value={p.notes || ''} onChange={e => setPlan(i, { notes: e.target.value })} rows={2} placeholder="Internal notes" className="w-full rounded-lg border border-line px-2 py-1 text-[11.5px] text-ink" />
                                {p.files?.map((f, j) => <a key={j} href={f.url} target="_blank" rel="noreferrer" className="block text-ink underline truncate">{f.name}</a>)}
                              </div>
                            </details>
                          ) : null}
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <button type="button" onClick={() => setTune(tune === p.id ? null : p.id)} className={'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold ' + (tune === p.id ? 'bg-ink text-white' : 'border border-line text-ink hover:bg-app')}><SlidersHorizontal size={12} /> {tune === p.id ? 'Done' : 'Adjust'}</button>
                            <button type="button" disabled={!!reading} onClick={() => { unitFor.current = p.id; unitFile.current?.click() }} title={'Upload a sheet or deck for ' + p.name + ' alone'} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app disabled:opacity-40"><Upload size={12} /> Upload</button>
                            <span className="ml-auto" />
                            {confirm === p.id
                              ? <><button type="button" onClick={() => { setCma(c => ({ ...c, plans: c.plans.filter(x => x.id !== p.id) })); setConfirm(null) }} className="rounded-lg bg-red-600 text-white px-2 py-1 text-[11.5px] font-semibold">Remove</button><button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-line px-2 py-1 text-[11.5px] font-semibold text-ink">Keep</button></>
                              : <button type="button" onClick={() => setConfirm(p.id)} aria-label={'Remove ' + p.name} className="rounded-lg border border-line px-2 py-1 text-muted hover:text-red-700"><Trash2 size={12} /></button>}
                          </div>
                          {tune === p.id && (
                            <div className="border-t border-line pt-3 mt-1 space-y-3">
                              <div className="grid grid-cols-2 gap-2 text-[12px]">
                                <label className="col-span-2"><span className="text-muted">Where the figures come from</span>
                                  <select value={n.manual || p.baseId === 'none' ? 'none' : p.baseId} onChange={e => setPlan(i, e.target.value === 'none' ? { baseId: 'none' } : { baseId: e.target.value, override: null })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-ink">
                                    <option value="none">Our own figures (typed or uploaded)</option>
                                    {entry.cma.comps.map(c => <option key={c.id} value={c.id}>Calculated from {c.name}</option>)}
                                  </select></label>
                                {(n.manual || p.baseId === 'none') ? (
                                  <div className="col-span-2"><span className="text-muted">Gross a year</span><YearInput lo={p.override?.lo || 0} hi={p.override?.hi || 0} onSet={(lo, hi) => setPlan(i, { override: { lo, hi }, adjust: 0 })} /></div>
                                ) : (
                                  <label><span className="text-muted">Scale ×</span><input inputMode="decimal" value={p.scale} onChange={e => setPlan(i, { scale: Number(e.target.value) || 1 })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-ink" /></label>
                                )}
                                <label className={(n.manual || p.baseId === 'none') ? 'col-span-2' : ''}><span className="text-muted">Occupancy %</span><input defaultValue={p.occLo + '–' + p.occHi} key={p.occLo + '-' + p.occHi} onBlur={e => { const m = e.target.value.match(/(\d+)\D+(\d+)?/); if (m) setPlan(i, { occLo: Number(m[1]), occHi: Number(m[2] || m[1]) }) }} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-ink" /></label>
                                <label className="col-span-2"><span className="text-muted">Rental rules</span><input value={p.rules} onChange={e => setPlan(i, { rules: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-ink" /></label>
                              </div>
                              {has && <ProjectionTuner cma={entry.cma} plan={p} onChange={np => setPlan(i, np)} compact />}
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* 3 · Comparables */}
              <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <div className="mr-auto">
                    <h2 className={SERIF + ' text-[24px] leading-none text-ink'}>Comparables</h2>
                    <p className="text-[12.5px] text-muted mt-1">Evidence for the ranges. A unit type can be calculated from one (Adjust), and the magazine prints them beside each projection.</p>
                  </div>
                  {(rows || []).filter(r => r.id !== entry.id).length > 0 && (
                    <select value="" onChange={e => compsFrom(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-ink">
                      <option value="">Add another building as comparables…</option>
                      {(rows || []).filter(r => r.id !== entry.id).map(r => <option key={r.id} value={r.id}>{r.name}{r.area ? ' · ' + r.area : ''}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={() => { if (dirty || !entry.id) { setMsg('Save first, then open the full editor.'); return } setAdvanced(a => !a) }} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-app"><Settings2 size={13} /> {advanced ? 'Close the full editor' : 'Comps, uplift and wording'}</button>
                </div>
                <details className="mb-3"><summary className="cursor-pointer text-[12.5px] font-semibold text-ink">Pick comparables from other buildings, or add a custom one</summary>
                  <div className="mt-2 max-w-[600px]"><LibraryCompPicker exclude={entry.id || undefined} onAdd={add => { setCma(c => attachComps(c, add)); setMsg(add.length + ' comparable' + (add.length === 1 ? '' : 's') + ' added. Save to keep them.') }} /></div>
                </details>
                {entry.cma.comps.length ? (
                  <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[12.5px]">
                    <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.14em] text-muted"><th className="py-1.5 pr-3 font-semibold">Comparable</th><th className="pr-3 font-semibold">Market</th><th className="pr-3 font-semibold text-right">Gross a year</th><th className="pr-3 font-semibold text-right">Nightly</th><th className="pr-3 font-semibold text-right">Occupancy</th><th className="w-8"></th></tr></thead>
                    <tbody>{entry.cma.comps.map(c => (
                      <tr key={c.id} className="border-t border-line"><td className="py-2 pr-3 text-ink">{c.name}</td><td className="pr-3 text-muted">{c.market}</td><td className="pr-3 text-right tabular-nums">{c.grossText || (c.lo ? dash(c.lo, c.hi) : '—')}</td><td className="pr-3 text-right tabular-nums">{c.nightlyLo ? '$' + c.nightlyLo + '–' + c.nightlyHi : '—'}</td><td className="pr-3 text-right tabular-nums">{c.occLo ? c.occLo + '–' + c.occHi + '%' : '—'}</td>
                        <td className="text-right">{confirm === 'c' + c.id ? <button type="button" onClick={() => { setCma(cm => ({ ...cm, comps: cm.comps.filter(x => x.id !== c.id), plans: cm.plans.map(p => p.baseId === c.id ? { ...p, baseId: 'none' } : p) })); setConfirm(null) }} className="rounded bg-red-600 text-white px-2 py-0.5 text-[11px] font-semibold">Remove</button> : <button type="button" onClick={() => setConfirm('c' + c.id)} aria-label={'Remove ' + c.name} className="text-muted hover:text-red-700"><Trash2 size={12} /></button>}</td></tr>
                    ))}</tbody>
                  </table></div>
                ) : <p className="text-[12.5px] text-muted">None yet. Upload a CMA or comp sheet, or add another library building as comparables.</p>}
              </section>
              {advanced && entry.id && <SalesCmaEditor library={{ id: entry.id, name: entry.name }} onClose={() => setAdvanced(false)} onSaved={() => { if (entry.id) open(entry.id) }} />}
              <p className="text-[11.5px] text-muted text-center pb-4">Every figure here prints the same in the magazine and the keynote. A deck’s own copy can still be adjusted from the deck.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

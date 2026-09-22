'use client'
// Every unit in the portfolio in one sortable, filterable table.
//
// WHY: /listings was retired on 2026-08-11 and redirects to /buildings, which shows BUILDING cards
// only — so to reach one of 233 units you had to know its building and then find it in a list. No
// search, no filter, no sort, and no money anywhere on the page. This is that missing view.
//
// Quality and money sit side by side on purpose: an Optimize Score is an argument about revenue, so
// it should be readable next to the revenue.
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, ArrowUpDown, Download, Loader2, Check, AlertTriangle, X, Square, CheckSquare } from 'lucide-react'
import { LeanList, LeanRow, LeanEmpty, Tag, IconBtn, Tip } from '@/components/lean'

export type UnitRow = {
  // `name` is the OPS name ("Arya 1704/1") — what a human scans the table for. `marketingTitle`
  // is the guest-facing headline, shown small underneath and still searchable.
  id: string; name: string; marketingTitle?: string | null; building: string; unit: string | null
  dead: boolean
  score: number
  titleLen: number
  sections: number
  photos: number
  photoQuality: number | null
  amenities: number
  mustFix: number
  rating: number | null
  reviews: number
  occupancy: number | null
  adr: number | null
  revpar: number | null
  lastOptimized: string | null
  instantBook: boolean | null
  topGap: { label: string; points: number } | null
}

type SortKey = 'name' | 'building' | 'score' | 'sections' | 'photos' | 'amenities' | 'rating' | 'occupancy' | 'adr' | 'revpar' | 'lastOptimized'

const FILTERS: { key: string; label: string; tone: 'bad' | 'warn' | 'none'; test: (u: UnitRow) => boolean }[] = [
  { key: 'weak', label: 'Score under 60', tone: 'bad', test: u => u.score < 60 },
  { key: 'never', label: 'Never optimized', tone: 'warn', test: u => !u.lastOptimized },
  { key: 'thin', label: 'Under 10 photos', tone: 'warn', test: u => u.photos < 10 },
  { key: 'safety', label: 'Missing safety amenity', tone: 'bad', test: u => u.mustFix > 0 },
  { key: 'nodesc', label: 'No description', tone: 'bad', test: u => u.sections === 0 },
  { key: 'noai', label: 'Photo AI never run', tone: 'none', test: u => u.photoQuality == null },
  { key: 'noib', label: 'Instant Book off', tone: 'none', test: u => u.instantBook === false },
]

const TONE: Record<string, string> = {
  bad: 'bg-rose-50 text-rose-700 border-rose-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  none: 'bg-app text-muted border-line',
}

function scoreClass(n: number) {
  return n >= 80 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : n >= 60 ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-rose-50 text-rose-700 ring-rose-200'
}
const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US')}`)
const pct = (n: number | null) => (n == null ? '—' : `${n}%`)
const shortDate = (iso: string | null) => {
  if (!iso) return 'never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function UnitTable({ units, buildings, periodLabel, revLabel, basisLabel, canEdit, showMoney = false }: {
  units: UnitRow[]
  buildings: string[]
  periodLabel: string
  revLabel: string
  basisLabel: string
  canEdit: boolean
  /** canSeeMoney — the server already blanks adr/revpar when false; this hides the columns too. */
  showMoney?: boolean
}) {
  const [q, setQ] = useState('')
  const [building, setBuilding] = useState('')
  const [active, setActive] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortKey>('score')
  const [dir, setDir] = useState<1 | -1>(1)
  const [showDead, setShowDead] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Bulk run state. Runs strictly ONE unit at a time: these routes each make a real Anthropic call
  // and the org rate limit is low enough that a parallel fan-out just produces a wall of 429s.
  const [run, setRun] = useState<{ label: string; done: number; total: number; failed: number } | null>(null)
  // A ref, not state: the loop below closes over its value at call time, so a state flag set by the
  // Stop button would never be seen by the run already in flight.
  const stopRef = useRef(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of FILTERS) c[f.key] = units.filter(u => !u.dead && f.test(u)).length
    return c
  }, [units])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = units.filter(u => {
      if (!showDead && u.dead) return false
      if (building && u.building !== building) return false
      if (needle && !(`${u.name} ${u.building} ${u.unit || ''} ${u.marketingTitle || ''}`.toLowerCase().includes(needle))) return false
      for (const f of FILTERS) if (active.has(f.key) && !f.test(u)) return false
      return true
    })
    const val = (u: UnitRow): string | number => {
      switch (sort) {
        case 'name': return u.name.toLowerCase()
        case 'building': return u.building.toLowerCase()
        case 'lastOptimized': return u.lastOptimized || ''
        default: {
          const v = (u as any)[sort]
          // Nulls always sort to the bottom, whichever direction — "unknown" is not "worst".
          return v == null ? (dir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY) : v
        }
      }
    }
    list = [...list].sort((a, b) => {
      const x = val(a), y = val(b)
      if (typeof x === 'string' || typeof y === 'string') return dir * String(x).localeCompare(String(y))
      return dir * ((x as number) - (y as number))
    })
    return list
  }, [units, q, building, active, sort, dir, showDead])

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(d => (d === 1 ? -1 : 1))
    // Text sorts read best A-Z; number sorts read best worst-first, which is the whole point here.
    else { setSort(k); setDir(k === 'name' || k === 'building' || k === 'lastOptimized' ? 1 : 1) }
  }
  function toggleFilter(k: string) {
    setActive(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  }
  function togglePick(id: string) {
    setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const allShownPicked = rows.length > 0 && rows.every(r => picked.has(r.id))
  function toggleAll() {
    setPicked(s => {
      const n = new Set(s)
      if (allShownPicked) rows.forEach(r => n.delete(r.id))
      else rows.forEach(r => n.add(r.id))
      return n
    })
  }

  function exportCsv() {
    const head = ['Unit', 'Listing title', 'Building', 'Score', 'Title chars', 'Sections', 'Photos', 'Photo quality', 'Amenities', 'Must fix', `Rating ${periodLabel}`, 'Reviews', `Occupancy ${revLabel}`, ...(showMoney ? [`ADR ${revLabel}`, `RevPAR ${revLabel}`] : []), 'Basis', 'Last optimized']
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = rows.map(u => [u.name, u.marketingTitle || '', u.building, u.score, u.titleLen, `${u.sections}/6`, u.photos, u.photoQuality ?? '', u.amenities, u.mustFix, u.rating ?? '', u.reviews, u.occupancy ?? '', ...(showMoney ? [u.adr ?? '', u.revpar ?? ''] : []), basisLabel, u.lastOptimized || ''].map(esc).join(','))
    const csv = [head.map(esc).join(','), ...body].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `stay-units-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  // One unit at a time, with a Stop that actually stops. Every route here is generate-only —
  // NOTHING below pushes to Guesty. A human still approves each unit on its own page.
  async function bulk(label: string, url: string, bodyFor: (id: string) => any) {
    const ids = rows.filter(r => picked.has(r.id)).map(r => r.id)
    if (!ids.length) return
    stopRef.current = false; setRunMsg(null)
    setRun({ label, done: 0, total: ids.length, failed: 0 })
    let failed = 0
    for (let i = 0; i < ids.length; i++) {
      if (stopRef.current) break
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyFor(ids[i])) })
        if (!r.ok) failed++
      } catch { failed++ }
      setRun({ label, done: i + 1, total: ids.length, failed })
    }
    setRun(null)
    const attempted = stopRef.current ? 'stopped early' : 'finished'
    setRunMsg(`${label} ${attempted}: ${ids.length - failed} of ${ids.length} succeeded${failed ? `, ${failed} failed — open those units to see why` : ''}. Nothing was pushed to Guesty; approve each unit on its own page.`)
  }

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-2.5 py-2 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.09em] font-semibold hover:text-ink ${sort === k ? 'text-ink' : 'text-muted'}`}>
        {children}<ArrowUpDown size={10} className={sort === k ? 'opacity-100' : 'opacity-30'} />
      </button>
    </th>
  )

  const visibleTotal = units.filter(u => showDead || !u.dead).length
  const Pick = ({ id, name, size }: { id: string; name: string; size: number }) => (
    <Tip label={picked.has(id) ? 'Unselect' : 'Select for a bulk run'}>
      <button onClick={() => togglePick(id)} aria-label={`Select ${name}`} className="text-muted hover:text-ink">
        {picked.has(id) ? <CheckSquare size={size} className="text-brand-600" /> : <Square size={size} />}
      </button>
    </Tip>
  )

  return (
    <div>
      {/* controls — one line; the quality filters sit behind "Filters" */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search unit, title or nickname…"
            className="w-full rounded-lg border border-line bg-white pl-8 pr-3 py-1.5 text-[12.5px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <select value={building} onChange={e => setBuilding(e.target.value)}
          className="rounded-lg border border-line bg-white px-2 py-1 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200">
          <option value="">All buildings</option>
          {buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <button onClick={() => setShowFilters(f => !f)}
          className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${showFilters || active.size || showDead ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-white text-muted hover:text-ink'}`}>
          Filters{active.size + (showDead ? 1 : 0) ? ` · ${active.size + (showDead ? 1 : 0)}` : ''}
        </button>
        {(active.size > 0 || q || building) && (
          <IconBtn title="Clear search and filters" onClick={() => { setActive(new Set()); setQ(''); setBuilding('') }}><X size={14} /></IconBtn>
        )}
        <span className="text-[12px] text-muted tabular-nums" title={`Money is ${basisLabel} over the last ${revLabel} · rating over ${periodLabel}`}>
          {rows.length}/{visibleTotal}
        </span>
        <IconBtn title="Download these rows as CSV" onClick={exportCsv}><Download size={14} /></IconBtn>
      </div>

      {showFilters && (
        <div className="lh-actions flex flex-wrap gap-1.5 mb-2">
          {FILTERS.map(f => {
            const on = active.has(f.key)
            return (
              <button key={f.key} onClick={() => toggleFilter(f.key)}
                className={`text-[11.5px] font-medium px-2 py-0.5 rounded-full border transition-colors ${on ? 'bg-brand-600 text-white border-brand-600' : TONE[f.tone] + ' hover:opacity-80'}`}>
                {f.label} · {counts[f.key]}
              </button>
            )
          })}
          <button onClick={() => setShowDead(d => !d)}
            className={`text-[11.5px] font-medium px-2 py-0.5 rounded-full border ${showDead ? 'bg-brand-600 text-white border-brand-600' : 'bg-app text-muted border-line'}`}>
            Include inactive
          </button>
        </div>
      )}

      {/* PHONE: a 980px table on a 375px screen is a sideways drag through thirteen columns, and this
          is the board Jon opens standing in a building — so on a phone each unit is ONE row (name,
          building, score, problem tags) and the full metric set opens underneath. Same rows, same
          sort, same filters: `rows` feeds both. The table is unchanged from 640px up. */}
      <div className="sm:hidden">
        {rows.length === 0 ? <LeanEmpty>No units match those filters.</LeanEmpty> : (
          <LeanList>
            {rows.map(u => (
              <LeanRow key={u.id}
                lead={<>
                  {canEdit && <Pick id={u.id} name={u.name} size={16} />}
                  <span className={`shrink-0 inline-flex items-center justify-center min-w-[2.1rem] px-1.5 py-0.5 rounded-md ring-1 font-bold tabular-nums text-[12px] ${scoreClass(u.score)}`} title="Optimize Score">{u.score}</span>
                </>}
                name={<Link href={`/listings/${u.id}`} title={u.marketingTitle || undefined} className={u.dead ? 'opacity-50' : ''}>{u.name}</Link>}
                meta={u.building}
                tags={<>
                  {u.dead && <Tag>Inactive</Tag>}
                  {u.sections === 0 && <Tag tone="rose" title="No description sections">No desc</Tag>}
                  {u.photos < 10 && <Tag tone="rose" title="Under 10 photos">{u.photos} photos</Tag>}
                  {u.mustFix > 0 && <Tag tone="rose" title="Missing a safety amenity">Safety</Tag>}
                  {!u.lastOptimized && <Tag tone="amber">Never optimized</Tag>}
                </>}
              >
                <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
                  <Cell label="Desc" value={`${u.sections}/6`} tone={u.sections === 0 ? 'bad' : u.sections < 6 ? 'warn' : ''} />
                  <Cell label="Photos" value={`${u.photos}${u.photoQuality != null ? ` · ${u.photoQuality}` : ' · —'}`} tone={u.photos < 10 ? 'bad' : ''} />
                  <Cell label="Amen" value={`${u.amenities}${u.mustFix > 0 ? ' ⚠' : ''}`} tone={u.mustFix > 0 ? 'bad' : ''} />
                  <Cell label="Rating" value={u.rating != null ? `${u.rating.toFixed(2)}★` : '—'} />
                  <Cell label="Occ" value={pct(u.occupancy)} />
                  {showMoney && <Cell label="ADR" value={money(u.adr)} />}
                  {showMoney && <Cell label="RevPAR" value={money(u.revpar)} />}
                  <Cell label="Optimized" value={shortDate(u.lastOptimized)} tone={u.lastOptimized ? '' : 'warn'} />
                </dl>
                {u.marketingTitle && u.marketingTitle !== u.name && <p className="text-[11.5px] text-muted">{u.marketingTitle}</p>}
                <p className="text-[12px] text-muted">
                  Next fix: {u.topGap ? <span><b className="text-ink tabular-nums">+{u.topGap.points.toFixed(1)}</b> {u.topGap.label}</span> : <span className="text-emerald-700">nothing</span>}
                </p>
              </LeanRow>
            ))}
          </LeanList>
        )}
      </div>

      {/* table */}
      <div className="hidden rounded-2xl border border-line bg-white overflow-x-auto sm:block">
        <table className="w-full text-[12.5px] min-w-[980px]">
          <thead>
            <tr className="border-b border-line">
              {canEdit && (
                <th className="px-2.5 py-2 w-8">
                  <Tip label={allShownPicked ? 'Unselect all shown' : 'Select all shown'}>
                    <button onClick={toggleAll} aria-label="Select all shown" className="text-muted hover:text-ink">
                      {allShownPicked ? <CheckSquare size={14} /> : <Square size={14} />}
                    </button>
                  </Tip>
                </th>
              )}
              <Th k="name">Unit</Th>
              <Th k="building">Building</Th>
              <Th k="score" right>Score</Th>
              <Th k="sections" right>Desc</Th>
              <Th k="photos" right>Photos</Th>
              <Th k="amenities" right>Amen</Th>
              <Th k="rating" right>Rating</Th>
              <Th k="occupancy" right>Occ</Th>
              {showMoney && <Th k="adr" right>ADR</Th>}
              {showMoney && <Th k="revpar" right>RevPAR</Th>}
              <Th k="lastOptimized">Optimized</Th>
              <th className="px-2.5 py-2 text-left text-[10px] uppercase tracking-[0.09em] font-semibold text-muted whitespace-nowrap">Next fix</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={canEdit ? 13 : 12} className="px-4 py-6 text-center text-[13px] text-muted">No units match those filters.</td></tr>
            )}
            {rows.map(u => (
              <tr key={u.id} className={`border-b border-line/60 last:border-b-0 hover:bg-app/40 ${u.dead ? 'opacity-50' : ''}`}>
                {canEdit && (
                  <td className="px-2.5 py-1.5"><Pick id={u.id} name={u.name} size={14} /></td>
                )}
                <td className="px-2.5 py-1.5 max-w-[280px]">
                  {/* The guest-facing title is on hover — the ops name is what people scan for. */}
                  <Link href={`/listings/${u.id}`} title={u.marketingTitle && u.marketingTitle !== u.name ? u.marketingTitle : undefined} className="font-semibold text-ink hover:text-brand-700 block truncate">{u.name}</Link>
                </td>
                <td className="px-2.5 py-1.5 text-muted whitespace-nowrap">{u.building}</td>
                <td className="px-2.5 py-1.5 text-right">
                  <span className={`inline-flex items-center justify-center min-w-[2.1rem] px-1.5 py-0.5 rounded-md ring-1 font-bold tabular-nums ${scoreClass(u.score)}`}>{u.score}</span>
                </td>
                <td className={`px-2.5 py-1.5 text-right tabular-nums ${u.sections === 0 ? 'text-rose-700 font-semibold' : u.sections < 6 ? 'text-amber-700' : 'text-muted'}`} title="Description sections filled, of 6">{u.sections}/6</td>
                <td className={`px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap ${u.photos < 10 ? 'text-rose-700 font-semibold' : 'text-ink'}`} title="Photo count · AI photo quality">
                  {u.photos}{u.photoQuality != null ? <span className="text-muted"> · {u.photoQuality}</span> : <span className="text-muted"> · —</span>}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-muted">
                  {u.amenities}{u.mustFix > 0 && <span title="Missing a safety amenity"><AlertTriangle size={11} className="inline ml-1 text-rose-600" /></span>}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-muted whitespace-nowrap">{u.rating != null ? `${u.rating.toFixed(2)}★` : '—'}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-ink">{pct(u.occupancy)}</td>
                {showMoney && <td className="px-2.5 py-1.5 text-right tabular-nums text-ink">{money(u.adr)}</td>}
                {showMoney && <td className="px-2.5 py-1.5 text-right tabular-nums text-ink">{money(u.revpar)}</td>}
                <td className={`px-2.5 py-1.5 whitespace-nowrap ${u.lastOptimized ? 'text-muted' : 'text-amber-700 font-semibold'}`}>{shortDate(u.lastOptimized)}</td>
                <td className="px-2.5 py-1.5 text-muted max-w-[220px]">
                  {u.topGap ? <span className="truncate block" title={u.topGap.label}><b className="text-ink tabular-nums">+{u.topGap.points.toFixed(1)}</b> {u.topGap.label}</span> : <span className="text-emerald-700">nothing</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* bulk bar — generate-only, one unit at a time (see bulk() above) */}
      {canEdit && picked.size > 0 && (
        <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 flex flex-wrap items-center gap-2"
          title="Generate-only: these draft and store, they never push to Guesty. Runs one unit at a time to stay inside the AI rate limit.">
          <span className="text-[12.5px] font-semibold text-brand-700">{picked.size} selected</span>
          {run ? (
            <span className="text-[12px] text-brand-700 inline-flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> {run.label} {run.done}/{run.total}{run.failed ? ` · ${run.failed} failed` : ''}
              <button onClick={() => { stopRef.current = true }} className="rounded-lg border border-brand-300 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-brand-700">Stop</button>
            </span>
          ) : (
            <>
              <button onClick={() => bulk('Photo AI', '/api/optimize-photos', id => ({ listingId: id }))}
                className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand-50">Run photo AI</button>
              <button onClick={() => bulk('Enhance', '/api/photo-enhance', id => ({ listingId: id }))}
                className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand-50">Enhance photos</button>
              <button onClick={() => bulk('Mirror originals', '/api/photo-enhance', id => ({ listingId: id, mirrorOnly: true }))}
                className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand-50">Back up originals</button>
              <Tag tone="brand" title="Nothing here pushes to Guesty — approve each unit on its own page">Draft only</Tag>
              <span className="ml-auto"><IconBtn title="Clear selection" onClick={() => setPicked(new Set())}><X size={14} /></IconBtn></span>
            </>
          )}
        </div>
      )}
      {runMsg && (
        <p className="mt-2 text-[12.5px] text-ink flex items-start gap-1.5">
          <Check size={14} className="text-emerald-600 mt-0.5 shrink-0" /> {runMsg}
        </p>
      )}
    </div>
  )
}

// One labelled metric in the phone card list. Mirrors the tone rules the table cells use, so a
// thin photo set or a missing safety amenity reads the same in both layouts.
function Cell({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.09em] font-semibold text-muted">{label}</dt>
      <dd className={`tabular-nums truncate ${tone === 'bad' ? 'text-rose-700 font-semibold' : tone === 'warn' ? 'text-amber-700 font-semibold' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}

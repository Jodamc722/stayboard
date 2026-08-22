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

export type UnitRow = {
  id: string; name: string; building: string; unit: string | null
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

export function UnitTable({ units, buildings, periodLabel, revLabel, basisLabel, canEdit }: {
  units: UnitRow[]
  buildings: string[]
  periodLabel: string
  revLabel: string
  basisLabel: string
  canEdit: boolean
}) {
  const [q, setQ] = useState('')
  const [building, setBuilding] = useState('')
  const [active, setActive] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortKey>('score')
  const [dir, setDir] = useState<1 | -1>(1)
  const [showDead, setShowDead] = useState(false)
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
      if (needle && !(`${u.name} ${u.building} ${u.unit || ''}`.toLowerCase().includes(needle))) return false
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
    const head = ['Unit', 'Building', 'Score', 'Title chars', 'Sections', 'Photos', 'Photo quality', 'Amenities', 'Must fix', `Rating ${periodLabel}`, 'Reviews', `Occupancy ${revLabel}`, `ADR ${revLabel}`, `RevPAR ${revLabel}`, 'Basis', 'Last optimized']
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = rows.map(u => [u.name, u.building, u.score, u.titleLen, `${u.sections}/6`, u.photos, u.photoQuality ?? '', u.amenities, u.mustFix, u.rating ?? '', u.reviews, u.occupancy ?? '', u.adr ?? '', u.revpar ?? '', basisLabel, u.lastOptimized || ''].map(esc).join(','))
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

  return (
    <div>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search unit, title or nickname…"
            className="w-full rounded-xl border border-line bg-white pl-9 pr-3 py-2 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <select value={building} onChange={e => setBuilding(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200">
          <option value="">All buildings</option>
          {buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-muted hover:text-ink">
          <Download size={13} /> CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {FILTERS.map(f => {
          const on = active.has(f.key)
          return (
            <button key={f.key} onClick={() => toggleFilter(f.key)}
              className={`text-[11.5px] font-medium px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-brand-600 text-white border-brand-600' : TONE[f.tone] + ' hover:opacity-80'}`}>
              {f.label} · {counts[f.key]}
            </button>
          )
        })}
        <button onClick={() => setShowDead(d => !d)}
          className={`text-[11.5px] font-medium px-2.5 py-1 rounded-full border ${showDead ? 'bg-brand-600 text-white border-brand-600' : 'bg-app text-muted border-line'}`}>
          Include inactive
        </button>
        {(active.size > 0 || q || building) && (
          <button onClick={() => { setActive(new Set()); setQ(''); setBuilding('') }}
            className="text-[11.5px] font-medium px-2.5 py-1 rounded-full border border-line bg-white text-muted hover:text-ink inline-flex items-center gap-1">
            <X size={11} /> Clear
          </button>
        )}
      </div>

      <div className="text-[12px] text-muted mb-2">
        Showing <b className="text-ink tabular-nums">{rows.length}</b> of {units.filter(u => showDead || !u.dead).length} units · money is <b className="text-ink">{basisLabel}</b> over the last {revLabel} · rating over {periodLabel}
      </div>

      {/* PHONE: the same twelve columns as a stacked card per unit. A 980px table on a 375px
          screen is a sideways drag through thirteen columns to find one number, and this is the
          board Jon opens standing in a building — so on a phone each unit becomes one card with
          its headline (name, building, score) on top and every metric below as a labelled cell.
          Same rows, same sort, same filters: `rows` feeds both. The table is unchanged from 640px
          up. */}
      <div className="rounded-2xl border border-line bg-white divide-y divide-line sm:hidden">
        {rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted">No units match those filters.</div>
        )}
        {rows.map(u => (
          <div key={u.id} className={`p-3 ${u.dead ? 'opacity-50' : ''}`}>
            <div className="flex items-start gap-2">
              {canEdit && (
                <button onClick={() => togglePick(u.id)} aria-label={`Select ${u.name}`} className="text-muted mt-0.5 shrink-0">
                  {picked.has(u.id) ? <CheckSquare size={16} className="text-brand-600" /> : <Square size={16} />}
                </button>
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/listings/${u.id}`} className="block font-semibold text-ink text-[13.5px] leading-snug break-words">{u.name}</Link>
                <div className="text-[11.5px] text-muted">{u.building}</div>
              </div>
              <span className={`shrink-0 inline-flex items-center justify-center min-w-[2.1rem] px-1.5 py-0.5 rounded-md ring-1 font-bold tabular-nums ${scoreClass(u.score)}`}>{u.score}</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
              <Cell label="Desc" value={`${u.sections}/6`} tone={u.sections === 0 ? 'bad' : u.sections < 6 ? 'warn' : ''} />
              <Cell label="Photos" value={`${u.photos}${u.photoQuality != null ? ` · ${u.photoQuality}` : ' · —'}`} tone={u.photos < 10 ? 'bad' : ''} />
              <Cell label="Amen" value={`${u.amenities}${u.mustFix > 0 ? ' ⚠' : ''}`} tone={u.mustFix > 0 ? 'bad' : ''} />
              <Cell label="Rating" value={u.rating != null ? `${u.rating.toFixed(2)}★` : '—'} />
              <Cell label="Occ" value={pct(u.occupancy)} />
              <Cell label="ADR" value={money(u.adr)} />
              <Cell label="RevPAR" value={money(u.revpar)} />
              <Cell label="Optimized" value={shortDate(u.lastOptimized)} tone={u.lastOptimized ? '' : 'warn'} />
            </dl>
            <div className="mt-2 text-[12px] text-muted">
              <span className="text-[10px] uppercase tracking-[0.09em] font-semibold text-muted">Next fix</span>{' '}
              {u.topGap ? <span><b className="text-ink tabular-nums">+{u.topGap.points.toFixed(1)}</b> {u.topGap.label}</span> : <span className="text-emerald-700">nothing</span>}
            </div>
          </div>
        ))}
      </div>

      {/* table */}
      <div className="hidden rounded-2xl border border-line bg-white overflow-x-auto sm:block">
        <table className="w-full text-[12.5px] min-w-[980px]">
          <thead>
            <tr className="border-b border-line">
              {canEdit && (
                <th className="px-2.5 py-2 w-8">
                  <button onClick={toggleAll} aria-label="Select all shown" className="text-muted hover:text-ink">
                    {allShownPicked ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
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
              <Th k="adr" right>ADR</Th>
              <Th k="revpar" right>RevPAR</Th>
              <Th k="lastOptimized">Optimized</Th>
              <th className="px-2.5 py-2 text-left text-[10px] uppercase tracking-[0.09em] font-semibold text-muted whitespace-nowrap">Next fix</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={canEdit ? 13 : 12} className="px-4 py-10 text-center text-sm text-muted">No units match those filters.</td></tr>
            )}
            {rows.map(u => (
              <tr key={u.id} className={`border-b border-line/60 last:border-b-0 hover:bg-app/40 ${u.dead ? 'opacity-50' : ''}`}>
                {canEdit && (
                  <td className="px-2.5 py-2">
                    <button onClick={() => togglePick(u.id)} aria-label={`Select ${u.name}`} className="text-muted hover:text-ink">
                      {picked.has(u.id) ? <CheckSquare size={14} className="text-brand-600" /> : <Square size={14} />}
                    </button>
                  </td>
                )}
                <td className="px-2.5 py-2 max-w-[280px]">
                  <Link href={`/listings/${u.id}`} className="font-semibold text-ink hover:text-brand-700 block truncate">{u.name}</Link>
                </td>
                <td className="px-2.5 py-2 text-muted whitespace-nowrap">{u.building}</td>
                <td className="px-2.5 py-2 text-right">
                  <span className={`inline-flex items-center justify-center min-w-[2.1rem] px-1.5 py-0.5 rounded-md ring-1 font-bold tabular-nums ${scoreClass(u.score)}`}>{u.score}</span>
                </td>
                <td className={`px-2.5 py-2 text-right tabular-nums ${u.sections === 0 ? 'text-rose-700 font-semibold' : u.sections < 6 ? 'text-amber-700' : 'text-muted'}`}>{u.sections}/6</td>
                <td className={`px-2.5 py-2 text-right tabular-nums whitespace-nowrap ${u.photos < 10 ? 'text-rose-700 font-semibold' : 'text-ink'}`}>
                  {u.photos}{u.photoQuality != null ? <span className="text-muted"> · {u.photoQuality}</span> : <span className="text-muted"> · —</span>}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums text-muted">
                  {u.amenities}{u.mustFix > 0 && <AlertTriangle size={11} className="inline ml-1 text-rose-600" />}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums text-muted whitespace-nowrap">{u.rating != null ? `${u.rating.toFixed(2)}★` : '—'}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-ink">{pct(u.occupancy)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-ink">{money(u.adr)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-ink">{money(u.revpar)}</td>
                <td className={`px-2.5 py-2 whitespace-nowrap ${u.lastOptimized ? 'text-muted' : 'text-amber-700 font-semibold'}`}>{shortDate(u.lastOptimized)}</td>
                <td className="px-2.5 py-2 text-muted max-w-[220px]">
                  {u.topGap ? <span className="truncate block"><b className="text-ink tabular-nums">+{u.topGap.points.toFixed(1)}</b> {u.topGap.label}</span> : <span className="text-emerald-700">nothing</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* bulk bar */}
      {canEdit && picked.size > 0 && (
        <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-semibold text-brand-700">{picked.size} unit{picked.size === 1 ? '' : 's'} selected</span>
          {run ? (
            <span className="text-[12.5px] text-brand-700 inline-flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> {run.label} — {run.done} of {run.total}{run.failed ? ` (${run.failed} failed)` : ''}
              <button onClick={() => { stopRef.current = true }} className="ml-1 rounded-lg border border-brand-300 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-brand-700">Stop</button>
            </span>
          ) : (
            <>
              <button onClick={() => bulk('Photo AI', '/api/optimize-photos', id => ({ listingId: id }))}
                className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand-50">Run photo AI</button>
              <button onClick={() => bulk('Enhance', '/api/photo-enhance', id => ({ listingId: id }))}
                className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand-50">Enhance photos</button>
              <button onClick={() => bulk('Mirror originals', '/api/photo-enhance', id => ({ listingId: id, mirrorOnly: true }))}
                className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand-50">Back up originals</button>
              <button onClick={() => setPicked(new Set())}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-muted hover:text-ink">Clear</button>
              <span className="text-[11.5px] text-brand-700/80 basis-full">Generate-only — these draft and store, they never push to Guesty. Runs one unit at a time to stay inside the AI rate limit.</span>
            </>
          )}
        </div>
      )}
      {runMsg && (
        <div className="mt-3 rounded-xl border border-line bg-white px-4 py-2.5 text-[12.5px] text-ink inline-flex items-start gap-2">
          <Check size={14} className="text-emerald-600 mt-0.5 shrink-0" /> {runMsg}
        </div>
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

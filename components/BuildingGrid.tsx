'use client'
// Properties list — one row per building (lean pass, 2026-09-22; was a card grid).
// Rows default to COLLAPSED (Jon 2026-08-06). The collapsed line keeps score, city, weak units,
// open work and rating visible so a closed list is still scannable for problems; the name stays a
// link, so every building is one click from its units.
//
// CLEAN-UP (Jon, 2026-11-20: "some data is noisy and unclean"):
//   • ORDER. Worst average score first put two one-unit buildings ("Jons" 32, "Crosby" 38) above
//     35-unit ones. The list now opens on "Needs work": most units under 60 first, then most units
//     in the 60–74 band, then the lower score. Score, Units and A–Z are one click away.
//   • NEW IS NOT WEAK. A unit listed in the last 60 days with no review yet reads "new": it is not
//     counted as weak, and a building made only of such units gets a grey score and a "New" tag.
//   • ONLY BUILDINGS WITH A LIVE UNIT. 12 of the 36 rows had no active unit at all (Waves and
//     eleven single retired listings). They sit behind one line at the bottom.
//   • Open rows are remembered for the visit, not for ever, so a row no longer greets you open days
//     after somebody looked at it.
import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { band, bandUi, buildingSlug } from '@/lib/optimize-score'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { LeanList, LeanRow, Tag, IconBtn } from '@/components/lean'

const KEY = 'stayboard:buildings:open'
const SORT_KEY = 'stayboard:buildings:sort'

export type BuildingRow = {
  name: string; city?: string; unitCount: number; beds: number; sleeps: number; active: number
  avg: number | null; weak: number
  /** Active units scoring 60–74 ("room to improve"), new units left out. */
  mid?: number
  /** Active units listed in the last 60 days with no review yet. */
  fresh?: number
  rating: number | null; reviewCount: number
  ratingP: number | null; reviewCountP: number
}

type SortKey = 'work' | 'score' | 'units' | 'name'
const SORTS: { key: SortKey; label: string; title: string }[] = [
  { key: 'work', label: 'Needs work', title: 'Most units scoring under 60 first, then most in the 60–74 band' },
  { key: 'score', label: 'Score', title: 'Lowest building Optimize Score first' },
  { key: 'units', label: 'Units', title: 'Most active units first' },
  { key: 'name', label: 'A–Z', title: 'By name' },
]

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

export function BuildingGrid({ buildings, workByBuilding, periodLabel }: {
  buildings: BuildingRow[]; workByBuilding: Record<string, number>; periodLabel: string
}) {
  // Starts empty = everything collapsed, which is exactly what the server rendered — so there is
  // no hydration mismatch. The saved set is applied in the effect below, after mount.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [sort, setSort] = useState<SortKey>('work')
  const [showIdle, setShowIdle] = useState(false)

  useEffect(() => {
    try {
      const s = localStorage.getItem(SORT_KEY)
      if (s && SORTS.some(x => x.key === s)) setSort(s as SortKey)
    } catch {}
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return
      const next: Record<string, boolean> = {}
      for (const n of arr) if (typeof n === 'string') next[n] = true
      setOpen(next)
    } catch {}
  }, [])

  // Persist only the OPEN names. Storing the closed ones instead would silently re-open every
  // building the day a new one is added to the portfolio.
  const persist = useCallback((next: Record<string, boolean>) => {
    try { localStorage.setItem(KEY, JSON.stringify(Object.keys(next).filter(k => next[k]))) } catch {}
  }, [])

  const toggle = useCallback((name: string) => {
    setOpen(prev => { const next = { ...prev, [name]: !prev[name] }; persist(next); return next })
  }, [persist])

  const pickSort = useCallback((k: SortKey) => {
    setSort(k)
    try { localStorage.setItem(SORT_KEY, k) } catch {}
  }, [])

  const { live, idle } = useMemo(() => {
    const live = buildings.filter(b => b.active > 0)
    const idle = buildings.filter(b => b.active === 0).sort((a, b) => b.unitCount - a.unitCount || a.name.localeCompare(b.name))
    const byScore = (a: BuildingRow, b: BuildingRow) => (a.avg ?? 999) - (b.avg ?? 999)
    live.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'units') return b.active - a.active || byScore(a, b)
      if (sort === 'score') return byScore(a, b) || b.active - a.active
      return b.weak - a.weak || (b.mid || 0) - (a.mid || 0) || byScore(a, b) || b.active - a.active
    })
    return { live, idle }
  }, [buildings, sort])

  const setAll = useCallback((on: boolean) => {
    const next: Record<string, boolean> = {}
    if (on) for (const b of live) next[b.name] = true
    setOpen(next); persist(next)
  }, [live, persist])

  const openCount = live.reduce((n, b) => n + (open[b.name] ? 1 : 0), 0)
  const allOpen = openCount === live.length && live.length > 0
  const idleUnits = idle.reduce((n, b) => n + b.unitCount, 0)
  const allTime = /all/i.test(periodLabel)

  const row = (b: BuildingRow) => {
    const fresh = b.fresh || 0
    const allNew = b.active > 0 && fresh === b.active
    const ui = b.avg != null ? bandUi(band(b.avg)) : null
    const href = `/buildings/${buildingSlug(b.name)}`
    const work = workByBuilding[b.name] || 0
    const inactive = b.unitCount - b.active
    return (
      <LeanRow key={b.name}
        open={!!open[b.name]} onToggle={() => toggle(b.name)}
        lead={
          <span title={b.avg == null ? 'No active units scored' : allNew ? `New: no reviews yet · Optimize Score ${b.avg}` : `Building Optimize Score · ${ui!.label}`}
            className={`shrink-0 inline-flex items-center justify-center w-9 py-1 rounded-lg text-[12.5px] font-bold tabular-nums ${b.avg != null && !allNew ? `ring-1 ${ui!.ring}` : 'bg-app text-muted'}`}>
            {b.avg ?? '—'}
          </span>
        }
        name={<Link href={href} prefetch={false} onClick={e => e.stopPropagation()} className="hover:text-brand-700">{b.name}</Link>}
        meta={[b.city, b.active > 0 ? plural(b.active, 'unit') : `${b.unitCount} inactive`].filter(Boolean).join(' · ')}
        tags={<>
          {b.weak > 0 && <Tag tone="rose" title="Active units with an Optimize Score under 60 (new units not counted)">{b.weak} weak</Tag>}
          {fresh > 0 && <Tag title="Listed in the last 60 days with no review yet: not counted as weak">{allNew ? 'New' : `${fresh} new`}</Tag>}
          {work > 0 && <Tag title="Open field requests (open or in progress)">{work} open</Tag>}
          {b.rating != null && <Tag title={`Guest rating, all time · ${b.reviewCount} reviews`}>{b.rating.toFixed(2)}★</Tag>}
        </>}
        actions={<IconBtn title="Open this building's units" href={href}><ArrowRight size={14} /></IconBtn>}
      >
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          {b.rating != null
            ? <Stat label="Rating, all time" value={`${b.rating.toFixed(2)}★ · ${plural(b.reviewCount, 'review')}`} />
            : b.active > 0 ? <Stat label="Reviews" value="none yet" /> : null}
          {!allTime && b.ratingP != null && <Stat label={`Rating, ${periodLabel.toLowerCase()}`} value={`${b.ratingP.toFixed(2)}★ · ${plural(b.reviewCountP, 'review')}`} />}
          {b.active > 0 && <Stat label="Units" value={`${b.active}${inactive > 0 ? ` (+${inactive} inactive)` : ''}`} />}
          {b.active > 0 && (b.weak > 0 || (b.mid || 0) > 0) && <Stat label="Under 60 / 60–74" value={`${b.weak} / ${b.mid || 0}`} />}
          <Stat label="Bedrooms" value={String(b.beds)} />
          <Stat label="Sleeps" value={String(b.sleeps)} />
          {ui && <Stat label="Band" value={allNew ? 'New' : ui.label} />}
        </div>
      </LeanRow>
    )
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line bg-white p-0.5" role="radiogroup" aria-label="Order buildings by">
          {SORTS.map(s => (
            <button key={s.key} type="button" role="radio" aria-checked={sort === s.key} onClick={() => pickSort(s.key)} title={s.title}
              className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors ${sort === s.key ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setAll(!allOpen)} title={`${openCount} of ${live.length} open`}
          className="ml-auto text-[12px] font-semibold text-muted hover:text-ink">
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <LeanList>{live.map(row)}</LeanList>

      {idle.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowIdle(v => !v)} aria-expanded={showIdle}
            title="Buildings whose every listing is inactive in Guesty. Not counted in the score or the ratings above."
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink">
            <ChevronRight size={13} className={showIdle ? 'rotate-90 transition-transform' : 'transition-transform'} />
            {plural(idle.length, 'building')} with no active unit · {plural(idleUnits, 'inactive listing')}
          </button>
          {showIdle && <div className="mt-2"><LeanList>{idle.map(row)}</LeanList></div>}
        </div>
      )}
    </>
  )
}

// One labelled number in the expand. A rating with no reviews is not printed at all (it used to
// show "Rating, all time —" twice on a building nobody has reviewed) — never 0.00, so an empty
// window can't be misread as a terrible score.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-lg border border-line bg-app/50 px-2 py-1">
      <span className="text-muted">{label}</span> <b className="text-ink tabular-nums">{value}</b>
    </span>
  )
}

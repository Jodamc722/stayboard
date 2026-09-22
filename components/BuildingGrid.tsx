'use client'
// Properties list — one row per building (lean pass, 2026-09-22; was a card grid).
// Rows default to COLLAPSED and each row's open/closed state is remembered per person in
// localStorage (Jon 2026-08-06). The collapsed line keeps score, city, open work, weak units and
// rating visible so a closed list is still scannable for problems; the name stays a link, so every
// building is one click from its units.
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { band, bandUi, buildingSlug } from '@/lib/optimize-score'
import { ArrowRight } from 'lucide-react'
import { LeanList, LeanRow, Tag, IconBtn } from '@/components/lean'

const KEY = 'stayboard:buildings:open'

export type BuildingRow = {
  name: string; city?: string; unitCount: number; beds: number; sleeps: number; active: number
  avg: number | null; weak: number
  rating: number | null; reviewCount: number
  ratingP: number | null; reviewCountP: number
}

export function BuildingGrid({ buildings, workByBuilding, periodLabel }: {
  buildings: BuildingRow[]; workByBuilding: Record<string, number>; periodLabel: string
}) {
  // Starts empty = everything collapsed, which is exactly what the server rendered — so there is
  // no hydration mismatch. The saved set is applied in the effect below, after mount.
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
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

  const setAll = useCallback((on: boolean) => {
    const next: Record<string, boolean> = {}
    if (on) for (const b of buildings) next[b.name] = true
    setOpen(next); persist(next)
  }, [buildings, persist])

  const openCount = buildings.reduce((n, b) => n + (open[b.name] ? 1 : 0), 0)
  const allOpen = openCount === buildings.length && buildings.length > 0

  return (
    <>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setAll(!allOpen)} title={`${openCount} of ${buildings.length} open`}
          className="text-[12px] font-semibold text-muted hover:text-ink">
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <LeanList>
        {buildings.map(b => {
          const ui = b.avg != null ? bandUi(band(b.avg)) : null
          const href = `/buildings/${buildingSlug(b.name)}`
          const work = workByBuilding[b.name] || 0
          return (
            <LeanRow key={b.name}
              open={!!open[b.name]} onToggle={() => toggle(b.name)}
              lead={
                <span title={ui ? `Building Optimize Score · ${ui.label}` : 'No active units scored'}
                  className={`shrink-0 inline-flex items-center justify-center w-9 py-1 rounded-lg text-[12.5px] font-bold tabular-nums ${b.avg != null ? `ring-1 ${ui!.ring}` : 'bg-app text-muted'}`}>
                  {b.avg ?? '—'}
                </span>
              }
              name={<Link href={href} prefetch={false} onClick={e => e.stopPropagation()} className="hover:text-brand-700">{b.name}</Link>}
              meta={[b.city, `${b.unitCount} units`].filter(Boolean).join(' · ')}
              tags={<>
                {work > 0 && <Tag tone="amber" title="Open field requests (open or in progress)">{work} open</Tag>}
                {b.weak > 0 && <Tag tone="rose" title="Active units with an Optimize Score under 60">{b.weak} weak</Tag>}
                {b.rating != null && <Tag title={`Guest rating, all time · ${b.reviewCount} reviews`}>{b.rating.toFixed(2)}★</Tag>}
              </>}
              actions={<IconBtn title="Open this building's units" href={href}><ArrowRight size={14} /></IconBtn>}
            >
              <div className="flex flex-wrap gap-1.5 text-[12px]">
                <Stat label="Rating, all time" value={b.rating != null ? `${b.rating.toFixed(2)}★ · ${b.reviewCount}` : '—'} />
                <Stat label={`Rating, ${periodLabel.toLowerCase()}`} value={b.ratingP != null ? `${b.ratingP.toFixed(2)}★ · ${b.reviewCountP}` : '—'} />
                <Stat label="Units" value={`${b.unitCount}${b.active !== b.unitCount ? ` (${b.active} active)` : ''}`} />
                <Stat label="Bedrooms" value={String(b.beds)} />
                <Stat label="Sleeps" value={String(b.sleeps)} />
                {ui && <Stat label="Band" value={ui.label} />}
              </div>
            </LeanRow>
          )
        })}
      </LeanList>
    </>
  )
}

// One labelled number in the expand. A `—` rating means no reviews in that span — never 0.00, so an
// empty window can't be misread as a terrible score.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-lg border border-line bg-app/50 px-2 py-1">
      <span className="text-muted">{label}</span> <b className="text-ink tabular-nums">{value}</b>
    </span>
  )
}

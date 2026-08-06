'use client'
// Properties grid, client-side so each building card can collapse (Jon 2026-08-06).
// Cards default to COLLAPSED — 35 buildings fit on one screen — and each card's open/closed
// state is remembered per person in localStorage. Only the body (ratings + specs + footer)
// collapses; the header keeps name, score, city and the work/needs-work badges visible so a
// collapsed portfolio is still scannable for problems. The building name stays a link, so a
// collapsed card is still one click from its units.
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { band, bandUi, buildingSlug } from '@/lib/optimize-score'
import { Building2, BedDouble, Users, Wrench, MapPin, ArrowRight, AlertTriangle, Star, ChevronRight } from 'lucide-react'

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
      <div className="mb-3 flex items-center justify-end gap-2 text-[12px]">
        <span className="text-muted">{openCount} of {buildings.length} expanded</span>
        <button type="button" onClick={() => setAll(!allOpen)}
          className="px-2.5 py-1 rounded-lg border border-line bg-white font-semibold text-muted hover:text-ink hover:border-brand-300 transition-colors">
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {buildings.map(b => {
          const ui = b.avg != null ? bandUi(band(b.avg)) : null
          const isOpen = !!open[b.name]
          const panelId = `b-${buildingSlug(b.name)}`
          return (
            <div key={b.name} className="rounded-2xl border border-line bg-white overflow-hidden hover:border-brand-300 hover:shadow-soft transition-all">
              <div className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 min-w-0">
                    {/* Chevron toggles; the name navigates. Separate controls so a collapsed
                        card is still one click from its units. */}
                    <button type="button" onClick={() => toggle(b.name)}
                      aria-expanded={isOpen} aria-controls={panelId}
                      aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${b.name}`}
                      className="p-1 -ml-1 rounded-md text-muted hover:text-ink hover:bg-app transition-colors shrink-0">
                      <ChevronRight size={15} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </button>
                    <Link href={`/buildings/${buildingSlug(b.name)}`} prefetch={false}
                      className="group font-semibold text-ink text-sm inline-flex items-center gap-1.5 truncate hover:text-brand-700 transition-colors">
                      <Building2 size={15} className="text-brand-600 shrink-0" />
                      <span className="truncate">{b.name}</span>
                    </Link>
                  </div>
                  {b.avg != null && ui && (
                    <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-lg text-sm font-bold tabular-nums ring-1 shrink-0 ${ui.ring}`} title="Building Optimize Score">{b.avg}</span>
                  )}
                </div>

                {/* Always visible, collapsed or not — a closed card must still surface problems. */}
                <div className="flex items-center gap-3 mt-1 flex-wrap pl-5">
                  {b.city && <p className="text-[11px] text-muted inline-flex items-center gap-1"><MapPin size={10} /> {b.city}</p>}
                  {workByBuilding[b.name] ? (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                      <Wrench size={10} /> {workByBuilding[b.name]} open
                    </span>
                  ) : null}
                  {b.weak > 0 && (
                    <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                      <AlertTriangle size={10} /> {b.weak} need work
                    </span>
                  )}
                  {!isOpen && b.rating != null && (
                    <span className="text-[10px] font-semibold text-muted inline-flex items-center gap-1" title="Overall guest rating">
                      <Star size={10} className="text-amber-500 fill-amber-500" /> {b.rating.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {isOpen && (
                <div id={panelId} className="border-t border-line">
                  <div className="grid grid-cols-2 divide-x divide-line border-b border-line text-center">
                    <Rating label="Overall" value={b.rating} count={b.reviewCount} />
                    <Rating label={periodLabel} value={b.ratingP} count={b.reviewCountP} />
                  </div>

                  <div className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
                    <Mini label="Units" value={b.unitCount} />
                    <Mini label="Bedrooms" value={b.beds} Icon={BedDouble} />
                    <Mini label="Sleeps" value={b.sleeps} Icon={Users} />
                  </div>

                  <Link href={`/buildings/${buildingSlug(b.name)}`} prefetch={false}
                    className="group px-4 py-2.5 flex items-center justify-between text-[11px] font-medium text-muted hover:text-brand-700 transition-colors">
                    <span>{ui ? ui.label : 'View units'}</span>
                    <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// One rating cell. `null` means no reviews in that span — shown as an em dash, never as 0.00,
// so an empty window can't be misread as a terrible score.
function Rating({ label, value, count }: { label: string; value: number | null; count: number }) {
  return (
    <div className="py-2.5">
      <div className="text-base font-bold text-ink tabular-nums inline-flex items-center gap-1 justify-center">
        {value != null ? (
          <><Star size={12} className="text-amber-500 fill-amber-500" /> {value.toFixed(2)}</>
        ) : (
          <span className="text-muted font-semibold">—</span>
        )}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-0.5">
        {label}{value != null && <span className="normal-case tracking-normal"> · {count}</span>}
      </div>
    </div>
  )
}

function Mini({ label, value, Icon }: { label: string; value: number; Icon?: any }) {
  return (
    <div className="py-2.5">
      <div className="text-base font-bold text-ink tabular-nums inline-flex items-center gap-1 justify-center">
        {Icon && <Icon size={12} className="text-muted" />} {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-0.5">{label}</div>
    </div>
  )
}

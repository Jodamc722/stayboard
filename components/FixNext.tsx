'use client'
// The portfolio worklist. No new model and no second opinion to keep in sync: the Optimize Score
// already knows what is wrong with every unit — each factor carries a `got` and a `max` — so this
// is those gaps across all 233 units, converted into the points they cost the score, grouped, and
// deep-linked to the panel that closes them.
//
// One rule, deliberately: if the list is capped, it SAYS it is capped. A worklist that quietly stops
// at the top 20 reads as "you're done" when you aren't.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, ChevronRight, Wrench } from 'lucide-react'

export type FixItem = {
  unitId: string; unitName: string; building: string
  pillar: 'title' | 'description' | 'photos' | 'amenities' | 'settings'
  label: string; note: string; points: number; severity: 'good' | 'warn' | 'bad'
}

const PANEL_FOR: Record<FixItem['pillar'], string> = {
  title: 'content', description: 'content', photos: 'photos', amenities: 'amenities', settings: 'settings-panel',
}
const PILLAR_LABEL: Record<FixItem['pillar'], string> = {
  title: 'Title', description: 'Description', photos: 'Photos', amenities: 'Amenities', settings: 'Booking settings',
}

const UNITS_SHOWN = 12   // per group, before "show all"
const GROUPS_SHOWN = 10

export function FixNext({ items, buildings }: { items: FixItem[]; buildings: string[] }) {
  const [mode, setMode] = useState<'fix' | 'unit'>('fix')
  const [building, setBuilding] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [expandAll, setExpandAll] = useState<Set<string>>(new Set())

  const scoped = useMemo(() => (building ? items.filter(i => i.building === building) : items), [items, building])

  // Grouped by the fix itself: "9 units are missing a safety amenity" is one job, not nine.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; pillar: FixItem['pillar']; label: string; severity: FixItem['severity']; units: FixItem[]; points: number }>()
    for (const it of scoped) {
      const key = `${it.pillar}|${it.label}`
      const g = m.get(key) || { key, pillar: it.pillar, label: it.label, severity: it.severity, units: [], points: 0 }
      g.units.push(it); g.points += it.points
      if (it.severity === 'bad') g.severity = 'bad'
      m.set(key, g)
    }
    return Array.from(m.values()).sort((a, b) => b.points - a.points)
  }, [scoped])

  // Ranked by unit: the single biggest win available on each unit, worst unit first.
  const byUnit = useMemo(() => {
    const m = new Map<string, FixItem>()
    for (const it of scoped) {
      const cur = m.get(it.unitId)
      if (!cur || it.points > cur.points) m.set(it.unitId, it)
    }
    return Array.from(m.values()).sort((a, b) => b.points - a.points)
  }, [scoped])

  const totalPoints = Math.round(scoped.reduce((s, i) => s + i.points, 0))
  const unitsAffected = new Set(scoped.map(i => i.unitId)).size

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-xl border border-line bg-white p-0.5">
          {(['fix', 'unit'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-lg text-[12px] font-semibold transition-colors ${mode === m ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
              {m === 'fix' ? 'By fix' : 'By unit'}
            </button>
          ))}
        </div>
        <select value={building} onChange={e => setBuilding(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200">
          <option value="">All buildings</option>
          {buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="text-[12px] text-muted">
          {scoped.length} open {scoped.length === 1 ? 'gap' : 'gaps'} across <b className="text-ink tabular-nums">{unitsAffected}</b> units
          {totalPoints > 0 && <> · <b className="text-ink tabular-nums">{totalPoints}</b> Optimize points on the table</>}
        </span>
      </div>

      {scoped.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center text-sm text-emerald-800">
          Nothing on the list — every scored factor across these units is at full marks.
        </div>
      ) : mode === 'fix' ? (
        <div className="space-y-2">
          {groups.slice(0, GROUPS_SHOWN).map(g => {
            const isOpen = open.has(g.key)
            const showAll = expandAll.has(g.key)
            const shown = showAll ? g.units : g.units.slice(0, UNITS_SHOWN)
            return (
              <div key={g.key} className="rounded-2xl border border-line bg-white overflow-hidden">
                <button
                  onClick={() => setOpen(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}
                  aria-expanded={isOpen}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-app/50 transition-colors">
                  {isOpen ? <ChevronDown size={15} className="text-muted shrink-0" /> : <ChevronRight size={15} className="text-muted shrink-0" />}
                  <span className={`shrink-0 tabular-nums text-[12px] font-bold px-2 py-0.5 rounded-md ${g.severity === 'bad' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                    +{Math.round(g.points)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-bold text-ink">{g.label}</span>
                    <span className="block text-[11.5px] text-muted">{PILLAR_LABEL[g.pillar]} · {g.units.length} unit{g.units.length === 1 ? '' : 's'} · up to +{Math.max(...g.units.map(u => u.points)).toFixed(1)} on a single unit</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-line px-4 py-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {shown.map((u, i) => (
                        <Link key={i} href={`/listings/${u.unitId}#${PANEL_FOR[u.pillar]}`}
                          className="flex items-center gap-2.5 rounded-xl border border-line bg-app/40 px-3 py-2 hover:bg-app transition-colors group">
                          <span className="shrink-0 tabular-nums text-[11.5px] font-bold text-muted">+{u.points.toFixed(1)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12.5px] font-semibold text-ink truncate">{u.unitName}</span>
                            <span className="block text-[11px] text-muted truncate">{u.note}</span>
                          </span>
                          <ArrowRight size={13} className="shrink-0 text-muted group-hover:text-brand-600" />
                        </Link>
                      ))}
                    </div>
                    {g.units.length > shown.length && (
                      <button onClick={() => setExpandAll(s => new Set(s).add(g.key))}
                        className="mt-2 text-[12px] font-semibold text-brand-700 hover:underline">
                        Show the other {g.units.length - shown.length} units
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {groups.length > GROUPS_SHOWN && (
            <div className="rounded-xl border border-line bg-app/40 px-4 py-2.5 text-[12px] text-muted">
              <Wrench size={12} className="inline mr-1.5 -mt-0.5" />
              {groups.length - GROUPS_SHOWN} smaller fix {groups.length - GROUPS_SHOWN === 1 ? 'type is' : 'types are'} not shown here — they are all on each unit&apos;s own page under &ldquo;What to fix&rdquo;.
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-white divide-y divide-line/60">
          {byUnit.slice(0, 50).map(u => (
            <Link key={u.unitId} href={`/listings/${u.unitId}#${PANEL_FOR[u.pillar]}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-app/40 transition-colors group">
              <span className={`shrink-0 tabular-nums text-[12px] font-bold px-2 py-0.5 rounded-md ${u.severity === 'bad' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>+{u.points.toFixed(1)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink truncate">{u.unitName} <span className="text-muted font-normal">· {u.building}</span></span>
                <span className="block text-[11.5px] text-muted truncate">{u.label} — {u.note}</span>
              </span>
              <ArrowRight size={14} className="shrink-0 text-muted group-hover:text-brand-600" />
            </Link>
          ))}
          {byUnit.length > 50 && (
            <div className="px-4 py-2.5 text-[12px] text-muted">
              Showing the 50 units with the biggest single win. {byUnit.length - 50} more have open gaps — filter by building, or use &ldquo;By fix&rdquo;.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

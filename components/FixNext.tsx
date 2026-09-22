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
import { ArrowRight } from 'lucide-react'
import { LeanList, LeanRow, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'

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
              title={m === 'fix' ? 'One row per fix, with every unit that needs it' : 'One row per unit: its single biggest win'}
              className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors ${mode === m ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
              {m === 'fix' ? 'By fix' : 'By unit'}
            </button>
          ))}
        </div>
        <select value={building} onChange={e => setBuilding(e.target.value)}
          className="rounded-lg border border-line bg-white px-2 py-1 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200">
          <option value="">All buildings</option>
          {buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="ml-auto flex items-center gap-1.5">
          <Pill title={`${scoped.length} open ${scoped.length === 1 ? 'gap' : 'gaps'}`}>{unitsAffected} units</Pill>
          {totalPoints > 0 && <Pill tone="brand" title="Optimize Score points available if every gap is closed">+{totalPoints} pts</Pill>}
        </span>
      </div>

      {scoped.length === 0 ? (
        <LeanEmpty>Nothing to fix — every scored factor is at full marks.</LeanEmpty>
      ) : mode === 'fix' ? (
        <>
          <LeanList>
            {groups.slice(0, GROUPS_SHOWN).map(g => {
              const showAll = expandAll.has(g.key)
              const shown = showAll ? g.units : g.units.slice(0, UNITS_SHOWN)
              const best = Math.max(...g.units.map(u => u.points))
              return (
                <LeanRow key={g.key}
                  open={open.has(g.key)}
                  onToggle={() => setOpen(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}
                  lead={<Tag tone={g.severity === 'bad' ? 'rose' : 'amber'} title={`Optimize points across all ${g.units.length} units · up to +${best.toFixed(1)} on one unit`}>+{Math.round(g.points)}</Tag>}
                  name={g.label}
                  meta={`${g.units.length} unit${g.units.length === 1 ? '' : 's'}`}
                  tags={<Tag>{PILLAR_LABEL[g.pillar]}</Tag>}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                    {shown.map((u, i) => (
                      <Link key={i} href={`/listings/${u.unitId}#${PANEL_FOR[u.pillar]}`} title={u.note}
                        className="flex items-center gap-2 rounded-lg border border-line bg-app/40 px-2.5 py-1.5 hover:bg-app transition-colors group">
                        <span className="shrink-0 tabular-nums text-[11px] font-bold text-muted">+{u.points.toFixed(1)}</span>
                        <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink truncate">{u.unitName}</span>
                        <span className="hidden sm:block min-w-0 max-w-[45%] text-[11px] text-muted truncate">{u.note}</span>
                        <ArrowRight size={13} className="shrink-0 text-muted group-hover:text-brand-600" />
                      </Link>
                    ))}
                  </div>
                  {g.units.length > shown.length && (
                    <button onClick={() => setExpandAll(s => new Set(s).add(g.key))}
                      className="text-[12px] font-semibold text-brand-700 hover:underline">
                      Show {g.units.length - shown.length} more
                    </button>
                  )}
                </LeanRow>
              )
            })}
          </LeanList>
          {groups.length > GROUPS_SHOWN && (
            <p className="mt-2 text-[12px] text-muted" title="Each unit's own page lists every gap under “What to fix”">
              + {groups.length - GROUPS_SHOWN} smaller fix {groups.length - GROUPS_SHOWN === 1 ? 'type' : 'types'} not shown — see each unit&apos;s page.
            </p>
          )}
        </>
      ) : (
        <>
          <LeanList>
            {byUnit.slice(0, 50).map(u => {
              const href = `/listings/${u.unitId}#${PANEL_FOR[u.pillar]}`
              return (
                <LeanRow key={u.unitId}
                  lead={<Tag tone={u.severity === 'bad' ? 'rose' : 'amber'} title="Optimize points this fix is worth">+{u.points.toFixed(1)}</Tag>}
                  name={<Link href={href} className="hover:text-brand-700">{u.unitName}</Link>}
                  meta={u.building}
                  tags={<Tag title={u.note}>{u.label}</Tag>}
                  actions={<IconBtn title={`Open the ${PILLAR_LABEL[u.pillar]} panel`} href={href}><ArrowRight size={14} /></IconBtn>}
                />
              )
            })}
          </LeanList>
          {byUnit.length > 50 && (
            <p className="mt-2 text-[12px] text-muted">Top 50 of {byUnit.length} units — filter by building or switch to By fix.</p>
          )}
        </>
      )}
    </div>
  )
}

// ACTIVE UNITS WITH NO GUIDEBOOK (2026-11-10) — the gap, visible and actionable on the Guidebooks page.
//
// One line ("N active units have no guidebook") that opens to the units grouped by building, each
// building closed until tapped. Nothing here runs the AI: there is no bulk-create action in the
// guidebook API, so every unit links to the existing single-create flow (the unit's page, where the
// Guidebook button asks its questions) and every building links to the existing Bulk build page with
// that building picked — a person presses Generate there.
//
// No client code: plain <details>, rendered on the server from the list app/guidebooks/page.tsx works out.
import Link from 'next/link'
import { ArrowRight, ChevronRight } from 'lucide-react'

export type MissingUnit = { id: string; name: string }
export type MissingGroup = { name: string; units: MissingUnit[] }

export function GuidebookMissing({ groups }: { groups: MissingGroup[] }) {
  const total = groups.reduce((a, g) => a + g.units.length, 0)
  if (!total) return null
  return (
    <details className="group mb-4 rounded-2xl border border-amber-200 bg-amber-50/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] text-amber-950 sm:px-4 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 transition-transform group-open:rotate-90" />
        <span className="font-semibold tabular-nums">{total} active unit{total === 1 ? ' has' : 's have'} no guidebook</span>
        <span className="text-amber-900/70">· {groups.length} building{groups.length === 1 ? '' : 's'} · open to see them</span>
      </summary>
      <div className="border-t border-amber-200 px-3 pb-3 pt-2 sm:px-4">
        <p className="text-[12px] text-amber-900/80">Nothing is created automatically. Create one from the unit&rsquo;s page, or build a whole building at once — both use the AI budget when you press Generate there.</p>
        <div className="mt-2 space-y-1.5">
          {groups.map((g) => (
            <details key={g.name} className="rounded-xl border border-line bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12.5px] [&::-webkit-details-marker]:hidden">
                <span className="font-semibold text-ink">{g.name}</span>
                <span className="tabular-nums text-muted">{g.units.length} without a guidebook</span>
                <span className="flex-1" />
                <Link href={'/guidebooks/bulk?building=' + encodeURIComponent(g.name)} prefetch={false} title="Opens Bulk build with this building picked — units that already have a guidebook are skipped"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-app">Bulk build <ArrowRight size={12} /></Link>
              </summary>
              <ul className="divide-y divide-line/70 border-t border-line">
                {g.units.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate text-ink">{u.name}</span>
                    <Link href={'/listings/' + encodeURIComponent(u.id)} prefetch={false} title="Opens the unit — use its Guidebook button to create this one"
                      className="shrink-0 font-semibold text-ink underline">Create</Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>
    </details>
  )
}

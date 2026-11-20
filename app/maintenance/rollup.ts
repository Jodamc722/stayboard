// The building a unit-level name folds into (the same rule the Work Orders page uses). Its own file
// since 2026-11-20 so the page (server) and MaintenanceView (browser) share ONE copy of the rule: the
// view now adds the offline units to the per-building grid itself.
const str = (v: any) => (v == null ? '' : String(v))
const PARENTS = ['Botanica', 'Oasis', 'Arya', 'Capri', 'Lucerne', '17WEST', 'Elser', 'Salato']
const OASIS_UNITS = ['mahogany', 'royal palm', 'bougainvillea', 'bamboo', 'sapodilla', 'jasmine']
export function rollup(raw?: string | null): string {
  const b = str(raw).trim()
  if (!b) return 'Unassigned'
  const lower = b.toLowerCase()
  for (const p of PARENTS) if (lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + ' ')) return p
  if (OASIS_UNITS.some(u => lower === u || lower.startsWith(u + ' '))) return 'Oasis'
  return b
}

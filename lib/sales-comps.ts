// Comparables added to a deck (from the Projections library, or typed in) go on the floor plans they
// compare to: the same bedroom count, read from the names. Pure; used by the builder and the generator.
import type { PacketComp } from './sales-cma'

/** Which bedroom count a unit type or comparable is, from its name: 'studio', '1', '2'… */
export function bedKey(name: string): string {
  const s = String(name || '').toLowerCase()
  if (/studio/.test(s) && !/\d\s*studio/.test(s)) return 'studio'
  const m = s.match(/(\d)\s*(?:-|\s)?(?:bed|br|bedroom)/) || s.match(/\b(one|two|three|four)[- ]bed/)
  if (!m) return ''
  return ({ one: '1', two: '2', three: '3', four: '4' } as Record<string, string>)[m[1]] || m[1]
}

/** Put new comparables on the floor plans they compare to: same bedroom count, by name. */
export function attachComps<T extends { comps: PacketComp[]; plans: { name: string; compIds: string[] }[] }>(cma: T, add: PacketComp[]): T {
  return {
    ...cma,
    comps: [...cma.comps, ...add],
    plans: cma.plans.map(p => {
      const k = bedKey(p.name)
      const ids = add.filter(c => k && bedKey(c.name) === k).map(c => c.id)
      return ids.length ? { ...p, compIds: Array.from(new Set([...p.compIds, ...ids])) } : p
    }),
  }
}

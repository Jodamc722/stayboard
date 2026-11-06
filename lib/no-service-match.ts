// NO-SERVICE MATCHING — the pure half of lib/no-service (no imports, so the node tests and any
// client component can use it). Jon, 2026-11-06: "We do not need to do any inspections or welcome
// calls for any Botanica units. So don't draft them or auto create them."
export type NoService = { inspections: string[]; welcomeCalls: string[] }

export const NO_SERVICE_DEFAULTS: NoService = { inspections: ['Botanica'], welcomeCalls: ['Botanica'] }

function cleanList(v: any, fb: string[]): string[] {
  if (!Array.isArray(v)) return fb.slice()
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of v) {
    const s = String(x ?? '').trim().slice(0, 60)
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase()); out.push(s)
  }
  return out.slice(0, 50)
}

/** Stored (possibly partial / junk) value over the defaults. An explicit empty list is respected. */
export function mergeNoService(stored: any): NoService {
  const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  return {
    inspections: cleanList(s.inspections, NO_SERVICE_DEFAULTS.inspections),
    welcomeCalls: cleanList(s.welcomeCalls, NO_SERVICE_DEFAULTS.welcomeCalls),
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Does any of `names` (Guesty nickname, title, building, Breezeway property name…) match an entry of
 * `list`? Case-insensitive, whole word ("Botanica" never matches "Botanicals"), flexible spaces. An
 * optional `rollup` (lib/segments buildingOf) also catches a unit whose name only resolves to a
 * listed building.
 */
export function matchNoService(list: string[] | null | undefined, names: any[], rollup?: (b: string, n: string) => string | null): boolean {
  const entries = (list || []).map(e => String(e || '').trim().toLowerCase()).filter(Boolean)
  if (!entries.length) return false
  const vals = (names || []).map(n => String(n ?? '').trim()).filter(Boolean)
  if (!vals.length) return false
  const hay = ' ' + vals.join(' | ').toLowerCase() + ' '
  for (const e of entries) {
    if (new RegExp('(^|[^a-z0-9])' + esc(e).replace(/\s+/g, '\\s*') + '($|[^a-z0-9])').test(hay)) return true
  }
  if (rollup) {
    for (const v of vals) {
      const b = String(rollup(v, v) || '').toLowerCase()
      if (b && entries.includes(b)) return true
    }
  }
  return false
}

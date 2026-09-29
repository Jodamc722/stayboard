// A TOOL RESULT THAT FITS, WITHOUT CUTTING JSON IN HALF (2026-09-28 audit, F3).
//
// run.ts used to send `JSON.stringify(output).slice(0, 9000)`. On a busy day ops_today ran past that
// in the departures, so the arrivals, vacants, glitches, inspections and the closing note never
// reached her — and nothing said so, which broke her own TRUNCATION rule. A cut mid-string is also
// not JSON any more; the model reads a torn record as whatever it looks like.
//
// Now: if the serialised result is over the budget, the LONGEST list in it is halved, and again,
// until it fits; every list that was shortened is named in `_cut` ("departures": "60→15"), so she
// can say the list is partial. If lists are not enough, long strings are shortened. It never throws
// and it never returns something bigger than the budget.
//
// No imports, so lib/eve/__tests__/fit.test.mjs runs it with plain node.

export const TOOL_RESULT_CHARS = 9000

type ArrRef = { parent: any; key: string; path: string }

// Lists reachable through object keys (the tool's own lists and lists nested in objects). A list
// inside a list shrinks with its parent.
function listsIn(v: any, path: string, out: ArrRef[], depth: number): void {
  if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 6) return
  for (const k of Object.keys(v)) {
    if (k === '_cut') continue
    const x = v[k]
    const p = path ? path + '.' + k : k
    if (Array.isArray(x)) out.push({ parent: v, key: k, path: p })
    else if (x && typeof x === 'object') listsIn(x, p, out, depth + 1)
  }
}

function shortenStrings(v: any, max: number): any {
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v
  if (Array.isArray(v)) return v.map(x => shortenStrings(x, max))
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(v)) out[k] = k === '_cut' ? v[k] : shortenStrings(v[k], max)
    return out
  }
  return v
}

/** The result, shortened to fit `max` characters of JSON with a `_cut` note — or unchanged if it fits. */
export function fitResult(output: any, max: number = TOOL_RESULT_CHARS): any {
  let s: string | undefined
  try { s = JSON.stringify(output) } catch { return { error: 'The tool returned something that could not be read.' } }
  if (s === undefined || s.length <= max) return output
  let copy: any
  try { copy = JSON.parse(s) } catch { return { error: 'The tool returned something that could not be read.' } }
  if (typeof copy === 'string') return copy.slice(0, Math.max(0, max - 40)) + ' …[cut to fit]'
  if (Array.isArray(copy)) copy = { items: copy }
  if (!copy || typeof copy !== 'object') return copy
  const cut: Record<string, string> = {}
  const before: Record<string, number> = {}
  const size = () => { if (Object.keys(cut).length) copy._cut = cut; return JSON.stringify(copy).length }
  for (let guard = 0; guard < 80 && size() > max; guard++) {
    const refs: ArrRef[] = []
    listsIn(copy, '', refs, 0)
    let best: ArrRef | null = null, bestLen = 0
    for (const r of refs) {
      const a = r.parent[r.key]
      if (!Array.isArray(a) || a.length <= 1) continue
      const l = JSON.stringify(a).length
      if (l > bestLen) { best = r; bestLen = l }
    }
    if (!best) break
    const a = best.parent[best.key] as any[]
    if (before[best.path] == null) before[best.path] = a.length
    const n = Math.max(1, Math.floor(a.length / 2))
    best.parent[best.key] = a.slice(0, n)
    cut[best.path] = `${before[best.path]}→${n}`
  }
  if (size() <= max) return copy
  // Lists alone were not enough: shorten long text, harder each time.
  for (const lim of [400, 160, 60]) {
    copy = shortenStrings(copy, lim)
    cut._text = `long text shortened to ${lim} characters`
    if (size() <= max) return copy
  }
  return { _cut: { whole: 'result too large to show' }, keys: Object.keys(copy).slice(0, 40), note: 'The result was too large even after shortening. Ask for a narrower slice (a building, a date, one unit).' }
}

// LICENSE PLATES — the pure helpers both sides of the parking feature share (no imports, so the
// browser bundles it and plain node can test it).
//
// A plate is matched on its NORMALISED form: upper-case letters and digits only. "abc-1234",
// "ABC 1234" and "ABC1234" are the same car. Florida plates are 7 characters at most, but we never
// reject a length — vendors' trucks, dealer tags and out-of-state plates are all real.

/** Upper-case alphanumerics only. '' when there is nothing left. */
export function normalizePlate(v: any): string {
  return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

/** The plate as a person wrote it, tidied: trimmed, upper-cased, inner runs of spaces collapsed. */
export function tidyPlate(v: any): string {
  return String(v == null ? '' : v).toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 16)
}

// Letters a camera (or a tired person) swaps for each other. Two plates that differ only by one of
// these pairs are "the same plate, read badly", which is why a near-match is offered rather than a
// flat "not registered".
const CONFUSABLE: [string, string][] = [['0', 'O'], ['0', 'D'], ['0', 'Q'], ['1', 'I'], ['1', 'L'], ['2', 'Z'], ['5', 'S'], ['8', 'B'], ['6', 'G'], ['U', 'V'], ['M', 'N']]
function confusable(a: string, b: string): boolean {
  if (a === b) return true
  for (const [x, y] of CONFUSABLE) if ((a === x && b === y) || (a === y && b === x)) return true
  return false
}

/** Edit distance where swapping a confusable pair costs half. Both inputs already normalised. */
export function plateDistance(a: string, b: string): number {
  const A = normalizePlate(a), B = normalizePlate(b)
  if (A === B) return 0
  const m = A.length, n = B.length
  if (!m) return n
  if (!n) return m
  const prev: number[] = []
  for (let j = 0; j <= n; j++) prev.push(j)
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i]
    for (let j = 1; j <= n; j++) {
      const sub = A[i - 1] === B[j - 1] ? 0 : confusable(A[i - 1], B[j - 1]) ? 0.5 : 1
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub))
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j]
  }
  return prev[n]
}

/** "Probably the same plate": within one honest mistake. */
export function platesClose(a: string, b: string): boolean {
  const A = normalizePlate(a), B = normalizePlate(b)
  if (!A || !B) return false
  if (A === B) return true
  if (Math.min(A.length, B.length) < 4) return false
  return plateDistance(A, B) <= 1
}

/** "Honda Civic", "Black Honda Civic", "Honda", "car" — whatever we know, in reading order. */
export function carLabel(c: { make?: string | null; model?: string | null; color?: string | null }): string {
  const parts = [c.color, c.make, c.model].map(s => String(s || '').trim()).filter(Boolean)
  return parts.length ? parts.join(' ') : 'vehicle'
}

/** Nights between two YYYY-MM-DD days ([start, end)). 0 when end <= start. */
export function nightsBetween(startYmd: string, endYmd: string): number {
  const a = Date.UTC(+startYmd.slice(0, 4), +startYmd.slice(5, 7) - 1, +startYmd.slice(8, 10))
  const b = Date.UTC(+endYmd.slice(0, 4), +endYmd.slice(5, 7) - 1, +endYmd.slice(8, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86400000))
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Do two [start, end) night ranges share a night? */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd
}

export const isYmd = (s: any): s is string => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))

export function cents(n: number, currency = 'USD'): string {
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'
  const v = Math.round(n) / 100
  return sym + (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
}

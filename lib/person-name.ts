// ONE ANSWER TO "IS THIS THE SAME PERSON?"
//
// Jon, 2026-09-02, after seeing Gehron Regis appear twice on the People board — once carrying
// nineteen jobs and once as Free: "do what we need to do to ensure this is fixed."
//
// The bug was not the comparison that failed. It was that there were SEVERAL comparisons. This
// logic already existed and it is good — it tolerates accents, double spaces, typos, swapped
// first/last order, generational suffixes and maiden-name drift, because names here come from
// three systems typed by hand by different people. But it lived inside lib/homebase.ts, which
// carries an API client and cannot be imported by a browser component. So the board rolled its own
// `a.toLowerCase() === b.toLowerCase()`, which agrees with this one right up until somebody types
// two spaces.
//
// It lives here now: no imports, no environment, no server dependency, safe on both sides of the
// wire. lib/homebase.ts re-exports it, so nothing that used it there had to change.
//
// THE RULE FOR ANYONE ADDING CODE: if you are deciding whether two strings are the same human, use
// `nameMatches` or `personKey` from this file. Never `.toLowerCase()`. That comparison looks
// correct in every code review and fails in production on invisible whitespace.
//
// lib/__tests__/person-name.test.ts holds the cases these three systems actually produce.

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

// Small edit distance for typo tolerance ('Rodiguez' vs 'Rodriguez',
// 'Yunisleydi' vs 'Yunisleidy'). Names come from two systems typed by hand.
function editDist(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev: number[] = []
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

const nearWord = (x: string, y: string): boolean => {
  if (x === y) return true
  if (x.length < 4 || y.length < 4) return false
  return editDist(x, y) <= (Math.min(x.length, y.length) >= 6 ? 2 : 1)
}

// Same person if first names match (exact or a typo apart) and last names agree
// (same word, a typo apart, or at least the same initial). Tolerates double
// spaces, accents, and swapped first/last order.
// TOKENS THAT NAME A PERSON, nothing else (Jon, 2026-09-01: "if you see the same name even if
// 'different user', be smart enough to assume it's the same human"). Generational suffixes and
// middle initials are how one person becomes two on a board: the staff table really did carry
// "Anthony Perry" and "Anthony Perry III" as separate people. A suffix or a lone initial is
// dropped BEFORE comparing — unless that would empty the name entirely.
const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v)\.?$/
export const nameTokens = (s: string): string[] => {
  const all = norm(s).split(/\s+/).filter(Boolean)
  const kept = all.filter(t => !SUFFIX_RE.test(t) && t.length > 1)
  return kept.length ? kept : all
}

export function nameMatches(a: string, b: string): boolean {
  const A = nameTokens(a)
  const B = nameTokens(b)
  if (!A.length || !B.length) return false
  if (A.join(' ') === B.join(' ')) return true
  const af = A[0], bf = B[0]
  const al = A.length > 1 ? A[A.length - 1] : ''
  const bl = B.length > 1 ? B[B.length - 1] : ''
  const firstOk = nearWord(af, bf)
  if (firstOk && (!al || !bl)) return true            // only a first name on one side
  const lastOk = !!al && !!bl && (nearWord(al, bl) || al[0] === bl[0])
  if (firstOk && lastOk) return true
  // swapped order ('Perez Yunisleidy')
  return !!al && !!bl && nearWord(af, bl) && nearWord(al, bf)
}

// Roster-aware last-ditch match: an external (Breezeway) name whose FIRST name
// matches exactly ONE person on the Homebase roster counts as that person, even
// when the last names disagree - catches married/maiden-name drift between the
// two systems ('Shaany Espinoza' vs 'Shaany Christian'). Ambiguous first names
// (two Marias) never match this way. Returns the roster name, or null.
export function nameMatchesRoster(external: string, roster: string[]): string | null {
  for (const r of roster) if (nameMatches(external, r)) return r
  const ef = norm(external).split(/\s+/).filter(Boolean)[0]
  if (!ef || ef.length < 4) return null
  const hits: string[] = []
  for (const r of roster) {
    const rf = norm(r).split(/\s+/).filter(Boolean)[0]
    if (rf && nearWord(ef, rf) && hits.indexOf(r) < 0) hits.push(r)
  }
  return hits.length === 1 ? hits[0] : null
}

/**
 * A stable key for grouping — when you need a Record keyed by person rather than a pairwise test.
 *
 * Weaker than `nameMatches` on purpose: it cannot forgive a typo, because a hash bucket has no
 * opportunity to compare. Use it to GROUP and `nameMatches` to DECIDE. Where being wrong is
 * costly, do both: group by key, then reconcile the leftovers with nameMatches.
 */
export function personKey(v: any): string {
  return nameTokens(String(v ?? '')).join(' ')
}

/** The display spelling to keep when one human arrives under several. Longest wins — it is the one
 *  most likely to carry both names rather than just a first. */
export function bestSpelling(a: string, b: string): string {
  const A = String(a || '').replace(/\s+/g, ' ').trim()
  const B = String(b || '').replace(/\s+/g, ' ').trim()
  if (!A) return B
  if (!B) return A
  return B.length > A.length ? B : A
}

// lib/money.ts
//
// WHO SEES DOLLARS (Jon 2026-08-10: "can we hide the amount vs labor, meaning rev — let's just do
// percentages" ... "unless you're the GM or admin").
//
// The rule is enforced on the SERVER, before the JSON leaves the route. Hiding dollars in the
// component only would still ship every wage, every margin and every cleaning fee to the browser,
// where anyone can read them out of the network tab. A number that must not be seen must not be
// sent.
//
// redactMoney() is a DENY-BY-DEFAULT walk over the response object: any key whose NAME reads like
// money gets nulled. That direction matters. A hand-written list of fields to strip rots the first
// time someone adds `avgFeePerTask` to a route — the field silently leaks and nothing complains.
// With a name rule, a new money field is hidden the moment it is written, and the failure mode is
// over-redaction (a visible dash the operator reports) rather than a quiet disclosure.
//
// Two carve-outs keep it honest:
//   - STRINGS survive. `source: { payroll: 'homebase' }` and `costBasis: 'breezeway rate_paid'`
//     are method labels, not amounts. Money is always a number (or an object of numbers).
//   - RATIOS survive, by name (anything with pct/percent/ratio/coverage, plus the named few).
//     A percentage is exactly what Jon asked to keep, and it discloses no amount on its own.

/** Key names that read like an amount of money. */
const MONEY_RE = /(revenue|payroll|margin|wage|cost|fee|pay|billable|amount|spend|price|dollar|budget|salar|earn)/i

/** Key names that survive even though they match MONEY_RE — they are ratios, not amounts. */
const RATIO_RE = /(pct|percent|ratio|coverage|perlabordollar)/i

/** Counts and flags that happen to contain a money word. */
const KEEP = new Set([
  'billableTasks', 'billedTasks', 'checkoutsWithNoFeeData', 'cleansWithNoMatchedCheckout',
  'feesWithNoMatchedCleanCount', 'paidTasks', 'unpaidTasks',
])

// Blocks whose NAME says money but whose CONTENTS are mixed — `payroll` holds the amounts AND the
// labor %, the band and the goal. Without this the whole block would be nulled and the percentage
// Jon actually asked to keep would go with it; the children are still judged one by one.
//
// The default for an object under a money key is to null it WHOLE, and that default is the point:
// forgetting to list a container here makes a block visibly disappear, which someone reports.
// Getting it backwards — recursing by default — would silently publish any money map whose inner
// keys are names rather than field names.
const CONTAINERS = new Set(['payroll'])

export function isMoneyKey(key: string): boolean {
  if (KEEP.has(key)) return false
  if (RATIO_RE.test(key)) return false
  return MONEY_RE.test(key)
}

/**
 * Deep copy of `value` with every money-named field nulled. Never mutates the input, so the same
 * computed response object can be sent unredacted to someone who is allowed to see it.
 *
 * `opaque` lists fields whose object keys are DATA, not field names — `personTasks` is keyed by
 * people's names, and a cleaner called Costa or Feeney would otherwise have her whole task list
 * nulled by a rule meant for `costPerClean`. Their keys are passed over; their values are still
 * walked, so the `pay` inside each task is still stripped.
 *
 * Note this is only needed for maps whose values must survive. A name-keyed map of pure amounts
 * (`personRevenue`) needs nothing: its own key matches, so the whole map is nulled before the walk
 * ever looks inside — which is the right answer, and safer than trusting every surname to miss.
 */
export function redactMoney<T>(value: T, opaque: string[] = ['personTasks']): T {
  return walk(value, new Set(opaque), false) as T
}

function walk(v: any, opaque: Set<string>, keysAreData: boolean): any {
  if (Array.isArray(v)) return v.map(x => walk(x, opaque, false))
  if (v && typeof v === 'object') {
    // Date and other exotics: hand back as-is rather than shredding them into {}.
    if (v instanceof Date) return v
    const out: Record<string, any> = {}
    for (const k of Object.keys(v)) {
      const child = (v as any)[k]
      // A string under a money key is a label ('homebase'), not an amount — keep it.
      // CONTAINERS only spares a BLOCK. `payroll` names both the mixed top-level block and a plain
      // number inside every department; exempting the name outright published all three of those.
      const isBlock = !!child && typeof child === 'object' && !Array.isArray(child)
      const hit = !keysAreData && isMoneyKey(k) && typeof child !== 'string'
        && !(isBlock && CONTAINERS.has(k))
      out[k] = hit ? null : walk(child, opaque, opaque.has(k))
    }
    return out
  }
  return v
}

/** a/b as a whole-ish percentage, or null when the question doesn't apply. */
export function pctOf(a: number | null | undefined, b: number | null | undefined): number | null {
  // Number(null) and Number('') are both 0, which would turn "we have no figure" into "0%" — a
  // confident wrong answer. Zero itself is a real answer and must still get through.
  if (a == null || b == null || (a as any) === '' || (b as any) === '') return null
  const x = Number(a), y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return null
  return Math.round((x / y) * 1000) / 10
}

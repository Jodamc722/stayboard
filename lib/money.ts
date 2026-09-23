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
const MONEY_RE = /(revenue|payroll|margin|wage|cost|fee|pay|billable|amount|spend|price|dollar|budget|salar|earn|revpar)/i

/** Key names that survive even though they match MONEY_RE — they are ratios, not amounts. */
const RATIO_RE = /(pct|percent|ratio|coverage|perlabordollar)/i

// THE LEDGER WORDS (Jon, 2026-09-23 review). MONEY_RE above was written for the labor board, and
// Eve's reservation and owner tools speak a different vocabulary: `money_total`, `total`, `net`,
// `rental`, `commission`, `paid`, `sought`, `balance`, `accommodation`, `lifetime_value`, `adr`,
// `rate`. (A bare `value` is NOT on the list: trend points and scores use it for occupancy and
// ratings. The one money `value` Eve had, direct_bookings, now says `accommodation_value`.) Not one of them matched, so a money:true tool handed every owner's net and every guest's
// lifetime spend to a user who had been told they could not see dollars. P0.
//
// These words are matched as WHOLE TOKENS of the key (camelCase and snake_case split), never as
// substrings, because as substrings they are everywhere: `net` is in `network`, `rate` in
// `rating` and `generated`, `total` in `total_minutes`. MONEY_RE's substring behaviour is left
// exactly as it was — this only ever ADDS redaction.
const MONEY_TOKENS = new Set([
  'money', 'total', 'subtotal', 'net', 'gross', 'rental', 'rent', 'commission', 'paid', 'sought',
  'lifetime', 'ltv', 'accommodation', 'balance', 'payout', 'fare', 'income', 'charge', 'charges',
  'refund', 'refunds', 'deposit', 'tax', 'taxes', 'usd', 'adr', 'variance', 'fees', 'price', 'rate', 'rates',
])
// A token hit is NOT money when the same key also says it is a count, a duration or a ratio:
// `total_minutes`, `totalCleans`, `tasksNoCharge`, `occupancy_rate`, `onTimeRate`, `reply_rate`.
const NOT_MONEY_TOKENS = new Set([
  'minutes', 'minute', 'mins', 'hours', 'hour', 'hrs', 'seconds', 'secs', 'ms', 'days', 'nights',
  'count', 'counts', 'cnt', 'n', 'num', 'number', 'qty', 'quantity',
  'cleans', 'tasks', 'task', 'units', 'bookings', 'reservations', 'stays', 'reviews', 'guests',
  'people', 'owners', 'listings', 'messages', 'threads', 'rows', 'items',
  'rating', 'ratings', 'score', 'stars', 'pct', 'percent', 'ratio', 'share', 'occupancy',
  'response', 'reply', 'completion', 'conversion', 'cancellation', 'cancel', 'time', 'success',
  'repeat', 'return', 'fill', 'error', 'click', 'churn', 'growth', 'known',
])
// Exact key names that are money though no token says so (owner-audit `benchRate` ships as
// `benchmark`; the settlement balance is `dueToOwner`).
const MONEY_EXACT = new Set(['benchmark', 'dueToOwner', 'due_to_owner'])
// Keys that are money only when they sit beside other money: owner_month's `other` is "other
// charges" next to rental/commission/net, but `other` in a task tally is a count.
const MONEY_BY_SIBLING = new Set(['other', 'others', 'misc', 'extras'])
// A key under one of these parents is a tally (`tasks: { clean, other, total }`), not a ledger.
const COUNT_PARENTS = new Set(['tasks', 'counts', 'count', 'by_status', 'byStatus', 'cleans', 'volumes'])

function tokensOf(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function isLedgerKey(key: string): boolean {
  if (MONEY_EXACT.has(key)) return true
  const toks = tokensOf(key)
  if (!toks.some(t => MONEY_TOKENS.has(t))) return false
  return !toks.some(t => NOT_MONEY_TOKENS.has(t))
}

/** Counts and flags that happen to contain a money word. */
const KEEP = new Set([
  'billableTasks', 'billedTasks', 'checkoutsWithNoFeeData', 'cleansWithNoMatchedCheckout',
  'feesWithNoMatchedCleanCount', 'paidTasks', 'unpaidTasks',
  // Counts of turns, not amounts: how many turns were priced off the listing's default fee, and
  // how many carried no fee at all. Nulling these would make the board read "no turns".
  'turnsFromListingFee', 'turnsUnpriced',
  // Booleans that say whether an amount is KNOWN. The answer stays true even when the amount
  // itself is hidden — nulling it makes the UI claim the data is missing rather than withheld.
  'costKnown', 'labourKnown', 'laborKnown', 'revenueKnown',
  // Flags ABOUT the redaction itself, which the ledger token `money` would otherwise catch
  // (Jon, 2026-09-23 review).
  'canSeeMoney', 'canMoney', 'moneyHidden', 'moneyRedacted', '_money_redacted',
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

export function isMoneyKey(key: string, parentKey?: string | null): boolean {
  if (KEEP.has(key)) return false
  if (RATIO_RE.test(key)) return false
  if (MONEY_RE.test(key)) return true
  // The ledger words (see MONEY_TOKENS) — but not inside a tally like `tasks: { total }`.
  if (parentKey && COUNT_PARENTS.has(parentKey)) return false
  return isLedgerKey(key)
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
  return walk(value, new Set(opaque), false, null) as T
}

// `parentKey` is the key this object (or the array holding it) sits under, so `tasks.total` can be
// told apart from `stays[].total` (Jon, 2026-09-23 review).
function walk(v: any, opaque: Set<string>, keysAreData: boolean, parentKey: string | null): any {
  if (Array.isArray(v)) return v.map(x => walk(x, opaque, false, parentKey))
  if (v && typeof v === 'object') {
    // Date and other exotics: hand back as-is rather than shredding them into {}.
    if (v instanceof Date) return v
    const out: Record<string, any> = {}
    const keys = Object.keys(v)
    const moneyHere = !keysAreData && keys.some(k => isMoneyKey(k, parentKey) && typeof (v as any)[k] !== 'string')
    for (const k of keys) {
      const child = (v as any)[k]
      // A string under a money key is a label ('homebase'), not an amount — keep it.
      // CONTAINERS only spares a BLOCK. `payroll` names both the mixed top-level block and a plain
      // number inside every department; exempting the name outright published all three of those.
      const isBlock = !!child && typeof child === 'object' && !Array.isArray(child)
      const named = isMoneyKey(k, parentKey) || (moneyHere && MONEY_BY_SIBLING.has(k) && typeof child === 'number')
      const hit = !keysAreData && named && typeof child !== 'string'
        && !(isBlock && CONTAINERS.has(k))
      out[k] = hit ? null : walk(child, opaque, opaque.has(k), keysAreData ? parentKey : k)
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

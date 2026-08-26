// READ A WHOLE RANGE, NOT THE FIRST PAGE OF IT.
//
// PostgREST caps every response at this project's max-rows setting — 1,000 — no matter what number
// you pass to `.limit()`. So `.limit(20000)` is not a limit, it is a wish: you are handed the first
// 1,000 rows of your ordering and nothing tells you there were more. No error, no flag, nothing that
// distinguishes "that was all of them" from "that was where I stopped counting".
//
// FOUND 2026-08-26, and it had been wrong for a long time. Eve was asked how many cleans landed each
// day. Her query wanted 1,451 rows of housekeeping tasks, got 1,000, and ran out partway through
// Aug 22 — so she reported ZERO cleans on the 23rd, 24th, 25th and 26th. Not an error. Four
// confident zeroes on days that had 25, 23, 16 and 12 cleans on them, and a short count on the 22nd
// nobody would have questioned.
//
// The same shape was sitting under numbers people read every day. `/buildings` averaged every
// building's star rating from `.limit(20000)` on a 3,760-row review table with no `.order()` at all
// — so every rating on the portfolio page came from an arbitrary, unstable 27% sample of the
// reviews, and reloading could change it.
//
// Two rules come out of that, and this helper exists to make both automatic:
//   1. If a query can match more than 1,000 rows, PAGE it. A bigger `.limit()` does nothing.
//   2. ALWAYS `.order()` before paging. Unordered paging on PostgREST silently repeats and skips
//      rows, so an unordered read is not merely capped — it is capped at a set nobody chose.
//
// `truncated` is true only when we actually hit the page ceiling. A real limit, honestly reported,
// is a fine thing to show a person. A silent one is not.
import 'server-only'

export type Paged<T = any> = { rows: T[]; truncated: boolean }

/**
 * Page a PostgREST query to completion.
 *
 * Pass a function that applies `.range(from, to)` to an ALREADY-ORDERED query:
 *
 *   const { rows, truncated } = await pageRows((a, b) =>
 *     sb.from('guesty_reviews').select('listing_id,rating').order('id').range(a, b))
 *
 * maxPages bounds the worst case — 12 pages is 12,000 rows. Raise it deliberately for a table you
 * know is bigger, rather than discovering the ceiling the way we discovered this one.
 */
export async function pageRows<T = any>(
  q: (from: number, to: number) => PromiseLike<any>,
  maxPages = 12,
): Promise<Paged<T>> {
  const out: T[] = []
  const seen: Record<string, boolean> = {}
  for (let p = 0; p < maxPages; p++) {
    let data: any[] = []
    try {
      const res: any = await q(p * 1000, p * 1000 + 999)
      data = res?.data || []
    } catch {
      // A failed page is not proof the range ended — say we stopped early.
      return { rows: out, truncated: true }
    }
    if (!data.length) return { rows: out, truncated: false }
    // Even with a stable order, never let the same row land twice.
    for (const row of data) {
      const k = row && (row as any).id != null ? String((row as any).id) : null
      if (k) { if (seen[k]) continue; seen[k] = true }
      out.push(row as T)
    }
    if (data.length < 1000) return { rows: out, truncated: false }
  }
  return { rows: out, truncated: true }
}

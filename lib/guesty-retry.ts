// ONE PLACE THAT KNOWS WHAT "429" MEANS.
//
// Silvia, 2026-09-17, after the first round of fixes made the failure legible:
//   "Guesty: could not read the booking first (Guesty 429), so nothing was written"
//
// 429 is Guesty saying slow down, not Guesty saying no. It is the one status where the right answer
// is to wait and ask again — the request was never processed, so a retry cannot double-anything.
// Four files here already knew that (lib/guesty api(), guesty-owner-sync, stay-window,
// guesty-field-id) and each grew its own copy of the loop. The file a person's button actually goes
// through — guesty-custom-fields — had none, so a rate limit there landed on the caller as a dead
// end: the call not marked, the note not saved, and the work done on the phone lost.
//
// WHY A SHARED ONE RATHER THAN A FIFTH COPY: the backoff is the kind of thing that is subtly
// different in every copy until one of them is wrong, and the one that was wrong here was the
// absence. New callers should reach for this.
//
// RETRY-AFTER IS OBEYED when Guesty sends it, because a server that says how long to wait knows
// better than our arithmetic. Otherwise the wait grows with each attempt and carries jitter, so two
// people marking calls at the same moment do not come back in lockstep.

/** Statuses worth asking again about. 429 = slow down; 502/503/504 = a blip in front of the API. */
const RETRY = new Set([429, 502, 503, 504])

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * How long to wait before asking again. Exported and pure so the arithmetic can be tested — a
 * backoff that is subtly wrong looks exactly like a backoff that is right until the day it matters.
 *
 * `header` is Retry-After verbatim: Guesty may send seconds ("30") or an HTTP date. `jitter` is
 * injected rather than drawn inside, so a test gets a fixed answer.
 */
export function retryDelay(
  header: string | null,
  attempt: number,
  cap: number,
  now: number = Date.now(),
  jitter = 0,
): number {
  const h = (header || '').trim()
  if (h) {
    // NUMERIC OR DATE, DECIDED UP FRONT — never both. Reading it as a number first and falling
    // through to Date.parse looked fine and was not: Date.parse('-5') parses as a YEAR, lands far
    // in the past, and came out as "wait 0ms". A malformed header would have made us hammer the
    // very server that had just asked us to slow down. A test caught it; the shape below cannot.
    if (/^-?\d+(\.\d+)?$/.test(h)) {
      const secs = Number(h)
      if (secs >= 0) return Math.min(secs * 1000, cap)
      // Negative seconds are nonsense. Ignore them and back off normally.
    } else {
      const when = Date.parse(h)
      if (Number.isFinite(when)) return Math.min(Math.max(when - now, 0), cap)
    }
    // An unreadable Retry-After is not a reason to give up — fall through to the backoff.
  }
  // 1s, 2s, 4s… capped, plus the caller's jitter so two callers do not return in lockstep.
  return Math.min(1000 * Math.pow(2, attempt - 1), cap) + jitter
}

function waitFor(res: Response, attempt: number, cap: number): number {
  return retryDelay(res.headers.get('retry-after'), attempt, cap, Date.now(), Math.floor(Math.random() * 300))
}

/**
 * fetch, with Guesty's rate limit treated as a wait rather than a failure.
 *
 * Returns the final Response — including a still-429 one when the budget runs out, so the caller
 * decides what to tell the person. Never throws for a status; a thrown network error is retried the
 * same way and rethrown if it never succeeds.
 */
export async function guestyFetch(
  url: string,
  init?: RequestInit,
  opts?: { attempts?: number; capMs?: number },
): Promise<Response> {
  const attempts = Math.max(1, opts?.attempts ?? 4)
  const cap = opts?.capMs ?? 8000
  let lastErr: any = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await fetch(url, { ...init, cache: 'no-store' })
      if (!RETRY.has(r.status) || attempt === attempts) return r
      await sleep(waitFor(r, attempt, cap))
    } catch (e: any) {
      lastErr = e
      if (attempt === attempts) throw e
      await sleep(Math.min(1000 * attempt, cap))
    }
  }
  throw lastErr || new Error('guestyFetch: exhausted')
}

/** True when a response is Guesty asking us to slow down — for a message a person can act on. */
export const isRateLimited = (status: number) => status === 429

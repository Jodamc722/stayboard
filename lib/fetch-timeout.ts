// ONE TIMEOUT RULE FOR EVERY OUTSIDE API THE SYNCS CALL (2026-09-28 cron audit, #4).
//
// None of the sync clients had a timeout. A hung socket to Guesty, Breezeway, Homebase or
// Talkroute ran until Vercel killed the function at its maxDuration — and a killed function writes
// no receipt, stamps no error and records nothing, so the feed simply looked "stale, no error",
// the hardest failure there is to notice. Now a call that has not answered in 20 seconds (30 for
// Guesty's accounting API, which is slow by nature) becomes an ordinary error the job can report.
//
// A timeout is treated like a 5xx: retried ONCE when the request is safe to repeat, then thrown.
// A timed-out POST or PATCH is never retried — it may already have happened on the other side
// (a guest message sent, a task created), and sending it twice is worse than reporting it once.
import 'server-only'

export const API_TIMEOUT_MS = 20_000
export const ACCOUNTING_TIMEOUT_MS = 30_000

/** True for the error fetch throws when its AbortSignal.timeout fires. */
export function isTimeout(e: any): boolean {
  const name = String((e && e.name) || '')
  if (name === 'TimeoutError' || name === 'AbortError') return true
  return /aborted due to timeout|timed out/i.test(String((e && e.message) || ''))
}

/** May this request be sent a second time without risk of doing the thing twice? */
export function repeatable(method?: string): boolean {
  const m = String(method || 'GET').toUpperCase()
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || m === 'PUT' || m === 'DELETE'
}

/**
 * fetch with a hard timeout. `label` names the call in the thrown error ("Guesty /reservations
 * timed out after 20s") — never include a secret or a full query string in it.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  opts: { ms?: number; label?: string } = {},
): Promise<Response> {
  // A caller that brings its own signal owns its own cancellation.
  if (init.signal) return fetch(url, init)
  const ms = opts.ms || API_TIMEOUT_MS
  const retry = repeatable(init.method)
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
    } catch (e: any) {
      if (!isTimeout(e)) throw e
      if (retry && attempt === 1) continue
      throw new Error(`${opts.label || 'request'} timed out after ${Math.round(ms / 1000)}s`)
    }
  }
}

/** Retry-After (seconds, or an HTTP date) as milliseconds; null when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined): number | null {
  const h = String(header || '').trim()
  if (!h) return null
  const n = Number(h)
  if (Number.isFinite(n) && n >= 0) return n * 1000
  const t = Date.parse(h)
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null
}

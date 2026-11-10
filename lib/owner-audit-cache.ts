// THE STATEMENT REVIEW, BUILT ONCE AND REUSED FOR A MINUTE (2026-11-09 audit).
//
// buildAudit() re-reads a whole month of ledger lines, a reservation scan, last month's rates and
// every folio on EVERY request — four seconds and more, for a page that is reloaded after every few
// clicks and whose opened rows now ask for their line items separately. This keeps the finished
// audit in memory, per month, for a short while.
//
// THE NUMBERS DO NOT CHANGE. What is kept is the exact object buildAudit() returned. It is only
// reused when BOTH hold:
//   1. it is younger than TTL_MS, and
//   2. the saved reviews for the month are the ones it was built with — a cheap fingerprint (row
//      count + newest updated_at) is read on every request, so an approval, note, comment or
//      sign-off saved by ANYONE, on any server instance, forces a fresh build on the next load.
// Anything else that feeds the audit (the Guesty mirror, claims) can be at most TTL_MS old, and the
// actions that change those on purpose — Sync, Re-check, a claim's "owner adjusted" tick — drop the
// kept copy outright (bustAudit).
//
// In memory on purpose: the audit is far over the 2 MB the Next data cache will hold, and a copy
// per server instance is all a one-minute cache needs.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { auditMonths, buildAudit, type AuditData, type AuditMonthPick } from './owner-audit'

const TTL_MS = 60_000
const MAX_MONTHS = 4

type Entry = { at: number; fp: string; data: AuditData }
const kept = new Map<string, Entry>()
const building = new Map<string, Promise<Entry>>()
// Bumped by every bust, so a build that was already running when something changed is handed to
// its caller but never kept.
let gen = 0

/** Count + newest edit of the month's saved reviews. '' when it cannot be read (never reuse then). */
async function reviewsFingerprint(month: string): Promise<string> {
  try {
    const sb = supabaseAdmin()
    const [c, n] = await Promise.all([
      sb.from('owner_audit_reviews').select('owner_id', { count: 'exact', head: true }).eq('month', month),
      sb.from('owner_audit_reviews').select('updated_at').eq('month', month).order('updated_at', { ascending: false }).limit(1),
    ])
    if (c.error || n.error) return ''
    const newest = Array.isArray(n.data) && n.data.length ? String((n.data[0] as any).updated_at || '') : ''
    return String(c.count ?? 0) + '|' + newest
  } catch { return '' }
}

/** Forget the kept audit for one month, or for every month. */
export function bustAudit(month?: string): void {
  gen++
  if (month) {
    kept.delete(month)
    for (const k of Array.from(building.keys())) if (k.startsWith(month + '#')) building.delete(k)
  } else { kept.clear(); building.clear() }
  months = null
}

// The month picker's feed (one row per statement, every month, counted). Kept for a minute and
// dropped with everything else on a bust, so a Sync that brings in a new month shows it at once.
let months: { at: number; data: AuditMonthPick[] } | null = null
export async function getAuditMonths(): Promise<AuditMonthPick[]> {
  if (months && Date.now() - months.at < TTL_MS) return months.data
  const startGen = gen
  const data = await auditMonths()
  if (gen === startGen) months = { at: Date.now(), data }
  return data
}

/**
 * For an opened row's line items and folio. Those do not depend on the saved reviews, so a kept
 * audit is good for this even after someone has approved a row (which would otherwise force a
 * four-second rebuild just to open the next one) — for DETAIL_TTL_MS, and never past a bust.
 */
const DETAIL_TTL_MS = 5 * 60_000
export async function getAuditForDetail(month: string): Promise<AuditData> {
  const have = kept.get(month)
  if (have && Date.now() - have.at < DETAIL_TTL_MS) return have.data
  return getAudit(month)
}

/**
 * The audit for a month: the kept copy when it is fresh and the reviews have not moved, otherwise
 * a new build. Concurrent callers for the same month share one build.
 */
export async function getAudit(month: string): Promise<AuditData> {
  const fp = await reviewsFingerprint(month)
  const have = kept.get(month)
  if (have && fp && have.fp === fp && Date.now() - have.at < TTL_MS) return have.data

  const startGen = gen
  const key = month + '#' + fp
  let p = fp ? building.get(key) : undefined
  if (!p) {
    p = (async (): Promise<Entry> => {
      const data = await buildAudit(month)
      return { at: Date.now(), fp, data }
    })()
    if (fp) {
      building.set(key, p)
      const done = () => { if (building.get(key) === p) building.delete(key) }
      p.then(done, done)
    }
  }
  const entry = await p
  // Kept only when the fingerprint was readable, and only if nothing was saved while it was building
  // (a review written mid-build may or may not be in it — the next request must not trust it).
  if (fp) {
    const after = await reviewsFingerprint(month)
    if (after === fp && gen === startGen) {
      kept.set(month, entry)
      while (kept.size > MAX_MONTHS) {
        const oldest = kept.keys().next().value
        if (oldest === undefined) break
        kept.delete(oldest)
      }
    }
  }
  return entry.data
}

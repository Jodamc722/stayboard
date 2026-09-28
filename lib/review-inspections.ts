// A BAD REVIEW THAT HAS BEEN WALKED IS DONE.
//
// Jon, 2026-09-28: "if a bad review or quality inspection is done, it should not populate if it's
// completed. The same bad review should not populate the same bad review inspection."
//
// Four places turn a low review into a quality inspection — the low-review automation
// (lib/auto-inspections), Eve's bad-review watch (lib/eve/watches), the Command Center's arrival
// feedback rows (lib/command-day) and the reviews dashboard's "walk this unit" (api/reviews/kpi).
// Each of them knew about its OWN receipt and about inspections still open, and none of them knew
// that somebody had already walked the unit and finished — so a review kept coming back as a new
// inspection after the inspection it caused was closed. This is the one answer they all read:
//
//   a review is COVERED when a quality inspection on that listing FINISHED on or after the day the
//   review landed.
//
// Finished, not scheduled: an inspection created and never done covers nothing. On or after the
// review, not merely recent: a walk done the week before the guest complained did not see what the
// guest saw. Any inspection counts, whoever raised it — the automation, Eve, a person in Breezeway.
import 'server-only'

export type FinishedInspection = { id: string; listingId: string; name: string; finishedAt: string; scheduledDate: string }

const INSPECTION_NAME = 'name.ilike.%quality inspection%,name.ilike.%inspect%,name.ilike.%unit check%'

/**
 * Every finished inspection on these listings since `sinceIso` (an ISO date or datetime), newest
 * first per listing. One read for a whole batch; callers pass the oldest review they hold.
 */
export async function finishedInspectionsSince(db: any, listingIds: string[], sinceIso: string): Promise<Record<string, FinishedInspection[]>> {
  const out: Record<string, FinishedInspection[]> = {}
  const ids = Array.from(new Set(listingIds.map(String).filter(Boolean)))
  if (!ids.length) return out
  const since = String(sinceIso || '').slice(0, 10) || '1970-01-01'
  try {
    const { data } = await db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,finished_at,scheduled_date,type_department')
      .in('reference_property_id', ids.slice(0, 500))
      .not('finished_at', 'is', null)
      .gte('finished_at', since + 'T00:00:00Z')
      .or(INSPECTION_NAME)
      .order('finished_at', { ascending: false })
      .limit(3000)
    for (const t of ((data as any[]) || [])) {
      // A departure clean with "inspect" in its checklist name is a clean, not a walk.
      if (/housekeep/i.test(String(t.type_department || '')) && !/quality inspection/i.test(String(t.name || ''))) continue
      const lid = String(t.reference_property_id || '')
      if (!lid) continue
      ;(out[lid] = out[lid] || []).push({
        id: String(t.id), listingId: lid, name: String(t.name || ''),
        finishedAt: String(t.finished_at), scheduledDate: String(t.scheduled_date || '').slice(0, 10),
      })
    }
  } catch { /* no mirror: nothing is covered, every caller falls back to its own receipt */ }
  return out
}

/** The inspection that covers this review — finished on or after the review's day — or null. */
export function inspectionCovering(done: Record<string, FinishedInspection[]>, listingId: any, reviewAt: any): FinishedInspection | null {
  const rows = done[String(listingId || '')]
  if (!rows || !rows.length) return null
  const day = String(reviewAt || '').slice(0, 10)
  if (!day) return null
  for (const r of rows) if (r.finishedAt.slice(0, 10) >= day) return r
  return null
}

/** Set of review ids (from `reviews`, each {id, listing_id, created_at}) already covered by a finished walk. */
export async function coveredReviewIds(db: any, reviews: Array<{ id: any; listing_id: any; created_at: any }>): Promise<Map<string, FinishedInspection>> {
  const out = new Map<string, FinishedInspection>()
  if (!reviews.length) return out
  const oldest = reviews.map(r => String(r.created_at || '')).filter(Boolean).sort()[0] || ''
  const done = await finishedInspectionsSince(db, reviews.map(r => String(r.listing_id || '')), oldest)
  for (const r of reviews) {
    const hit = inspectionCovering(done, r.listing_id, r.created_at)
    if (hit) out.set(String(r.id), hit)
  }
  return out
}

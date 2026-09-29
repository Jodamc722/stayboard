// Open work attributable to a SPECIFIC unit, keyed by listing_id. The health score's ops component
// used to take a whole BUILDING's open-work count and apply it to every unit in that building, so
// one unit's backlog dragged down all ~20 units' health. Both sources here carry listing_id, so the
// signal is genuinely per-unit:
//   - field_requests (the Work Orders desk) — listing_id, high/urgent weighs double
//   - open guest glitches — listing_id, guest-reported so weighs double
// Returns { [listing_id]: weight }. Weights feed opsPts() in lib/health-score (0 → full marks,
// small counts → partial), so a per-unit scale of 0-5 is exactly right.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function openWorkByListing(db = supabaseAdmin()): Promise<Record<string, number>> {
  // PAGED, on id (2026-09-29). Each of these is a COUNT per unit, and open audit findings in
  // particular pile up (a finding stays 'task_created' after its task is made) — a single read
  // stopped at 1,000 unordered rows and every unit past it lost its open work. A read that stops
  // early is logged; the scores still compute from what came back, as they did on an error.
  const [reqRes, glRes, auRes] = await Promise.all([
    pageRows<any>((a, b) => db.from('field_requests').select('id, listing_id, priority, status').in('status', ['open', 'in_progress']).order('id').range(a, b)),
    pageRows<any>((a, b) => db.from('glitches').select('id, listing_id, status').not('status', 'in', '("done","resolved","closed")').order('id').range(a, b)),
    // AUDIT FINDINGS (walk engine / audit form): an open Fix or Clean found on a walk is real
    // per-unit open work — the audit programme finally feeds Property Health (full-audit #13).
    pageRows<any>((a, b) => db.from('audit_items').select('id, listing_id, kind, severity, status').in('kind', ['maintenance', 'clean']).in('status', ['open', 'task_created']).order('id').range(a, b)),
  ])
  if (reqRes.truncated || glRes.truncated || auRes.truncated) console.error('[open-work] a paged read stopped early — some units may be missing open work')
  const out: Record<string, number> = {}
  for (const w of reqRes.rows) {
    const id = str(w.listing_id); if (!id) continue
    const wt = /high|urgent/i.test(str(w.priority)) || w.priority === 1 ? 2 : 1
    out[id] = (out[id] || 0) + wt
  }
  for (const g of glRes.rows) {
    const id = str(g.listing_id); if (!id) continue
    out[id] = (out[id] || 0) + 2
  }
  for (const a of auRes.rows) {
    const id = str(a.listing_id); if (!id || id.startsWith('NEW:') || id.startsWith('BLDG:')) continue
    out[id] = (out[id] || 0) + (str(a.severity) === 'high' ? 2 : 1)
  }
  return out
}

// Open work attributable to a SPECIFIC unit, keyed by listing_id. The health score's ops component
// used to take a whole BUILDING's open-work count and apply it to every unit in that building, so
// one unit's backlog dragged down all ~20 units' health. Both sources here carry listing_id, so the
// signal is genuinely per-unit:
//   - field_requests (the Work Orders desk) — listing_id, high/urgent weighs double
//   - open guest glitches — listing_id, guest-reported so weighs double
// Returns { [listing_id]: weight }. Weights feed opsPts() in lib/health-score (0 → full marks,
// small counts → partial), so a per-unit scale of 0-5 is exactly right.
import { supabaseAdmin } from '@/lib/supabase-admin'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function openWorkByListing(db = supabaseAdmin()): Promise<Record<string, number>> {
  const [reqRes, glRes] = await Promise.all([
    db.from('field_requests').select('listing_id, priority, status').in('status', ['open', 'in_progress']).limit(3000),
    db.from('glitches').select('listing_id, status').not('status', 'in', '("done","resolved","closed")').limit(3000),
  ])
  const out: Record<string, number> = {}
  for (const w of (reqRes.data || []) as any[]) {
    const id = str(w.listing_id); if (!id) continue
    const wt = /high|urgent/i.test(str(w.priority)) || w.priority === 1 ? 2 : 1
    out[id] = (out[id] || 0) + wt
  }
  for (const g of (glRes.data || []) as any[]) {
    const id = str(g.listing_id); if (!id) continue
    out[id] = (out[id] || 0) + 2
  }
  return out
}

// WRITING A guest_checks ROW WHEN THE SCHEMA MAY BE A STEP BEHIND (2026-10-21).
//
// Migration 158 adds five columns (the model's reading of the ID and who cleared a flag). Until it
// has run, a write that names them fails outright — and a guest's verification must never be lost
// to a migration not yet run. So: try the full row; if the database says a column does not exist,
// drop the new columns and write the rest. The status survives; only the detail of why it was
// flagged waits for the migration. Shared by the link, the direct booking page and the desk.
import 'server-only'

export const GUEST_CHECK_NEW_COLS = ['id_check', 'id_match', 'id_read_name', 'id_checked_by', 'id_checked_at']
const MISSING_COL = (msg: string) => /column .* does not exist|schema cache|could not find the/i.test(String(msg || ''))

export async function upsertGuestCheck(db: any, row: Record<string, any>): Promise<{ ok: boolean; error?: string; degraded?: boolean }> {
  const { error } = await db.from('guest_checks').upsert(row, { onConflict: 'reservation_id' })
  if (!error) return { ok: true }
  if (!MISSING_COL(error.message)) return { ok: false, error: error.message }
  const slim: Record<string, any> = {}
  for (const k of Object.keys(row)) if (GUEST_CHECK_NEW_COLS.indexOf(k) < 0) slim[k] = row[k]
  const second = await db.from('guest_checks').upsert(slim, { onConflict: 'reservation_id' })
  if (second.error) return { ok: false, error: second.error.message }
  return { ok: true, degraded: true }
}

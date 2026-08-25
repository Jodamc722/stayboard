// WHAT KIND OF WORK IS THIS — one definition, used by the board and by the briefs.
//
// Jon, 2026-08-25, on the Today-in-Ops counters: "it should be broken out not just by Cleans,
// Maintenance, Inspections — Departure, Cleaning, Guest issues, Glitches, Maintenance, Housekeeping
// audit, Inspection." That is the real shape of a day here, and the moment two files decide
// independently what a "glitch" is, the board and the brief start disagreeing in front of the same
// person. So the rule lives here and both read it.
//
// GUEST ISSUES AND GLITCHES ARE ONE THING (Jon, same day: "what's the difference of guest issues
// and glitches, nothing, so combine"). He is right, and the proof is in the data: these arrive from
// Breezeway as a single task named "Guest Reported / Glitch — ...". Splitting on which half of that
// prefix a given task happened to use was counting one queue as two.
//
// Works from the task NAME and department alone, because that is all the brief has in hand —
// `type` is optional enrichment from /api/ops-today's typeOf() and only sharpens the same answer.
export type TaskCat = 'departure' | 'cleaning' | 'hkaudit' | 'inspection' | 'maintenance' | 'glitch'

/** Display order: the money first, then the guest-facing problems, then the periodic work. */
export const CAT_ORDER: TaskCat[] = ['departure', 'cleaning', 'glitch', 'maintenance', 'hkaudit', 'inspection']
export const CAT_LABEL: Record<TaskCat, string> = {
  departure: 'Departure', cleaning: 'Cleaning', glitch: 'Glitches',
  maintenance: 'Maintenance', hkaudit: 'Housekeeping audit', inspection: 'Inspection',
}

/**
 * ORDER MATTERS AND IS NOT ARBITRARY. A glitch is filed as a maintenance task named
 * "Guest Reported / Glitch — ...", so matching on department first would file every guest-impacting
 * problem under Maintenance — exactly the burial Jon asked to undo. Name wins over department here,
 * deliberately.
 */
export function catOfTask(t: { name?: string | null; dept?: string | null; type?: string | null }): TaskCat {
  const n = String(t.name || '').toLowerCase()
  const dept = String(t.dept || '').toLowerCase()
  const type = String(t.type || '')
  if (/glitch|guest\s*reported/.test(n)) return 'glitch'
  // The separator is whatever whoever typed the task felt like: "Check-out clean", "Check out
  // clean", "Checkout Clean" all appear. [\s-]? catches all three; -? caught only one, and the
  // misses landed in Cleaning, which is the number the 4pm deadline is measured against.
  if (type === 'departure_clean' || /departure clean|turnover clean|check[\s-]?out clean|move[\s-]?out clean/.test(n)) return 'departure'
  // "Housekeeping Audit" is a cleanliness score, not a maintenance walk — its own counter because
  // it is the number the housekeeping standard is measured on.
  if (/housekeep\w*\s*audit|audit\s*\W*\s*housekeep/.test(n) || (type === 'audit' && dept === 'housekeeping')) return 'hkaudit'
  if (dept === 'housekeeping' || /housekeep|clean/.test(dept) || type === 'strip' || type === 'deep_clean') return 'cleaning'
  if (type === 'inspection' || type === 'audit' || dept === 'inspection' || /unit check|inspect/.test(n)) return 'inspection'
  return 'maintenance'
}

/** Finished / in progress / not started, from whatever a Breezeway row happens to carry. */
export function stateOfTask(t: { status?: any; started_at?: any; finished_at?: any }): 'done' | 'running' | 'open' {
  const s = String(t.status == null ? '' : t.status).toLowerCase()
  if (/complete|finish|close|approv/.test(s) || t.finished_at) return 'done'
  if (/progress|started/.test(s) || t.started_at) return 'running'
  return 'open'
}

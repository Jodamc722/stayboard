// A UNIT SOLD WHOLE AND IN PARTS IS STILL ONE APARTMENT.
//
// Jon, 2026-08-27: "Make sure we don't push double — full parent listing with same tasks. Only
// individual listing."
//
// Several apartments are listed in Guesty more than once: the whole thing, and each lock-off half.
//   "3316 Full - 4 BR"      alongside  "3316/1 - 2BR"  and  "3316/2 - 2BR"
//   "Capri 115/116"         alongside  "Capri 115 - 1BR"
// To Guesty these are three unrelated listings. To a technician they are one front door. Anything
// that walks the listing table and proposes work per listing therefore proposes the SAME A/C deep
// clean two or three times for one apartment — and dispatches two people to it.
//
// GUESTY DOES NOT MODEL THIS. `complexId` is building-level (all 32 Elser units share one), so it
// cannot answer "is this listing part of that listing". The relationship has to be read off the
// names, which is what lib/blocked-units worked out first — this file is that rule, lifted out so
// there is ONE definition of it rather than a second copy that drifts.
//
// ── THE RULE, AND THE MISTAKE IT AVOIDS ─────────────────────────────────────────────────────────
// Group listings by <canonical building>#<first 3-4 digit number in the name>. A shared room number
// alone is NOT enough: "906/2" through "906/9" are eight separate studios in one building, and an
// earlier version of the blocked-units report claimed blocking one took seven others offline. A
// genuine whole-and-parts set must contain a listing that names ITSELF as the whole — either the
// word "Full", or two room numbers combined ("115/116"). No parent in the set means it is ordinary
// unit numbering and every listing stands alone.
import 'server-only'

/** Names itself as the whole unit: "3316 Full - 4BR", or a combination like "Capri 115/116". */
export function isParentName(name: string): boolean {
  const n = String(name || '')
  return /\bfull\b/i.test(n) || /\b\d{3,4}\s*\/\s*\d{3,4}\b/.test(n)
}

/** <building>#<room>, or null when the name carries no room number to group on. */
export function roomKeyOf(building: string, name: string): string | null {
  const m = String(name || '').match(/(\d{3,4})/)
  return m ? String(building || '').toLowerCase() + '#' + m[1] : null
}

export type LinkedUnit = { listingId: string; unit: string; building: string }

export type LinkedSets = {
  /** listingId -> the physical space it belongs to. Standalone listings map to their own id. */
  spaceOf: Record<string, string>
  /** listingId -> true when this listing is the WHOLE unit and real parts of it are also listed. */
  isRedundantParent: Record<string, boolean>
  /** A child listing -> the parent listings that contain it. History flows down this edge. */
  parentsOf: Record<string, string[]>
  /** How many apartments were found to be listed more than once. For honest reporting. */
  sets: number
}

/**
 * Work out which listings are the same apartment.
 *
 * Deliberately conservative in both directions: a set without a self-declared whole-unit listing is
 * left completely alone, and siblings are never linked to each other — "3316/1" and "3316/2" are
 * two separate halves with their own A/C and their own locks, so work on one says nothing about the
 * other. Only the parent-to-child edge is real, which is the same edge lib/blocked-units uses to
 * decide what a block takes offline.
 */
export function linkedSets(units: LinkedUnit[]): LinkedSets {
  const spaceOf: Record<string, string> = {}
  const isRedundantParent: Record<string, boolean> = {}
  const parentsOf: Record<string, string[]> = {}

  const byRoom: Record<string, LinkedUnit[]> = {}
  for (const u of units) {
    spaceOf[u.listingId] = u.listingId          // standalone until proven otherwise
    const k = roomKeyOf(u.building, u.unit)
    if (k) (byRoom[k] = byRoom[k] || []).push(u)
  }

  let sets = 0
  for (const k of Object.keys(byRoom)) {
    const set = byRoom[k]
    if (set.length < 2) continue
    const parents = set.filter(u => isParentName(u.unit))
    const children = set.filter(u => !isParentName(u.unit))
    // No self-declared whole unit, or nothing but whole units — ordinary numbering, leave it alone.
    if (!parents.length || !children.length) continue
    sets++
    for (const u of set) spaceOf[u.listingId] = k
    for (const p of parents) isRedundantParent[p.listingId] = true
    for (const c of children) parentsOf[c.listingId] = parents.map(p => p.listingId)
  }

  return { spaceOf, isRedundantParent, parentsOf, sets }
}

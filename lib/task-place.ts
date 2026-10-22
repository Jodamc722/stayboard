// WHERE A TASK IS, AND WHAT THE BOARD ADDS UP TO (Jon, 2026-10-22: the maintenance & vendors board —
// "LOCATION | PROPERTY | UNIT | ISSUE", Miami or Broward, and summary cards at the top: open,
// Miami, Broward, overdue follow-ups, due today, waiting for vendor, waiting for approval, completed).
//
// A task's place comes from the UNIT ATTACHED to it (a Guesty listing: its building and market),
// with an explicit `location` on the task winning for building-level work that has no unit. The
// board's tiles are counted here, from the same tasks the columns show, so a number on a tile is
// always a filter away from the rows behind it.
//
// Pure, no imports, so lib/__tests__/task-place.test.mjs runs it with plain node.

export const LOCATIONS = ['Miami', 'Broward'] as const
export type Location = typeof LOCATIONS[number]

export type Place = { location: string | null; building: string | null; unit: string | null }
export type PlacedLink = { kind: string; ref_id: string; task_id?: string | null; label?: string | null; place?: { building: string | null; market: string | null; unit: string | null } | null }

/** Which columns are "waiting on the vendor" and "waiting on an approval" — by the column's name. */
export const WAIT_VENDOR_RE = /vendor|parts|scheduled|quote/i
export const WAIT_APPROVAL_RE = /approval|approve|sign[- ]?off/i
export const FOLLOW_UP_RE = /follow[- ]?up/i

const squash = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const TYPE_WORD = /^(studio|suite|king|queen|loft|penthouse|ph|accessible|\d+\s*br|\d+\s*bed|\d+\s*bd|\d+b|[0-9]+br)\b/i

/**
 * The unit number out of a listing nickname: "17WEST - 511 - 2BR" → "511", "Arya 1705/2 - Studio"
 * → "1705/2", "Botanica 1106 - King Studio" → "1106", "Pelican 3 - Studio" → "3". The building's
 * own name is cut off the front however it is spelled (17WEST / 17 West), and a trailing type word
 * is never a unit.
 */
export function unitOf(nickname: string | null | undefined, building: string | null | undefined): string | null {
  const name = String(nickname || '').trim()
  if (!name) return null
  const parts = name.split(/\s+[-–—]\s+/).map(x => x.trim()).filter(Boolean)
  if (!parts.length) return null
  let first = parts[0]
  const b = squash(building)
  if (b) {
    // Cut the building off the front by comparing letters only: "17 West" matches "17WEST". When
    // the first segment WAS the building ("17WEST - 511 - 2BR"), the unit is the next one.
    let i = 0, seen = ''
    while (i < first.length && seen.length < b.length) { const ch = first[i].toLowerCase(); if (/[a-z0-9]/.test(ch)) seen += ch; i++ }
    if (seen === b) {
      first = first.slice(i).replace(/^[\s\-–—:#]+/, '').trim()
      if (!first) first = parts[1] || ''
    }
  }
  first = first.replace(/^[\s\-–—:#]+/, '').replace(/^(unit|apt|apartment|suite|#)\s*/i, '').trim()
  if (!first || TYPE_WORD.test(first)) return null
  return first.slice(0, 24)
}

/** The place a task sits at: its own location first, else the attached unit's. */
export function taskPlace(t: { id: string; location?: string | null; place?: Place | null }, links: PlacedLink[]): Place {
  if (t.place && (t.place.building || t.place.unit || t.place.location)) return t.place
  const own = (LOCATIONS as readonly string[]).includes(String(t.location || '')) ? String(t.location) : null
  const unitLink = links.find(l => l.kind === 'listing' && String(l.task_id || '') === String(t.id))
  const p = unitLink?.place || null
  const market = p?.market && (LOCATIONS as readonly string[]).includes(p.market) ? p.market : null
  return {
    location: own || market,
    building: p?.building || null,
    unit: p?.unit || (unitLink ? unitOf(unitLink.label, p?.building) : null),
  }
}

/** "MIAMI | 17 West | 511" — the prefix a card shows before the issue; '' when nothing is known. */
export function placePrefix(pl: Place): string {
  return [pl.location ? pl.location.toUpperCase() : '', pl.building || '', pl.unit || ''].filter(Boolean).join(' | ')
}

export type BoardStats = {
  open: number; byLocation: Record<string, number>; overdue: number; today: number
  waitingVendor: number; waitingApproval: number; followUp: number; completed: number
}
/**
 * The summary cards. Counted over top-level tasks only: a checklist item under a job is not a
 * second job. A task counts as "waiting for vendor" by the column it sits in (Vendor contact,
 * Scheduled, Waiting for parts, Waiting for quote) or by carrying a vendor while open and not
 * yet in progress; "waiting for approval" by its column name. Overdue and due today read the
 * follow-up date (the task's due date).
 */
export function boardStats(tasks: { id: string; status: string; due_on: string | null; section: string | null; parent_id?: string | null; vendor_name?: string | null; location?: string | null; place?: Place | null }[], links: PlacedLink[], today: string): BoardStats {
  const out: BoardStats = { open: 0, byLocation: {}, overdue: 0, today: 0, waitingVendor: 0, waitingApproval: 0, followUp: 0, completed: 0 }
  for (const t of tasks) {
    if (t.parent_id) continue
    if (t.status === 'done') { out.completed++; continue }
    out.open++
    const pl = taskPlace(t, links)
    if (pl.location) out.byLocation[pl.location] = (out.byLocation[pl.location] || 0) + 1
    if (t.due_on && t.due_on < today) out.overdue++
    if (t.due_on === today) out.today++
    const sec = String(t.section || '')
    if (WAIT_APPROVAL_RE.test(sec)) out.waitingApproval++
    else if (WAIT_VENDOR_RE.test(sec) || (t.vendor_name && !/progress|doing|complete|done/i.test(sec))) out.waitingVendor++
    if (FOLLOW_UP_RE.test(sec)) out.followUp++
  }
  return out
}

/** Dollars typed by a person → cents stored; '' / junk → null. */
export function dollarsToCents(v: any): number | null {
  const s = String(v ?? '').replace(/[^0-9.\-]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
export function centsToDollars(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(Number(c))) return ''
  const n = Number(c) / 100
  return '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
}

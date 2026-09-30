// PEOPLE WHO MUST NEVER BE ASSIGNED IN BREEZEWAY — THE MATCHER.
//
// Jon, 2026-09-30: an owner of the company was being handed Breezeway tasks. Owners, office staff
// and anyone else who should never receive field work go on one list in Settings (app_settings
// 'breezeway_never_assign', edited in Admin → Users & admin → Settings → Task automation). The list
// holds names, never code: nobody is named here.
//
// This file is the pure half — no imports on purpose, so `node lib/__tests__/never-assign.test.mjs`
// checks the very module every picker and assign endpoint runs (node >= 22.18 strips the types).
// The server half (lib/never-assign.ts) reads the setting and resolves Breezeway person ids.
//
// THE MATCH, in the same style as lib/breezeway matchBreezewayPerson:
//   • a Breezeway person id on the entry wins outright — ids never drift;
//   • otherwise the full name, case- and accent-insensitive, punctuation ignored;
//   • or the same surname with a first name that is a shortening of the other ("Jon" / "Jonathan"),
//     so a middle initial or a nickname on one side does not let the person through.
// A single word on EITHER side never matches a full name — "Maria" alone must not block every Maria
// on the crew. Short names typed elsewhere (an automation assignee, a chat request) are resolved to
// a Breezeway person first, and the id decides.

export type NeverAssignEntry = { name: string; personId?: number | null }
/** Anything that can be checked: a Breezeway person, a roster row, a bare name or a bare id. */
export type PersonLike = { id?: any; name?: any } | string | number | null | undefined

export const NEVER_ASSIGN_MAX = 50

/** Lower case, accents and punctuation gone, single spaces — the matchBreezewayPerson normal form. */
export function normPersonName(s: any): string {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
}

const sameFirst = (a: string, b: string) => !!a && !!b && a.length >= 2 && b.length >= 2 && (a === b || a.startsWith(b) || b.startsWith(a))

/** True when two names are the same person by the rule above. */
export function sameFullName(a: any, b: any): boolean {
  const x = normPersonName(a), y = normPersonName(b)
  if (!x || !y) return false
  if (x === y) return true            // the very same words — including a one-word entry typed as such
  const xs = x.split(' '), ys = y.split(' ')
  if (xs.length < 2 || ys.length < 2) return false
  return xs[xs.length - 1] === ys[ys.length - 1] && sameFirst(xs[0], ys[0])
}

const idOf = (v: any): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/**
 * The stored value, made safe: { people: [...] } or a bare array; each entry a name string or
 * { name, personId }. Blank names dropped, duplicates (same name or same id) folded, capped.
 */
export function normNeverAssignList(v: any): NeverAssignEntry[] {
  const raw: any[] = Array.isArray(v) ? v : (v && typeof v === 'object' && Array.isArray(v.people) ? v.people : [])
  const out: NeverAssignEntry[] = []
  for (const r of raw) {
    const name = String(typeof r === 'string' ? r : (r && typeof r === 'object' ? (r.name ?? '') : '')).replace(/\s+/g, ' ').trim().slice(0, 80)
    const personId = r && typeof r === 'object' ? idOf(r.personId ?? r.person_id ?? r.id) : null
    if (!name && personId == null) continue
    const dupe = out.find(e => (personId != null && e.personId === personId) || (!!name && normPersonName(e.name) === normPersonName(name)))
    if (dupe) { if (dupe.personId == null && personId != null) dupe.personId = personId; continue }
    out.push(personId != null ? { name, personId } : { name })
    if (out.length >= NEVER_ASSIGN_MAX) break
  }
  return out
}

/** Is this person on the list? By id when either side has one, else by name. */
export function isNeverAssign(p: PersonLike, list: NeverAssignEntry[]): boolean {
  if (!list || !list.length || p == null) return false
  const id = typeof p === 'number' ? idOf(p) : typeof p === 'object' ? idOf((p as any).id) : null
  const name = typeof p === 'string' ? p : typeof p === 'object' ? String((p as any).name ?? '') : ''
  for (const e of list) {
    if (id != null && e.personId != null && e.personId === id) return true
    if (name && e.name && sameFullName(name, e.name)) return true
  }
  return false
}

/** The entry this person matched, for a message that names who and why. */
export function neverAssignEntryFor(p: PersonLike, list: NeverAssignEntry[]): NeverAssignEntry | null {
  if (!isNeverAssign(p, list)) return null
  return list.find(e => isNeverAssign(p, [e])) || null
}

/** The people who may still be offered or assigned. Order kept. */
export function filterAssignable<T extends { id?: any; name?: any }>(people: T[], list: NeverAssignEntry[], blockedIds?: Iterable<number>): T[] {
  const ids = new Set<number>(blockedIds ? Array.from(blockedIds) : [])
  if ((!list || !list.length) && !ids.size) return people
  return (people || []).filter(p => {
    const id = idOf(p && p.id)
    if (id != null && ids.has(id)) return false
    return !isNeverAssign(p, list)
  })
}

/** The Breezeway ids the list stands for: explicit ids plus every roster person whose name matches. */
export function blockedIdsFrom(roster: { id: any; name: any }[], list: NeverAssignEntry[]): number[] {
  const out = new Set<number>()
  for (const e of list || []) if (e.personId != null) out.add(e.personId)
  for (const p of roster || []) {
    const id = idOf(p && p.id)
    if (id != null && isNeverAssign({ name: p.name }, list)) out.add(id)
  }
  return Array.from(out)
}

/** The sentence an assign endpoint returns with its 400, and a picker shows on hover. */
export function neverAssignMessage(names: string[]): string {
  const who = names.filter(Boolean)
  const list = who.length ? who.join(', ') : 'That person'
  return list + (who.length > 1 ? ' are' : ' is') + ' on the never-assign list and cannot be assigned in Breezeway (Admin → Users & admin → Settings → Task automation).'
}

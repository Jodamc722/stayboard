// PEOPLE WHO MUST NEVER BE ASSIGNED IN BREEZEWAY — THE SERVER HALF.
//
// Jon, 2026-09-30: an owner of the company kept being handed Breezeway tasks. The answer is a
// setting, not a name in code: app_settings 'breezeway_never_assign' = { people: [{ name, personId? }] },
// edited in Admin → Users & admin → Settings → Task automation → "Never assign in Breezeway".
//
// WHERE IT HOLDS (every place a person can be picked, or picked for them):
//   • the rosters behind every assign picker (GET /api/breezeway/people, the Scheduler's
//     housekeepers, the field-board, audit and project pickers) — the person is simply not offered;
//   • the recommenders (capacity moves, the ops-desk chase, the shadow scheduler, cadence
//     suggestions, the trip sweep, the automations' assignees, Eve's watches) — never proposed;
//   • the assign endpoints and Eve's executors — a request naming them is refused with a 400;
//   • lib/breezeway createBreezewayTask / updateBreezewayTask — the last line: a blocked id is
//     stripped from `assignments` whatever path sent it.
// History is NOT filtered: who did past work, labor, cleaner records all stay exactly as they were.
//
// Cheap when empty: the setting read is cached 60s (lib/app-settings), and the Breezeway roster is
// only read when some entry has no person id to go on.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { breezewayPeopleLite, matchBreezewayPerson } from './breezeway'
import {
  normNeverAssignList, isNeverAssign, blockedIdsFrom, neverAssignMessage, normPersonName,
  type NeverAssignEntry, type PersonLike,
} from './never-assign-match'

export { neverAssignMessage, type NeverAssignEntry } from './never-assign-match'

export const NEVER_ASSIGN_KEY = 'breezeway_never_assign'

export async function getNeverAssign(): Promise<NeverAssignEntry[]> {
  try { return normNeverAssignList(await getSetting<any>(NEVER_ASSIGN_KEY, null)) } catch { return [] }
}

export async function saveNeverAssign(list: any, by: string | null): Promise<{ ok: boolean; people: NeverAssignEntry[]; error?: string }> {
  const people = normNeverAssignList(list)
  const r = await setSetting(NEVER_ASSIGN_KEY, { people }, by)
  _guard = null
  return { ok: r.ok, people, error: r.error }
}

export type NeverAssignGuard = {
  /** False when the list is empty — every check below is then a pass-through. */
  active: boolean
  list: NeverAssignEntry[]
  /** Breezeway person ids the list stands for. */
  ids: Set<number>
  /** Roster names behind those ids, so a check by name catches a Breezeway spelling too. */
  names: string[]
  /** True when this person must never be assigned (id, name, or a roster row). */
  blocks(p: PersonLike): boolean
  keepIds(ids: any[]): number[]
  keepNames(names: any[]): string[]
  keepPeople<T extends { id?: any; name?: any }>(people: T[]): T[]
  /** The name to say for a blocked id (the list's own spelling, else Breezeway's). */
  nameOf(id: number): string
}

const PASS: NeverAssignGuard = {
  active: false, list: [], ids: new Set(), names: [],
  blocks: () => false,
  nameOf: () => 'That person',
  keepIds: (ids) => (ids || []).map(Number).filter(n => Number.isFinite(n)),
  keepNames: (names) => (names || []).map(n => String(n ?? '')).filter(Boolean),
  keepPeople: (people) => people || [],
}

// One resolution per 60 seconds per process — the same life as the setting cache under it.
let _guard: { at: number; g: NeverAssignGuard } | null = null
const GUARD_TTL_MS = 60_000

/** The list, resolved to Breezeway ids. Never throws: a failure answers with what it could resolve. */
export async function neverAssignGuard(): Promise<NeverAssignGuard> {
  if (_guard && Date.now() - _guard.at < GUARD_TTL_MS) return _guard.g
  const list = await getNeverAssign()
  if (!list.length) { _guard = { at: Date.now(), g: PASS }; return PASS }
  let roster: { id: number; name: string }[] = []
  // The roster is only needed to turn a NAME into ids; entries that carry their id stand alone.
  if (list.some(e => e.personId == null)) { try { roster = await breezewayPeopleLite() } catch { roster = [] } }
  const ids = new Set<number>(blockedIdsFrom(roster, list))
  const names = Array.from(new Set([
    ...list.map(e => e.name).filter(Boolean),
    ...roster.filter(p => ids.has(Number(p.id))).map(p => p.name),
  ]))
  const nameById: Record<number, string> = {}
  for (const p of roster) if (ids.has(Number(p.id))) nameById[Number(p.id)] = p.name
  for (const e of list) if (e.personId != null && e.name) nameById[e.personId] = e.name
  const blocks = (p: PersonLike): boolean => {
    if (p == null) return false
    const id = typeof p === 'number' ? p : typeof p === 'object' ? Number((p as any).id) : NaN
    if (Number.isFinite(id) && ids.has(Number(id))) return true
    if (isNeverAssign(p, list)) return true
    const nm = typeof p === 'string' ? p : typeof p === 'object' ? String((p as any).name ?? '') : ''
    return !!nm && names.some(n => normPersonName(n) === normPersonName(nm))
  }
  const g: NeverAssignGuard = {
    active: true, list, ids, names,
    blocks,
    keepIds: (xs) => (xs || []).map(Number).filter(n => Number.isFinite(n) && !ids.has(n)),
    keepNames: (xs) => (xs || []).map(n => String(n ?? '')).filter(n => n && !blocks(n)),
    keepPeople: (people) => (people || []).filter(p => !blocks(p)),
    nameOf: (id) => nameById[Number(id)] || 'That person',
  }
  _guard = { at: Date.now(), g }
  return g
}

/**
 * For an assign endpoint: null when everyone requested may be assigned, else the 400 message.
 * Names are checked as written AND resolved through Breezeway's people list, so a short name
 * ("the first name only") that resolves to a blocked person is refused too.
 */
export async function neverAssignRefusal(input: { ids?: any[]; names?: any[] }): Promise<string | null> {
  const g = await neverAssignGuard()
  if (!g.active) return null
  const hit: string[] = []
  for (const raw of input.ids || []) {
    const id = Number(raw)
    if (Number.isFinite(id) && g.ids.has(id)) hit.push(g.nameOf(id))
  }
  for (const raw of input.names || []) {
    const nm = String(raw ?? '').trim()
    if (!nm) continue
    if (g.blocks(nm)) { hit.push(nm); continue }
    let id: number | null = null
    try { id = await matchBreezewayPerson(nm) } catch { id = null }
    if (id != null && g.ids.has(Number(id))) hit.push(nm)
  }
  return hit.length ? neverAssignMessage(Array.from(new Set(hit))) : null
}

/** Where each entry lands in Breezeway right now — the settings panel shows it beside the name. */
export async function resolveNeverAssign(list: NeverAssignEntry[]): Promise<{ name: string; personId: number | null; matches: { id: number; name: string }[] }[]> {
  let roster: { id: number; name: string }[] = []
  try { roster = await breezewayPeopleLite() } catch { roster = [] }
  return list.map(e => ({
    name: e.name, personId: e.personId ?? null,
    matches: roster.filter(p => (e.personId != null && Number(p.id) === e.personId) || (!!e.name && isNeverAssign({ name: p.name }, [{ name: e.name }]))).map(p => ({ id: Number(p.id), name: p.name })),
  }))
}

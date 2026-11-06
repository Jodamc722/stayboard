// NO-SERVICE BUILDINGS — buildings where Lighthouse never drafts, auto-creates or nags about
// inspections or welcome calls.
//
// Jon, 2026-11-06: "We do not need to do any inspections or welcome calls for any Botanica units.
// So don't draft them or auto create them."
//
// ONE RULE, ONE PLACE. Stored in app_settings under 'no_service_buildings' and edited on /users →
// App settings → Task automation. Every automation that files an inspection, and every list that
// says a call or an inspection is OWED, asks here first. A person adding a task by hand is never
// stopped — this is about what the app does on its own and what it nags about.
//
// MATCHING. An entry matches a unit when any of its names (Guesty nickname, title, building,
// Breezeway property name) contains the entry as a whole word, case-insensitively, or rolls up to it
// through lib/segments buildingOf — so "Botanica 1204 -Double w/Kitchenette", "Botanica 2107 - B"
// and a bare building field of "Botanica" all read as Botanica.
//
// FAIL-SAFE: a missing or junk settings row falls back to the defaults (Botanica on both lists).
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { buildingOf } from './segments'
import { mergeNoService, matchNoService, NO_SERVICE_DEFAULTS, type NoService } from './no-service-match'

export { mergeNoService, NO_SERVICE_DEFAULTS, type NoService }

export const NO_SERVICE_KEY = 'no_service_buildings'

/** SYNC: does any of the unit's names match any entry of `list` (literal word or building roll-up)? */
export function matchesAny(list: string[] | null | undefined, ...names: any[]): boolean {
  return matchNoService(list, names, buildingOf)
}

// ~5 minute cache on top of app-settings' own; a save on this instance clears it at once.
const TTL_MS = 5 * 60_000
let _cache: { at: number; val: NoService } | null = null

export async function getNoService(): Promise<NoService> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.val
  let val = NO_SERVICE_DEFAULTS
  try { val = mergeNoService(await getSetting<any>(NO_SERVICE_KEY, null)) } catch { /* defaults */ }
  _cache = { at: Date.now(), val }
  return val
}

export async function saveNoService(value: any, updatedBy?: string | null): Promise<{ ok: boolean; error?: string; value: NoService }> {
  const clean = mergeNoService(value)
  const r = await setSetting(NO_SERVICE_KEY, clean, updatedBy)
  _cache = null
  return { ...r, value: clean }
}

/** SYNC variants for hot loops: pass the already-loaded rule from getNoService(). */
export function skipsInspectionsIn(ns: NoService | null | undefined, ...names: any[]): boolean {
  return matchesAny((ns || NO_SERVICE_DEFAULTS).inspections, ...names)
}
export function skipsWelcomeCallsIn(ns: NoService | null | undefined, ...names: any[]): boolean {
  return matchesAny((ns || NO_SERVICE_DEFAULTS).welcomeCalls, ...names)
}

/** True when Lighthouse must not draft, auto-create or nag about an inspection for this unit. */
export async function skipsInspections(...names: any[]): Promise<boolean> {
  return skipsInspectionsIn(await getNoService(), ...names)
}
/** True when Lighthouse must not list, draft or nag about a welcome call for this unit. */
export async function skipsWelcomeCalls(...names: any[]): Promise<boolean> {
  return skipsWelcomeCallsIn(await getNoService(), ...names)
}

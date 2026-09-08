// WHICH LISTINGS ARE "SALATO" — one answer, editable by the team.
//
// Jon, 2026-09-08: "Need to add new Salato units to the Salato front desk link and for
// verifications" and "make it where the sharable link is editable where we can [pick] listing".
//
// Until now five surfaces each carried their own `/salato/i` regex against the listing's building
// or nickname (front desk board, share link, verification, the daily email, the vendor board). A
// new unit that is not literally named "Salato …" was therefore invisible to the front desk AND
// could not be verified — the verification route refuses a reservation it cannot prove is Salato.
//
// So the set lives in `app_settings.salato_units` and every surface reads it here:
//   { mode: 'auto' }                      → the old regex, byte-for-byte today's behaviour (default)
//   { mode: 'list', ids: [listingId, …] } → exactly these listings, whatever they are called
//   { mode: 'auto-plus', ids: [...] }     → regex matches PLUS these (the usual choice when a new
//                                           building comes on under a different name)
// `exclude` drops a listing in any mode — for a unit that reads as Salato but is not front-desked.
//
// SAFETY: an unset / corrupt / unreadable setting falls back to 'auto', so the front desk never
// loses its board because a setting went bad.
import 'server-only'
import { getSetting, setSetting } from './app-settings'

export const SALATO_UNITS_KEY = 'salato_units'

export type SalatoUnitsCfg = { mode: 'auto' | 'auto-plus' | 'list'; ids: string[]; exclude: string[] }
export const DEFAULT_SALATO_UNITS: SalatoUnitsCfg = { mode: 'auto', ids: [], exclude: [] }

/** The name-based rule the app has always used. Kept as the default and as 'auto-plus' seed. */
export const SALATO_RE = /salato|salado/i

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const idList = (v: any): string[] => {
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  for (const x of Array.isArray(v) ? v : []) {
    const s = str(x).trim().slice(0, 60)
    if (!s || seen[s]) continue
    seen[s] = true
    out.push(s)
    if (out.length >= 300) break
  }
  return out
}

export function sanitizeUnitsCfg(input: any): SalatoUnitsCfg {
  const o = input && typeof input === 'object' ? input : {}
  const mode = o.mode === 'list' || o.mode === 'auto-plus' ? o.mode : 'auto'
  return { mode, ids: idList(o.ids), exclude: idList(o.exclude) }
}

export async function getSalatoUnitsCfg(): Promise<SalatoUnitsCfg> {
  return sanitizeUnitsCfg(await getSetting<any>(SALATO_UNITS_KEY, DEFAULT_SALATO_UNITS))
}
export async function setSalatoUnitsCfg(cfg: SalatoUnitsCfg, by?: string | null) {
  return setSetting(SALATO_UNITS_KEY, sanitizeUnitsCfg(cfg), by)
}

export type ListingLite = { id: string; name: string; building: string | null }

/** Does this listing read as Salato by name/building? */
export function matchesByName(l: { name?: any; nickname?: any; title?: any; building?: any }): boolean {
  const name = str(l.name || l.nickname || l.title)
  return SALATO_RE.test(str(l.building)) || SALATO_RE.test(name)
}

/**
 * Resolve the Salato listing set from the DB.
 *
 * Returns `match` (listingId -> display name) — the shape every caller already used — plus the
 * full listing list so a picker can render without a second query, and per-listing flags saying
 * whether a unit is in because of its name, because it was added by hand, or held out.
 */
export async function salatoListings(db: any): Promise<{
  match: Record<string, string>
  ids: string[]
  cfg: SalatoUnitsCfg
  all: (ListingLite & { auto: boolean; picked: boolean; excluded: boolean; on: boolean })[]
}> {
  const cfg = await getSalatoUnitsCfg()
  const { data } = await db.from('guesty_listings').select('id,nickname,title,building,status')
  const rows = (data || []) as any[]
  const picked: Record<string, boolean> = {}
  for (const id of cfg.ids) picked[id] = true
  const dropped: Record<string, boolean> = {}
  for (const id of cfg.exclude) dropped[id] = true

  const match: Record<string, string> = {}
  const all: (ListingLite & { auto: boolean; picked: boolean; excluded: boolean; on: boolean })[] = []
  for (const l of rows) {
    const id = String(l.id)
    const name = str(l.nickname || l.title) || 'Unit'
    const auto = matchesByName(l)
    const isPicked = !!picked[id]
    const excluded = !!dropped[id]
    const on = !excluded && (cfg.mode === 'list' ? isPicked : cfg.mode === 'auto-plus' ? (auto || isPicked) : auto)
    if (on) match[id] = name
    all.push({ id, name, building: l.building == null ? null : String(l.building), auto, picked: isPicked, excluded, on })
  }
  all.sort((a, b) => (a.on === b.on ? a.name.localeCompare(b.name) : a.on ? -1 : 1))
  return { match, ids: Object.keys(match), cfg, all }
}

/** True when this listing is part of the Salato front desk (used by the verification gate). */
export async function isSalatoListing(db: any, listingId: string, listing?: any): Promise<boolean> {
  const cfg = await getSalatoUnitsCfg()
  const id = String(listingId || '')
  if (!id) return false
  if (cfg.exclude.indexOf(id) >= 0) return false
  if (cfg.mode !== 'auto' && cfg.ids.indexOf(id) >= 0) return true
  if (cfg.mode === 'list') return false
  let l = listing
  if (!l) { const { data } = await db.from('guesty_listings').select('nickname,title,building').eq('id', id).maybeSingle(); l = data }
  return !!l && matchesByName(l)
}

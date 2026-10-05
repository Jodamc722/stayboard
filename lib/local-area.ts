// LOCAL AREA FACTS — the real walk and drive times from a unit to the places guests book for.
//
// Jon, 2026-10-05: "use photo and location address to share important local activities and popular
// areas, maybe having to commute away … setting expectation, painting a story and getting people to
// book." The copywriter is forbidden from naming a place or a distance it is not sure of (HONESTY),
// and only 13 buildings had a hand-written pack — so most Neighborhood sections said "close to the
// beach" and stopped. This file gives every unit a VERIFIED, computed list instead:
//
//   unit lat/lng  →  curated South Florida places (lib/south-florida-places)
//                 →  real routes (OSRM, walking and driving) for the near ones, estimates for the rest
//                 →  the 12–18 that matter for THIS spot, tagged walk / drive / "a drive away"
//
// Cached per ~100 m grid cell in `area_facts` (migration 146) for 60 days, with staff edits on top:
// hide a place that is wrong for the building, add one of their own (a bagel shop, a marina), note
// a caveat ("the beach walk crosses A1A at a light"). The prompt block (areaPrompt) is what the
// copywriter may state by name and by minute — "about a 12-minute walk", never "3 blocks".
//
// Nothing here is invented: places are a maintained list, times are measured on the road network
// (or clearly estimated), and a person can remove anything before it is ever used.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { SOUTH_FLORIDA_PLACES, haversineM, type Place, type PlaceKind } from './south-florida-places'

export type AreaItem = {
  id: string; name: string; kind: PlaceKind; what: string
  distanceM: number
  walkMin: number | null; driveMin: number | null
  /** How a guest would get there: on foot (≤ 25 min), a short drive, or a longer drive ("a drive away"). */
  mode: 'walk' | 'drive' | 'far'
  /** 'routed' = measured on the road network; 'estimated' = straight line × a factor. */
  basis: 'routed' | 'estimated'
  source: 'map' | 'staff'
  note?: string
  hidden?: boolean
}
export type AreaFacts = {
  key: string; lat: number; lng: number; computedAt: string
  items: AreaItem[]
  /** Staff layer: hidden ids, added items, per-item notes, a free note about the spot. */
  edits: { hidden: string[]; added: AreaItem[]; notes: Record<string, string>; spotNote?: string; by?: string; at?: string }
  routed: boolean
}

const TABLE = 'area_facts'
const FRESH_DAYS = 60
const WALK_MAX_MIN = 25          // beyond this a guest drives
const FAR_MIN = 35               // beyond this it is "a drive away", said as such
const LOCAL_RADIUS_M = 14_000
const REGIONAL_RADIUS_M = 65_000
const ROUTE_WALK_RADIUS_M = 3_500
const ROUTE_DRIVE_MAX = 60       // OSRM table destinations per call

export const gridKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`

/** Straight-line estimates when a router is unavailable: a city walk ≈ 80 m/min on a 1.3× path; a drive ≈ 28 km/h door to door plus parking. */
const estWalk = (m: number) => Math.round((m * 1.3) / 80)
const estDrive = (m: number) => Math.round((m * 1.35) / (28_000 / 60) + 3)

async function osrmTable(profile: 'foot' | 'driving', from: { lat: number; lng: number }, to: { lat: number; lng: number }[]): Promise<(number | null)[] | null> {
  if (!to.length) return []
  const host = profile === 'foot' ? 'https://routing.openstreetmap.de/routed-foot/table/v1/foot/' : 'https://routing.openstreetmap.de/routed-car/table/v1/driving/'
  const coords = [from, ...to].map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
  const url = `${host}${coords}?sources=0&annotations=duration`
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12_000)
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store', headers: { 'User-Agent': 'Lighthouse/1.0 (stay-hospitality.com)' } })
    clearTimeout(t)
    if (!r.ok) return null
    const j: any = await r.json().catch(() => null)
    const row: any[] = j?.durations?.[0]
    if (!Array.isArray(row)) return null
    return row.slice(1).map(d => (typeof d === 'number' && isFinite(d) ? Math.max(1, Math.round(d / 60)) : null))
  } catch { return null }
}

/** Compute the facts for a point. Pure network + math; no cache, no edits. */
export async function computeAreaFacts(lat: number, lng: number): Promise<{ items: AreaItem[]; routed: boolean }> {
  const cands = SOUTH_FLORIDA_PLACES
    .map(p => ({ p, d: haversineM(lat, lng, p.lat, p.lng) }))
    .filter(x => x.d <= (x.p.reach === 'regional' ? REGIONAL_RADIUS_M : LOCAL_RADIUS_M))
    .sort((a, b) => a.d - b.d)
  // One airport, one port, the two nearest stations, the nearest arenas — a guest needs the nearest of each, not all of them.
  const keepOne = (kind: PlaceKind, n: number) => { let seen = 0; return (x: { p: Place }) => x.p.kind !== kind || seen++ < n }
  const picked = cands.filter(keepOne('airport', 2)).filter(keepOne('port', 1)).filter(keepOne('station', 2)).filter(keepOne('arena', 2)).slice(0, 40)

  const walkTargets = picked.filter(x => x.d <= ROUTE_WALK_RADIUS_M)
  const driveTargets = picked.slice(0, ROUTE_DRIVE_MAX)
  const [walkMins, driveMins] = await Promise.all([
    osrmTable('foot', { lat, lng }, walkTargets.map(x => ({ lat: x.p.lat, lng: x.p.lng }))),
    osrmTable('driving', { lat, lng }, driveTargets.map(x => ({ lat: x.p.lat, lng: x.p.lng }))),
  ])
  const routed = !!driveMins
  const walkOf = new Map<string, number | null>(); walkTargets.forEach((x, i) => walkOf.set(x.p.id, walkMins ? walkMins[i] : null))
  const driveOf = new Map<string, number | null>(); driveTargets.forEach((x, i) => driveOf.set(x.p.id, driveMins ? driveMins[i] : null))

  const items: AreaItem[] = picked.map(({ p, d }) => {
    const w = walkOf.has(p.id) ? (walkOf.get(p.id) ?? estWalk(d)) : (d <= ROUTE_WALK_RADIUS_M ? estWalk(d) : null)
    const dr = driveOf.get(p.id) ?? estDrive(d)
    const walkMin = w != null && w <= WALK_MAX_MIN + 10 ? w : null
    const mode: AreaItem['mode'] = walkMin != null && walkMin <= WALK_MAX_MIN ? 'walk' : dr != null && dr <= FAR_MIN ? 'drive' : 'far'
    const basis: AreaItem['basis'] = (mode === 'walk' ? walkOf.get(p.id) != null : driveOf.get(p.id) != null) ? 'routed' : 'estimated'
    return { id: p.id, name: p.name, kind: p.kind, what: p.what, distanceM: Math.round(d), walkMin, driveMin: dr, mode, basis, source: 'map' }
  })
  // Keep the list a guest can read: everything walkable, then the closest drives per kind, then the regional anchors.
  const walk = items.filter(i => i.mode === 'walk')
  const drive = items.filter(i => i.mode === 'drive').slice(0, 10)
  const far = items.filter(i => i.mode === 'far' && ['airport', 'station', 'port', 'arena', 'shopping', 'nature', 'beach', 'district'].includes(i.kind)).slice(0, 6)
  const out = [...walk, ...drive, ...far]
  out.sort((a, b) => rank(a) - rank(b) || a.distanceM - b.distanceM)
  return { items: out, routed }
}
const rank = (i: AreaItem) => (i.mode === 'walk' ? 0 : i.mode === 'drive' ? 1 : 2)

/** The cached facts for a point, computed when missing or stale; staff edits applied. */
export async function areaFactsFor(lat: number, lng: number, opts: { refresh?: boolean } = {}): Promise<AreaFacts | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
  const key = gridKey(lat, lng)
  const db = supabaseAdmin()
  let row: any = null
  try { const { data } = await db.from(TABLE).select('*').eq('key', key).maybeSingle(); row = data || null } catch { row = null }
  const stale = !row || !row.computed_at || (Date.now() - Date.parse(row.computed_at)) > FRESH_DAYS * 86400_000
  let items: AreaItem[] = Array.isArray(row?.facts?.items) ? row.facts.items : []
  let routed = !!row?.facts?.routed
  let computedAt = String(row?.computed_at || '')
  if (stale || opts.refresh) {
    const c = await computeAreaFacts(lat, lng)
    items = c.items; routed = c.routed; computedAt = new Date().toISOString()
    try {
      await db.from(TABLE).upsert({ key, lat, lng, facts: { items, routed }, computed_at: computedAt, edits: row?.edits || {} }, { onConflict: 'key' })
    } catch { /* table not there yet — the facts still return, uncached */ }
  }
  const edits = normEdits(row?.edits)
  const all = [...items, ...edits.added].map(i => ({ ...i, hidden: edits.hidden.includes(i.id), note: edits.notes[i.id] || i.note }))
  return { key, lat, lng, computedAt, items: all, edits, routed }
}

function normEdits(e: any): AreaFacts['edits'] {
  const o = e && typeof e === 'object' ? e : {}
  return {
    hidden: Array.isArray(o.hidden) ? o.hidden.map(String).slice(0, 200) : [],
    added: Array.isArray(o.added) ? o.added.filter((x: any) => x && x.name).slice(0, 40).map((x: any) => ({
      id: String(x.id || 'staff:' + String(x.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')), name: String(x.name).slice(0, 80), kind: (x.kind || 'landmark') as PlaceKind,
      what: String(x.what || '').slice(0, 160), distanceM: Number(x.distanceM) || 0, walkMin: x.walkMin != null ? Number(x.walkMin) : null, driveMin: x.driveMin != null ? Number(x.driveMin) : null,
      mode: x.mode === 'drive' || x.mode === 'far' ? x.mode : 'walk', basis: 'routed', source: 'staff', note: x.note ? String(x.note).slice(0, 200) : undefined,
    })) : [],
    notes: o.notes && typeof o.notes === 'object' ? Object.fromEntries(Object.entries(o.notes).map(([k, v]) => [k, String(v).slice(0, 200)])) : {},
    spotNote: o.spotNote ? String(o.spotNote).slice(0, 600) : undefined, by: o.by, at: o.at,
  }
}

/** Save the staff layer for a grid cell. */
export async function saveAreaEdits(key: string, patch: Partial<AreaFacts['edits']> & { by: string }): Promise<void> {
  const db = supabaseAdmin()
  const { data } = await db.from(TABLE).select('edits').eq('key', key).maybeSingle()
  const cur = normEdits((data as any)?.edits)
  const next = { ...cur, ...patch, by: patch.by, at: new Date().toISOString() }
  await db.from(TABLE).update({ edits: next }).eq('key', key)
}

const KIND_WORD: Record<PlaceKind, string> = { beach: 'Beach', district: 'Area', landmark: 'Landmark', park: 'Park', shopping: 'Shopping', airport: 'Airport', station: 'Train', port: 'Cruise port', arena: 'Stadium / arena', nature: 'Outdoors' }
const minutes = (n: number) => n <= 3 ? 'a couple of minutes' : `about ${n} min`

/** One line per place, the way the copy may say it. */
export function areaLine(i: AreaItem): string {
  const how = i.mode === 'walk' && i.walkMin != null ? `${minutes(i.walkMin)} walk`
    : i.driveMin != null ? `${minutes(i.driveMin)} drive${i.mode === 'far' ? ' — a day trip or an outing, not next door' : ''}` : ''
  return `- ${KIND_WORD[i.kind]}: ${i.name} — ${how}${i.basis === 'estimated' ? ' (estimated)' : ''}${i.what ? ` · ${i.what}` : ''}${i.note ? ` · Staff note: ${i.note}` : ''}`
}

/**
 * The prompt block. The copywriter may name these places and give these times — in minutes, always
 * with walk or drive, "about" not "exactly" — because they were measured, not guessed. It still may
 * not add a place that is not on the list.
 */
export function areaPrompt(f: AreaFacts | null): string {
  if (!f) return ''
  const live = f.items.filter(i => !i.hidden)
  if (!live.length) return ''
  const walk = live.filter(i => i.mode === 'walk'), drive = live.filter(i => i.mode === 'drive'), far = live.filter(i => i.mode === 'far')
  const lines: string[] = []
  lines.push('VERIFIED AREA FACTS (measured from this unit’s location on the road network; you MAY name these places and quote these times)')
  lines.push('Rules: say "about N minutes’ walk" or "about N minutes’ drive" — never blocks, never "steps from", never a place that is not listed here. Walkable things are the story of the stay; drives are the plan for the trip; "a drive away" things set expectations honestly (name them as an outing, not as nearby). An "(estimated)" time is straight-line and should be softened ("roughly").')
  if (walk.length) { lines.push('WALKABLE FROM THE DOOR:'); walk.forEach(i => lines.push(areaLine(i))) }
  if (drive.length) { lines.push('A SHORT DRIVE OR RIDESHARE:'); drive.forEach(i => lines.push(areaLine(i))) }
  if (far.length) { lines.push('FURTHER OUT (worth naming so guests plan, never as "nearby"):'); far.forEach(i => lines.push(areaLine(i))) }
  if (f.edits.spotNote) lines.push(`STAFF NOTE ABOUT THIS SPOT: ${f.edits.spotNote}`)
  return lines.join('\n')
}

/** Lat/lng for a listing row (column or raw address), or null. */
export function listingLatLng(listing: any): { lat: number; lng: number } | null {
  const raw = listing?.raw && typeof listing.raw === 'object' ? listing.raw : {}
  const a = raw.address || {}
  const lat = Number(listing?.lat ?? a.lat ?? a.latitude ?? raw.lat)
  const lng = Number(listing?.lng ?? a.lng ?? a.longitude ?? raw.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

// WHERE A HOME IS, FOR THE PROJECTIONS CALCULATOR (Jon, 2026-11-12: "search by building… if they enter
// Elser it should auto pull the address into the form… address should pull the closest attractions and
// beaches"). Server-only.
//   buildingSuggestions(q) — buildings in the Projections library and the buildings we manage (their
//                            street address and coordinates from Guesty), matched by name or address
//   geocode(address)       — OpenStreetMap's geocoder, South Florida only, cached in memory
//   nearby(lat, lng)       — the nearest beach and attractions from the curated South Florida list
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { readLibrary } from './sales-library'
import { SOUTH_FLORIDA_PLACES, haversineM } from './south-florida-places'

export type BuildingHit = { key: string; name: string; address: string; area: string; lat?: number; lng?: number; libId?: string; ours: boolean; plans?: number }

const street = (full: string) => String(full || '').replace(/\s*(#|unit|apt\.?|suite|ste\.?)\s*[\w-]+/i, '').replace(/\s+,/g, ',').trim()
let _portfolio: { at: number; list: BuildingHit[] } | null = null
async function portfolioBuildings(): Promise<BuildingHit[]> {
  if (_portfolio && Date.now() - _portfolio.at < 10 * 60_000) return _portfolio.list
  const by = new Map<string, BuildingHit>()
  try {
    const { data } = await supabaseAdmin().from('guesty_listings').select('building, address_full, address_city, addr:raw->address').limit(1000)
    for (const r of (data || []) as any[]) {
      const name = String(r.building || '').trim()
      if (!name || by.has(name.toLowerCase())) continue
      const a = r.addr || {}
      const lat = Number(a.lat ?? a.latitude), lng = Number(a.lng ?? a.longitude)
      by.set(name.toLowerCase(), { key: 'p:' + name, name, address: street(r.address_full || a.full || ''), area: String(r.address_city || a.city || ''), ...(Number.isFinite(lat) && Number.isFinite(lng) && lat ? { lat, lng } : {}), ours: true })
    }
  } catch { /* the library still answers */ }
  _portfolio = { at: Date.now(), list: Array.from(by.values()) }
  return _portfolio.list
}

export async function buildingSuggestions(q: string): Promise<BuildingHit[]> {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const query = n(q)
  if (query.length < 2) return []
  const lib = await readLibrary().catch(() => [])
  const fromLib: BuildingHit[] = lib.map(b => ({ key: 'l:' + b.id, name: b.name, address: b.address || '', area: b.area || b.cma.area || '', libId: b.id, ours: false, plans: b.cma.plans.length }))
  const port = await portfolioBuildings()
  // One row per building: a library entry and the same building in our portfolio merge (address and
  // coordinates from the portfolio, projections from the library).
  const merged = new Map<string, BuildingHit>()
  for (const h of [...fromLib, ...port]) {
    const k = n(h.name).replace(/^the/, '').replace(/residences?$/, '')
    const cur = merged.get(k)
    merged.set(k, cur ? { ...cur, ...h, libId: cur.libId || h.libId, plans: cur.plans || h.plans, ours: cur.ours || h.ours, address: cur.address || h.address, name: cur.name } : h)
  }
  return Array.from(merged.values())
    .filter(h => n(h.name).includes(query) || n(h.address).includes(query))
    .sort((a, b) => Number(n(b.name).startsWith(query)) - Number(n(a.name).startsWith(query)) || Number(!!b.libId) - Number(!!a.libId))
    .slice(0, 8)
}

const _geo = new Map<string, { lat: number; lng: number; area: string } | null>()
export async function geocode(address: string): Promise<{ lat: number; lng: number; area: string } | null> {
  const a = address.trim()
  if (a.length < 6) return null
  const k = a.toLowerCase()
  if (_geo.has(k)) return _geo.get(k) || null
  let out: { lat: number; lng: number; area: string } | null = null
  try {
    const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&addressdetails=1&viewbox=-80.9,27.0,-79.9,25.1&bounded=1&q=' + encodeURIComponent(/fl|florida/i.test(a) ? a : a + ', Florida')
    const r = await fetch(u, { headers: { 'User-Agent': 'StayHospitality-Lighthouse/1.0 (stay-hospitality.com)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(6000) })
    const d: any[] = r.ok ? await r.json() : []
    const hit = d && d[0]
    if (hit) { const ad = hit.address || {}; out = { lat: Number(hit.lat), lng: Number(hit.lon), area: String(ad.neighbourhood || ad.suburb || ad.city || ad.town || '') } }
  } catch { out = null }
  if (_geo.size > 2000) _geo.clear()
  _geo.set(k, out)
  return out
}

const MI = 1609.34
export function nearby(lat: number, lng: number): { beachMi: number | null; places: { name: string; kind: string; mi: number }[] } {
  const all = SOUTH_FLORIDA_PLACES.map(p => ({ p, mi: haversineM(lat, lng, p.lat, p.lng) / MI }))
  const beach = all.filter(x => x.p.kind === 'beach').sort((a, b) => a.mi - b.mi)[0]
  const places = all.filter(x => x.p.reach === 'local' || x.mi < 12).sort((a, b) => a.mi - b.mi).slice(0, 6)
    .map(x => ({ name: x.p.name, kind: x.p.kind, mi: Math.round(x.mi * 10) / 10 }))
  return { beachMi: beach ? Math.round(beach.mi * 100) / 100 : null, places }
}

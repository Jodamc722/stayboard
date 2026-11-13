// THE SMART BUILDING LOOKUP FOR A NEW SALES DECK (Jon, 2026-11-12: "make it smarter. Address should be connected
// to the actual address, add details. Website search, and after the address it should scrape the site
// automatically and pull stock images and photos and the theme. If it is a building we already have, use our
// projections; if not, we create them and use the comps we select").
//   suggest(q)  — as they type: buildings in the Projections library and our portfolio, then real South
//                 Florida addresses (OpenStreetMap)
//   lookup(...) — after a pick: the verified address and neighbourhood, the beach and what is nearby, whether
//                 the library holds its projections, and (through Claude's web search) the building's official
//                 website and public facts: type, homes, storeys, year, amenities, what it sells on.
// Every fact from the web carries its source; the form shows them for the team to keep or change. Server-only.
import 'server-only'
import { buildingSuggestions, geocode, nearby, type BuildingHit } from './projection-places'
import { readLibrary } from './sales-library'
import { anthropicMessages, textOf } from './anthropic-call'
import { modelPairFor } from './ai-models'
import { searchStock, type StockHit } from './ad-stock'

export type LookupSuggestion = { kind: 'library' | 'portfolio' | 'address'; name: string; address: string; area: string; libId?: string; plans?: number; lat?: number; lng?: number }

const _addr = new Map<string, LookupSuggestion[]>()
async function addressSuggestions(q: string): Promise<LookupSuggestion[]> {
  const k = q.toLowerCase().trim()
  if (k.length < 5) return []
  if (_addr.has(k)) return _addr.get(k)!
  let out: LookupSuggestion[] = []
  try {
    const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&addressdetails=1&viewbox=-80.9,27.0,-79.9,25.1&bounded=1&q=' + encodeURIComponent(q)
    const r = await fetch(u, { headers: { 'User-Agent': 'StayHospitality-Lighthouse/1.0 (stay-hospitality.com)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(5000) })
    const d: any[] = r.ok ? await r.json() : []
    out = (d || []).map(h => {
      const a = h.address || {}
      const street = [a.house_number, a.road].filter(Boolean).join(' ')
      const city = a.city || a.town || a.village || a.suburb || ''
      const name = String(h.name || a.building || a.amenity || a.residential || '').trim()
      return { kind: 'address' as const, name, address: [street || name, city, a.state === 'Florida' ? 'FL' : a.state, a.postcode].filter(Boolean).join(', '), area: String(a.neighbourhood || a.suburb || city || ''), lat: Number(h.lat), lng: Number(h.lon) }
    }).filter(s => s.address)
  } catch { out = [] }
  if (_addr.size > 1500) _addr.clear()
  _addr.set(k, out)
  return out
}

export async function suggest(q: string): Promise<LookupSuggestion[]> {
  const query = String(q || '').trim().slice(0, 120)
  if (query.length < 2) return []
  const [b, a] = await Promise.all([buildingSuggestions(query).catch(() => [] as BuildingHit[]), addressSuggestions(query)])
  const ours: LookupSuggestion[] = b.map(h => ({ kind: h.libId ? 'library' : 'portfolio', name: h.name, address: h.address, area: h.area, libId: h.libId, plans: h.plans, lat: h.lat, lng: h.lng }))
  const seen = new Set(ours.map(o => o.address.toLowerCase().slice(0, 18)).filter(Boolean))
  return [...ours, ...a.filter(x => !seen.has(x.address.toLowerCase().slice(0, 18)))].slice(0, 9)
}

export type LookupFacts = { website: string; address: string; neighborhood: string; kind: string; homes: number | null; storeys: number | null; year: number | null; developer: string; amenities: string[]; sellsOn: string; shortTermRentals: string; summary: string; sources: { title: string; url: string }[] }
export type LookupResult = {
  building: string; address: string; area: string; market: string; lat: number | null; lng: number | null
  beachMi: number | null; places: { name: string; kind: string; mi: number }[]
  library: { id: string; name: string; plans: number; website?: string; photo?: string } | null
  facts: LookupFacts | null; factsError?: string
  stock: StockHit[]
}

const marketOf = (lat: number | null, area: string) => (lat != null ? (lat >= 26.32 ? 'North' : lat >= 25.975 ? 'Broward' : 'Miami') : /lauderdale|hollywood|pompano|broward|hallandale|dania/i.test(area) ? 'Broward' : /palm beach|boca|delray|boynton|jupiter|singer/i.test(area) ? 'North' : 'Miami')

const SYSTEM = `You research one residential building or home in South Florida for a short-term-rental management company's sales team. Use web search. Prefer the building's own official website, then the developer, then reputable real-estate sources. Reply with ONE JSON object and nothing else:
{"website":string|null,"address":string|null,"neighborhood":string|null,"kind":"Condo"|"Townhome"|"House"|"Whole building"|"Hotel"|null,"homes":number|null,"storeys":number|null,"year":number|null,"developer":string|null,"amenities":string[],"sellsOn":string|null,"shortTermRentals":string|null,"summary":string|null}
Rules:
- "website" is the building's OWN official site (not a broker, listing portal or aggregator). If there is none, null.
- "amenities": up to 10 short items the building actually has (pool, gym, rooftop, valet, beach service…), from the sources.
- "sellsOn": one line, under 90 characters, of the three or four strongest real selling points for a rental guest (view, location, amenities).
- "shortTermRentals": one sentence on whether the building allows short-term rentals and any minimum stay, ONLY if a source says so; otherwise null.
- "summary": one or two plain sentences on what the building is.
- Never guess. A fact you could not find in a source is null. No sale prices.`

async function research(building: string, address: string, website: string): Promise<LookupFacts> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('AI is not configured.')
  const { model, fallback } = await modelPairFor('sales-read')
  const ask = `Building: ${building || '(not named)'}\nAddress: ${address || '(not given)'}${website ? '\nWebsite given: ' + website : ''}\nFind it and fill the JSON.`
  const r = await anthropicMessages(key, { model, max_tokens: 3000, system: SYSTEM, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', city: 'Miami', region: 'Florida', country: 'US', timezone: 'America/New_York' } }], messages: [{ role: 'user', content: ask }] }, fallback, 'sales-read')
  if (!r.ok) throw new Error(String(r.data?.error?.message || 'The lookup failed (' + r.status + ')').slice(0, 200))
  const raw = textOf(r.data)
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Nothing usable came back.')
  const j: any = JSON.parse(m[0])
  // the pages the search actually returned, for the sources line
  const sources: { title: string; url: string }[] = []
  for (const b of (r.data?.content || []) as any[]) {
    if (b?.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const h of b.content) if (h?.url && sources.length < 6 && !sources.some(s => s.url === h.url)) sources.push({ title: String(h.title || h.url).slice(0, 90), url: String(h.url) })
  }
  const s = (v: any, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const n = (v: any) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x) : null }
  const site = s(j.website, 200)
  return { website: /^https?:\/\/[^\s]+\.[^\s]+/i.test(site) ? site : '', address: s(j.address, 200), neighborhood: s(j.neighborhood, 80), kind: ['Condo', 'Townhome', 'House', 'Whole building', 'Hotel'].includes(j.kind) ? j.kind : '',
    homes: n(j.homes), storeys: n(j.storeys), year: n(j.year), developer: s(j.developer, 100), amenities: (Array.isArray(j.amenities) ? j.amenities : []).map((a: any) => s(a, 40)).filter(Boolean).slice(0, 10),
    sellsOn: s(j.sellsOn, 140), shortTermRentals: s(j.shortTermRentals, 240), summary: s(j.summary, 400), sources }
}

export async function lookup(inp: { building: string; address: string; website?: string; libId?: string; lat?: number; lng?: number; web?: boolean }): Promise<LookupResult> {
  const building = String(inp.building || '').trim().slice(0, 120), addr0 = String(inp.address || '').trim().slice(0, 200)
  const lib = await readLibrary().catch(() => [])
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the/, '').replace(/residences?$/, '')
  const entry = (inp.libId && lib.find(b => b.id === inp.libId)) || (building ? lib.find(b => norm(b.name) === norm(building) || (norm(building).length > 4 && (norm(b.name).includes(norm(building)) || norm(building).includes(norm(b.name))))) : undefined) || null
  let address = addr0 || entry?.address || ''
  // the web: only when asked (it takes a few seconds and costs a search)
  let facts: LookupFacts | null = null, factsError: string | undefined
  if (inp.web !== false && (building || address)) {
    try { facts = await research(building || entry?.name || '', address, String(inp.website || entry?.website || '')) } catch (e: any) { factsError = String(e?.message || e).slice(0, 200) }
  }
  if (!address && facts?.address) address = facts.address
  let lat = Number.isFinite(inp.lat as number) ? (inp.lat as number) : null, lng = Number.isFinite(inp.lng as number) ? (inp.lng as number) : null, area = entry?.area || ''
  if ((lat == null || lng == null) && address) { const g = await geocode(address).catch(() => null); if (g) { lat = g.lat; lng = g.lng; area = area || g.area } }
  area = area || facts?.neighborhood || ''
  const near = lat != null && lng != null ? nearby(lat, lng) : { beachMi: null, places: [] }
  const stock = await searchStock((area || 'Miami') + ' ' + (near.beachMi != null && near.beachMi < 1 ? 'beach' : 'skyline'), 'landscape').then(r => r.hits.slice(0, 6)).catch(() => [])
  return { building: building || entry?.name || '', address, area, market: marketOf(lat, area + ' ' + address), lat, lng, beachMi: near.beachMi, places: near.places,
    library: entry ? { id: entry.id, name: entry.name, plans: entry.cma.plans.length, website: entry.website, photo: entry.photo } : null, facts, ...(factsError ? { factsError } : {}), stock }
}

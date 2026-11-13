// REAL ADDRESSES (Jon, 2026-11-13: "should have real maps integrated… give any address entering real details").
// Two free public services, no key:
//   suggest(q)  → address suggestions while typing (Photon, built on OpenStreetMap), biased to South Florida
//   verify(a)   → one typed US address checked and standardised with its ZIP and coordinates (US Census geocoder)
// Suggestions are best effort (an address OpenStreetMap does not have will not be offered); verify is the one
// that turns any real US street address into a pin. Server-only: the browser calls /api/geo.
import 'server-only'

export type GeoHit = { label: string; lat: number; lng: number }
const ST: Record<string, string> = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' }
const okPt = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
async function getJson(url: string, ms: number): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': 'Lighthouse (Stay Hospitality) address lookup', Accept: 'application/json' }, signal: AbortSignal.timeout(ms), cache: 'no-store' })
  if (!r.ok) throw new Error('geo ' + r.status)
  return r.json()
}

export async function suggest(q: string): Promise<GeoHit[]> {
  const s = q.trim().slice(0, 120)
  if (s.length < 4) return []
  try {
    const d = await getJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(s)}&limit=8&lang=en&lat=25.9&lon=-80.2`, 3500)
    const out: GeoHit[] = [], seen = new Set<string>()
    for (const f of Array.isArray(d?.features) ? d.features : []) {
      const p = f?.properties || {}, c = f?.geometry?.coordinates || []
      const lng = Number(c[0]), lat = Number(c[1])
      if (String(p.countrycode || '').toUpperCase() !== 'US' || !okPt(lat, lng)) continue
      const street = p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : ''
      const first = street || p.name || ''
      if (!first) continue
      const named = street && p.name && p.name !== p.street ? p.name + ', ' : ''
      const label = named + [first, p.city || p.town || p.village || p.county || '', [ST[p.state] || p.state || '', p.postcode || ''].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      if (seen.has(label)) continue
      seen.add(label); out.push({ label, lat, lng })
      if (out.length >= 6) break
    }
    return out
  } catch { return [] }
}

const DIR = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])
const nice = (s: string) => s.split(' ').map(w => (DIR.has(w) ? w : /^\d+(ST|ND|RD|TH)$/.test(w) ? w.toLowerCase() : /^\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ')
/** One US street address, standardised: "398 NE 5th St, Miami, FL 33132" with its coordinates. Null when not found. */
export async function verify(address: string): Promise<GeoHit | null> {
  const s = address.trim().slice(0, 200)
  if (s.length < 6) return null
  try {
    const d = await getJson(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(s)}&benchmark=Public_AR_Current&format=json`, 6000)
    const m = d?.result?.addressMatches?.[0]
    const lat = Number(m?.coordinates?.y), lng = Number(m?.coordinates?.x)
    if (!m || !okPt(lat, lng)) return null
    const parts = String(m.matchedAddress || '').split(',').map((x: string) => x.trim())
    const label = parts.length >= 4 ? `${nice(parts[0])}, ${nice(parts[1])}, ${parts[2]} ${parts[3]}` : nice(String(m.matchedAddress || s))
    return { label, lat, lng }
  } catch { return null }
}

/** Fills in coordinates for homes that have an address but no pin yet. Never throws; never blocks a save for long. */
export async function pinHomes(homes: ({ address: string; lat?: number; lng?: number } | null | undefined)[]): Promise<void> {
  await Promise.all(homes.map(async h => {
    if (!h || !h.address || okPt(Number(h.lat), Number(h.lng))) return
    const v = await verify(h.address).catch(() => null)
    if (v) { h.lat = v.lat; h.lng = v.lng }
  }))
}

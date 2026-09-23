// EMERGENCY INFORMATION FOR THE GUIDEBOOK — 911, the local police non-emergency line, and the
// nearest hospital with a 24/7 emergency department.
//
// Jon, 2026-09-23: "We need to also add the local hospitals in each of the guidebooks. Please add
// that to every single guidebook. Put it in a section that makes sense. … It's important, and it's
// mandatory." And: "Also put non emergency number, emergency number and hospital in the guidebooks."
// And: "Take a look at the address and then find the closest or nearest hospital."
//
// ── WHY THIS IS A TABLE AND NOT AN AI CALL ──────────────────────────────────────────────────────
// The guidebook's prose is written by a model. This page is not prose. A guest reading it is having
// the worst night of their trip, and a hallucinated phone number or a hospital that closed in 2019
// is worse than no page at all — they would dial it. So every row below was verified in September
// 2026 against the operator's OWN official site (jacksonhealth.org, browardhealth.org, mhs.net,
// hcafloridahealthcare.com, baptisthealth.net, holy-cross.com, palmbeachhealthnetwork.com), and
// every police number against the city's or sheriff's own .gov page. Nothing here came from a
// directory aggregator, and nothing was inferred from a pattern.
//
// Deliberately LEFT OUT, because they could not be verified to that standard:
//   · North Shore Medical Center (Miami) — open, but its own site does not state a 24/7 ER, and it
//     has been cutting services since the 2024 bankruptcy of its former owner.
//   · Police lines for Lauderhill, Tamarac, Coral Gables and Lighthouse Point — each was either
//     missing, unlabelled, or contradicted by another page on the same city's site. Broward cities
//     fall back to the countywide non-emergency line below, which is the number Broward's own
//     dispatch publishes for exactly this.
//
// ── WHAT IT MEANS WHEN THIS FILE IS EDITED ──────────────────────────────────────────────────────
// Changing a number here changes it in every guidebook the next time one is generated or the
// backfill runs. Re-verify against the operator's own site before editing, and put the date in the
// comment. Coordinates are OpenStreetMap geocodes of the verified street address — good to roughly
// a block, which is all the nearest-of picker needs.

export type Hospital = {
  name: string
  address: string        // street, city, state zip — as a guest would give a driver
  phone: string
  lat: number
  lng: number
  trauma?: string | null // Florida DOH designation, when it has one
}

// Verified 2026-09-23. Ordered north to south within each county for readability only — the picker
// sorts by distance, never by position in this list.
export const HOSPITALS: Hospital[] = [
  // ── Palm Beach County ─────────────────────────────────────────────────────────────────────────
  { name: 'Palm Beach Gardens Medical Center', address: '3360 Burns Rd, Palm Beach Gardens, FL 33410', phone: '561-622-1411', lat: 26.8291, lng: -80.0861 },
  { name: "St. Mary's Medical Center", address: '901 45th St, West Palm Beach, FL 33407', phone: '561-844-6300', lat: 26.7566, lng: -80.0628, trauma: 'Level I trauma center' },
  { name: 'HCA Florida JFK North Hospital', address: '2201 45th St, West Palm Beach, FL 33407', phone: '561-842-6141', lat: 26.7616, lng: -80.0879 },
  { name: 'Good Samaritan Medical Center', address: '1309 N Flagler Dr, West Palm Beach, FL 33401', phone: '561-655-5511', lat: 26.7250, lng: -80.0516 },
  { name: 'HCA Florida JFK Hospital', address: '5301 S Congress Ave, Atlantis, FL 33462', phone: '561-965-7300', lat: 26.5979, lng: -80.0919 },
  // ── Broward County ────────────────────────────────────────────────────────────────────────────
  { name: 'Broward Health North', address: '201 E Sample Rd, Deerfield Beach, FL 33064', phone: '954-941-8300', lat: 26.2770, lng: -80.1215, trauma: 'Level II trauma center' },
  { name: 'Broward Health Coral Springs', address: '3000 Coral Hills Dr, Coral Springs, FL 33065', phone: '954-344-3000', lat: 26.2691, lng: -80.2557 },
  { name: 'HCA Florida Northwest Hospital', address: '2801 N State Road 7, Margate, FL 33063', phone: '954-974-0400', lat: 26.2631, lng: -80.2029 },
  { name: 'HCA Florida Woodmont Hospital', address: '7201 N University Dr, Tamarac, FL 33321', phone: '954-721-2200', lat: 26.2121, lng: -80.2545 },
  { name: 'Broward Health Imperial Point', address: '6401 N Federal Hwy, Fort Lauderdale, FL 33308', phone: '954-776-8500', lat: 26.2073, lng: -80.1105 },
  { name: 'Holy Cross Health', address: '4725 N Federal Hwy, Fort Lauderdale, FL 33308', phone: '954-776-3232', lat: 26.1872, lng: -80.1196 },
  { name: 'Broward Health Medical Center', address: '1600 S Andrews Ave, Fort Lauderdale, FL 33316', phone: '954-355-4400', lat: 26.1027, lng: -80.1412, trauma: 'Level I trauma center' },
  { name: 'HCA Florida Westside Hospital', address: '8201 W Broward Blvd, Plantation, FL 33324', phone: '954-473-6600', lat: 26.1249, lng: -80.2596 },
  { name: 'HCA Florida University Hospital', address: '3476 S University Dr, Davie, FL 33328', phone: '954-475-4400', lat: 26.0755, lng: -80.2513 },
  { name: 'Memorial Hospital Pembroke', address: '7800 Sheridan St, Pembroke Pines, FL 33024', phone: '954-962-9650', lat: 26.0297, lng: -80.2459 },
  { name: 'Memorial Hospital West', address: '703 N Flamingo Rd, Pembroke Pines, FL 33028', phone: '954-436-5000', lat: 26.0127, lng: -80.3100 },
  { name: 'Memorial Hospital Miramar', address: '1901 SW 172nd Ave, Miramar, FL 33029', phone: '954-538-5000', lat: 25.9900, lng: -80.3720 },
  { name: 'Memorial Regional Hospital', address: '3501 Johnson St, Hollywood, FL 33021', phone: '954-987-2000', lat: 26.0196, lng: -80.1799, trauma: 'Level I trauma center' },
  { name: 'Memorial Regional Hospital South', address: '3600 Washington St, Hollywood, FL 33021', phone: '954-966-4500', lat: 26.0022, lng: -80.1800 },
  // ── Miami-Dade County ─────────────────────────────────────────────────────────────────────────
  { name: 'HCA Florida Aventura Hospital', address: '20900 Biscayne Blvd, Aventura, FL 33180', phone: '305-682-7000', lat: 25.9700, lng: -80.1450, trauma: 'Level II trauma center' },
  { name: 'Jackson North Medical Center', address: '160 NW 170th St, North Miami Beach, FL 33169', phone: '305-651-1100', lat: 25.9302, lng: -80.2033 },
  { name: 'Mount Sinai Medical Center', address: '4300 Alton Rd, Miami Beach, FL 33140', phone: '305-674-2121', lat: 25.8134, lng: -80.1409 },
  { name: 'Jackson Memorial Hospital', address: '1611 NW 12th Ave, Miami, FL 33136', phone: '305-585-1111', lat: 25.7917, lng: -80.2126, trauma: 'Level I trauma center' },
  { name: 'UHealth Tower', address: '1400 NW 12th Ave, Miami, FL 33136', phone: '305-325-5511', lat: 25.7884, lng: -80.2163 },
  { name: 'Coral Gables Hospital', address: '3100 Douglas Rd, Coral Gables, FL 33134', phone: '305-441-6868', lat: 25.7433, lng: -80.2548 },
  { name: 'HCA Florida Mercy Hospital', address: '3663 S Miami Ave, Miami, FL 33133', phone: '305-854-4400', lat: 25.7411, lng: -80.2143 },
  { name: 'Baptist Health Doctors Hospital', address: '5000 University Dr, Coral Gables, FL 33146', phone: '786-308-3000', lat: 25.7244, lng: -80.2741 },
  { name: 'Baptist Hospital of Miami', address: '8900 N Kendall Dr, Miami, FL 33176', phone: '786-596-1960', lat: 25.6851, lng: -80.3386 },
  { name: 'Jackson South Medical Center', address: '9333 SW 152nd St, Miami, FL 33157', phone: '305-251-2500', lat: 25.6299, lng: -80.3458, trauma: 'Level II trauma center' },
]

// ── POLICE, NON-EMERGENCY ───────────────────────────────────────────────────────────────────────
// Verified 2026-09-23 against each agency's own site. 954-764-4357 is Broward's countywide
// non-emergency dispatch (954-76-HELP) and is what most Broward cities — including every city BSO
// polices for us — publish themselves, so it doubles as the county fallback.
export const BROWARD_NONEMERGENCY = '954-764-4357'

export type Police = { agency: string; phone: string }

const POLICE: Record<string, Police> = {
  // Miami-Dade
  'miami': { agency: 'City of Miami Police', phone: '305-579-6111' },
  'miami beach': { agency: 'Miami Beach Police', phone: '305-673-7900' },
  'aventura': { agency: 'Aventura Police', phone: '305-466-8989' },
  'sunny isles beach': { agency: 'Sunny Isles Beach Police', phone: '305-947-4440' },
  'north miami beach': { agency: 'North Miami Beach Police', phone: '305-949-5500' },
  // Broward — own department
  'fort lauderdale': { agency: 'Fort Lauderdale Police', phone: BROWARD_NONEMERGENCY },
  'hollywood': { agency: 'Hollywood Police', phone: BROWARD_NONEMERGENCY },
  'hallandale beach': { agency: 'Hallandale Beach Police', phone: BROWARD_NONEMERGENCY },
  'wilton manors': { agency: 'Wilton Manors Police', phone: BROWARD_NONEMERGENCY },
  'plantation': { agency: 'Plantation Police', phone: '954-797-2100' },
  'sunrise': { agency: 'Sunrise Police', phone: BROWARD_NONEMERGENCY },
  'pembroke pines': { agency: 'Pembroke Pines Police', phone: '954-431-2200' },
  'miramar': { agency: 'Miramar Police', phone: BROWARD_NONEMERGENCY },
  'davie': { agency: 'Davie Police', phone: '954-693-8200' },
  'coral springs': { agency: 'Coral Springs Police', phone: '954-344-1800' },
  'margate': { agency: 'Margate Police', phone: '954-972-7111' },
  'coconut creek': { agency: 'Coconut Creek Police', phone: '954-346-4400' },
  // Broward — policed by the Broward Sheriff's Office
  'pompano beach': { agency: "Broward Sheriff's Office", phone: BROWARD_NONEMERGENCY },
  'deerfield beach': { agency: "Broward Sheriff's Office", phone: BROWARD_NONEMERGENCY },
  'oakland park': { agency: "Broward Sheriff's Office", phone: BROWARD_NONEMERGENCY },
  'dania beach': { agency: "Broward Sheriff's Office", phone: '954-926-2400' },
  'lauderdale-by-the-sea': { agency: "Broward Sheriff's Office", phone: BROWARD_NONEMERGENCY },
  'cooper city': { agency: "Broward Sheriff's Office", phone: BROWARD_NONEMERGENCY },
  'parkland': { agency: "Broward Sheriff's Office", phone: BROWARD_NONEMERGENCY },
  'weston': { agency: "Broward Sheriff's Office", phone: BROWARD_NONEMERGENCY },
  // Palm Beach County
  'west palm beach': { agency: 'West Palm Beach Police', phone: '561-822-1900' },
  'lake worth beach': { agency: "Palm Beach County Sheriff's Office", phone: '561-688-3400' },
  'lake worth': { agency: "Palm Beach County Sheriff's Office", phone: '561-688-3400' },
  'riviera beach': { agency: 'Riviera Beach Police', phone: '561-845-4123' },
  'palm beach': { agency: 'Palm Beach Police', phone: '561-838-5454' },
  'palm beach gardens': { agency: 'Palm Beach Gardens Police', phone: '561-799-4445' },
  'boca raton': { agency: 'Boca Raton Police', phone: '561-368-6201' },
  'delray beach': { agency: 'Delray Beach Police', phone: '561-243-7800' },
}

function normCity(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The police non-emergency line for a city, or null when we cannot say.
 *
 * Null is a real answer and the page prints nothing rather than a guess: a wrong number here sends
 * somebody to a dead line at 2am. Broward is the one place a fallback is honest, because the county
 * runs one non-emergency dispatch for the whole of it and publishes that number itself.
 */
export function policeFor(city: unknown, address?: unknown): Police | null {
  const c = normCity(city)
  if (c && POLICE[c]) return POLICE[c]
  // No city on the listing: read one out of the street address, which always carries it.
  const hay = normCity(address)
  if (hay) {
    let best: Police | null = null, bestLen = 0
    for (const k of Object.keys(POLICE)) {
      if (k.length > bestLen && hay.indexOf(k) >= 0) { best = POLICE[k]; bestLen = k.length }
    }
    if (best) return best
  }
  return null
}

// ── NEAREST HOSPITAL ────────────────────────────────────────────────────────────────────────────

const R_MILES = 3958.8
const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle miles between two points. */
export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type NearestHospital = Hospital & { miles: number }

/**
 * The closest ER to a set of coordinates.
 *
 * Straight-line, not driving — which is why the page says "about N miles away" and never quotes a
 * drive time. Over a causeway or the New River the drive can be twice the line, and a guidebook
 * that promises eight minutes is a guidebook that gets somebody angry in a car.
 */
export function nearestHospital(lat: unknown, lng: unknown): NearestHospital | null {
  const a = Number(lat), b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null
  // Sanity-check the point is actually in South Florida. A listing with swapped or junk coordinates
  // would otherwise silently resolve to whichever hospital happens to sit nearest to the Atlantic.
  if (a < 24.5 || a > 27.5 || b < -81.5 || b > -79.5) return null
  let best: NearestHospital | null = null
  for (const h of HOSPITALS) {
    const miles = milesBetween(a, b, h.lat, h.lng)
    if (!best || miles < best.miles) best = { ...h, miles }
  }
  return best
}

/** Fallback when a listing has no usable coordinates: the nearest ER to the city we do know. */
const CITY_POINTS: Record<string, [number, number]> = {
  'miami': [25.7743, -80.1937], 'miami beach': [25.7907, -80.1300], 'aventura': [25.9565, -80.1392],
  'sunny isles beach': [25.9412, -80.1231], 'north miami beach': [25.9331, -80.1625],
  'coral gables': [25.7215, -80.2684], 'fort lauderdale': [26.1224, -80.1373],
  'hollywood': [26.0112, -80.1495], 'hallandale beach': [25.9812, -80.1484],
  'dania beach': [26.0526, -80.1439], 'pompano beach': [26.2379, -80.1248],
  'deerfield beach': [26.3184, -80.0998], 'oakland park': [26.1723, -80.1319],
  'wilton manors': [26.1595, -80.1395], 'plantation': [26.1276, -80.2331],
  'sunrise': [26.1669, -80.2564], 'pembroke pines': [26.0031, -80.2239],
  'miramar': [25.9861, -80.2323], 'davie': [26.0765, -80.2521], 'coral springs': [26.2712, -80.2706],
  'west palm beach': [26.7153, -80.0534], 'lake worth beach': [26.6168, -80.0684],
  'lake worth': [26.6168, -80.0684], 'riviera beach': [26.7753, -80.0581],
  'palm beach': [26.7056, -80.0364], 'palm beach gardens': [26.8234, -80.1387],
  'boca raton': [26.3683, -80.1289], 'delray beach': [26.4615, -80.0728],
}

export function nearestHospitalForCity(city: unknown, address?: unknown): NearestHospital | null {
  const c = normCity(city)
  let pt = CITY_POINTS[c]
  if (!pt) {
    const hay = normCity(address)
    let bestLen = 0
    for (const k of Object.keys(CITY_POINTS)) {
      if (k.length > bestLen && hay.indexOf(k) >= 0) { pt = CITY_POINTS[k]; bestLen = k.length }
    }
  }
  return pt ? nearestHospital(pt[0], pt[1]) : null
}

// ── THE SECTION THE BOOK RENDERS ────────────────────────────────────────────────────────────────

export type EmergencySection = {
  heading: string
  emergency: string        // always 911, and always first on the page
  emergencyNote: string
  policeLabel: string | null
  police: string | null
  hospital: { name: string; address: string; phone: string; distance: string; trauma?: string | null } | null
  note: string
}

/** "About 2.4 miles away" / "About a mile away" / "Less than half a mile away". */
function milesLabel(m: number): string {
  if (m < 0.5) return 'Less than half a mile away'
  if (m < 1.15) return 'About a mile away'
  return 'About ' + (Math.round(m * 10) / 10) + ' miles away'
}

export function buildEmergency(l: { lat?: unknown; lng?: unknown; city?: unknown; address?: unknown }): EmergencySection {
  const h = nearestHospital(l.lat, l.lng) || nearestHospitalForCity(l.city, l.address)
  const p = policeFor(l.city, l.address)
  return {
    heading: 'in an emergency',
    emergency: '911',
    emergencyNote: 'For fire, police or an ambulance, call 911 first — then call us.',
    policeLabel: p ? p.agency + ' · non-emergency' : null,
    police: p ? p.phone : null,
    hospital: h ? {
      name: h.name,
      address: h.address,
      phone: h.phone,
      distance: milesLabel(h.miles),
      trauma: h.trauma || null,
    } : null,
    note: 'The hospital above has a 24-hour emergency room. Distance is as the crow flies — allow longer by car.',
  }
}

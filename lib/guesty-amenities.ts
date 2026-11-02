// GUESTY'S AMENITY VOCABULARY, AND THE TRANSLATOR INTO IT.
//
// Jon, 2026-11-01: "the photo amenities feature is not pushing when selected — like it does not
// save." It did save: Guesty answered 200 and quietly DROPPED every name it did not recognise.
// Our house vocabulary says "Cooking basics", "Smart TV", "Outdoor furniture" (Airbnb's words);
// Guesty's supported list says "Cookware", "TV", "Outdoor seating (furniture)". Anything written to
// PUT /properties-api/amenities/{id} must use Guesty's spelling or it does not exist.
//
// This file: the supported list as pulled from Guesty on 2026-11-01 (the live list from
// /api/amenities-catalog is unioned in at runtime, so a new Guesty amenity is accepted the day it
// appears), a synonym table for the names our tools and Airbnb use, and resolveAmenity(), which
// every writer and the audit call. Pure.

export const GUESTY_AMENITIES_SNAPSHOT: string[] = ['Accessible-height bed', 'Accessible-height toilet', 'Air conditioning', 'Baby bath', 'Baby monitor', 'Babysitter recommendations', 'Baking sheet', 'Balcony', 'Barbeque utensils', 'Bathtub', 'BBQ grill', 'Beach', 'Beach access', 'Beach essentials', 'Beach Front', 'Beach View', 'Bed linens', 'Bicycles available', 'Bikes', 'Blender', 'Board games', 'Boat slip', 'Body soap', 'Breakfast', 'Cable TV', 'Carbon monoxide detector', 'Casinos', 'Ceiling fan', 'Changing table', 'Children’s books and toys', 'Children’s dinnerware', 'City View', 'Cleaning before checkout', 'Cleaning Disinfection', 'Cleaning products', 'Clothing storage', 'Coffee', 'Coffee maker', 'Coin Laundry', 'Communal pool', 'Conditioner', 'Cookware', 'Crib', 'Cycling', 'Desert View', 'Desk', 'Dining table', 'Disabled parking spot', 'Dishes and silverware', 'Dishwasher', 'Doorman', 'Downtown', 'Dryer', 'Dryer in common space', 'Dvd player', 'Elevator', 'Emergency exit', 'Enhanced cleaning practices', 'Essentials', 'EV charger', 'Extra pillows and blankets', 'Family/kid friendly', 'Fire extinguisher', 'Fire Pit', 'Fireplace guards', 'First aid kit', 'Fishing', 'Foosball table', 'Free parking on premises', 'Free parking on street', 'Freezer', 'Game console', 'Game room', 'Garage', 'Garden or backyard', 'Garden View', 'Golf - Optional', 'Golf course front', 'Golf view', 'Grab-rails for shower and toilet', 'Grab-rails in toilet', 'Gulf front', 'Gym', 'Hair dryer', 'Hammock', 'Hangers', 'Heating', 'High chair', 'High touch surfaces disinfected', 'Horseback Riding', 'Hot tub', 'Hot water', 'Ice maker', 'Indoor fireplace', 'Indoor pool', 'Internet', 'Iron', 'Kayak', 'Kettle', 'Kitchen', 'Lake', 'Lake access', 'Lake Front', 'Laptop friendly workspace', 'Laundromat nearby', 'Long term stays allowed', 'Luggage dropoff allowed', 'Microwave', 'Mini fridge', 'Mosquito net', 'Mountain', 'Mountain Climbing', 'Mountain view', 'Museums', 'Near Ocean', 'Ocean Front', 'Outdoor kitchen', 'Outdoor pool', 'Outdoor seating (furniture)', 'Outlet covers', 'Oven', 'Pack ’n Play/travel crib', 'Paid parking off premises', 'Paid parking on premises', 'Patio or balcony', 'Piano', 'Ping pong table', 'Pocket Wifi', 'Pool table', 'Portable fans', 'Private entrance', 'Private pool', 'Refrigerator', 'Resort', 'Resort access', 'Rice maker', 'River', 'Rock Climbing', 'Roll-in shower with shower bench or chair', 'Rooftop pool', 'Room-darkening shades', 'Rural', 'Safe', 'Sauna', 'Sea view', 'Shampoo', 'Shopping', 'Shower bench', 'Shower chair', 'Shower gel', 'Single level home', 'Ski In', 'Ski In/Ski Out', 'Ski Out', 'Smoke detector', 'Sound system', 'Spa', 'Stair gates', 'Step-free access', 'Stereo system', 'Stove', 'Swimming pool', 'Table corner guards', 'Tennis court', 'Theme Parks', 'Toaster', 'Towels provided', 'Town', 'Trash compactor', 'Tub with shower bench', 'TV', 'Village', 'Washer', 'Washer in common space', 'Water Parks', 'Water Sports', 'Water View', 'Waterfront', 'Wheelchair accessible', 'Wide clearance to bed', 'Wide clearance to shower and toilet', 'Wide doorway', 'Wide hallway clearance', 'Window guards', 'Wine glasses', 'Wireless Internet', 'Zoo']

/** Our words → Guesty's. Keys are normalised (see norm). */
const SYNONYMS: Record<string, string> = {
  'cooking basics': 'Cookware',
  'balcony patio': 'Patio or balcony', 'bbq utensils': 'Barbeque utensils',
  'suitable for infants': 'Family/kid friendly', 'suitable for infants under 2 years': 'Family/kid friendly', 'suitable for children 2 12 years': 'Family/kid friendly', 'suitable for children': 'Family/kid friendly', 'kid friendly': 'Family/kid friendly', 'family friendly': 'Family/kid friendly',
  'toilet paper': 'Essentials', 'pots and pans': 'Cookware', 'cookware': 'Cookware',
  'smart tv': 'TV', 'hdtv': 'TV', 'television': 'TV', 'netflix': 'TV',
  'outdoor furniture': 'Outdoor seating (furniture)', 'outdoor seating': 'Outdoor seating (furniture)', 'patio furniture': 'Outdoor seating (furniture)', 'sun loungers': 'Outdoor seating (furniture)', 'lounge chairs': 'Outdoor seating (furniture)',
  'outdoor dining area': 'Outdoor seating (furniture)',
  'pool': 'Swimming pool', 'shared pool': 'Communal pool', 'building pool': 'Communal pool', 'rooftop deck': 'Rooftop pool',
  'wifi': 'Wireless Internet', 'wi fi': 'Wireless Internet', 'fast wifi': 'Wireless Internet', 'internet': 'Internet',
  'dedicated workspace': 'Laptop friendly workspace', 'workspace': 'Laptop friendly workspace', 'desk chair': 'Desk', 'office': 'Laptop friendly workspace',
  'self check in': 'Private entrance', 'smart lock': 'Private entrance', 'keypad': 'Private entrance', 'lockbox': 'Private entrance',
  'smoke alarm': 'Smoke detector', 'carbon monoxide alarm': 'Carbon monoxide detector', 'co alarm': 'Carbon monoxide detector', 'co detector': 'Carbon monoxide detector',
  'terrace': 'Patio or balcony', 'patio': 'Patio or balcony', 'lanai': 'Patio or balcony',
  'ocean view': 'Sea view', 'oceanview': 'Sea view', 'bay view': 'Water View', 'intracoastal view': 'Water View', 'city skyline view': 'City View', 'skyline view': 'City View', 'garden view': 'Garden View',
  'beachfront': 'Beach Front', 'oceanfront': 'Ocean Front',
  'bbq': 'BBQ grill', 'grill': 'BBQ grill', 'barbecue': 'BBQ grill', 'barbecue utensils': 'Barbeque utensils',
  'pack n play travel crib': 'Pack ’n Play/travel crib', 'travel crib': 'Pack ’n Play/travel crib', 'pack n play': 'Pack ’n Play/travel crib',
  'children s books and toys': 'Children’s books and toys', 'board games for kids': 'Board games',
  'fire pit': 'Fire Pit', 'fridge': 'Refrigerator', 'mini fridge': 'Mini fridge', 'range': 'Stove', 'cooktop': 'Stove', 'electric range': 'Stove',
  'towels': 'Towels provided', 'linens': 'Bed linens', 'sheets': 'Bed linens', 'fan': 'Ceiling fan', 'fans': 'Portable fans',
  'free street parking': 'Free parking on street', 'street parking': 'Free parking on street', 'valet parking': 'Paid parking on premises', 'parking': 'Free parking on premises',
  'jacuzzi': 'Hot tub', 'whirlpool': 'Hot tub', 'jetted tub': 'Hot tub', 'soaking tub': 'Bathtub', 'tub': 'Bathtub',
  'fitness': 'Gym', 'fitness center': 'Gym', 'fitness room': 'Gym', 'exercise equipment': 'Gym',
  'washer and dryer': 'Washer', 'in unit laundry': 'Washer', 'laundry': 'Washer',
  'speaker': 'Sound system', 'bluetooth speaker': 'Sound system', 'stereo': 'Stereo system',
  'beach chairs': 'Beach essentials', 'beach towels': 'Beach essentials', 'pool towels': 'Towels provided',
  'business centre': 'Laptop friendly workspace', 'business center': 'Laptop friendly workspace',
  'lobby': 'Doorman', 'concierge': 'Doorman', 'building staff': 'Doorman',
  'ethernet connection': 'Internet', 'water sports': 'Water Sports', 'kayaks': 'Kayak', 'bicycles': 'Bikes', 'bike': 'Bikes',
}
/** Things with NO Guesty amenity at all — never offer them as something to add. */
const NO_GUESTY_EQUIVALENT = new Set(['pets allowed', 'smoking allowed', 'events allowed', 'suitable for infants', 'host greets you', 'security cameras on property', 'baby bath', 'walk in shower', 'walk-in shower', 'floor plan', 'natural light', 'king bed', 'queen bed'])

export const norm = (x: string) => String(x || '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Translate a name into Guesty's spelling. `supported` = the live list when the caller has it (it is
 * unioned with the snapshot). Returns null when Guesty has nothing for it.
 */
export function resolveAmenity(name: string, supported?: string[] | null): string | null {
  const all = Array.from(new Set([...(supported || []), ...GUESTY_AMENITIES_SNAPSHOT]))
  const byNorm = new Map<string, string>()
  for (const a of all) byNorm.set(norm(a), a)
  const n = norm(name)
  if (!n) return null
  if (byNorm.has(n)) return byNorm.get(n)!
  if (SYNONYMS[n] && byNorm.has(norm(SYNONYMS[n]))) return byNorm.get(norm(SYNONYMS[n]))!
  if (NO_GUESTY_EQUIVALENT.has(n)) return null
  // Plural / singular, and "X: detail" forms ("Coffee maker: Keurig").
  const head = n.split(' ')[0] === n ? n : n
  const stem = n.endsWith('s') ? n.slice(0, -1) : n + 's'
  if (byNorm.has(stem)) return byNorm.get(stem)!
  const colon = String(name).split(':')[0]
  if (colon !== name && byNorm.has(norm(colon))) return byNorm.get(norm(colon))!
  void head
  return null
}

/**
 * Translate a whole list; returns what Guesty will keep and what it would have dropped.
 * `current` = what the listing already carries: a legacy name Guesty already holds (it keeps
 * "Suitable for children (2-12 years)" from an old import) is passed through untouched rather than
 * dropped, so a save never strips what was there. Only NEW unknown names are refused.
 */
export function resolveAmenities(names: string[], supported?: string[] | null, current: string[] = []): { kept: string[]; dropped: string[]; renamed: { from: string; to: string }[] } {
  const kept: string[] = [], dropped: string[] = [], renamed: { from: string; to: string }[] = []
  const seen = new Set<string>()
  const had = new Set(current.map(c => c.toLowerCase()))
  for (const raw of names) {
    const r = resolveAmenity(raw, supported) || (had.has(String(raw).toLowerCase()) ? String(raw) : null)
    if (!r) { dropped.push(raw); continue }
    if (seen.has(r.toLowerCase())) continue
    seen.add(r.toLowerCase()); kept.push(r)
    if (r !== raw) renamed.push({ from: raw, to: r })
  }
  return { kept, dropped, renamed }
}

/** Does the listed set already carry this name (in any spelling Guesty would map it to)? */
export function listedUnderAnyName(name: string, listed: string[], supported?: string[] | null): boolean {
  const target = resolveAmenity(name, supported)
  const n = norm(name)
  return listed.some(l => { const ln = norm(l); if (ln === n) return true; const lr = resolveAmenity(l, supported); return !!target && !!lr && lr === target })
}

/**
 * PORTFOLIO REPAIR (2026-11-01, "a lot of them don't stick — run a full audit and fix"). For one
 * listing's stored list: which names are in a spelling Guesty maps to no channel, and what the
 * list should be — every name translated, legacy names Guesty already holds kept, nothing lost.
 */
export function repairPlan(listed: string[], supported?: string[] | null): { add: string[]; untranslatable: string[]; next: string[] } {
  const supLower = new Set(Array.from(new Set([...(supported || []), ...GUESTY_AMENITIES_SNAPSHOT])).map(norm))
  const add: string[] = [], untranslatable: string[] = []
  const next: string[] = []
  const have = new Set(listed.map(norm))
  for (const a of listed) {
    if (supLower.has(norm(a))) { if (!next.some(x => norm(x) === norm(a))) next.push(a); continue }
    const g = resolveAmenity(a, supported)
    if (g) { if (!have.has(norm(g)) && !add.some(x => norm(x) === norm(g))) add.push(g) } else untranslatable.push(a)
    // keep the legacy word too — Guesty holds it and removing it gains nothing
    if (!next.some(x => norm(x) === norm(a))) next.push(a)
  }
  for (const g of add) if (!next.some(x => norm(x) === norm(g))) next.push(g)
  return { add, untranslatable, next }
}

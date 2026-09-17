// THE AMENITY PICK LIST, GROUPED THE WAY GUESTY AND AIRBNB GROUP IT.
//
// Jon, 2026-09-17: "for the amenities it's not having a full drop-down list of the amenities
// that we can add. That right column should have a scroll through amenities organized by
// category so that we can add the amenities to the listing."
//
// Two jobs here, and they are separate on purpose:
//
// 1. A BUILT-IN VOCABULARY, so the slide works on a deck generated before the catalogue
//    existed. The portfolio-derived list is passed in on the report's content JSON at
//    generation time, which means every deck built before 2026-09-17 has none — the column
//    showed the twenty scored recommendations and nothing else. The renderer now unions the
//    stored list with this one, so an old deck gets the full pick list without regenerating.
//
// 2. A CATEGORY FOR EVERY NAME, including names this file has never seen. A hundred amenities
//    in one alphabetical run is a wall, not a list. Matching is longest-keyword-first against
//    the lowercased name, so "Pool towels" lands in Outdoor via "pool towel" rather than in
//    whatever "towel" would have claimed — the order of the rules inside a category is load
//    bearing and the lookup is built once, sorted by keyword length, not by category order.
//
// Anything unmatched falls to "More amenities" rather than being dropped: an amenity we cannot
// classify is still one the owner can add, and silently hiding it is the bug this file exists
// to fix.

export type AmenityGroup = { name: string; items: string[] }

/** The house vocabulary. Every value is a spelling Guesty has accepted on a live listing. */
export const AMENITY_GROUPS: AmenityGroup[] = [
  { name: 'Essentials', items: [
    'Wifi', 'Air conditioning', 'Heating', 'Kitchen', 'Washer', 'Dryer', 'Essentials',
    'Hangers', 'Bed linens', 'Extra pillows and blankets', 'Iron', 'Hair dryer',
    'Clothing storage', 'Room-darkening shades', 'Cleaning products',
  ] },
  { name: 'Kitchen & dining', items: [
    'Refrigerator', 'Microwave', 'Oven', 'Stove', 'Dishwasher', 'Freezer', 'Coffee maker',
    'Coffee', 'Toaster', 'Blender', 'Cooking basics', 'Dishes and silverware',
    'Wine glasses', 'Baking sheet', 'Barbecue utensils', 'Dining table', 'Kettle',
  ] },
  { name: 'Bathroom', items: [
    'Shampoo', 'Conditioner', 'Body soap', 'Hot water', 'Shower gel', 'Bathtub',
    'Towels provided', 'Toilet paper', 'Bidet',
  ] },
  { name: 'Entertainment', items: [
    'TV', 'Cable TV', 'Netflix', 'Smart TV', 'Sound system', 'Books and reading material',
    'Board games', 'Game console', 'Ethernet connection',
  ] },
  { name: 'Workspace', items: [
    'Dedicated workspace', 'Laptop-friendly workspace', 'Desk', 'Desk chair', 'Printer',
  ] },
  { name: 'Outdoor & views', items: [
    'Pool', 'Hot tub', 'Balcony', 'Patio or balcony', 'Terrace', 'BBQ grill', 'Outdoor furniture',
    'Outdoor dining area', 'Beach access', 'Beachfront', 'Beach essentials', 'Ocean view',
    'Waterfront', 'City skyline view', 'Garden view', 'Sun loungers', 'Pool towels',
    'Fire pit', 'Hammock',
  ] },
  { name: 'Building & facilities', items: [
    'Gym', 'Elevator', 'Sauna', 'Shared pool', 'Rooftop deck', 'Lobby', 'Concierge',
    'Doorman', 'Business centre', 'Laundromat nearby', 'Single level home',
  ] },
  { name: 'Parking', items: [
    'Free parking on premises', 'Paid parking on premises', 'Free street parking',
    'Paid parking off premises', 'Garage', 'Valet parking', 'EV charger',
  ] },
  { name: 'Arrival & access', items: [
    'Self check-in', 'Smart lock', 'Keypad', 'Lockbox', 'Building staff', 'Host greets you',
    'Luggage dropoff allowed', 'Long term stays allowed',
  ] },
  { name: 'Family', items: [
    'Crib', 'Pack n play/Travel crib', 'High chair', 'Children’s books and toys',
    'Baby bath', 'Babysitter recommendations', 'Changing table', 'Board games for kids',
  ] },
  { name: 'Safety', items: [
    'Smoke alarm', 'Carbon monoxide alarm', 'Fire extinguisher', 'First aid kit',
    'Security cameras on property', 'Window guards', 'Stair gates',
  ] },
  { name: 'Policies', items: [
    'Pets allowed', 'Smoking allowed', 'Events allowed', 'Suitable for infants',
  ] },
]

/** Keyword → category. Longest keyword wins, so a specific rule beats a general one. */
const RULES: [string, string][] = [
  ['pool towel', 'Outdoor & views'], ['shared pool', 'Building & facilities'],
  ['pool', 'Outdoor & views'], ['hot tub', 'Outdoor & views'], ['jacuzzi', 'Outdoor & views'],
  ['beach', 'Outdoor & views'], ['ocean', 'Outdoor & views'], ['waterfront', 'Outdoor & views'],
  ['view', 'Outdoor & views'], ['balcony', 'Outdoor & views'], ['terrace', 'Outdoor & views'],
  ['patio', 'Outdoor & views'], ['grill', 'Outdoor & views'], ['bbq', 'Outdoor & views'],
  ['outdoor', 'Outdoor & views'], ['garden', 'Outdoor & views'], ['backyard', 'Outdoor & views'],
  ['fire pit', 'Outdoor & views'], ['hammock', 'Outdoor & views'], ['sun lounger', 'Outdoor & views'],

  ['parking', 'Parking'], ['garage', 'Parking'], ['carport', 'Parking'], ['valet', 'Parking'],
  ['ev charger', 'Parking'], ['electric vehicle', 'Parking'],

  ['self check', 'Arrival & access'], ['smart lock', 'Arrival & access'],
  ['keypad', 'Arrival & access'], ['lockbox', 'Arrival & access'], ['key', 'Arrival & access'],
  ['check-in', 'Arrival & access'], ['luggage', 'Arrival & access'],
  ['long term', 'Arrival & access'], ['host greets', 'Arrival & access'],
  ['building staff', 'Arrival & access'], ['doorman', 'Building & facilities'],

  ['smoke alarm', 'Safety'], ['smoke detector', 'Safety'], ['carbon monoxide', 'Safety'],
  ['fire extinguisher', 'Safety'], ['first aid', 'Safety'], ['security camera', 'Safety'],
  ['window guard', 'Safety'], ['stair gate', 'Safety'], ['alarm', 'Safety'], ['detector', 'Safety'],

  ['crib', 'Family'], ['high chair', 'Family'], ['pack n play', 'Family'],
  ['travel crib', 'Family'], ['children', 'Family'], ['baby', 'Family'],
  ['changing table', 'Family'], ['toys', 'Family'], ['infant', 'Family'],

  ['dedicated workspace', 'Workspace'], ['laptop', 'Workspace'], ['workspace', 'Workspace'],
  ['desk', 'Workspace'], ['printer', 'Workspace'], ['office', 'Workspace'],

  ['dishwasher', 'Kitchen & dining'], ['refrigerator', 'Kitchen & dining'],
  ['fridge', 'Kitchen & dining'], ['microwave', 'Kitchen & dining'], ['oven', 'Kitchen & dining'],
  ['stove', 'Kitchen & dining'], ['freezer', 'Kitchen & dining'], ['coffee', 'Kitchen & dining'],
  ['toaster', 'Kitchen & dining'], ['blender', 'Kitchen & dining'], ['kettle', 'Kitchen & dining'],
  ['cooking', 'Kitchen & dining'], ['dishes', 'Kitchen & dining'], ['silverware', 'Kitchen & dining'],
  ['wine glass', 'Kitchen & dining'], ['baking', 'Kitchen & dining'], ['dining', 'Kitchen & dining'],
  ['kitchen', 'Kitchen & dining'], ['utensils', 'Kitchen & dining'], ['cookware', 'Kitchen & dining'],

  ['shampoo', 'Bathroom'], ['conditioner', 'Bathroom'], ['body soap', 'Bathroom'],
  ['shower', 'Bathroom'], ['bathtub', 'Bathroom'], ['bath', 'Bathroom'], ['toilet', 'Bathroom'],
  ['bidet', 'Bathroom'], ['towel', 'Bathroom'], ['hot water', 'Bathroom'], ['soap', 'Bathroom'],

  ['netflix', 'Entertainment'], ['smart tv', 'Entertainment'], ['cable', 'Entertainment'],
  ['hdtv', 'Entertainment'], ['tv', 'Entertainment'], ['sound system', 'Entertainment'],
  ['speaker', 'Entertainment'], ['board game', 'Entertainment'], ['game console', 'Entertainment'],
  ['books', 'Entertainment'], ['ethernet', 'Entertainment'], ['record player', 'Entertainment'],

  ['gym', 'Building & facilities'], ['fitness', 'Building & facilities'],
  ['exercise', 'Building & facilities'], ['elevator', 'Building & facilities'],
  ['sauna', 'Building & facilities'], ['rooftop', 'Building & facilities'],
  ['concierge', 'Building & facilities'], ['lobby', 'Building & facilities'],
  ['single level', 'Building & facilities'], ['business cent', 'Building & facilities'],

  ['pets allowed', 'Policies'], ['pet friendly', 'Policies'], ['pet-friendly', 'Policies'],
  ['smoking', 'Policies'], ['events allowed', 'Policies'], ['suitable for', 'Policies'],

  ['wifi', 'Essentials'], ['internet', 'Essentials'], ['air conditioning', 'Essentials'],
  ['heating', 'Essentials'], ['washer', 'Essentials'], ['dryer', 'Essentials'],
  ['laundry', 'Essentials'], ['hanger', 'Essentials'], ['linen', 'Essentials'],
  ['pillow', 'Essentials'], ['blanket', 'Essentials'], ['iron', 'Essentials'],
  ['hair dryer', 'Essentials'], ['clothing storage', 'Essentials'], ['closet', 'Essentials'],
  ['shades', 'Essentials'], ['curtain', 'Essentials'], ['cleaning product', 'Essentials'],
  ['essentials', 'Essentials'], ['bed', 'Essentials'],
]

const LOOKUP = RULES.slice().sort((a, b) => b[0].length - a[0].length)
export const CATEGORY_ORDER: string[] = AMENITY_GROUPS.map(g => g.name).concat(['More amenities'])

/** Where an amenity belongs. Never throws, never returns empty. */
export function categoryOf(name: string): string {
  const n = String(name || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  if (!n) return 'More amenities'
  for (const g of AMENITY_GROUPS) for (const it of g.items) if (it.toLowerCase() === n) return g.name
  for (const [kw, cat] of LOOKUP) if (n.indexOf(kw) >= 0) return cat
  return 'More amenities'
}

/** The built-in vocabulary as a flat list, for unioning with whatever the report carries. */
export const AMENITY_VOCAB: string[] = AMENITY_GROUPS.reduce<string[]>((a, g) => a.concat(g.items), [])

/** Group a list of amenity names into display order, dropping empty categories. */
export function groupAmenities(names: string[]): AmenityGroup[] {
  const by = new Map<string, string[]>()
  for (const n of names) {
    const c = categoryOf(n)
    const list = by.get(c)
    if (list) list.push(n); else by.set(c, [n])
  }
  const out: AmenityGroup[] = []
  for (const c of CATEGORY_ORDER) {
    const items = by.get(c)
    if (items && items.length) out.push({ name: c, items: items.sort((a, b) => a.localeCompare(b)) })
  }
  return out
}

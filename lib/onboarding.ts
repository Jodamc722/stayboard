// ONBOARDING INVENTORY — the vocabulary and the room generator (Jon, 2026-09-02).
//
// A new unit is described in one quick section (bedrooms, bathrooms, occupancy, balcony, washer /
// dryer, sleeper sofa…) and that description GENERATES the room list — "Master bedroom", "Master
// bath", "Bedroom 2", "Balcony" — each room pre-filled with the items a unit of that shape is
// expected to hold, so the walker confirms and photographs rather than types. Everything here is
// agnostic of Guesty: the unit is a row with a share code, and `listing_id` is filled in the day it
// goes live.
//
// Isomorphic on purpose (no server imports): the public form and the API both read this file, so
// the room a phone shows and the room the server creates are the same definition.

export type RoomKind = 'entry' | 'living' | 'kitchen' | 'dining' | 'bedroom' | 'bathroom' | 'balcony' | 'laundry' | 'other'
export type Category = 'furniture' | 'appliance' | 'electronics' | 'kitchen' | 'linen' | 'decor' | 'safety' | 'other'
export type Condition = 'new' | 'good' | 'fair' | 'worn' | 'missing'
export const CONDITIONS: { key: Condition; label: string; cls: string }[] = [
  { key: 'new', label: 'New', cls: 'bg-emerald-600 text-white border-emerald-600' },
  { key: 'good', label: 'Good', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { key: 'fair', label: 'Fair', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'worn', label: 'Worn', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  { key: 'missing', label: 'Missing', cls: 'bg-neutral-800 text-white border-neutral-800' },
]
export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'furniture', label: 'Furniture' }, { key: 'appliance', label: 'Appliance' }, { key: 'electronics', label: 'Electronics' },
  { key: 'kitchen', label: 'Kitchen' }, { key: 'linen', label: 'Linen' }, { key: 'decor', label: 'Decor' }, { key: 'safety', label: 'Safety' }, { key: 'other', label: 'Other' },
]

/** The quick section at the top of the form. Every field optional; the generator copes with gaps. */
export type UnitDetails = {
  bedrooms?: number          // 0 = studio
  bathrooms?: number         // 1, 1.5, 2, 2.5 …
  occupancy?: number         // max guests
  balconies?: number         // 0 | 1 | 2
  washerDryer?: 'in_unit' | 'shared' | 'none'
  sleeperSofa?: number       // 0 | 1 | 2
  kitchen?: 'full' | 'kitchenette' | 'none'
  appliances?: ApplianceKey[]   // what is actually in the unit — asked right after the kitchen question
  beds?: Record<string, BedSize[]>  // per bedroom key (master_bedroom, bedroom_2…): the beds in it, by size
  parking?: 'none' | 'assigned' | 'garage' | 'street'
  floor?: string
  sqft?: number
  kingBeds?: number
  pool?: boolean
  gym?: boolean
  notes?: string
}

// THE APPLIANCE QUESTION (Jon, 2026-09-02: "in the pre-form should ask if kitchen, kitchenette, etc.
// If kitchenette should ask appliances, if full kitchen should ask what… no kitchen but might have
// mini fridge, maybe microwave"). One list; the kitchen type only changes which are pre-ticked.
export type ApplianceKey = 'fridge' | 'mini_fridge' | 'stove_oven' | 'cooktop' | 'oven' | 'microwave' | 'dishwasher' | 'coffee' | 'espresso' | 'toaster' | 'kettle' | 'blender' | 'air_fryer' | 'wine_fridge' | 'ice_maker' | 'disposal' | 'rice_cooker' | 'slow_cooker'
export const APPLIANCES: { key: ApplianceKey; label: string; full: boolean; kitchenette: boolean; none: boolean }[] = [
  { key: 'fridge', label: 'Full refrigerator', full: true, kitchenette: false, none: false },
  { key: 'mini_fridge', label: 'Mini fridge', full: false, kitchenette: true, none: true },
  { key: 'stove_oven', label: 'Stove / oven (range)', full: true, kitchenette: false, none: false },
  { key: 'cooktop', label: 'Cooktop only', full: false, kitchenette: true, none: false },
  { key: 'oven', label: 'Wall / toaster oven', full: false, kitchenette: false, none: false },
  { key: 'microwave', label: 'Microwave', full: true, kitchenette: true, none: true },
  { key: 'dishwasher', label: 'Dishwasher', full: true, kitchenette: false, none: false },
  { key: 'coffee', label: 'Coffee maker', full: true, kitchenette: true, none: true },
  { key: 'espresso', label: 'Espresso / Nespresso', full: false, kitchenette: false, none: false },
  { key: 'toaster', label: 'Toaster', full: true, kitchenette: true, none: false },
  { key: 'kettle', label: 'Kettle', full: true, kitchenette: true, none: false },
  { key: 'blender', label: 'Blender', full: true, kitchenette: false, none: false },
  { key: 'air_fryer', label: 'Air fryer', full: false, kitchenette: false, none: false },
  { key: 'wine_fridge', label: 'Wine fridge', full: false, kitchenette: false, none: false },
  { key: 'ice_maker', label: 'Ice maker', full: false, kitchenette: false, none: false },
  { key: 'disposal', label: 'Garbage disposal', full: true, kitchenette: false, none: false },
  { key: 'rice_cooker', label: 'Rice cooker', full: false, kitchenette: false, none: false },
  { key: 'slow_cooker', label: 'Slow cooker / Instant Pot', full: false, kitchenette: false, none: false },
]
export function defaultAppliances(kitchen: UnitDetails['kitchen']): ApplianceKey[] {
  const k = kitchen === 'kitchenette' ? 'kitchenette' : kitchen === 'none' ? 'none' : 'full'
  return APPLIANCES.filter(a => a[k]).map(a => a.key)
}

// BEDS (Jon, 2026-09-02: "make the item selection super easy — bedroom, bed size, number of beds").
// Each bedroom lists its beds by size; everything on or around a bed is generated PER BED and sized:
// a King sheet set is not a Twin sheet set, and a bunk room with three twins needs three of each.
export type BedSize = 'king' | 'queen' | 'full' | 'twin' | 'bunk' | 'crib'
export const BED_SIZES: { key: BedSize; label: string; pillows: number }[] = [
  { key: 'king', label: 'King', pillows: 4 }, { key: 'queen', label: 'Queen', pillows: 4 }, { key: 'full', label: 'Full', pillows: 2 },
  { key: 'twin', label: 'Twin', pillows: 2 }, { key: 'bunk', label: 'Bunk (2 twins)', pillows: 4 }, { key: 'crib', label: 'Crib', pillows: 0 },
]
export const bedLabel = (k: BedSize) => BED_SIZES.find(b => b.key === k)?.label || k
/** Bedroom keys in order — master first — for a bedroom count. */
export function bedroomKeys(bedrooms: number): string[] {
  const n = Math.max(0, Math.min(8, Math.round(bedrooms || 0)))
  const out: string[] = []
  for (let i = 1; i <= n; i++) out.push(i === 1 ? 'master_bedroom' : 'bedroom_' + i)
  return out
}
export function bedsFor(d: UnitDetails, roomKey: string): BedSize[] {
  const b = d.beds && Array.isArray(d.beds[roomKey]) ? d.beds[roomKey].filter(x => BED_SIZES.some(s => s.key === x)) : null
  if (b && b.length) return b
  return roomKey === 'master_bedroom' ? ['king'] : ['queen']
}

export type Tier = 'must' | 'recommended' | 'suggested'
export const TIER_LABEL: Record<Tier, string> = { must: 'Must have', recommended: 'Recommended', suggested: 'Nice to have' }   // Jon: must = the amenities (plates…); recommended = a blender; nice to have = board games
export const TIERS: Tier[] = ['must', 'recommended', 'suggested']

export type RoomDef = { key: string; name: string; kind: RoomKind; sort: number }
export type ItemDef = { name: string; category: Category; qty: number; brand?: string; tier: Tier }

const n = (v: any, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d }
const ordinal = (i: number) => String(i)

/**
 * The room list a unit of this shape has. Deterministic keys so re-running after the details change
 * ADDS what is now expected and never renames or deletes what the walker already filled in.
 */
export function roomsFor(d: UnitDetails): RoomDef[] {
  const beds = Math.max(0, Math.min(8, Math.round(n(d.bedrooms))))
  const baths = Math.max(0, Math.min(8, n(d.bathrooms)))
  const fullBaths = Math.floor(baths)
  const halfBath = baths - fullBaths >= 0.5
  const out: RoomDef[] = []
  let s = 0
  out.push({ key: 'entry', name: 'Entry & hallway', kind: 'entry', sort: s++ })
  out.push({ key: 'living', name: beds === 0 ? 'Studio living area' : 'Living room', kind: 'living', sort: s++ })
  const appl = Array.isArray(d.appliances) ? d.appliances : defaultAppliances(d.kitchen)
  if (d.kitchen !== 'none') out.push({ key: 'kitchen', name: d.kitchen === 'kitchenette' ? 'Kitchenette' : 'Kitchen', kind: 'kitchen', sort: s++ })
  else if (appl.length) out.push({ key: 'kitchen', name: 'Kitchen corner', kind: 'kitchen', sort: s++ })   // no kitchen, but a mini fridge and a microwave still get counted
  if (beds >= 1) out.push({ key: 'dining', name: 'Dining area', kind: 'dining', sort: s++ })
  if (beds >= 1) out.push({ key: 'master_bedroom', name: 'Master bedroom', kind: 'bedroom', sort: s++ })
  if (beds >= 1 && fullBaths >= 1) out.push({ key: 'master_bath', name: 'Master bath', kind: 'bathroom', sort: s++ })
  for (let i = 2; i <= beds; i++) out.push({ key: 'bedroom_' + i, name: 'Bedroom ' + ordinal(i), kind: 'bedroom', sort: s++ })
  // Studio: the one bath is simply "Bathroom". Otherwise bath 2..n after the master bath.
  if (beds === 0 && fullBaths >= 1) out.push({ key: 'bathroom_1', name: 'Bathroom', kind: 'bathroom', sort: s++ })
  for (let i = 2; i <= fullBaths; i++) out.push({ key: 'bathroom_' + i, name: (beds >= 1 && i === 2 ? 'Guest bathroom' : 'Bathroom ' + ordinal(i)), kind: 'bathroom', sort: s++ })
  if (halfBath) out.push({ key: 'half_bath', name: 'Half bath', kind: 'bathroom', sort: s++ })
  const balc = Math.max(0, Math.min(4, Math.round(n(d.balconies))))
  for (let i = 1; i <= balc; i++) out.push({ key: 'balcony_' + i, name: balc === 1 ? 'Balcony' : 'Balcony ' + ordinal(i), kind: 'balcony', sort: s++ })
  if (d.washerDryer === 'in_unit') out.push({ key: 'laundry', name: 'Laundry closet', kind: 'laundry', sort: s++ })
  return out
}

// ── THE INVENTORY STANDARD ──────────────────────────────────────────────────────────────────────
// Jon, 2026-09-02: "ability to add full count of item — utensils, spoons, big spoon count etc.
// Individual items, and it should be based on occupancy and the correct amount for the occupancy
// based on real studied deep research for inventory for STR… we should be able to add and account
// for that in user settings."
//
// So the template is DATA, not code: a list of items per room kind, each with a quantity RULE. A
// rule is either a fixed count or a per-guest multiplier (qty = ceil(occupancy × per) + plus,
// clamped to min/max). The defaults below follow the published STR operator standards — Vacasa,
// AvantStay, Evolve and Hometime all converge on the same numbers: dinnerware and flatware at 2×
// max occupancy (a full second setting so guests are never doing dishes mid-meal), water glasses
// at occupancy + 4, wine glasses at occupancy + 2, bath towels and washcloths at 2× occupancy,
// hand towels 2 per bathroom, two sheet sets per bed, and 10–12 hangers per guest. The default is
// what a unit gets when nobody has edited the standard; the edited copy lives in app_settings
// under STANDARD_KEY and is what /onboarding → "Inventory standard" writes.
//
// The generated quantity is stored on the item as `expected`. The walker's count is `qty`. The gap
// between them is what the buy list is made of.

export type StandardItem = {
  name: string
  category: Category
  qty: number                 // fixed count, or the per-guest multiplier when perGuest is on
  perGuest?: boolean
  plus?: number               // added after the multiply (water glasses = 1×occ + 4)
  min?: number
  max?: number
  brand?: string              // a prompt for the walker: 'size', 'model', 'King'
  only?: 'full' | 'kitchenette' | 'nokitchen' | 'master' | 'nonmaster' | 'sleeper' | 'fullbath' | 'halfbath' | 'studio'
  tier?: Tier                 // must (default) | recommended | suggested — how the form groups it
  appliance?: ApplianceKey    // included only when the unit's appliance list has it
  perBed?: boolean            // bedroom rows: one per bed, sized (brand = King / Queen / Twin…)
}
export type InventoryStandard = Partial<Record<RoomKind, StandardItem[]>>
export const STANDARD_KEY = 'onboarding_standard'
export const ONLY_LABEL: Record<NonNullable<StandardItem['only']>, string> = {
  full: 'full kitchen only', kitchenette: 'kitchenette only', nokitchen: 'no-kitchen units only', master: 'master bedroom only', nonmaster: 'other bedrooms only',
  sleeper: 'if sleeper sofa', fullbath: 'full bath only', halfbath: 'half bath only', studio: 'studio only',
}

const F = (name: string, category: Category, qty: number, extra: Partial<StandardItem> = {}): StandardItem => ({ name, category, qty, ...extra })
const G = (name: string, category: Category, per: number, extra: Partial<StandardItem> = {}): StandardItem => ({ name, category, qty: per, perGuest: true, ...extra })

// R = recommended, S = suggested; F/G default to must-have. A = an appliance row, present only when
// the unit's appliance list says so.
const R = (it: StandardItem): StandardItem => ({ ...it, tier: 'recommended' })
const S = (it: StandardItem): StandardItem => ({ ...it, tier: 'suggested' })
const A = (key: ApplianceKey, name: string, tier: Tier = 'must'): StandardItem => ({ name, category: 'appliance', qty: 1, appliance: key, tier, brand: 'model' })

// "It should be about 2 per max occupancy on most items… based on two" (Jon). Everything a guest
// uses at a meal or a shower is 2 × max occupancy: one in use, one in the wash. Fixed counts are
// for things a unit has one of (a sofa, a stock pot). Floors: 8 for a table setting so a 2-guest
// studio still hosts; caps keep a 16-sleeper from being told to buy 32 wine glasses.
const TWO = { min: 8, max: 24 }
export const DEFAULT_STANDARD: InventoryStandard = {
  entry: [
    F('Smart lock / keypad', 'safety', 1), F('Smoke / CO detector', 'safety', 1), F('Fire extinguisher', 'safety', 1), F('First-aid kit', 'safety', 1),
    F('Wi-Fi router', 'electronics', 1), F('Doormat', 'decor', 1),
    R(F('Console table', 'furniture', 1)), R(F('Mirror', 'decor', 1)), R(F('Coat hooks / rack', 'furniture', 1)), R(F('Luggage rack', 'furniture', 1)), R(F('Flashlight', 'safety', 1)),
    S(F('Umbrella', 'other', 2)), S(F('Shoe tray', 'decor', 1)),
  ],
  living: [
    F('Sofa', 'furniture', 1), F('Sleeper sofa', 'furniture', 1, { only: 'sleeper' }), F('Sleeper sofa bedding set', 'linen', 1, { only: 'sleeper' }), F('Sleeper sofa pillows', 'linen', 2, { only: 'sleeper' }),
    F('Coffee table', 'furniture', 1), F('TV', 'electronics', 1, { brand: 'size' }), F('TV remote', 'electronics', 1), F('A/C thermostat', 'appliance', 1), F('Curtains / blinds', 'decor', 1),
    R(F('Armchair', 'furniture', 1)), R(F('Side table', 'furniture', 2)), R(F('TV stand / console', 'furniture', 1)), R(F('Streaming device', 'electronics', 1)), R(F('Floor / table lamp', 'decor', 2)),
    R(F('Rug', 'decor', 1)), R(F('Throw pillows', 'decor', 4)), R(F('Throw blanket', 'linen', 2)), R(F('Wall art', 'decor', 2)),
    S(F('Board games / books', 'other', 3)), S(F('Charging station / USB', 'electronics', 1)), S(F('Bluetooth speaker', 'electronics', 1)), S(F('Plants / greenery', 'decor', 2)),
  ],
  kitchen: [
    // appliances — asked in the pre-form; present only when ticked. Tiered the way Jon reads them
    // (2026-09-02: "the must haves are your amenities — plates etc. Recommended would be blender"):
    // must = what a guest expects to find; recommended = nice to have; suggested = extras.
    A('fridge', 'Full refrigerator'), A('mini_fridge', 'Mini fridge'), A('stove_oven', 'Stove / oven'), A('cooktop', 'Cooktop'), A('microwave', 'Microwave'), A('coffee', 'Coffee maker'),
    A('dishwasher', 'Dishwasher', 'recommended'), A('toaster', 'Toaster', 'recommended'), A('kettle', 'Kettle', 'recommended'), A('blender', 'Blender', 'recommended'), A('oven', 'Wall / toaster oven', 'recommended'), A('disposal', 'Garbage disposal', 'recommended'),
    A('espresso', 'Espresso machine', 'suggested'), A('air_fryer', 'Air fryer', 'suggested'), A('wine_fridge', 'Wine fridge', 'suggested'), A('ice_maker', 'Ice maker', 'suggested'), A('rice_cooker', 'Rice cooker', 'suggested'), A('slow_cooker', 'Slow cooker / Instant Pot', 'suggested'),
    // table setting — 2 × max occupancy, counted piece by piece
    G('Dinner plates', 'kitchen', 2, TWO), G('Salad / side plates', 'kitchen', 2, TWO), G('Bowls', 'kitchen', 2, TWO), G('Mugs', 'kitchen', 2, TWO),
    G('Water glasses', 'kitchen', 2, TWO), G('Wine glasses', 'kitchen', 2, { min: 6, max: 16 }),
    G('Forks', 'kitchen', 2, TWO), G('Knives (table)', 'kitchen', 2, TWO), G('Spoons (table)', 'kitchen', 2, TWO), G('Teaspoons', 'kitchen', 2, TWO),
    F('Serving spoons (big spoon)', 'kitchen', 3), F('Serving forks', 'kitchen', 2), R(F('Steak knives', 'kitchen', 6)), R(G('Kids plastic cups / plates', 'kitchen', 1, { min: 4, max: 8 })),
    // cookware
    F('Frying pan 10in non-stick', 'kitchen', 1), F('Saucepan 3qt w/ lid', 'kitchen', 1), F('Cutting boards', 'kitchen', 2), F("Chef's knife", 'kitchen', 1), F('Paring knife', 'kitchen', 1),
    F('Spatula', 'kitchen', 2), F('Wooden spoon', 'kitchen', 2), F('Tongs', 'kitchen', 1), F('Can opener', 'kitchen', 1), F('Wine / bottle opener', 'kitchen', 1), F('Mixing bowls', 'kitchen', 3),
    F('Colander / strainer', 'kitchen', 1), F('Oven mitts', 'kitchen', 2), F('Kitchen towels', 'linen', 4), F('Dish rack', 'kitchen', 1), F('Trash can', 'other', 1), F('Fire extinguisher', 'safety', 1),
    R(F('Frying pan 8in', 'kitchen', 1)), R(F('Saucepan 1.5qt w/ lid', 'kitchen', 1)), R(F('Stock pot 8qt w/ lid', 'kitchen', 1, { only: 'full' })), R(F('Sauté pan 4qt w/ lid', 'kitchen', 1, { only: 'full' })),
    R(F('Baking sheets', 'kitchen', 2, { only: 'full' })), R(F('Baking dish 9x13', 'kitchen', 1, { only: 'full' })), R(F('Bread knife', 'kitchen', 1)), R(F('Slotted spoon', 'kitchen', 1)), R(F('Ladle', 'kitchen', 1)),
    R(F('Whisk', 'kitchen', 1)), R(F('Kitchen shears', 'kitchen', 1)), R(F('Measuring cups set', 'kitchen', 1)), R(F('Measuring spoons set', 'kitchen', 1)), R(F('Peeler', 'kitchen', 1)), R(F('Grater', 'kitchen', 1)),
    R(F('Serving bowls', 'kitchen', 2)), R(F('Serving platters', 'kitchen', 2)), R(F('Food storage containers', 'kitchen', 6)), R(F('Trivets', 'kitchen', 2)), R(F('Paper towel holder', 'other', 1)),
    R(F('Salt & pepper shakers', 'kitchen', 1)), R(F('Recycling bin', 'other', 1)), R(F('Cleaning supplies caddy', 'other', 1)), R(F('Bar stools', 'furniture', 2, { only: 'full' })),
    S(F('Muffin pan', 'kitchen', 1, { only: 'full' })), S(F('Pizza cutter', 'kitchen', 1)), S(F('Potato masher', 'kitchen', 1)), S(F('Cooking thermometer', 'kitchen', 1)), S(F('Coffee grinder', 'appliance', 1)),
    S(F('Pitcher', 'kitchen', 1)), S(F('Cocktail shaker set', 'kitchen', 1)), S(F('Knife block / magnet', 'kitchen', 1)), S(F('Spice rack (basics)', 'kitchen', 1)),
  ],
  dining: [
    F('Dining table', 'furniture', 1), G('Dining chairs', 'furniture', 1, { min: 2, max: 10 }), F('Pendant / dining light', 'decor', 1),
    R(G('Placemats', 'kitchen', 1, { min: 4, max: 12 })), R(F('Coasters', 'kitchen', 6)), R(F('Wall art', 'decor', 1)),
    S(F('High chair', 'furniture', 1)), S(G('Cloth napkins', 'linen', 2, TWO)), S(F('Table runner / centerpiece', 'decor', 1)),
  ],
  bedroom: [
    // per bed, sized from the pre-form (a King and a Twin in one room = two lines each)
    F('Bed frame', 'furniture', 1, { perBed: true }), F('Mattress', 'furniture', 1, { perBed: true }), F('Mattress protector', 'linen', 1, { perBed: true }),
    F('Pillows', 'linen', 4, { perBed: true }), F('Pillowcases', 'linen', 4, { perBed: true }), F('Sheet sets', 'linen', 2, { perBed: true }), F('Duvet / comforter', 'linen', 1, { perBed: true }), F('Duvet covers', 'linen', 2, { perBed: true }),
    F('Nightstands', 'furniture', 2), F('Bedside lamps', 'decor', 2), F('Blackout curtains', 'decor', 1), F('Hangers', 'other', 20), F('Smoke detector', 'safety', 1), F('Safe', 'safety', 1, { only: 'master' }),
    R(F('Headboard', 'furniture', 1, { perBed: true })), R(F('Dresser', 'furniture', 1)), R(F('TV', 'electronics', 1, { brand: 'size' })), R(F('TV remote', 'electronics', 1)), R(F('Mirror', 'decor', 1)),
    R(F('Extra blanket', 'linen', 1)), R(F('Rug', 'decor', 1)), R(F('Wall art', 'decor', 1)), R(F('Alarm clock / charger', 'electronics', 1)), R(F('Iron & ironing board', 'other', 1, { only: 'master' })), R(F('Luggage rack', 'furniture', 1)),
    S(F('Bench / reading chair', 'furniture', 1)), S(F('Fan', 'appliance', 1)), S(F('Laundry hamper', 'other', 1)), S(F('Full-length mirror', 'decor', 1, { only: 'master' })),
  ],
  bathroom: [
    F('Hand towels', 'linen', 2), F('Soap dispenser', 'other', 1), F('Trash can', 'other', 1), F('Toilet brush', 'other', 1), F('Plunger', 'other', 1), F('Mirror', 'decor', 1), F('Toilet paper holder', 'other', 1), F('Towel bar / hooks', 'other', 1),
    // full bath — bath towels and washcloths at 2 × occupancy in the FIRST full bath (every other bath gets 4)
    G('Bath towels', 'linen', 2, { min: 4, max: 24, only: 'fullbath' }), G('Washcloths', 'linen', 2, { min: 4, max: 24, only: 'fullbath' }), F('Bath mat', 'linen', 1, { only: 'fullbath' }),
    F('Shower curtain / glass door', 'other', 1, { only: 'fullbath' }), F('Hair dryer', 'appliance', 1, { only: 'fullbath' }),
    R(F('Shower liner', 'other', 1, { only: 'fullbath' })), R(F('Shelving / storage', 'furniture', 1, { only: 'fullbath' })), R(F('Shower caddy', 'other', 1, { only: 'fullbath' })), R(F('Makeup towels (dark)', 'linen', 2, { only: 'fullbath' })),
    S(G('Pool / beach towels', 'linen', 1, { min: 2, max: 12, only: 'fullbath' })), S(F('Magnifying mirror', 'decor', 1, { only: 'fullbath' })), S(F('Bath robe', 'linen', 2, { only: 'fullbath' })), S(F('Scale', 'other', 1, { only: 'fullbath' })),
  ],
  balcony: [
    F('Outdoor chairs', 'furniture', 2), F('Outdoor table', 'furniture', 1),
    R(F('Outdoor light', 'decor', 1)), R(F('Outdoor cushions', 'decor', 2)),
    S(F('Lounge chair', 'furniture', 1)), S(F('Planter', 'decor', 1)), S(F('Outdoor rug', 'decor', 1)),
  ],
  laundry: [
    F('Washer', 'appliance', 1, { brand: 'model' }), F('Dryer', 'appliance', 1, { brand: 'model' }), F('Laundry basket', 'other', 1), F('Vacuum', 'appliance', 1), F('Broom & dustpan', 'other', 1), F('Mop & bucket', 'other', 1),
    R(F('Detergent', 'other', 1)), R(F('Drying rack', 'other', 1)), R(F('Spare light bulbs', 'other', 4)), R(F('Spare batteries', 'other', 4)),
    S(F('Iron', 'other', 1)), S(F('Steamer', 'appliance', 1)), S(F('Lint roller', 'other', 1)),
  ],
  other: [],
}

/** The count a rule yields for a unit of this occupancy. */
export function qtyFor(it: StandardItem, occupancy: number): number {
  const occ = Math.max(1, Math.round(n(occupancy, 4)))
  let q = it.perGuest ? Math.ceil(occ * n(it.qty, 1)) + n(it.plus) : n(it.qty)
  if (it.min != null) q = Math.max(n(it.min), q)
  if (it.max != null) q = Math.min(n(it.max), q)
  return Math.max(0, Math.min(999, Math.round(q)))
}

/** Every stored standard is merged over the default so a room kind nobody edited still has items. */
export function mergeStandard(saved: any): InventoryStandard {
  const out: InventoryStandard = {}
  const src = saved && typeof saved === 'object' ? saved : {}
  for (const k of Object.keys(ROOM_KIND_LABEL) as RoomKind[]) {
    const rows = Array.isArray(src[k]) ? src[k] : DEFAULT_STANDARD[k] || []
    out[k] = rows.filter((r: any) => r && typeof r.name === 'string' && r.name.trim()).map((r: any) => ({
      name: String(r.name).trim().slice(0, 120), category: (CATEGORIES.some(c => c.key === r.category) ? r.category : 'other') as Category,
      qty: Math.max(0, n(r.qty, 1)), perGuest: !!r.perGuest, plus: r.plus != null ? n(r.plus) : undefined, min: r.min != null ? n(r.min) : undefined,
      max: r.max != null ? n(r.max) : undefined, brand: r.brand ? String(r.brand).slice(0, 40) : undefined, only: r.only in ONLY_LABEL ? r.only : undefined,
      tier: (TIERS as string[]).includes(r.tier) ? r.tier : 'must', appliance: APPLIANCES.some(a => a.key === r.appliance) ? r.appliance : undefined, perBed: !!r.perBed,
    }))
  }
  return out
}

/** The items a room of this kind is expected to hold — the walker confirms qty + condition. */
export function itemsFor(room: RoomDef, d: UnitDetails, standard: InventoryStandard = DEFAULT_STANDARD): ItemDef[] {
  const occ = Math.max(1, Math.round(n(d.occupancy, 4)))
  const master = room.key === 'master_bedroom'
  const half = room.key === 'half_bath'
  const firstFullBath = room.key === 'master_bath' || room.key === 'bathroom_1'
  const sleeper = Math.max(0, Math.round(n(d.sleeperSofa)))
  const beds = Math.round(n(d.bedrooms))
  const rows = standard[room.kind] || DEFAULT_STANDARD[room.kind] || []
  const appl = Array.isArray(d.appliances) ? d.appliances : defaultAppliances(d.kitchen)
  const out: ItemDef[] = []
  for (const it of rows) {
    if (it.appliance && !appl.includes(it.appliance)) continue
    // A "kitchen corner" (no kitchen, a mini fridge and a microwave) holds appliances and nothing to cook with.
    if (room.kind === 'kitchen' && d.kitchen === 'none' && !it.appliance && it.only !== 'nokitchen') continue
    switch (it.only) {
      case 'full': if (d.kitchen !== 'full' && d.kitchen != null) continue; break
      case 'kitchenette': if (d.kitchen !== 'kitchenette') continue; break
      case 'nokitchen': if (d.kitchen !== 'none') continue; break
      case 'master': if (!master) continue; break
      case 'nonmaster': if (master) continue; break
      case 'sleeper': if (!sleeper) continue; break
      case 'fullbath': if (half) continue; break
      case 'halfbath': if (!half) continue; break
      case 'studio': if (beds !== 0) continue; break
    }
    if (room.kind === 'living' && sleeper && it.name === 'Sofa') continue          // the sleeper IS the sofa
    if (it.perBed && room.kind === 'bedroom') {
      // One line per bed SIZE in the room, sized in `brand`, so the walker counts King sheets and Twin sheets apart.
      const beds = bedsFor(d, room.key)
      const bySize: Partial<Record<BedSize, number>> = {}; for (const b of beds) bySize[b] = (bySize[b] || 0) + 1
      for (const size of Object.keys(bySize) as BedSize[]) {
        const count = bySize[size] || 0
        if (size === 'crib' && !/mattress|sheet|frame/i.test(it.name)) continue
        // Pillows and pillowcases follow the bed size (4 on a King/Queen, 2 on a Twin); everything else follows the rule.
        const per = /pillow/i.test(it.name) ? (BED_SIZES.find(b => b.key === size)?.pillows ?? 2) : qtyFor(it, occ)
        out.push({ name: it.name, category: it.category, qty: per * count, brand: bedLabel(size), tier: it.tier || 'must' })
      }
      continue
    }
    let qty = qtyFor(it, occ)
    if (it.only === 'sleeper' && !it.perGuest) qty = qty * sleeper                   // one bedding set per sleeper
    // Occupancy-scaled towels belong to ONE bathroom, not every bathroom: the others get a base of 4.
    if (room.kind === 'bathroom' && it.perGuest && !firstFullBath) qty = Math.min(qty, 4)
    out.push({ name: it.name, category: it.category, qty, brand: it.brand, tier: it.tier || 'must' })
  }
  return out
}

export function newCode(): string {
  const bytes = new Uint8Array(6)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const ROOM_KIND_LABEL: Record<RoomKind, string> = { entry: 'Entry', living: 'Living', kitchen: 'Kitchen', dining: 'Dining', bedroom: 'Bedroom', bathroom: 'Bathroom', balcony: 'Outdoor', laundry: 'Laundry', other: 'Other' }

/** One-line summary of the quick section for headers and exports. */
export function describeUnit(d: UnitDetails): string {
  const parts: string[] = []
  const b = n(d.bedrooms, -1); if (b >= 0) parts.push(b === 0 ? 'Studio' : b + ' BR')
  const ba = n(d.bathrooms, -1); if (ba > 0) parts.push(ba + ' BA')
  if (n(d.occupancy) > 0) parts.push('sleeps ' + n(d.occupancy))
  if (d.beds) { const all = Object.values(d.beds).flat(); if (all.length) { const c: Record<string, number> = {}; for (const x of all) c[x] = (c[x] || 0) + 1; parts.push(Object.entries(c).map(([k, v]) => (v > 1 ? v + ' ' : '') + bedLabel(k as BedSize)).join(' + ')) } }
  if (n(d.balconies) > 0) parts.push(n(d.balconies) === 1 ? 'balcony' : n(d.balconies) + ' balconies')
  if (d.washerDryer === 'in_unit') parts.push('W/D in unit'); else if (d.washerDryer === 'shared') parts.push('shared laundry')
  if (n(d.sleeperSofa) > 0) parts.push(n(d.sleeperSofa) + ' sleeper sofa' + (n(d.sleeperSofa) > 1 ? 's' : ''))
  if (d.kitchen === 'kitchenette') parts.push('kitchenette'); else if (d.kitchen === 'none') parts.push('no kitchen')
  return parts.join(' · ')
}

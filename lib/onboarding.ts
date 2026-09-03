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

export type RoomKind = 'entry' | 'living' | 'kitchen' | 'dining' | 'bedroom' | 'bathroom' | 'balcony' | 'laundry' | 'office' | 'other'
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
  rooms?: Record<string, number>    // the rooms this unit actually has, by ROOM_TYPES key → count (Jon 2026-09-03: "rooms should not be standard")
  parking?: 'none' | 'assigned' | 'garage' | 'street'
  floor?: string
  sqft?: number
  kingBeds?: number
  pool?: boolean
  gym?: boolean
  notes?: string
}

// APPLIANCES ARE NOT A QUESTION, THEY ARE MUST-HAVES (Jon, 2026-09-03: "must-haves aren't appliances.
// Must-haves are: if kitchen, they need these appliances / cookware, pots, pans, etc."). The pre-form
// asks only the STRUCTURAL facts — kitchen type, bedrooms, beds, baths — and the standard says what a
// unit with that shape must hold. The walker confirms the fridge is there like they confirm the
// forks; a missing one goes on the buy list. `ApplianceKey` / `APPLIANCES` survive only so an older
// saved standard still parses; nothing new is written with them.
export type ApplianceKey = 'fridge' | 'mini_fridge' | 'stove_oven' | 'cooktop' | 'oven' | 'microwave' | 'dishwasher' | 'coffee' | 'espresso' | 'toaster' | 'kettle' | 'blender' | 'air_fryer' | 'wine_fridge' | 'ice_maker' | 'disposal' | 'rice_cooker' | 'slow_cooker'
export const APPLIANCES: { key: ApplianceKey; label: string }[] = [
  { key: 'fridge', label: 'Full refrigerator' }, { key: 'mini_fridge', label: 'Mini fridge' }, { key: 'stove_oven', label: 'Stove / oven' }, { key: 'cooktop', label: 'Cooktop' }, { key: 'oven', label: 'Wall / toaster oven' },
  { key: 'microwave', label: 'Microwave' }, { key: 'dishwasher', label: 'Dishwasher' }, { key: 'coffee', label: 'Coffee maker' }, { key: 'espresso', label: 'Espresso' }, { key: 'toaster', label: 'Toaster' }, { key: 'kettle', label: 'Kettle' },
  { key: 'blender', label: 'Blender' }, { key: 'air_fryer', label: 'Air fryer' }, { key: 'wine_fridge', label: 'Wine fridge' }, { key: 'ice_maker', label: 'Ice maker' }, { key: 'disposal', label: 'Garbage disposal' }, { key: 'rice_cooker', label: 'Rice cooker' }, { key: 'slow_cooker', label: 'Slow cooker' },
]

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
  if (n === 0) return ['living']   // a studio's bed stands in the living area
  const out: string[] = []
  for (let i = 1; i <= n; i++) out.push(i === 1 ? 'master_bedroom' : 'bedroom_' + i)
  return out
}
export const bedroomLabel = (key: string, i: number) => key === 'living' ? 'Studio (bed in the living area)' : i === 0 ? 'Master bedroom' : 'Bedroom ' + (i + 1)
export function bedsFor(d: UnitDetails, roomKey: string): BedSize[] {
  const b = d.beds && Array.isArray(d.beds[roomKey]) ? d.beds[roomKey].filter(x => BED_SIZES.some(s => s.key === x)) : null
  if (b && b.length) return b
  return roomKey === 'master_bedroom' || roomKey === 'living' ? ['king'] : ['queen']
}

// THE ROOMS A UNIT HAS (Jon, 2026-09-03: "rooms should not be standard, they should be based on the
// opening form — living room, den, entryway, vestibule, terrace, balcony, etc."). The opening form
// shows this catalog; the walker taps what the unit has and how many. Bedrooms, bathrooms and the
// kitchen come from their own counts. Each type borrows its checklist from a KIND in the standard
// (a den is stocked like a living room, a terrace like a balcony).
export type RoomType = { key: string; label: string; kind: RoomKind; group: 'entry' | 'living' | 'dining' | 'outdoor' | 'service'; countable?: boolean; auto?: (d: UnitDetails) => number }
export const ROOM_TYPES: RoomType[] = [
  { key: 'entry', label: 'Entryway', kind: 'entry', group: 'entry', auto: () => 1 },
  { key: 'vestibule', label: 'Vestibule', kind: 'entry', group: 'entry' },
  { key: 'hallway', label: 'Hallway', kind: 'entry', group: 'entry' },
  { key: 'living', label: 'Living room', kind: 'living', group: 'living', auto: () => 1 },
  { key: 'den', label: 'Den / family room', kind: 'living', group: 'living' },
  { key: 'media', label: 'Media room', kind: 'living', group: 'living' },
  { key: 'office', label: 'Office / study', kind: 'office', group: 'living' },
  { key: 'loft', label: 'Loft', kind: 'living', group: 'living' },
  { key: 'dining', label: 'Dining area', kind: 'dining', group: 'dining', auto: d => (Math.round(n(d.bedrooms)) >= 1 ? 1 : 0) },
  { key: 'nook', label: 'Breakfast nook', kind: 'dining', group: 'dining' },
  { key: 'balcony', label: 'Balcony', kind: 'balcony', group: 'outdoor', countable: true, auto: d => Math.max(0, Math.round(n(d.balconies))) },
  { key: 'terrace', label: 'Terrace', kind: 'balcony', group: 'outdoor', countable: true },
  { key: 'patio', label: 'Patio / yard', kind: 'balcony', group: 'outdoor' },
  { key: 'rooftop', label: 'Rooftop', kind: 'balcony', group: 'outdoor' },
  { key: 'pool', label: 'Pool area', kind: 'balcony', group: 'outdoor' },
  { key: 'laundry', label: 'Laundry', kind: 'laundry', group: 'service', auto: d => (d.washerDryer === 'in_unit' ? 1 : 0) },
  { key: 'storage', label: 'Storage / closet', kind: 'other', group: 'service' },
  { key: 'garage', label: 'Garage', kind: 'other', group: 'service' },
  { key: 'gym', label: 'Gym', kind: 'other', group: 'service' },
]
export const ROOM_GROUP_LABEL: Record<RoomType['group'], string> = { entry: 'Coming in', living: 'Living', dining: 'Eating', outdoor: 'Outdoor', service: 'Service' }
/** What the opening form pre-ticks before anyone touches the room list. */
export function defaultRooms(d: UnitDetails): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of ROOM_TYPES) { const c = t.auto ? t.auto(d) : 0; if (c > 0) out[t.key] = c }
  return out
}
export function roomsChosen(d: UnitDetails): Record<string, number> {
  if (d.rooms && typeof d.rooms === 'object') return d.rooms
  return defaultRooms(d)
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
  const chosen = roomsChosen(d)
  const out: RoomDef[] = []
  let s = 0
  // Room keys stay stable: the FIRST of a type keeps the bare key ('balcony', 'living') so a unit
  // walked before the room picker existed still lines up; extras are 'balcony_2', 'terrace_2'…
  const push = (group: RoomType['group']) => {
    for (const t of ROOM_TYPES) {
      if (t.group !== group) continue
      const c = Math.max(0, Math.min(6, Math.round(n(chosen[t.key]))))
      for (let i = 1; i <= c; i++) out.push({ key: i === 1 ? t.key : t.key + '_' + i, name: t.key === 'living' && beds === 0 ? 'Studio living area' : t.label + (c > 1 ? ' ' + i : ''), kind: t.kind, sort: s++ })
    }
  }
  push('entry'); push('living')
  // No kitchen still gets a "Kitchen corner": a mini fridge, a microwave and a coffee maker are the
  // must-haves of a unit with no kitchen (Jon: "no kitchen but might have mini fridge, maybe microwave").
  out.push({ key: 'kitchen', name: d.kitchen === 'none' ? 'Kitchen corner' : d.kitchen === 'kitchenette' ? 'Kitchenette' : 'Kitchen', kind: 'kitchen', sort: s++ })
  push('dining')
  if (beds >= 1) out.push({ key: 'master_bedroom', name: 'Master bedroom', kind: 'bedroom', sort: s++ })
  if (beds >= 1 && fullBaths >= 1) out.push({ key: 'master_bath', name: 'Master bath', kind: 'bathroom', sort: s++ })
  for (let i = 2; i <= beds; i++) out.push({ key: 'bedroom_' + i, name: 'Bedroom ' + ordinal(i), kind: 'bedroom', sort: s++ })
  // Studio: the one bath is simply "Bathroom". Otherwise bath 2..n after the master bath.
  if (beds === 0 && fullBaths >= 1) out.push({ key: 'bathroom_1', name: 'Bathroom', kind: 'bathroom', sort: s++ })
  for (let i = 2; i <= fullBaths; i++) out.push({ key: 'bathroom_' + i, name: (beds >= 1 && i === 2 ? 'Guest bathroom' : 'Bathroom ' + ordinal(i)), kind: 'bathroom', sort: s++ })
  if (halfBath) out.push({ key: 'half_bath', name: 'Half bath', kind: 'bathroom', sort: s++ })
  push('outdoor'); push('service')
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
  only?: 'full' | 'kitchenette' | 'nokitchen' | 'haskitchen' | 'master' | 'nonmaster' | 'sleeper' | 'fullbath' | 'halfbath' | 'studio'
  tier?: Tier                 // must (default) | recommended | suggested — how the form groups it
  appliance?: ApplianceKey    // included only when the unit's appliance list has it
  perBed?: boolean            // bedroom rows: one per bed, sized (brand = King / Queen / Twin…)
}
export type InventoryStandard = Partial<Record<RoomKind, StandardItem[]>>
export const STANDARD_KEY = 'onboarding_standard'
export const ONLY_LABEL: Record<NonNullable<StandardItem['only']>, string> = {
  full: 'full kitchen', kitchenette: 'kitchenette', nokitchen: 'no kitchen', haskitchen: 'any kitchen or kitchenette', master: 'master bedroom only', nonmaster: 'other bedrooms only',
  sleeper: 'if sleeper sofa', fullbath: 'full bath only', halfbath: 'half bath only', studio: 'studio only',
}

const F = (name: string, category: Category, qty: number, extra: Partial<StandardItem> = {}): StandardItem => ({ name, category, qty, ...extra })
const G = (name: string, category: Category, per: number, extra: Partial<StandardItem> = {}): StandardItem => ({ name, category, qty: per, perGuest: true, ...extra })

// R = recommended, S = nice to have; F/G default to must-have.
const R = (it: StandardItem): StandardItem => ({ ...it, tier: 'recommended' })
const S = (it: StandardItem): StandardItem => ({ ...it, tier: 'suggested' })

// HOW TO READ THIS LIST (the onboarder's checklist, Jon 2026-09-03):
//   MUST HAVE     what a guest expects to find in a unit of this shape — and what we will not list
//                 without. If there is a kitchen: the fridge, the stove, the microwave, the coffee
//                 maker, pots, pans, knives, a full table setting. If there is a bed: sheets, pillows,
//                 a protector. If there is a shower: towels, a mat, a hair dryer. Conditional on the
//                 feature (`only`), never optional once the feature exists.
//   RECOMMENDED   what a good listing has and a guest may ask for — blender, toaster, kettle, a
//                 second pan, a dresser, a rug.
//   NICE TO HAVE  what separates a great listing — board games, an espresso machine, beach towels.
// COUNTS: 2 × max guests on anything a guest uses at a meal or a shower (one in use, one in the wash),
// floor 8 / cap 24; one per unit for the rest; per bed, sized, for anything on a bed.
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
    // ── MUST HAVE — if there is a kitchen, these are in it ──
    // appliances by kitchen type
    F('Refrigerator', 'appliance', 1, { only: 'full', brand: 'model' }), F('Stove / oven', 'appliance', 1, { only: 'full', brand: 'model' }), F('Dishwasher', 'appliance', 1, { only: 'full', brand: 'model' }),
    F('Mini fridge', 'appliance', 1, { only: 'kitchenette', brand: 'model' }), F('Cooktop', 'appliance', 1, { only: 'kitchenette', brand: 'model' }),
    F('Mini fridge', 'appliance', 1, { only: 'nokitchen', brand: 'model' }),
    F('Microwave', 'appliance', 1, { brand: 'model' }), F('Coffee maker', 'appliance', 1, { brand: 'model' }),
    // table setting — 2 × max guests, counted piece by piece
    G('Dinner plates', 'kitchen', 2, { ...TWO, only: 'haskitchen' }), G('Salad / side plates', 'kitchen', 2, { ...TWO, only: 'haskitchen' }), G('Bowls', 'kitchen', 2, { ...TWO, only: 'haskitchen' }),
    G('Mugs', 'kitchen', 2, TWO), G('Water glasses', 'kitchen', 2, TWO), G('Wine glasses', 'kitchen', 2, { min: 6, max: 16, only: 'haskitchen' }),
    G('Forks', 'kitchen', 2, { ...TWO, only: 'haskitchen' }), G('Knives (table)', 'kitchen', 2, { ...TWO, only: 'haskitchen' }), G('Spoons (table)', 'kitchen', 2, { ...TWO, only: 'haskitchen' }), G('Teaspoons', 'kitchen', 2, { ...TWO, only: 'haskitchen' }),
    F('Serving spoons (big spoon)', 'kitchen', 3, { only: 'haskitchen' }), F('Serving forks', 'kitchen', 2, { only: 'haskitchen' }),
    // cookware & tools — you can cook a meal with only these
    F('Frying pan 10in non-stick', 'kitchen', 1, { only: 'haskitchen' }), F('Saucepan 3qt w/ lid', 'kitchen', 1, { only: 'haskitchen' }), F('Stock pot 8qt w/ lid', 'kitchen', 1, { only: 'full' }), F('Baking sheet', 'kitchen', 1, { only: 'full' }),
    F("Chef's knife", 'kitchen', 1, { only: 'haskitchen' }), F('Paring knife', 'kitchen', 1, { only: 'haskitchen' }), F('Cutting boards', 'kitchen', 2, { only: 'haskitchen' }),
    F('Spatula', 'kitchen', 2, { only: 'haskitchen' }), F('Wooden spoon', 'kitchen', 2, { only: 'haskitchen' }), F('Tongs', 'kitchen', 1, { only: 'haskitchen' }), F('Mixing bowls', 'kitchen', 3, { only: 'haskitchen' }), F('Colander / strainer', 'kitchen', 1, { only: 'haskitchen' }),
    F('Can opener', 'kitchen', 1, { only: 'haskitchen' }), F('Wine / bottle opener', 'kitchen', 1), F('Oven mitts', 'kitchen', 2, { only: 'haskitchen' }), F('Kitchen towels', 'linen', 4, { only: 'haskitchen' }),
    F('Dish rack', 'kitchen', 1, { only: 'haskitchen' }), F('Trash can', 'other', 1), F('Fire extinguisher', 'safety', 1, { only: 'haskitchen' }),
    // ── RECOMMENDED ──
    R(F('Toaster', 'appliance', 1, { only: 'haskitchen', brand: 'model' })), R(F('Kettle', 'appliance', 1, { brand: 'model' })), R(F('Blender', 'appliance', 1, { only: 'haskitchen', brand: 'model' })), R(F('Garbage disposal', 'appliance', 1, { only: 'full' })),
    R(F('Frying pan 8in', 'kitchen', 1, { only: 'haskitchen' })), R(F('Saucepan 1.5qt w/ lid', 'kitchen', 1, { only: 'haskitchen' })), R(F('Sauté pan 4qt w/ lid', 'kitchen', 1, { only: 'full' })),
    R(F('Baking dish 9x13', 'kitchen', 1, { only: 'full' })), R(F('Bread knife', 'kitchen', 1, { only: 'haskitchen' })), R(F('Slotted spoon', 'kitchen', 1, { only: 'haskitchen' })), R(F('Ladle', 'kitchen', 1, { only: 'haskitchen' })),
    R(F('Whisk', 'kitchen', 1, { only: 'haskitchen' })), R(F('Kitchen shears', 'kitchen', 1, { only: 'haskitchen' })), R(F('Measuring cups set', 'kitchen', 1, { only: 'haskitchen' })), R(F('Measuring spoons set', 'kitchen', 1, { only: 'haskitchen' })),
    R(F('Peeler', 'kitchen', 1, { only: 'haskitchen' })), R(F('Grater', 'kitchen', 1, { only: 'haskitchen' })), R(F('Steak knives', 'kitchen', 6, { only: 'haskitchen' })), R(G('Kids plastic cups / plates', 'kitchen', 1, { min: 4, max: 8, only: 'haskitchen' })),
    R(F('Serving bowls', 'kitchen', 2, { only: 'haskitchen' })), R(F('Serving platters', 'kitchen', 2, { only: 'haskitchen' })), R(F('Food storage containers', 'kitchen', 6, { only: 'haskitchen' })), R(F('Trivets', 'kitchen', 2, { only: 'haskitchen' })),
    R(F('Paper towel holder', 'other', 1)), R(F('Salt & pepper shakers', 'kitchen', 1, { only: 'haskitchen' })), R(F('Recycling bin', 'other', 1)), R(F('Cleaning supplies caddy', 'other', 1)), R(F('Bar stools', 'furniture', 2, { only: 'full' })),
    // ── NICE TO HAVE ──
    S(F('Espresso / Nespresso machine', 'appliance', 1)), S(F('Air fryer', 'appliance', 1, { only: 'full' })), S(F('Wine fridge', 'appliance', 1, { only: 'full' })), S(F('Ice maker', 'appliance', 1)),
    S(F('Rice cooker', 'appliance', 1, { only: 'full' })), S(F('Slow cooker / Instant Pot', 'appliance', 1, { only: 'full' })), S(F('Coffee grinder', 'appliance', 1)),
    S(F('Muffin pan', 'kitchen', 1, { only: 'full' })), S(F('Pizza cutter', 'kitchen', 1, { only: 'haskitchen' })), S(F('Potato masher', 'kitchen', 1, { only: 'haskitchen' })), S(F('Cooking thermometer', 'kitchen', 1, { only: 'full' })),
    S(F('Pitcher', 'kitchen', 1)), S(F('Cocktail shaker set', 'kitchen', 1)), S(F('Knife block / magnet', 'kitchen', 1, { only: 'haskitchen' })), S(F('Spice rack (basics)', 'kitchen', 1, { only: 'haskitchen' })),
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
  office: [
    F('Desk', 'furniture', 1), F('Desk chair', 'furniture', 1), F('Desk lamp', 'decor', 1), F('Power strip / outlets at desk', 'electronics', 1),
    R(F('Monitor', 'electronics', 1, { brand: 'size' })), R(F('Bookshelf', 'furniture', 1)), R(F('Wall art', 'decor', 1)), R(F('Rug', 'decor', 1)),
    S(F('Printer', 'electronics', 1)), S(F('Whiteboard', 'other', 1)), S(F('Sleeper sofa / daybed', 'furniture', 1)),
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
  const kitchen = d.kitchen || 'full'
  // A studio's bed lives in the living area: the bedroom standard's per-bed rows (frame, mattress,
  // sheets, pillows…) join the living room list so the walker counts them where they stand.
  const studioLiving = room.kind === 'living' && beds === 0
  const rows: StandardItem[] = [
    ...(standard[room.kind] || DEFAULT_STANDARD[room.kind] || []),
    ...(studioLiving ? (standard.bedroom || DEFAULT_STANDARD.bedroom || []).filter(r => r.perBed || /nightstand|bedside lamp|hangers/i.test(r.name)) : []),
  ]
  const out: ItemDef[] = []
  for (const it of rows) {
    // Older saved standards may still carry appliance-keyed rows: treat them as plain rows gated by `only`.
    switch (it.only) {
      case 'full': if (kitchen !== 'full') continue; break
      case 'kitchenette': if (kitchen !== 'kitchenette') continue; break
      case 'nokitchen': if (kitchen !== 'none') continue; break
      case 'haskitchen': if (kitchen === 'none') continue; break
      case 'master': if (!master) continue; break
      case 'nonmaster': if (master) continue; break
      case 'sleeper': if (!sleeper) continue; break
      case 'fullbath': if (half) continue; break
      case 'halfbath': if (!half) continue; break
      case 'studio': if (beds !== 0) continue; break
    }
    if (room.kind === 'living' && sleeper && it.name === 'Sofa') continue          // the sleeper IS the sofa
    if (it.perBed && (room.kind === 'bedroom' || studioLiving)) {
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

export const ROOM_KIND_LABEL: Record<RoomKind, string> = { entry: 'Entry', living: 'Living', kitchen: 'Kitchen', dining: 'Dining', bedroom: 'Bedroom', bathroom: 'Bathroom', balcony: 'Outdoor', laundry: 'Laundry', office: 'Office', other: 'Other' }

/** One-line summary of the quick section for headers and exports. */
export function describeUnit(d: UnitDetails): string {
  const parts: string[] = []
  const b = n(d.bedrooms, -1); if (b >= 0) parts.push(b === 0 ? 'Studio' : b + ' BR')
  const ba = n(d.bathrooms, -1); if (ba > 0) parts.push(ba + ' BA')
  if (n(d.occupancy) > 0) parts.push('sleeps ' + n(d.occupancy))
  if (d.beds) { const all = Object.values(d.beds).flat(); if (all.length) { const c: Record<string, number> = {}; for (const x of all) c[x] = (c[x] || 0) + 1; parts.push(Object.entries(c).map(([k, v]) => (v > 1 ? v + ' ' : '') + bedLabel(k as BedSize)).join(' + ')) } }
  const ch = roomsChosen(d)
  for (const t of ROOM_TYPES) { const c = Math.round(n(ch[t.key])); if (c > 0 && !['entry', 'living', 'dining', 'laundry'].includes(t.key)) parts.push((c > 1 ? c + ' ' : '') + t.label.toLowerCase().replace(/ \/.*$/, '') + (c > 1 && t.countable ? 's' : '')) }
  if (d.washerDryer === 'in_unit') parts.push('W/D in unit'); else if (d.washerDryer === 'shared') parts.push('shared laundry')
  if (n(d.sleeperSofa) > 0) parts.push(n(d.sleeperSofa) + ' sleeper sofa' + (n(d.sleeperSofa) > 1 ? 's' : ''))
  if (d.kitchen === 'kitchenette') parts.push('kitchenette'); else if (d.kitchen === 'none') parts.push('no kitchen')
  return parts.join(' · ')
}

// ── ROOM QUESTIONS — ask before assuming ─────────────────────────────────────────────────────────
// Jon, 2026-09-03: "the test one has too much going on — it should ask pre-questions before assuming
// items." So a room opens with three to five quick questions and the list is BUILT from the answers:
// no TV → no TV, remote, streaming device; a 6-seat table → 6 chairs; a curtain shower → curtain +
// liner, not a glass door. Answers live on the room (`onboarding_rooms.answers`, migration 066).
export type RoomQuestion =
  | { key: string; label: string; type: 'yn'; default: boolean }
  | { key: string; label: string; type: 'count'; default: number; max: number; unit?: string }
  | { key: string; label: string; type: 'choice'; default: string; options: { v: string; l: string }[] }
  | { key: string; label: string; type: 'multi'; default: string[]; options: { v: string; l: string }[] }
export type RoomAnswers = Record<string, any>

const APPL = (v: string, l = v) => ({ v, l })
export const KITCHEN_APPLIANCE_OPTIONS = [
  APPL('Refrigerator', 'Full fridge'), APPL('Mini fridge'), APPL('Stove / oven', 'Stove / oven'), APPL('Cooktop', 'Cooktop only'), APPL('Microwave'), APPL('Dishwasher'),
  APPL('Coffee maker'), APPL('Toaster'), APPL('Kettle'), APPL('Blender'), APPL('Garbage disposal', 'Disposal'), APPL('Espresso / Nespresso machine', 'Espresso'),
  APPL('Air fryer'), APPL('Wine fridge'), APPL('Ice maker'), APPL('Rice cooker'), APPL('Slow cooker / Instant Pot', 'Slow cooker'), APPL('Coffee grinder'),
]
const KITCHEN_APPLIANCE_NAMES = new Set(KITCHEN_APPLIANCE_OPTIONS.map(o => o.v))

export function roomQuestions(room: RoomDef, d: UnitDetails): RoomQuestion[] {
  const kitchen = d.kitchen || 'full'
  switch (room.kind) {
    case 'entry': return [
      { key: 'coats', label: 'Coat storage', type: 'choice', default: 'hooks', options: [{ v: 'hooks', l: 'Hooks / rack' }, { v: 'closet', l: 'Closet' }, { v: 'none', l: 'None' }] },
      { key: 'console', label: 'Console table', type: 'yn', default: true },
      { key: 'mirror', label: 'Mirror', type: 'yn', default: true },
    ]
    case 'living': return [
      { key: 'tv', label: 'TV in this room', type: 'yn', default: true },
      { key: 'sleeper', label: 'Sofa is a sleeper', type: 'yn', default: Math.round(n(d.sleeperSofa)) > 0 },
      { key: 'armchairs', label: 'Armchairs', type: 'count', default: 1, max: 4 },
      { key: 'lamps', label: 'Lamps', type: 'count', default: 2, max: 6 },
      { key: 'rug', label: 'Rug', type: 'yn', default: true },
    ]
    case 'kitchen': return [
      { key: 'appliances', label: 'Appliances in the ' + (kitchen === 'none' ? 'unit' : 'kitchen'), type: 'multi',
        default: kitchen === 'full' ? ['Refrigerator', 'Stove / oven', 'Dishwasher', 'Microwave', 'Coffee maker', 'Toaster', 'Kettle', 'Blender']
          : kitchen === 'kitchenette' ? ['Mini fridge', 'Cooktop', 'Microwave', 'Coffee maker', 'Toaster', 'Kettle'] : ['Mini fridge', 'Microwave', 'Coffee maker'],
        options: KITCHEN_APPLIANCE_OPTIONS },
      { key: 'barstools', label: 'Bar / counter stools', type: 'count', default: kitchen === 'full' ? 2 : 0, max: 8 },
    ]
    case 'dining': return [
      { key: 'seats', label: 'Seats at the table', type: 'count', default: Math.max(2, Math.min(10, Math.round(n(d.occupancy, 4)))), max: 12 },
      { key: 'highchair', label: 'High chair', type: 'yn', default: false },
    ]
    case 'bedroom': return [
      { key: 'tv', label: 'TV in this room', type: 'yn', default: room.key === 'master_bedroom' },
      { key: 'closet', label: 'Closet', type: 'choice', default: 'closet', options: [{ v: 'closet', l: 'Closet' }, { v: 'wardrobe', l: 'Wardrobe / armoire' }, { v: 'none', l: 'None' }] },
      { key: 'desk', label: 'Desk / workspace', type: 'yn', default: false },
      { key: 'nightstands', label: 'Nightstands', type: 'count', default: 2, max: 4 },
    ]
    case 'bathroom': return room.key === 'half_bath' ? [
      { key: 'storage', label: 'Shelving / storage', type: 'yn', default: false },
    ] : [
      { key: 'bath', label: 'Shower / tub', type: 'choice', default: 'shower', options: [{ v: 'shower', l: 'Shower' }, { v: 'tub', l: 'Tub' }, { v: 'both', l: 'Tub + shower' }] },
      { key: 'door', label: 'Shower enclosure', type: 'choice', default: 'glass', options: [{ v: 'glass', l: 'Glass door' }, { v: 'curtain', l: 'Curtain' }, { v: 'none', l: 'Open / none' }] },
      { key: 'hairdryer', label: 'Hair dryer', type: 'yn', default: true },
      { key: 'storage', label: 'Shelving / storage', type: 'yn', default: true },
    ]
    case 'balcony': return [
      { key: 'seats', label: 'Chairs', type: 'count', default: 2, max: 8 },
      { key: 'table', label: 'Table', type: 'yn', default: true },
      { key: 'lounge', label: 'Lounge chairs', type: 'count', default: 0, max: 6 },
      { key: 'grill', label: 'Grill', type: 'yn', default: false },
    ]
    case 'laundry': return [
      { key: 'machines', label: 'Machines', type: 'choice', default: 'separate', options: [{ v: 'separate', l: 'Washer + dryer' }, { v: 'combo', l: 'Washer/dryer combo' }, { v: 'none', l: 'None here' }] },
      { key: 'iron', label: 'Iron & board here', type: 'yn', default: false },
    ]
    case 'office': return [
      { key: 'monitor', label: 'Monitor', type: 'yn', default: false },
      { key: 'printer', label: 'Printer', type: 'yn', default: false },
    ]
    default: return []
  }
}

/** Fill the defaults for anything unanswered, so the generator never sees a hole. */
export function fullAnswers(room: RoomDef, d: UnitDetails, a: RoomAnswers | null | undefined): RoomAnswers {
  const out: RoomAnswers = {}
  for (const q of roomQuestions(room, d)) out[q.key] = a && a[q.key] !== undefined && a[q.key] !== null ? a[q.key] : q.default
  return out
}

/** The standard's list for this room, trimmed and sized by the answers. */
export function applyAnswers(items: ItemDef[], room: RoomDef, d: UnitDetails, a: RoomAnswers): ItemDef[] {
  const yes = (k: string) => a[k] === true
  const cnt = (k: string) => Math.max(0, Math.round(n(a[k])))
  const out: ItemDef[] = []
  const drop = (re: RegExp) => (it: ItemDef) => !re.test(it.name)
  let list = items.slice()
  switch (room.kind) {
    case 'entry':
      if (a.coats === 'none') list = list.filter(drop(/coat/i))
      if (a.coats === 'closet') list = list.map(it => /coat hooks/i.test(it.name) ? { ...it, name: 'Coat closet hangers', qty: 6, category: 'other' as Category } : it)
      if (!yes('console')) list = list.filter(drop(/console table/i))
      if (!yes('mirror')) list = list.filter(drop(/^mirror$/i))
      break
    case 'living':
      if (!yes('tv')) list = list.filter(drop(/\bTV\b|streaming/i))
      if (!yes('sleeper')) list = list.filter(drop(/sleeper/i)); else list = list.filter(drop(/^Sofa$/))
      list = list.filter(drop(/^Sleeper sofa$/))
      if (yes('sleeper')) {
        list.unshift({ name: 'Sleeper sofa', category: 'furniture', qty: 1, tier: 'must' })
        if (!list.some(it => /sleeper sofa bedding/i.test(it.name))) list.push({ name: 'Sleeper sofa bedding set', category: 'linen', qty: 1, tier: 'must' }, { name: 'Sleeper sofa pillows', category: 'linen', qty: 2, tier: 'must' })
      }
      list = list.map(it => /^Armchair$/i.test(it.name) ? { ...it, qty: cnt('armchairs') } : /floor \/ table lamp/i.test(it.name) ? { ...it, qty: cnt('lamps') } : it).filter(it => it.qty > 0 || !/armchair|lamp/i.test(it.name))
      if (!yes('rug')) list = list.filter(drop(/^rug$/i))
      break
    case 'kitchen': {
      const have = new Set<string>(Array.isArray(a.appliances) ? a.appliances : [])
      list = list.filter(it => !KITCHEN_APPLIANCE_NAMES.has(it.name) || have.has(it.name))
      // Anything ticked that the standard did not carry for this kitchen type still gets a line.
      have.forEach(nm => { if (!list.some(it => it.name === nm)) list.push({ name: nm, category: 'appliance', qty: 1, brand: 'model', tier: 'must' }) })
      const stools = cnt('barstools')
      list = list.map(it => /bar stools/i.test(it.name) ? { ...it, qty: stools } : it).filter(it => !/bar stools/i.test(it.name) || stools > 0)
      break
    }
    case 'dining':
      list = list.map(it => /dining chairs/i.test(it.name) ? { ...it, qty: cnt('seats') } : /placemats/i.test(it.name) ? { ...it, qty: Math.max(it.qty, cnt('seats')) } : it)
      if (!yes('highchair')) list = list.filter(drop(/high chair/i))
      break
    case 'bedroom':
      if (!yes('tv')) list = list.filter(drop(/\bTV\b/i))
      if (a.closet === 'none') list = list.filter(drop(/hangers/i))
      if (a.closet === 'wardrobe' && !list.some(it => /wardrobe/i.test(it.name))) list.push({ name: 'Wardrobe / armoire', category: 'furniture', qty: 1, tier: 'must' })
      if (yes('desk')) list.push({ name: 'Desk', category: 'furniture', qty: 1, tier: 'must' }, { name: 'Desk chair', category: 'furniture', qty: 1, tier: 'must' })
      list = list.map(it => /^Nightstands$/i.test(it.name) ? { ...it, qty: cnt('nightstands') } : /^Bedside lamps$/i.test(it.name) ? { ...it, qty: cnt('nightstands') } : it).filter(it => it.qty > 0 || !/nightstand|bedside/i.test(it.name))
      break
    case 'bathroom':
      if (room.key !== 'half_bath') {
        if (a.bath === 'shower') list = list.filter(drop(/bath mat/i)).concat([{ name: 'Shower mat', category: 'linen', qty: 1, tier: 'must' }])
        if (a.door === 'curtain') list = list.map(it => /shower curtain \/ glass door/i.test(it.name) ? { ...it, name: 'Shower curtain' } : it)
        else if (a.door === 'glass') list = list.filter(drop(/shower liner/i)).map(it => /shower curtain \/ glass door/i.test(it.name) ? { ...it, name: 'Glass shower door' } : it)
        else list = list.filter(drop(/shower curtain|shower liner/i))
        if (!yes('hairdryer')) list = list.filter(drop(/hair dryer/i))
      }
      if (!yes('storage')) list = list.filter(drop(/shelving/i))
      break
    case 'balcony':
      list = list.map(it => /outdoor chairs/i.test(it.name) ? { ...it, qty: cnt('seats') } : /outdoor cushions/i.test(it.name) ? { ...it, qty: cnt('seats') } : /lounge chair/i.test(it.name) ? { ...it, qty: cnt('lounge'), tier: cnt('lounge') ? 'must' : it.tier } : it)
        .filter(it => it.qty > 0 || !/chairs|cushions|lounge/i.test(it.name))
      if (!yes('table')) list = list.filter(drop(/outdoor table/i))
      if (yes('grill')) list.push({ name: 'Grill', category: 'appliance', qty: 1, brand: 'model', tier: 'must' }, { name: 'Grill tools', category: 'other', qty: 1, tier: 'must' })
      break
    case 'laundry':
      if (a.machines === 'none') list = list.filter(drop(/^washer$|^dryer$/i))
      if (a.machines === 'combo') list = list.filter(drop(/^dryer$/i)).map(it => /^washer$/i.test(it.name) ? { ...it, name: 'Washer / dryer combo' } : it)
      if (yes('iron')) list = list.map(it => /^Iron$/i.test(it.name) ? { ...it, name: 'Iron & ironing board', tier: 'must' as Tier } : it)
      break
    case 'office':
      if (!yes('monitor')) list = list.filter(drop(/monitor/i))
      if (!yes('printer')) list = list.filter(drop(/printer/i))
      break
  }
  for (const it of list) if (!out.some(o => o.name === it.name && o.brand === it.brand)) out.push(it)
  return out
}

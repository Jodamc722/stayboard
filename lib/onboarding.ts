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
  parking?: 'none' | 'assigned' | 'garage' | 'street'
  floor?: string
  sqft?: number
  kingBeds?: number
  pool?: boolean
  gym?: boolean
  notes?: string
}

export type RoomDef = { key: string; name: string; kind: RoomKind; sort: number }
export type ItemDef = { name: string; category: Category; qty: number; brand?: string }

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
  if (d.kitchen !== 'none') out.push({ key: 'kitchen', name: d.kitchen === 'kitchenette' ? 'Kitchenette' : 'Kitchen', kind: 'kitchen', sort: s++ })
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
  only?: 'full' | 'kitchenette' | 'master' | 'nonmaster' | 'sleeper' | 'fullbath' | 'halfbath' | 'studio'
}
export type InventoryStandard = Partial<Record<RoomKind, StandardItem[]>>
export const STANDARD_KEY = 'onboarding_standard'
export const ONLY_LABEL: Record<NonNullable<StandardItem['only']>, string> = {
  full: 'full kitchen only', kitchenette: 'kitchenette only', master: 'master bedroom only', nonmaster: 'other bedrooms only',
  sleeper: 'if sleeper sofa', fullbath: 'full bath only', halfbath: 'half bath only', studio: 'studio only',
}

const F = (name: string, category: Category, qty: number, extra: Partial<StandardItem> = {}): StandardItem => ({ name, category, qty, ...extra })
const G = (name: string, category: Category, per: number, extra: Partial<StandardItem> = {}): StandardItem => ({ name, category, qty: per, perGuest: true, ...extra })

export const DEFAULT_STANDARD: InventoryStandard = {
  entry: [
    F('Smart lock / keypad', 'safety', 1), F('Smoke / CO detector', 'safety', 1), F('Fire extinguisher', 'safety', 1),
    F('First-aid kit', 'safety', 1), F('Flashlight', 'safety', 1), F('Console table', 'furniture', 1), F('Mirror', 'decor', 1),
    F('Coat hooks / rack', 'furniture', 1), F('Doormat', 'decor', 1), F('Wi-Fi router', 'electronics', 1), F('Luggage rack', 'furniture', 1),
  ],
  living: [
    F('Sofa', 'furniture', 1), F('Sleeper sofa', 'furniture', 1, { only: 'sleeper' }), F('Sleeper sofa bedding set', 'linen', 1, { only: 'sleeper' }),
    F('Sleeper sofa pillows', 'linen', 2, { only: 'sleeper' }), F('Armchair', 'furniture', 1), F('Coffee table', 'furniture', 1), F('Side table', 'furniture', 2),
    F('TV', 'electronics', 1, { brand: 'size' }), F('TV stand / console', 'furniture', 1), F('TV remote', 'electronics', 1), F('Streaming device', 'electronics', 1),
    F('Floor / table lamp', 'decor', 2), F('Rug', 'decor', 1), F('Curtains / blinds', 'decor', 1), F('Throw pillows', 'decor', 4), F('Throw blanket', 'linen', 1),
    F('Wall art', 'decor', 2), F('A/C thermostat', 'appliance', 1), F('Board games / books', 'other', 3), F('Charging station / USB', 'electronics', 1),
  ],
  kitchen: [
    // appliances
    F('Refrigerator', 'appliance', 1), F('Stove / oven', 'appliance', 1, { only: 'full' }), F('Dishwasher', 'appliance', 1, { only: 'full' }), F('Cooktop', 'appliance', 1, { only: 'kitchenette' }),
    F('Microwave', 'appliance', 1), F('Coffee maker', 'appliance', 1), F('Toaster', 'appliance', 1), F('Kettle', 'appliance', 1), F('Blender', 'appliance', 1),
    // dinnerware — 2× occupancy (Vacasa / AvantStay)
    G('Dinner plates', 'kitchen', 2, { min: 8, max: 24 }), G('Salad / side plates', 'kitchen', 2, { min: 8, max: 24 }), G('Bowls', 'kitchen', 2, { min: 8, max: 24 }),
    G('Mugs', 'kitchen', 2, { min: 8, max: 24 }), G('Water glasses', 'kitchen', 1, { plus: 4, min: 8, max: 24 }), G('Wine glasses', 'kitchen', 1, { plus: 2, min: 6, max: 16 }),
    F('Kids plastic cups / plates', 'kitchen', 4),
    // flatware — 2× occupancy, counted individually
    G('Forks', 'kitchen', 2, { min: 8, max: 24 }), G('Knives (table)', 'kitchen', 2, { min: 8, max: 24 }), G('Spoons (table)', 'kitchen', 2, { min: 8, max: 24 }),
    G('Teaspoons', 'kitchen', 2, { min: 8, max: 24 }), F('Steak knives', 'kitchen', 6), F('Serving spoons (big spoon)', 'kitchen', 3), F('Serving forks', 'kitchen', 2),
    // cookware
    F('Frying pan 10in non-stick', 'kitchen', 1), F('Frying pan 8in', 'kitchen', 1), F('Saucepan 1.5qt w/ lid', 'kitchen', 1), F('Saucepan 3qt w/ lid', 'kitchen', 1),
    F('Stock pot 8qt w/ lid', 'kitchen', 1, { only: 'full' }), F('Sauté pan 4qt w/ lid', 'kitchen', 1, { only: 'full' }), F('Baking sheets', 'kitchen', 2, { only: 'full' }),
    F('Baking dish 9x13', 'kitchen', 1, { only: 'full' }), F('Muffin pan', 'kitchen', 1, { only: 'full' }), F('Mixing bowls', 'kitchen', 3), F('Colander / strainer', 'kitchen', 1),
    // utensils & tools
    F("Chef's knife", 'kitchen', 1), F('Paring knife', 'kitchen', 1), F('Bread knife', 'kitchen', 1), F('Cutting boards', 'kitchen', 2), F('Spatula', 'kitchen', 2),
    F('Wooden spoon', 'kitchen', 2), F('Slotted spoon', 'kitchen', 1), F('Ladle', 'kitchen', 1), F('Tongs', 'kitchen', 1), F('Whisk', 'kitchen', 1), F('Kitchen shears', 'kitchen', 1),
    F('Can opener', 'kitchen', 1), F('Wine / bottle opener', 'kitchen', 1), F('Measuring cups set', 'kitchen', 1), F('Measuring spoons set', 'kitchen', 1), F('Peeler', 'kitchen', 1),
    F('Grater', 'kitchen', 1), F('Pizza cutter', 'kitchen', 1), F('Oven mitts', 'kitchen', 2), F('Trivets', 'kitchen', 2), F('Serving bowls', 'kitchen', 2), F('Serving platters', 'kitchen', 2),
    F('Food storage containers', 'kitchen', 6), F('Kitchen towels', 'linen', 4), F('Paper towel holder', 'other', 1), F('Salt & pepper shakers', 'kitchen', 1),
    // housekeeping
    F('Trash can', 'other', 1), F('Recycling bin', 'other', 1), F('Dish rack', 'kitchen', 1), F('Fire extinguisher', 'safety', 1), F('Cleaning supplies caddy', 'other', 1),
    F('Bar stools', 'furniture', 2),
  ],
  dining: [
    F('Dining table', 'furniture', 1), G('Dining chairs', 'furniture', 1, { min: 2, max: 10 }), F('Pendant / dining light', 'decor', 1),
    G('Placemats', 'kitchen', 1, { min: 4, max: 12 }), F('Coasters', 'kitchen', 6), F('Wall art', 'decor', 1), F('High chair', 'furniture', 0),
  ],
  bedroom: [
    F('Bed frame', 'furniture', 1, { brand: 'King', only: 'master' }), F('Bed frame', 'furniture', 1, { brand: 'Queen', only: 'nonmaster' }),
    F('Mattress', 'furniture', 1), F('Mattress protector', 'linen', 1), F('Headboard', 'furniture', 1), F('Nightstands', 'furniture', 2), F('Bedside lamps', 'decor', 2),
    F('Dresser', 'furniture', 1), F('TV', 'electronics', 1, { brand: 'size' }), F('TV remote', 'electronics', 1), F('Mirror', 'decor', 1), F('Blackout curtains', 'decor', 1),
    F('Pillows', 'linen', 4), F('Duvet / comforter', 'linen', 1), F('Duvet covers', 'linen', 2), F('Sheet sets', 'linen', 2), F('Pillowcases', 'linen', 4), F('Extra blanket', 'linen', 1),
    F('Hangers', 'other', 20), F('Rug', 'decor', 1), F('Wall art', 'decor', 1), F('Alarm clock / charger', 'electronics', 1), F('Luggage rack', 'furniture', 1, { only: 'nonmaster' }),
    F('Safe', 'safety', 1, { only: 'master' }), F('Iron & ironing board', 'other', 1, { only: 'master' }), F('Smoke detector', 'safety', 1),
  ],
  bathroom: [
    F('Hand towels', 'linen', 2), F('Soap dispenser', 'other', 1), F('Trash can', 'other', 1), F('Toilet brush', 'other', 1), F('Plunger', 'other', 1), F('Mirror', 'decor', 1),
    F('Toilet paper holder', 'other', 1), F('Towel bar / hooks', 'other', 1),
    // full bath — bath towels and washcloths at 2× occupancy live in the FIRST full bath so the
    // count is not multiplied by the number of bathrooms; every other full bath gets 4.
    G('Bath towels', 'linen', 2, { min: 4, max: 20, only: 'fullbath' }), G('Washcloths', 'linen', 2, { min: 4, max: 20, only: 'fullbath' }),
    F('Bath mat', 'linen', 1, { only: 'fullbath' }), F('Shower curtain / glass door', 'other', 1, { only: 'fullbath' }), F('Shower liner', 'other', 1, { only: 'fullbath' }),
    F('Hair dryer', 'appliance', 1, { only: 'fullbath' }), F('Shelving / storage', 'furniture', 1, { only: 'fullbath' }), F('Shower caddy', 'other', 1, { only: 'fullbath' }),
    F('Makeup towels (dark)', 'linen', 2, { only: 'fullbath' }),
  ],
  balcony: [
    F('Outdoor chairs', 'furniture', 2), F('Outdoor table', 'furniture', 1), F('Lounge chair', 'furniture', 0), F('Outdoor light', 'decor', 1), F('Planter', 'decor', 0), F('Outdoor cushions', 'decor', 2),
  ],
  laundry: [
    F('Washer', 'appliance', 1, { brand: 'model' }), F('Dryer', 'appliance', 1, { brand: 'model' }), F('Laundry basket', 'other', 1), F('Detergent', 'other', 1), F('Drying rack', 'other', 0),
    F('Vacuum', 'appliance', 1), F('Broom & dustpan', 'other', 1), F('Mop & bucket', 'other', 1), F('Iron', 'other', 0), F('Spare light bulbs', 'other', 4), F('Spare batteries', 'other', 4),
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
  const out: ItemDef[] = []
  for (const it of rows) {
    switch (it.only) {
      case 'full': if (d.kitchen === 'kitchenette') continue; break
      case 'kitchenette': if (d.kitchen !== 'kitchenette') continue; break
      case 'master': if (!master) continue; break
      case 'nonmaster': if (master) continue; break
      case 'sleeper': if (!sleeper) continue; break
      case 'fullbath': if (half) continue; break
      case 'halfbath': if (!half) continue; break
      case 'studio': if (beds !== 0) continue; break
    }
    if (room.kind === 'living' && sleeper && it.name === 'Sofa') continue          // the sleeper IS the sofa
    let qty = qtyFor(it, occ)
    if (it.only === 'sleeper' && !it.perGuest) qty = qty * sleeper                   // one bedding set per sleeper
    // Occupancy-scaled towels belong to ONE bathroom, not every bathroom: the others get a base of 4.
    if (room.kind === 'bathroom' && it.perGuest && !firstFullBath) qty = Math.min(qty, 4)
    out.push({ name: it.name, category: it.category, qty, brand: it.brand })
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
  if (n(d.balconies) > 0) parts.push(n(d.balconies) === 1 ? 'balcony' : n(d.balconies) + ' balconies')
  if (d.washerDryer === 'in_unit') parts.push('W/D in unit'); else if (d.washerDryer === 'shared') parts.push('shared laundry')
  if (n(d.sleeperSofa) > 0) parts.push(n(d.sleeperSofa) + ' sleeper sofa' + (n(d.sleeperSofa) > 1 ? 's' : ''))
  if (d.kitchen === 'kitchenette') parts.push('kitchenette')
  return parts.join(' · ')
}

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

/** The items a room of this kind is expected to hold — the walker confirms qty + condition. */
export function itemsFor(room: RoomDef, d: UnitDetails): ItemDef[] {
  const occ = Math.max(1, Math.round(n(d.occupancy, 4)))
  const place = Math.max(4, Math.min(12, occ))
  const master = room.key === 'master_bedroom'
  const sleeper = Math.max(0, Math.round(n(d.sleeperSofa)))
  switch (room.kind) {
    case 'entry': return [
      { name: 'Smart lock / keypad', category: 'safety', qty: 1 }, { name: 'Smoke / CO detector', category: 'safety', qty: 1 },
      { name: 'Fire extinguisher', category: 'safety', qty: 1 }, { name: 'Console table', category: 'furniture', qty: 1 },
      { name: 'Mirror', category: 'decor', qty: 1 }, { name: 'Coat hooks / rack', category: 'furniture', qty: 1 }, { name: 'Doormat', category: 'decor', qty: 1 },
      { name: 'Wi-Fi router', category: 'electronics', qty: 1 }, { name: 'Luggage rack', category: 'furniture', qty: 1 },
    ]
    case 'living': return [
      { name: sleeper ? 'Sleeper sofa' : 'Sofa', category: 'furniture', qty: sleeper || 1 },
      ...(sleeper ? [{ name: 'Sleeper sofa bedding set', category: 'linen' as Category, qty: sleeper }] : []),
      { name: 'Armchair', category: 'furniture', qty: 1 }, { name: 'Coffee table', category: 'furniture', qty: 1 }, { name: 'Side table', category: 'furniture', qty: 2 },
      { name: 'TV', category: 'electronics', qty: 1, brand: 'size' }, { name: 'TV stand / console', category: 'furniture', qty: 1 }, { name: 'TV remote', category: 'electronics', qty: 1 },
      { name: 'Floor / table lamp', category: 'decor', qty: 2 }, { name: 'Rug', category: 'decor', qty: 1 }, { name: 'Curtains / blinds', category: 'decor', qty: 1 },
      { name: 'Throw pillows', category: 'decor', qty: 4 }, { name: 'Wall art', category: 'decor', qty: 2 }, { name: 'A/C thermostat', category: 'appliance', qty: 1 },
    ]
    case 'kitchen': {
      const full = d.kitchen !== 'kitchenette'
      return [
        { name: 'Refrigerator', category: 'appliance', qty: 1 }, ...(full ? [{ name: 'Stove / oven', category: 'appliance' as Category, qty: 1 }, { name: 'Dishwasher', category: 'appliance' as Category, qty: 1 }] : [{ name: 'Cooktop', category: 'appliance' as Category, qty: 1 }]),
        { name: 'Microwave', category: 'appliance', qty: 1 }, { name: 'Coffee maker', category: 'appliance', qty: 1 }, { name: 'Toaster', category: 'appliance', qty: 1 },
        { name: 'Kettle', category: 'appliance', qty: 1 }, { name: 'Blender', category: 'appliance', qty: 1 },
        { name: 'Pots & pans set', category: 'kitchen', qty: 1 }, { name: 'Knife set', category: 'kitchen', qty: 1 }, { name: 'Cutting board', category: 'kitchen', qty: 1 },
        { name: 'Cooking utensils set', category: 'kitchen', qty: 1 }, { name: 'Bakeware', category: 'kitchen', qty: 1 },
        { name: 'Dinner plates', category: 'kitchen', qty: place }, { name: 'Bowls', category: 'kitchen', qty: place }, { name: 'Drinking glasses', category: 'kitchen', qty: place },
        { name: 'Wine glasses', category: 'kitchen', qty: Math.min(8, place) }, { name: 'Mugs', category: 'kitchen', qty: place }, { name: 'Silverware set', category: 'kitchen', qty: 1 },
        { name: 'Trash can', category: 'other', qty: 1 }, { name: 'Dish rack', category: 'kitchen', qty: 1 }, { name: 'Fire extinguisher', category: 'safety', qty: 1 },
        { name: 'Cleaning supplies caddy', category: 'other', qty: 1 }, { name: 'Bar stools', category: 'furniture', qty: 2 },
      ]
    }
    case 'dining': return [
      { name: 'Dining table', category: 'furniture', qty: 1 }, { name: 'Dining chairs', category: 'furniture', qty: Math.min(8, place) },
      { name: 'Pendant / dining light', category: 'decor', qty: 1 }, { name: 'Placemats', category: 'kitchen', qty: place }, { name: 'Wall art', category: 'decor', qty: 1 },
    ]
    case 'bedroom': return [
      { name: 'Bed frame', category: 'furniture', qty: 1, brand: master ? 'King' : 'Queen' }, { name: 'Mattress', category: 'furniture', qty: 1 }, { name: 'Mattress protector', category: 'linen', qty: 1 },
      { name: 'Headboard', category: 'furniture', qty: 1 }, { name: 'Nightstands', category: 'furniture', qty: 2 }, { name: 'Bedside lamps', category: 'decor', qty: 2 },
      { name: 'Dresser', category: 'furniture', qty: 1 }, { name: 'TV', category: 'electronics', qty: 1, brand: 'size' }, { name: 'Mirror', category: 'decor', qty: 1 },
      { name: 'Blackout curtains', category: 'decor', qty: 1 }, { name: 'Pillows', category: 'linen', qty: 4 }, { name: 'Duvet / comforter', category: 'linen', qty: 1 },
      { name: 'Sheet sets', category: 'linen', qty: 2 }, { name: 'Hangers', category: 'other', qty: 12 }, { name: 'Rug', category: 'decor', qty: 1 }, { name: 'Wall art', category: 'decor', qty: 1 },
      ...(master ? [{ name: 'Safe', category: 'safety' as Category, qty: 1 }, { name: 'Iron & ironing board', category: 'other' as Category, qty: 1 }] : []),
      { name: 'Smoke detector', category: 'safety', qty: 1 },
    ]
    case 'bathroom': {
      const half = room.key === 'half_bath'
      return [
        { name: 'Hand towels', category: 'linen', qty: 2 }, { name: 'Soap dispenser', category: 'other', qty: 1 }, { name: 'Trash can', category: 'other', qty: 1 },
        { name: 'Toilet brush', category: 'other', qty: 1 }, { name: 'Plunger', category: 'other', qty: 1 }, { name: 'Mirror', category: 'decor', qty: 1 },
        ...(half ? [] : [
          { name: 'Bath towels', category: 'linen' as Category, qty: 4 }, { name: 'Bath mat', category: 'linen' as Category, qty: 1 }, { name: 'Shower curtain / glass door', category: 'other' as Category, qty: 1 },
          { name: 'Hair dryer', category: 'appliance' as Category, qty: 1 }, { name: 'Shelving / storage', category: 'furniture' as Category, qty: 1 }, { name: 'Shower caddy', category: 'other' as Category, qty: 1 },
        ]),
      ]
    }
    case 'balcony': return [
      { name: 'Outdoor chairs', category: 'furniture', qty: 2 }, { name: 'Outdoor table', category: 'furniture', qty: 1 }, { name: 'Lounge chair', category: 'furniture', qty: 0 },
      { name: 'Outdoor light', category: 'decor', qty: 1 }, { name: 'Planter', category: 'decor', qty: 0 },
    ]
    case 'laundry': return [
      { name: 'Washer', category: 'appliance', qty: 1, brand: 'model' }, { name: 'Dryer', category: 'appliance', qty: 1, brand: 'model' }, { name: 'Laundry basket', category: 'other', qty: 1 },
      { name: 'Detergent', category: 'other', qty: 1 }, { name: 'Drying rack', category: 'other', qty: 0 }, { name: 'Vacuum', category: 'appliance', qty: 1 }, { name: 'Broom & mop', category: 'other', qty: 1 },
    ]
    default: return []
  }
}

/** A short code for the link — 12 hex, unguessable enough for a capability URL, short enough to read aloud. */
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

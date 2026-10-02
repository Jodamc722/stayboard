// QUICK ONBOARDING — the shape of one unit's card (Jon, 2026-10-02: "simple, clean, multi units …
// bed count and sizes, room number, bathrooms, kitchen (coffee maker yes), utensils (no), stove,
// refrigerator yes, freezer yes … add photos, does not have to be so robust").
//
// No imports, so the page and the API share it and a test can read it bare. Every feature is a
// tri-state: unanswered, yes, no — the form is a wall of taps, not a wall of fields. The groups
// below ARE the form; adding a line here adds it to every unit's card.
export const BED_TYPES = [
  { key: 'king', label: 'King' }, { key: 'queen', label: 'Queen' }, { key: 'full', label: 'Full' }, { key: 'twin', label: 'Twin' },
  { key: 'sofa', label: 'Sofa bed' }, { key: 'bunk', label: 'Bunk' }, { key: 'crib', label: 'Crib' },
] as const
export type BedKey = typeof BED_TYPES[number]['key']

export type Tri = 'yes' | 'no' | null
export type FeatureGroup = { key: string; label: string; items: { key: string; label: string }[] }
export const FEATURE_GROUPS: FeatureGroup[] = [
  { key: 'kitchen', label: 'Kitchen', items: [
    { key: 'stove', label: 'Stove' }, { key: 'oven', label: 'Oven' }, { key: 'microwave', label: 'Microwave' }, { key: 'fridge', label: 'Refrigerator' }, { key: 'freezer', label: 'Freezer' },
    { key: 'dishwasher', label: 'Dishwasher' }, { key: 'coffee', label: 'Coffee maker' }, { key: 'kettle', label: 'Kettle' }, { key: 'toaster', label: 'Toaster' }, { key: 'blender', label: 'Blender' },
    { key: 'utensils', label: 'Utensils' }, { key: 'pots', label: 'Pots & pans' }, { key: 'dishes', label: 'Dishes & glasses' }, { key: 'knives', label: 'Knives & board' },
  ] },
  { key: 'living', label: 'Living & sleeping', items: [
    { key: 'tv', label: 'TV' }, { key: 'streaming', label: 'Smart TV / streaming' }, { key: 'dining', label: 'Dining table' }, { key: 'desk', label: 'Desk / workspace' },
    { key: 'blackout', label: 'Blackout curtains' }, { key: 'iron', label: 'Iron & board' }, { key: 'hairdryer', label: 'Hair dryer' }, { key: 'extraLinens', label: 'Extra linens' }, { key: 'extraTowels', label: 'Extra towels' }, { key: 'hangers', label: 'Hangers' },
  ] },
  { key: 'laundry', label: 'Laundry & outdoor', items: [
    { key: 'washer', label: 'Washer' }, { key: 'dryer', label: 'Dryer' }, { key: 'laundryBuilding', label: 'Laundry in building' }, { key: 'balcony', label: 'Balcony / patio' }, { key: 'pool', label: 'Pool access' }, { key: 'gym', label: 'Gym access' }, { key: 'bbq', label: 'BBQ / grill' },
  ] },
  { key: 'safety', label: 'Safety & access', items: [
    { key: 'smoke', label: 'Smoke detector' }, { key: 'co', label: 'CO detector' }, { key: 'extinguisher', label: 'Fire extinguisher' }, { key: 'firstAid', label: 'First aid kit' },
    { key: 'keypad', label: 'Keypad lock' }, { key: 'elevator', label: 'Elevator' }, { key: 'parking', label: 'Parking' }, { key: 'ac', label: 'Air conditioning' }, { key: 'heating', label: 'Heating' },
  ] },
]
export const FEATURE_COUNT = FEATURE_GROUPS.reduce((a, g) => a + g.items.length, 0)

/** The few things that are a pick, not a yes/no. */
export const PICKS: { key: string; label: string; options: string[] }[] = [
  { key: 'kitchenType', label: 'Kitchen', options: ['Full kitchen', 'Kitchenette', 'None'] },
  { key: 'coffeeType', label: 'Coffee maker type', options: ['Drip', 'Keurig', 'Nespresso', 'French press', 'None'] },
  { key: 'lockType', label: 'Door lock', options: ['Keypad', 'Key', 'Fob', 'Smart lock'] },
  { key: 'acType', label: 'AC', options: ['Central', 'Mini-split', 'Window', 'None'] },
  { key: 'view', label: 'View', options: ['Ocean', 'Bay', 'City', 'Pool', 'Garden', 'None'] },
]

export type QuickData = {
  beds: Partial<Record<BedKey, number>>
  bathrooms: number | null
  halfBaths: number | null
  maxGuests: number | null
  floor: string
  sqft: string
  features: Record<string, Tri>
  picks: Record<string, string>
  wifi: string
  notes: string
  photos: { url: string; at: string; caption?: string | null }[]
}
export type QuickUnit = { id: string; building: string; unit_no: string; status: 'draft' | 'done'; data: QuickData; listing_id: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string }

export const EMPTY_DATA: QuickData = { beds: {}, bathrooms: null, halfBaths: null, maxGuests: null, floor: '', sqft: '', features: {}, picks: {}, wifi: '', notes: '', photos: [] }

export function normData(raw: any): QuickData {
  const d = raw && typeof raw === 'object' ? raw : {}
  const beds: Partial<Record<BedKey, number>> = {}
  for (const b of BED_TYPES) { const n = Number(d.beds?.[b.key]); if (Number.isFinite(n) && n > 0) beds[b.key] = Math.min(20, Math.round(n)) }
  const num = (v: any) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(50, Math.round(n * 2) / 2)) }
  const features: Record<string, Tri> = {}
  for (const g of FEATURE_GROUPS) for (const it of g.items) { const v = d.features?.[it.key]; if (v === 'yes' || v === 'no') features[it.key] = v }
  const picks: Record<string, string> = {}
  for (const p of PICKS) { const v = String(d.picks?.[p.key] || ''); if (p.options.includes(v)) picks[p.key] = v }
  const photos = Array.isArray(d.photos) ? d.photos.filter((x: any) => x && typeof x.url === 'string').slice(0, 40).map((x: any) => ({ url: String(x.url), at: String(x.at || ''), caption: x.caption ? String(x.caption).slice(0, 120) : null })) : []
  return {
    beds, bathrooms: num(d.bathrooms), halfBaths: num(d.halfBaths), maxGuests: num(d.maxGuests),
    floor: String(d.floor || '').slice(0, 20), sqft: String(d.sqft || '').slice(0, 20), features, picks,
    wifi: String(d.wifi || '').slice(0, 120), notes: String(d.notes || '').slice(0, 2000), photos,
  }
}

/** How much of the card is filled: beds, baths, guests, each feature answered, at least one photo. */
export function completion(d: QuickData): { done: number; total: number; pct: number } {
  let done = 0
  const total = 4 + FEATURE_COUNT
  if (Object.values(d.beds).some(n => (n || 0) > 0)) done++
  if (d.bathrooms != null) done++
  if (d.maxGuests != null) done++
  if (d.photos.length) done++
  for (const g of FEATURE_GROUPS) for (const it of g.items) if (d.features[it.key]) done++
  return { done, total, pct: Math.round((done / total) * 100) }
}

/** "1 King · 1 Queen · 1 Sofa bed" */
export function bedsLabel(d: QuickData): string {
  return BED_TYPES.filter(b => (d.beds[b.key] || 0) > 0).map(b => `${d.beds[b.key]} ${b.label}`).join(' · ') || 'no beds yet'
}

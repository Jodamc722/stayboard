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
  // Shown only when the unit has a kitchen (picks.kitchen === 'yes').
  { key: 'kitchen', label: 'Kitchen', items: [
    { key: 'stove', label: 'Stove' }, { key: 'oven', label: 'Oven' }, { key: 'microwave', label: 'Microwave' }, { key: 'fridge', label: 'Refrigerator' }, { key: 'freezer', label: 'Freezer' },
    { key: 'dishwasher', label: 'Dishwasher' }, { key: 'coffee', label: 'Coffee maker' }, { key: 'toaster', label: 'Toaster' }, { key: 'utensils', label: 'Utensils' }, { key: 'pots', label: 'Pots & pans' }, { key: 'dishes', label: 'Dishes & glasses' },
  ] },
  { key: 'unit', label: 'In the unit', items: [
    { key: 'tv', label: 'TV' }, { key: 'sofaBed', label: 'Sofa bed' }, { key: 'washer', label: 'Washer' }, { key: 'dryer', label: 'Dryer' }, { key: 'balcony', label: 'Balcony' },
    { key: 'ac', label: 'AC' }, { key: 'iron', label: 'Iron' }, { key: 'hairdryer', label: 'Hair dryer' }, { key: 'keypad', label: 'Keypad lock' },
  ] },
  { key: 'safety', label: 'Safety', items: [
    { key: 'smoke', label: 'Smoke detector' }, { key: 'co', label: 'CO detector' }, { key: 'extinguisher', label: 'Fire extinguisher' },
  ] },
]
export const FEATURE_COUNT = FEATURE_GROUPS.reduce((a, g) => a + g.items.length, 0)

/** The few things that are a pick, not a yes/no. */
/** The two things that are a pick, not a yes/no. Kept to what the team actually needs to know. */
/** The gate and its one follow-up. */
export const PICKS: { key: string; label: string; options: string[] }[] = [
  { key: 'kitchen', label: 'Kitchen?', options: ['yes', 'no'] },
  { key: 'kitchenType', label: 'Kitchen type', options: ['Full kitchen', 'Kitchenette'] },
  { key: 'coffeeType', label: 'Coffee maker', options: ['Drip', 'Keurig', 'Nespresso'] },
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
  if (Object.values(d.beds).some(n => (n || 0) > 0)) done++
  if (d.bathrooms != null) done++
  if (d.maxGuests != null) done++
  if (d.photos.length) done++
  const hasKitchen = d.picks.kitchen === 'yes'
  let total2 = 4 + 1
  if (hasKitchen) total2 += FEATURE_GROUPS[0].items.length
  total2 += FEATURE_GROUPS.slice(1).reduce((a, g) => a + g.items.length, 0)
  if (d.picks.kitchen) done++
  for (const g of FEATURE_GROUPS) { if (g.key === 'kitchen' && !hasKitchen) continue; for (const it of g.items) if (d.features[it.key]) done++ }
  return { done, total: total2, pct: Math.round((done / total2) * 100) }
}

/** "1 King · 1 Queen · 1 Sofa bed" */
export function bedsLabel(d: QuickData): string {
  return BED_TYPES.filter(b => (d.beds[b.key] || 0) > 0).map(b => `${d.beds[b.key]} ${b.label}`).join(' · ') || 'no beds yet'
}

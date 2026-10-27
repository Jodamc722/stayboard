// THE COMPLETE CATALOG'S SECOND HALF (Jon, 2026-10-27): "a complete catalog for our owners, and
// tiers, and preset orders, with swap options for onboarding… must-have, recommended and suggested
// sections". Furniture is a catalog to choose from, never required; the sections and the preset
// order are for the ONBOARDING ESSENTIALS — iron, pack n play, games, the kitchen kit, safety, the
// first stock of supplies.
//
// Built from lib/ffe-starter-catalog (the 200-product starter, three price points, Amazon SEARCH
// links and planning ESTIMATES — read that file's header). Each starter role becomes one catalog
// item with one option per tier, so a tier picks the price point and the team swaps between them.
// Search links and estimates are labelled on the option ("Estimate", "Search — pin a product") so
// nobody mistakes them for a quote; pasting the real product link over one pins it.
//
// Three things are deliberately NOT copied:
//   • starter supplies the sourcing sheet already prices with a real product (toilet paper, trash
//     bags, dish soap…) — those sheet items get a section and a quantity rule instead (AMENITY_RULES),
//     so there is one "Toilet paper" and it is the real one;
//   • starter furniture the sheet already covers (nightstands, dressers, lamps, stools…), and the
//     pull-out sleeper style Jon does not buy;
//   • linen — the linen standard lives on Onboarding → Linens.
import { STARTER_CATALOG, type StarterProduct } from './ffe-starter-catalog'

export type Need = 'must' | 'recommended' | 'suggested'
export type QtyPer = 'unit' | 'bedroom' | 'bathroom' | 'guest'
export type SeedOption = { src: string; vendor: string; name: string; url: string; price: number | null; image: null; chips: string[]; fit: 'contain'; tier: string | null }
export type SeedItem = { key: string; section: 'essential' | 'vendor'; category: string; name: string; need: Need | null; qty: number; qtyPer: QtyPer; options: SeedOption[] }

const TIER: Record<string, string> = { tier1: 'standard', tier2: 'midlux', tier3: 'luxury' }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const amazonSearch = (q: string) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`

// role → [category, need, qty, per]
const ESSENTIALS: Record<string, [string, Need, number, QtyPer]> = {
  // Kitchen
  'Coffee maker': ['Kitchen', 'must', 1, 'unit'],
  'Cookware set': ['Kitchen', 'must', 1, 'unit'],
  'Dishware set': ['Kitchen', 'must', 1, 'unit'],
  'Flatware set': ['Kitchen', 'must', 1, 'unit'],
  'Glassware set': ['Kitchen', 'must', 1, 'unit'],
  'Kitchen utensils': ['Kitchen', 'must', 1, 'unit'],
  'Knife set': ['Kitchen', 'must', 1, 'unit'],
  'Toaster': ['Kitchen', 'must', 1, 'unit'],
  'Dish rack': ['Kitchen', 'must', 1, 'unit'],
  'Wine glasses': ['Kitchen', 'recommended', 1, 'unit'],
  'Mixing bowls': ['Kitchen', 'recommended', 1, 'unit'],
  'Food storage': ['Kitchen', 'recommended', 1, 'unit'],
  'Electric kettle': ['Kitchen', 'recommended', 1, 'unit'],
  'Microwave': ['Kitchen', 'recommended', 1, 'unit'],
  'Blender': ['Kitchen', 'recommended', 1, 'unit'],
  'Air fryer': ['Kitchen', 'suggested', 1, 'unit'],
  // Bedroom & bath
  'Hair dryer': ['Bedroom & bath', 'must', 1, 'bathroom'],
  'Iron and board': ['Bedroom & bath', 'must', 1, 'unit'],
  'Hangers': ['Bedroom & bath', 'must', 1, 'bedroom'],
  'Nightlight': ['Bedroom & bath', 'recommended', 1, 'unit'],
  'Clothes steamer': ['Bedroom & bath', 'suggested', 1, 'unit'],
  'Tower fan': ['Bedroom & bath', 'suggested', 1, 'bedroom'],
  // Safety
  'First aid kit': ['Safety', 'must', 1, 'unit'],
  'Fire extinguisher': ['Safety', 'must', 1, 'unit'],
  'Smoke and CO detector': ['Safety', 'must', 1, 'bedroom'],
  'Digital safe': ['Safety', 'suggested', 1, 'unit'],
  // Cleaning
  'Vacuum': ['Cleaning', 'must', 1, 'unit'],
  // Entertainment
  'Streaming stick': ['Entertainment', 'recommended', 1, 'bedroom'],
  'Bluetooth speaker': ['Entertainment', 'suggested', 1, 'unit'],
  // Family
  'Pack n play': ['Family', 'suggested', 1, 'unit'],
  'High chair': ['Family', 'suggested', 1, 'unit'],
  'Baby gate': ['Family', 'suggested', 1, 'unit'],
  // Beach & outdoor
  'Beach chairs': ['Beach & outdoor', 'suggested', 0.5, 'guest'],
  'Beach umbrella': ['Beach & outdoor', 'suggested', 1, 'unit'],
  'Beach cart': ['Beach & outdoor', 'suggested', 1, 'unit'],
  'Cooler': ['Beach & outdoor', 'suggested', 1, 'unit'],
  // First stock of supplies not already priced on the sheet
  'All-purpose cleaner': ['Cleaning supplies', 'must', 1, 'unit'],
  'Glass cleaner': ['Cleaning supplies', 'must', 1, 'unit'],
  'Bathroom cleaner': ['Cleaning supplies', 'must', 1, 'unit'],
  'Disinfecting wipes': ['Cleaning supplies', 'recommended', 1, 'unit'],
  'Broom': ['Cleaning supplies', 'must', 1, 'unit'],
  'Mop': ['Cleaning supplies', 'must', 1, 'unit'],
  'Toilet brush': ['Cleaning supplies', 'must', 1, 'bathroom'],
  'Laundry basket': ['Cleaning supplies', 'must', 1, 'unit'],
  'Air freshener': ['Cleaning supplies', 'recommended', 1, 'bathroom'],
  'Lint roller': ['Cleaning supplies', 'recommended', 1, 'unit'],
  'Batteries': ['Paper & consumables', 'must', 1, 'unit'],
  'Light bulbs': ['Paper & consumables', 'must', 1, 'unit'],
  'Coffee filters': ['Paper & consumables', 'recommended', 1, 'unit'],
}

// Things guests ask for that the starter never had — search links only, no estimate.
const EXTRA: { role: string; category: string; need: Need; qty: number; per: QtyPer; search: [string, string, string] }[] = [
  { role: 'Board games', category: 'Entertainment', need: 'suggested', qty: 1, per: 'unit', search: ['family board games set', 'classic board game collection wooden', 'luxury wooden board game set chess backgammon'] },
  { role: 'Playing cards and dice games', category: 'Entertainment', need: 'suggested', qty: 1, per: 'unit', search: ['playing cards and dice game set', 'card games for adults and families set', 'leather playing cards set luxury'] },
  { role: 'Luggage rack', category: 'Bedroom & bath', need: 'recommended', qty: 1, per: 'bedroom', search: ['folding luggage rack metal', 'folding luggage rack wood with shelf', 'hotel luggage rack solid wood'] },
]

// Starter furniture the sourcing sheet does not already cover → category on the furniture side.
const FURNITURE_GAPS: Record<string, string> = {
  'Sofa': 'Sofas', 'Accent chair': 'Lounge chairs', 'Office chair': 'Office', 'Side table': 'Side tables',
  'Dining table': 'Dining sets', 'Console table': 'Entry', 'Desk': 'Office',
  'Bed frame — queen': 'Beds', 'Bed frame — king': 'Beds', 'Mattress — queen': 'Mattresses', 'Mattress — king': 'Mattresses',
  'TV stand': 'TVs', 'Bedroom TV stand': 'TVs', 'TV — living room': 'TVs', 'TV — bedroom': 'TVs', 'TV wall mount': 'TVs',
  'Bedside lamp': 'Table lamps', 'Ceiling light': 'Lighting',
  'Area rug — living': 'Rugs', 'Area rug — bedroom': 'Rugs', 'Runner': 'Rugs', 'Rug pad': 'Rugs',
  'Wall art': 'Decor', 'Mirror': 'Decor', 'Blackout curtains': 'Window', 'Curtain rod': 'Window',
  'Throw pillows': 'Decor', 'Throw blanket': 'Decor', 'Decor set': 'Decor', 'Entry basket': 'Entry',
}

function optionsFor(products: StarterProduct[]): SeedOption[] {
  return products.map(p => {
    const tier = products.length > 1 ? (TIER[p.tier] || null) : null
    return { src: 'amz', vendor: 'Amazon', name: p.spec ? `${p.name} · ${p.spec}` : p.name, url: amazonSearch(p.search), price: p.est ?? null, image: null,
      chips: ['Estimate', 'Search — pin a product'], fit: 'contain' as const, tier }
  }).map((o, i, all) => (all.length > 1 ? { ...o, src: i === 0 ? 'amz' : `amz-${i + 1}` } : o))
}

export function essentialsSeed(): SeedItem[] {
  const byRole = new Map<string, StarterProduct[]>()
  for (const p of STARTER_CATALOG) { const l = byRole.get(p.role) || []; l.push(p); byRole.set(p.role, l) }
  const out: SeedItem[] = []
  for (const [role, [category, need, qty, per]] of Object.entries(ESSENTIALS)) {
    const products = byRole.get(role); if (!products) continue
    out.push({ key: `ess-${slug(role)}`, section: 'essential', category, name: role, need, qty, qtyPer: per, options: optionsFor(products) })
  }
  for (const x of EXTRA) {
    out.push({ key: `ess-${slug(x.role)}`, section: 'essential', category: x.category, name: x.role, need: x.need, qty: x.qty, qtyPer: x.per,
      options: x.search.map((q, i) => ({ src: i === 0 ? 'amz' : `amz-${i + 1}`, vendor: 'Amazon', name: `Find: ${q}`, url: amazonSearch(q), price: null, image: null, chips: ['Search — pin a product'], fit: 'contain' as const, tier: ['standard', 'midlux', 'luxury'][i] })) })
  }
  for (const [role, category] of Object.entries(FURNITURE_GAPS)) {
    const products = byRole.get(role); if (!products) continue
    out.push({ key: `fur-${slug(role)}`, section: 'vendor', category, name: role, need: null, qty: 1, qtyPer: 'unit', options: optionsFor(products) })
  }
  return out
}

/** Sections and quantity rules for the sheet's real amenities, so they ARE the essentials. */
export const AMENITY_RULES: Record<string, { category: string; need: Need; qty: number; per: QtyPer }> = {
  'am-1': { category: 'Paper & consumables', need: 'must', qty: 1, per: 'unit' },          // Coffee pods
  'am-2': { category: 'Kitchen', need: 'recommended', qty: 1, per: 'unit' },               // Condiment kit
  'am-3': { category: 'Cleaning supplies', need: 'must', qty: 1, per: 'unit' },            // Kitchen sponge
  'am-4': { category: 'Paper & consumables', need: 'must', qty: 1, per: 'unit' },          // Trash bags 38×60
  'am-5': { category: 'Paper & consumables', need: 'must', qty: 1, per: 'unit' },          // Trash bags 24×24
  'am-6': { category: 'Paper & consumables', need: 'must', qty: 1, per: 'unit' },          // Toilet paper
  'am-7': { category: 'Paper & consumables', need: 'must', qty: 1, per: 'unit' },          // Paper towel
  'am-8': { category: 'Paper & consumables', need: 'recommended', qty: 1, per: 'unit' },   // Facial tissue
  'am-9': { category: 'Bath amenities', need: 'suggested', qty: 1, per: 'unit' },          // Shampoo tube
  'am-10': { category: 'Bath amenities', need: 'suggested', qty: 1, per: 'unit' },
  'am-11': { category: 'Bath amenities', need: 'suggested', qty: 1, per: 'unit' },
  'am-12': { category: 'Bath amenities', need: 'suggested', qty: 1, per: 'unit' },
  'am-13': { category: 'Bath amenities', need: 'suggested', qty: 1, per: 'unit' },         // Cleansing bar
  'am-14': { category: 'Bath amenities', need: 'must', qty: 1, per: 'bathroom' },          // Shampoo dispenser
  'am-15': { category: 'Bath amenities', need: 'must', qty: 1, per: 'bathroom' },
  'am-16': { category: 'Bath amenities', need: 'must', qty: 1, per: 'bathroom' },
  'am-17': { category: 'Bath amenities', need: 'must', qty: 1, per: 'bathroom' },          // Hand soap dispenser
  'am-18': { category: 'Bath amenities', need: 'recommended', qty: 1, per: 'bathroom' },   // Lotion dispenser
  'am-19': { category: 'Bath amenities', need: 'recommended', qty: 1, per: 'unit' },       // Refills
  'am-20': { category: 'Bath amenities', need: 'recommended', qty: 1, per: 'unit' },
  'am-21': { category: 'Bath amenities', need: 'recommended', qty: 1, per: 'unit' },
  'am-22': { category: 'Bath amenities', need: 'recommended', qty: 1, per: 'unit' },
  'am-23': { category: 'Cleaning supplies', need: 'recommended', qty: 1, per: 'unit' },    // Dish soap refill
  'am-24': { category: 'Cleaning supplies', need: 'must', qty: 1, per: 'unit' },           // Dish soap
  'am-25': { category: 'Cleaning supplies', need: 'suggested', qty: 1, per: 'unit' },      // Dish soap mini
  'am-26': { category: 'Cleaning supplies', need: 'must', qty: 1, per: 'unit' },           // Laundry pods
  'am-27': { category: 'Cleaning supplies', need: 'recommended', qty: 1, per: 'unit' },    // Dishwasher detergent
  'am-28': { category: 'Cleaning supplies', need: 'must', qty: 1, per: 'unit' },           // Dish pods
  'am-29': { category: 'Cleaning supplies', need: 'must', qty: 1, per: 'bathroom' },       // Hand soap
}

/** Furniture tier by supplier for the sheet's real products (editable per option afterwards). */
export const FURNITURE_TIER_BY_SUPPLIER: Record<string, string> = { amz: 'standard', wf: 'standard', ch: 'midlux', host: 'luxury' }

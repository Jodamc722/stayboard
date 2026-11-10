// THE NEED LIST STANDARD (Jon, 2026-11-10: "the calculator should tell you the actual number of each
// item — bowls, plates, cups, wine glasses etc. Should not be based on the link or order form").
//
// What /kit/list counts: the PIECES a home needs, not the products we buy them in. "9 dinner plates,
// 9 bowls, 6 wine glasses" — never "2 dinnerware sets". It is its own standard, independent of the
// starter kit's product list (lib/starter-kit.ts), the same way the linen standard is par per bed.
//
// Sizing, from the home's details (KitSize: bedrooms, bathrooms, guests, kitchen and appliances):
//   settings   place settings = guests × 1.5, rounded up, so the dishwasher can run between meals
//   guest      one per guest
//   bedroom    per bedroom (a studio counts as one)
//   bathroom   per bathroom
//   unit       a fixed number per home
// Kitchen items only appear when the home has a kitchen; items that need an appliance (an oven, a
// stove) only when it has that appliance. With no dishwasher the dish rack becomes a must-have.
// Linen is not here: it has its own standard on Onboarding → Linens. Isomorphic.
import type { KitAppliance, KitSize } from './starter-kit'

export type NeedTier = 'must' | 'recommended' | 'optional'
export type NeedPer = 'unit' | 'bedroom' | 'bathroom' | 'guest' | 'settings'
export type NeedItem = { key: string; room: string; name: string; tier: NeedTier; per: NeedPer; n: number; kitchen?: boolean; needs?: KitAppliance[] }

export const NEED_ROOMS = ['Dishes & glassware', 'Flatware', 'Cookware', 'Kitchen tools', 'Kitchen appliances', 'Kitchen essentials', 'Bathroom', 'Bedroom', 'Cleaning & safety', 'Family & games'] as const

const K = (room: string, key: string, name: string, tier: NeedTier, per: NeedPer, n: number, needs?: KitAppliance[]): NeedItem => ({ key, room, name, tier, per, n, kitchen: true, needs })
const H = (room: string, key: string, name: string, tier: NeedTier, per: NeedPer, n: number): NeedItem => ({ key, room, name, tier, per, n })

export const NEED_ITEMS: NeedItem[] = [
  // Dishes & glassware
  K('Dishes & glassware', 'dinner-plates', 'Dinner plates', 'must', 'settings', 1),
  K('Dishes & glassware', 'side-plates', 'Salad / side plates', 'must', 'settings', 1),
  K('Dishes & glassware', 'bowls', 'Bowls', 'must', 'settings', 1),
  H('Dishes & glassware', 'mugs', 'Coffee mugs', 'must', 'guest', 1),
  H('Dishes & glassware', 'tall-glasses', 'Tall glasses', 'must', 'settings', 1),
  H('Dishes & glassware', 'wine-glasses', 'Wine glasses', 'must', 'guest', 1),
  H('Dishes & glassware', 'short-glasses', 'Short glasses', 'recommended', 'guest', 1),
  K('Dishes & glassware', 'serving-bowls', 'Serving bowls', 'recommended', 'unit', 2),
  K('Dishes & glassware', 'serving-platter', 'Serving platter', 'recommended', 'unit', 1),
  H('Dishes & glassware', 'cocktail-glasses', 'Cocktail glasses', 'optional', 'guest', 1),
  H('Dishes & glassware', 'shot-glasses', 'Shot glasses', 'optional', 'guest', 1),
  // Flatware
  K('Flatware', 'forks', 'Dinner forks', 'must', 'settings', 1),
  K('Flatware', 'salad-forks', 'Salad forks', 'recommended', 'settings', 1),
  K('Flatware', 'table-knives', 'Table knives', 'must', 'settings', 1),
  K('Flatware', 'spoons', 'Soup spoons', 'must', 'settings', 1),
  K('Flatware', 'teaspoons', 'Teaspoons', 'must', 'settings', 1),
  K('Flatware', 'steak-knives', 'Steak knives', 'optional', 'guest', 1),
  K('Flatware', 'serving-utensils', 'Serving spoons and forks', 'recommended', 'unit', 4),
  // Cookware
  K('Cookware', 'fry-large', 'Frying pan, large', 'must', 'unit', 1, ['stove']),
  K('Cookware', 'fry-small', 'Frying pan, small', 'must', 'unit', 1, ['stove']),
  K('Cookware', 'saucepans', 'Saucepans with lids', 'must', 'unit', 2, ['stove']),
  K('Cookware', 'stock-pot', 'Stock pot with lid', 'must', 'unit', 1, ['stove']),
  K('Cookware', 'sheet-pans', 'Sheet pans', 'must', 'unit', 2, ['oven']),
  K('Cookware', 'baking-dish', 'Baking / casserole dish', 'recommended', 'unit', 1, ['oven']),
  K('Cookware', 'muffin-tin', 'Muffin tin', 'optional', 'unit', 1, ['oven']),
  K('Cookware', 'mixing-bowls', 'Mixing bowls', 'recommended', 'unit', 3),
  K('Cookware', 'colander', 'Colander', 'must', 'unit', 1),
  // Kitchen tools
  K('Kitchen tools', 'chef-knife', "Chef's knife", 'must', 'unit', 1),
  K('Kitchen tools', 'paring-knife', 'Paring knife', 'must', 'unit', 1),
  K('Kitchen tools', 'bread-knife', 'Bread knife', 'recommended', 'unit', 1),
  K('Kitchen tools', 'cutting-boards', 'Cutting boards', 'must', 'unit', 2),
  K('Kitchen tools', 'spatula', 'Spatula', 'must', 'unit', 1),
  K('Kitchen tools', 'wooden-spoons', 'Wooden spoons', 'must', 'unit', 2),
  K('Kitchen tools', 'ladle', 'Ladle', 'must', 'unit', 1),
  K('Kitchen tools', 'tongs', 'Tongs', 'must', 'unit', 1),
  K('Kitchen tools', 'whisk', 'Whisk', 'recommended', 'unit', 1),
  K('Kitchen tools', 'peeler', 'Vegetable peeler', 'recommended', 'unit', 1),
  K('Kitchen tools', 'grater', 'Grater', 'optional', 'unit', 1),
  K('Kitchen tools', 'can-opener', 'Can opener', 'must', 'unit', 1),
  H('Kitchen tools', 'corkscrew', 'Wine opener / bottle opener', 'must', 'unit', 1),
  K('Kitchen tools', 'shears', 'Kitchen shears', 'recommended', 'unit', 1),
  K('Kitchen tools', 'measuring-cups', 'Measuring cups (set)', 'recommended', 'unit', 1),
  K('Kitchen tools', 'measuring-spoons', 'Measuring spoons (set)', 'recommended', 'unit', 1),
  K('Kitchen tools', 'oven-mitts', 'Oven mitts', 'must', 'unit', 2, ['oven']),
  K('Kitchen tools', 'trivets', 'Trivets / pot holders', 'recommended', 'unit', 2),
  K('Kitchen tools', 'utensil-holder', 'Utensil holder', 'optional', 'unit', 1),
  // Kitchen appliances (small)
  H('Kitchen appliances', 'coffee-maker', 'Coffee maker (Nespresso or Keurig)', 'must', 'unit', 1),
  K('Kitchen appliances', 'toaster', 'Toaster', 'must', 'unit', 1),
  H('Kitchen appliances', 'kettle', 'Electric kettle', 'recommended', 'unit', 1),
  K('Kitchen appliances', 'blender', 'Blender', 'optional', 'unit', 1),
  // Kitchen essentials
  K('Kitchen essentials', 'dish-rack', 'Dish rack', 'recommended', 'unit', 1),
  K('Kitchen essentials', 'kitchen-trash', 'Kitchen trash can', 'must', 'unit', 1),
  K('Kitchen essentials', 'paper-towel-holder', 'Paper towel holder', 'must', 'unit', 1),
  K('Kitchen essentials', 'food-storage', 'Food storage containers (set)', 'recommended', 'unit', 1),
  // Bathroom
  H('Bathroom', 'hair-dryer', 'Hair dryer', 'must', 'bathroom', 1),
  H('Bathroom', 'bath-trash', 'Bathroom trash can', 'must', 'bathroom', 1),
  H('Bathroom', 'plunger', 'Plunger', 'must', 'bathroom', 1),
  H('Bathroom', 'toilet-brush', 'Toilet brush', 'must', 'bathroom', 1),
  H('Bathroom', 'soap-dispensers', 'Soap / shampoo dispensers', 'recommended', 'bathroom', 3),
  // Bedroom
  H('Bedroom', 'hangers', 'Hangers', 'must', 'bedroom', 20),
  H('Bedroom', 'luggage-rack', 'Luggage rack', 'recommended', 'bedroom', 1),
  H('Bedroom', 'iron', 'Iron', 'must', 'unit', 1),
  H('Bedroom', 'ironing-board', 'Ironing board', 'must', 'unit', 1),
  // Cleaning & safety
  H('Cleaning & safety', 'vacuum', 'Vacuum', 'must', 'unit', 1),
  H('Cleaning & safety', 'broom', 'Broom and dustpan', 'must', 'unit', 1),
  H('Cleaning & safety', 'mop', 'Mop', 'must', 'unit', 1),
  H('Cleaning & safety', 'first-aid', 'First aid kit', 'must', 'unit', 1),
  H('Cleaning & safety', 'extinguisher', 'Fire extinguisher', 'must', 'unit', 1),
  H('Cleaning & safety', 'flashlight', 'Flashlight', 'recommended', 'unit', 1),
  // Family & games
  H('Family & games', 'pack-n-play', 'Pack n play', 'recommended', 'unit', 1),
  H('Family & games', 'high-chair', 'High chair', 'optional', 'unit', 1),
  H('Family & games', 'playing-cards', 'Playing cards (decks)', 'recommended', 'unit', 2),
  H('Family & games', 'uno', 'Uno', 'recommended', 'unit', 1),
  H('Family & games', 'board-games', 'Board games', 'optional', 'unit', 2),
]

function driver(per: NeedPer, z: KitSize): number {
  switch (per) {
    case 'settings': return Math.ceil(z.guests * 1.5)
    case 'guest': return z.guests
    case 'bedroom': return Math.max(1, z.bedrooms)
    case 'bathroom': return Math.max(1, z.bathrooms)
    default: return 1
  }
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export type NeedLine = { item: NeedItem; tier: NeedTier; count: number; rule: string }

/** Every piece this home needs, with how many, in room order. */
export function needList(z: KitSize): NeedLine[] {
  const out: NeedLine[] = []
  for (const it of NEED_ITEMS) {
    if (it.kitchen && !z.kitchen) continue
    if (it.needs && !it.needs.every(a => z.kitchen && z.appliances[a])) continue
    const tier: NeedTier = it.key === 'dish-rack' && !z.appliances.dishwasher ? 'must' : it.tier
    const d = driver(it.per, z)
    const count = Math.max(1, Math.ceil(it.n * d))
    const rule = it.per === 'settings' ? `${d} place settings (1.5 per guest)`
      : it.per === 'guest' ? `one per guest · ${plural(z.guests, 'guest')}`
        : it.per === 'bedroom' ? `${it.n === 1 ? 'one' : it.n} per bedroom · ${plural(Math.max(1, z.bedrooms), 'bedroom')}`
          : it.per === 'bathroom' ? `${it.n === 1 ? 'one' : it.n} per bathroom · ${plural(Math.max(1, z.bathrooms), 'bathroom')}`
            : 'per home'
    out.push({ item: it, tier, count, rule })
  }
  return out.sort((a, b) => NEED_ROOMS.indexOf(a.item.room as any) - NEED_ROOMS.indexOf(b.item.room as any))
}

// THE NEED LIST STANDARD (Jon, 2026-11-10: "the calculator should tell you the actual number of each
// item — bowls, plates, cups, wine glasses etc. Should not be based on the link or order form").
//
// What /kit/list counts: the PIECES a home needs, not the products we buy them in. "9 dinner plates,
// 9 bowls, 6 wine glasses" — never "2 dinnerware sets". It is its own standard, independent of the
// starter kit's product list (lib/starter-kit.ts), the same way the linen standard is par per bed.
//
// THE STANDARD (Jon, 2026-11-10: "use your smarts to determine the proper standard"). It follows the
// vacation-rental industry's rule for dishes: TWICE the maximum guest count in place settings, plates,
// bowls and glasses (Evolve: "at least 2x the number of place settings"; Hostfully: "double the amount
// the number of people your property can host"; WebstaurantStore: "twice the number of place settings,
// dishes, and tableware as your rental's maximum guest capacity"), so a full house can eat twice before
// anything is washed. Then:
//   settings   place settings = guests × 2: plates, bowls, mugs, tall glasses, everyday flatware
//   guest      per guest (× n): wine glasses at 1.5 (they break), short glasses and salad forks at 1
//   bedroom    per bedroom (a studio counts as one), plus a fixed extra where it says so
//   bathroom   per bathroom
//   unit       a fixed number per home
// A large home (10 guests or more) gets the extras marked `big`: a second coffee maker, another large
// pan, sheet pan, cutting board and serving pieces, because one of each does not feed twelve.
// Safety: smoke alarms one per bedroom plus one outside the sleeping area, a fire extinguisher, a first
// aid kit; a carbon monoxide alarm where there are gas appliances or an attached garage. Local code
// decides the final number; this is the starting point.
// Kitchen items only appear when the home has a kitchen; items that need an appliance (an oven, a
// stove) only when it has that appliance. With no dishwasher the dish rack becomes a must-have.
// Linen is not here: it has its own standard on Onboarding → Linens. Isomorphic.
import type { KitAppliance, KitSize } from './starter-kit'

export type NeedTier = 'must' | 'recommended' | 'optional'
export type NeedPer = 'unit' | 'bedroom' | 'bathroom' | 'guest' | 'settings'
export type NeedItem = { key: string; room: string; name: string; tier: NeedTier; per: NeedPer; n: number; kitchen?: boolean; needs?: KitAppliance[]
  min?: number; plus?: number; big?: number; note?: string }   // at least `min`; `plus` added always; `big` added at 10+ guests

// GROUPED AS SETS (Jon, 2026-11-10: "group cooking utensils together, dining set, and list what is in
// it and counts of each… knife set, for example"). Each group is what you would buy or unpack together;
// its contents and the count of each piece are listed under it. Items are defined below by kind and
// placed in their set by GROUP_OF.
export const NEED_ROOMS = ['Dining set', 'Glassware', 'Flatware set', 'Knife set', 'Cookware set', 'Bakeware set', 'Prep set', 'Cooking utensil set', 'Serving pieces',
  'Small appliances', 'Kitchen extras', 'Bathroom', 'Bedroom', 'Cleaning & safety', 'Family & games'] as const
export const GROUP_NOTE: Record<string, string> = {
  'Dining set': 'Plates, bowls and mugs for every place setting',
  Glassware: 'Everyday and wine glasses, with extras for breakage',
  'Flatware set': 'Forks, knives and spoons for every place setting',
  'Knife set': 'Kitchen knives, steak knives and shears, kept in a block',
  'Cookware set': 'Pots and pans with lids',
  'Bakeware set': 'For the oven',
  'Prep set': 'Boards, bowls and measuring',
  'Cooking utensil set': 'Tools that live by the stove',
  'Serving pieces': 'For putting food on the table',
  'Small appliances': 'Countertop appliances',
  'Kitchen extras': 'Openers, mitts, bins and storage',
}
const GROUP_OF: Record<string, string> = {
  'dinner-plates': 'Dining set', 'side-plates': 'Dining set', bowls: 'Dining set', mugs: 'Dining set',
  'tall-glasses': 'Glassware', 'wine-glasses': 'Glassware', 'short-glasses': 'Glassware', 'cocktail-glasses': 'Glassware', 'shot-glasses': 'Glassware',
  forks: 'Flatware set', 'salad-forks': 'Flatware set', 'table-knives': 'Flatware set', spoons: 'Flatware set', teaspoons: 'Flatware set',
  'chef-knife': 'Knife set', 'bread-knife': 'Knife set', 'paring-knife': 'Knife set', 'steak-knives': 'Knife set', shears: 'Knife set', 'knife-block': 'Knife set',
  'fry-large': 'Cookware set', 'fry-small': 'Cookware set', saucepans: 'Cookware set', 'stock-pot': 'Cookware set',
  'sheet-pans': 'Bakeware set', 'baking-dish': 'Bakeware set', 'muffin-tin': 'Bakeware set',
  'cutting-boards': 'Prep set', 'mixing-bowls': 'Prep set', colander: 'Prep set', 'measuring-cups': 'Prep set', 'measuring-spoons': 'Prep set', peeler: 'Prep set', grater: 'Prep set',
  spatulas: 'Cooking utensil set', 'wooden-spoons': 'Cooking utensil set', 'slotted-spoon': 'Cooking utensil set', ladle: 'Cooking utensil set', tongs: 'Cooking utensil set', whisk: 'Cooking utensil set', 'utensil-holder': 'Cooking utensil set',
  'serving-bowls': 'Serving pieces', 'serving-platter': 'Serving pieces', 'serving-utensils': 'Serving pieces',
  'coffee-maker': 'Small appliances', toaster: 'Small appliances', kettle: 'Small appliances', blender: 'Small appliances',
  'can-opener': 'Kitchen extras', corkscrew: 'Kitchen extras', 'oven-mitts': 'Kitchen extras', trivets: 'Kitchen extras', 'dish-rack': 'Kitchen extras', 'kitchen-trash': 'Kitchen extras',
  recycling: 'Kitchen extras', 'paper-towel-holder': 'Kitchen extras', 'food-storage': 'Kitchen extras',
}


type X = Partial<Pick<NeedItem, 'min' | 'plus' | 'big' | 'note' | 'needs'>>
const K = (room: string, key: string, name: string, tier: NeedTier, per: NeedPer, n: number, x: X = {}): NeedItem => ({ key, room, name, tier, per, n, kitchen: true, ...x })
const H = (room: string, key: string, name: string, tier: NeedTier, per: NeedPer, n: number, x: X = {}): NeedItem => ({ key, room, name, tier, per, n, ...x })
export const BIG_HOME = 10

export const NEED_ITEMS: NeedItem[] = [
  // Dishes & glassware — place settings at twice the guest count
  K('Dishes & glassware', 'dinner-plates', 'Dinner plates', 'must', 'settings', 1),
  K('Dishes & glassware', 'side-plates', 'Salad / side plates', 'must', 'settings', 1),
  K('Dishes & glassware', 'bowls', 'Bowls', 'must', 'settings', 1),
  H('Dishes & glassware', 'mugs', 'Coffee mugs', 'must', 'settings', 1),
  H('Dishes & glassware', 'tall-glasses', 'Tall glasses', 'must', 'settings', 1),
  H('Dishes & glassware', 'wine-glasses', 'Wine glasses', 'must', 'guest', 1.5, { note: 'extra for breakage' }),
  H('Dishes & glassware', 'short-glasses', 'Short glasses', 'recommended', 'guest', 1),
  K('Dishes & glassware', 'serving-bowls', 'Serving bowls', 'recommended', 'guest', 0.25, { min: 2 }),
  K('Dishes & glassware', 'serving-platter', 'Serving platter', 'recommended', 'unit', 1, { big: 1 }),
  H('Dishes & glassware', 'cocktail-glasses', 'Cocktail glasses', 'optional', 'guest', 1),
  H('Dishes & glassware', 'shot-glasses', 'Shot glasses', 'optional', 'guest', 1),
  // Flatware
  K('Flatware', 'forks', 'Dinner forks', 'must', 'settings', 1),
  K('Flatware', 'table-knives', 'Table knives', 'must', 'settings', 1),
  K('Flatware', 'spoons', 'Soup spoons', 'must', 'settings', 1),
  K('Flatware', 'teaspoons', 'Teaspoons', 'must', 'settings', 1),
  K('Flatware', 'salad-forks', 'Salad forks', 'recommended', 'guest', 1),
  K('Flatware', 'steak-knives', 'Steak knives', 'recommended', 'guest', 1),
  K('Flatware', 'serving-utensils', 'Serving spoons and forks', 'recommended', 'unit', 4, { big: 2 }),
  // Cookware
  K('Cookware', 'fry-large', 'Frying pan, large (12 in)', 'must', 'unit', 1, { needs: ['stove'], big: 1 }),
  K('Cookware', 'fry-small', 'Frying pan, small (8 in)', 'must', 'unit', 1, { needs: ['stove'] }),
  K('Cookware', 'saucepans', 'Saucepans with lids', 'must', 'unit', 2, { needs: ['stove'], big: 1 }),
  K('Cookware', 'stock-pot', 'Stock pot with lid', 'must', 'unit', 1, { needs: ['stove'] }),
  K('Cookware', 'sheet-pans', 'Sheet pans', 'must', 'unit', 2, { needs: ['oven'], big: 1 }),
  K('Cookware', 'baking-dish', 'Baking / casserole dishes', 'recommended', 'unit', 2, { needs: ['oven'] }),
  K('Cookware', 'muffin-tin', 'Muffin tin', 'optional', 'unit', 1, { needs: ['oven'] }),
  K('Cookware', 'mixing-bowls', 'Mixing bowls', 'recommended', 'unit', 3),
  K('Cookware', 'colander', 'Colander', 'must', 'unit', 1),
  // Kitchen tools
  K('Kitchen tools', 'chef-knife', "Chef's knife", 'must', 'unit', 1),
  K('Kitchen tools', 'paring-knife', 'Paring knife', 'must', 'unit', 1),
  K('Kitchen tools', 'bread-knife', 'Bread knife', 'recommended', 'unit', 1),
  K('Kitchen tools', 'cutting-boards', 'Cutting boards', 'must', 'unit', 2, { big: 1 }),
  K('Kitchen tools', 'spatulas', 'Spatulas (one safe for nonstick)', 'must', 'unit', 2),
  K('Kitchen tools', 'wooden-spoons', 'Wooden spoons', 'must', 'unit', 2),
  K('Kitchen tools', 'ladle', 'Ladle', 'must', 'unit', 1),
  K('Kitchen tools', 'tongs', 'Tongs', 'must', 'unit', 1),
  K('Kitchen tools', 'whisk', 'Whisk', 'recommended', 'unit', 1),
  K('Kitchen tools', 'peeler', 'Vegetable peeler', 'recommended', 'unit', 1),
  K('Kitchen tools', 'grater', 'Grater', 'optional', 'unit', 1),
  K('Kitchen tools', 'can-opener', 'Can opener', 'must', 'unit', 1),
  H('Kitchen tools', 'corkscrew', 'Wine opener / bottle opener', 'must', 'unit', 1),
  K('Kitchen tools', 'shears', 'Kitchen shears', 'recommended', 'unit', 1),
  K('Kitchen tools', 'knife-block', 'Knife block (or magnetic strip)', 'recommended', 'unit', 1),
  K('Kitchen tools', 'slotted-spoon', 'Slotted spoon', 'recommended', 'unit', 1),
  K('Kitchen tools', 'measuring-cups', 'Measuring cups (set)', 'recommended', 'unit', 1),
  K('Kitchen tools', 'measuring-spoons', 'Measuring spoons (set)', 'recommended', 'unit', 1),
  K('Kitchen tools', 'oven-mitts', 'Oven mitts', 'must', 'unit', 2, { needs: ['oven'] }),
  K('Kitchen tools', 'trivets', 'Trivets / pot holders', 'recommended', 'unit', 2),
  K('Kitchen tools', 'utensil-holder', 'Utensil crock', 'recommended', 'unit', 1),
  // Small appliances
  H('Kitchen appliances', 'coffee-maker', 'Coffee maker (Nespresso or Keurig)', 'must', 'unit', 1, { big: 1 }),
  K('Kitchen appliances', 'toaster', 'Toaster', 'must', 'unit', 1),
  H('Kitchen appliances', 'kettle', 'Electric kettle', 'recommended', 'unit', 1),
  K('Kitchen appliances', 'blender', 'Blender', 'optional', 'unit', 1),
  // Kitchen essentials
  K('Kitchen essentials', 'dish-rack', 'Dish rack', 'recommended', 'unit', 1),
  K('Kitchen essentials', 'kitchen-trash', 'Kitchen trash can', 'must', 'unit', 1),
  K('Kitchen essentials', 'recycling', 'Recycling bin', 'recommended', 'unit', 1),
  K('Kitchen essentials', 'paper-towel-holder', 'Paper towel holder', 'must', 'unit', 1),
  K('Kitchen essentials', 'food-storage', 'Food storage containers (set)', 'recommended', 'unit', 1),
  // Bathroom
  H('Bathroom', 'hair-dryer', 'Hair dryer', 'must', 'bathroom', 1),
  H('Bathroom', 'bath-trash', 'Bathroom trash can with lid', 'must', 'bathroom', 1),
  H('Bathroom', 'plunger', 'Plunger', 'must', 'bathroom', 1),
  H('Bathroom', 'toilet-brush', 'Toilet brush', 'must', 'bathroom', 1),
  H('Bathroom', 'soap-dispensers', 'Soap / shampoo / conditioner dispensers', 'recommended', 'bathroom', 3),
  // Bedroom
  H('Bedroom', 'hangers', 'Hangers', 'must', 'bedroom', 20),
  H('Bedroom', 'luggage-rack', 'Luggage rack', 'recommended', 'bedroom', 1),
  H('Bedroom', 'iron', 'Iron', 'must', 'unit', 1),
  H('Bedroom', 'ironing-board', 'Ironing board', 'must', 'unit', 1),
  // Cleaning & safety
  H('Cleaning & safety', 'vacuum', 'Vacuum', 'must', 'unit', 1),
  H('Cleaning & safety', 'broom', 'Broom and dustpan', 'must', 'unit', 1),
  H('Cleaning & safety', 'mop', 'Mop', 'must', 'unit', 1),
  H('Cleaning & safety', 'smoke-alarms', 'Smoke alarms', 'must', 'bedroom', 1, { plus: 1, note: 'plus one outside the bedrooms; check local code' }),
  H('Cleaning & safety', 'co-alarm', 'Carbon monoxide alarm', 'recommended', 'unit', 1, { note: 'required with gas appliances or an attached garage' }),
  H('Cleaning & safety', 'extinguisher', 'Fire extinguisher', 'must', 'unit', 1, { note: 'in or near the kitchen' }),
  H('Cleaning & safety', 'first-aid', 'First aid kit', 'must', 'unit', 1),
  H('Cleaning & safety', 'flashlight', 'Flashlight', 'recommended', 'unit', 1),
  // Family & games
  H('Family & games', 'pack-n-play', 'Pack n play', 'recommended', 'unit', 1),
  H('Family & games', 'high-chair', 'High chair', 'optional', 'unit', 1),
  H('Family & games', 'playing-cards', 'Playing cards (decks)', 'recommended', 'unit', 2),
  H('Family & games', 'uno', 'Uno', 'recommended', 'unit', 1),
  H('Family & games', 'board-games', 'Board games', 'optional', 'unit', 2),
]

for (const it of NEED_ITEMS) if (GROUP_OF[it.key]) it.room = GROUP_OF[it.key]
const GROUP_ORDER = Object.keys(GROUP_OF)

function driver(per: NeedPer, z: KitSize): number {
  switch (per) {
    case 'settings': return z.guests * 2
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
    const big = z.guests >= BIG_HOME ? (it.big || 0) : 0
    const count = Math.max(it.min || 1, Math.ceil(it.n * d)) + (it.plus || 0) + big
    const base = it.per === 'settings' ? `${d} place settings (2 per guest)`
      : it.per === 'guest' ? (it.n === 1 ? `one per guest · ${plural(z.guests, 'guest')}` : it.n < 1 ? `one per ${Math.round(1 / it.n)} guests${it.min ? `, at least ${it.min}` : ''}` : `${it.n} per guest · ${plural(z.guests, 'guest')}`)
        : it.per === 'bedroom' ? `${it.n === 1 ? 'one' : it.n} per bedroom · ${plural(Math.max(1, z.bedrooms), 'bedroom')}`
          : it.per === 'bathroom' ? `${it.n === 1 ? 'one' : it.n} per bathroom · ${plural(Math.max(1, z.bathrooms), 'bathroom')}`
            : 'per home'
    const rule = [base, big ? `+${big} for ${BIG_HOME}+ guests` : '', it.note || ''].filter(Boolean).join(' · ')
    out.push({ item: it, tier, count, rule })
  }
  // By set, then in the order the set is written out in GROUP_OF (chef's knife before steak knives).
  const within = (k: string) => { const i = GROUP_ORDER.indexOf(k); return i < 0 ? 999 : i }
  return out.sort((a, b) => NEED_ROOMS.indexOf(a.item.room as any) - NEED_ROOMS.indexOf(b.item.room as any) || within(a.item.key) - within(b.item.key))
}

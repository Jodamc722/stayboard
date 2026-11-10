// HOW THE NEED LIST IS BOUGHT (Jon, 2026-11-10: "if it can be purchased in a set, have it as a set vs
// individual items… we also want links for purchases and have mid and lux options on Amazon").
//
// lib/need-list.ts says how many PIECES a home needs. This file turns that into what to BUY:
//   • SETS — things sold together: a dinnerware set (service for 4) covers plates, side plates, bowls
//     and mugs; a knife block set covers the chef's, bread and paring knives, steak knives, shears and
//     block. The number of sets comes from the set's CORE items (the ones every set is bought for);
//     any piece still short after the sets is bought separately ("+2 steak knives").
//   • PACKS — one item sold in a pack: glasses in fours, hangers in thirties. Packs = need ÷ pack size.
//   • SINGLES — everything else, one at a time.
// Each buy line has three Amazon links: Standard, Mid and Luxury. A link marked `pinned` is a product
// on Stay's own sourcing list (the starter kit); every other link is an Amazon SEARCH for that grade
// of the item (an invented product page would be a dead link — read lib/ffe-starter-catalog.ts).
// Isomorphic.
import { NEED_ITEMS, type NeedLine } from './need-list'

export type Grade = 'std' | 'mid' | 'lux'
export const GRADES: { k: Grade; label: string; hint: string }[] = [
  { k: 'std', label: 'Standard', hint: 'Durable, value-first' },
  { k: 'mid', label: 'Mid', hint: 'Better materials, Stay’s usual pick' },
  { k: 'lux', label: 'Luxury', hint: 'Premium brands and finishes' },
]
export type ShopLink = { url: string; pinned: boolean }
export type Shop = Record<Grade, ShopLink>

const search = (q: string): ShopLink => ({ url: 'https://www.amazon.com/s?k=' + encodeURIComponent(q), pinned: false })
const dp = (asin: string): ShopLink => ({ url: 'https://www.amazon.com/dp/' + asin, pinned: true })
/** Three searches from one base query and a grade word for each. */
const S = (base: string, std: string, mid: string, lux: string, pin?: Partial<Record<Grade, string>>): Shop => ({
  std: pin?.std ? dp(pin.std) : search(`${std} ${base}`.trim()),
  mid: pin?.mid ? dp(pin.mid) : search(`${mid} ${base}`.trim()),
  lux: pin?.lux ? dp(pin.lux) : search(`${lux} ${base}`.trim()),
})

// ── sets ─────────────────────────────────────────────────────────────────────────────────────────────
export type BuySet = { key: string; name: string; covers: Record<string, number>; core: string[]; shop: Shop }
export const BUY_SETS: BuySet[] = [
  { key: 'set-dinnerware', name: 'Dinnerware set, 16 piece (service for 4)', core: ['dinner-plates', 'bowls'],
    covers: { 'dinner-plates': 4, 'side-plates': 4, bowls: 4, mugs: 4 },
    shop: S('dinnerware set 16 piece service for 4', 'stoneware', 'porcelain', 'bone china') },
  { key: 'set-flatware', name: 'Flatware set, 20 piece (service for 4)', core: ['forks', 'table-knives', 'spoons', 'teaspoons'],
    covers: { forks: 4, 'salad-forks': 4, 'table-knives': 4, spoons: 4, teaspoons: 4 },
    shop: S('flatware set 20 piece service for 4', 'stainless steel', '18/10 stainless steel', 'forged 18/10 stainless hammered') },
  { key: 'set-knives', name: 'Knife block set (chef, bread, paring, 6 steak knives, shears, block)', core: ['chef-knife'],
    covers: { 'chef-knife': 1, 'bread-knife': 1, 'paring-knife': 1, 'steak-knives': 6, shears: 1, 'knife-block': 1 },
    shop: S('knife block set with steak knives and shears', 'stainless steel', 'german steel', 'japanese damascus', { mid: 'B0F66KYZXC' }) },
  { key: 'set-cookware', name: 'Cookware set (8 and 12 in frying pans, 2 saucepans, stock pot, lids)', core: ['fry-large'],
    covers: { 'fry-large': 1, 'fry-small': 1, saucepans: 2, 'stock-pot': 1 },
    shop: S('cookware set pots and pans with lids induction', 'nonstick', 'tri-ply stainless steel', 'All-Clad stainless', { mid: 'B096N69HWH' }) },
  { key: 'set-bakeware', name: 'Bakeware set (sheet pans, muffin tin)', core: ['sheet-pans'],
    covers: { 'sheet-pans': 2, 'muffin-tin': 1 },
    shop: S('bakeware set sheet pans muffin pan', 'nonstick', 'heavy duty aluminized steel', 'Nordic Ware commercial', { mid: 'B0FRSJ1ZPM' }) },
  { key: 'set-utensils', name: 'Cooking utensil set with crock', core: ['spatulas', 'ladle', 'tongs'],
    covers: { spatulas: 2, 'wooden-spoons': 2, 'slotted-spoon': 1, ladle: 1, tongs: 1, whisk: 1, 'utensil-holder': 1 },
    shop: S('cooking utensil set with holder spatula ladle tongs whisk', 'silicone', 'stainless steel', 'premium olivewood and stainless', { mid: 'B089W51DL1' }) },
  { key: 'set-measuring', name: 'Measuring cups and spoons set', core: ['measuring-cups', 'measuring-spoons'],
    covers: { 'measuring-cups': 1, 'measuring-spoons': 1 },
    shop: S('measuring cups and spoons set', 'plastic', 'stainless steel', 'heavy gauge stainless magnetic') },
  { key: 'set-bath-tools', name: 'Plunger and toilet brush set', core: ['plunger', 'toilet-brush'],
    covers: { plunger: 1, 'toilet-brush': 1 },
    shop: S('toilet plunger and bowl brush set with caddy', '', 'OXO Good Grips', 'simplehuman', { mid: 'B0FN92HJCD' }) },
]
const SET_OF: Record<string, BuySet> = {}
for (const s of BUY_SETS) for (const k of Object.keys(s.covers)) SET_OF[k] = s

// ── packs and singles: a pack size and three links for every item not bought in a set ────────────────
type ItemBuy = { pack?: number; packName?: string; shop: Shop }
const DISH = (b: string, pin?: Partial<Record<Grade, string>>) => S(b, '', 'premium', 'crystal', pin)
export const ITEM_BUY: Record<string, ItemBuy> = {
  'tall-glasses': { pack: 4, shop: DISH('highball glasses set of 4', { mid: 'B0F1VBRRK7' }) },
  'wine-glasses': { pack: 4, shop: DISH('stemmed wine glasses set of 4', { mid: 'B0F1VCC5QH' }) },
  'short-glasses': { pack: 4, shop: DISH('old fashioned glasses set of 4', { mid: 'B0F1VDX55D' }) },
  'cocktail-glasses': { pack: 4, shop: DISH('martini coupe cocktail glasses set of 4', { mid: 'B0C53VBN93' }) },
  'shot-glasses': { pack: 6, shop: DISH('shot glasses set of 6', { mid: 'B0C53SXD57' }) },
  'serving-bowls': { shop: S('large serving bowl', 'white ceramic', 'porcelain', 'stoneware artisan') },
  'serving-platter': { shop: S('serving platter oval', 'white ceramic', 'porcelain', 'stoneware artisan') },
  'serving-utensils': { pack: 4, packName: 'serving set of 4', shop: S('serving utensils set 4 piece spoon fork', 'stainless', '18/10 stainless', 'hammered gold stainless') },
  'baking-dish': { pack: 2, packName: 'set of 2', shop: S('baking dish casserole set of 2', 'glass', 'porcelain', 'Le Creuset stoneware') },
  'cutting-boards': { pack: 3, packName: 'set of 3', shop: S('cutting board set of 3', 'plastic dishwasher safe', 'double sided', 'end grain wood', { mid: 'B0F5NWZK92' }) },
  'mixing-bowls': { pack: 3, packName: 'nesting set', shop: S('mixing bowls set nesting with lids', 'plastic', 'stainless steel', 'glass Pyrex', { mid: 'B07KNTT2HN' }) },
  colander: { shop: S('colander', 'plastic', 'stainless steel', 'OXO stainless') },
  peeler: { shop: S('vegetable peeler', '', 'OXO Good Grips', 'Kuhn Rikon') },
  grater: { shop: S('box grater', '', 'stainless', 'Microplane') },
  'coffee-maker': { shop: S('pod coffee maker', 'Keurig K-Mini', "Nespresso Essenza Mini De'Longhi", 'Nespresso Vertuo', { mid: 'B06ZYSM2GR' }) },
  toaster: { shop: S('2 slice toaster', 'Hamilton Beach', 'Cuisinart stainless', 'Breville', { mid: 'B0000A1ZN1' }) },
  kettle: { shop: S('electric kettle', 'stainless', 'gooseneck temperature control', 'SMEG', { mid: 'B0BCF4BXHB' }) },
  blender: { shop: S('blender', 'Ninja', 'KitchenAid', 'Vitamix', { lux: 'B07CVRZ1YJ' }) },
  'can-opener': { shop: S('manual can opener', '', 'OXO Good Grips', 'Zyliss') },
  corkscrew: { shop: S('wine opener bottle opener', 'waiters corkscrew', 'lever corkscrew', 'electric wine opener') },
  'oven-mitts': { pack: 2, packName: 'pair', shop: S('oven mitts pair heat resistant', 'cotton', 'silicone', 'premium leather silicone') },
  trivets: { pack: 2, packName: 'set of 2', shop: S('trivets for hot pots set', 'silicone', 'cast iron', 'marble wood') },
  'dish-rack': { shop: S('dish drying rack', 'plastic', 'KitchenAid full size', 'simplehuman steel', { mid: 'B078JXFBDP' }) },
  'kitchen-trash': { shop: S('kitchen trash can 13 gallon with lid', 'plastic', 'stainless motion sensor', 'simplehuman', { mid: 'B07RYBNJG3' }) },
  recycling: { shop: S('recycling bin kitchen', 'plastic', 'stainless dual compartment', 'simplehuman dual') },
  'paper-towel-holder': { shop: S('paper towel holder countertop', '', 'stainless weighted', 'marble') , },
  'food-storage': { shop: S('food storage containers set with lids', 'plastic', 'glass', 'Pyrex glass') },
  'hair-dryer': { shop: S('hair dryer', 'Conair', 'ionic 1875W', 'Dyson Supersonic', { mid: 'B0B8YWGMPN' }) },
  'bath-trash': { pack: 2, packName: '2 pack', shop: S('bathroom trash can with lid small', 'plastic', 'touchless', 'simplehuman', { mid: 'B0DBLMHFJ8' }) },
  'soap-dispensers': { pack: 3, packName: 'set of 3', shop: S('shampoo conditioner body wash dispenser set of 3', 'plastic pump', 'ceramic', 'wall mounted brushed') },
  hangers: { pack: 30, packName: '30 pack', shop: S('hangers 30 pack', 'plastic', 'wooden', 'premium wooden suit'), },
  'luggage-rack': { shop: S('folding luggage rack', 'metal', 'wood', 'solid wood hotel', { mid: 'B0DLW514V1' }) },
  iron: { shop: S('steam iron', '', 'ceramic soleplate 1700W', 'Rowenta', { mid: 'B0DG441CZ5' }) },
  'ironing-board': { shop: S('ironing board full size', '', 'metal with iron rest', 'Brabantia', { mid: 'B0D8H13YNK' }) },
  vacuum: { shop: S('cordless stick vacuum', 'Bissell', 'Shark', 'Dyson', { lux: 'B0CT9552BL' }) },
  broom: { shop: S('broom and dustpan set', '', 'upright standing', 'OXO', { mid: 'B0BRK83JY7' }) },
  mop: { shop: S('mop', 'Swiffer Sweeper', 'Swiffer PowerMop', 'O-Cedar spin', { mid: 'B0C1DWC251' }) },
  'smoke-alarms': { shop: S('smoke alarm', 'battery', '10 year sealed battery', 'combination smoke and CO hardwired') },
  'co-alarm': { shop: S('carbon monoxide detector', 'plug in', '10 year battery', 'combination smoke and CO') },
  extinguisher: { shop: S('fire extinguisher home kitchen', '', 'rechargeable ABC', 'commercial grade') },
  'first-aid': { shop: S('first aid kit home', '', '200 piece', 'premium', { mid: 'B08P27LHJ4' }) },
  flashlight: { shop: S('LED flashlight', '', 'rechargeable', 'Streamlight') },
  'pack-n-play': { shop: S('pack and play portable crib', '', 'compact', 'Guava Lotus', { mid: 'B09ZDC8VF7' }) },
  'high-chair': { shop: S('high chair', 'IKEA style', 'folding', 'Stokke') },
  'playing-cards': { pack: 2, packName: '2 decks', shop: S('playing cards', 'Bicycle', 'plastic waterproof', 'premium linen', { mid: 'B071G7Y3XL' }) },
  uno: { shop: S('Uno card game', '', '', 'deluxe', { mid: 'B07DCXC193' }) },
  'board-games': { shop: S('family board games', 'classic', 'strategy', 'wooden luxury') },
  'serving-utensils-extra': { shop: S('serving utensils', '', '', '') },
}
const singleShop = (name: string): Shop => S(name.replace(/\(.*?\)/g, '').trim(), '', 'premium', 'luxury')

// ── the buy list ─────────────────────────────────────────────────────────────────────────────────────
export type BuyLine = {
  key: string; kind: 'set' | 'pack' | 'single'; name: string; group: string
  qty: number                 // how many to buy (sets, packs or pieces)
  pieces: number              // pieces it brings
  contents?: { key: string; name: string; per: number }[]   // a set's contents, per set
  shop: Shop
}

/** What to buy for one home, from its need list. Sets first where they apply, then packs and singles. */
export function buyList(lines: NeedLine[]): BuyLine[] {
  const need: Record<string, NeedLine> = {}
  for (const l of lines) need[l.item.key] = l
  const out: BuyLine[] = []
  const covered: Record<string, number> = {}
  for (const s of BUY_SETS) {
    const cores = s.core.filter(k => need[k])
    if (!cores.length) continue
    const qty = Math.max(...cores.map(k => Math.ceil(need[k].count / s.covers[k])))
    // Everything that comes in the set, whether or not this home asked for it (a flatware set has salad forks).
    const contents = Object.entries(s.covers).map(([k, per]) => ({ key: k, name: need[k]?.item.name || NEED_ITEMS.find(i => i.key === k)?.name || k, per }))
    for (const c of contents) covered[c.key] = qty * c.per
    out.push({ key: s.key, kind: 'set', name: s.name, group: need[cores[0]].item.room, qty, pieces: contents.reduce((a, c) => a + c.per * qty, 0), contents, shop: s.shop })
  }
  for (const l of lines) {
    const k = l.item.key
    const left = l.count - (covered[k] || 0)
    if (left <= 0) continue
    const b = ITEM_BUY[k]
    const extra = covered[k] != null
    if (b?.pack && b.pack > 1) {
      out.push({ key: k, kind: 'pack', name: `${l.item.name}, ${b.packName || 'set of ' + b.pack}${extra ? ' (beyond the set)' : ''}`, group: l.item.room, qty: Math.ceil(left / b.pack), pieces: Math.ceil(left / b.pack) * b.pack, shop: b.shop })
    } else {
      out.push({ key: k, kind: 'single', name: l.item.name + (extra ? ' (beyond the set)' : ''), group: l.item.room, qty: left, pieces: left, shop: b?.shop || singleShop(l.item.name) })
    }
  }
  return out
}

/** For the item rows: how a piece is bought in this home ("in the dinnerware set", "2 × set of 4"). */
export function howBought(buy: BuyLine[], key: string): string {
  const set = buy.find(b => b.kind === 'set' && b.contents?.some(c => c.key === key))
  const own = buy.find(b => b.key === key)
  const parts: string[] = []
  if (set) parts.push(`in the ${set.name.split(/[,(]/)[0].trim().toLowerCase()}`)
  if (own) parts.push(own.kind === 'pack' ? `${own.qty} × ${(ITEM_BUY[key]?.packName || 'set of ' + ITEM_BUY[key]?.pack)}` : `${own.qty} bought ${set ? 'separately' : 'individually'}`)
  return parts.join(' + ')
}
export const setOf = (key: string) => SET_OF[key] || null

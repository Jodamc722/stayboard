// STARTER KIT PROPOSALS (Jon, 2026-11-10): "make this a count of needed per bedroom, occupancy etc
// like the linen… an easy to use builder with options for them to choose from… a shareable link
// in Lighthouse… a new report, real nice, that we can share with a potential owner / client."
//
// One link per PROSPECT (or owner): the team enters the home's size, the client opens /kit/<code>
// and gets a finished report of everything Stay puts in the home, sized to it. A MUST-HAVE means the
// home needs the item, not that it must be our product (Jon, 2026-11-10): every line can be our pick,
// a product the client links to, or one they provide themselves. Must-haves are always
// in; recommended items are in unless the client takes them out; optional items are out unless they
// add them. Any item can be swapped for a product the client links to. "Send to Stay" saves the
// selection with their name, and the team sees it on Onboarding → Starter kits.
//
// This file is the vocabulary and the arithmetic, isomorphic (no server imports) so the report, the
// team desk and the API all compute the same numbers. Storage is lib/starter-kit-server.ts.
//
// THE PRODUCTS are Jon's sourcing list (Amazon, Feb 2026 prices). Consumables are left out on
// purpose (owner lists never carry them), and so is linen (Jon, 2026-11-10: "Linen quote should not
// live here. That is separate") — linen is its own quote and expense, on Onboarding → Linens.

export type KitTier = 'must' | 'recommended' | 'optional'
/** What a line scales with. `settings` is place settings: 1.5 per guest, so a turn never runs short. */
export type KitPer = 'unit' | 'bedroom' | 'bathroom' | 'guest' | 'settings'
/** One model to choose from on an item that offers a choice (the coffee maker: Nespresso or Keurig). */
export type KitOption = { id: string; group: string; name: string; detail: string; price: number; url: string; approx: boolean }
export type KitItem = {
  key: string; category: string; name: string; tier: KitTier; detail: string
  price: number | null; asin: string | null
  per: KitPer; base: number; each: number            // qty = ceil(base × driver ÷ each)
  options?: KitOption[]; note?: string                // a choice of models; the first is Stay's default
  kitchen?: boolean                                   // only in a home with a kitchen
  needs?: KitAppliance[]                              // only when the home has all of these
}
/** The home's kitchen (Jon, 2026-11-10: "if kitchen selected it should default to full: stove, oven
 *  etc. They can unselect the appliances. That should impact the list"). No kitchen keeps coffee,
 *  drinkware and everything outside the kitchen; each missing appliance drops the items that need it. */
export type KitAppliance = 'stove' | 'oven' | 'microwave' | 'fridge' | 'dishwasher'
export const APPLIANCES: { k: KitAppliance; label: string }[] = [
  { k: 'stove', label: 'Stove / cooktop' }, { k: 'oven', label: 'Oven' }, { k: 'microwave', label: 'Microwave' },
  { k: 'fridge', label: 'Refrigerator' }, { k: 'dishwasher', label: 'Dishwasher' },
]
export type KitSize = { bedrooms: number; bathrooms: number; guests: number; kitchen: boolean; appliances: Record<KitAppliance, boolean> }
export type KitSelection = { inc: Record<string, boolean>; qty: Record<string, number>; own: Record<string, string>; pick: Record<string, string>; self: Record<string, boolean>; have: Record<string, number> }

export const KIT_CATEGORIES = ['Kitchen appliances', 'Cookware & prep', 'Dining & glassware', 'Kitchen essentials', 'Cleaning & safety', 'Bedroom & guest comfort', 'Games'] as const

const I = (category: string, key: string, name: string, tier: KitTier, detail: string, price: number | null, asin: string | null, per: KitPer = 'unit', base = 1, each = 1): KitItem =>
  ({ key, category, name, tier, detail, price, asin, per, base, each })

// POD COFFEE ONLY (Jon, 2026-11-10: "Pod coffee, Keurig or Nespresso only option. Have 3 per type").
// The Essenza Mini is the product on Jon's sourcing list. The other five are Amazon searches for the
// exact model at its typical list price (approx: true) until someone pastes the product page over
// the search — the report says these are confirmed before anything is ordered.
const amzSearch = (q: string) => 'https://www.amazon.com/s?k=' + encodeURIComponent(q)
const COFFEE: KitOption[] = [
  { id: 'nes-essenza', group: 'Nespresso', name: "Nespresso Essenza Mini by De'Longhi", detail: 'Compact espresso and lungo, Original pods', price: 154.99, url: 'https://www.amazon.com/dp/B06ZYSM2GR', approx: false },
  { id: 'nes-vertuo-next', group: 'Nespresso', name: "Nespresso Vertuo Next by De'Longhi", detail: 'Coffee and espresso, five cup sizes, Vertuo pods', price: 179, url: amzSearch("Nespresso Vertuo Next De'Longhi"), approx: true },
  { id: 'nes-vertuo-plus', group: 'Nespresso', name: "Nespresso VertuoPlus by De'Longhi", detail: 'Larger water tank, coffee and espresso, Vertuo pods', price: 199, url: amzSearch("Nespresso VertuoPlus De'Longhi"), approx: true },
  { id: 'keu-mini', group: 'Keurig', name: 'Keurig K-Mini', detail: 'Slim single-serve, 6 to 12 oz, K-Cup pods', price: 99.99, url: amzSearch('Keurig K-Mini single serve coffee maker'), approx: true },
  { id: 'keu-elite', group: 'Keurig', name: 'Keurig K-Elite', detail: 'Strong brew and iced setting, 75 oz reservoir, K-Cup pods', price: 189.99, url: amzSearch('Keurig K-Elite coffee maker'), approx: true },
  { id: 'keu-supreme-smart', group: 'Keurig', name: 'Keurig K-Supreme Plus SMART', detail: 'Adjustable strength and temperature, 78 oz reservoir, K-Cup pods', price: 199.99, url: amzSearch('Keurig K-Supreme Plus SMART coffee maker'), approx: true },
]

export const KIT_ITEMS: KitItem[] = [
  { ...I('Kitchen appliances', 'coffee', 'Coffee maker', 'must', 'Pod coffee: choose Nespresso or Keurig', 154.99, 'B06ZYSM2GR'),
    note: 'It has to be a Nespresso or Keurig pod machine, and we supply the pods. Pick a model below, or send us a link to (or provide) any Nespresso or Keurig machine you prefer.',
    options: COFFEE },
  I('Kitchen appliances', 'toaster', 'Toaster', 'must', 'Cuisinart 4-slice, stainless steel', 79.95, 'B0000A1ZN1'),
  I('Kitchen appliances', 'kettle', 'Electric kettle', 'recommended', 'Gooseneck kettle with temperature control', 59.49, 'B0BCF4BXHB'),
  I('Kitchen appliances', 'blender', 'Blender', 'optional', 'Vitamix Explorian E310, 48 oz', 329.99, 'B07CVRZ1YJ'),
  I('Cookware & prep', 'pots', 'Pots & pans set', 'must', 'Tramontina tri-ply stainless, 14 piece, induction ready', 349.95, 'B096N69HWH'),
  I('Cookware & prep', 'utensils', 'Cooking utensil set', 'must', 'Stainless steel, 28 piece', 49.99, 'B089W51DL1'),
  I('Cookware & prep', 'knives', 'Knife set', 'must', 'KINGSTONE 14 piece with block', 129.99, 'B0F66KYZXC'),
  I('Cookware & prep', 'boards', 'Cutting boards', 'must', 'Double-sided titanium, set of 3', 56.89, 'B0F5NWZK92'),
  I('Cookware & prep', 'mitts', 'Oven mitts', 'must', '2 pack, included with the kit', 0, null),
  I('Cookware & prep', 'baking', 'Baking set', 'recommended', 'Kikcoin 25 piece non-stick bakeware', 79.98, 'B0FRSJ1ZPM'),
  I('Cookware & prep', 'bowls', 'Mixing bowls', 'recommended', 'WHYSKO stainless, 5 piece', 27.99, 'B07KNTT2HN'),
  I('Cookware & prep', 'measure', 'Measuring cups', 'recommended', 'Pyrex 1, 2 and 4 cup', 25.99, 'B00M2J7PCI'),
  I('Cookware & prep', 'casserole', 'Casserole dishes', 'optional', 'MALACASA porcelain, set of 4', 57.89, 'B08T99DPF3'),
  I('Cookware & prep', 'holder', 'Utensil holder', 'optional', 'Stainless, rotating', 23.39, 'B0C7LNY55Z'),
  I('Dining & glassware', 'flatware', 'Flatware set', 'must', 'KINGSTONE hammered, 45 piece (service for 8)', 219.99, 'B0DTHFTVJ5', 'settings', 1, 8),
  I('Dining & glassware', 'dinner', 'Dinnerware set', 'must', 'KINGSTONE bone china, 12 piece (service for 4)', 89.98, 'B0FL748473', 'settings', 1, 4),
  I('Dining & glassware', 'tall', 'Tall glasses', 'must', 'Oneida highball, set of 4', 17.81, 'B0F1VBRRK7', 'settings', 1, 4),
  I('Dining & glassware', 'wine', 'Wine glasses', 'must', 'Oneida stemmed all-purpose, set of 4', 21.99, 'B0F1VCC5QH', 'guest', 1, 4),
  I('Dining & glassware', 'mugs', 'Coffee mugs', 'must', 'Oneida white, set of 4', 19.99, 'B0C53V5361', 'guest', 1, 4),
  I('Dining & glassware', 'short', 'Short glasses', 'recommended', 'Oneida old fashioned, set of 4', 21.99, 'B0F1VDX55D', 'guest', 1, 4),
  I('Dining & glassware', 'cocktail', 'Cocktail glasses', 'optional', 'Oneida stemmed, set of 4', 28.93, 'B0C53VBN93', 'guest', 1, 4),
  I('Dining & glassware', 'shot', 'Shot glasses', 'optional', 'Oneida stackable, set of 6', 9.15, 'B0C53SXD57', 'guest', 1, 6),
  I('Dining & glassware', 'bar', 'Cocktail set', 'optional', 'Bare Barrel, 14 piece', 69.99, 'B0CRXCRBNZ'),
  I('Kitchen essentials', 'ktrash', 'Kitchen trash can', 'must', 'EKO Mirage-T 13.2 gal, motion sensor', 79.99, 'B07RYBNJG3'),
  I('Kitchen essentials', 'towel', 'Paper towel holder', 'must', 'Stainless, weighted base', 8.99, 'B09KNDHMC1'),
  I('Kitchen essentials', 'rack', 'Dish rack', 'recommended', 'KitchenAid full-size, rust resistant', 73.40, 'B078JXFBDP'),
  I('Cleaning & safety', 'vacuum', 'Vacuum', 'must', 'Dyson V8 cordless', 349.99, 'B0CT9552BL'),
  I('Cleaning & safety', 'broom', 'Broom & dustpan', 'must', 'Upright with stand', 26.99, 'B0BRK83JY7'),
  I('Cleaning & safety', 'mop', 'Mop', 'must', 'Swiffer PowerMop', 29.94, 'B0C1DWC251'),
  I('Cleaning & safety', 'plunger', 'Plunger & toilet brush set', 'must', 'OXO Good Grips', 44.99, 'B0FN92HJCD', 'bathroom'),
  I('Cleaning & safety', 'btrash', 'Bathroom trash cans', 'must', 'Touchless 2.7 gal, 2 pack', 29.97, 'B0DBLMHFJ8', 'bathroom', 1, 2),
  I('Cleaning & safety', 'aid', 'First aid kit', 'must', 'Home first aid kit', 20.87, 'B08P27LHJ4'),
  I('Bedroom & guest comfort', 'hangers', 'Hangers', 'must', 'Amber Home wooden, 30 pack', 36.99, 'B08W2BHHKC', 'bedroom', 20, 30),
  I('Bedroom & guest comfort', 'iron', 'Iron', 'must', 'PurSteam 1750W, ceramic soleplate', 55.99, 'B0DG441CZ5'),
  I('Bedroom & guest comfort', 'board', 'Ironing board', 'must', 'Full metal, 43 x 13 in, with iron rest', 59.98, 'B0D8H13YNK'),
  I('Bedroom & guest comfort', 'dryer', 'Hair dryer', 'must', 'TYMO 1500W with diffuser', 139.99, 'B0B8YWGMPN', 'bathroom'),
  I('Bedroom & guest comfort', 'luggage', 'Luggage racks', 'recommended', 'Assembled walnut-finish bamboo, set of 2', 101.98, 'B0DLW514V1', 'bedroom', 1, 2),
  I('Bedroom & guest comfort', 'pnp', 'Pack n play', 'recommended', 'Pamo Babe compact', 62.69, 'B09ZDC8VF7'),
  I('Games', 'cards', 'Playing cards', 'recommended', '16 decks', 16.99, 'B071G7Y3XL'),
  I('Games', 'uno', 'Uno', 'recommended', '2 pack', 14.40, 'B07DCXC193'),
  I('Games', 'chess', 'Chess', 'optional', 'Wooden, with storage', 28.99, 'B01256V578'),
  I('Games', 'backgammon', 'Backgammon', 'optional', 'Classic portable set', 29.99, 'B0CFXGNFTJ'),
  I('Games', 'jenga', 'Jenga', 'optional', 'Classic', 12.69, 'B0D87PKYYK'),
  I('Games', 'monopoly', 'Monopoly', 'optional', 'Family edition', 14.97, 'B0B5HLZ8T4'),
]
// What each kitchen item depends on. Anything not listed here belongs in every home.
const KITCHEN_RULES: Record<string, { needs?: KitAppliance[] }> = {
  toaster: {}, blender: {}, utensils: {}, knives: {}, boards: {}, holder: {}, bowls: {}, measure: {},
  flatware: {}, dinner: {}, ktrash: {}, towel: {}, rack: {},
  pots: { needs: ['stove'] }, mitts: { needs: ['oven'] }, baking: { needs: ['oven'] }, casserole: { needs: ['oven'] },
}
for (const it of KIT_ITEMS) { const r = KITCHEN_RULES[it.key]; if (r) { it.kitchen = true; it.needs = r.needs } }
const BY_KEY = new Map(KIT_ITEMS.map(i => [i.key, i]))
/** Does this home need the item at all? (The kitchen and its appliances decide; size never does.) */
export const appliesTo = (it: KitItem, z: KitSize) => (!it.kitchen || z.kitchen) && (!it.needs || it.needs.every(a => z.kitchen && z.appliances[a]))
/** The items this home needs, with the tier that applies to it: a dish rack is a must without a dishwasher. */
export const itemsFor = (z: KitSize): KitItem[] => KIT_ITEMS.filter(it => appliesTo(it, z))
  .map(it => (it.key === 'rack' && !z.appliances.dishwasher ? { ...it, tier: 'must' as KitTier } : it))

export type KitCount = 'bedrooms' | 'bathrooms' | 'guests'
export const SIZE_LIMITS: Record<KitCount, [number, number]> = { bedrooms: [0, 12], bathrooms: [1, 12], guests: [1, 30] }
export const DEFAULT_SIZE: KitSize = { bedrooms: 2, bathrooms: 2, guests: 6, kitchen: true, appliances: { stove: true, oven: true, microwave: true, fridge: true, dishwasher: true } }
export const EMPTY_SELECTION: KitSelection = { inc: {}, qty: {}, own: {}, pick: {}, self: {}, have: {} }

export const amazonUrl = (asin: string) => 'https://www.amazon.com/dp/' + asin
const clampInt = (v: any, lo: number, hi: number, dflt: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt }

export function normSize(raw: any): KitSize {
  const r = raw && typeof raw === 'object' ? raw : {}
  const out = {} as KitSize
  for (const k of Object.keys(SIZE_LIMITS) as KitCount[]) out[k] = clampInt(r[k], SIZE_LIMITS[k][0], SIZE_LIMITS[k][1], DEFAULT_SIZE[k])
  out.kitchen = typeof r.kitchen === 'boolean' ? r.kitchen : DEFAULT_SIZE.kitchen
  const a = r.appliances && typeof r.appliances === 'object' ? r.appliances : {}
  out.appliances = { ...DEFAULT_SIZE.appliances }
  for (const x of APPLIANCES) if (typeof a[x.k] === 'boolean') out.appliances[x.k] = a[x.k]
  return out
}

/** A product link a client pasted: http(s) only, one line, capped. Anything else is dropped. */
export function normLink(v: any): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > 600 || /\s/.test(s)) return null
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null } catch { return null }
}

/** Keeps only known item keys and sane values, so a hand-crafted POST cannot store junk. */
export function normSelection(raw: any): KitSelection {
  const r = raw && typeof raw === 'object' ? raw : {}
  const out: KitSelection = { inc: {}, qty: {}, own: {}, pick: {}, self: {}, have: {} }
  for (const [k, v] of Object.entries(r.inc || {})) { const it = BY_KEY.get(k); if (it && (it.tier !== 'must' || it.key === 'rack') && typeof v === 'boolean') out.inc[k] = v }
  for (const [k, v] of Object.entries(r.qty || {})) { const it = BY_KEY.get(k); if (it) { const n = clampInt(v, 1, 99, 0); if (n) out.qty[k] = n } }
  for (const [k, v] of Object.entries(r.own || {})) { const it = BY_KEY.get(k); const l = normLink(v); if (it && it.price !== 0 && l) out.own[k] = l }
  for (const [k, v] of Object.entries(r.self || {})) { const it = BY_KEY.get(k); if (it && it.price !== 0 && v === true) { out.self[k] = true; delete out.own[k] } }
  for (const [k, v] of Object.entries(r.have || {})) { const it = BY_KEY.get(k); if (it) { const n = clampInt(v, 0, 999, 0); if (n) out.have[k] = n } }
  for (const [k, v] of Object.entries(r.pick || {})) { const it = BY_KEY.get(k); if (it?.options?.some(o => o.id === v)) out.pick[k] = String(v) }
  return out
}

function driver(it: KitItem, z: KitSize): number {
  switch (it.per) {
    case 'bedroom': return Math.max(1, z.bedrooms)
    case 'bathroom': return Math.max(1, z.bathrooms)
    case 'guest': return z.guests
    case 'settings': return Math.ceil(z.guests * 1.5)
    default: return 1
  }
}
export const suggestedQty = (it: KitItem, z: KitSize) => Math.max(1, Math.ceil(it.base * driver(it, z) / it.each))

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
/** The rule in words, for the client: why this many. */
export function ruleText(it: KitItem, z: KitSize): string {
  switch (it.per) {
    case 'settings': return `${driver(it, z)} place settings for ${plural(z.guests, 'guest')}`
    case 'guest': return `One per guest · ${plural(z.guests, 'guest')}`
    case 'bedroom': return it.base > 1 ? `${it.base} per bedroom · ${plural(Math.max(1, z.bedrooms), 'bedroom')}` : `One per bedroom · ${plural(Math.max(1, z.bedrooms), 'bedroom')}`
    case 'bathroom': return `One per bathroom · ${plural(Math.max(1, z.bathrooms), 'bathroom')}`
    default: return 'One per home'
  }
}

/** Who supplies a line: Stay buys our pick, Stay buys the product the client linked, or the client provides it. */
export type KitSource = 'stay' | 'link' | 'self'
/** One line of the inventory: how many the home needs (qty), how many it already has, and what is left to buy. */
export type KitLine = { item: KitItem; included: boolean; qty: number; suggested: number; have: number; toBuy: number; own: string | null; total: number | null; source: KitSource
  option: KitOption | null; price: number | null; detail: string; url: string | null }

/** The model chosen on an item with options (Stay's default is the first). */
export const pickedOption = (it: KitItem, s: KitSelection): KitOption | null => it.options?.length ? (it.options.find(o => o.id === s.pick?.[it.key]) || it.options[0]) : null
export type KitTotals = { must: number; addOns: number; items: number; toBuy: number; covered: number; total: number; ownLinks: number; selfSupplied: number; lines: KitLine[] }

export function lineFor(it: KitItem, z: KitSize, s: KitSelection): KitLine {
  const suggested = suggestedQty(it, z)
  const qty = s.qty[it.key] ?? suggested
  const self = !!s.self?.[it.key]
  const own = self ? null : (s.own[it.key] || null)
  const source: KitSource = self ? 'self' : own ? 'link' : 'stay'
  const included = it.tier === 'must' ? true : (s.inc[it.key] ?? it.tier === 'recommended')
  const option = pickedOption(it, s)
  const price = option ? option.price : it.price
  const have = s.have?.[it.key] || 0
  const toBuy = self ? 0 : Math.max(0, qty - have)
  const total = own || self || price == null ? null : Math.round(toBuy * price * 100) / 100
  const url = own || option?.url || (it.asin ? amazonUrl(it.asin) : null)
  return { item: it, included, qty, suggested, have, toBuy, own, total, source, option, price, detail: option ? option.name : it.detail, url }
}

export function kitTotals(z: KitSize, s: KitSelection): KitTotals {
  let must = 0, addOns = 0, items = 0, toBuy = 0, covered = 0, ownLinks = 0, selfSupplied = 0
  const lines = itemsFor(z).map(it => lineFor(it, z, s))
  for (const l of lines) {
    if (!l.included) continue
    items++
    if (l.toBuy > 0) toBuy++; else covered++
    if (l.own) ownLinks++
    if (l.source === 'self') selfSupplied++
    if (l.item.tier === 'must') must += l.total || 0; else addOns += l.total || 0
  }
  const r = (n: number) => Math.round(n * 100) / 100
  return { must: r(must), addOns: r(addOns), items, toBuy, covered, total: r(must + addOns), ownLinks, selfSupplied, lines }
}

export const fmtMoney = (n: number, cents = true) => '$' + n.toLocaleString('en-US', cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })
export const describeSize = (z: KitSize) => [z.bedrooms === 0 ? 'Studio' : plural(z.bedrooms, 'bedroom'), plural(z.bathrooms, 'bath'), plural(z.guests, 'guest'), kitchenText(z)].join(' · ')
export function kitchenText(z: KitSize): string {
  if (!z.kitchen) return 'no kitchen'
  const missing = APPLIANCES.filter(a => !z.appliances[a.k]).map(a => a.label.split(' /')[0].toLowerCase())
  return missing.length ? `kitchen without ${missing.join(', ')}` : 'full kitchen'
}

/** What a link carries — the team's side and the client's side. */
export type KitLink = {
  code: string; client: string; property: string; message: string; size: KitSize; sizeLocked: boolean
  setupFee: number | null                      // delivery, assembly and installation, when the team quotes it
  preparedBy: string; createdAt: string; revokedAt: string | null
  views: number; lastView: string | null
  selection: KitSelection; savedAt: string | null
  submitted: { name: string; email: string; note: string; at: string; total: number; items: number } | null
}
/** The client's view of a link: everything but who on the team made it and the view counter. */
export type KitPublic = Omit<KitLink, 'views' | 'lastView' | 'revokedAt' | 'createdAt'> & { createdAt: string }
export const KIT_CODE = /^[0-9a-f]{20}$/

// ONBOARDING COST ESTIMATE (Jon, 2026-11-20: "build a cheat sheet for average onboarding cost… this is for sales…
// build this into a calculator, sales can enter bedroom, kitchen, square footage… build it in app").
//
// What it costs to get a FULLY FURNISHED new unit guest-ready, in three lines:
//   LINEN      cost per item × our par level (Jon: "calculate based on cost per item and use our par level").
//              Quantities and piece prices both come from the saved linen standard (lib/linens.ts) — one
//              source of truth — then sales tax and an allowance on top (Jon: "increase linen estimate 15%").
//   CLEAN      the one-time onboarding clean: $200 studio, $250 one bedroom (Jon). Larger units and the
//              square-foot rule are settings, because Jon has not set them yet.
//   INVENTORY  THE INVENTORY CALCULATOR, PRICED (Jon, 2026-11-21: "use inventory calculator for estimates…
//              depending on occupancy things should fluctuate, make sure to increase cups"; then "your
//              pricing is all out of whack: standard is basic, mid is mid tier and lux is top tier… should
//              look like the onboarding calculator but giving estimates to the sales team"). The list and
//              every count are the need list's (lib/need-list.ts), bought the way lib/need-buy.ts buys it
//              (sets, packs, singles). This file only adds a price per buy line at each grade: PRICE_BOOK.
//
// THE THREE GRADES are the calculator's own (lib/need-buy.ts GRADES): Standard is durable and value-first,
// Mid is Stay's usual pick, Luxury is premium brands. Mid is the price on Stay's sourcing list wherever the
// calculator pins a "Stay's pick"; Standard and Luxury are typical retail for the kind of product the
// calculator shops for at that grade (nonstick → tri-ply → All-Clad). Whole dollars, an estimate, and every
// one can be overridden on the page (settings.prices) without a deploy.
//
// CONSUMABLES ARE OURS (Jon: "consumables we supply"): the need list carries none, and the soap dispensers
// it does carry are supplied by us, so they are never on an estimate.
// APPLIANCES ARE NOT PRICED (Jon: "we don't need appliances, we need to know appliances for inventory"):
// what the kitchen has only shapes the list, exactly as on the calculator. Furniture and TVs are assumed.
//
// Pure and isomorphic: no runtime imports (plain node runs the test against this very file), and no
// supplier quote in this file — linen prices live in the saved linen standard. The caller prices the linen
// with lib/linens.ts linenQuote and builds the buy rows with lib/onboard-estimate-list.ts, then hands both in.
// Tested in lib/__tests__/onboard-estimate.test.mjs.
import type { LinenTier, LinenTotalRow, LinenUnit } from './linens'
import type { KitAppliance, KitSize } from './starter-kit'

const SOFA_BED = 'Sofa bed'   // lib/linens.ts SOFA_BED

export const ESTIMATE_SETTINGS_KEY = 'onboard_estimate'   // app_settings: EstSettings

export type EstLevel = 'standard' | 'mid' | 'luxury'
export type EstTier = 'must' | 'recommended' | 'optional'
export const EST_LEVELS: EstLevel[] = ['standard', 'mid', 'luxury']
export const EST_LEVEL_LABEL: Record<EstLevel, string> = { standard: 'Standard', mid: 'Mid', luxury: 'Luxury' }
export const EST_LEVEL_HINT: Record<EstLevel, string> = { standard: 'Basic: durable, value-first', mid: 'Mid tier: Stay’s usual pick', luxury: 'Top tier: premium brands' }
/** The linen standard's tiers under the names sales uses (Jon: Broward is standard, Miami is mid, Salato is the only luxury). */
export const LINEN_TIER_OF: Record<EstLevel, LinenTier> = { standard: 'low', mid: 'mid', luxury: 'lux' }
/** The calculator's shopping grade for each level (lib/need-buy.ts Grade). */
export const GRADE_OF: Record<EstLevel, 'std' | 'mid' | 'lux'> = { standard: 'std', mid: 'mid', luxury: 'lux' }
export const EST_BEDS = ['King', 'Queen', 'Full', 'Twin', SOFA_BED] as const
const APPS: KitAppliance[] = ['stove', 'oven', 'microwave', 'fridge', 'dishwasher']
/**
 * ONE LEVEL PER UNIT (Jon, 2026-11-20: "make sure product and inventory changes per mid or lux units and
 * standard"). The level picks the linen tier and the product on every inventory line; a luxury unit also
 * starts with the optional extras. The extras stay a choice the user can change.
 */
export const OPTIONAL_FOR_LEVEL: Record<EstLevel, boolean> = { standard: false, mid: false, luxury: true }

export type EstInput = {
  bedrooms: number                    // 0 = studio
  beds: Record<string, number>        // King / Queen / Full / Twin / Sofa bed → count
  baths: number                       // 1, 1.5, 2 …
  guests: number
  kitchen: boolean
  appliances: Record<KitAppliance, boolean>   // what the kitchen has: shapes the list, never priced
  optional: boolean                   // the calculator's "optional extras"
  sqft: number                        // 0 = not given
  level: EstLevel                     // standard / mid / luxury: the linen tier AND the product on every inventory line
  par: number                         // linen sets in rotation for this estimate; 0 = the saved standard's par (Jon: "be able to adjust the par level for linen")
}

export type EstSettings = {
  cleanStudio: number
  clean1br: number
  cleanPerExtraBedroom: number        // each bedroom past the first
  sqftStep: number                    // a block of square feet over the typical size…
  sqftStepCost: number                // …adds this much to the clean (0 switches the rule off)
  typicalSqft: number[]               // by bedroom count, studio first
  taxPct: number                      // sales tax on linen
  linenUpliftPct: number              // allowance on top of the linen (Jon, 2026-11-20: "increase linen estimate 15%")
  /** Prices typed on the page: buy line key → [standard, mid, luxury]. Only the overrides; the rest is PRICE_BOOK. */
  prices: Record<string, [number, number, number]>
  updatedAt?: string
  updatedBy?: string
}

export const DEFAULT_EST_SETTINGS: EstSettings = {
  cleanStudio: 200, clean1br: 250, cleanPerExtraBedroom: 50,
  sqftStep: 250, sqftStepCost: 25, typicalSqft: [600, 900, 1300, 1800, 2300],
  taxPct: 7, linenUpliftPct: 15,
  prices: {},
}

const fin = (v: any, fb: number, lo = 0, hi = 1e6) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fb }
const r2 = (n: number) => Math.round(n * 100) / 100
const lvl = (l: EstLevel) => Math.max(0, EST_LEVELS.indexOf(l))
const PRICE_KEY = /^[a-z0-9-]{1,40}$/

/** A saved settings blob made safe: every number clamped, every list bounded, unknown keys dropped. */
export function normEstSettings(raw: any): EstSettings {
  const d = DEFAULT_EST_SETTINGS, s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const prices: EstSettings['prices'] = {}
  if (s.prices && typeof s.prices === 'object' && !Array.isArray(s.prices)) {
    for (const [k, v] of Object.entries(s.prices).slice(0, 200)) {
      if (!PRICE_KEY.test(k) || !Array.isArray(v) || v.length !== 3 || v.some(x => !Number.isFinite(Number(x)) || Number(x) < 0)) continue
      prices[k] = [r2(fin(v[0], 0, 0, 100000)), r2(fin(v[1], 0, 0, 100000)), r2(fin(v[2], 0, 0, 100000))]
    }
  }
  const typical = Array.isArray(s.typicalSqft) && s.typicalSqft.length ? s.typicalSqft.slice(0, 10).map((x: any, i: number) => fin(x, d.typicalSqft[Math.min(i, d.typicalSqft.length - 1)], 100, 20000)) : d.typicalSqft.slice()
  const out: EstSettings = {
    cleanStudio: fin(s.cleanStudio, d.cleanStudio, 0, 5000), clean1br: fin(s.clean1br, d.clean1br, 0, 5000), cleanPerExtraBedroom: fin(s.cleanPerExtraBedroom, d.cleanPerExtraBedroom, 0, 2000),
    sqftStep: fin(s.sqftStep, d.sqftStep, 0, 5000), sqftStepCost: fin(s.sqftStepCost, d.sqftStepCost, 0, 1000), typicalSqft: typical,
    taxPct: fin(s.taxPct, d.taxPct, 0, 25), linenUpliftPct: fin(s.linenUpliftPct, d.linenUpliftPct, 0, 100),
    prices,
  }
  if (typeof s.updatedAt === 'string') out.updatedAt = s.updatedAt.slice(0, 40)
  if (typeof s.updatedBy === 'string') out.updatedBy = s.updatedBy.slice(0, 120)
  return out
}

// ── the unit ────────────────────────────────────────────────────────────────────────────────────
export function guestsFromBeds(beds: Record<string, number>): number {
  const n = (k: string) => Math.max(0, Math.round(Number(beds[k]) || 0))
  return Math.max(1, 2 * (n('King') + n('Queen') + n('Full') + n(SOFA_BED)) + n('Twin'))
}
const allApps = (on: boolean) => Object.fromEntries(APPS.map(a => [a, on])) as Record<KitAppliance, boolean>
/** A typical unit of this size: one King, a Queen in each further bedroom, a full kitchen. */
export function estDefaults(bedrooms: number): EstInput {
  const b = Math.max(0, Math.min(8, Math.round(Number(bedrooms) || 0)))
  const beds: Record<string, number> = { King: 1 }
  if (b > 1) beds.Queen = b - 1
  return { bedrooms: b, beds, baths: [1, 1, 2, 2, 3][Math.min(b, 4)], guests: guestsFromBeds(beds), kitchen: true, appliances: allApps(true), optional: OPTIONAL_FOR_LEVEL.mid, sqft: 0, level: 'mid', par: 0 }
}
export function normEstInput(raw: any): EstInput {
  const s = raw && typeof raw === 'object' ? raw : {}
  const d = estDefaults(Number(s.bedrooms) || 0)
  const beds: Record<string, number> = {}
  for (const k of EST_BEDS) { const n = Math.round(fin(s.beds?.[k], 0, 0, 20)); if (n > 0) beds[k] = n }
  if (!Object.keys(beds).length) beds.King = 1
  const level: EstLevel = EST_LEVELS.includes(s.level) ? s.level : 'mid'
  const appliances = allApps(true)
  if (s.appliances && typeof s.appliances === 'object') for (const a of APPS) if (typeof s.appliances[a] === 'boolean') appliances[a] = s.appliances[a]
  return {
    bedrooms: d.bedrooms, beds, baths: Math.round(fin(s.baths, d.baths, 1, 20) * 2) / 2, guests: Math.round(fin(s.guests, guestsFromBeds(beds), 1, 30)),
    kitchen: typeof s.kitchen === 'boolean' ? s.kitchen : true, appliances, optional: typeof s.optional === 'boolean' ? s.optional : OPTIONAL_FOR_LEVEL[level],
    sqft: Math.round(fin(s.sqft, 0, 0, 50000)), level, par: Math.round(fin(s.par, 0, 0, 6) * 2) / 2,
  }
}
export const unitLabel = (bedrooms: number) => bedrooms <= 0 ? 'Studio' : bedrooms + ' bedroom'
export function bedsText(beds: Record<string, number>): string {
  return EST_BEDS.filter(k => beds[k] > 0).map(k => beds[k] + ' ' + (k === SOFA_BED ? 'sofa bed' : k)).join(', ')
}
/** The unit as the inventory calculator reads it (lib/starter-kit.ts KitSize). */
export function kitSizeOf(i: EstInput): KitSize {
  const appliances = allApps(false)
  for (const a of APPS) appliances[a] = !!i.kitchen && !!i.appliances?.[a]
  return { bedrooms: Math.max(0, Math.round(i.bedrooms)), bathrooms: Math.max(1, Math.ceil(i.baths)), guests: Math.max(1, Math.round(i.guests)), kitchen: !!i.kitchen, appliances }
}

// ── linen ───────────────────────────────────────────────────────────────────────────────────────
export function linenUnitOf(i: EstInput): LinenUnit {
  const beds: Record<string, number> = {}
  for (const k of EST_BEDS) if (i.beds[k] > 0) beds[k] = Math.round(i.beds[k])
  // Kitchen towels are for a full kitchen only (Jon, 2026-11-05): one that cooks, so one with a stove.
  return { id: 'estimate', name: unitLabel(i.bedrooms), bedrooms: i.bedrooms, bathrooms: i.baths, guests: i.guests, kitchens: i.kitchen && i.appliances?.stove ? 1 : 0, beds, bedsSource: 'manual' }
}
export type EstLinen = { rows: LinenTotalRow[]; atPar: number; taxed: number; total: number; priced: number; unpriced: number; pieces: number }
/** The slice of a LinenQuote this needs: pieces × price per piece at par, before markup and tax. */
export type LinenAtPar = { rows: LinenTotalRow[]; subtotal: number; priced: number; unpriced: number; pieces: number }
/** Cost per item × par from the saved standard, then tax, then the allowance. Unpriced rows are counted, never guessed. */
export function linenEstimate(q: LinenAtPar, s: EstSettings): EstLinen {
  const taxed = r2(q.subtotal * (1 + s.taxPct / 100))
  return { rows: q.rows, atPar: q.subtotal, taxed, total: r2(taxed * (1 + s.linenUpliftPct / 100)), priced: q.priced, unpriced: q.unpriced, pieces: q.pieces }
}

// ── the clean ───────────────────────────────────────────────────────────────────────────────────
export type EstClean = { base: number; extra: number; typical: number; total: number }
export function cleanEstimate(i: EstInput, s: EstSettings): EstClean {
  const base = i.bedrooms <= 0 ? s.cleanStudio : s.clean1br + (i.bedrooms - 1) * s.cleanPerExtraBedroom
  const typical = s.typicalSqft[Math.min(Math.max(0, i.bedrooms), s.typicalSqft.length - 1)] || 0
  const extra = i.sqft > typical && s.sqftStep > 0 && s.sqftStepCost > 0 ? Math.ceil((i.sqft - typical) / s.sqftStep) * s.sqftStepCost : 0
  return { base, extra, typical, total: base + extra }
}

// ── inventory ───────────────────────────────────────────────────────────────────────────────────
/** One buy line of the calculator (lib/need-buy.ts BuyLine) with the tier of what it is bought for. */
export type BuyRow = { key: string; kind: 'set' | 'pack' | 'single'; name: string; group: string; qty: number; pieces: number; tier: EstTier; detail?: string; icon?: string }
export type PriceLine = { p: [number, number, number]; what: [string, string, string] }
const B = (std: number, mid: number, lux: number, a: string, b: string, c: string): PriceLine => ({ p: [std, mid, lux], what: [a, b, c] })

/**
 * THE PRICE BOOK: what one buy line costs at [standard, mid, luxury], and the kind of product that is.
 * Per SET or PACK as the calculator buys it (a dinnerware set serves 4, glasses come in fours), otherwise each.
 * Mid is Stay's sourcing list where the calculator pins a pick; the rest is typical retail, in whole dollars.
 */
export const PRICE_BOOK: Record<string, PriceLine> = {
  'set-dinnerware': B(55, 90, 250, 'Stoneware', 'Porcelain or bone china', 'Fine bone china'),
  'set-flatware': B(20, 110, 180, 'Stainless steel', '18/10 stainless', 'Forged 18/10, hammered'),
  'set-knives': B(40, 130, 450, 'Stainless block set', 'German steel block set', 'Forged German or Japanese block set'),
  'set-cookware': B(90, 350, 800, 'Nonstick', 'Tri-ply stainless', 'All-Clad stainless'),
  'set-bakeware': B(30, 80, 120, 'Nonstick', 'Heavy aluminized steel', 'Nordic Ware commercial'),
  'set-utensils': B(28, 50, 90, 'Silicone', 'Stainless steel', 'Olivewood and stainless'),
  'set-measuring': B(10, 25, 45, 'Plastic', 'Stainless steel', 'Heavy-gauge stainless'),
  'set-bath-tools': B(18, 45, 65, 'Basic', 'OXO Good Grips', 'simplehuman'),
  'tall-glasses': B(12, 18, 55, 'Everyday glass', 'Premium glass', 'Crystal'),
  'wine-glasses': B(14, 22, 60, 'Everyday glass', 'Premium glass', 'Crystal'),
  'short-glasses': B(12, 22, 55, 'Everyday glass', 'Premium glass', 'Crystal'),
  'cocktail-glasses': B(18, 29, 60, 'Everyday glass', 'Premium glass', 'Crystal'),
  'shot-glasses': B(8, 9, 25, 'Everyday glass', 'Premium glass', 'Crystal'),
  'steak-knives': B(4, 8, 20, 'Stainless', 'German steel', 'Forged'),
  'serving-bowls': B(12, 20, 45, 'White ceramic', 'Porcelain', 'Artisan stoneware'),
  'serving-platter': B(15, 25, 60, 'White ceramic', 'Porcelain', 'Artisan stoneware'),
  'serving-utensils': B(10, 20, 45, 'Stainless', '18/10 stainless', 'Hammered stainless'),
  'baking-dish': B(18, 35, 110, 'Glass', 'Porcelain', 'Le Creuset stoneware'),
  'cutting-boards': B(12, 57, 90, 'Plastic', 'Double-sided', 'End-grain wood'),
  'mixing-bowls': B(15, 28, 45, 'Plastic', 'Stainless steel', 'Glass'),
  colander: B(8, 18, 30, 'Plastic', 'Stainless steel', 'OXO stainless'),
  peeler: B(5, 12, 15, 'Basic', 'OXO Good Grips', 'Kuhn Rikon'),
  grater: B(8, 15, 30, 'Basic', 'Stainless', 'Microplane'),
  'coffee-maker': B(90, 155, 200, 'Keurig K-Mini', 'Nespresso Essenza Mini', 'Nespresso Vertuo'),
  toaster: B(25, 80, 200, 'Hamilton Beach', 'Cuisinart stainless', 'Breville die-cast'),
  kettle: B(20, 60, 200, 'Stainless', 'Gooseneck, temperature control', 'SMEG'),
  blender: B(80, 130, 350, 'Ninja', 'KitchenAid', 'Vitamix'),
  'can-opener': B(8, 17, 25, 'Basic', 'OXO Good Grips', 'Zyliss'),
  corkscrew: B(7, 20, 40, 'Waiter’s corkscrew', 'Lever corkscrew', 'Electric opener'),
  'oven-mitts': B(10, 18, 35, 'Cotton', 'Silicone', 'Leather and silicone'),
  trivets: B(8, 20, 40, 'Silicone', 'Cast iron', 'Marble and wood'),
  'dish-rack': B(18, 75, 100, 'Plastic', 'KitchenAid full size', 'simplehuman steel'),
  'kitchen-trash': B(25, 80, 150, 'Plastic', 'Stainless, motion sensor', 'simplehuman'),
  recycling: B(20, 80, 220, 'Plastic', 'Stainless, two compartments', 'simplehuman dual'),
  'paper-towel-holder': B(7, 10, 30, 'Basic', 'Stainless, weighted', 'Marble'),
  'food-storage': B(18, 35, 55, 'Plastic', 'Glass', 'Pyrex glass'),
  'hair-dryer': B(20, 140, 400, 'Conair', 'Ionic, with diffuser', 'Dyson Supersonic'),
  'bath-trash': B(15, 30, 70, 'Plastic', 'Touchless', 'simplehuman'),
  hangers: B(12, 37, 70, 'Plastic', 'Wooden', 'Premium wooden suit'),
  'luggage-rack': B(25, 50, 100, 'Metal', 'Wood', 'Solid wood, hotel style'),
  iron: B(20, 56, 110, 'Basic steam iron', 'Ceramic soleplate', 'Rowenta'),
  'ironing-board': B(30, 60, 160, 'Basic', 'Metal with iron rest', 'Brabantia'),
  vacuum: B(70, 230, 350, 'Bissell stick', 'Shark cordless', 'Dyson cordless'),
  broom: B(13, 27, 35, 'Basic', 'Upright with stand', 'OXO'),
  mop: B(15, 30, 40, 'Swiffer Sweeper', 'Swiffer PowerMop', 'O-Cedar spin mop'),
  'smoke-alarms': B(10, 25, 45, 'Battery', '10-year sealed battery', 'Smoke and CO combination'),
  'co-alarm': B(20, 35, 45, 'Plug-in', '10-year battery', 'Smoke and CO combination'),
  extinguisher: B(22, 38, 55, 'Basic', 'Rechargeable ABC', 'Commercial grade'),
  'first-aid': B(9, 21, 36, 'Basic', '200 piece', 'Premium'),
  flashlight: B(8, 18, 45, 'LED', 'Rechargeable', 'Streamlight'),
  'pack-n-play': B(42, 63, 250, 'Basic', 'Compact', 'Guava Lotus'),
  'high-chair': B(25, 60, 300, 'Basic', 'Folding', 'Stokke'),
  'playing-cards': B(6, 17, 25, 'Bicycle', 'Plastic, waterproof', 'Premium linen'),
  uno: B(7, 14, 20, 'Uno', 'Uno, 2 pack', 'Uno deluxe'),
  'board-games': B(15, 25, 60, 'Classic', 'Strategy', 'Wooden'),
}
/** On the need list, supplied by us: never on an owner's estimate. */
export const SUPPLIED_KEYS = ['soap-dispensers']
export const WHY_SUPPLIED = 'we supply it'

/** What one of this line costs at the level: the price typed on the page, else the price book. Null = no price yet. */
export function priceFor(key: string, level: EstLevel, s: EstSettings): number | null {
  const own = s.prices && s.prices[key]
  if (own && Number.isFinite(own[lvl(level)])) return own[lvl(level)]
  const b = PRICE_BOOK[key]
  return b ? b.p[lvl(level)] : null
}
export const productFor = (key: string, level: EstLevel): string => PRICE_BOOK[key]?.what[lvl(level)] || ''

export type EstInvRow = BuyRow & { product: string; price: number | null; cost: number; on: boolean }
export type EstInventory = { rows: EstInvRow[]; total: number; count: number; unpriced: string[] }
/**
 * The calculator's buy list at this level's prices. `picks` are the user's own ticks: key → on/off (untick
 * what the unit already has). A line with no price is listed and named in `unpriced`, never counted at $0.
 */
export function inventoryEstimate(rows: BuyRow[], i: EstInput, s: EstSettings, picks?: Record<string, boolean> | null): EstInventory {
  const out: EstInvRow[] = [], unpriced: string[] = []
  let total = 0, count = 0
  for (const r of rows) {
    if (SUPPLIED_KEYS.includes(r.key)) continue
    const on = picks && Object.prototype.hasOwnProperty.call(picks, r.key) ? !!picks[r.key] : true
    const price = priceFor(r.key, i.level, s), cost = price === null ? 0 : r2(r.qty * price)
    out.push({ ...r, product: productFor(r.key, i.level), price, cost, on })
    if (!on) continue
    if (price === null) { unpriced.push(r.name); continue }
    total += cost; count++
  }
  return { rows: out, total: r2(total), count, unpriced }
}

// ── all three ───────────────────────────────────────────────────────────────────────────────────
const to10 = (n: number) => Math.round(n / 10) * 10
const to50 = (n: number) => Math.round(n / 50) * 50
export type Estimate = { linen: EstLinen; clean: EstClean; inventory: EstInventory; lines: { linen: number; clean: number; inventory: number }; total: number; low: number; high: number }
export function estimate(q: LinenAtPar, rows: BuyRow[], i: EstInput, s: EstSettings, picks?: Record<string, boolean> | null): Estimate {
  const linen = linenEstimate(q, s), clean = cleanEstimate(i, s), inventory = inventoryEstimate(rows, i, s, picks)
  const lines = { linen: to10(linen.total), clean: to10(clean.total), inventory: to10(inventory.total) }
  const total = lines.linen + lines.clean + lines.inventory
  return { linen, clean, inventory, lines, total, low: to50(total * 0.9), high: to50(total * 1.1) }
}
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
/** The estimate as plain text, for an email or a text to an owner. */
export function estimateText(i: EstInput, e: Estimate): string {
  const level = EST_LEVEL_LABEL[i.level].toLowerCase()
  const t = [
    'Estimated guest-ready cost: ' + unitLabel(i.bedrooms) + (i.sqft ? ', ' + i.sqft.toLocaleString('en-US') + ' sq ft' : '') + ' (' + bedsText(i.beds) + '; ' + i.baths + ' bath; sleeps ' + i.guests + ')', '',
    'Linen, bedding and towels (' + level + ' level): ' + usd(e.lines.linen),
    'Onboarding clean: ' + usd(e.lines.clean),
  ]
  if (e.inventory.count) t.push('Kitchen and housewares, ' + e.inventory.count + ' items (' + level + ' level): ' + usd(e.lines.inventory))
  t.push('', 'Estimated total: ' + usd(e.total) + ' (likely range ' + usd(e.low) + ' to ' + usd(e.high) + ')', '', 'This is an estimate for a fully furnished unit, not a quote. We supply the consumables. Repairs and the management fee are separate.')
  return t.join('\n')
}

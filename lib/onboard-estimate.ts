// ONBOARDING COST ESTIMATE (Jon, 2026-11-20: "build a cheat sheet for average onboarding cost… this is for sales…
// build this into a calculator, sales can enter bedroom, kitchen, square footage… build it in app").
//
// What it costs to get a FULLY FURNISHED new unit guest-ready, in three lines:
//   LINEN      cost per item × our par level (Jon: "calculate based on cost per item and use our par level").
//              Quantities and piece prices both come from the saved linen standard (lib/linens.ts) — one
//              source of truth — then sales tax and an allowance on top (Jon: "increase linen estimate 15%").
//   CLEAN      the one-time onboarding clean: $200 studio, $250 one bedroom (Jon). Larger units and the
//              square-foot rule are settings, because Jon has not set them yet.
//   INVENTORY  the Default onboarding catalog (ffe_catalog_items / ffe_catalog_options): the real product
//              and price at Standard / Mid / Luxury for every essential, sized to the unit.
//              CONSUMABLES ARE OURS (Jon: "consumables we supply"): paper goods, soaps, toiletries, pods,
//              cleaners, batteries and bulbs are never on an owner's estimate. In the catalog those are
//              exactly the lines with no Standard / Mid / Luxury product.
//
// APPLIANCES ARE NOT PRICED (Jon: "we don't need appliances, we need to know appliances for inventory").
// What the unit already has decides what goes on the list: no microwave means a countertop one, no stove
// means no cookware. Furniture and TVs are assumed ("assuming fully
// furnished").
//
// Pure and isomorphic: no runtime imports (plain node runs the test against this very file), no prices in
// this file. The caller prices the linen with lib/linens.ts linenQuote and hands the quote in:
//   linenQuote({ ...(input.par ? atPar(standard, input.par) : standard), markupPct: 0, taxPct: 0 }, [linenUnitOf(input)], LINEN_TIER_OF[input.level])
// Tested in lib/__tests__/onboard-estimate.test.mjs.
import type { LinenTier, LinenTotalRow, LinenUnit } from './linens'

const SOFA_BED = 'Sofa bed'   // lib/linens.ts SOFA_BED

export const ESTIMATE_SETTINGS_KEY = 'onboard_estimate'   // app_settings: EstSettings
export const ESTIMATE_CATALOG = 'default'

export type EstKitchen = 'full' | 'kitchenette' | 'none'
export type EstStock = 'must' | 'rec' | 'all' | 'none'
export type EstLevel = 'standard' | 'mid' | 'luxury'
export type EstNeed = 'must' | 'recommended' | 'suggested'
export type EstPer = 'unit' | 'bedroom' | 'bathroom' | 'guest'

export const EST_LEVELS: EstLevel[] = ['standard', 'mid', 'luxury']
export const EST_LEVEL_LABEL: Record<EstLevel, string> = { standard: 'Standard', mid: 'Mid', luxury: 'Luxury' }
/** The linen standard's tiers under the names sales uses (Jon: Broward is standard, Miami is mid, Salato is the only luxury). */
export const LINEN_TIER_OF: Record<EstLevel, LinenTier> = { standard: 'low', mid: 'mid', luxury: 'lux' }
export const EST_BEDS = ['King', 'Queen', 'Full', 'Twin', SOFA_BED] as const
/**
 * ONE LEVEL PER UNIT (Jon, 2026-11-20: "make sure product and inventory changes per mid or lux units and
 * standard"). The unit's level picks the linen tier, the catalog product on every inventory line, and how
 * much of the list a unit of that level starts with. The amount stays a choice the user can change.
 */
export const STOCK_FOR_LEVEL: Record<EstLevel, EstStock> = { standard: 'must', mid: 'rec', luxury: 'all' }

/**
 * What the unit already has. Selecting one never adds a cost; it only shapes the inventory list. Only the
 * built-ins are asked (Jon: "lean this up") — a small appliance already there is unticked on the list.
 */
export const EST_HAS: { key: string; label: string; item?: string }[] = [
  { key: 'stove', label: 'Stove' },
  { key: 'microwave', label: 'Microwave', item: 'Microwave' },
]

export type EstInput = {
  bedrooms: number                    // 0 = studio
  beds: Record<string, number>        // King / Queen / Twin / Sofa bed → count
  baths: number                       // 1, 1.5, 2 …
  guests: number
  tvs: number
  kitchen: EstKitchen
  sqft: number                        // 0 = not given
  level: EstLevel                     // standard / mid / luxury: the linen tier AND the product on every inventory line
  par: number                         // linen sets in rotation for this estimate; 0 = the saved standard's par (Jon: "be able to adjust the par level for linen")
  stock: EstStock
  has: Record<string, boolean>
}

export type EstSettings = {
  cleanStudio: number
  clean1br: number
  cleanPerExtraBedroom: number        // each bedroom past the first
  sqftStep: number                    // a block of square feet over the typical size…
  sqftStepCost: number                // …adds this much to the clean (0 switches the rule off)
  typicalSqft: number[]               // by bedroom count, studio first
  taxPct: number                      // sales tax on linen
  linenUpliftPct: number              // allowance on top of linen at par
  /** Sets sized to the guests: how many people one set serves at [standard, mid, luxury]. */
  serves: Record<string, [number, number, number]>
  updatedAt?: string
  updatedBy?: string
}

export const DEFAULT_EST_SETTINGS: EstSettings = {
  cleanStudio: 200, clean1br: 250, cleanPerExtraBedroom: 50,
  sqftStep: 250, sqftStepCost: 25, typicalSqft: [600, 900, 1300, 1800, 2300],
  taxPct: 7, linenUpliftPct: 15,
  serves: { 'Dishware set': [4, 8, 8], 'Flatware set': [8, 8, 8], 'Glassware set': [8, 8, 8], 'Wine glasses': [6, 6, 12] },
}

const fin = (v: any, fb: number, lo = 0, hi = 1e6) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fb }
const PERS: EstPer[] = ['unit', 'bedroom', 'bathroom', 'guest']
const r2 = (n: number) => Math.round(n * 100) / 100

/** A saved settings blob made safe: every number clamped, every list bounded, unknown keys dropped. */
export function normEstSettings(raw: any): EstSettings {
  const d = DEFAULT_EST_SETTINGS, s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const serves: EstSettings['serves'] = {}
  const srcServes = s.serves && typeof s.serves === 'object' && !Array.isArray(s.serves) ? s.serves : d.serves
  for (const [k, v] of Object.entries(srcServes).slice(0, 50)) {
    if (!Array.isArray(v) || v.length !== 3) continue
    serves[String(k).slice(0, 120)] = [fin(v[0], 8, 1, 100), fin(v[1], 8, 1, 100), fin(v[2], 8, 1, 100)]
  }
  const typical = Array.isArray(s.typicalSqft) && s.typicalSqft.length ? s.typicalSqft.slice(0, 10).map((x: any, i: number) => fin(x, d.typicalSqft[Math.min(i, d.typicalSqft.length - 1)], 100, 20000)) : d.typicalSqft.slice()
  const out: EstSettings = {
    cleanStudio: fin(s.cleanStudio, d.cleanStudio, 0, 5000), clean1br: fin(s.clean1br, d.clean1br, 0, 5000), cleanPerExtraBedroom: fin(s.cleanPerExtraBedroom, d.cleanPerExtraBedroom, 0, 2000),
    sqftStep: fin(s.sqftStep, d.sqftStep, 0, 5000), sqftStepCost: fin(s.sqftStepCost, d.sqftStepCost, 0, 1000), typicalSqft: typical,
    taxPct: fin(s.taxPct, d.taxPct, 0, 25), linenUpliftPct: fin(s.linenUpliftPct, d.linenUpliftPct, 0, 100),
    serves,
  }
  if (typeof s.updatedAt === 'string') out.updatedAt = s.updatedAt.slice(0, 40)
  if (typeof s.updatedBy === 'string') out.updatedBy = s.updatedBy.slice(0, 120)
  return out
}

// ── the unit ────────────────────────────────────────────────────────────────────────────────────
/** What a full kitchen, a kitchenette or no kitchen normally comes with. */
export function hasDefaults(kitchen: EstKitchen): Record<string, boolean> {
  return { stove: kitchen !== 'none', microwave: kitchen === 'full' }
}
export function guestsFromBeds(beds: Record<string, number>): number {
  const n = (k: string) => Math.max(0, Math.round(Number(beds[k]) || 0))
  return Math.max(1, 2 * (n('King') + n('Queen') + n('Full') + n(SOFA_BED)) + n('Twin'))
}
/** A typical unit of this size: one King, a Queen in each further bedroom, a TV per sleeping room. */
export function estDefaults(bedrooms: number): EstInput {
  const b = Math.max(0, Math.min(8, Math.round(Number(bedrooms) || 0)))
  const beds: Record<string, number> = { King: 1 }
  if (b > 1) beds.Queen = b - 1
  return { bedrooms: b, beds, baths: [1, 1, 2, 2, 3][Math.min(b, 4)], guests: guestsFromBeds(beds), tvs: Math.max(1, b), kitchen: 'full', sqft: 0, level: 'mid', par: 0, stock: STOCK_FOR_LEVEL.mid, has: hasDefaults('full') }
}
export function normEstInput(raw: any): EstInput {
  const d = estDefaults(Number(raw?.bedrooms) || 0), s = raw && typeof raw === 'object' ? raw : {}
  const beds: Record<string, number> = {}
  for (const k of EST_BEDS) { const n = Math.round(fin(s.beds?.[k], 0, 0, 20)); if (n > 0) beds[k] = n }
  if (!Object.keys(beds).length) beds.King = 1
  const has: Record<string, boolean> = {}
  for (const h of EST_HAS) if (s.has && s.has[h.key]) has[h.key] = true
  const level: EstLevel = EST_LEVELS.includes(s.level) ? s.level : 'mid'
  return {
    bedrooms: d.bedrooms, beds, baths: Math.round(fin(s.baths, d.baths, 1, 20) * 2) / 2, guests: Math.round(fin(s.guests, guestsFromBeds(beds), 1, 50)), tvs: Math.round(fin(s.tvs, d.tvs, 0, 20)),
    kitchen: s.kitchen === 'kitchenette' || s.kitchen === 'none' ? s.kitchen : 'full', sqft: Math.round(fin(s.sqft, 0, 0, 50000)),
    level, par: Math.round(fin(s.par, 0, 0, 6) * 2) / 2, stock: ['must', 'rec', 'all', 'none'].includes(s.stock) ? s.stock : STOCK_FOR_LEVEL[level], has: s.has ? has : d.has,
  }
}
export const unitLabel = (bedrooms: number) => bedrooms <= 0 ? 'Studio' : bedrooms + ' bedroom'
export function bedsText(beds: Record<string, number>): string {
  return EST_BEDS.filter(k => beds[k] > 0).map(k => beds[k] + ' ' + (k === SOFA_BED ? 'sofa bed' : k)).join(', ')
}

// ── linen ───────────────────────────────────────────────────────────────────────────────────────
export function linenUnitOf(i: EstInput): LinenUnit {
  const beds: Record<string, number> = {}
  for (const k of EST_BEDS) if (i.beds[k] > 0) beds[k] = Math.round(i.beds[k])
  return { id: 'estimate', name: unitLabel(i.bedrooms), bedrooms: i.bedrooms, bathrooms: i.baths, guests: i.guests, kitchens: i.kitchen === 'full' ? 1 : 0, beds, bedsSource: 'manual' }
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
export type EstRow = { name: string; category: string; need: EstNeed; per: EstPer; qty: number; prices: [number, number, number]; products: [string, string, string]; serves?: [number, number, number] }
type CatItem = { id: string; category?: string | null; name: string; need?: string | null; qty?: number | string | null; qty_per?: string | null }
type CatOption = { item_id: string; tier?: string | null; price?: number | string | null; name?: string | null }
const TIER_INDEX: Record<string, number> = { standard: 0, midlux: 1, luxury: 2 }
const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

/**
 * The catalog's essentials as estimate rows: every line that carries a Standard / Mid / Luxury product
 * (a missing tier borrows the nearest lower one, else the next higher). A line with no tiered product
 * is a consumable — we supply those — and a line with no price is not guessed: both come back in `left`
 * with the reason, never priced at $0.
 */
export const WHY_CONSUMABLE = 'consumable, we supply it'
export const WHY_NO_PRICE = 'no price in the catalog'
export function catalogRows(items: CatItem[], options: CatOption[], s: EstSettings): { rows: EstRow[]; left: { name: string; why: string }[] } {
  const byItem = new Map<string, CatOption[]>()
  for (const o of options || []) { const k = String(o.item_id); if (!byItem.has(k)) byItem.set(k, []); byItem.get(k)!.push(o) }
  const rows: EstRow[] = [], left: { name: string; why: string }[] = []
  for (const it of items || []) {
    const name = String(it.name || '').trim(); if (!name) continue
    const opts = (byItem.get(String(it.id)) || []).filter(o => o.price != null && Number.isFinite(Number(o.price)))
    if (!opts.length) { left.push({ name, why: WHY_NO_PRICE }); continue }
    const tiered: number[][] = [[], [], []], names: (string | null)[] = [null, null, null]
    for (const o of opts) { const ti = TIER_INDEX[String(o.tier || '')]; if (ti === undefined) continue; tiered[ti].push(Number(o.price)); if (names[ti] === null && o.name) names[ti] = String(o.name).trim().slice(0, 90) }
    if (!tiered.some(t => t.length)) { left.push({ name, why: WHY_CONSUMABLE }); continue }
    const need: EstNeed = it.need === 'recommended' || it.need === 'suggested' ? it.need : 'must'
    const per: EstPer = PERS.includes(it.qty_per as EstPer) ? it.qty_per as EstPer : 'unit'
    const v: (number | null)[] = tiered.map(t => t.length ? median(t) : null)
    // A level with no product of its own borrows the price AND the product of the nearest lower level, else the next higher.
    const have = v.map(x => x !== null)
    for (let k = 0; k < 3; k++) if (!have[k]) { let from = -1; for (let j = k - 1; j >= 0; j--) if (have[j]) { from = j; break } if (from < 0) for (let j = k + 1; j < 3; j++) if (have[j]) { from = j; break } v[k] = v[from]; names[k] = names[from] }
    const row: EstRow = { name, category: String(it.category || 'Other'), need, per, qty: fin(it.qty, 1, 0, 999) || 1, prices: [r2(v[0]!), r2(v[1]!), r2(v[2]!)], products: [names[0] || '', names[1] || '', names[2] || ''] }
    if (s.serves[name]) row.serves = s.serves[name]
    rows.push(row)
  }
  return { rows, left }
}

const NO_KITCHEN_KEEP = ['Coffee maker', 'Electric kettle', 'Microwave', 'Glassware set', 'Nespresso machine', 'Wine glasses', 'Milk frother']
const NEED_RANK: Record<EstNeed, number> = { must: 0, recommended: 1, suggested: 2 }
const STOCK_CAP: Record<EstStock, number> = { must: 0, rec: 1, all: 2, none: -1 }
const lvl = (l: EstLevel) => EST_LEVELS.indexOf(l)

/** Is this line on the list for this unit, before anyone ticks or unticks it? */
export function wanted(r: EstRow, i: EstInput): boolean {
  if (i.stock === 'none') return false
  const has = i.has || {}
  for (const h of EST_HAS) if (h.item && has[h.key] && h.item === r.name) return false           // already in the unit
  if (r.name === 'Cookware set' && !has.stove) return false
  if (r.name === 'Streaming stick' && !(i.tvs > 0)) return false
  if (r.name === 'Microwave' && !has.microwave) return true                                      // none in the unit: a countertop one is needed
  if (NEED_RANK[r.need] > STOCK_CAP[i.stock]) return false
  if (i.kitchen === 'none' && r.category === 'Kitchen' && !NO_KITCHEN_KEEP.includes(r.name)) return false
  return true
}
export function invQty(r: EstRow, i: EstInput): number {
  if (r.serves) return Math.max(1, Math.ceil(i.guests / (r.serves[lvl(i.level)] || 8)))
  if (r.name === 'Streaming stick') return Math.max(1, Math.round(i.tvs || 0))
  const base = r.per === 'bedroom' ? Math.max(1, i.bedrooms) : r.per === 'bathroom' ? Math.ceil(i.baths) : r.per === 'guest' ? i.guests : 1
  return Math.max(1, Math.ceil(r.qty * base))
}
export type EstInvRow = { name: string; category: string; need: EstNeed; product: string; qty: number; price: number; cost: number; on: boolean }
export type EstInventory = { rows: EstInvRow[]; total: number; count: number; groups: Record<string, number> }
/** `picks` are the user's own ticks: name → on/off, overriding the rules for that line. */
export function inventoryEstimate(rows: EstRow[], i: EstInput, picks?: Record<string, boolean> | null): EstInventory {
  const out: EstInvRow[] = [], groups: Record<string, number> = {}
  let total = 0, count = 0
  for (const r of rows) {
    const on = picks && Object.prototype.hasOwnProperty.call(picks, r.name) ? !!picks[r.name] : wanted(r, i)
    const qty = invQty(r, i), price = r.prices[lvl(i.level)], cost = r2(qty * price)
    out.push({ name: r.name, category: r.category, need: r.need, product: (r.products && r.products[lvl(i.level)]) || '', qty, price, cost, on })
    if (on) { total += cost; count++; groups[r.category] = r2((groups[r.category] || 0) + cost) }
  }
  return { rows: out, total: r2(total), count, groups }
}

// ── all three ───────────────────────────────────────────────────────────────────────────────────
const to10 = (n: number) => Math.round(n / 10) * 10
const to50 = (n: number) => Math.round(n / 50) * 50
export type Estimate = { linen: EstLinen; clean: EstClean; inventory: EstInventory; lines: { linen: number; clean: number; inventory: number }; total: number; low: number; high: number }
export function estimate(q: LinenAtPar, rows: EstRow[], i: EstInput, s: EstSettings, picks?: Record<string, boolean> | null): Estimate {
  const linen = linenEstimate(q, s), clean = cleanEstimate(i, s), inventory = inventoryEstimate(rows, i, picks)
  const lines = { linen: to10(linen.total), clean: to10(clean.total), inventory: to10(inventory.total) }
  const total = lines.linen + lines.clean + lines.inventory
  return { linen, clean, inventory, lines, total, low: to50(total * 0.9), high: to50(total * 1.1) }
}
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
/** The estimate as plain text, for an email or a text to an owner. */
export function estimateText(i: EstInput, e: Estimate): string {
  const t = [
    'Estimated guest-ready cost: ' + unitLabel(i.bedrooms) + (i.sqft ? ', ' + i.sqft.toLocaleString('en-US') + ' sq ft' : '') + ' (' + bedsText(i.beds) + '; ' + i.baths + ' bath; sleeps ' + i.guests + ')', '',
    'Linen, bedding and towels (' + EST_LEVEL_LABEL[i.level].toLowerCase() + ' level): ' + usd(e.lines.linen),
    'Onboarding clean: ' + usd(e.lines.clean),
  ]
  if (e.inventory.count) t.push('Inventory, ' + e.inventory.count + ' items (' + EST_LEVEL_LABEL[i.level].toLowerCase() + ' level): ' + usd(e.lines.inventory))
  t.push('', 'Estimated total: ' + usd(e.total) + ' (likely range ' + usd(e.low) + ' to ' + usd(e.high) + ')', '', 'This is an estimate for a fully furnished unit, not a quote. We supply the consumables. Repairs and the management fee are separate.')
  return t.join('\n')
}

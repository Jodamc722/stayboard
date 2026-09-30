// LINENS — the linen standard and the calculator that sizes it (Jon, 2026-09-29).
//
// "What calculator — I create the standard, you just need to create a place where I can edit that or
// update it." "So just need to create a linen list form: mattress protectors to duvet and duvet covers
// to makeup cloths, hand towels etc., kitchen towels." The standard is Jon's list; this file only
// holds its shape, the STARTING VALUES it opens with, and the arithmetic that turns it into a buy
// list for a set of units (bedrooms, beds by size, bathrooms, guests), priced at the vendor's prices
// when he has typed them in. Salato 302/602/902 (linen from Complete Jantex) are the worked example.
//
// PAR = SETS IN ROTATION: one on the bed, one in the wash, one on the shelf. 3 is only where the page
// starts; every number here is Jon's to change, per item as well as globally.
//
// THREE TIERS (Jon, 2026-09-30: "three different tiers: low, mid, and luxury, so that we can price
// based on that… it should also know how the ordering works. Some of these items have to be bulk
// ordered"). A unit needs the same NUMBER of pieces whatever the tier — four pillowcases on a King is
// four pillowcases — so quantities (qty, per-size counts, per, rotation, par) stay on the item and are
// shared. What changes by tier is WHAT is bought: the product, the vendor, the SKU, the price per piece
// and how it is sold (pieces per case, a minimum number of cases). An item can also be left out of a
// tier altogether (`off`).
//
// TWO BILLS FROM ONE LIST. The OWNER pays for the pieces their unit receives (× markup, tax on top).
// The VENDOR is paid in whole cases: pieces are pooled across every unit on the order, rounded UP to
// the case, and the case overage goes to stock. Those are different numbers on purpose.
//
// Isomorphic and import-free on purpose: the page, the API and the plain-node test
// (lib/__tests__/linens.test.mjs) all read this one file, so the number the page shows is the
// number the test checks.

export type LinenGroup = 'Bed' | 'Bath' | 'Kitchen' | 'Other'
export type LinenPer = 'bed' | 'bathroom' | 'bedroom' | 'guest' | 'unit'
export type LinenTier = 'low' | 'mid' | 'lux'

/** What Jon buys for an item at one tier. Every field is optional; blank means "not set yet". */
export type TierOption = {
  product?: string                          // what is bought at this tier, e.g. "T-300 cotton percale"
  vendor?: string                           // a name from the standard's vendor list (free text allowed)
  sku?: string
  price?: number | null                     // price PER PIECE
  priceBySize?: Record<string, number>      // per-bed items only: a King sheet is not priced like a Twin sheet
  packSize?: number                         // pieces per case; blank or 1 = sold singly
  minCases?: number                         // the vendor's minimum, in cases, for this line
  off?: boolean                             // true = this item is not part of this tier
}

export type LinenItem = {
  id: string
  name: string
  group: LinenGroup
  per: LinenPer
  qty: number                               // per `per`; for a per-bed item, the count for any size not in qtyBySize
  qtyBySize?: Record<string, number>        // per-bed items only: the count on a bed of that size (pillows: 4 on a King, 2 on a Twin)
  rotates: boolean                          // true → multiplied by par (sets in rotation); false → one set (pillows, duvet inserts)
  par?: number | null                       // this item's own par; blank = the standard's par
  tiers: Partial<Record<LinenTier, TierOption>>
  notes?: string
  active?: boolean                          // false = kept on the list, left out of every count and every tier
}

/** Who the linen is bought from, and how an order is placed with them. */
export type LinenVendor = {
  name: string
  contact?: string
  email?: string
  phone?: string
  orderVia?: string                         // how you order: portal / email / rep — free text
  minOrder?: number | null                  // $ minimum per order
  leadDays?: number | null                  // days from order to delivery
  notes?: string
}

export type LinenStandard = {
  par: number
  bedSizes: string[]
  items: LinenItem[]
  tierLabels: Record<LinenTier, string>
  vendors: LinenVendor[]
  markupPct: number                         // on the owner's bill, on top of the piece prices
  taxPct: number                            // on the owner's bill, on top of prices + markup
  updatedAt?: string
  updatedBy?: string
}

export const LINEN_STANDARD_KEY = 'linen_standard'   // app_settings: the standard
export const LINEN_UNIT_BEDS_KEY = 'linen_unit_beds' // app_settings: { [listingId]: { King: 1, Queen: 2 } }
export const LINEN_QUOTES_KEY = 'linen_quotes'       // app_settings: { [onboardCode]: { tier, updatedAt, updatedBy } }

export const LINEN_GROUPS: LinenGroup[] = ['Bed', 'Bath', 'Kitchen', 'Other']
export const LINEN_TIERS: LinenTier[] = ['low', 'mid', 'lux']
export const DEFAULT_TIER_LABELS: Record<LinenTier, string> = { low: 'Low', mid: 'Mid', lux: 'Luxury' }
export const LINEN_PER: { key: LinenPer; label: string }[] = [
  { key: 'bed', label: 'per bed' },
  { key: 'bathroom', label: 'per bathroom' },
  { key: 'bedroom', label: 'per bedroom' },
  { key: 'guest', label: 'per guest' },
  { key: 'unit', label: 'per unit' },
]
export const DEFAULT_PAR = 3
export const DEFAULT_BED_SIZES = ['King', 'Queen', 'Full', 'Twin', 'Sofa bed']

// Limits for a hand-edited setting. Counts and par stop at 999; a price at 99,999 (a case price
// typed in by mistake still saves, a stray paste of a phone number does not).
export const LIMITS = {
  num: 999, price: 99_999, items: 200, sizes: 12, name: 80, size: 30, vendor: 80, sku: 60, notes: 300, id: 60, who: 120,
  product: 120, vendors: 30, contact: 80, email: 120, phone: 40, orderVia: 120, leadDays: 365, markup: 500, tax: 100, tierLabel: 30,
}
/** A quote or a document is for at most this many units, and a unit at most these counts. */
export const MANUAL_LIMITS = { units: 200, bedrooms: 20, bathrooms: 20, guests: 50, bedsPerSize: 20, name: 80 }

const PILLOWS: Record<string, number> = { King: 4, Queen: 4, Full: 2, Twin: 2, 'Sofa bed': 2 }

// STARTING TIERS — pieces per case and a product line per tier. These are STARTING VALUES only, for
// Jon to overwrite: the pack sizes are how linen is commonly sold (by the dozen for sheets, cases and
// towels; by the half-dozen for mattress protectors and duvet covers; singly for pillows, inserts,
// blankets and kitchen mitts), and the products are the usual step-ups (thread count for sheets,
// weight in GSM for towels). NO prices and NO vendor names: those are Jon's to type, and the quote
// shows plainly what is still unpriced rather than inventing a number.
type Hints = [string, string, string]
const tiersOf = (pack: number, [low, mid, lux]: Hints): Partial<Record<LinenTier, TierOption>> => ({
  low: { product: low, packSize: pack }, mid: { product: mid, packSize: pack }, lux: { product: lux, packSize: pack },
})
const SHEETING: Hints = ['T-180 poly-cotton', 'T-300 cotton percale', 'T-400+ cotton sateen']
const towel = (low: number, mid: number, lux: number): Hints => [`Cotton blend, ~${low} GSM`, `100% cotton, ~${mid} GSM`, `Ring-spun cotton, ${lux}+ GSM`]

/** STARTING VALUES — what the page opens with before Jon saves his own list. */
export const DEFAULT_LINEN_STANDARD: LinenStandard = {
  par: DEFAULT_PAR,
  bedSizes: [...DEFAULT_BED_SIZES],
  tierLabels: { ...DEFAULT_TIER_LABELS },
  vendors: [],
  markupPct: 0,
  taxPct: 0,
  items: [
    // Bed — per bed, sized by the bed it goes on.
    { id: 'mattress-protector', name: 'Mattress protector', group: 'Bed', per: 'bed', qty: 1, rotates: true, par: 2, tiers: tiersOf(6, ['Basic waterproof, fitted', 'Waterproof cotton terry, fitted', 'Waterproof, quiet, cooling top']) },
    { id: 'pillow-protectors', name: 'Pillow protectors', group: 'Bed', per: 'bed', qty: 2, qtyBySize: { ...PILLOWS }, rotates: true, tiers: tiersOf(12, ['Poly, zippered', 'Cotton, zippered, waterproof', 'Cotton sateen, zippered, waterproof']) },
    { id: 'pillows', name: 'Pillows', group: 'Bed', per: 'bed', qty: 2, qtyBySize: { ...PILLOWS }, rotates: false, tiers: tiersOf(1, ['Poly fiberfill', 'Gel-fiber down-alternative', 'Hotel down-alternative, cluster fill']) },
    { id: 'pillowcases', name: 'Pillowcases', group: 'Bed', per: 'bed', qty: 2, qtyBySize: { ...PILLOWS }, rotates: true, tiers: tiersOf(12, SHEETING) },
    { id: 'fitted-sheet', name: 'Fitted sheet', group: 'Bed', per: 'bed', qty: 1, rotates: true, tiers: tiersOf(12, SHEETING) },
    { id: 'flat-sheet', name: 'Flat sheet', group: 'Bed', per: 'bed', qty: 1, rotates: true, tiers: tiersOf(12, SHEETING) },
    { id: 'duvet-insert', name: 'Duvet insert', group: 'Bed', per: 'bed', qty: 1, rotates: false, tiers: tiersOf(1, ['Poly fill, lightweight', 'Down-alternative, all-season', 'Hotel down-alternative, baffle-box']) },
    { id: 'duvet-cover', name: 'Duvet cover', group: 'Bed', per: 'bed', qty: 1, rotates: true, tiers: tiersOf(6, ['Poly-cotton, white', 'T-300 cotton percale, white', 'T-400+ cotton sateen, white']) },
    // Bath
    { id: 'bath-towels', name: 'Bath towels', group: 'Bath', per: 'guest', qty: 1, rotates: true, tiers: tiersOf(12, towel(450, 550, 650)) },
    { id: 'hand-towels', name: 'Hand towels', group: 'Bath', per: 'bathroom', qty: 2, rotates: true, tiers: tiersOf(12, towel(450, 550, 650)) },
    { id: 'washcloths', name: 'Washcloths', group: 'Bath', per: 'guest', qty: 1, rotates: true, tiers: tiersOf(12, towel(450, 550, 650)) },
    { id: 'makeup-cloths', name: 'Makeup cloths', group: 'Bath', per: 'guest', qty: 1, rotates: true, tiers: tiersOf(12, ['Dark cotton blend', 'Dark 100% cotton', 'Dark ring-spun cotton']) },
    { id: 'bath-mat', name: 'Bath mat', group: 'Bath', per: 'bathroom', qty: 1, rotates: true, tiers: tiersOf(12, towel(650, 800, 900)) },
    { id: 'pool-towels', name: 'Pool/beach towels', group: 'Bath', per: 'guest', qty: 1, rotates: false, active: false, tiers: tiersOf(1, ['Cotton blend, striped', '100% cotton, ~450 GSM', 'Cotton velour, 500+ GSM']) },
    // Kitchen — per unit
    { id: 'kitchen-towels', name: 'Kitchen towels', group: 'Kitchen', per: 'unit', qty: 4, rotates: true, tiers: tiersOf(12, ['Cotton blend', '100% cotton', 'Cotton waffle weave']) },
    { id: 'dish-cloths', name: 'Dish cloths', group: 'Kitchen', per: 'unit', qty: 2, rotates: true, tiers: tiersOf(12, ['Cotton blend', '100% cotton', 'Cotton waffle weave']) },
    { id: 'oven-mitts', name: 'Oven mitts', group: 'Kitchen', per: 'unit', qty: 2, rotates: false, tiers: tiersOf(1, ['Quilted cotton', 'Cotton, silicone grip', 'Heat-rated, silicone grip']) },
    { id: 'pot-holders', name: 'Pot holders', group: 'Kitchen', per: 'unit', qty: 2, rotates: false, tiers: tiersOf(1, ['Quilted cotton', 'Cotton, silicone grip', 'Heat-rated, silicone grip']) },
    // Other
    { id: 'throw-blanket', name: 'Throw blanket', group: 'Other', per: 'bedroom', qty: 1, rotates: false, tiers: tiersOf(1, ['Fleece', 'Cotton knit', 'Wool-blend knit']) },
    { id: 'extra-blanket', name: 'Extra blanket', group: 'Other', per: 'bedroom', qty: 1, rotates: false, tiers: tiersOf(1, ['Fleece', 'Cotton thermal', 'Wool-blend']) },
  ],
}

/** A fresh copy of the starting values (never hand out the shared object to be mutated). */
export function defaultLinenStandard(): LinenStandard {
  return normLinenStandard(DEFAULT_LINEN_STANDARD)
}

// ── normalising a stored / posted value ───────────────────────────────────────────────────────────
const isObj = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: any, max: number): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max)
/** A finite number clamped to 0..max, rounded to cents; null when it is not a number at all. */
function num(v: any, max: number): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const x = typeof v === 'number' ? v : Number(String(v).replace(/[$,%\s]/g, ''))
  if (!Number.isFinite(x)) return null
  return Math.round(Math.max(0, Math.min(max, x)) * 100) / 100
}
/** A whole number clamped to 0..max; null when it is not a number at all. */
const whole = (v: any, max: number): number | null => { const n = num(v, max); return n === null ? null : Math.round(n) }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
const r2 = (x: number) => Math.round(x * 100) / 100

/** A size → number map: known-shape keys only, clamped values, at most LIMITS.sizes entries. */
function sizeMap(v: any, max: number): Record<string, number> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, number> = {}
  let n = 0
  for (const [k, raw] of Object.entries(v)) {
    const key = text(k, LIMITS.size)
    const val = num(raw, max)
    if (!key || val === null || key in out) continue
    out[key] = val
    if (++n >= LIMITS.sizes) break
  }
  return n ? out : undefined
}

/** Bed sizes: trimmed, de-duplicated (case-insensitive), capped. Empty → the starting sizes. */
export function normBedSizes(v: any): string[] {
  const out: string[] = []
  if (Array.isArray(v)) for (const s of v) {
    const t = text(s, LIMITS.size)
    if (t && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length >= LIMITS.sizes) break
  }
  return out.length ? out : [...DEFAULT_BED_SIZES]
}

/** One tier's option, normalised. Null when nothing in it survives. */
function normTier(v: any, perBed: boolean): TierOption | null {
  if (!isObj(v)) return null
  const o: TierOption = {}
  const product = text(v.product, LIMITS.product); if (product) o.product = product
  const vendor = text(v.vendor, LIMITS.vendor); if (vendor) o.vendor = vendor
  const sku = text(v.sku, LIMITS.sku); if (sku) o.sku = sku
  const price = num(v.price, LIMITS.price); if (price !== null) o.price = price
  if (perBed) { const p = sizeMap(v.priceBySize, LIMITS.price); if (p) o.priceBySize = p }
  const pack = whole(v.packSize, LIMITS.num); if (pack !== null && pack >= 1) o.packSize = pack
  const minC = whole(v.minCases, LIMITS.num); if (minC !== null && minC >= 1) o.minCases = minC
  if (v.off === true) o.off = true
  return Object.keys(o).length ? o : null
}

function normItem(v: any, taken: Set<string>): LinenItem | null {
  if (!isObj(v)) return null
  const name = text(v.name, LIMITS.name)
  if (!name) return null
  const group: LinenGroup = LINEN_GROUPS.includes(v.group) ? v.group : 'Other'
  const per: LinenPer = LINEN_PER.some(p => p.key === v.per) ? v.per : 'unit'
  let id = /^[A-Za-z0-9_-]{1,60}$/.test(String(v.id || '')) ? String(v.id) : (slug(name) || 'item')
  if (taken.has(id)) { let i = 2; while (taken.has(id + '-' + i)) i++; id = id + '-' + i }
  taken.add(id)
  const it: LinenItem = { id, name, group, per, qty: num(v.qty, LIMITS.num) ?? 1, rotates: v.rotates === true, tiers: {} }
  if (per === 'bed') { const q = sizeMap(v.qtyBySize, LIMITS.num); if (q) it.qtyBySize = q }
  const par = num(v.par, LIMITS.num); if (par !== null) it.par = Math.round(par)

  // THE TIERS, AND THE STANDARD SAVED BEFORE THERE WERE ANY. A standard saved on 2026-09-29 has
  // vendor / sku / price / per-size prices on the item itself and no `tiers`. Those are Jon's Mid
  // prices — they fill whatever the Mid tier does not already have, so nothing he typed is lost. An
  // item with no `tiers` key at all also picks up the starting tier hints (pack sizes, products) of
  // the default item with the same id; once saved, `tiers` is always present, so that happens once.
  const src: Record<string, any> = isObj(v.tiers) ? v.tiers
    : (DEFAULT_LINEN_STANDARD.items.find(d => d.id === id)?.tiers as Record<string, any> | undefined) || {}
  for (const t of LINEN_TIERS) {
    let raw: any = src[t]
    if (t === 'mid' && ['vendor', 'sku', 'price', 'priceBySize'].some(k => v[k] !== undefined && v[k] !== null && v[k] !== '')) {
      const base = isObj(raw) ? { ...raw } : {}
      for (const k of ['vendor', 'sku', 'price', 'priceBySize']) {
        if ((base[k] === undefined || base[k] === null || base[k] === '') && v[k] !== undefined) base[k] = v[k]
      }
      raw = base
    }
    const o = normTier(raw, per === 'bed')
    if (o) it.tiers[t] = o
  }
  const notes = text(v.notes, LIMITS.notes); if (notes) it.notes = notes
  it.active = v.active !== false
  return it
}

function normVendor(v: any): LinenVendor | null {
  if (!isObj(v)) return null
  const name = text(v.name, LIMITS.vendor)
  if (!name) return null
  const o: LinenVendor = { name }
  const contact = text(v.contact, LIMITS.contact); if (contact) o.contact = contact
  const email = text(v.email, LIMITS.email); if (email) o.email = email
  const phone = text(v.phone, LIMITS.phone); if (phone) o.phone = phone
  const via = text(v.orderVia, LIMITS.orderVia); if (via) o.orderVia = via
  const min = num(v.minOrder, LIMITS.price); if (min !== null && min > 0) o.minOrder = min
  const lead = whole(v.leadDays, LIMITS.leadDays); if (lead !== null) o.leadDays = lead
  const notes = text(v.notes, LIMITS.notes); if (notes) o.notes = notes
  return o
}

/** Vendors: named ones only, de-duplicated by name (case-insensitive), capped. */
export function normVendors(v: any): LinenVendor[] {
  const out: LinenVendor[] = []
  if (Array.isArray(v)) for (const raw of v) {
    const x = normVendor(raw)
    if (x && !out.some(o => o.name.toLowerCase() === x.name.toLowerCase())) out.push(x)
    if (out.length >= LIMITS.vendors) break
  }
  return out
}

/**
 * The one gate every stored or posted standard passes through. Only well-formed values survive:
 * numbers are clamped to 0..999 (prices to 0..99,999), strings trimmed and capped, unknown keys
 * dropped, lists capped — so a hand-edited setting can never break the page. Anything that is not
 * a standard at all comes back as the starting values.
 */
export function normLinenStandard(raw: any): LinenStandard {
  const src = isObj(raw) ? raw : DEFAULT_LINEN_STANDARD
  const parN = num(src.par, LIMITS.num)
  const taken = new Set<string>()
  const items: LinenItem[] = []
  const list = Array.isArray(src.items) ? src.items : DEFAULT_LINEN_STANDARD.items
  for (const v of list) {
    const it = normItem(v, taken)
    if (it) items.push(it)
    if (items.length >= LIMITS.items) break
  }
  const labels = isObj(src.tierLabels) ? src.tierLabels : {}
  const tierLabels = {} as Record<LinenTier, string>
  for (const t of LINEN_TIERS) tierLabels[t] = text(labels[t], LIMITS.tierLabel) || DEFAULT_TIER_LABELS[t]
  const out: LinenStandard = {
    par: parN === null ? DEFAULT_PAR : Math.round(parN),
    bedSizes: normBedSizes(src.bedSizes),
    items,
    tierLabels,
    vendors: normVendors(src.vendors),
    markupPct: num(src.markupPct, LIMITS.markup) ?? 0,
    taxPct: num(src.taxPct, LIMITS.tax) ?? 0,
  }
  const at = text(src.updatedAt, 40); if (at && !Number.isNaN(Date.parse(at))) out.updatedAt = at
  const by = text(src.updatedBy, LIMITS.who); if (by) out.updatedBy = by
  return out
}

// ── the tier chosen per onboarding unit ───────────────────────────────────────────────────────────
export type LinenQuoteChoice = { tier: LinenTier; updatedAt?: string; updatedBy?: string }
export const ONBOARD_CODE = /^[a-f0-9]{8,32}$/
export const isLinenTier = (v: any): v is LinenTier => LINEN_TIERS.includes(v)

/** The `linen_quotes` setting, every entry normalised: known codes, a real tier, capped. */
export function normLinenQuotes(raw: any): Record<string, LinenQuoteChoice> {
  const out: Record<string, LinenQuoteChoice> = {}
  if (!isObj(raw)) return out
  let n = 0
  for (const [k, v] of Object.entries(raw)) {
    const code = String(k).toLowerCase()
    if (!ONBOARD_CODE.test(code) || !isObj(v) || !isLinenTier(v.tier)) continue
    const c: LinenQuoteChoice = { tier: v.tier }
    const at = text(v.updatedAt, 40); if (at && !Number.isNaN(Date.parse(at))) c.updatedAt = at
    const by = text(v.updatedBy, LIMITS.who); if (by) c.updatedBy = by
    out[code] = c
    if (++n >= 2000) break
  }
  return out
}

// ── units ─────────────────────────────────────────────────────────────────────────────────────────
// Where a unit's beds came from: saved on this page, Guesty's listing rooms, the onboarding walk's
// pre-form, assumed (one Queen per bedroom, a studio counted as one), or typed into the quote.
export type BedsSource = 'guesty' | 'saved' | 'assumed' | 'onboarding' | 'manual'
export type LinenUnit = {
  id: string
  name: string
  building?: string | null
  bedrooms: number
  bathrooms: number
  guests: number
  beds: Record<string, number>        // bed size label → count
  bedsSource: BedsSource
}

/** A unit as the linen desk receives it: the beds in use, and what they would be without a save. */
export type LinenDeskUnit = LinenUnit & { autoBeds: Record<string, number>; autoSource: BedsSource; live: boolean }

/** A bed-count map as saved from the page: size labels → whole counts 0..20, zeros dropped. */
export function normBeds(v: any): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isObj(v)) return out
  let n = 0
  for (const [k, raw] of Object.entries(v)) {
    const key = text(k, LIMITS.size)
    const c = num(raw, 20)
    if (!key || c === null || Math.round(c) <= 0 || key in out) continue
    out[key] = Math.round(c)
    if (++n >= LIMITS.sizes) break
  }
  return out
}

const GUESTY_BED: Record<string, { size: string; n: number }> = {
  KING_BED: { size: 'King', n: 1 },
  QUEEN_BED: { size: 'Queen', n: 1 },
  DOUBLE_BED: { size: 'Full', n: 1 },
  FULL_BED: { size: 'Full', n: 1 },
  SINGLE_BED: { size: 'Twin', n: 1 },
  TWIN_BED: { size: 'Twin', n: 1 },
  SOFA_BED: { size: 'Sofa bed', n: 1 },
  BUNK_BED: { size: 'Twin', n: 2 },   // a bunk is two twin mattresses — two twin sets of everything
}

/**
 * Beds from Guesty's listing rooms (raw.listingRooms: [{ roomNumber, beds: [{ type, quantity }] }]).
 * Bed types are mapped by name (KING_BED → King, QUEEN_BED → Queen, DOUBLE_BED / FULL_BED → Full,
 * SINGLE_BED / TWIN_BED → Twin, SOFA_BED → Sofa bed, BUNK_BED → two Twins); anything else — air
 * mattress, crib, floor mattress, couch — is ignored rather than guessed. Empty when nothing maps.
 */
export function bedsFromGuestyRooms(rooms: any): Record<string, number> {
  const out: Record<string, number> = {}
  if (!Array.isArray(rooms)) return out
  for (const room of rooms.slice(0, 40)) {
    const beds = isObj(room) && Array.isArray(room.beds) ? room.beds : []
    for (const b of beds.slice(0, 40)) {
      if (!isObj(b)) continue
      const type = String(b.type || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
      const m = GUESTY_BED[type]
      if (!m) continue
      const q = b.quantity === undefined || b.quantity === null ? 1 : Math.round(Number(b.quantity))
      if (!Number.isFinite(q) || q <= 0) continue
      out[m.size] = Math.min(99, (out[m.size] || 0) + Math.min(20, q) * m.n)
    }
  }
  return out
}

/**
 * Beds from an onboarding unit's pre-form (lib/onboarding.ts UnitDetails: beds per bedroom key, by
 * size key; sleeperSofa as a count). A bunk is two twins; a crib takes none of these linens.
 */
export function bedsFromOnboarding(details: any): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isObj(details)) return out
  const MAP: Record<string, { size: string; n: number }> = { king: { size: 'King', n: 1 }, queen: { size: 'Queen', n: 1 }, full: { size: 'Full', n: 1 }, twin: { size: 'Twin', n: 1 }, bunk: { size: 'Twin', n: 2 } }
  if (isObj(details.beds)) for (const list of Object.values(details.beds)) {
    if (!Array.isArray(list)) continue
    for (const k of list.slice(0, 12)) { const m = MAP[String(k)]; if (m) out[m.size] = (out[m.size] || 0) + m.n }
  }
  const sofa = Math.round(Number(details.sleeperSofa) || 0)
  if (sofa > 0) out['Sofa bed'] = (out['Sofa bed'] || 0) + Math.min(4, sofa)
  return out
}

/** No bed data anywhere: one Queen per bedroom, a studio counted as one bedroom. */
export function assumedBeds(bedrooms: number): Record<string, number> {
  const b = Math.round(Number(bedrooms) || 0)
  return { Queen: Math.max(1, Math.min(20, b)) }
}

/** "King ×1, Queen ×2" in the standard's size order, unknown sizes after. */
export function bedsLabel(beds: Record<string, number>, order: string[] = DEFAULT_BED_SIZES): string {
  return sortSizes(Object.keys(beds).filter(k => beds[k] > 0), order).map(k => `${k} ×${beds[k]}`).join(', ')
}
export function sortSizes(sizes: string[], order: string[]): string[] {
  const at = (s: string) => { const i = order.findIndex(o => o.toLowerCase() === s.toLowerCase()); return i < 0 ? 999 : i }
  return [...sizes].sort((a, b) => at(a) - at(b) || a.localeCompare(b))
}

// ── a unit with no listing: typed into the quote ──────────────────────────────────────────────────
/** What the Quote view (and the documents route) sends for a unit that has no listing to read. */
export type ManualUnitInput = { name?: string; bedrooms?: number; bathrooms?: number; guests?: number; beds?: Record<string, number>; copies?: number }

/**
 * One typed-in unit, validated: bedrooms 0..20 (0 = studio), bathrooms 0..20 in halves, guests
 * 0..50, beds 0..20 per size (normBeds), and how many identical units 1..200.
 */
export function normManualUnit(raw: any, i = 0): { unit: LinenUnit; copies: number } {
  const v = isObj(raw) ? raw : {}
  const baths = num(v.bathrooms, MANUAL_LIMITS.bathrooms)
  const unit: LinenUnit = {
    id: 'manual-' + (i + 1),
    name: text(v.name, MANUAL_LIMITS.name) || 'Unit' + (i ? ' ' + (i + 1) : ''),
    bedrooms: whole(v.bedrooms, MANUAL_LIMITS.bedrooms) ?? 0,
    bathrooms: baths === null ? 0 : Math.round(baths * 2) / 2,
    guests: whole(v.guests, MANUAL_LIMITS.guests) ?? 0,
    beds: normBeds(v.beds),
    bedsSource: 'manual',
  }
  const copies = Math.max(1, whole(v.copies, MANUAL_LIMITS.units) ?? 1)
  return { unit, copies }
}

/**
 * A list of typed-in units, each repeated `copies` times. `requested` is the count asked for, so a
 * caller can refuse more than MANUAL_LIMITS.units rather than quietly quoting fewer.
 */
export function manualUnits(list: any): { units: LinenUnit[]; requested: number; labels: string[] } {
  const units: LinenUnit[] = []
  const labels: string[] = []
  let requested = 0
  const arr = Array.isArray(list) ? list.slice(0, MANUAL_LIMITS.units) : []
  arr.forEach((raw, i) => {
    const { unit, copies } = normManualUnit(raw, i)
    requested += copies
    labels.push(unit.name + (copies > 1 ? ' ×' + copies : ''))
    for (let c = 0; c < copies && units.length < MANUAL_LIMITS.units; c++) units.push(c ? { ...unit, id: unit.id + '-' + (c + 1) } : unit)
  })
  return { units, requested, labels }
}

// ── the arithmetic ────────────────────────────────────────────────────────────────────────────────
export type LinenRow = {
  itemId: string
  name: string
  group: LinenGroup
  size?: string
  perUnitQty: number      // one set on the unit: qty × how many (beds of this size, baths, bedrooms, guests, 1)
  par: number             // sets in rotation for this row (1 when the item does not rotate)
  total: number           // perUnitQty × par, rounded up to a whole piece
}

const up = (x: number) => Math.ceil(Math.round(x * 1000) / 1000)   // 2.0000001 is 2, 2.1 is 3

/** How many of `per` this unit has. Beds are handled by size in linenNeeds. */
function countOf(per: LinenPer, u: LinenUnit): number {
  switch (per) {
    // Half baths round UP: a 2.5-bath unit has three rooms that each want a hand towel and a mat.
    // Only `per: 'bathroom'` items read this — towels sized per guest are not touched by it.
    case 'bathroom': return Math.max(0, Math.ceil(Number(u.bathrooms) || 0))
    // A studio (0 bedrooms) still has a sleeping room — its throw and extra blanket count once.
    case 'bedroom': return Math.max(1, Math.round(Number(u.bedrooms) || 0))
    case 'guest': return Math.max(0, Math.round(Number(u.guests) || 0))
    case 'unit': return 1
    default: return 0
  }
}

/**
 * What one unit needs. total = qty × count(per) × (rotates ? (item.par ?? standard.par) : 1).
 * A per-bed item is one row per bed size present in the unit (bed linen is bought by size), with
 * the size's own count from qtyBySize where Jon set one. Inactive items and zero rows are left out.
 * The count is the same at every tier — the tier decides what is bought, not how many.
 */
export function linenNeeds(standard: LinenStandard, unit: LinenUnit): LinenRow[] {
  const out: LinenRow[] = []
  const sizes = sortSizes(Object.keys(unit.beds || {}).filter(k => (unit.beds[k] || 0) > 0), standard.bedSizes)
  for (const it of standard.items) {
    if (it.active === false) continue
    const par = it.rotates ? (it.par ?? standard.par) : 1
    if (it.per === 'bed') {
      for (const size of sizes) {
        const q = it.qtyBySize && it.qtyBySize[size] !== undefined ? it.qtyBySize[size] : it.qty
        const perUnitQty = up(q * unit.beds[size])
        const total = up(q * unit.beds[size] * par)
        if (total > 0) out.push({ itemId: it.id, name: it.name, group: it.group, size, perUnitQty, par, total })
      }
      continue
    }
    const c = countOf(it.per, unit)
    const perUnitQty = up(it.qty * c)
    const total = up(it.qty * c * par)
    if (total > 0) out.push({ itemId: it.id, name: it.name, group: it.group, perUnitQty, par, total })
  }
  return out
}

export type LinenTotalRow = {
  key: string
  itemId: string
  name: string
  group: LinenGroup
  size?: string
  qty: number
  price: number | null
  cost: number | null
  vendor?: string
  sku?: string
  product?: string
}
export type LinenTotals = { rows: LinenTotalRow[]; grandTotal: number; priced: number; unpriced: number; units: number; tier: LinenTier }

/** An item's option at a tier ({} when nothing is set). */
export function tierOf(it: Pick<LinenItem, 'tiers'>, tier: LinenTier): TierOption {
  return (it.tiers && it.tiers[tier]) || {}
}
/** Counted at this tier: switched on, and not left out of the tier. */
export function inTier(it: LinenItem, tier: LinenTier): boolean {
  return it.active !== false && !tierOf(it, tier).off
}

/** The price per piece for a row: the size's own price on a per-bed item, else the tier's price. */
export function priceFor(opt: Pick<TierOption, 'price' | 'priceBySize'>, size?: string): number | null {
  if (size && opt.priceBySize && typeof opt.priceBySize[size] === 'number') return opt.priceBySize[size]
  return typeof opt.price === 'number' ? opt.price : null
}

/**
 * The buy list across units at one tier (Mid unless told otherwise): rows merged by item + size, in
 * the standard's order (group, item, bed size), each priced when that tier carries a price, and a
 * grand total of the priced rows. Items left out of the tier are left out of the list.
 */
export function linenTotals(standard: LinenStandard, units: LinenUnit[], tier: LinenTier = 'mid'): LinenTotals {
  const byKey = new Map<string, LinenTotalRow>()
  const itemById = new Map(standard.items.map(i => [i.id, i] as const))
  for (const u of units) for (const r of linenNeeds(standard, u)) {
    const it = itemById.get(r.itemId)
    if (it && !inTier(it, tier)) continue
    const key = r.itemId + '|' + (r.size || '')
    const cur = byKey.get(key)
    if (cur) { cur.qty += r.total; continue }
    const opt = it ? tierOf(it, tier) : {}
    const row: LinenTotalRow = { key, itemId: r.itemId, name: r.name, group: r.group, qty: r.total, price: priceFor(opt, r.size), cost: null }
    if (r.size) row.size = r.size
    if (opt.vendor) row.vendor = opt.vendor
    if (opt.sku) row.sku = opt.sku
    if (opt.product) row.product = opt.product
    byKey.set(key, row)
  }
  const itemAt = (id: string) => standard.items.findIndex(i => i.id === id)
  const sizeAt = (s?: string) => { if (!s) return -1; const i = standard.bedSizes.findIndex(o => o.toLowerCase() === s.toLowerCase()); return i < 0 ? 999 : i }
  const rows = Array.from(byKey.values()).sort((a, b) =>
    LINEN_GROUPS.indexOf(a.group) - LINEN_GROUPS.indexOf(b.group) || itemAt(a.itemId) - itemAt(b.itemId) || sizeAt(a.size) - sizeAt(b.size) || String(a.size || '').localeCompare(String(b.size || '')))
  let grand = 0, priced = 0, unpriced = 0
  for (const r of rows) {
    if (r.price === null) { unpriced++; continue }
    r.cost = r2(r.price * r.qty)
    grand += r.cost
    priced++
  }
  return { rows, grandTotal: r2(grand), priced, unpriced, units: units.length, tier }
}

// ── the owner's quote ─────────────────────────────────────────────────────────────────────────────
export type LinenQuote = {
  tier: LinenTier
  label: string
  rows: LinenTotalRow[]
  off: { itemId: string; name: string }[]   // switched-on items this tier leaves out
  pieces: number
  subtotal: number                          // Σ pieces × price per piece, priced rows only
  markupPct: number
  markup: number
  taxPct: number
  tax: number                               // on subtotal + markup
  total: number
  priced: number
  unpriced: number
  units: number
}

/**
 * What the owner is billed at one tier: the pieces their units receive × the piece price, the
 * standard's markup on top, tax on top of that. NOT whole cases — the case overage is our stock
 * (see vendorOrder). Unpriced rows are counted and left out of the money, never priced at $0.
 */
export function linenQuote(standard: LinenStandard, units: LinenUnit[], tier: LinenTier): LinenQuote {
  const t = linenTotals(standard, units, tier)
  const subtotal = t.grandTotal
  const markupPct = standard.markupPct || 0
  const taxPct = standard.taxPct || 0
  const markup = r2(subtotal * markupPct / 100)
  const tax = r2((subtotal + markup) * taxPct / 100)
  return {
    tier,
    label: (standard.tierLabels && standard.tierLabels[tier]) || DEFAULT_TIER_LABELS[tier],
    rows: t.rows,
    off: standard.items.filter(i => i.active !== false && tierOf(i, tier).off).map(i => ({ itemId: i.id, name: i.name })),
    pieces: t.rows.reduce((a, r) => a + r.qty, 0),
    subtotal, markupPct, markup, taxPct, tax,
    total: r2(subtotal + markup + tax),
    priced: t.priced,
    unpriced: t.unpriced,
    units: units.length,
  }
}

/** The three tiers side by side, for the same units. */
export function linenQuoteAllTiers(standard: LinenStandard, units: LinenUnit[]): Record<LinenTier, LinenQuote> {
  return { low: linenQuote(standard, units, 'low'), mid: linenQuote(standard, units, 'mid'), lux: linenQuote(standard, units, 'lux') }
}

/** The one-liner on the onboarding desk: each tier's total, and the tier Jon picked. */
export type LinenSummary = {
  tiers: Record<LinenTier, { label: string; total: number; priced: number; unpriced: number; pieces: number }>
  chosen: LinenTier | null
  beds: string
}
export function linenSummary(standard: LinenStandard, unit: LinenUnit, chosen: LinenTier | null): LinenSummary {
  const q = linenQuoteAllTiers(standard, [unit])
  const tiers = {} as LinenSummary['tiers']
  for (const t of LINEN_TIERS) tiers[t] = { label: q[t].label, total: q[t].total, priced: q[t].priced, unpriced: q[t].unpriced, pieces: q[t].pieces }
  return { tiers, chosen, beds: bedsLabel(unit.beds, standard.bedSizes) }
}

/**
 * An onboarding unit (a row of onboarding_units) as a linen unit. Beds, first hit wins: saved on
 * the linen page for the onboarding link, saved for the listing it was assigned to, the walk's
 * pre-form, one Queen per bedroom. Bathrooms and guests come from the pre-form.
 */
export function onboardingLinenUnit(row: any, savedBeds: any): LinenUnit {
  const r = isObj(row) ? row : {}
  const d = isObj(r.details) ? r.details : {}
  const saved = isObj(savedBeds) ? savedBeds : {}
  const pos = (v: any) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0 }
  const bedrooms = Math.round(pos(d.bedrooms))
  const code = String(r.code || '').toLowerCase()
  const mine = normBeds(saved['onboard:' + code])
  const listed = r.listing_id ? normBeds(saved[String(r.listing_id)]) : {}
  const walked = bedsFromOnboarding(d)
  const [beds, bedsSource]: [Record<string, number>, BedsSource] = Object.keys(mine).length ? [mine, 'saved']
    : Object.keys(listed).length ? [listed, 'saved']
      : Object.keys(walked).length ? [walked, 'onboarding'] : [assumedBeds(bedrooms), 'assumed']
  return {
    id: 'onboard:' + code, name: text(r.name, LIMITS.name) || 'Unit', building: r.building ? String(r.building) : null,
    bedrooms, bathrooms: pos(d.bathrooms), guests: Math.round(pos(d.occupancy)), beds, bedsSource,
  }
}

// ── the vendor order: whole cases ─────────────────────────────────────────────────────────────────
export type VendorLine = {
  key: string
  itemId: string
  name: string
  group: LinenGroup
  size?: string
  sku?: string
  product?: string
  piecesNeeded: number
  packSize: number        // 1 = sold singly
  minCases: number
  cases: number
  piecesOrdered: number   // cases × packSize
  overage: number         // piecesOrdered − piecesNeeded: goes to stock
  price: number | null    // per piece
  casePrice: number | null
  cost: number | null
}
export type VendorGroup = {
  vendor: string | null           // null = no vendor set on these lines yet
  info: LinenVendor | null        // the vendor's card from the standard, when the name matches one
  lines: VendorLine[]
  subtotal: number                // priced lines only
  priced: number
  unpriced: number
  piecesNeeded: number
  piecesOrdered: number
  overage: number
  minOrder: number | null
  belowMinimum: boolean           // priced lines add up to less than the vendor's $ minimum
  shortBy: number                 // how far below the minimum
  leadDays: number | null
}
export type VendorOrder = {
  tier: LinenTier
  label: string
  groups: VendorGroup[]
  total: number
  piecesNeeded: number
  piecesOrdered: number
  overage: number
  priced: number
  unpriced: number
  units: number
}

/**
 * What to buy, vendor by vendor. Pieces are pooled across every unit per (vendor, SKU — or the item
 * when there is no SKU — and bed size), then rounded UP to whole cases of the tier's pack size, and
 * never below the line's minimum cases. cost = cases × pack × price per piece. The overage
 * (ordered − needed) goes to stock. A vendor whose priced lines total less than its $ minimum is
 * flagged, with its lead time alongside. Lines with no vendor set are grouped last.
 */
export function vendorOrder(standard: LinenStandard, units: LinenUnit[], tier: LinenTier): VendorOrder {
  const t = linenTotals(standard, units, tier)
  const itemById = new Map(standard.items.map(i => [i.id, i] as const))
  const vendorCard = (name: string) => standard.vendors.find(v => v.name.toLowerCase() === name.toLowerCase()) || null
  const groups = new Map<string, { vendor: string | null; info: LinenVendor | null; lines: Map<string, VendorLine> }>()
  for (const r of t.rows) {
    const it = itemById.get(r.itemId)
    const opt = it ? tierOf(it, tier) : {}
    const vName = (opt.vendor || '').trim()
    const vKey = vName.toLowerCase()
    let g = groups.get(vKey)
    if (!g) {
      const info = vName ? vendorCard(vName) : null
      g = { vendor: vName ? (info ? info.name : vName) : null, info, lines: new Map() }
      groups.set(vKey, g)
    }
    const lineKey = (opt.sku ? 'sku:' + opt.sku.toLowerCase() : 'item:' + r.itemId) + '|' + (r.size || '')
    const cur = g.lines.get(lineKey)
    if (cur) {
      cur.piecesNeeded += r.qty
      if (!cur.name.split(' / ').includes(r.name)) cur.name += ' / ' + r.name
      continue
    }
    const line: VendorLine = {
      key: vKey + '|' + lineKey, itemId: r.itemId, name: r.name, group: r.group, piecesNeeded: r.qty,
      packSize: Math.max(1, Math.round(opt.packSize || 1)), minCases: Math.max(0, Math.round(opt.minCases || 0)),
      cases: 0, piecesOrdered: 0, overage: 0, price: r.price, casePrice: null, cost: null,
    }
    if (r.size) line.size = r.size
    if (opt.sku) line.sku = opt.sku
    if (opt.product) line.product = opt.product
    g.lines.set(lineKey, line)
  }
  const out: VendorGroup[] = []
  for (const g of Array.from(groups.values())) {
    const lines = Array.from(g.lines.values())
    let subtotal = 0, priced = 0, unpriced = 0
    for (const l of lines) {
      l.cases = l.piecesNeeded > 0 ? Math.max(Math.ceil(l.piecesNeeded / l.packSize), l.minCases) : 0
      l.piecesOrdered = l.cases * l.packSize
      l.overage = l.piecesOrdered - l.piecesNeeded
      if (l.price === null) { unpriced++; continue }
      l.casePrice = r2(l.price * l.packSize)
      l.cost = r2(l.cases * l.casePrice)
      subtotal += l.cost
      priced++
    }
    subtotal = r2(subtotal)
    const minOrder = g.info && typeof g.info.minOrder === 'number' && g.info.minOrder > 0 ? g.info.minOrder : null
    const belowMinimum = minOrder !== null && subtotal < minOrder
    out.push({
      vendor: g.vendor, info: g.info, lines, subtotal, priced, unpriced,
      piecesNeeded: lines.reduce((a, l) => a + l.piecesNeeded, 0),
      piecesOrdered: lines.reduce((a, l) => a + l.piecesOrdered, 0),
      overage: lines.reduce((a, l) => a + l.overage, 0),
      minOrder, belowMinimum, shortBy: belowMinimum ? r2((minOrder as number) - subtotal) : 0,
      leadDays: g.info && typeof g.info.leadDays === 'number' ? g.info.leadDays : null,
    })
  }
  out.sort((a, b) => (a.vendor === null ? 1 : 0) - (b.vendor === null ? 1 : 0) || String(a.vendor).localeCompare(String(b.vendor)))
  return {
    tier,
    label: (standard.tierLabels && standard.tierLabels[tier]) || DEFAULT_TIER_LABELS[tier],
    groups: out,
    total: r2(out.reduce((a, g) => a + g.subtotal, 0)),
    piecesNeeded: out.reduce((a, g) => a + g.piecesNeeded, 0),
    piecesOrdered: out.reduce((a, g) => a + g.piecesOrdered, 0),
    overage: out.reduce((a, g) => a + g.overage, 0),
    priced: out.reduce((a, g) => a + g.priced, 0),
    unpriced: out.reduce((a, g) => a + g.unpriced, 0),
    units: units.length,
  }
}

// ── the deck slide ────────────────────────────────────────────────────────────────────────────────
/** The "Linen package" section of an owner onboarding deck: three tiers, one highlighted. */
export type LinenDeckSection = {
  headline: string
  subtitle: string
  tiers: { key: LinenTier; label: string; total: string; sub: string; lines: { k: string; v: string }[]; chosen: boolean }[]
  chosen: LinenTier | null
  note: string
}

// The items that tell an owner what a tier IS, in this order, by the standard's starting ids.
const DECK_KEY_ITEMS: [string, string][] = [['fitted-sheet', 'Sheets'], ['duvet-cover', 'Duvet cover'], ['pillows', 'Pillows'], ['bath-towels', 'Towels']]

/**
 * The deck slide for a set of units, or null when no tier has a single priced line — a slide of
 * blank prices tells an owner nothing. Totals are the owner's (pieces × price, markup and tax in).
 */
export function linenDeckSection(standard: LinenStandard, units: LinenUnit[], chosen: LinenTier | null): LinenDeckSection | null {
  if (!units.length) return null
  const q = linenQuoteAllTiers(standard, units)
  if (!LINEN_TIERS.some(t => q[t].priced > 0)) return null
  const beds: Record<string, number> = {}
  for (const u of units) for (const [k, n] of Object.entries(u.beds || {})) beds[k] = (beds[k] || 0) + n
  const tiers = LINEN_TIERS.map(tier => {
    const qt = q[tier]
    const lines: { k: string; v: string }[] = []
    const used = new Set<string>()
    for (const [id, label] of DECK_KEY_ITEMS) {
      const it = standard.items.find(i => i.id === id)
      const p = it && inTier(it, tier) ? tierOf(it, tier).product : ''
      if (it && p) { lines.push({ k: label, v: p }); used.add(id) }
    }
    // Jon renamed or removed the usual ones: fill from the rest of his list, in its order.
    for (const it of standard.items) {
      if (lines.length >= 4) break
      if (used.has(it.id) || !inTier(it, tier)) continue
      const p = tierOf(it, tier).product
      if (p) { lines.push({ k: it.name, v: p }); used.add(it.id) }
    }
    const unpricedNote = qt.unpriced ? ` · ${qt.unpriced} line${qt.unpriced === 1 ? '' : 's'} to be priced` : ''
    return {
      key: tier, label: qt.label,
      total: qt.priced ? fmtUsd(qt.total) : 'To be priced',
      sub: `${qt.pieces.toLocaleString('en-US')} pieces${units.length > 1 ? ' across ' + units.length + ' units' : ''}${unpricedNote}`,
      lines, chosen: chosen === tier,
    }
  })
  // The same word the invoice uses for the same charge.
  const extras = [standard.markupPct ? 'markup' : '', standard.taxPct ? 'tax' : ''].filter(Boolean).join(' and ')
  const sized = sortSizes(Object.keys(beds).filter(k => beds[k] > 0), standard.bedSizes).map(k => beds[k] + ' ' + k + (beds[k] > 1 ? 's' : ''))
  const bedWords = sized.length > 1 ? sized.slice(0, -1).join(', ') + ' and ' + sized[sized.length - 1] : (sized[0] || 'your beds')
  return {
    headline: 'Your linen package',
    subtitle: `Everything the beds and baths need, at three levels of finish — sized to ${bedWords}.`,
    tiers,
    chosen,
    note: `Priced for the pieces your unit receives: ${standard.par} set${standard.par === 1 ? '' : 's'} of every rotating item${standard.par === 3 ? ' — one on the bed, one in the wash, one on the shelf' : ''}${extras ? '; ' + extras + ' included' : ''}.`,
  }
}

// ── export ────────────────────────────────────────────────────────────────────────────────────────
/** $1,234.56 — every dollar figure on the linen desk and its documents. */
export function fmtUsd(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function csvCell(v: any): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The buy list as CSV (formula-leading cells are defused so a spreadsheet never runs one). */
export function linenCsv(t: LinenTotals): string {
  const lines = [['Group', 'Item', 'Size', 'Qty', 'Unit price', 'Cost', 'Vendor', 'SKU', 'Product'].join(',')]
  for (const r of t.rows) lines.push([r.group, r.name, r.size || '', r.qty, r.price ?? '', r.cost ?? '', r.vendor || '', r.sku || '', r.product || ''].map(csvCell).join(','))
  if (t.priced) lines.push(['', 'Total', '', '', '', t.grandTotal, '', '', ''].map(csvCell).join(','))
  return lines.join('\n') + '\n'
}

/** The buy list as plain text, one line per row, grouped — for a message to the vendor. */
export function linenText(t: LinenTotals, title?: string): string {
  const out: string[] = []
  if (title) out.push(title)
  for (const g of LINEN_GROUPS) {
    const rows = t.rows.filter(r => r.group === g)
    if (!rows.length) continue
    out.push('', g)
    for (const r of rows) out.push(`${r.qty} × ${r.name}${r.size ? ' (' + r.size + ')' : ''}`)
  }
  return out.join('\n').replace(/^\n/, '') + '\n'
}

/** A tier's quote as plain text: grouped lines with product and amount, then the totals. */
export function quoteText(q: LinenQuote, title?: string): string {
  const out: string[] = []
  out.push((title ? title + ' — ' : '') + q.label + ' linen package')
  for (const g of LINEN_GROUPS) {
    const rows = q.rows.filter(r => r.group === g)
    if (!rows.length) continue
    out.push('', g)
    for (const r of rows) out.push(`${r.qty} × ${r.name}${r.size ? ' (' + r.size + ')' : ''}${r.product ? ' — ' + r.product : ''} — ${r.cost !== null ? fmtUsd(r.cost) : 'to be priced'}`)
  }
  out.push('')
  if (q.priced) {
    out.push('Subtotal ' + fmtUsd(q.subtotal))
    if (q.markup) out.push(`Markup (${q.markupPct}%) ${fmtUsd(q.markup)}`)
    if (q.tax) out.push(`Tax (${q.taxPct}%) ${fmtUsd(q.tax)}`)
    out.push('Total ' + fmtUsd(q.total))
  }
  if (q.unpriced) out.push(`${q.unpriced} line${q.unpriced === 1 ? '' : 's'} still to be priced`)
  return out.join('\n') + '\n'
}

/** The vendor order as CSV: one row per line, a subtotal per vendor, the order total. */
export function vendorOrderCsv(o: VendorOrder): string {
  const lines = [['Vendor', 'SKU', 'Item', 'Product', 'Size', 'Pieces needed', 'Pieces per case', 'Cases', 'Pieces ordered', 'To stock', 'Case price', 'Amount'].join(',')]
  for (const g of o.groups) {
    const v = g.vendor || 'No vendor set'
    for (const l of g.lines) lines.push([v, l.sku || '', l.name, l.product || '', l.size || '', l.piecesNeeded, l.packSize, l.cases, l.piecesOrdered, l.overage, l.casePrice ?? '', l.cost ?? ''].map(csvCell).join(','))
    lines.push([v, '', 'Subtotal', '', '', g.piecesNeeded, '', '', g.piecesOrdered, g.overage, '', g.subtotal].map(csvCell).join(','))
  }
  lines.push(['', '', 'Order total', '', '', o.piecesNeeded, '', '', o.piecesOrdered, o.overage, '', o.total].map(csvCell).join(','))
  return lines.join('\n') + '\n'
}

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
// Isomorphic and import-free on purpose: the page, the API and the plain-node test
// (lib/__tests__/linens.test.mjs) all read this one file, so the number the page shows is the
// number the test checks.

export type LinenGroup = 'Bed' | 'Bath' | 'Kitchen' | 'Other'
export type LinenPer = 'bed' | 'bathroom' | 'bedroom' | 'guest' | 'unit'

export type LinenItem = {
  id: string
  name: string
  group: LinenGroup
  per: LinenPer
  qty: number                               // per `per`; for a per-bed item, the count for any size not in qtyBySize
  qtyBySize?: Record<string, number>        // per-bed items only: the count on a bed of that size (pillows: 4 on a King, 2 on a Twin)
  rotates: boolean                          // true → multiplied by par (sets in rotation); false → one set (pillows, duvet inserts)
  par?: number | null                       // this item's own par; blank = the standard's par
  vendor?: string
  sku?: string
  price?: number | null                     // unit price at the vendor
  priceBySize?: Record<string, number>      // per-bed items only: a King sheet is not priced like a Twin sheet
  notes?: string
  active?: boolean                          // false = kept on the list, left out of every count
}

export type LinenStandard = { par: number; bedSizes: string[]; items: LinenItem[]; updatedAt?: string; updatedBy?: string }

export const LINEN_STANDARD_KEY = 'linen_standard'   // app_settings: the standard
export const LINEN_UNIT_BEDS_KEY = 'linen_unit_beds' // app_settings: { [listingId]: { King: 1, Queen: 2 } }

export const LINEN_GROUPS: LinenGroup[] = ['Bed', 'Bath', 'Kitchen', 'Other']
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
export const LIMITS = { num: 999, price: 99_999, items: 200, sizes: 12, name: 80, size: 30, vendor: 80, sku: 60, notes: 300, id: 60, who: 120 }

const PILLOWS: Record<string, number> = { King: 4, Queen: 4, Full: 2, Twin: 2, 'Sofa bed': 2 }

/** STARTING VALUES — what the page opens with before Jon saves his own list. */
export const DEFAULT_LINEN_STANDARD: LinenStandard = {
  par: DEFAULT_PAR,
  bedSizes: [...DEFAULT_BED_SIZES],
  items: [
    // Bed — per bed, sized by the bed it goes on.
    { id: 'mattress-protector', name: 'Mattress protector', group: 'Bed', per: 'bed', qty: 1, rotates: true, par: 2 },
    { id: 'pillow-protectors', name: 'Pillow protectors', group: 'Bed', per: 'bed', qty: 2, qtyBySize: { ...PILLOWS }, rotates: true },
    { id: 'pillows', name: 'Pillows', group: 'Bed', per: 'bed', qty: 2, qtyBySize: { ...PILLOWS }, rotates: false },
    { id: 'pillowcases', name: 'Pillowcases', group: 'Bed', per: 'bed', qty: 2, qtyBySize: { ...PILLOWS }, rotates: true },
    { id: 'fitted-sheet', name: 'Fitted sheet', group: 'Bed', per: 'bed', qty: 1, rotates: true },
    { id: 'flat-sheet', name: 'Flat sheet', group: 'Bed', per: 'bed', qty: 1, rotates: true },
    { id: 'duvet-insert', name: 'Duvet insert', group: 'Bed', per: 'bed', qty: 1, rotates: false },
    { id: 'duvet-cover', name: 'Duvet cover', group: 'Bed', per: 'bed', qty: 1, rotates: true },
    // Bath
    { id: 'bath-towels', name: 'Bath towels', group: 'Bath', per: 'guest', qty: 1, rotates: true },
    { id: 'hand-towels', name: 'Hand towels', group: 'Bath', per: 'bathroom', qty: 2, rotates: true },
    { id: 'washcloths', name: 'Washcloths', group: 'Bath', per: 'guest', qty: 1, rotates: true },
    { id: 'makeup-cloths', name: 'Makeup cloths', group: 'Bath', per: 'guest', qty: 1, rotates: true },
    { id: 'bath-mat', name: 'Bath mat', group: 'Bath', per: 'bathroom', qty: 1, rotates: true },
    { id: 'pool-towels', name: 'Pool/beach towels', group: 'Bath', per: 'guest', qty: 1, rotates: false, active: false },
    // Kitchen — per unit
    { id: 'kitchen-towels', name: 'Kitchen towels', group: 'Kitchen', per: 'unit', qty: 4, rotates: true },
    { id: 'dish-cloths', name: 'Dish cloths', group: 'Kitchen', per: 'unit', qty: 2, rotates: true },
    { id: 'oven-mitts', name: 'Oven mitts', group: 'Kitchen', per: 'unit', qty: 2, rotates: false },
    { id: 'pot-holders', name: 'Pot holders', group: 'Kitchen', per: 'unit', qty: 2, rotates: false },
    // Other
    { id: 'throw-blanket', name: 'Throw blanket', group: 'Other', per: 'bedroom', qty: 1, rotates: false },
    { id: 'extra-blanket', name: 'Extra blanket', group: 'Other', per: 'bedroom', qty: 1, rotates: false },
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
  const x = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(x)) return null
  return Math.round(Math.max(0, Math.min(max, x)) * 100) / 100
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

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

function normItem(v: any, taken: Set<string>): LinenItem | null {
  if (!isObj(v)) return null
  const name = text(v.name, LIMITS.name)
  if (!name) return null
  const group: LinenGroup = LINEN_GROUPS.includes(v.group) ? v.group : 'Other'
  const per: LinenPer = LINEN_PER.some(p => p.key === v.per) ? v.per : 'unit'
  let id = /^[A-Za-z0-9_-]{1,60}$/.test(String(v.id || '')) ? String(v.id) : (slug(name) || 'item')
  if (taken.has(id)) { let i = 2; while (taken.has(id + '-' + i)) i++; id = id + '-' + i }
  taken.add(id)
  const it: LinenItem = { id, name, group, per, qty: num(v.qty, LIMITS.num) ?? 1, rotates: v.rotates === true }
  if (per === 'bed') {
    const q = sizeMap(v.qtyBySize, LIMITS.num); if (q) it.qtyBySize = q
    const p = sizeMap(v.priceBySize, LIMITS.price); if (p) it.priceBySize = p
  }
  const par = num(v.par, LIMITS.num); if (par !== null) it.par = Math.round(par)
  const vendor = text(v.vendor, LIMITS.vendor); if (vendor) it.vendor = vendor
  const sku = text(v.sku, LIMITS.sku); if (sku) it.sku = sku
  const price = num(v.price, LIMITS.price); if (price !== null) it.price = price
  const notes = text(v.notes, LIMITS.notes); if (notes) it.notes = notes
  it.active = v.active !== false
  return it
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
  const out: LinenStandard = { par: parN === null ? DEFAULT_PAR : Math.round(parN), bedSizes: normBedSizes(src.bedSizes), items }
  const at = text(src.updatedAt, 40); if (at && !Number.isNaN(Date.parse(at))) out.updatedAt = at
  const by = text(src.updatedBy, LIMITS.who); if (by) out.updatedBy = by
  return out
}

// ── units ─────────────────────────────────────────────────────────────────────────────────────────
// Where a unit's beds came from: saved on this page, Guesty's listing rooms, the onboarding walk's
// pre-form, or assumed (one Queen per bedroom, a studio counted as one).
export type BedsSource = 'guesty' | 'saved' | 'assumed' | 'onboarding'
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
}
export type LinenTotals = { rows: LinenTotalRow[]; grandTotal: number; priced: number; unpriced: number; units: number }

/** The unit price for a row: the size's own price on a per-bed item, else the item's price. */
export function priceFor(it: Pick<LinenItem, 'price' | 'priceBySize'>, size?: string): number | null {
  if (size && it.priceBySize && typeof it.priceBySize[size] === 'number') return it.priceBySize[size]
  return typeof it.price === 'number' ? it.price : null
}

/**
 * The buy list across units: rows merged by item + size, in the standard's order (group, item,
 * bed size), each priced when the standard carries a price, and a grand total of the priced rows.
 */
export function linenTotals(standard: LinenStandard, units: LinenUnit[]): LinenTotals {
  const byKey = new Map<string, LinenTotalRow>()
  for (const u of units) for (const r of linenNeeds(standard, u)) {
    const key = r.itemId + '|' + (r.size || '')
    const cur = byKey.get(key)
    if (cur) { cur.qty += r.total; continue }
    const it = standard.items.find(i => i.id === r.itemId)
    const row: LinenTotalRow = { key, itemId: r.itemId, name: r.name, group: r.group, qty: r.total, price: it ? priceFor(it, r.size) : null, cost: null }
    if (r.size) row.size = r.size
    if (it?.vendor) row.vendor = it.vendor
    if (it?.sku) row.sku = it.sku
    byKey.set(key, row)
  }
  const itemAt = (id: string) => standard.items.findIndex(i => i.id === id)
  const sizeAt = (s?: string) => { if (!s) return -1; const i = standard.bedSizes.findIndex(o => o.toLowerCase() === s.toLowerCase()); return i < 0 ? 999 : i }
  const rows = Array.from(byKey.values()).sort((a, b) =>
    LINEN_GROUPS.indexOf(a.group) - LINEN_GROUPS.indexOf(b.group) || itemAt(a.itemId) - itemAt(b.itemId) || sizeAt(a.size) - sizeAt(b.size) || String(a.size || '').localeCompare(String(b.size || '')))
  let grand = 0, priced = 0, unpriced = 0
  for (const r of rows) {
    if (r.price === null) { unpriced++; continue }
    r.cost = Math.round(r.price * r.qty * 100) / 100
    grand += r.cost
    priced++
  }
  return { rows, grandTotal: Math.round(grand * 100) / 100, priced, unpriced, units: units.length }
}

// ── export ────────────────────────────────────────────────────────────────────────────────────────
function csvCell(v: any): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The buy list as CSV (formula-leading cells are defused so a spreadsheet never runs one). */
export function linenCsv(t: LinenTotals): string {
  const lines = [['Group', 'Item', 'Size', 'Qty', 'Unit price', 'Cost', 'Vendor', 'SKU'].join(',')]
  for (const r of t.rows) lines.push([r.group, r.name, r.size || '', r.qty, r.price ?? '', r.cost ?? '', r.vendor || '', r.sku || ''].map(csvCell).join(','))
  if (t.priced) lines.push(['', 'Total', '', '', '', t.grandTotal, '', ''].map(csvCell).join(','))
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

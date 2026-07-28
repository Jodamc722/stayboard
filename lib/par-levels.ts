// INVENTORY PAR LEVELS — how many of each essential a unit MUST have to be guest-ready.
//
// An audit already counts what is physically in the unit. Par turns that count into a decision:
// anything below par is a shortfall, and a shortfall becomes an 'add' order line on the audit, so
// the order desk fills it. Without par a count is just trivia; with par the audit self-feeds.
//
// Counts scale with the UNIT, not the room — towels track guests, pillows track beds, hangers
// track bedrooms. That is why a rule is { qty, per } rather than a flat number.
//
// PURE MODULE: no server imports, no DB. The client (audit capture) and the server (restock
// route) both compute par from the same rules. Owner overrides live in app_settings key
// 'par_levels' and are merged in by whoever reads the setting — same split as lib/ops-presets.

export type ParBasis = 'unit' | 'guest' | 'bedroom' | 'bathroom' | 'bed'
export type ParRule = { item: string; qty: number; per: ParBasis; min?: number; max?: number }
export type ParTable = Record<string, ParRule[]>
export type UnitShape = { bedrooms: number; bathrooms: number; guests: number; beds: number }

export const PAR_CATEGORIES = ['kitchen', 'bath', 'bedroom', 'living', 'laundry', 'outdoor'] as const
export const PAR_CATEGORY_LABEL: Record<string, string> = {
  kitchen: 'Kitchen', bath: 'Bathroom', bedroom: 'Bedroom', living: 'Living room', laundry: 'Laundry / utility', outdoor: 'Balcony / outdoor',
}
export const PAR_BASIS_LABEL: Record<ParBasis, string> = {
  unit: 'per unit', guest: 'per guest', bedroom: 'per bedroom', bathroom: 'per bathroom', bed: 'per bed',
}

// Shipped defaults. Item names MATCH the essentials labels the audit form already uses, so a
// counted inventory row joins to its par line by title — no separate catalogue to keep in sync.
export const DEFAULT_PAR: ParTable = {
  kitchen: [
    { item: 'Plates', qty: 1, per: 'guest', min: 4 },
    { item: 'Bowls', qty: 1, per: 'guest', min: 4 },
    { item: 'Glasses', qty: 2, per: 'guest', min: 8 },
    { item: 'Mugs', qty: 1, per: 'guest', min: 4 },
    { item: 'Silverware', qty: 1, per: 'guest', min: 4 },
    { item: 'Cooking utensils', qty: 1, per: 'unit' },
    { item: 'Pots + pans', qty: 3, per: 'unit' },
    { item: 'Knife set', qty: 1, per: 'unit' },
    { item: 'Cutting board', qty: 1, per: 'unit' },
    { item: 'Baking sheet', qty: 1, per: 'unit' },
    { item: 'Coffee maker', qty: 1, per: 'unit' },
    { item: 'Toaster', qty: 1, per: 'unit' },
    { item: 'Blender', qty: 1, per: 'unit' },
    { item: 'Kettle', qty: 1, per: 'unit' },
    { item: 'Can opener', qty: 1, per: 'unit' },
    { item: 'Wine opener', qty: 1, per: 'unit' },
    { item: 'Trash bin', qty: 1, per: 'unit' },
  ],
  bath: [
    { item: 'Bath towels', qty: 2, per: 'guest', min: 4 },
    { item: 'Hand towels', qty: 2, per: 'bathroom', min: 2 },
    { item: 'Bath mat', qty: 1, per: 'bathroom' },
    { item: 'Hair dryer', qty: 1, per: 'bathroom' },
    { item: 'Plunger', qty: 1, per: 'unit' },
    { item: 'Trash bin', qty: 1, per: 'bathroom' },
  ],
  bedroom: [
    { item: 'Pillows', qty: 2, per: 'bed', min: 2 },
    { item: 'Extra linens', qty: 1, per: 'bed' },
    { item: 'Hangers', qty: 10, per: 'bedroom' },
    { item: 'Iron', qty: 1, per: 'unit' },
    { item: 'Luggage rack', qty: 1, per: 'bedroom' },
    { item: 'Safe', qty: 1, per: 'unit' },
  ],
  living: [
    { item: 'Throw blankets', qty: 2, per: 'unit' },
    { item: 'Extra pillows', qty: 2, per: 'unit' },
    { item: 'Board games', qty: 1, per: 'unit' },
  ],
  laundry: [
    { item: 'Vacuum', qty: 1, per: 'unit' },
    { item: 'Broom + dustpan', qty: 1, per: 'unit' },
    { item: 'Mop', qty: 1, per: 'unit' },
    { item: 'Ironing board', qty: 1, per: 'unit' },
    { item: 'First aid kit', qty: 1, per: 'unit' },
    { item: 'Fire extinguisher', qty: 1, per: 'unit' },
  ],
  outdoor: [
    { item: 'Outdoor seating', qty: 1, per: 'guest', min: 2 },
    { item: 'Outdoor table', qty: 1, per: 'unit' },
  ],
}

/**
 * Which par list a room uses. Mirrors how the audit form names rooms ("Guest bedroom 1",
 * "Master bedroom — Bathroom"), so nested rooms resolve off their LEAF name.
 */
export function parCategory(room: string): string {
  const parts = String(room || '').split(' — ')
  const r = String(parts[parts.length - 1] || room || '').toLowerCase()
  if (r.indexOf('kitchen') >= 0) return 'kitchen'
  if (r.indexOf('bath') >= 0 || r.indexOf('powder') >= 0 || r.indexOf('shower') >= 0) return 'bath'
  if (r.indexOf('bedroom') >= 0 || r.indexOf('master') >= 0 || r.indexOf('studio') >= 0) return 'bedroom'
  if (r.indexOf('living') >= 0 || r.indexOf('lounge') >= 0 || r.indexOf('den') >= 0) return 'living'
  if (r.indexOf('laundry') >= 0 || r.indexOf('hall') >= 0 || r.indexOf('utility') >= 0 || r.indexOf('closet') >= 0) return 'laundry'
  if (r.indexOf('balcony') >= 0 || r.indexOf('patio') >= 0 || r.indexOf('terrace') >= 0 || r.indexOf('deck') >= 0) return 'outdoor'
  return ''
}

/** Titles compare loosely — "Bath Towels" and "bath towels" are the same par line. */
export function parKey(s: any): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The unit's size, used to scale every rule. The 'basics' are the "Unit basics" tag titles the audit
 * form already captures ("Sleeps 6", "3 beds"); when they are missing we fall back to a sane
 * read of the listing's bedroom count rather than refusing to compute a par.
 */
export function unitShape(bedrooms: number | null, bathrooms: number | null, basics?: string[]): UnitShape {
  const br = typeof bedrooms === 'number' && bedrooms > 0 ? Math.round(bedrooms) : 1
  const ba = typeof bathrooms === 'number' && bathrooms > 0 ? Math.ceil(bathrooms) : 1
  let guests = 0
  let beds = 0
  for (const b of basics || []) {
    const s = String(b || '')
    const g = s.match(/sleeps\s*(\d+)/i)
    if (g) guests = Number(g[1]) || 0
    const d = s.match(/^(\d+)\+?\s*beds?$/i)
    if (d) beds = Number(d[1]) || 0
  }
  if (!guests) guests = Math.max(2, br * 2)
  if (!beds) beds = Math.max(1, br)
  return { bedrooms: br, bathrooms: ba, guests, beds }
}

function basisCount(per: ParBasis, shape: UnitShape): number {
  if (per === 'guest') return shape.guests
  if (per === 'bedroom') return shape.bedrooms
  if (per === 'bathroom') return shape.bathrooms
  if (per === 'bed') return shape.beds
  return 1
}

/**
 * Par for ONE rule against a unit. Per-room rules ('per bathroom', 'per bedroom') deliberately
 * resolve to the PER-ROOM amount, not the whole-unit total, because the audit counts room by room
 * — a 2-bath unit needs 2 hand towels in EACH bathroom, not 4 in one of them.
 */
export function parFor(rule: ParRule, shape: UnitShape): number {
  const perRoom = rule.per === 'bathroom' || rule.per === 'bedroom'
  const n = perRoom ? rule.qty : rule.qty * basisCount(rule.per, shape)
  let out = Math.round(n)
  if (typeof rule.min === 'number') out = Math.max(out, rule.min)
  if (typeof rule.max === 'number') out = Math.min(out, rule.max)
  return Math.max(0, Math.min(99, out))
}

/** The par list for a room: every rule in its category, resolved against this unit. */
export function parForRoom(room: string, shape: UnitShape, table?: ParTable): { item: string; par: number; per: ParBasis }[] {
  const t = table || DEFAULT_PAR
  const cat = parCategory(room)
  if (!cat) return []
  const rules = t[cat] || []
  const out: { item: string; par: number; per: ParBasis }[] = []
  for (const r of rules) {
    if (!r || !r.item) continue
    const par = parFor(r, shape)
    if (par > 0) out.push({ item: r.item, par, per: r.per })
  }
  return out
}

/**
 * Merge stored overrides over the defaults. A category present in the stored value REPLACES that
 * category wholesale (so the owner can delete a line, not just edit one); categories that are
 * absent keep the shipped defaults. Anything malformed is ignored — never throws.
 */
export function mergePar(stored: any): ParTable {
  const out: ParTable = {}
  for (const k of Object.keys(DEFAULT_PAR)) out[k] = DEFAULT_PAR[k].map(r => ({ ...r }))
  if (!stored || typeof stored !== 'object') return out
  const src = (stored.rooms && typeof stored.rooms === 'object') ? stored.rooms : stored
  for (const k of Object.keys(src)) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) continue
    const arr = (src as any)[k]
    if (!Array.isArray(arr)) continue
    const clean: ParRule[] = []
    for (const r of arr.slice(0, 60)) {
      if (!r || typeof r !== 'object') continue
      const item = String((r as any).item || '').slice(0, 60).trim()
      if (!item) continue
      const qty = Math.max(0, Math.min(99, Math.round(Number((r as any).qty) || 0)))
      const per: ParBasis = (['unit', 'guest', 'bedroom', 'bathroom', 'bed'].indexOf(String((r as any).per)) >= 0 ? String((r as any).per) : 'unit') as ParBasis
      const rule: ParRule = { item, qty, per }
      const mn = Number((r as any).min); if (Number.isFinite(mn) && mn > 0) rule.min = Math.min(99, Math.round(mn))
      const mx = Number((r as any).max); if (Number.isFinite(mx) && mx > 0) rule.max = Math.min(99, Math.round(mx))
      clean.push(rule)
    }
    out[k] = clean
  }
  return out
}

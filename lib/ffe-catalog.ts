// FF&E PRODUCT CATALOG — the shared vocabulary behind every order (Jon, 2026-08-12).
//
//   "If we wanted to add lamps, etc. Make the way it populates super easy and robust... with
//    furniture codes, where they go."
//
// WHY A CODE AT ALL. Before this, a product was free text on a line. Fifty-three units flagged
// "lamps" and came back as "Lamp", "lamps x2", "table lamp brass" — three products as far as any
// vendor, spreadsheet or delivery driver could tell. A code makes the lamp ONE thing: order it
// once, price it once, and when it arrives the person carrying it into 1101 is looking for
// LMP-001, not for somebody's phrasing.
//
// THE CODE IS DERIVED, NOT TYPED. You type "Brushed brass table lamp", pick Lamps, and the code
// appears. It stays editable, because the day a vendor gives you a real SKU their number is the
// better one and the form should not argue.

export type FfeCategory = {
  key: string
  label: string
  prefix: string       // 3 letters, the front of every code in this category
  rooms?: string[]     // rooms this category usually lands in — drives the destination default
  itemKeys?: string[]  // checklist item keys this category can satisfy, for auto-suggest
}

// Ordered roughly by how often a furniture order touches them. PREFIXES ARE PERMANENT: a code that
// has been on an owner's approved quote must not change meaning, so add categories, never re-letter
// the existing ones.
export const FFE_CATEGORIES: FfeCategory[] = [
  { key: 'sofa',     label: 'Sofas & sleepers',   prefix: 'SOF', rooms: ['living'], itemKeys: ['sofa', 'sofa_sleeper'] },
  { key: 'chair',    label: 'Chairs',             prefix: 'CHR', rooms: ['living', 'dining', 'office'], itemKeys: ['accent_chairs', 'dining_chairs', 'office_chair', 'bar_stools'] },
  { key: 'table',    label: 'Tables',             prefix: 'TBL', rooms: ['living', 'dining'], itemKeys: ['coffee_table', 'side_tables', 'dining_table', 'console', 'desk'] },
  { key: 'bed',      label: 'Beds & mattresses',  prefix: 'BED', rooms: ['master', 'guest1', 'guest2'], itemKeys: ['bed_frame', 'mattress'] },
  { key: 'case',     label: 'Case goods',         prefix: 'CSE', rooms: ['master', 'guest1', 'guest2'], itemKeys: ['nightstands', 'dresser', 'tv_stand', 'bedroom_tv_stand'] },
  { key: 'lamp',     label: 'Lamps & lighting',   prefix: 'LMP', rooms: ['living', 'master'], itemKeys: ['lamps', 'bedroom_lamps', 'desk_lamp', 'light_fixture', 'entry_light'] },
  { key: 'rug',      label: 'Rugs & carpet',      prefix: 'RUG', rooms: ['living', 'master'], itemKeys: ['carpet', 'bedroom_rug'] },
  { key: 'art',      label: 'Art & mirrors',      prefix: 'ART', rooms: ['living', 'master'], itemKeys: ['wall_art', 'dining_art', 'office_art', 'bedroom_art', 'entry_art', 'mirror', 'entry_mirror'] },
  { key: 'window',   label: 'Curtains & blinds',  prefix: 'WIN', rooms: ['living', 'master'], itemKeys: ['curtains', 'bedroom_curtains'] },
  { key: 'tv',       label: 'TVs & electronics',  prefix: 'TVE', rooms: ['living', 'master'], itemKeys: ['tv', 'bedroom_tv'] },
  { key: 'decor',    label: 'Decor & accessories', prefix: 'DEC', rooms: ['living'] },
  { key: 'misc',     label: 'Everything else',    prefix: 'GEN' },
]

export const CATEGORY_BY_KEY: Record<string, FfeCategory> =
  Object.fromEntries(FFE_CATEGORIES.map(c => [c.key, c]))

// ── KIND: WHAT SORT OF THING IT IS ──────────────────────────────────────────────────────────────
// Jon, 2026-08-13: "Also have in each of these tabs, Amenities, etc that we kind of already have."
//
// A catalog is not one list. A sofa and a bottle of dish soap are both things we buy for a unit, but
// they are bought by different people, on different cycles, from different suppliers, and approved
// in completely different ways — a sofa goes to an owner, a pack of sponges never does. Splitting on
// KIND is what stops the furniture list from being buried under consumables the day somebody adds
// them, which is the normal way these catalogs die.
export type FfeKind = { key: string; label: string; blurb: string }

export const FFE_KINDS: FfeKind[] = [
  { key: 'furniture', label: 'Furniture', blurb: 'The big things — sofas, beds, case goods, rugs, TVs. Owner-visible, long lead times.' },
  { key: 'amenity',   label: 'Amenities', blurb: 'What makes the unit work for a guest — coffee maker, cookware, hair dryer, speaker.' },
  { key: 'linen',     label: 'Linen & bath', blurb: 'Sheets, towels, pillows, protectors. Bought in par levels, replaced on a cycle.' },
  { key: 'supply',    label: 'Supplies', blurb: 'Consumables and turnover stock — paper goods, cleaning, bulbs, batteries.' },
]

export const KIND_BY_KEY: Record<string, FfeKind> = Object.fromEntries(FFE_KINDS.map(k => [k.key, k]))
export const KIND_KEYS: string[] = FFE_KINDS.map(k => k.key)
export const normalizeKind = (v: any): string => {
  const s = String(v || '').trim().toLowerCase()
  if (KIND_BY_KEY[s]) return s
  // What people type in a spreadsheet column instead of our key.
  if (/^(amenit|appliance|kitchen|electronic)/.test(s)) return 'amenity'
  if (/^(linen|bed(ding)?|bath|towel|sheet)/.test(s)) return 'linen'
  if (/^(supply|supplies|consumable|cleaning|paper)/.test(s)) return 'supply'
  return 'furniture'
}

// ── TIER: HOW GOOD A VERSION OF IT ──────────────────────────────────────────────────────────────
// Jon, 2026-08-13: "think through different tiers 1, tier 2, tier 3 and custom."
//
// The same product ROLE at three price points. Every unit needs a nightstand; the entire argument
// with an owner is which nightstand. Holding all three in the catalog turns "what would the cheaper
// one cost" into a filter instead of a week of re-quoting.
//
// TIER 1 IS THE ENTRY LEVEL AND TIER 3 IS THE BEST — ascending. The labels below carry that on
// screen ("Tier 1 · Value") so nobody has to remember which way round it goes. If the house meaning
// is the reverse, this list is the only place it needs changing.
//
// CUSTOM is the fourth on purpose: the one-off a designer specified for one building. It must be
// orderable without quietly becoming the default for everyone else.
export type FfeTier = { key: string; label: string; short: string; blurb: string }

export const FFE_TIERS: FfeTier[] = [
  { key: 'tier1', label: 'Tier 1 · Value',    short: 'T1', blurb: 'Entry level. Gets a unit furnished and rentable at the lowest defensible cost.' },
  { key: 'tier2', label: 'Tier 2 · Standard', short: 'T2', blurb: 'Our normal spec. What most units get unless there is a reason not to.' },
  { key: 'tier3', label: 'Tier 3 · Premium',  short: 'T3', blurb: 'Upgraded. For higher-ADR units and owners who want the building to show better.' },
  { key: 'custom', label: 'Custom',           short: 'CU', blurb: 'A one-off for one building or one owner. Never the default for anyone else.' },
]

export const TIER_BY_KEY: Record<string, FfeTier> = Object.fromEntries(FFE_TIERS.map(t => [t.key, t]))
export const TIER_KEYS: string[] = FFE_TIERS.map(t => t.key)
export const normalizeTier = (v: any): string => {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '')
  if (TIER_BY_KEY[s]) return s
  if (/^(t|tier|level|grade)?1$/.test(s) || /^(value|budget|entry|economy|good)$/.test(s)) return 'tier1'
  if (/^(t|tier|level|grade)?2$/.test(s) || /^(standard|std|mid|better|normal)$/.test(s)) return 'tier2'
  if (/^(t|tier|level|grade)?3$/.test(s) || /^(premium|best|luxury|lux|high|upgrade)$/.test(s)) return 'tier3'
  if (/^(custom|bespoke|one-?off|special|designer)$/.test(s)) return 'custom'
  return 'tier2'
}

/**
 * An Amazon SEARCH link for a product name.
 *
 * DELIBERATELY A SEARCH, NOT A PRODUCT PAGE. A made-up ASIN is a dead link, and a dead link in a
 * catalog is worse than no link — it wastes the buyer's time and quietly destroys trust in every
 * other link on the page. A search always resolves and always lands on the right query; when
 * somebody picks the actual item, they paste the real product URL over it and it stops being a
 * search. `startsWith('https://www.amazon.com/s?')` is how the UI knows which is which.
 */
export const amazonSearch = (q: string): string =>
  'https://www.amazon.com/s?k=' + encodeURIComponent(String(q || '').trim()).replace(/%20/g, '+')

export const isSearchLink = (u: string | null | undefined): boolean =>
  /^https?:\/\/(www\.)?(amazon\.com\/s\?|wayfair\.com\/keyword)/i.test(String(u || ''))

/** Which category a checklist item most likely belongs to — used to pre-filter the product picker. */
export function categoryForItem(itemKey: string): string {
  const k = String(itemKey || '')
  for (const c of FFE_CATEGORIES) if ((c.itemKeys || []).indexOf(k) >= 0) return c.key
  return 'misc'
}

export const prefixFor = (category: string): string =>
  (CATEGORY_BY_KEY[String(category || '')] || CATEGORY_BY_KEY.misc).prefix

/**
 * The next free code in a category: LMP-001, LMP-002...
 * `taken` is every code already in the catalog. Numbering never reuses a gap — a deleted product's
 * code stays retired, because it may still be sitting on an owner's approved quote.
 */
export function nextCode(category: string, taken: string[]): string {
  const p = prefixFor(category)
  const re = new RegExp('^' + p + '-(\\d{3,})$', 'i')
  let max = 0
  for (const t of taken || []) {
    const m = re.exec(String(t || '').trim())
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0)
  }
  return p + '-' + String(max + 1).padStart(3, '0')
}

/** Codes are compared and stored upper-case with a single hyphen; anything else is a typo. */
export const normalizeCode = (s: string): string =>
  String(s || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/[^A-Z0-9-]/g, '').slice(0, 32)

// ── BULK ADD ────────────────────────────────────────────────────────────────────────────────────
// The realistic way a catalog gets populated is somebody pasting a block out of a vendor quote or a
// spreadsheet. This parses that paste instead of making them type twelve forms. It accepts tabs,
// commas or pipes, skips a header row if it sees one, and is deliberately forgiving about column
// order for the two columns that are unambiguous: a $ amount is the price, an http... is the link.
export type ParsedProduct = {
  name: string
  vendor?: string
  sku?: string
  unitCost?: number
  url?: string
  raw: string
  problem?: string
}

const HEADER_WORDS = /^(item|product|name|description|desc)\b/i

export function parseProductPaste(text: string): ParsedProduct[] {
  const out: ParsedProduct[] = []
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    // Split on tab first (a real spreadsheet paste), then pipe, then comma — but only outside of
    // an http(s) URL, or "https://x.com/a,b" would tear in half.
    const parts = (raw.indexOf('\t') >= 0 ? raw.split('\t') : raw.indexOf('|') >= 0 ? raw.split('|') : splitCsv(raw))
      .map(s => s.trim()).filter(s => s !== '')
    if (!parts.length) continue
    if (i === 0 && HEADER_WORDS.test(parts[0]) && parts.length > 1) continue

    let url: string | undefined
    let unitCost: number | undefined
    const rest: string[] = []
    for (const p of parts) {
      if (!url && /^https?:\/\//i.test(p)) { url = p.slice(0, 500); continue }
      const money = /^\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/.exec(p.replace(/\s/g, ''))
      if (unitCost == null && money) { unitCost = Number(money[1].replace(/,/g, '')); continue }
      rest.push(p)
    }
    const name = (rest.shift() || '').slice(0, 120)
    if (!name) { out.push({ name: '', raw, problem: 'no product name on this line' }); continue }
    // Of what is left, a token that looks like a part number is the SKU; the other is the vendor.
    let sku: string | undefined
    let vendor: string | undefined
    for (const r of rest) {
      if (!sku && /\d/.test(r) && /^[A-Za-z0-9][A-Za-z0-9._\/-]{2,}$/.test(r) && !/\s/.test(r)) { sku = r.slice(0, 64); continue }
      if (!vendor) vendor = r.slice(0, 64)
    }
    out.push({ name, vendor, sku, unitCost, url, raw })
  }
  return out
}

/** Comma split that leaves commas inside a URL or inside quotes alone. */
function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { quoted = !quoted; continue }
    if (ch === ',' && !quoted) {
      // a comma directly inside http://... is part of the URL
      if (/https?:\/\/\S*$/.test(cur)) { cur += ch; continue }
      out.push(cur); cur = ''; continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

// ── LINE STAGES ─────────────────────────────────────────────────────────────────────────────────
// Per LINE, not per order, because "the order is placed" is never true of all forty items at once.
export const LINE_STAGES = ['draft', 'sent', 'approved', 'declined', 'ordered', 'delivered', 'installed'] as const
export type LineStage = typeof LINE_STAGES[number]

export const STAGE_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'With owner', approved: 'Approved', declined: 'Owner said no',
  ordered: 'Ordered', delivered: 'Delivered', installed: 'Installed',
}
// The forward path. Declined is a dead end on purpose — un-declining is an owner decision, not ours.
export const NEXT_STAGE: Record<string, LineStage | null> = {
  draft: 'sent', sent: 'approved', approved: 'ordered', ordered: 'delivered',
  delivered: 'installed', installed: null, declined: null,
}
export const ORDER_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'With owner', approved: 'Approved', changes: 'Changes requested', closed: 'Closed',
}

// ── WHERE WE BUY IT (Jon, 2026-08-13: "not sure yet where we will purchase from but could be
// Amazon, a partner with HostGPO, Wayfair, City Furniture, etc.") ───────────────────────────────
//
// A SUGGESTION LIST, NOT A CLOSED ONE. These are the places Jon named plus the obvious neighbours;
// the vendor field stays free text so a one-off local supplier is never a blocker. The value of the
// list is CONSISTENT SPELLING — "Wayfair", "wayfair" and "Wayfair Pro" are one vendor to a person
// and three to a group-by, and the buy list is only useful if it groups.
export type FfeVendor = { name: string; note?: string; gpo?: boolean }

export const FFE_VENDORS: FfeVendor[] = [
  { name: 'HostGPO', gpo: true, note: 'Group purchasing — member rates across partner brands' },
  { name: 'Amazon Business', note: 'Fast, good for small items and replacements' },
  { name: 'Wayfair Professional', note: 'Trade account pricing' },
  { name: 'City Furniture', note: 'Local delivery and white glove in South Florida' },
  { name: 'CB2 / Crate & Barrel Trade' },
  { name: 'West Elm Trade' },
  { name: 'Article' },
  { name: 'Home Depot Pro' },
  { name: 'Local supplier' },
]

/** Money per piece from whichever source is preferred, or the cheapest if nobody has chosen. */
export function bestSource<T extends { unit_cost: number | null; preferred?: boolean }>(sources: T[]): T | null {
  const list = (sources || []).filter(Boolean)
  if (!list.length) return null
  const pick = list.find(s => s.preferred)
  if (pick) return pick
  const priced = list.filter(s => s.unit_cost != null)
    .sort((a, b) => Number(a.unit_cost) - Number(b.unit_cost))
  return priced[0] || list[0]
}

// ── FIXES ───────────────────────────────────────────────────────────────────────────────────────
// Jon, 2026-08-12: "This would not need to be shared with owner unless it's 350 or more to fix."
// ONE number, defined once. Every screen that decides whether an owner sees a fix reads it from
// here, so raising the bar to $500 next year is a single edit rather than a hunt.
export const FIX_OWNER_THRESHOLD = 350

/** Does this fix need the owner's sign-off, or can the team just get on with it? */
export const needsOwner = (estCost: number | null | undefined): boolean =>
  estCost != null && Number.isFinite(Number(estCost)) && Number(estCost) >= FIX_OWNER_THRESHOLD

export const FIX_STATUS_LABEL: Record<string, string> = {
  open: 'To do', doing: 'In progress', done: 'Done', dropped: 'Not doing',
}

export const money = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? '—'
    : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

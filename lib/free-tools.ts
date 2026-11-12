// FREE TOOLS (Jon, 2026-11-12: "a few slides, like the linen calculator, a calculator, also an inventory
// calculator, as options we add to the magazine and shareable links; email gated before it allows them
// to download the quote. This is more of a free offering").
//
// Three calculators an owner or an agent can run without an account:
//   income    — what a home of this size could earn as a short-term rental, from Stay's own
//               Projections library (never an invented number: no data for a size → a custom
//               projection is offered instead)
//   inventory — the amenities and essentials a unit of this shape needs, from the onboarding
//               inventory standard (must-have / recommended / nice to have). Furniture is never
//               required and consumables are not on an owner's list (Jon's catalog rules), and linen
//               has its own tool, so all three are left out.
//   linen     — the pieces at par for these beds and baths, from the linen standard. Quantities only
//               (Jon, 2026-11-12: "linen is just quantity"): Stay selects and supplies linen for the
//               homes it manages, so no prices, tiers, vendors or SKUs.
//
// The same inputs give a SUMMARY to anyone (the headline numbers) and the FULL QUOTE only after an
// email is left (app/api/tools). Types are shared with the page; the arithmetic runs on the server so
// the full list never ships to a browser that has not unlocked it.

export type ToolKey = 'income' | 'inventory' | 'linen'
export const TOOL_KEYS: ToolKey[] = ['income', 'inventory', 'linen']
export const isToolKey = (v: any): v is ToolKey => TOOL_KEYS.includes(v)

export const TOOL_META: Record<ToolKey, { title: string; short: string; kicker: string; dek: string; unlock: string }> = {
  income: {
    title: 'What could your home *earn?*', short: 'Rental income calculator', kicker: 'Free tool · Rental income',
    dek: 'Bedrooms and neighborhood in, a yearly and monthly range out, from projections Stay has built for homes like yours.',
    unlock: 'the month-by-month projection, nightly rate and occupancy, and what you would keep after fees',
  },
  inventory: {
    title: 'Everything a rental *needs.*', short: 'Inventory calculator', kicker: 'Free tool · Inventory',
    dek: 'Describe the home and get the full list of amenities and essentials a guest expects, counted for its size.',
    unlock: 'the full checklist, room by room, with quantities',
  },
  linen: {
    title: 'Linen, *counted to par.*', short: 'Linen calculator', kicker: 'Free tool · Linen',
    dek: 'Beds, baths and guests in: the sheets, towels and pillows a turnover needs, with three sets in rotation.',
    unlock: 'every piece, by bed size and by room',
  },
}

export type IncomeInput = { area?: string; bedrooms: number; bathrooms?: number }
export type InventoryInput = { bedrooms: number; bathrooms: number; guests: number; kitchen: 'full' | 'kitchenette' | 'none'; balcony: boolean; washer: boolean; sleeper: boolean }
export type LinenInput = { beds: Record<string, number>; bathrooms: number; guests: number; kitchen: boolean; sleeper: boolean }

export type IncomeSummary = { found: boolean; area: string; bedrooms: number; lo: number; hi: number; monthLo: number; monthHi: number; basis: number }
export type IncomeFull = IncomeSummary & { nightlyLo: number; nightlyHi: number; occLo: number; occHi: number; months: { lo: number; hi: number }[]; netLo: number; netHi: number; mgmtPct: number; channelPct: number; sources: string[] }

export type InvRow = { name: string; qty: number; size?: string; group: string; tier: 'must' | 'recommended' | 'suggested' }
export type InventorySummary = { items: number; pieces: number; must: number; recommended: number; suggested: number; groups: { group: string; items: number }[] }
export type InventoryFull = InventorySummary & { rows: InvRow[]; describe: string }

export type LinenSummaryOut = { pieces: number; par: number; groups: { group: string; pieces: number }[] }
export type LinenFull = LinenSummaryOut & { rows: { name: string; group: string; size?: string; qty: number }[]; parText: string }

export type ToolInput = IncomeInput | InventoryInput | LinenInput
export type ToolSummary = IncomeSummary | InventorySummary | LinenSummaryOut
export type ToolFull = IncomeFull | InventoryFull | LinenFull

export const BED_SIZES_PUBLIC = ['King', 'Queen', 'Full', 'Twin']
export const INCOME_AREAS = ['Brickell', 'Downtown Miami', 'Wynwood', 'Edgewater', 'Miami Beach', 'Coconut Grove', 'Fort Lauderdale', 'Hollywood', 'Pompano Beach', 'Other South Florida']

const clampN = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x * 2) / 2)) : d }

/** Untrusted input, cleaned to the shape each tool expects. */
export function cleanInput(tool: ToolKey, raw: any): ToolInput {
  const r = raw && typeof raw === 'object' ? raw : {}
  if (tool === 'income') return { area: String(r.area || '').slice(0, 60), bedrooms: clampN(r.bedrooms, 0, 6, 1), bathrooms: clampN(r.bathrooms, 1, 6, 1) }
  if (tool === 'inventory') return {
    bedrooms: clampN(r.bedrooms, 0, 6, 1), bathrooms: clampN(r.bathrooms, 1, 6, 1), guests: clampN(r.guests, 1, 16, 4),
    kitchen: r.kitchen === 'kitchenette' || r.kitchen === 'none' ? r.kitchen : 'full', balcony: !!r.balcony, washer: r.washer !== false, sleeper: !!r.sleeper,
  }
  const beds: Record<string, number> = {}
  for (const s of BED_SIZES_PUBLIC) { const n = clampN(r.beds && r.beds[s], 0, 8, 0); if (n) beds[s] = Math.round(n) }
  if (!Object.keys(beds).length) beds.Queen = 1
  return { beds, bathrooms: clampN(r.bathrooms, 1, 6, 1), guests: clampN(r.guests, 1, 16, 4), kitchen: r.kitchen !== false, sleeper: !!r.sleeper }
}

export const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

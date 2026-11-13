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
//               (Jon, 2026-11-12: "linen is just quantity"): no prices, tiers, vendors or SKUs.
//
// The same inputs give a SUMMARY to anyone (the headline numbers) and the FULL QUOTE only after an
// email is left (app/api/tools).
//
// AN OFFERING, NOT A PITCH (Jon, 2026-11-12: "this tool is for owners, even if they don't want to use
// us"): every result stands on its own for an owner who self-manages or uses someone else. The words are
// neutral, the net can be worked out self-managed, and Stay appears only as the source and a contact. Types are shared with the page; the arithmetic runs on the server so
// the full list never ships to a browser that has not unlocked it.

// ONE INVENTORY TOOL WITH THE LINEN IN IT (Jon, 2026-11-12: "everything a rental needs should ask
// bedrooms, beds… appliances… also this should have the linen par built in… let's add it into one").
// 'linen' survives only as an old link, read as the inventory tool.
export type ToolKey = 'income' | 'inventory'
export const TOOL_KEYS: ToolKey[] = ['income', 'inventory']
export const isToolKey = (v: any): v is ToolKey => TOOL_KEYS.includes(v)
export const toolKeyOf = (v: any): ToolKey | null => (v === 'linen' ? 'inventory' : isToolKey(v) ? v : null)

export const TOOL_META: Record<ToolKey, { title: string; short: string; kicker: string; dek: string; unlock: string }> = {
  income: {
    title: 'What could your home *earn?*', short: 'Projections calculator', kicker: 'Free tool · Rental projection',
    dek: 'Bedrooms and neighborhood in, a yearly and monthly range out, from short-term rental figures for homes like yours across South Florida.',
    unlock: 'the month-by-month pattern, nightly rate and occupancy, and what you would keep after fees',
  },
  inventory: {
    title: 'Everything a rental *needs.*', short: 'Rental supply calculator', kicker: 'Free tool · Supplies and linen',
    dek: 'Bedrooms, beds, baths and the kitchen in: every item a guest expects, counted for the home, and the linen at par.',
    unlock: 'the full list set by set, with quantities, and every linen piece by bed size',
  },
}

// THE PROJECTIONS CALCULATOR (Jon, 2026-11-12): the building (from the Projections library or our own
// buildings, which fills the address), the address, and the home itself; adjustments in lib/projection-calc.
export type IncomeInput = { building?: string; libId?: string; address?: string; area?: string; lat?: number; lng?: number
  bedrooms: number; bathrooms?: number; sqft: number; kitchen: 'full' | 'kitchenette' | 'none'; balcony: boolean
  view: 'none' | 'city' | 'water' | 'ocean' | 'beachfront'; amenities: string[]; managed: boolean }
export const APPLIANCE_KEYS = ['stove', 'oven', 'microwave', 'fridge', 'dishwasher'] as const
export type ApplianceKey = typeof APPLIANCE_KEYS[number]
export const APPLIANCE_LABEL: Record<ApplianceKey, string> = { stove: 'Stove / cooktop', oven: 'Oven', microwave: 'Microwave', fridge: 'Refrigerator', dishwasher: 'Dishwasher' }
export type InventoryInput = { bedrooms: number; bathrooms: number; guests: number; beds: Record<string, number>; sleeper: boolean; kitchen: boolean; appliances: Record<ApplianceKey, boolean> }
export type LinenInput = { beds: Record<string, number>; bathrooms: number; guests: number; kitchen: boolean; sleeper: boolean }

// Before the email there are no numbers at all (Jon: "should not just give it to them"): only whether a
// projection can be built and what it will rest on.
export type IncomeSummary = { found: boolean; area: string; bedrooms: number; basis: number; basisLabel: string; lo?: number; hi?: number; monthLo?: number; monthHi?: number }
export type IncomeFull = IncomeSummary & { lo: number; hi: number; monthLo: number; monthHi: number; nightlyLo: number; nightlyHi: number; occLo: number; occHi: number; months: { lo: number; hi: number }[]; netLo: number; netHi: number; mgmtPct: number; channelPct: number; sources: string[]
  baseLo: number; baseHi: number; adjustments: { label: string; pct: number; occ?: number; note?: string }[]; adjTotal: number; adjAdr?: number; adjOcc?: number
  comps: { name: string; market: string; gross: string; nightly: string; occ: string }[]
  places: { name: string; kind: string; mi: number }[]; beachMi: number | null; address: string; note: string }

export type InvRow = { name: string; qty: number; size?: string; group: string; tier: 'must' | 'recommended' | 'suggested' }
export type InventorySummary = { items: number; pieces: number; must: number; recommended: number; suggested: number; groups: { group: string; items: number }[]; linenPieces: number; par: number }
export type InventoryFull = InventorySummary & { rows: InvRow[]; describe: string; linen: { name: string; group: string; size?: string; qty: number }[]; parText: string }

export type LinenSummaryOut = { pieces: number; par: number; groups: { group: string; pieces: number }[] }
export type LinenFull = LinenSummaryOut & { rows: { name: string; group: string; size?: string; qty: number }[]; parText: string }

export type ToolInput = IncomeInput | InventoryInput
export type ToolSummary = IncomeSummary | InventorySummary
export type ToolFull = IncomeFull | InventoryFull

export const BED_SIZES_PUBLIC = ['King', 'Queen', 'Full', 'Twin']
export const INCOME_AREAS = ['Brickell', 'Downtown Miami', 'Wynwood', 'Edgewater', 'Miami Beach', 'Coconut Grove', 'Fort Lauderdale', 'Hollywood', 'Pompano Beach', 'Other South Florida']

const clampN = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x * 2) / 2)) : d }

/** Untrusted input, cleaned to the shape each tool expects. */
export function cleanInput(tool: ToolKey, raw: any): ToolInput {
  const r = raw && typeof raw === 'object' ? raw : {}
  if (tool === 'income') {
    const str = (v: any, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
    const lat = Number(r.lat), lng = Number(r.lng)
    return {
      building: str(r.building, 80), libId: str(r.libId, 40), address: str(r.address, 160), area: str(r.area, 60),
      ...(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 1 ? { lat, lng } : {}),
      bedrooms: clampN(r.bedrooms, 0, 6, 1), bathrooms: clampN(r.bathrooms, 1, 6, 1), sqft: Math.max(0, Math.min(10000, Math.round(Number(r.sqft) || 0))),
      kitchen: r.kitchen === 'kitchenette' || r.kitchen === 'none' ? r.kitchen : 'full', balcony: !!r.balcony,
      view: ['city', 'water', 'ocean', 'beachfront'].includes(r.view) ? r.view : 'none',
      amenities: (Array.isArray(r.amenities) ? r.amenities : []).map((x: any) => str(x, 40)).filter(Boolean).slice(0, 30),
      managed: r.managed === true,
    }
  }
  const beds: Record<string, number> = {}
  for (const x of BED_SIZES_PUBLIC) { const n = clampN(r.beds && r.beds[x], 0, 8, 0); if (n) beds[x] = Math.round(n) }
  if (!Object.keys(beds).length) beds.Queen = 1
  const kitchen = r.kitchen !== false && r.kitchen !== 'none'
  const ap: any = r.appliances && typeof r.appliances === 'object' ? r.appliances : {}
  const appliances = Object.fromEntries(APPLIANCE_KEYS.map(k => [k, kitchen && (ap[k] == null ? true : !!ap[k])])) as Record<ApplianceKey, boolean>
  return { bedrooms: clampN(r.bedrooms, 0, 6, 1), bathrooms: clampN(r.bathrooms, 1, 6, 1), guests: clampN(r.guests, 1, 16, 4), beds, sleeper: !!r.sleeper, kitchen, appliances }
}

// THE PARTNER NOTE (Jon, 2026-11-12: "have a notes: if we partner together we can put this list together
// with actual items etc. and get this set up"). On the page and in the PDF.
export const PARTNER_NOTE = 'If we partner together, Stay puts this list together with the actual items, sourced and delivered, and gets your home set up and guest-ready.'

export const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

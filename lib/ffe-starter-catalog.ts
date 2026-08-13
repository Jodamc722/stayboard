// A CATALOG TO START FROM (Jon, 2026-08-13: "create one with links for all Amazon").
//
// An empty catalog is the reason catalogs stay empty. The first person to open this screen is asked
// to invent a hundred products before they get any value out of it, so they don't, and the order
// builder keeps falling back to free text forever. This file is the answer to that: one button,
// and the catalog arrives already holding the things a short-term rental unit actually needs, at
// three price points, with codes.
//
// ── ABOUT THE LINKS ─────────────────────────────────────────────────────────────────────────────
// EVERY LINK HERE IS AN AMAZON SEARCH, NOT A PRODUCT PAGE. This is deliberate and it is the single
// most important thing to understand about this file. I cannot produce real ASINs — an invented
// product URL is a dead link, and a dead link in a buying catalog is worse than no link at all,
// because it costs the buyer a click, then a search anyway, and then their trust in every other
// link on the page. A search URL always resolves, always lands on the right query, and takes the
// buyer to the same place they were going to end up regardless.
//
// The moment somebody picks the real item, they paste the real URL over the search and the product
// is pinned for good. The UI marks which is which, so "still a search" is visible rather than
// something you discover at the checkout.
//
// ── ABOUT THE PRICES ────────────────────────────────────────────────────────────────────────────
// The `est` numbers are PLANNING ESTIMATES — what this class of item typically runs, used to make a
// budget conversation possible before anybody has quoted anything. They are not quotes and they are
// not live. A real price enters the system when a source is added to the product, and from then on
// the source is what an owner's quote prices from. Treat the estimate as a starting point that gets
// overwritten, and never as a number to put in front of an owner on its own.
//
// ── ABOUT THE TIERS ─────────────────────────────────────────────────────────────────────────────
// The same role at three price points, so "what would the cheaper one cost" is a filter rather than
// a week of re-quoting. Not everything is tiered: nobody needs three grades of trash bag, and
// pretending otherwise triples the list for no decision. Where one tier is listed, that item is a
// commodity and the tier is Standard.
import { FfeTier } from './ffe-catalog'

export type StarterProduct = {
  role: string          // the thing it IS, shared across its tiers — "Nightstand"
  kind: string
  category: string
  tier: string
  name: string
  search: string        // the Amazon query behind the link
  spec?: string         // size / dimensions — the detail that decides whether it fits
  est?: number
  room?: string
  itemKeys?: string[]
  note?: string
}

type TierEntry = [name: string, est: number, spec?: string]
type Common = { spec?: string; room?: string; itemKeys?: string[]; note?: string; search?: string }

/** One role at three price points. */
function tiered(kind: string, category: string, role: string, c: Common, t1: TierEntry, t2: TierEntry, t3: TierEntry): StarterProduct[] {
  return [['tier1', t1], ['tier2', t2], ['tier3', t3]].map(([tier, e]: any) => ({
    role, kind, category, tier: tier as string,
    name: e[0],
    search: c.search ? c.search : e[0],
    spec: e[2] || c.spec,
    est: e[1],
    room: c.room, itemKeys: c.itemKeys, note: c.note,
  }))
}

/** A commodity — one entry, Standard tier, no decision to make. */
function one(kind: string, category: string, role: string, name: string, est: number, c: Common = {}): StarterProduct[] {
  return [{
    role, kind, category, tier: 'tier2', name, search: c.search || name,
    spec: c.spec, est, room: c.room, itemKeys: c.itemKeys, note: c.note,
  }]
}

// ── FURNITURE ───────────────────────────────────────────────────────────────────────────────────
// Sizes are on every line on purpose. Jon, 2026-08-13: "for carpets, how big etc, TV size etc, TV
// stand / mount etc." A rug ordered without a size is a rug ordered twice.
const FURNITURE: StarterProduct[] = [
  ...tiered('furniture', 'sofa', 'Sofa', { room: 'living', itemKeys: ['sofa'] },
    ['Sofa — 3-seat, performance fabric, 78"W', 450, '78"W x 34"D x 33"H'],
    ['Sofa — 3-seat, stain-resistant weave, wood legs, 84"W', 850, '84"W x 36"D x 34"H'],
    ['Sofa — 3-seat, down-blend cushions, kiln-dried frame, 88"W', 1600, '88"W x 38"D x 34"H']),

  ...tiered('furniture', 'sofa', 'Sleeper sofa', { room: 'living', itemKeys: ['sofa_sleeper'], note: 'Check the pull-out clears the coffee table before ordering.' },
    ['Sleeper sofa — twin pull-out, 72"W', 550, '72"W · twin mattress'],
    ['Sleeper sofa — queen memory-foam pull-out, 84"W', 1100, '84"W · queen 60x80'],
    ['Sleeper sofa — queen air-over-coil pull-out, 88"W', 2000, '88"W · queen 60x80']),

  ...tiered('furniture', 'chair', 'Accent chair', { room: 'living', itemKeys: ['accent_chairs'] },
    ['Accent chair — upholstered, 28"W', 250, '28"W x 30"D x 32"H'],
    ['Accent chair — swivel, performance fabric, 30"W', 450, '30"W x 32"D x 33"H'],
    ['Accent chair — lounge, leather, 32"W', 850, '32"W x 34"D x 33"H']),

  ...tiered('furniture', 'chair', 'Dining chairs', { room: 'dining', itemKeys: ['dining_chairs'], note: 'Priced per pair. Order to match the table — 4 for a 48", 6 for a 72".' },
    ['Dining chairs — upholstered, set of 2', 140, 'Set of 2 · 18"W seat, 18" seat height'],
    ['Dining chairs — wood and woven, set of 2', 260, 'Set of 2 · 19"W seat, 18" seat height'],
    ['Dining chairs — solid wood, leather seat, set of 2', 500, 'Set of 2 · 20"W seat, 19" seat height']),

  ...tiered('furniture', 'chair', 'Bar stools', { room: 'dining', itemKeys: ['bar_stools'], note: 'MEASURE FIRST: 26" seat for a 36" counter, 30" seat for a 42" bar.' },
    ['Bar stools — metal, set of 2', 130, 'Set of 2 · specify 26" counter or 30" bar height'],
    ['Bar stools — upholstered swivel with back, set of 2', 240, 'Set of 2 · specify 26" counter or 30" bar height'],
    ['Bar stools — solid wood, leather seat, set of 2', 460, 'Set of 2 · specify 26" counter or 30" bar height']),

  ...tiered('furniture', 'chair', 'Office chair', { room: 'office', itemKeys: ['office_chair'] },
    ['Office chair — mesh task chair', 120, 'Adjustable 17–21" seat height'],
    ['Office chair — ergonomic, lumbar support', 280, 'Adjustable, tilt lock, adjustable arms'],
    ['Office chair — high-back ergonomic, headrest', 650, 'Fully adjustable, 12-year class frame']),

  ...tiered('furniture', 'table', 'Coffee table', { room: 'living', itemKeys: ['coffee_table'] },
    ['Coffee table — 44" rectangular', 130, '44"W x 22"D x 18"H'],
    ['Coffee table — 48" with lower shelf', 300, '48"W x 24"D x 18"H'],
    ['Coffee table — 52" solid wood or stone top', 650, '52"W x 28"D x 17"H']),

  ...tiered('furniture', 'table', 'Side table', { room: 'living', itemKeys: ['side_tables'] },
    ['Side table — 20" round', 70, '20" dia x 22"H'],
    ['Side table — 22" with shelf, metal and wood', 150, '22"W x 22"D x 24"H'],
    ['Side table — 24" marble top', 320, '24" dia x 24"H']),

  ...tiered('furniture', 'table', 'Dining table', { room: 'dining', itemKeys: ['dining_table'], note: 'Seats 4 at 48", 6 at 72". Allow 24" of table edge per person.' },
    ['Dining table — 48" round, seats 4', 220, '48" dia x 30"H'],
    ['Dining table — 60" rectangular, seats 6', 520, '60"W x 36"D x 30"H'],
    ['Dining table — 72" solid wood, seats 6–8', 1200, '72"W x 38"D x 30"H']),

  ...tiered('furniture', 'table', 'Console table', { room: 'entry', itemKeys: ['console'] },
    ['Console table — 42" narrow entry', 110, '42"W x 12"D x 30"H'],
    ['Console table — 48" with drawers', 260, '48"W x 14"D x 30"H'],
    ['Console table — 55" solid wood', 580, '55"W x 16"D x 32"H']),

  ...tiered('furniture', 'table', 'Desk', { room: 'office', itemKeys: ['desk'] },
    ['Desk — 40" writing desk', 130, '40"W x 20"D x 30"H'],
    ['Desk — 47" with drawer and cable pass', 300, '47"W x 24"D x 30"H'],
    ['Desk — 55" solid wood or sit-stand', 650, '55"W x 28"D · adjustable 28–48"H']),

  ...tiered('furniture', 'bed', 'Bed frame — queen', { room: 'master', itemKeys: ['bed_frame'] },
    ['Bed frame — queen, upholstered platform', 180, 'Fits 60x80 · 14" total height'],
    ['Bed frame — queen, upholstered with headboard, no box spring', 420, 'Fits 60x80 · 48" headboard'],
    ['Bed frame — queen, solid wood or channel-tufted', 950, 'Fits 60x80 · 56" headboard']),

  ...tiered('furniture', 'bed', 'Bed frame — king', { room: 'master', itemKeys: ['bed_frame'] },
    ['Bed frame — king, upholstered platform', 230, 'Fits 76x80 · 14" total height'],
    ['Bed frame — king, upholstered with headboard, no box spring', 520, 'Fits 76x80 · 48" headboard'],
    ['Bed frame — king, solid wood or channel-tufted', 1150, 'Fits 76x80 · 56" headboard']),

  ...tiered('furniture', 'bed', 'Mattress — queen', { room: 'master', itemKeys: ['mattress'], note: 'Always order a protector with a mattress.' },
    ['Mattress — queen, 10" memory foam', 300, '60x80 x 10"'],
    ['Mattress — queen, 12" hybrid coil and foam', 650, '60x80 x 12"'],
    ['Mattress — queen, 14" premium hybrid', 1300, '60x80 x 14"']),

  ...tiered('furniture', 'bed', 'Mattress — king', { room: 'master', itemKeys: ['mattress'], note: 'Always order a protector with a mattress.' },
    ['Mattress — king, 10" memory foam', 420, '76x80 x 10"'],
    ['Mattress — king, 12" hybrid coil and foam', 850, '76x80 x 12"'],
    ['Mattress — king, 14" premium hybrid', 1650, '76x80 x 14"']),

  ...tiered('furniture', 'case', 'Nightstand', { room: 'master', itemKeys: ['nightstands'], note: 'ALWAYS A PAIR — the walk defaults these to ×2. In a 2-bed, order 1 and order 2 are separate lines so each bedroom can differ.' },
    ['Nightstand — 2-drawer, 18"W', 90, '18"W x 16"D x 24"H'],
    ['Nightstand — 2-drawer with USB and outlet, 22"W', 200, '22"W x 16"D x 25"H'],
    ['Nightstand — solid wood, soft-close, 24"W', 430, '24"W x 18"D x 26"H']),

  ...tiered('furniture', 'case', 'Dresser', { room: 'master', itemKeys: ['dresser'] },
    ['Dresser — 6-drawer, 52"W', 250, '52"W x 16"D x 31"H'],
    ['Dresser — 6-drawer, soft-close, 58"W', 600, '58"W x 18"D x 32"H'],
    ['Dresser — 8-drawer solid wood, 64"W', 1300, '64"W x 19"D x 34"H']),

  ...tiered('furniture', 'case', 'TV stand', { room: 'living', itemKeys: ['tv_stand'], note: 'Stand should be at least as wide as the TV. 58" stand carries a 65" TV.' },
    ['TV stand — 48", open shelf', 130, '48"W x 16"D x 20"H · fits up to 55" TV'],
    ['TV stand — 58" with doors and cable management', 300, '58"W x 16"D x 22"H · fits up to 65" TV'],
    ['TV stand — 70" solid wood media console', 650, '70"W x 18"D x 24"H · fits up to 75" TV']),

  ...tiered('furniture', 'case', 'Bedroom TV stand', { room: 'master', itemKeys: ['bedroom_tv_stand'] },
    ['Bedroom TV stand — 36"', 90, '36"W x 15"D x 20"H · fits up to 43" TV'],
    ['Bedroom TV stand — 44" with storage', 190, '44"W x 16"D x 22"H · fits up to 50" TV'],
    ['Bedroom TV stand — 55" solid wood', 420, '55"W x 16"D x 24"H · fits up to 60" TV']),

  ...one('furniture', 'case', 'Luggage rack', 'Luggage rack — folding, wood and canvas', 45,
    { room: 'master', spec: '24"W x 18"D open', note: 'Small thing guests notice. Saves the dresser top and the bed skirt.' }),

  ...tiered('furniture', 'lamp', 'Table lamp', { room: 'living', itemKeys: ['lamps'] },
    ['Table lamp — 24"H with shade', 45, '24"H · E26 bulb, bulb not included'],
    ['Table lamp — 26"H ceramic or brass with shade', 95, '26"H x 14" shade · E26'],
    ['Table lamp — 30"H designer base with linen shade', 210, '30"H x 16" shade · E26']),

  ...tiered('furniture', 'lamp', 'Bedside lamp', { room: 'master', itemKeys: ['bedroom_lamps'], note: 'Order in pairs with the nightstands. USB in the base is worth the upgrade in a rental.' },
    ['Bedside lamp — 18"H', 40, '18"H · E26'],
    ['Bedside lamp — 20"H with USB-A and USB-C in the base', 85, '20"H · 2 USB ports'],
    ['Bedside lamp — 22"H with USB and switched outlet', 175, '22"H · 2 USB + 1 outlet']),

  ...tiered('furniture', 'lamp', 'Floor lamp', { room: 'living' },
    ['Floor lamp — 60"H', 55, '60"H · E26'],
    ['Floor lamp — 65"H arc or tripod with shade', 120, '65"H · reach 40" for arc'],
    ['Floor lamp — 70"H brass arc with marble base', 260, '70"H · reach 50"']),

  ...tiered('furniture', 'lamp', 'Ceiling light', { room: 'dining', itemKeys: ['light_fixture', 'entry_light'], note: 'Needs an electrician if there is no existing box. Fix, not a furniture line, if it is only the bulb.' },
    ['Ceiling light — 13" flush mount LED', 60, '13" dia · integrated LED'],
    ['Ceiling light — 16" semi-flush, 3-light', 140, '16" dia x 10"H'],
    ['Ceiling light — 20" chandelier or linear pendant', 320, '20" dia · adjustable drop to 60"']),

  ...tiered('furniture', 'rug', 'Area rug — living', { room: 'living', itemKeys: ['carpet'], note: 'SIZE RULE: the front legs of every seat should sit on the rug. 8x10 for a normal living room, 9x12 if the sofa is over 88".' },
    ['Area rug — 8x10, low pile', 150, "8' x 10' · low pile, machine washable"],
    ['Area rug — 8x10, performance stain-resistant', 380, `8' x 10' · 0.4" pile, stain-resistant`],
    ['Area rug — 9x12, hand-loomed wool blend', 900, `9' x 12' · 0.5" pile`]),

  ...tiered('furniture', 'rug', 'Area rug — bedroom', { room: 'master', itemKeys: ['bedroom_rug'], note: 'SIZE RULE: 8x10 under a queen leaves ~24" of rug on each side. 5x8 only works at the foot of the bed.' },
    ['Area rug — 5x8, low pile', 90, "5' x 8' · at the foot of the bed"],
    ['Area rug — 8x10, soft pile', 220, "8' x 10' · under the bed and nightstands"],
    ['Area rug — 9x12, wool blend', 520, "9' x 12' · under a king with nightstands"]),

  ...one('furniture', 'rug', 'Runner', 'Runner rug — 2.5 x 8, hallway or galley kitchen', 110,
    { spec: "2'6\" x 8' · low pile", room: 'entry' }),

  ...one('furniture', 'rug', 'Rug pad', 'Rug pad — non-slip, cut to size', 60,
    { spec: 'Order one size down from the rug', note: 'A rug without a pad curls, slides and becomes a trip claim.' }),

  ...tiered('furniture', 'art', 'Wall art', { room: 'living', itemKeys: ['wall_art', 'dining_art', 'office_art', 'bedroom_art', 'entry_art'] },
    ['Wall art — framed set of 3, 16x20 each', 90, '3 x 16"x20" framed'],
    ['Wall art — framed set of 2, 24x36 each', 220, '2 x 24"x36" framed'],
    ['Wall art — oversized canvas, 40x60', 500, '40"W x 60"H framed canvas']),

  ...tiered('furniture', 'art', 'Mirror', { room: 'living', itemKeys: ['mirror', 'entry_mirror'] },
    ['Mirror — 24" round', 70, '24" dia'],
    ['Mirror — 30" round, metal frame', 150, '30" dia'],
    ['Mirror — 36" round or arched, brass frame', 330, '36" dia']),

  ...one('furniture', 'art', 'Full-length mirror', 'Full-length mirror — 65 x 22, leaning or wall-mount', 170,
    { spec: '65"H x 22"W', room: 'master', note: 'Guests look for one. Anchor it to the wall even when it leans.' }),

  ...tiered('furniture', 'window', 'Blackout curtains', { room: 'master', itemKeys: ['curtains', 'bedroom_curtains'], note: 'MEASURE THE DROP: 84" for an 8ft ceiling, 96" for 9ft, 108" for 10ft. Rod goes 4–6" above the frame.' },
    ['Blackout curtains — 52x84, pair', 35, '2 panels, 52"W x 84"L'],
    ['Blackout curtains — 52x96 thermal, pair', 80, '2 panels, 52"W x 96"L'],
    ['Blackout curtains — 52x108 lined, pair', 180, '2 panels, 52"W x 108"L']),

  ...one('furniture', 'window', 'Curtain rod', 'Curtain rod — adjustable 48 to 84 with brackets', 45,
    { spec: 'Adjustable 48–84" · 1" dia', note: 'Order with the curtains or the curtains sit in a box for a month.' }),

  ...tiered('furniture', 'tv', 'TV — living room', { room: 'living', itemKeys: ['tv'], note: 'SIZE RULE: 55" for a normal living room, 65" if the sofa sits more than 9ft back.' },
    ['TV — 50" 4K smart, living room', 280, '50" · 4K · ~44"W'],
    ['TV — 55" 4K smart, living room', 420, '55" · 4K · ~48.5"W'],
    ['TV — 65" 4K QLED', 800, '65" · 4K QLED · ~57"W']),

  ...tiered('furniture', 'tv', 'TV — bedroom', { room: 'master', itemKeys: ['bedroom_tv'] },
    ['TV — 32" HD smart, bedroom', 130, '32" · ~28.5"W'],
    ['TV — 43" 4K smart, bedroom', 250, '43" · 4K · ~38"W'],
    ['TV — 50" 4K smart, bedroom', 400, '50" · 4K · ~44"W']),

  ...tiered('furniture', 'tv', 'TV wall mount', { note: 'CHECK VESA on the TV before ordering. Full-motion for a corner or a bedroom, fixed for straight-on viewing.' },
    ['TV mount — fixed low-profile, 37–80"', 30, 'Fits 37–80" · VESA up to 600x400 · 1.4" from wall'],
    ['TV mount — full-motion swivel, 42–75"', 70, 'Fits 42–75" · VESA up to 600x400 · extends 16"'],
    ['TV mount — heavy-duty full-motion, 42–90"', 140, 'Fits 42–90" · VESA up to 800x400 · extends 22"']),

  ...one('furniture', 'decor', 'Throw pillows', 'Throw pillows — set of 4 covers with inserts, 18x18', 85,
    { room: 'living', spec: '4 x 18"x18"', note: 'Buy covers and inserts separately — covers wash, inserts do not need replacing.' }),
  ...one('furniture', 'decor', 'Throw blanket', 'Throw blanket — 50x60 knit', 50, { room: 'living', spec: '50" x 60"' }),
  ...one('furniture', 'decor', 'Faux plant', 'Faux plant — 5ft with basket', 95, { room: 'living', spec: '5ft tall including pot' }),
  ...one('furniture', 'decor', 'Decor set', 'Decor set — vase, books and tray for the coffee table', 110, { room: 'living' }),
  ...one('furniture', 'decor', 'Entry basket', 'Entry basket — woven storage with lid', 45, { room: 'entry' }),
]

// ── AMENITIES ───────────────────────────────────────────────────────────────────────────────────
// What makes the unit work for a guest. Tiered only where the guest can tell the difference.
const AMENITIES: StarterProduct[] = [
  ...tiered('amenity', 'misc', 'Coffee maker', { room: 'dining', note: 'Whatever you choose, stock the matching supply — a Keurig with no pods is a bad review.' },
    ['Coffee maker — 12-cup drip', 35, '12-cup · glass carafe'],
    ['Coffee maker — single-serve pod and 12-cup carafe combo', 130, 'Pods + carafe'],
    ['Coffee maker — espresso machine with milk frother', 450, 'Espresso + steam wand']),

  ...tiered('amenity', 'misc', 'Cookware set', { room: 'dining' },
    ['Cookware set — 10-piece nonstick', 60, '10-piece · nonstick'],
    ['Cookware set — 12-piece hard-anodized, oven safe', 140, '12-piece · dishwasher safe'],
    ['Cookware set — 15-piece stainless tri-ply', 320, '15-piece · induction ready']),

  ...tiered('amenity', 'misc', 'Dishware set', { room: 'dining', note: 'Service for 8 in a 2-bed, service for 4 in a studio. Order 2 extra of each — things break.' },
    ['Dishware set — 16-piece, service for 4', 45, '16-piece stoneware'],
    ['Dishware set — 32-piece, service for 8', 95, '32-piece stoneware'],
    ['Dishware set — 32-piece porcelain, service for 8', 200, '32-piece porcelain, chip resistant']),

  ...tiered('amenity', 'misc', 'Vacuum', { note: 'Cordless stick is what actually gets used between guests.' },
    ['Vacuum — upright bagless', 90, 'Corded upright'],
    ['Vacuum — cordless stick, 40 min runtime', 200, 'Cordless · 40 min'],
    ['Vacuum — cordless stick with docking station, 60 min', 420, 'Cordless · 60 min · dock']),

  ...tiered('amenity', 'misc', 'Bluetooth speaker', {},
    ['Bluetooth speaker — portable', 30, 'Portable · USB-C'],
    ['Bluetooth speaker — waterproof portable', 70, 'IPX7 waterproof'],
    ['Bluetooth speaker — premium portable', 150, 'IP67 · 20hr battery']),

  ...one('amenity', 'misc', 'Electric kettle', 'Electric kettle — 1.7L stainless', 45, { room: 'dining', spec: '1.7 litre' }),
  ...one('amenity', 'misc', 'Toaster', 'Toaster — 2-slice wide slot', 40, { room: 'dining' }),
  ...one('amenity', 'misc', 'Blender', 'Blender — countertop, 700W', 60, { room: 'dining' }),
  ...one('amenity', 'misc', 'Air fryer', 'Air fryer — 6 quart digital', 110, { room: 'dining', spec: '6 qt' }),
  ...one('amenity', 'misc', 'Microwave', 'Microwave — 0.9 cu ft countertop', 130, { room: 'dining', spec: '0.9 cu ft', note: 'Only where there is no built-in.' }),
  ...one('amenity', 'misc', 'Knife set', 'Knife set — with block and shears', 70, { room: 'dining' }),
  ...one('amenity', 'misc', 'Flatware set', 'Flatware set — stainless, service for 8', 50, { room: 'dining', spec: '40-piece' }),
  ...one('amenity', 'misc', 'Glassware set', 'Glassware set — 16-piece drinking glasses', 50, { room: 'dining' }),
  ...one('amenity', 'misc', 'Wine glasses', 'Wine glasses — set of 6', 40, { room: 'dining' }),
  ...one('amenity', 'misc', 'Kitchen utensils', 'Kitchen utensil set — with holder, can opener and wine opener', 45, { room: 'dining' }),
  ...one('amenity', 'misc', 'Mixing bowls', 'Mixing bowls and cutting board set', 45, { room: 'dining' }),
  ...one('amenity', 'misc', 'Food storage', 'Food storage containers — set with lids', 30, { room: 'dining' }),
  ...one('amenity', 'misc', 'Dish rack', 'Dish drying rack — with tray', 35, { room: 'dining' }),
  ...one('amenity', 'misc', 'Hair dryer', 'Hair dryer — 1875W with concentrator', 35, { }),
  ...one('amenity', 'misc', 'Iron and board', 'Iron and ironing board — full size', 60, {}),
  ...one('amenity', 'misc', 'Clothes steamer', 'Clothes steamer — handheld', 50, {}),
  ...one('amenity', 'misc', 'Streaming stick', 'Streaming stick — 4K', 50, { note: 'Reset it between guests. Never leave an account signed in.' }),
  ...one('amenity', 'misc', 'Tower fan', 'Tower fan — oscillating with remote', 70, {}),
  ...one('amenity', 'misc', 'Beach chairs', 'Beach chairs — folding, set of 2', 110, { room: 'terrace', spec: 'Set of 2' }),
  ...one('amenity', 'misc', 'Beach umbrella', 'Beach umbrella — 7ft with sand anchor', 70, { room: 'terrace', spec: "7' dia" }),
  ...one('amenity', 'misc', 'Beach cart', 'Beach cart — folding wagon with wide wheels', 90, { room: 'terrace' }),
  ...one('amenity', 'misc', 'Cooler', 'Cooler — 25 quart hard cooler', 60, { spec: '25 qt' }),
  ...one('amenity', 'misc', 'Pack n play', "Pack 'n play — portable crib with sheet", 100, { note: 'Family-friendly listings convert better. Keep the sheet with it.' }),
  ...one('amenity', 'misc', 'High chair', 'High chair — folding', 80, {}),
  ...one('amenity', 'misc', 'Baby gate', 'Baby gate — pressure mounted', 60, {}),
  ...one('amenity', 'misc', 'First aid kit', 'First aid kit — 200-piece', 30, {}),
  ...one('amenity', 'misc', 'Fire extinguisher', 'Fire extinguisher — 2-A:10-B:C with mounting bracket', 40, { note: 'Required. Check the gauge on every walk.' }),
  ...one('amenity', 'misc', 'Smoke and CO detector', 'Smoke and carbon monoxide detector — 10-year sealed battery', 45, { note: 'Required. 10-year sealed battery means it is not a yearly job.' }),
  ...one('amenity', 'misc', 'Digital safe', 'Digital safe — small, bolt-down', 80, {}),
  ...one('amenity', 'misc', 'Hangers', 'Hangers — velvet non-slip, 50 pack', 35, { room: 'master', spec: '50 pack' }),
  ...one('amenity', 'misc', 'Nightlight', 'Nightlight — plug-in with dusk sensor, 6 pack', 20, {}),
]

// ── LINEN & BATH ────────────────────────────────────────────────────────────────────────────────
// Par levels, not units. Three sets per bed is the working number: one on, one in the wash, one
// clean on the shelf. Anything less and a same-day turn cannot happen.
const LINEN: StarterProduct[] = [
  ...tiered('linen', 'misc', 'Sheet set — queen', { room: 'master', note: 'PAR LEVEL 3 per bed: one on, one in the wash, one on the shelf. White only — it bleaches and it matches.' },
    ['Sheet set — queen, white, microfibre', 30, 'Queen 60x80 · 4-piece'],
    ['Sheet set — queen, white, 300TC cotton sateen', 70, 'Queen 60x80 · 4-piece · 300TC'],
    ['Sheet set — queen, white, 400TC long-staple cotton', 150, 'Queen 60x80 · 4-piece · 400TC']),

  ...tiered('linen', 'misc', 'Sheet set — king', { room: 'master', note: 'PAR LEVEL 3 per bed.' },
    ['Sheet set — king, white, microfibre', 40, 'King 76x80 · 4-piece'],
    ['Sheet set — king, white, 300TC cotton sateen', 85, 'King 76x80 · 4-piece · 300TC'],
    ['Sheet set — king, white, 400TC long-staple cotton', 180, 'King 76x80 · 4-piece · 400TC']),

  ...tiered('linen', 'misc', 'Bath towels', { note: 'PAR LEVEL 3 sets per bathroom. White only.' },
    ['Bath towels — white, 6-pack', 30, '6 x 27"x54"'],
    ['Bath towels — white, 600gsm cotton, 6-pack', 65, '6 x 30"x56" · 600gsm'],
    ['Bath towels — white, 700gsm Turkish cotton, 6-pack', 140, '6 x 30"x58" · 700gsm']),

  ...tiered('linen', 'misc', 'Pillows', { room: 'master', note: 'Two per sleeper, plus two decorative. Replace yearly — a flat pillow is a review.' },
    ['Pillows — standard, set of 2', 25, '2 x 20"x26"'],
    ['Pillows — queen, down alternative, set of 2', 55, '2 x 20"x30"'],
    ['Pillows — king, hotel-weight down alternative, set of 2', 120, '2 x 20"x36"']),

  ...tiered('linen', 'misc', 'Duvet insert', { room: 'master' },
    ['Duvet insert — queen, down alternative', 35, 'Queen 88"x88"'],
    ['Duvet insert — king, down alternative, corner loops', 75, 'King 104"x88"'],
    ['Duvet insert — king, all-season down blend', 160, 'King 104"x88"']),

  ...tiered('linen', 'misc', 'Duvet cover', { room: 'master', note: 'White with a zip closure. Corner ties or it bunches in the wash.' },
    ['Duvet cover — queen, white, microfibre', 30, 'Queen 90"x90"'],
    ['Duvet cover — king, white, cotton percale', 65, 'King 106"x90"'],
    ['Duvet cover — king, white, 400TC cotton', 140, 'King 106"x90"']),

  ...one('linen', 'misc', 'Mattress protector — queen', 'Mattress protector — queen, waterproof, fitted', 45, { room: 'master', spec: 'Queen 60x80', note: 'Non-negotiable. Cheaper than a mattress, every time.' }),
  ...one('linen', 'misc', 'Mattress protector — king', 'Mattress protector — king, waterproof, fitted', 55, { room: 'master', spec: 'King 76x80', note: 'Non-negotiable.' }),
  ...one('linen', 'misc', 'Pillow protectors', 'Pillow protectors — waterproof, set of 4', 25, { room: 'master' }),
  ...one('linen', 'misc', 'Blanket', 'Blanket — white waffle coverlet, queen or king', 60, { room: 'master' }),
  ...one('linen', 'misc', 'Hand towels', 'Hand towels — white, set of 6', 30, { }),
  ...one('linen', 'misc', 'Washcloths', 'Washcloths — white, set of 12', 25, { }),
  ...one('linen', 'misc', 'Bath mat', 'Bath mat — white, non-slip backing', 25, { }),
  ...one('linen', 'misc', 'Shower curtain', 'Shower curtain, liner and rings — white', 40, { }),
  ...one('linen', 'misc', 'Pool towels', 'Pool and beach towels — set of 4', 55, { room: 'terrace', note: 'A different colour from the bath towels, so they stop walking into the bathroom.' }),
  ...one('linen', 'misc', 'Kitchen towels', 'Kitchen towels — set of 6', 22, { room: 'dining' }),
  ...one('linen', 'misc', 'Oven mitts', 'Oven mitts and pot holders — set', 20, { room: 'dining' }),
]

// ── SUPPLIES ────────────────────────────────────────────────────────────────────────────────────
// Consumables. Not tiered — nobody needs three grades of trash bag, and pretending otherwise
// triples the list for no decision anyone will ever make.
const SUPPLIES: StarterProduct[] = [
  ...one('supply', 'misc', 'Trash bags', 'Trash bags — 13 gallon, 200 count', 30, { spec: '13 gal · 200ct' }),
  ...one('supply', 'misc', 'Small trash bags', 'Trash bags — 4 gallon for bathrooms, 200 count', 20, { spec: '4 gal · 200ct' }),
  ...one('supply', 'misc', 'Toilet paper', 'Toilet paper — 2-ply, 48 rolls', 50, { spec: '48 rolls' }),
  ...one('supply', 'misc', 'Paper towels', 'Paper towels — 12 rolls', 35, { spec: '12 rolls' }),
  ...one('supply', 'misc', 'Dish soap', 'Dish soap — 3 pack', 16, {}),
  ...one('supply', 'misc', 'Dishwasher pods', 'Dishwasher detergent pods — 85 count', 26, { spec: '85ct' }),
  ...one('supply', 'misc', 'Laundry pods', 'Laundry detergent pods — 120 count', 35, { spec: '120ct' }),
  ...one('supply', 'misc', 'All-purpose cleaner', 'All-purpose cleaner — spray, 3 pack', 20, {}),
  ...one('supply', 'misc', 'Glass cleaner', 'Glass cleaner — 2 pack', 14, {}),
  ...one('supply', 'misc', 'Bathroom cleaner', 'Bathroom and toilet bowl cleaner — 3 pack', 18, {}),
  ...one('supply', 'misc', 'Disinfecting wipes', 'Disinfecting wipes — 6 pack canisters', 28, {}),
  ...one('supply', 'misc', 'Sponges', 'Sponges and scrub pads — 24 pack', 16, {}),
  ...one('supply', 'misc', 'Hand soap', 'Hand soap — refill gallon', 20, {}),
  ...one('supply', 'misc', 'Guest toiletries', 'Shampoo, conditioner and body wash — refillable dispenser set', 80, { note: 'Dispensers over minis: less waste, less restocking, reads as higher end.' }),
  ...one('supply', 'misc', 'Coffee', 'Coffee pods — 100 count variety', 50, { room: 'dining', note: 'Match this to whichever coffee maker the unit actually has.' }),
  ...one('supply', 'misc', 'Coffee filters', 'Coffee filters and ground coffee — starter stock', 25, { room: 'dining' }),
  ...one('supply', 'misc', 'Batteries', 'Batteries — AA and AAA variety pack', 30, {}),
  ...one('supply', 'misc', 'Light bulbs', 'LED bulbs — A19 soft white 2700K, 12 pack', 28, { spec: 'A19 · 2700K · 12pk', note: 'ONE colour temperature across the whole unit. Mixed bulbs are the most visible cheap thing in a photo.' }),
  ...one('supply', 'misc', 'Broom', 'Broom and dustpan set', 25, {}),
  ...one('supply', 'misc', 'Mop', 'Mop and bucket — spin mop', 40, {}),
  ...one('supply', 'misc', 'Toilet brush', 'Toilet brush and plunger set', 25, { }),
  ...one('supply', 'misc', 'Air freshener', 'Air freshener — reed diffuser or automatic spray', 30, {}),
  ...one('supply', 'misc', 'Lint roller', 'Lint rollers — 5 pack', 15, {}),
  ...one('supply', 'misc', 'Laundry basket', 'Laundry basket — collapsible', 25, {}),
]

export const STARTER_CATALOG: StarterProduct[] = [...FURNITURE, ...AMENITIES, ...LINEN, ...SUPPLIES]

/** How many the starter list would add for a given choice of kinds and tiers. */
export function starterCount(kinds: string[], tiers: string[]): number {
  return STARTER_CATALOG.filter(p =>
    (!kinds.length || kinds.indexOf(p.kind) >= 0) && (!tiers.length || tiers.indexOf(p.tier) >= 0)).length
}

/** A one-line summary for the confirm step, e.g. "62 products · Furniture, Amenities · Standard". */
export function starterSummary(kinds: string[], tiers: string[], tierList: FfeTier[]): string {
  const n = starterCount(kinds, tiers)
  const t = tiers.map(k => (tierList.find(x => x.key === k)?.short || k)).join(', ')
  return `${n} product${n === 1 ? '' : 's'}${t ? ' · ' + t : ''}`
}

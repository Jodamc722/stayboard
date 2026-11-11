// THE RENTAL CMA PAGES OF A SALES DECK (Jon, 2026-11-11: "for owner sales deck take a look at this and
// use this as reference… a printable view / magazine and a keynote slide version… This should be the
// same engine that builds our current sales decks, but revamped: one magazine version and the other a
// keynote version, shareable link").
//
// The reference is "Stay Hospitality – The Rider – Rental CMAs and Partner Packet v9". Its building
// pages — the agent partner program, Stay as a second option, the market and comparable set, every
// floor plan at a glance, one rental comparison per floor plan — live here as `content.cma` on the
// sales deck's owner_reports row. So a deck is still one row with one /r/<code> link, one editor, PDF
// and PowerPoint; the keynote slides (components/SalesCmaSlides) and the magazine pages
// (components/SalesMagazine) both read this.
//
// THE MATH (checked against every page of the v9 packet):
//   gross low  = comp low  × scale × (1 − lockout discount) × (1 + uplift low),  rounded to $100
//   gross high = comp high × scale × (1 − lockout discount) × (1 + uplift high), rounded to $100
//   nightly    = gross ÷ (365 × occupancy) ÷ suites       (low with low occupancy, high with high)
//   per month  = gross ÷ 12, rounded to $100
//   each month = gross × that month's share of the Miami seasonal curve (SEASON), peak = the largest
// A plan can override its range when Nick knows better.
//
// Isomorphic.

/** Miami seasonal shape (Jan..Dec), read off the v9 packet's monthly chart. Shares of the year. */
export const SEASON_RAW = [7.1, 7.7, 8.8, 5.9, 4.7, 4.4, 4.8, 2.9, 2.3, 3.7, 4.5, 9.0]
const SEASON_SUM = SEASON_RAW.reduce((a, b) => a + b, 0)
export const SEASON = SEASON_RAW.map(v => v / SEASON_SUM)
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type PacketComp = {
  id: string
  name: string
  market: string
  basis: string
  /** What the table prints for gross per year, e.g. "$46,400 avg, $55,000 high". Blank = lo to hi. */
  grossText?: string
  lo: number; hi: number
  nightlyLo: number; nightlyHi: number
  occLo: number; occHi: number
}

export type PacketPlan = {
  id: string
  name: string
  sf: string
  price: string
  rules: string
  /** Comparables printed on this plan's page. */
  compIds: string[]
  /** The comparable the range is calculated from. */
  baseId: string
  scale: number
  /** Lockout discount for shared turnover, percent (10 = less 10%). */
  less: number
  /** Separate listings in the unit (lockouts); nightly rate is shown per suite. */
  suites: number
  occLo: number; occHi: number
  /** How we got there, before the uplift sentence. */
  how: string
  /** Set by hand instead of calculated. */
  override?: { lo: number; hi: number } | null
  /** The sales team's scale on this plan, percent (+8 = 8% higher). Applied after the math. */
  adjust?: number
  /** This plan's own month shape (12 relative weights). Null = the building's, else Miami's. */
  season?: number[] | null
}

export type SalesCma = {
  building: string
  area: string
  sections: { partner: boolean; second: boolean; market: boolean; glance: boolean; plans: boolean }
  partner: {
    lead: string
    fees: [string, string][]
    feeNote: string
    cards: [string, string][]
    steps: [string, string][]
    here: string[]
  }
  second: {
    lead: string
    choose: string
    qa: [string, string][]
    steps: [string, string][]
    ask: string[]
  }
  market: { lead: string; bullets: [string, string][] }
  comps: PacketComp[]
  uplift: { lo: number; hi: number; why: string }
  plans: PacketPlan[]
  disclaimer: string
  /** Scale on every floor plan at once, percent. */
  adjust?: number
  /** The building's month shape (12 weights) when it differs from Miami's. */
  season?: number[] | null
}
/** Older name, kept so the math reads the same everywhere. */
export type Packet = SalesCma

export type PlanNumbers = {
  lo: number; hi: number
  nightlyLo: number; nightlyHi: number
  monthLo: number; monthHi: number
  peak: number; peakMonth: string
  months: { lo: number; hi: number }[]
  manual: boolean
}

const r100 = (n: number) => Math.round(n / 100) * 100

/** A month shape as shares of the year: 12 positive weights, normalised. Anything else = Miami's. */
export function shapeOf(w?: number[] | null): number[] {
  if (!Array.isArray(w) || w.length !== 12 || w.some(x => !(x >= 0))) return SEASON
  const t = w.reduce((a, b) => a + b, 0)
  return t > 0 ? w.map(x => x / t) : SEASON
}

/** The range before any scale: the math, or the numbers set by hand. */
function baseRange(p: SalesCma, plan: PacketPlan) {
  // baseId 'none': a unit type waiting for its own figures (scanned from a website, added by hand) is
  // never quietly priced off the first comparable.
  const base = plan.baseId === 'none' ? null : (p.comps.find(c => c.id === plan.baseId) || p.comps[0])
  const k = (plan.scale || 1) * (1 - (plan.less || 0) / 100)
  const manual = !!(plan.override && plan.override.lo > 0 && plan.override.hi > 0)
  return {
    manual,
    lo: manual ? plan.override!.lo : (base?.lo || 0) * k * (1 + p.uplift.lo / 100),
    hi: manual ? plan.override!.hi : (base?.hi || 0) * k * (1 + p.uplift.hi / 100),
  }
}

export function planNumbers(p: SalesCma, plan: PacketPlan): PlanNumbers {
  const b = baseRange(p, plan)
  const f = (1 + (p.adjust || 0) / 100) * (1 + (plan.adjust || 0) / 100)
  const manual = b.manual
  const lo = r100(b.lo * f)
  const hi = r100(b.hi * f)
  const suites = Math.max(1, plan.suites || 1)
  const nightly = (g: number, occ: number) => occ > 0 ? Math.round(g / (365 * occ / 100) / suites) : 0
  const shape = shapeOf(plan.season || p.season)
  const months = shape.map(s => ({ lo: Math.round(lo * s), hi: Math.round(hi * s) }))
  // THE CHART ADDS UP TO THE PAGE (Jon, 2026-11-11: "make sure the data and the charts align if we
  // customize them"). Each month is rounded on its own, so the twelve could miss the year by a few
  // dollars; the remainder goes to the largest month, so they always sum to exactly the year printed.
  for (const k of ['lo', 'hi'] as const) {
    const total = k === 'lo' ? lo : hi
    const diff = total - months.reduce((a, m) => a + m[k], 0)
    if (diff) { let big = 0; months.forEach((m, i) => { if (m[k] > months[big][k]) big = i }); months[big][k] += diff }
  }
  let pi = 0
  months.forEach((m, i) => { if (m.hi > months[pi].hi) pi = i })
  return {
    lo, hi,
    nightlyLo: nightly(lo, plan.occLo), nightlyHi: nightly(hi, plan.occHi),
    monthLo: r100(lo / 12), monthHi: r100(hi / 12),
    peak: r100(months[pi].hi), peakMonth: MONTHS[pi],
    months, manual,
  }
}

/**
 * THE MONTH EDIT (Jon, 2026-11-11: "a projection builder where you can scale the projections on the
 * page and adjust the months easily"). Sets one month's HIGH-end figure and returns the plan to save.
 *   keepYear true  → the month takes its share from the other eleven; the year does not move.
 *   keepYear false → the year becomes the sum of the months; the low end follows in proportion.
 * Either way the plan keeps its own shape from then on.
 */
export function setMonth(p: SalesCma, plan: PacketPlan, i: number, value: number, keepYear: boolean): PacketPlan {
  const n = planNumbers(p, plan)
  const v = Math.max(0, Math.round(value))
  const hiMonths = n.months.map(m => m.hi)
  if (keepYear) {
    const rest = hiMonths.reduce((a, b, j) => a + (j === i ? 0 : b), 0)
    const room = Math.max(0, n.hi - v)
    const next = hiMonths.map((m, j) => j === i ? Math.min(v, n.hi) : rest > 0 ? m * room / rest : room / 11)
    return { ...plan, season: next.map(x => Math.round(x)) }
  }
  hiMonths[i] = v
  const year = hiMonths.reduce((a, b) => a + b, 0)
  if (year <= 0) return plan
  const ratio = n.hi > 0 ? year / n.hi : 1
  // The new year IS the number now. The plan's own scale is folded into it (and cleared), and the
  // all-plans scale is divided back out because planNumbers will apply it again.
  const g = 1 + (p.adjust || 0) / 100 || 1
  return { ...plan, season: hiMonths, adjust: 0, override: { lo: Math.round(n.lo * ratio / g), hi: Math.round(year / g) } }
}

/** Back to the calculation: no scale, Miami's shape, nothing set by hand. */
export const resetPlan = (plan: PacketPlan): PacketPlan => ({ ...plan, adjust: 0, season: null, override: null })

/** The line a page adds when the sales team scaled a range, so a buyer is never shown an edit as math. */
export function adjustLine(p: SalesCma, plan: PacketPlan): string {
  const a = (p.adjust || 0), b = (plan.adjust || 0)
  const parts: string[] = []
  if (a) parts.push(`${a > 0 ? '+' : ''}${a}% across the building`)
  if (b) parts.push(`${b > 0 ? '+' : ''}${b}% for this floor plan`)
  return parts.length ? `Adjusted by Stay's sales team: ${parts.join(' and ')}.` : ''
}

export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
export const kMoney = (n: number) => '$' + (n / 1000).toFixed(1) + 'K'
export const range = (a: number, b: number) => `${money(a)} to ${money(b)}`
export const pctRange = (a: number, b: number) => a === b ? `${a}%` : `${a}% to ${b}%`
export const compGross = (c: PacketComp) => c.grossText?.trim() || range(c.lo, c.hi)

/** The uplift sentence every plan page ends its "how we got there" with. */
export const upliftLine = (p: SalesCma) =>
  `New-build uplift: ranges are then raised ${p.uplift.lo}% at the low end and ${p.uplift.hi}% at the high end, ${p.uplift.why}`

/** Sensible "how we got there" text for a plan, from its numbers. Nick can rewrite it. */
export function suggestHow(p: SalesCma, plan: PacketPlan): string {
  const base = p.comps.find(c => c.id === plan.baseId)
  const name = base ? base.name : 'the comparable'
  if ((plan.suites || 1) > 1) return `${plan.suites} suites rented separately: ${plan.suites} x the ${name} comparison${plan.less ? `, less ${plan.less}% for shared turnover and one entry` : ''}. Nightly rate shown per suite.`
  if (plan.scale === 1) return `Direct comparison: Stay's ${name} projection. No scaling.`
  return `${name} comparison scaled ${plan.scale}x.`
}

export const newId = () => Math.random().toString(36).slice(2, 9)

// ── The Rider, as the template ─────────────────────────────────────────────────────────────────────
const NOMAD_S = 'nomad-studio', BRICK_S = 'brickell-studio', NOMAD_1 = 'nomad-1br', BRICK_1 = 'brickell-1br', BRICK_2 = 'brickell-2br'

const plan = (id: string, name: string, sf: string, price: string, compIds: string[], baseId: string, scale: number, less: number, suites: number, how: string): PacketPlan =>
  ({ id, name, sf, price, rules: 'Short-term rentals allowed', compIds, baseId, scale, less, suites, occLo: 70, occHi: 75, how, override: null })

export function riderTemplate(): SalesCma {
  return {
    building: 'The Rider Residences',
    area: 'Wynwood',
    sections: { partner: true, second: true, market: true, glance: true, plans: true },
    partner: {
      lead: 'For clients who own, or are buying, in buildings that allow short-term rentals. Here is how we work with agents and sales teams.',
      fees: [['$1,000', 'one-bedroom'], ['$1,250', 'two-bedroom'], ['$1,500', 'three bedrooms or more']],
      feeNote: 'Paid through your brokerage after the unit has been live with us for 90 days.',
      cards: [
        ['Rental projections in 48 hours', 'Send us any unit you are showing or listing. We send back a projection built from comparable Miami units, so your buyer sees the numbers before the offer.'],
        ['Building rules, already sorted', 'We track which Miami buildings allow nightly rentals, minimum stays and registration requirements, so your investors do not buy into a building that will not work for them.'],
        ['Your client stays your client', 'When an owner we manage decides to sell, the listing goes back to the agent who referred them.'],
      ],
      steps: [
        ['You send the unit.', 'Address or floor plan, and what the buyer cares about.'],
        ['We send the numbers within 48 hours.', 'A branded projection you can hand to the buyer, built from comparable units.'],
        ['We work with the buyer.', 'We walk through the terms, the onboarding and the building’s rental rules, and we copy you on the next steps.'],
        ['You get paid.', 'Once the unit has been live with us for 90 days, the referral fee goes to your brokerage, in writing.'],
      ],
      here: [
        'A rental comparison for every floor plan, so buyers see a range before they make an offer (included in this package).',
        'A unit-level projection within 48 hours for any buyer you introduce.',
        'A short session for your sales team on how rental numbers are built and what buyers ask.',
      ],
    },
    second: {
      lead: 'The building’s own rental program works for buyers who want everything under one roof. Some buyers ask who else they can choose. This page is for them.',
      choose: 'The Rider allows short-term rentals, with optional management through the building’s program or by a third party. A buyer is free to pick the manager that fits how they want to own. Stay works with the building’s rules, access and registration requirements, and with the sales team, from contract to opening day.',
      qa: [
        ['What does it cost?', '15% of rental revenue after channel fees. No setup fees, no monthly fees. Guests pay the cleaning fee.'],
        ['Who is on the ground?', 'Our own housekeeping, maintenance and inspection teams: a local team on the ground and 24/7 guest support on every stay.'],
        ['What will I see each month?', 'An owner portal with the live calendar, pricing and occupancy, plus a monthly P&L statement and payout for your unit, with every booking and fee itemized.'],
        ['Can I use my unit?', 'Yes. Block your own dates anytime, with no blackout restrictions.'],
        ['How do I get out?', 'A 90-day exit. We earn your business every month.'],
        ['How is the unit priced?', 'Every day, by demand, events and the competitors in the building, and listed on 40+ platforms plus our direct booking site.'],
        ['What is your track record?', '500+ units managed across South Florida, 1,000,000+ guests hosted, 99.7% guest satisfaction, 10+ years in Miami, including 30+ units at the Elser.'],
      ],
      steps: [
        ['At contract.', 'We send the buyer a projection for their floor plan within 48 hours.'],
        ['Before delivery.', 'We confirm the building’s rental rules and registration, agree on terms in writing, and plan furnishing, photos and listing build.'],
        ['At opening.', 'Listings go live across 40+ platforms with pricing set for the opening window, and the owner portal is ready.'],
      ],
      ask: [
        'When a buyer asks for options, please mention Stay and send them our way. We will send you the projection and keep you in the loop.',
        'Introduce us to buyers at contract so onboarding can start early.',
      ],
    },
    market: {
      lead: 'The evidence behind each floor-plan comparison in this package.',
      bullets: [
        ['Supply.', 'NoMad Wynwood opened in May 2026 with 329 units and allows short-term rentals. The Rider adds 152 furnished residences. Guests will compare the two buildings on nightly rate and reviews, so how well each unit is run decides who gets the booking.'],
        ['Competition is real.', 'New Wynwood units compete hard on rate, and units that priced too high at the March and April peak lost bookings into the summer. The owners who do best fill the calendar first and raise rates only where demand supports it.'],
        ['What wins.', 'Pricing for occupancy first, daily rate changes, fast and spotless turnovers, and quick replies to guests. Good operations earn good reviews, and reviews win the next booking.'],
        ['Event dates.', 'Art Basel week and New Year’s Eve command a large premium over the base rate. A unit that is live and reviewed before then is ready to capture it.'],
        ['New-build advantage.', 'A brand-new building opens with new furnishings, fresh photos and launch-period demand, with nothing worn or dated to discount.'],
        ['Rental rules.', 'Short-term rentals are allowed, with optional management by the building’s program or a third party. Owners choose.'],
      ],
    },
    comps: [
      { id: NOMAD_S, name: 'NoMad Wynwood studio', market: 'Wynwood, opened May 2026', basis: 'Stay projection, established listing', grossText: '$46,400 avg, $55,000 high', lo: 46000, hi: 55000, nightlyLo: 177, nightlyHi: 212, occLo: 70, occHi: 75 },
      { id: NOMAD_1, name: 'NoMad Wynwood one-bedroom', market: 'Wynwood, opened May 2026', basis: 'Stay projection, established listing', lo: 54900, hi: 60800, nightlyLo: 215, nightlyHi: 222, occLo: 70, occHi: 75 },
      { id: BRICK_S, name: 'Furnished new-build studio', market: 'Brickell, delivered', basis: 'Stay projection, established listing', lo: 54900, hi: 67700, nightlyLo: 212, nightlyHi: 235, occLo: 77, occHi: 85 },
      { id: BRICK_1, name: 'Furnished new-build one-bedroom', market: 'Brickell, delivered', basis: 'Stay projection, established listing', lo: 64600, hi: 79600, nightlyLo: 249, nightlyHi: 276, occLo: 77, occHi: 85 },
      { id: BRICK_2, name: 'Furnished new-build two-bedroom (947 SF)', market: 'Brickell, delivered', basis: 'Stay projection, established listing', lo: 96500, hi: 103400, nightlyLo: 344, nightlyHi: 357, occLo: 78, occHi: 80 },
    ],
    uplift: { lo: 15, hi: 20, why: 'because The Rider is a brand-new building delivering in 2027, opening with new furnishings, nothing dated and launch-period demand.' },
    plans: [
      plan('studio', 'Studio', '391 to 599 SF', '$593,900', [NOMAD_S, BRICK_S], NOMAD_S, 1, 0, 1, 'Direct comparison: Stay’s NoMad Wynwood studio projection. No scaling.'),
      plan('1bed', '1 Bed', '693 to 807 SF', '$764,900', [NOMAD_1, BRICK_1], NOMAD_1, 1, 0, 1, 'Direct comparison: Stay’s NoMad Wynwood one-bedroom projection. No scaling.'),
      plan('1den', '1 Bed + Den', '770 to 842 SF', '$860,900', [NOMAD_1, BRICK_1], NOMAD_1, 1.08, 0, 1, 'One-bedroom comparison plus 8% for the den (sleeps more, supports longer stays).'),
      plan('2bed', '2 Bed', '894 to 1,015 SF', '$1,309,900', [NOMAD_1, BRICK_2], NOMAD_1, 1.45, 0, 1, 'One-bedroom comparison scaled 1.45x, the one-bedroom to two-bedroom step in our other new-build projections.'),
      plan('2den', '2 Bed + Den', '1,021 to 1,066 SF', '$1,300,900', [NOMAD_1, BRICK_2], NOMAD_1, 1.55, 0, 1, 'One-bedroom comparison scaled 1.55x (two bedrooms plus the den).'),
      plan('2suite', '2 Studio Suites (Lockout)', '894 SF', '$1,261,900', [NOMAD_S, BRICK_S], NOMAD_S, 2, 10, 2, 'Two studios rented separately: 2 x the studio comparison, less 10% for shared turnover and one entry. Each suite is its own listing; nightly rate shown per suite.'),
      plan('3bed', '3 Bed (Lockout)', '1,441 to 1,612 SF', '$1,835,900', [NOMAD_1, BRICK_2], NOMAD_1, 2, 0, 1, 'One-bedroom comparison scaled 2.0x. There is no delivered Wynwood comparison at this size, so this is the least certain range.'),
      plan('3suite', '3 Studio Suites (Lockout)', '1,125 to 1,235 SF', '$1,512,900', [NOMAD_S, BRICK_S], NOMAD_S, 3, 15, 3, 'Three studios rented separately: 3 x the studio comparison, less 15% for shared turnover and one entry. Nightly rate shown per suite.'),
    ],
    disclaimer: 'Estimates for a furnished unit with an established listing, once the building is operating (delivery expected second half of 2027). Projections, not guarantees. Comparable figures are Stay projections for established units; The Rider has no operating history yet. Figures are gross rental revenue, before channel fees and Stay’s 15% management fee. No setup or monthly fees. Guests pay cleaning and taxes.',
  }
}

/** A clean CMA for any building: Stay's partner and second-option pages kept, the building emptied. */
export function blankCma(building = '', area = ''): SalesCma {
  const t = riderTemplate()
  return {
    ...t, building, area,
    second: { ...t.second, choose: 'This building allows short-term rentals. A buyer is free to pick the manager that fits how they want to own. Stay works with the building’s rules, access and registration requirements, and with the sales team, from contract to opening day.' },
    market: { lead: t.market.lead, bullets: [['Supply.', ''], ['Competition.', ''], ['What wins.', t.market.bullets[2][1]], ['Event dates.', t.market.bullets[3][1]], ['Rental rules.', '']] },
    comps: [], plans: [],
    uplift: { lo: 15, hi: 20, why: 'because a brand-new building opens with new furnishings, no aging inventory and launch-period demand.' },
    disclaimer: 'Estimates for a furnished unit with an established listing. Projections, not guarantees. Figures are gross rental revenue, before channel fees and Stay’s 15% management fee. No setup or monthly fees. Guests pay cleaning and taxes.',
  }
}

/** Fill anything an older stored CMA is missing, so new fields never crash a slide. Null in, null out. */
export function normalizeCma(p: any): SalesCma | null {
  if (!p || typeof p !== 'object') return null
  const t = riderTemplate()
  // Jon, 2026-11-11: "we do not pick up at 2am — just say 24/7 CCS team". Decks saved with the old
  // line are corrected as they are read, so no deck already out there keeps it.
  // Jon, 2026-11-11: 40+ platforms, not 30+. Same treatment for the steps.
  const fix = (x: string) => String(x || '').replace(/ with a local 24\/7 guest team on every check-in and every 2 a\.m\. issue\./, ' with a local 24/7 CCS team on every check-in.').replace(/, with a local 24\/7 CCS team on every check-in\./, ': a local team on the ground and 24/7 guest support on every stay.').replace(/\b30\+ platforms\b/g, '40+ platforms').replace(/\bthis packet\b/g, 'this package').replace(/earn on rate where demand supports it/g, 'raise rates only where demand supports it')
  if (p.partner && Array.isArray(p.partner.here)) p = { ...p, partner: { ...p.partner, here: p.partner.here.map((x: any) => typeof x === 'string' ? fix(x) : x) } }
  if (p.market) p = { ...p, market: { ...p.market, lead: fix(p.market.lead), bullets: Array.isArray(p.market.bullets) ? p.market.bullets.map((r: any) => Array.isArray(r) ? [r[0], fix(r[1])] : r) : p.market.bullets } }
  if (p.second) p = { ...p, second: { ...p.second,
    qa: Array.isArray(p.second.qa) ? p.second.qa.map((r: any) => Array.isArray(r) ? [r[0], fix(r[1])] : r) : p.second.qa,
    steps: Array.isArray(p.second.steps) ? p.second.steps.map((r: any) => Array.isArray(r) ? [r[0], fix(r[1])] : r) : p.second.steps } }
  return {
    ...t, ...p,
    sections: { ...t.sections, ...(p.sections || {}) },
    partner: { ...t.partner, ...(p.partner || {}) },
    second: { ...t.second, ...(p.second || {}) },
    market: { ...t.market, ...(p.market || {}) },
    uplift: { ...t.uplift, ...(p.uplift || {}) },
    comps: Array.isArray(p.comps) ? p.comps : [],
    plans: Array.isArray(p.plans) ? p.plans : [],
  }
}

export const fmtDate = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

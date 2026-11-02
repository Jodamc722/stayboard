// HOURS PER CLEAN, FROM WHAT WE PAY (Jon, 2026-11-02: "for scheduler we should use our KPI, look at
// the numbers and divide by $20, get hours per clean, then use this to assist team scheduling in
// each market").
//
// THE KPI. The Revenue Analytics VR P&L carries our EXPECTED LABOR COST PER CLEAN, per building and
// unit size (Jon: "the numbers I shared are our expected labor cost per clean" — not the cleaning
// fee the guest pays). Divided by the $20/hour we pay a cleaner, that is the paid hours one clean
// should take: a $50 17WEST 1-bed is 2.5 hours, a $35 Eden studio is 1.75. Add a day's cleans up in
// hours, divide by a shift, and you have how many cleaners the day needs in each market — sized by
// the labor each clean is budgeted for rather than a flat cleans-per-person.
//
// THE NUMBERS are copied from the P&L's labor-cost table on 2026-11-02 (the Revenue App feed is not
// connected to Lighthouse, so nothing can be read live). They are the default; an edited copy
// saved under CLEAN_RATES_KEY in app_settings wins, so a rate change does not need a deploy.
//
// WHAT IS LEFT OUT, ON PURPOSE. Outsourced buildings (Park Towers, Capri, Lucerne, Amrit) are on the
// table because the P&L carries their labor cost, but they are not our crew's hours — the scheduler already
// counts them as vendor cleans. Botanica's owner keeps the cleaning: no rate, no hours.
//
// A "Full" lock-out (Arya, 3316) is both halves cleaned together, so it carries both rates.
// A unit with no cost for its size (a 4-bed, a size the P&L does not list) falls back to the county's
// average labor cost per clean from the same P&L, so a day is never priced at zero.
//
// ISOMORPHIC: no server-only imports — the board prices cleans in the browser with the same table.

export const CLEAN_RATES_KEY = 'clean_rates_v1'

export type RateSize = 'studio' | 'one' | 'two' | 'threePlus'
export type RateMarket = 'Miami' | 'Broward' | 'North'

export type BuildingRate = {
  /** The building as the P&L names it. */
  label: string
  market: RateMarket
  /** Matched against "<guesty building> <listing name>", lowercased. */
  re: string
  rates: Partial<Record<RateSize, number>>
  /** A "Full" lock-out (two units booked as one): both cleans together. */
  fullRate?: number
  /** Cleaned by an outside company — on the P&L, not in our crew's hours. */
  outsourced?: boolean
  /** The owner keeps the cleaning: no rate, no hours. */
  ownerCleans?: boolean
}

export type CleanRates = {
  /** What a cleaner is paid per hour. Jon: $20. */
  payPerHour: number
  /** Hours in one cleaner's day, for turning hours into heads. */
  shiftHours: number
  /** The P&L's average labor cost per clean, per county — the fallback for a unit with no rate of its own. */
  marketRate: Record<RateMarket, number>
  buildings: BuildingRate[]
  updatedAt?: string
  updatedBy?: string
}

export const DEFAULT_CLEAN_RATES: CleanRates = {
  payPerHour: 20,
  shiftHours: 8,
  marketRate: { Miami: 58.37, Broward: 44.48, North: 44.87 },
  buildings: [
    // ── Miami-Dade ─────────────────────────────────────────────────────────
    { label: '17WEST', market: 'Miami', re: '\\b17\\s*-?\\s*west\\b|\\b17west\\b', rates: { one: 50, two: 65, threePlus: 85 } },
    { label: 'Elser', market: 'Miami', re: '\\belser\\b', rates: { studio: 40, one: 50, two: 65, threePlus: 85 } },
    { label: 'Arya', market: 'Miami', re: '\\barya\\b', rates: { studio: 45, one: 60 }, fullRate: 105 },   // Full = the studio + the 1-bed
    { label: 'District', market: 'Miami', re: '\\bdistrict\\b|\\bdist\\s*-?\\s*225\\b', rates: { two: 70 } },
    { label: 'Nomad', market: 'Miami', re: '\\bnomad\\b', rates: { one: 60 } },
    { label: 'Park Towers', market: 'Miami', re: '\\bpark\\s*towers?\\b|^\\s*pt\\b|\\spt\\b', rates: { studio: 60, one: 70 }, outsourced: true },
    // ── Broward ────────────────────────────────────────────────────────────
    { label: 'Eden', market: 'Broward', re: '\\beden\\b', rates: { studio: 35, one: 35, two: 50 } },
    { label: 'Rustic', market: 'Broward', re: '\\brustic\\b', rates: { one: 35, two: 50 } },
    { label: 'Pelican', market: 'Broward', re: '\\bpelican\\b', rates: { studio: 40, one: 45, two: 60 } },
    { label: 'Oasis', market: 'Broward', re: '\\boasis\\b|\\bmahogany\\b|\\broyal\\s*palm\\b|\\bbougainvillea\\b|\\bbamboo\\b|\\bsapodilla\\b|\\bjasmine\\b|\\bmango\\b', rates: { studio: 40, one: 45, two: 70 } },
    { label: 'Hendricks', market: 'Broward', re: '\\bhendricks?\\b', rates: { studio: 40, one: 50 } },
    { label: '906', market: 'Broward', re: '\\b906\\b', rates: { studio: 40, one: 45, two: 60 } },
    { label: '2023', market: 'Broward', re: '^\\s*2023\\b|\\s2023\\s*/', rates: { one: 35, two: 50 } },
    { label: 'Salato', market: 'Broward', re: '\\bsalato\\b', rates: { threePlus: 150 } },
    { label: '3316', market: 'Broward', re: '\\b3316\\b', rates: { two: 60 }, fullRate: 120 },              // Full = both 2-beds
    { label: '1587', market: 'Broward', re: '\\b1587\\b', rates: { threePlus: 90 } },
    { label: '7071 SW', market: 'Broward', re: '\\b7071\\b', rates: { threePlus: 160 } },
    { label: 'Botanica', market: 'Broward', re: '\\bbotanica\\b', rates: {}, ownerCleans: true },
    // ── Palm Beach ─────────────────────────────────────────────────────────
    { label: 'Boynton', market: 'North', re: '\\bboynton\\b', rates: { studio: 45, two: 55 } },
    { label: 'Capri', market: 'North', re: '\\bcapri\\b', rates: { studio: 40, one: 50, two: 61.71 }, outsourced: true },
    { label: 'Lucerne', market: 'North', re: '\\bluc[ee]rne\\b|\\blucenre\\b|^\\s*101\\b', rates: { studio: 40, one: 40 }, outsourced: true },
    { label: 'Amrit', market: 'North', re: '\\bamrit\\b', rates: { two: 140 }, outsourced: true },
  ],
}

const SIZE_LABEL: Record<RateSize, string> = { studio: 'Studio', one: '1 BR', two: '2 BR', threePlus: '3 BR+' }
export const RATE_SIZES: RateSize[] = ['studio', 'one', 'two', 'threePlus']
export const rateSizeLabel = (s: RateSize) => SIZE_LABEL[s]

/** Bedrooms → the P&L's size column. Guesty files many studios as 1 bedroom, so the name decides first. */
export function rateSizeOf(bedrooms: number | null | undefined, name?: string | null): RateSize {
  if (/\bstu(dio)?\b/i.test(String(name || ''))) return 'studio'
  if (bedrooms == null) return 'one'
  if (bedrooms <= 0) return 'studio'
  if (bedrooms === 1) return 'one'
  if (bedrooms === 2) return 'two'
  return 'threePlus'
}

/** The saved copy merged over the defaults: a partial save never drops a building. */
export function resolveCleanRates(saved: Partial<CleanRates> | null | undefined): CleanRates {
  const d = DEFAULT_CLEAN_RATES
  if (!saved || typeof saved !== 'object') return d
  const pay = Number(saved.payPerHour)
  const shift = Number(saved.shiftHours)
  const byLabel: Record<string, BuildingRate> = {}
  for (const b of Array.isArray(saved.buildings) ? saved.buildings : []) if (b && b.label) byLabel[b.label] = b
  const buildings = d.buildings.map(b => {
    const s = byLabel[b.label]
    if (!s) return b
    const rates: Partial<Record<RateSize, number>> = {}
    for (const k of RATE_SIZES) {
      const v = s.rates ? (s.rates as any)[k] : undefined
      if (v === null) continue                              // cleared on purpose
      const n = Number(v)
      if (v !== undefined && Number.isFinite(n) && n > 0) rates[k] = n
      else if (v === undefined && b.rates[k] != null) rates[k] = b.rates[k]
    }
    const fr = Number(s.fullRate)
    return { ...b, rates, fullRate: s.fullRate === null ? undefined : Number.isFinite(fr) && fr > 0 ? fr : b.fullRate, outsourced: s.outsourced ?? b.outsourced, ownerCleans: s.ownerCleans ?? b.ownerCleans }
  })
  // Buildings added in the editor that the defaults do not know.
  for (const s of Object.values(byLabel)) if (!d.buildings.some(b => b.label === s.label) && s.re && s.market) buildings.push(s)
  const mr = { ...d.marketRate }
  for (const k of Object.keys(mr) as RateMarket[]) { const n = Number(saved.marketRate && (saved.marketRate as any)[k]); if (Number.isFinite(n) && n > 0) mr[k] = n }
  return {
    payPerHour: Number.isFinite(pay) && pay > 0 ? pay : d.payPerHour,
    shiftHours: Number.isFinite(shift) && shift > 0 ? shift : d.shiftHours,
    marketRate: mr,
    buildings,
    updatedAt: saved.updatedAt, updatedBy: saved.updatedBy,
  }
}

const reCache = new Map<string, RegExp | null>()
function reOf(src: string): RegExp | null {
  if (reCache.has(src)) return reCache.get(src) || null
  let r: RegExp | null = null
  try { r = new RegExp(src, 'i') } catch { r = null }
  reCache.set(src, r)
  return r
}

export function rateBuildingOf(cfg: CleanRates, building?: string | null, name?: string | null): BuildingRate | null {
  const hay = (' ' + String(building || '') + ' ' + String(name || '') + ' ').toLowerCase().replace(/[_,]+/g, ' ')
  const exact = String(building || '').trim().toLowerCase()
  for (const b of cfg.buildings) {
    if (exact && exact === b.label.toLowerCase()) return b
  }
  for (const b of cfg.buildings) { const r = reOf(b.re); if (r && (r.test(hay) || r.test(String(building || '').toLowerCase()))) return b }
  return null
}

export type CleanPrice = {
  building: string | null
  size: RateSize
  /** Expected labor cost of this clean, in dollars (the P&L KPI). */
  rate: number
  /** rate ÷ pay per hour. */
  hours: number
  /** Where the rate came from: the building's own column, or the market average. */
  source: 'building' | 'market' | 'none'
  outsourced: boolean
  ownerCleans: boolean
}

/** What one clean is expected to cost in labor, and the paid hours that is. */
export function priceClean(cfg: CleanRates, opts: { building?: string | null; name?: string | null; bedrooms?: number | null; market?: string | null }): CleanPrice {
  const size = rateSizeOf(opts.bedrooms, opts.name)
  const b = rateBuildingOf(cfg, opts.building, opts.name)
  const mk = (b?.market || (['Miami', 'Broward', 'North'].includes(String(opts.market)) ? opts.market : 'Miami')) as RateMarket
  if (b?.ownerCleans) return { building: b.label, size, rate: 0, hours: 0, source: 'none', outsourced: false, ownerCleans: true }
  const full = /\bfull\b/i.test(String(opts.name || '') + ' ' + String(opts.building || '')) && b?.fullRate ? b.fullRate : undefined
  const own = full ?? (b ? b.rates[size] : undefined)
  const rate = own != null ? own : cfg.marketRate[mk]
  return {
    building: b ? b.label : null, size, rate,
    hours: Math.round((rate / cfg.payPerHour) * 100) / 100,
    source: own != null ? 'building' : 'market',
    outsourced: !!b?.outsourced, ownerCleans: false,
  }
}

/** Cleaners a block of hours needs, a whole person at a time. */
export function cleanersFor(cfg: CleanRates, hours: number): number {
  return hours > 0 ? Math.ceil(hours / cfg.shiftHours - 1e-9) : 0
}

export const fmtHours = (h: number) => (Math.round(h * 10) / 10).toFixed(Math.abs(h - Math.round(h)) < 0.05 ? 0 : 1) + 'h'

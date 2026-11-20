// SIGNAL (Jon, 2026-11-20: "the most important things that need to be completed vs busy work"; "delineate a low-income property versus a high-income property, priority bookings versus non-priority").
//
// ONE MODEL, THREE ANSWERS, NO SERVER. Pure functions with no imports (the model for this file is
// lib/ops-focus-rank.ts), so the rules can be unit-tested with plain node and read by a client
// component, a route and a brief without any of them owning a copy:
//
//   1. PROPERTY TIER   — is this a high-income building? By the building's REALISED NIGHTLY RATE
//                        (accommodation fare / nights sold, trailing 12 months). Jon: tier by ADR,
//                        not by revenue per unit. Botanica is its own Partner class.
//   2. BOOKING PRIORITY — is this a priority booking, and is it arriving into a unit at risk?
//   3. SIGNAL SCORE    — 0 to 100 for anything that asks for attention, with the ONE LINE that says
//                        why ("17WEST · $315 a night · guest in house · 2 days overdue").
//
// Every threshold is a named constant below. The two that already had a setting (the big-booking
// dollars and the long-stay nights, lib/slack-rules) are PASSED IN by the caller, so there is one
// source for them; the defaults here only stand when a caller has none.
//
// WHY THESE NUMBERS (tested on the live book, 2026-11-20):
//   · $150 a night puts 17WEST ($315), Elser ($160), Arya ($151), Amrit ($797), Salato ($351),
//     7071 SW, 1587 and District 225 High: 32% of the units, 59% of the accommodation revenue.
//     "Miami market" is not a simpler rule: it misses Amrit and Salato and pulls in Park Towers ($68).
//   · A building is tiered as a BUILDING, not unit by unit: Elser's median unit is $132, so a unit
//     line would split Jon's own examples.
//   · "High-tier building" alone is not a priority booking: 57% of the next 14 days' arrivals are
//     in one. The priority rule flags about a quarter; priority AT RISK about one in eight.

// ───────────────────────────── 1. PROPERTY TIER ─────────────────────────────

export type Tier = 'high' | 'standard' | 'partner'
/** rate = the nightly rate decided it · flag = Jon's lux flag placed it · override = app setting or pinned default · partner = hotel partner · none = no history and no flag */
export type TierSource = 'rate' | 'flag' | 'override' | 'partner' | 'none'

export const TIER_RULES = {
  /** High at this realised nightly rate (accommodation fare / nights sold) or more. */
  highRateUsd: 150,
  /** The rate only decides once this many nights were sold in the window; under it the lux flag places the building. */
  minNights: 100,
  /** Trailing window, in days, the rate is measured over. */
  windowDays: 365,
}
/** Hotel partners: not run by our operations, off every ranked list (Botanica: no inspections, no welcome calls, no daily housekeeping). */
export const PARTNER_BUILDINGS = ['Botanica']
/**
 * Pinned until Jon says otherwise (his defaults, 2026-11-20). All three are Standard by the rate
 * today (Park Towers $68, 3316 $148, Hendricks $97); pinning them keeps 3316 from flipping the day
 * its rate crosses $150. The `property_tiers` app setting wins over this list, either way.
 */
export const DEFAULT_TIER_OVERRIDES: Record<string, Tier> = { 'Park Towers': 'standard', '3316': 'standard', 'Hendricks': 'standard' }
export const TIER_LABEL: Record<Tier, string> = { high: 'High', standard: 'Standard', partner: 'Partner' }

export type BuildingTier = {
  building: string
  tier: Tier
  source: TierSource
  /** Realised nightly rate, whole dollars; null when no night was sold in the window. */
  rate: number | null
  nights: number
  revenue: number
  units: number
}

const bkey = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** Accommodation fare / nights sold, whole dollars. Null when nothing was sold. */
export function nightlyRate(revenue: number, nights: number): number | null {
  const n = num(nights)
  return n > 0 ? Math.round(num(revenue) / n) : null
}

/** Look a building up in an override map whatever its spelling ("17 West" = "17WEST"). */
export function overrideFor(building: string, overrides?: Record<string, any> | null): Tier | null {
  if (!overrides) return null
  const want = bkey(building)
  for (const k of Object.keys(overrides)) {
    if (bkey(k) !== want) continue
    const v = String(overrides[k] || '').toLowerCase()
    if (v === 'high' || v === 'standard' || v === 'partner') return v
  }
  return null
}

/**
 * One building's tier. Order: an override (setting, then pinned default) → partner → the rate,
 * when enough nights were sold → the lux flag → Standard.
 */
export function tierFor(i: {
  building: string; revenue?: number; nights?: number; units?: number; lux?: boolean
  overrides?: Record<string, any> | null
}, rules = TIER_RULES): BuildingTier {
  const revenue = num(i.revenue), nights = num(i.nights)
  const rate = nightlyRate(revenue, nights)
  const base = { building: i.building, rate, nights, revenue: Math.round(revenue), units: num(i.units) }
  const forced = overrideFor(i.building, i.overrides) || overrideFor(i.building, DEFAULT_TIER_OVERRIDES)
  if (forced) return { ...base, tier: forced, source: 'override' }
  if (PARTNER_BUILDINGS.some(p => bkey(p) === bkey(i.building))) return { ...base, tier: 'partner', source: 'partner' }
  const enough = nights >= rules.minNights && rate != null
  if (enough && (rate as number) >= rules.highRateUsd) return { ...base, tier: 'high', source: 'rate' }
  if (i.lux) return { ...base, tier: 'high', source: 'flag' }
  return { ...base, tier: 'standard', source: enough ? 'rate' : 'none' }
}

// ──────────────────────────── 2. BOOKING PRIORITY ────────────────────────────

/** The two thresholds that already have a setting (lib/slack-rules bigBookingUsd / longStayNights). */
export type PriorityRules = { bigBookingUsd: number; longStayNights: number }
export const PRIORITY_DEFAULTS: PriorityRules = { bigBookingUsd: 3000, longStayNights: 14 }
/** Guesty's owner sources ("owner", "owner-guest") — the same test the briefs use. */
export const OWNER_SOURCE = /^owner/i
/** A review at or under this many stars, among the unit's last LOW_REVIEW_LAST_N, puts an arrival at risk. */
export const LOW_REVIEW_STARS = 2
export const LOW_REVIEW_LAST_N = 5

export type PriorityWhy = 'owner' | 'sensitive' | 'vip' | 'big' | 'long' | 'repeat'
export const PRIORITY_WHY_LABEL: Record<PriorityWhy, string> = {
  owner: 'owner stay', sensitive: 'sensitive guest', vip: 'VIP', big: 'big booking', long: 'long stay', repeat: 'repeat guest',
}
export type BookingFacts = {
  source?: string | null; owner?: boolean
  total?: number | null; nights?: number | null
  sensitive?: boolean; vip?: boolean; repeat?: boolean
}
export type Priority = { priority: boolean; why: PriorityWhy[]; label: string }

/**
 * Is this a priority booking? Owner stay, guest marked Sensitive or VIP, big, long, or a repeat guest.
 * `ignoreSensitive`: the Glitches board passes it, because filing a glitch is what ticks Sensitive
 * (app/api/glitches POST) — there the tick would make every card a priority and so none of them.
 */
export function priorityOf(b: BookingFacts, rules?: Partial<PriorityRules> | null, opts?: { ignoreSensitive?: boolean }): Priority {
  const big = num(rules?.bigBookingUsd) > 0 ? num(rules?.bigBookingUsd) : PRIORITY_DEFAULTS.bigBookingUsd
  const long = num(rules?.longStayNights) > 0 ? num(rules?.longStayNights) : PRIORITY_DEFAULTS.longStayNights
  const why: PriorityWhy[] = []
  if (b.owner || OWNER_SOURCE.test(String(b.source || '').trim())) why.push('owner')
  if (b.vip) why.push('vip')
  if (b.sensitive && !opts?.ignoreSensitive) why.push('sensitive')
  if (b.total != null && num(b.total) >= big) why.push('big')
  if (b.nights != null && num(b.nights) >= long) why.push('long')
  if (b.repeat) why.push('repeat')
  return { priority: why.length > 0, why, label: why.map(w => PRIORITY_WHY_LABEL[w]).join(', ') }
}

export type RiskFacts = { sameDayTurn?: boolean; openGlitch?: boolean; lowReview?: boolean }
export type RiskWhy = 'same-day turn' | 'open glitch' | 'recent low review'
/** What could go wrong on arrival: a same-day turn, an open glitch on the unit, a recent low review. */
export function riskOf(r: RiskFacts): { atRisk: boolean; why: RiskWhy[]; label: string } {
  const why: RiskWhy[] = []
  if (r.sameDayTurn) why.push('same-day turn')
  if (r.openGlitch) why.push('open glitch')
  if (r.lowReview) why.push('recent low review')
  return { atRisk: why.length > 0, why, label: why.join(', ') }
}

/** True when any of the unit's last five reviews (newest first, 5-star scale) is 2 stars or lower. */
export function hasLowReview(ratingsNewestFirst: any[]): boolean {
  return (ratingsNewestFirst || []).slice(0, LOW_REVIEW_LAST_N).some(r => {
    if (r == null || r === '') return false
    const n = Number(r)
    return Number.isFinite(n) && n <= LOW_REVIEW_STARS
  })
}

export type ArrivalFlag = {
  priority: boolean; atRisk: boolean
  /** 'Priority at risk' | 'Priority' | '' — the one extra tag a list prints. */
  tag: '' | 'Priority' | 'Priority at risk'
  why: PriorityWhy[]; risk: RiskWhy[]
  /** "big booking, repeat guest · same-day turn" — why it is flagged, then what puts it at risk. */
  reason: string
  /** 0 priority at risk · 1 priority · 2 the rest: the sort key. */
  rank: 0 | 1 | 2
}
/** One arrival: priority, and priority AT RISK only when it is both a priority booking and has a risk. */
export function arrivalFlag(b: BookingFacts, r?: RiskFacts | null, rules?: Partial<PriorityRules> | null): ArrivalFlag {
  const p = priorityOf(b, rules)
  const k = riskOf(r || {})
  const atRisk = p.priority && k.atRisk
  return {
    priority: p.priority, atRisk,
    tag: atRisk ? 'Priority at risk' : p.priority ? 'Priority' : '',
    why: p.why, risk: atRisk ? k.why : [],
    reason: [p.label, atRisk ? k.label : ''].filter(Boolean).join(' · '),
    rank: atRisk ? 0 : p.priority ? 1 : 2,
  }
}

// ───────────────────────────── 3. THE SIGNAL SCORE ─────────────────────────────

export const SIGNAL_W = {
  /** GUEST IMPACT NOW (0-35). A guest in the unit who told us about it is the most a thing can hurt. */
  inHouseReported: 35,
  arrivingToday: 30,
  /** In the unit but they have not complained (a field-noted job). */
  inHouse: 20,
  /** Arriving within SOON_DAYS. */
  arrivingSoon: 15,
  /** MONEY AT STAKE (0-35): one point per this many dollars. */
  usdPerPoint: 60,
  moneyCap: 35,
  /** Nights of the stay counted as exposed, at most. */
  nightsCap: 7,
  /** THE CLOCK (0-20): due today, overdue or marked urgent; then due within CLOCK_SOON_DAYS. */
  clockLate: 20,
  clockSoon: 10,
  /** PRIORITY BOOKING (0-10). */
  priority: 10,
  /** A deadline that forfeits money inside this many hours can never rank under the floor. */
  deadlineHours: 48,
  deadlineFloor: 70,
}
export const SOON_DAYS = 3
export const CLOCK_SOON_DAYS = 2
/** At or above this a thing is signal; under BUSY_UNDER it is busy work. Labels only — lists sort by the score. */
export const SIGNAL_AT = 60
export const BUSY_UNDER = 30

export type GuestState = 'in_house' | 'arriving_today' | 'arriving_soon' | 'none'
export type SignalInput = {
  /** Canonical building label, for the reason line. */
  building?: string | null
  tier?: Tier | null
  /** The building's realised nightly rate — printed in the reason, and the fare when the booking's is unknown. */
  rate?: number | null
  guest?: GuestState
  /** The guest told us (a glitch, a guest-reported task) — as against something the field noted. */
  guestReported?: boolean
  /** For 'arriving_soon': how many days out (1-3). */
  arrivesInDays?: number | null
  /** The affected booking's nightly accommodation fare. */
  nightlyFare?: number | null
  /** Nights left of the stay in house, or the arriving stay's nights. Capped at nightsCap. */
  nightsExposed?: number | null
  /** Money named outright: a refund on the table, a claim's amount. The larger of this and the exposure counts. */
  stakeUsd?: number | null
  /** Days until due: negative = overdue, 0 = today. Null = no due date. */
  dueInDays?: number | null
  urgent?: boolean
  /** Hours until a deadline that forfeits money (a claim's filing window). */
  moneyDeadlineHours?: number | null
  priority?: boolean
  /** NO GUEST, MONEY LEAKING: what the unit earns a week while it is not selling. Ranks on the leaks line. */
  weeklyUsd?: number | null
}
export type Signal = {
  score: number
  /** 'work' ranks by score · 'leak' ranks by dollars a week · 'partner' is not ranked at all. */
  line: 'work' | 'leak' | 'partner'
  ranked: boolean
  parts: { guest: number; money: number; clock: number; priority: number }
  stakeUsd: number
  weeklyUsd: number
  /** The 48-hour money-deadline floor lifted this score. */
  floored: boolean
  tier: Tier | null
  priority: boolean
  rate: number | null
  dueInDays: number | null
  reason: string
}

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const days = (n: number) => n + ' day' + (n === 1 ? '' : 's')

function guestPoints(i: SignalInput): number {
  const g = i.guest || 'none'
  if (g === 'in_house') return i.guestReported ? SIGNAL_W.inHouseReported : SIGNAL_W.inHouse
  if (g === 'arriving_today') return SIGNAL_W.arrivingToday
  if (g === 'arriving_soon') return SIGNAL_W.arrivingSoon
  return 0
}

/** Dollars at stake: the booking's nightly fare × the nights exposed (seven at most), or the money named outright if larger. */
export function stakeOf(i: SignalInput): number {
  const named = Math.max(0, num(i.stakeUsd))
  const g = i.guest || 'none'
  if (g === 'none') return named
  const fare = num(i.nightlyFare) > 0 ? num(i.nightlyFare) : Math.max(0, num(i.rate))
  const nights = Math.min(SIGNAL_W.nightsCap, Math.max(0, num(i.nightsExposed)))
  return Math.max(named, fare * nights)
}

function clockPoints(i: SignalInput): number {
  const d = i.dueInDays
  if (i.urgent) return SIGNAL_W.clockLate
  if (d != null && Number.isFinite(Number(d))) {
    if (Number(d) <= 0) return SIGNAL_W.clockLate
    if (Number(d) <= CLOCK_SOON_DAYS) return SIGNAL_W.clockSoon
  }
  const h = i.moneyDeadlineHours
  if (h != null && Number.isFinite(Number(h))) {
    if (Number(h) <= SIGNAL_W.deadlineHours) return SIGNAL_W.clockLate
    if (Number(h) <= 24 * 7) return SIGNAL_W.clockSoon
  }
  return 0
}

/**
 * The one line a person reads to know why a thing is where it is:
 *   "17WEST · $315 a night · guest in house · 2 days overdue"
 * Building, the rate, who is affected, the clock. Nothing that is not true is printed.
 */
export function reasonLine(i: SignalInput, stake?: number): string {
  const bits: string[] = []
  if (i.building) bits.push(String(i.building))
  if (num(i.rate) > 0) bits.push(usd(num(i.rate)) + ' a night')
  const g = i.guest || 'none'
  const p = i.priority ? 'priority ' : ''
  if (g === 'in_house') bits.push(p + 'guest in house')
  else if (g === 'arriving_today') bits.push(p + 'arrival today')
  else if (g === 'arriving_soon') {
    const d = Math.round(num(i.arrivesInDays))
    bits.push(p + (d === 1 ? 'arrival tomorrow' : d > 1 ? 'arrival in ' + days(d) : 'arrival soon'))
  } else if (num(i.weeklyUsd) > 0) bits.push('about ' + usd(num(i.weeklyUsd)) + ' a week not selling')
  const h = i.moneyDeadlineHours
  if (h != null && Number.isFinite(Number(h))) {
    const amt = num(stake ?? i.stakeUsd) > 0 ? usd(num(stake ?? i.stakeUsd)) + ' ' : 'money '
    if (Number(h) < 0) bits.push(amt + 'deadline passed')
    else if (Number(h) <= 24) bits.push(amt + 'deadline inside a day')
    else if (Number(h) <= SIGNAL_W.deadlineHours) bits.push(amt + 'deadline inside 48 hours')
    else bits.push(amt + 'deadline in ' + days(Math.round(Number(h) / 24)))
  }
  const d = i.dueInDays
  if (d != null && Number.isFinite(Number(d))) {
    const n = Math.round(Number(d))
    if (n < 0) bits.push(days(-n) + ' overdue')
    else if (n === 0) bits.push('due today')
    else if (n <= CLOCK_SOON_DAYS) bits.push(n === 1 ? 'due tomorrow' : 'due in ' + days(n))
  }
  if (i.urgent) bits.push('urgent')
  return bits.join(' · ')
}

/** Score one thing that asks for attention. */
export function signalScore(i: SignalInput): Signal {
  const tier = i.tier || null
  const rate = num(i.rate) > 0 ? Math.round(num(i.rate)) : null
  const dueInDays = i.dueInDays != null && Number.isFinite(Number(i.dueInDays)) ? Math.round(Number(i.dueInDays)) : null
  const weekly = Math.max(0, Math.round(num(i.weeklyUsd)))
  // PARTNER PROPERTIES ARE NOT RANKED (Botanica is run by the hotel, not by our operations).
  if (tier === 'partner') {
    return { score: 0, line: 'partner', ranked: false, parts: { guest: 0, money: 0, clock: 0, priority: 0 }, stakeUsd: 0, weeklyUsd: 0, floored: false, tier, priority: false, rate, dueInDays, reason: [i.building, 'partner property'].filter(Boolean).join(' · ') }
  }
  const stake = stakeOf(i)
  const guest = guestPoints(i)
  const money = Math.min(SIGNAL_W.moneyCap, stake / SIGNAL_W.usdPerPoint)
  const clock = clockPoints(i)
  const priority = i.priority ? SIGNAL_W.priority : 0
  let score = guest + money + clock + priority
  // THE FLOOR. A filing deadline that forfeits money inside 48 hours has no guest and often no
  // amount on the draft, so the sum alone ranked it 59th of 110 on the day this was built.
  const h = i.moneyDeadlineHours
  let floored = false
  if (h != null && Number.isFinite(Number(h)) && Number(h) >= 0 && Number(h) <= SIGNAL_W.deadlineHours && score < SIGNAL_W.deadlineFloor) {
    score = SIGNAL_W.deadlineFloor
    floored = true
  }
  // NO GUEST, A UNIT NOT SELLING: its own line, ranked by dollars a week (a guest always outranks
  // it on the work line, and it would otherwise sit at the bottom losing money every day).
  const line: Signal['line'] = (i.guest || 'none') === 'none' && weekly > 0 && !floored ? 'leak' : 'work'
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    line, ranked: true,
    parts: { guest, money: Math.round(money), clock, priority },
    stakeUsd: Math.round(stake), weeklyUsd: weekly, floored, tier, priority: !!i.priority, rate, dueInDays,
    reason: reasonLine(i, stake),
  }
}

type Sortable = { signal?: Signal | null; key?: string | null }
/**
 * Highest signal first. Ties: more dollars at stake → the higher nightly rate → the older due date
 * → the key, so two reads of the same list never disagree. Unranked (partner) rows go last.
 */
export function compareSignal(a: Sortable, b: Sortable): number {
  const x = a.signal, y = b.signal
  const rx = x && x.ranked ? 1 : 0, ry = y && y.ranked ? 1 : 0
  if (rx !== ry) return ry - rx
  if (!x || !y) return String(a.key || '').localeCompare(String(b.key || ''))
  return (y.score - x.score)
    || (y.stakeUsd - x.stakeUsd)
    || (num(y.rate) - num(x.rate))
    || ((x.dueInDays ?? 9999) - (y.dueInDays ?? 9999))
    || String(a.key || '').localeCompare(String(b.key || ''))
}

/** The revenue-leaks line: most dollars a week first, then the higher tier, then the key. */
export function compareLeaks(a: Sortable, b: Sortable): number {
  const x = a.signal, y = b.signal
  return (num(y?.weeklyUsd) - num(x?.weeklyUsd))
    || (tierRank(x?.tier) - tierRank(y?.tier))
    || String(a.key || '').localeCompare(String(b.key || ''))
}

/** High before Standard before Partner: the tie-break where a list keeps its own order. */
export function tierRank(t?: Tier | null): number { return t === 'high' ? 0 : t === 'partner' ? 2 : 1 }

/** Dollars a blocked unit loses: the building's nightly rate × the nights blocked. Zero when the rate is unknown. */
export function blockedLoss(rate: number | null | undefined, nights: number | null | undefined): number {
  return Math.max(0, Math.round(num(rate) * Math.max(0, num(nights))))
}
/** "about $1,260 lost" — rounded to the ten, because the rate is an average and not a quote. */
export function lossText(usdLost: number): string {
  const n = Math.round(num(usdLost) / 10) * 10
  return n > 0 ? 'about ' + usd(n) + ' lost' : ''
}

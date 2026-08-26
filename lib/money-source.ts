// MONEY SOURCE — which app owns each kind of money, and the one override every board goes through.
//
// THE DECISION (Jon, 2026-08-24): "his app will be the source of truth… revenue data will source
// from his app for KPI, report builders, etc." So this is not a lens someone switches to. When a
// domain is ON, HIS NUMBER IS THE NUMBER, everywhere at once — KPI board, daily briefs, Eve, owner
// reports, share links — and ours survives only as a labelled fallback for a window or a unit he
// does not cover.
//
// FOUR DOMAINS, FOUR SWITCHES (`app_settings.money_domains`, all false until July reconciles):
//   revenue     — accommodation, cleaning revenue, ADR / RevPAR / occupancy, channel mix
//   expenses    — QuickBooks actuals (his 5100/5200 groups)
//   budget      — the locked budget per month
//   projections — his Bear / Base / Bull month-end forecast
// Separate switches because they earn trust at different speeds: revenue reconciles against our own
// Guesty math in a month, expenses have nothing on our side to check against at all.
//
// WHAT NEVER MOVES (feedback-labor-truth-source, and Jon confirmed it again here): payroll and
// hours come from Homebase, volume comes from departure cleans. His QuickBooks payroll is CONTEXT
// beside ours, never the number that decides cost-per-clean. So `cleaning.revenue` swaps to his and
// `cleaning.cost` stays ours — which makes the margin between them more honest than it was, not
// less, and it is labelled as a mix.
//
// WHAT NEVER HAPPENS: a blended number with no label. Every override carries `moneySource` saying
// which app answered, when it last synced, and which fields moved. If his feed is stale or thin, we
// fall back to our own math AND SAY SO on screen (feedback-alerts-must-name-things).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { revenueAppUnitMonth, type RevUnitMonthRow } from '@/lib/revenue-source'

export const MONEY_DOMAINS_KEY = 'money_domains'

export type MoneyDomains = {
  revenue: boolean; expenses: boolean; budget: boolean; projections: boolean; maxStaleHours: number
}
export const DEFAULT_MONEY_DOMAINS: MoneyDomains = {
  revenue: false, expenses: false, budget: false, projections: false, maxStaleHours: 6,
}

export async function getMoneyDomains(): Promise<MoneyDomains> {
  const s = await getSetting<any>(MONEY_DOMAINS_KEY, null)
  const on = (v: any) => v === true || v === 'true'
  const stale = Number(s && s.maxStaleHours)
  return {
    revenue: on(s && s.revenue), expenses: on(s && s.expenses),
    budget: on(s && s.budget), projections: on(s && s.projections),
    maxStaleHours: stale > 0 ? stale : DEFAULT_MONEY_DOMAINS.maxStaleHours,
  }
}

/** Provenance every consumer can render. `source` is what you are LOOKING AT, not what was asked for. */
export type Provenance = {
  source: 'revenue_app' | 'lighthouse'
  note: string | null
  syncedAt: string | null
  fields: string[]          // which figures actually moved
  fallbackUnits?: number
}

const n = (v: any): number | null => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
const sum = (rows: any[], k: string): number => rows.reduce((s, r) => s + (n(r[k]) || 0), 0)

/** Whole calendar month? His feeds are month-grained; any other window stays ours and says why. */
export function wholeMonth(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null
  if (from.slice(0, 7) !== to.slice(0, 7) || !from.endsWith('-01')) return null
  const last = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10)
  return to === last ? from.slice(0, 7) : null
}

// ---------------------------------------------------------------------------------------------
// REVENUE — his unit-month rows, rolled to the portfolio shape the KPI board speaks.
// ---------------------------------------------------------------------------------------------

export type MonthMoney = {
  month: string
  units: number
  nights: number
  available: number
  occupancy: number | null
  grossAccom: number | null      // before OTA commission  (our 'netota')
  netAccom: number | null        // after  OTA commission  (our 'net')
  cleaningGross: number | null
  cleaningNet: number | null
  mgmtFee: number | null
  otherRevenue: number | null
  stayRevenue: number | null
  total: number | null           // gross accom + cleaning — what the KPI board calls total revenue
  adr: number | null             // total ÷ nights sold   (matches our Gross basis: accom + cleaning)
  adrRoomOnly: number | null
  revpar: number | null
  kind: 'eom' | 'live' | null
  syncedAt: string | null
  byUnit: Record<string, RevUnitMonthRow>
}

/**
 * Roll a set of his unit rows into the portfolio shape.
 *
 * SCOPE MATTERS. The KPI board can be filtered to a market or a building, and his portfolio total
 * covers all 233 units — dropping it onto a filtered board would show Miami the whole company's
 * revenue. So the aggregate is always built from the unit rows that are actually in scope, and a
 * scope he cannot cover falls back to ours instead of being answered wrongly.
 */
export function aggregateUnitRows(
  rows: RevUnitMonthRow[], month: string, kind: 'eom' | 'live' | null, syncedAt: string | null,
): MonthMoney | null {
  if (!rows.length) return null
  const byUnit: Record<string, RevUnitMonthRow> = {}
  for (const r of rows) byUnit[r.guesty_listing_id] = r

  const nights = sum(rows, 'nights_sold')
  const available = sum(rows, 'nights_available')
  const grossAccom = sum(rows, 'gross_accom')
  const netAccom = sum(rows, 'net_accom')
  const cleaningGross = sum(rows, 'gross_cleaning')
  const cleaningNet = sum(rows, 'net_cleaning')
  // Gross basis = accommodation + cleaning, cleaning spread per night. Same convention as
  // lib/unit-revenue and the Botanica report, so his total lands in the same units as ours.
  const cleaningForTotal = cleaningGross > 0 ? cleaningGross : cleaningNet
  const total = grossAccom + cleaningForTotal

  return {
    month, units: rows.length, nights, available,
    occupancy: available > 0 ? Math.round((nights / available) * 1000) / 10 : null,
    grossAccom: grossAccom || null, netAccom: netAccom || null,
    cleaningGross: cleaningGross || null, cleaningNet: cleaningNet || null,
    mgmtFee: sum(rows, 'mgmt_fee') || null,
    otherRevenue: sum(rows, 'other_revenue') || null,
    stayRevenue: sum(rows, 'stay_revenue') || null,
    total: total || null,
    adr: nights > 0 ? Math.round(total / nights) : null,
    adrRoomOnly: nights > 0 ? Math.round(grossAccom / nights) : null,
    revpar: available > 0 ? Math.round(total / available) : null,
    kind, syncedAt, byUnit,
  }
}

/** His numbers for one month, whole portfolio. Null when the mirror has nothing usable. */
export async function monthMoney(month: string): Promise<MonthMoney | null> {
  const his = await revenueAppUnitMonth(month)
  const rows: RevUnitMonthRow[] = []
  for (const k of Object.keys(his.rows)) rows.push(his.rows[k])
  return aggregateUnitRows(rows, month, his.kind, his.syncedAt)
}

function staleness(syncedAt: string | null, maxStaleHours: number): { ageH: number; stale: boolean } {
  const ageH = syncedAt ? (Date.now() - new Date(syncedAt).getTime()) / 3_600_000 : Infinity
  return { ageH, stale: ageH > maxStaleHours }
}

/**
 * Resolve the revenue domain for a window. Returns `null` when OUR numbers should stand — with a
 * `note` explaining why whenever the caller asked for his and did not get them.
 */
export async function resolveRevenue(
  from: string, to: string, scopeIds?: string[] | null,
): Promise<{ money: MonthMoney | null; prov: Provenance }> {
  const d = await getMoneyDomains()
  const ours = (note: string | null): { money: null; prov: Provenance } =>
    ({ money: null, prov: { source: 'lighthouse', note, syncedAt: null, fields: [] } })

  if (!d.revenue) return ours(null)
  const month = wholeMonth(from, to)
  if (!month) return ours('Lighthouse figures — the Revenue App reports whole months only, and this window is ' + from + ' → ' + to)

  const his = await revenueAppUnitMonth(month)
  const all: RevUnitMonthRow[] = []
  for (const k of Object.keys(his.rows)) all.push(his.rows[k])
  if (!all.length) return ours('Lighthouse figures — the Revenue App has nothing for ' + month + ' yet')

  let rows = all
  if (scopeIds && scopeIds.length) {
    const want: Record<string, true> = {}
    for (const id of scopeIds) want[String(id)] = true
    rows = all.filter(r => want[String(r.guesty_listing_id)])
    // A scope he barely covers must not be answered from his data — a Miami board built from the
    // 3 Miami units he happens to carry is worse than our own complete number.
    const cover = scopeIds.length ? rows.length / scopeIds.length : 0
    if (cover < 0.9) {
      return ours('Lighthouse figures — the Revenue App covers ' + rows.length + ' of the ' + scopeIds.length + ' units in this view')
    }
  }

  const m = aggregateUnitRows(rows, month, his.kind, his.syncedAt)
  if (!m) return ours('Lighthouse figures — the Revenue App has nothing for ' + month + ' in this view')
  const st = staleness(m.syncedAt, d.maxStaleHours)
  if (st.stale) return ours('Lighthouse figures — the Revenue App mirror is ' + Math.round(st.ageH) + 'h old (limit ' + d.maxStaleHours + 'h)')

  return {
    money: m,
    prov: {
      source: 'revenue_app', syncedAt: m.syncedAt, fields: [],
      note: m.kind === 'live' ? 'Revenue App live view of ' + month + ' — the month is not closed yet' : null,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// EXPENSES — his QuickBooks lines. Nothing on our side computes these, so there is no fallback:
// either he has them or the surface says the number is not available yet.
// ---------------------------------------------------------------------------------------------

export type MonthExpenses = {
  month: string
  total: number
  byGroup: Record<string, number>        // '5100 Cleaning Costs', '5200 VR Expenses', …
  byAccount: Array<{ account: string; name: string | null; unit: string | null; amount: number; kind: string }>
  cleaningCost: number | null            // his 5100 group — CONTEXT beside Homebase, never instead of it
  payroll: number | null
  kind: string
  syncedAt: string | null
}

export async function monthExpenses(month: string): Promise<MonthExpenses | null> {
  const d = await getMoneyDomains()
  if (!d.expenses) return null
  const db = supabaseAdmin()
  const { data, error } = await db.from('rev_pnl_line').select('*').eq('month', month).limit(2000)
  if (error || !data || !data.length) return null

  // Prefer closed actuals; fall back to his live estimate for an open month.
  const actual = data.filter((r: any) => r.kind === 'actual')
  const rows = actual.length ? actual : data.filter((r: any) => r.kind === 'live')
  if (!rows.length) return null

  const byGroup: Record<string, number> = {}
  let total = 0, cleaning = 0, payroll = 0, syncedAt: string | null = null
  const byAccount: MonthExpenses['byAccount'] = []
  for (const r of rows as any[]) {
    const amt = n(r.amount) || 0
    const acct = String(r.account || '')
    // Roll-up rows ('total:5100') would double-count against their own children.
    if (/^total:/i.test(acct)) continue
    // Income accounts (4xxx) are revenue, not expense.
    if (/^4/.test(acct)) continue
    // Owner pass-through is owner money in and straight back out — never Stay's cost.
    if (/^5150/.test(acct) || /owner/i.test(String(r.unit || ''))) continue
    total += amt
    const grp = acct.slice(0, 2) + '00'
    byGroup[grp] = (byGroup[grp] || 0) + amt
    if (/^51/.test(acct)) cleaning += amt
    if (/wage|payroll|labor|labour|taxes/i.test(String(r.account_name || ''))) payroll += amt
    byAccount.push({ account: acct, name: r.account_name || null, unit: r.unit || null, amount: amt, kind: String(r.kind || '') })
    if (!syncedAt || String(r.synced_at) > syncedAt) syncedAt = String(r.synced_at)
  }
  byAccount.sort((a, b) => b.amount - a.amount)
  return {
    month, total: Math.round(total), byGroup, byAccount,
    cleaningCost: cleaning ? Math.round(cleaning) : null,
    payroll: payroll ? Math.round(payroll) : null,
    kind: actual.length ? 'actual' : 'live', syncedAt,
  }
}

// ---------------------------------------------------------------------------------------------
// BUDGET + PROJECTIONS
// ---------------------------------------------------------------------------------------------

export type MonthBudget = {
  month: string; scope: string; version: string
  netAccom: number | null; mgmtFee: number | null; netCleaning: number | null
  otherRevenue: number | null; total: number | null; occupancy: number | null; adr: number | null
  syncedAt: string | null
}

export async function monthBudget(month: string, scope = 'portfolio'): Promise<MonthBudget | null> {
  const d = await getMoneyDomains()
  if (!d.budget) return null
  const db = supabaseAdmin()
  const { data, error } = await db.from('rev_budget_month').select('*').eq('month', month).eq('scope', scope).limit(20)
  if (error || !data || !data.length) return null
  // Newest sync wins when he keeps more than one version of a month.
  const r: any = data.slice().sort((a: any, b: any) => String(b.synced_at).localeCompare(String(a.synced_at)))[0]
  return {
    month, scope, version: String(r.version || 'current'),
    netAccom: n(r.net_accom), mgmtFee: n(r.mgmt_fee), netCleaning: n(r.net_cleaning),
    otherRevenue: n(r.other_revenue), total: n(r.total), occupancy: n(r.occupancy), adr: n(r.adr),
    syncedAt: r.synced_at || null,
  }
}

export type MonthProjection = {
  month: string; scenario: string; asOf: string | null
  netAccom: number | null; netCleaning: number | null; total: number | null
  occupancy: number | null; adr: number | null; mgmtFee: number | null
  syncedAt: string | null
}

/** His month-end forecast — newest `as_of` for the scenario, portfolio scope by default. */
export async function monthProjection(month: string, scenario = 'base', scope = 'portfolio'): Promise<MonthProjection | null> {
  const d = await getMoneyDomains()
  if (!d.projections) return null
  const db = supabaseAdmin()
  const { data, error } = await db.from('rev_projection').select('*')
    .eq('month', month).eq('scenario', scenario).eq('scope', scope)
    .order('as_of', { ascending: false }).limit(1)
  if (error || !data || !data.length) return null
  const r: any = data[0]
  return {
    month, scenario, asOf: r.as_of || null,
    netAccom: n(r.net_accom), netCleaning: n(r.net_cleaning), total: n(r.total),
    occupancy: n(r.occupancy), adr: n(r.adr), mgmtFee: n(r.mgmt_fee), syncedAt: r.synced_at || null,
  }
}

// ---------------------------------------------------------------------------------------------
// THE KPI OVERRIDE — one function, so every surface that reads buildKpi() changes together.
// ---------------------------------------------------------------------------------------------

type Kpi = any

/**
 * Swap the money figures in a buildKpi() result for the Revenue App's, when the revenue domain is
 * on and it has the month. Ops volumes, labour and Breezeway work are untouched by design.
 *
 * Called for BOTH windows (current and prior) so "vs prior" compares like with like — a headline
 * that mixed his month against our month would invent a change that never happened.
 */
export async function applyMoneyOverride(
  kpi: Kpi, from: string, to: string, prevFrom?: string, prevTo?: string, scopeIds?: string[] | null,
): Promise<Kpi> {
  if (!kpi || typeof kpi !== 'object') return kpi
  const cur = await resolveRevenue(from, to, scopeIds)
  const prov: Provenance & { domains?: MoneyDomains } = { ...cur.prov }
  const domains = await getMoneyDomains()

  // Expenses / budget / projections ride along even when revenue stays ours — they are separate
  // switches and separate questions. They are PORTFOLIO figures, so a scoped board does not get
  // them: a Miami view must never show the whole company's QuickBooks total.
  const scoped = !!(scopeIds && scopeIds.length)
  const month = scoped ? null : wholeMonth(from, to)
  if (month) {
    const [exp, bud, proj] = await Promise.all([monthExpenses(month), monthBudget(month), monthProjection(month)])
    if (exp) kpi.expenses = { source: 'revenue_app', month, total: exp.total, byGroup: exp.byGroup, cleaningCost: exp.cleaningCost, payroll: exp.payroll, kind: exp.kind, syncedAt: exp.syncedAt }
    if (bud) kpi.budget = { source: 'revenue_app', ...bud }
    if (proj) kpi.projection = { source: 'revenue_app', ...proj }
  }

  if (!cur.money) {
    kpi.moneySource = { ...prov, domains }
    return kpi
  }

  const m = cur.money
  const fields: string[] = []
  const rev = kpi.revenue && typeof kpi.revenue === 'object' ? kpi.revenue : (kpi.revenue = {})
  const ours = { total: rev.total, adr: rev.adr, revpar: rev.revpar, occupancy: rev.occupancy, nights: rev.nights }

  const set = (obj: any, key: string, val: number | null, label: string) => {
    if (val == null) return
    obj[key] = val
    fields.push(label)
  }
  set(rev, 'total', m.total, 'revenue.total')
  set(rev, 'adr', m.adr, 'revenue.adr')
  set(rev, 'adrRoomOnly', m.adrRoomOnly, 'revenue.adrRoomOnly')
  set(rev, 'revpar', m.revpar, 'revenue.revpar')
  set(rev, 'occupancy', m.occupancy, 'revenue.occupancy')
  if (m.nights) { rev.nights = m.nights; fields.push('revenue.nights') }
  if (m.available) { rev.available = m.available; fields.push('revenue.available') }
  rev.netAccom = m.netAccom
  rev.grossAccom = m.grossAccom
  rev.mgmtFee = m.mgmtFee
  rev.lighthouseWas = ours          // keep ours visible so the reconcile is one click, not a re-run

  // CLEANING: the REVENUE line is his; turns, cost and minutes stay ours (Homebase + departure
  // cleans is the labour rule and it does not bend for this). The margin is therefore a MIX and is
  // labelled as one rather than quietly presented as a single source's number.
  const cl = kpi.cleaning && typeof kpi.cleaning === 'object' ? kpi.cleaning : null
  if (cl && m.cleaningNet != null) {
    cl.revenue = m.cleaningNet
    cl.revenueGross = m.cleaningGross != null ? m.cleaningGross : m.cleaningNet
    fields.push('cleaning.revenue')
    if (cl.costKnown && typeof cl.cost === 'number') {
      cl.margin = Math.round(m.cleaningNet - cl.cost)
      cl.marginPct = m.cleaningNet ? Math.round((cl.margin / m.cleaningNet) * 1000) / 10 : null
      cl.marginNote = 'revenue from the Revenue App, cost from Breezeway/Homebase — a deliberate mix'
      fields.push('cleaning.margin')
    }
    if (typeof cl.turnsInHouse === 'number' && cl.turnsInHouse > 0) {
      cl.feePerTurn = Math.round(m.cleaningNet / cl.turnsInHouse)
    }
  }

  // Prior window, so the deltas stay honest.
  if (prevFrom && prevTo) {
    const prev = await resolveRevenue(prevFrom, prevTo)
    if (prev.money) {
      const p = prev.money
      const pc = (now: any, was: any) => (typeof now === 'number' && typeof was === 'number' && was) ? Math.round(((now - was) / Math.abs(was)) * 1000) / 10 : null
      if (p.total != null) { rev.totalPrev = p.total; rev.totalChange = pc(rev.total, p.total) }
      if (p.adr != null) { rev.adrPrev = p.adr; rev.adrChange = pc(rev.adr, p.adr) }
      if (p.revpar != null) { rev.revparPrev = p.revpar; rev.revparChange = pc(rev.revpar, p.revpar) }
      if (p.occupancy != null) { rev.occupancyPrev = p.occupancy; rev.occupancyChange = Math.round(((rev.occupancy || 0) - p.occupancy) * 10) / 10 }
      if (cl && p.cleaningNet != null) { cl.revenuePrev = p.cleaningNet; cl.revenueChange = pc(cl.revenue, p.cleaningNet) }
      fields.push('prior-window')
    } else {
      // His month, our prior month — that comparison is meaningless, so refuse to draw it.
      rev.totalChange = null; rev.adrChange = null; rev.revparChange = null; rev.occupancyChange = null
      rev.changeNote = 'no comparison — the Revenue App does not cover the prior window'
    }
  }

  kpi.moneySource = {
    source: 'revenue_app', syncedAt: m.syncedAt, note: prov.note, fields, domains,
    month: m.month, kind: m.kind, units: m.units,
  }
  return kpi
}

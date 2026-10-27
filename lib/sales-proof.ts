// WHAT PROPERTIES LIKE YOURS EARN — the maths behind the sales deck's proof slide.
//
// Lifted out of /api/reports/proof so the generator can fill the slide at the moment a deck is
// made: a proposal for a building we already run should arrive carrying that building's real
// numbers, not an empty table and an instruction to go and press a button.
//
// REVENUE ONLY, AND THAT IS STRUCTURAL. This reads the reservation mirror and nothing else, so
// there is no commission, labour or owner-ledger figure in reach of it. The owner statement would
// have been the wrong source for exactly that reason: its shape is income minus the expenses we
// have no business showing someone who is not that owner. Gross and net come from basisTriple()
// on the same raw components every owner report carries, so a prospect who later becomes an owner
// cannot find a different number for the same unit on their own report.
import { pullReservations, metricsFor, fmtK } from './owner-report'
import { basisTriple } from './basis'
import { rollupBuilding } from './optimize-score'
import { supabaseAdmin } from './supabase-admin'

export type ProofRow = { label: string; sub: string; gross: string; net: string; occ: string; adr: string; nights: string }
export type ProofTotals = { gross: string; net: string; occ: string; adr: string; nights: string }

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
export function monthLabel(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The active, non-combined listings of a building or an explicit set. */
export async function proofListings(opts: { listingIds?: string[]; building?: string }) {
  const db = supabaseAdmin()
  const ids = (opts.listingIds || []).map(String).filter(Boolean)
  const wantB = str(opts.building).toLowerCase()
  const { data } = await db.from('guesty_listings')
    .select('id, title, nickname, building, unit, bedrooms, status').limit(1000)
  return ((data || []) as any[]).filter(l => {
    const st = str(l.status).toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) return false
    // A combined "Full" listing is the same apartment sold a second way; counting it beside its
    // halves would double a building's revenue on the one slide meant to prove we can be trusted
    // with numbers.
    if (/\bfull\b/i.test(str(l.nickname || l.title || l.id))) return false
    if (ids.length) return ids.indexOf(String(l.id)) >= 0
    if (wantB) return rollupBuilding(str(l.building)).toLowerCase() === wantB
    return false
  })
}

export async function proofRows(listings: any[], from: string, to: string): Promise<{ rows: ProofRow[]; totals: ProofTotals }> {
  const toExcl = nextDay(to)
  const useIds = listings.map(l => String(l.id))
  const resv = await pullReservations(useIds, from, toExcl)
  const byId: Record<string, any[]> = {}
  for (const r of resv) { (byId[r.listing_id] = byId[r.listing_id] || []).push(r) }
  const pct = (n: number) => Math.round(n) + '%'
  const rows = listings.map(l => {
    const m = metricsFor(byId[String(l.id)] || [], 1, from, toExcl)
    const raw = {
      accomNum: m.accomRevenue, accomGrossNum: m.accomGrossRevenue, cleaningNum: m.cleaningRevenue,
      feeNum: m.channelFees, occNights: m.occupiedNights, availNights: m.availableNights,
    }
    const g = basisTriple(raw, 'gross'), n = basisTriple(raw, 'net')
    const br = l.bedrooms == null ? '' : (Number(l.bedrooms) === 0 ? 'Studio' : Number(l.bedrooms) + 'BR')
    const unit = str(l.unit)
    return {
      label: [br, unit ? 'Unit ' + unit : ''].filter(Boolean).join(' \u00b7 ') || str(l.nickname || l.title),
      sub: rollupBuilding(str(l.building)),
      gross: fmtK(g.revenue), net: fmtK(n.revenue),
      occ: pct(m.occupancyPct), adr: '$' + g.adr, nights: String(m.occupiedNights),
      _gross: g.revenue, _net: n.revenue, _occNights: m.occupiedNights, _availNights: m.availableNights,
    }
  }).sort((a, b) => b._gross - a._gross)
  const sum = (k: '_gross' | '_net' | '_occNights' | '_availNights') => rows.reduce((a, r) => a + r[k], 0)
  const nights = sum('_occNights')
  const totals: ProofTotals = {
    gross: fmtK(sum('_gross')), net: fmtK(sum('_net')),
    occ: sum('_availNights') ? pct((sum('_occNights') / sum('_availNights')) * 100) : '\u2014',
    adr: nights ? '$' + Math.round(sum('_gross') / nights) : '\u2014',
    nights: String(nights),
  }
  return { rows: rows.map(({ _gross, _net, _occNights, _availNights, ...r }) => r), totals }
}

// ── REAL OWNER REVENUE, OFF THE COMPLETED STATEMENTS ────────────────────────
// Jon, 2026-10-27: "you should be able to pull real data from real owner revenue... select it by
// owner, by property, or by listing. It should scan the actual completed owner statements for a
// time period... pull just that owner revenue data for that particular listing. It should only
// pull gross owner revenue before our management fee and then post-management-fee in-pocket
// revenue, but should not include expenses."
//
// TWO FIGURES, AND ONLY TWO.
//   gross    the rental revenue recognised to the owner, before our commission
//   pocket   that, less our management commission, and nothing else
//
// `pocket` is deliberately NOT the statement's own net. Net is rental − commission + other, and
// `other` is where the expenses live: supplies, labour, repairs, the things one owner spent that
// are nobody else's business. Taking rental and commission and stopping there is what makes this
// publishable to a stranger at all.
//
// COMPLETED MONTHS ONLY. The months come from guesty_owner_statements rows that exist for these
// owners inside the window — a statement that has been issued. A part-month nobody has closed
// would read as a collapse in revenue on a slide whose whole job is to be trusted.
import { ownerMonths, statementDetail } from './owner-statements'

export type OwnerRow = { label: string; sub: string; gross: string; net: string; occ: string; adr: string; nights: string }

/** Owners who hold any of these listings, for a scope given as a building or a set of listings. */
export async function ownersForListings(listingIds: string[]): Promise<string[]> {
  if (!listingIds.length) return []
  const db = supabaseAdmin()
  const { data } = await db.from('guesty_owners').select('id, listing_ids').limit(500)
  const want = new Set(listingIds.map(String))
  return ((data || []) as any[])
    .filter(o => (Array.isArray(o.listing_ids) ? o.listing_ids : []).some((x: any) => want.has(String(x))))
    .map(o => String(o.id))
}

/** The statement months actually issued for these owners inside the window. */
export async function completedMonths(ownerIds: string[], fromMonth: string, toMonth: string): Promise<string[]> {
  if (!ownerIds.length) return []
  const db = supabaseAdmin()
  const { data } = await db.from('guesty_owner_statements')
    .select('period_month').in('owner_id', ownerIds).limit(2000)
  const months = Array.from(new Set(((data || []) as any[])
    .map(r => String(r.period_month || '').slice(0, 7)).filter(Boolean)))
    .filter(m => m >= fromMonth && m <= toMonth)
  return months.sort()
}

/**
 * Per-listing owner revenue across those months. `only` narrows to a set of listings; a portfolio
 * line that no unit carries is dropped rather than shown as a mystery row on a sales slide.
 */
export async function ownerRevenueRows(
  ownerIds: string[], months: string[], only?: string[],
): Promise<{ rows: OwnerRow[]; totals: ProofTotals; months: string[]; unattributed?: number; feePct?: number }> {
  if (!ownerIds.length || !months.length) return { rows: [], totals: { gross: '', net: '', occ: '', adr: '', nights: '' }, months: [] }
  const detail = await statementDetail({ ownerIds, months })
  const want = only && only.length ? new Set(only.map(String)) : null
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings')
    .select('id, title, nickname, building, unit, bedrooms').limit(1000)
  const byId: Record<string, any> = {}
  for (const l of ((ls || []) as any[])) byId[String(l.id)] = l

  const units = (detail.units || [])
    .filter(u => !u.portfolio)
    .filter(u => !want || want.has(String(u.listingId)))
    // A unit the owner held for part of the window with nothing recognised is not a data point.
    .filter(u => Number(u.rental) > 0)

  // COMMISSION BOOKED ABOVE THE UNIT STILL CAME OUT OF THE OWNER'S POCKET (2026-10-27).
  //
  // The first live pull of 17WEST read $1.83M of owner revenue against $1.65M after our fee — an
  // effective 9.8% on a 20% agreement. The gap is commission the ledger books without a listing
  // id, which lands on the portfolio line that this table deliberately drops. Dropping the line
  // is right; dropping the cost with it is not, and it would have printed an in-pocket figure
  // roughly a tenth too high on a slide whose entire job is to be trusted with numbers.
  //
  // So the owner-level commission for the same months is the control total, and anything the unit
  // rows do not account for is spread across them in proportion to rental — the same basis the
  // fee is charged on. `unattributed` says how much had to be allocated, so a reader of this data
  // can see it was.
  const owners = await ownerMonths({ ownerIds, months })
  const scoped = want ? null : owners
  const ctlRental = (scoped || owners).reduce((a, r) => a + (Number(r.rental) || 0), 0)
  const ctlCommission = (scoped || owners).reduce((a, r) => a + (Number(r.commission) || 0), 0)
  const unitRental = units.reduce((a, u) => a + (Number(u.rental) || 0), 0)
  const unitCommission = units.reduce((a, u) => a + (Number(u.commission) || 0), 0)
  // Only when the scope is the whole owner-month set can the control total be compared directly;
  // a listing-scoped pull is a subset and its share of the control is its share of rental.
  const expected = want && ctlRental > 0
    ? (unitRental / ctlRental) * ctlCommission
    : ctlCommission
  const missing = Math.max(0, expected - unitCommission)
  const spread = (rental: number) => (unitRental > 0 ? (rental / unitRental) * missing : 0)

  const rows = units.map(u => {
    const l = byId[String(u.listingId)] || {}
    const br = l.bedrooms == null ? '' : (Number(l.bedrooms) === 0 ? 'Studio' : Number(l.bedrooms) + 'BR')
    const unit = str(l.unit)
    const gross = Number(u.rental) || 0
    const pocket = gross - (Number(u.commission) || 0) - spread(gross)
    const nights = Number(u.nights) || 0
    return {
      label: [br, unit ? 'Unit ' + unit : ''].filter(Boolean).join(' · ') || str(l.nickname || l.title || u.name || u.listingId),
      sub: l.building ? rollupBuilding(str(l.building)) : '',
      gross: fmtK(gross),
      net: fmtK(pocket),
      // Occupancy needs an availability denominator the ledger does not carry; nights and the
      // rate they earned are what a statement can honestly say.
      occ: '—',
      adr: nights ? '$' + Math.round(gross / nights) : '—',
      nights: nights ? String(nights) : '—',
      _g: gross, _p: pocket, _n: nights,
    }
  }).sort((a, b) => b._g - a._g)

  const sum = (k: '_g' | '_p' | '_n') => rows.reduce((a, r) => a + r[k], 0)
  const nights = sum('_n')
  return {
    unattributed: Math.round(missing),
    feePct: sum('_g') > 0 ? Math.round(((sum('_g') - sum('_p')) / sum('_g')) * 1000) / 10 : 0,
    rows: rows.map(({ _g, _p, _n, ...r }) => r),
    totals: {
      gross: fmtK(sum('_g')), net: fmtK(sum('_p')), occ: '—',
      adr: nights ? '$' + Math.round(sum('_g') / nights) : '—',
      nights: nights ? String(nights) : '—',
    },
    months,
  }
}

/** Owner-level totals, for a deck pitched at a developer who thinks in portfolios, not units. */
export async function ownerRevenueByOwner(ownerIds: string[], months: string[]) {
  const all = await ownerMonths({ ownerIds, months })
  const byOwner: Record<string, { name: string; gross: number; pocket: number }> = {}
  for (const r of all) {
    const o = byOwner[r.ownerId] || (byOwner[r.ownerId] = { name: r.ownerName, gross: 0, pocket: 0 })
    o.gross += Number(r.rental) || 0
    o.pocket += (Number(r.rental) || 0) - (Number(r.commission) || 0)
  }
  return Object.values(byOwner).sort((a, b) => b.gross - a.gross)
}

// ── THE FEE IS PER BUILDING, NOT ONE HOUSE NUMBER ───────────────────────────
// Jon, 2026-10-27, asked which was right when 17WEST's completed statements showed an effective
// 10.1% against the 20% the house template prints: "17WEST is ~10%."
//
// So the terms slide can no longer read one number off the template and call it the fee. This
// measures what the ledger actually charged — commission over rental, across the completed
// statement months — for whatever listings a document is scoped to, and returns null rather than
// a guess when there is nothing to measure. A proposal that prints a fee the owner's own
// statements will contradict is worse than one that prints no fee at all.
export async function effectiveFee(listingIds: string[], months: string[]): Promise<{ pct: number; months: number; rental: number } | null> {
  if (!listingIds.length || !months.length) return null
  const owners = await ownersForListings(listingIds)
  if (!owners.length) return null
  const detail = await statementDetail({ ownerIds: owners, months })
  const want = new Set(listingIds.map(String))
  let rental = 0, commission = 0
  for (const u of (detail.units || [])) {
    if (u.portfolio || !want.has(String(u.listingId))) continue
    rental += Number(u.rental) || 0
    commission += Number(u.commission) || 0
  }
  // Commission the ledger books above the unit belongs to these units too — same control total as
  // ownerRevenueRows, and for the same reason.
  const all = await ownerMonths({ ownerIds: owners, months })
  const ctlRental = all.reduce((a, r) => a + (Number(r.rental) || 0), 0)
  const ctlCommission = all.reduce((a, r) => a + (Number(r.commission) || 0), 0)
  if (ctlRental > 0) {
    const expected = (rental / ctlRental) * ctlCommission
    if (expected > commission) commission = expected
  }
  if (rental <= 0) return null
  return { pct: Math.round((commission / rental) * 1000) / 10, months: months.length, rental: Math.round(rental) }
}

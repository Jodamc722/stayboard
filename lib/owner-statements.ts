// Read layer over the owner-statement mirror. Everything an owner report says about money
// actually collected comes through here.
//
// The accounting rules are the ones the account-wide audit proved (see
// /api/guesty/statement-audit-all). Owner-ledger amounts are signed from the PM's side, so a
// credit to the owner is negative; they are flipped on the way in so every figure below reads
// as owner revenue:
//
//   AF  -> rental      net rental nightly income, i.e. owner earnings BEFORE expenses
//   CMS -> commission  Stay's PM commission
//   PO  -> paid        the actual payout. A SETTLEMENT movement, never counted as earnings.
//   *   -> other       owner charges / channel-fee reimbursements
//   net = rental - commission - other  (computed by the same running sum as the audit)
//
// One exception to the AF/CMS split, and it matters: see the PASS-THROUGH block below. A
// reservation whose CMS total is ~100% of its AF total is a wash, not revenue with a fee on
// it, and counting it as both overstated the rental and commission lines while leaving net
// correct.
//
// Two findings from that audit are baked in and must not be undone:
//   1. `dueToOwner` on a statement is a settlement BALANCE, not earnings. Of 59 owner-months
//      that failed to tie on dueToOwner, 40 tie exactly against the PO total. So `net` is the
//      figure to present and `paid` is its cross-check.
//   2. Owner-months with real earnings but no matching statement ("orphans") are material —
//      $548K over the audited span. Any account- or scope-wide total MUST include them, so
//      aggregation here starts from the ledger and treats statements as annotation.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

const money = (n: number) => Math.round(n * 100) / 100

export type OwnerMonth = {
  key: string            // ownerId|yyyy-MM
  ownerId: string
  ownerName: string
  month: string          // yyyy-MM
  rental: number         // owner earnings before expenses
  commission: number     // Stay's PM commission
  other: number          // owner charges / channel-fee reimbursements
  net: number            // what the owner earned after commission and charges
  paid: number           // PO total — what actually moved to the owner
  rows: number
  statementId: string | null
  dueToOwner: number | null
  hasStatement: boolean
  ties: boolean          // net matches the statement, on dueToOwner or on payout
}

export type StatementPick = {
  id: string
  ownerId: string
  ownerName: string
  month: string
  label: string          // "June 2026 · Bay Ridge Holdings"
  periodStart: string
  periodEnd: string
  dueToOwner: number
  net: number | null     // recognised net from the mirror, null if the month isn't synced
  paid: number | null
}

type LedgerRow = {
  owner_id: string | null
  listing_id: string | null
  entry_month: string | null
  charge_code: string | null
  amount: number | null
  res?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS-THROUGH RESERVATIONS
//
// Guesty books some reservations as a matched pair on the same date, with
// consecutive ledger ids: an AF "Net Rental Nightly Income" line, and a CMS
// line ("Commission" by name, "Management fee" by description) of the same
// amount with the opposite sign. The fee is 100% of the rental and the owner
// nets zero. On 906/3 - Studio, reservation HMT8QTKCS4 is $6,887.76 of rental
// against $6,887.76 of commission — 70 mirrored row pairs plus 172 adjustment
// pairs that offset the same way.
//
// Because the two legs cancel, every statement still tied to Guesty's own
// dueToOwner to the penny (906's owner: 0.00 delta in Dec, Jan and Feb) while
// the rental and commission LINES were both overstated by the same amount.
// That is what produced the $8,869 commission on a studio: not a Guesty error,
// a parsing error here.
//
// Measured on the whole account:
//   906/3 - Studio      42.75% -> 15.00% exactly
//   units over 21%      11     -> 0
//   of those 11, 10 land on exactly 15.0%; the eleventh on its own 7.9% rate
//
// The rows are NOT dropped. They are routed to `other`, where the two legs
// cancel, so net is bit-for-bit unchanged and rental - commission + other
// still holds by construction. Only the rental, commission and nights figures
// change, and they change to the truth.
// ─────────────────────────────────────────────────────────────────────────────

const PASSTHRU_LO = 0.9        // CMS/AF at or above this is a fee, not a commission
const PASSTHRU_HI = 1.1        // guard against anything stranger than a clean wash
const PASSTHRU_FLOOR = 1       // ignore rounding-scale reservations
export const PASSTHRU_LABEL = 'Pass-through reservations (rental fully offset by fee)'

type PairRow = { listing_id?: string | null; charge_code: string | null; amount: number | null; res?: string | null }

const pairKey = (r: PairRow) => String(r.listing_id || '') + '|' + String(r.res || '')

/**
 * The set of listing|reservation keys whose CMS total is ~100% of its AF total.
 * Reservation-level, deliberately: matching individual rows on equal absolute
 * amounts over-matches badly (it drags the account rate down to 8.96%, well
 * under every contract rate) because it also cancels legitimate commission
 * that happens to tie to a nightly figure. At reservation grain the separation
 * is clean — 188 reservations across the account, and each flagged unit lands
 * back on its own contract rate.
 */
function passthruKeys(rows: PairRow[]): Set<string> {
  const acc: Record<string, { rental: number; cms: number }> = {}
  for (const r of rows) {
    if (!String(r.res || '')) continue      // an unlinked line can never be paired
    const code = String(r.charge_code || '')
    if (code !== 'AF' && code !== 'CMS') continue
    const a = acc[pairKey(r)] || (acc[pairKey(r)] = { rental: 0, cms: 0 })
    const amt = Number(r.amount) || 0
    if (code === 'AF') a.rental -= amt
    else a.cms += amt
  }
  const out = new Set<string>()
  for (const k of Object.keys(acc)) {
    const a = acc[k]
    if (a.rental <= PASSTHRU_FLOOR) continue
    const ratio = a.cms / a.rental
    if (ratio >= PASSTHRU_LO && ratio <= PASSTHRU_HI) out.add(k)
  }
  return out
}

/** Running-sum accumulator, identical in behaviour to the audit's addTo(). */
function accumulate(m: OwnerMonth, chargeCode: string, amount: number, passthru = false) {
  m.rows++
  if (chargeCode === 'PO') { m.paid = money(m.paid + amount); return }
  // A pass-through leg falls through to `other`, where its partner cancels it.
  const code = passthru && (chargeCode === 'AF' || chargeCode === 'CMS') ? '' : chargeCode
  if (code === 'AF') m.rental = money(m.rental - amount)
  else if (code === 'CMS') m.commission = money(m.commission + amount)
  else m.other = money(m.other - amount)
  m.net = money(m.net - amount)
}

const blank = (ownerId: string, month: string): OwnerMonth => ({
  key: ownerId + '|' + month, ownerId, ownerName: '', month,
  rental: 0, commission: 0, other: 0, net: 0, paid: 0, rows: 0,
  statementId: null, dueToOwner: null, hasStatement: false, ties: false,
})

/** Every owner whose listings intersect the scope. */
export async function ownersForListings(listingIds: string[]): Promise<Array<{ id: string; name: string; listingIds: string[] }>> {
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('guesty_owners').select('id, full_name, listing_ids')
  // Never swallow this. A missing table or an RLS block would otherwise read as "this scope has
  // no owners", which is indistinguishable from a real empty result and would quietly zero a
  // report that is going in front of an owner.
  if (error) throw new Error('owners read: ' + error.message)
  const want = new Set(listingIds.map(String))
  return ((data || []) as any[])
    .map(o => ({
      id: String(o.id),
      name: String(o.full_name || '(unnamed)'),
      listingIds: ((o.listing_ids || []) as any[]).map(String) as string[],
    }))
    .filter(o => !want.size || o.listingIds.some((l: string) => want.has(l)))
}

const MONTH_LABEL = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  if (!y || !mo) return m
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The picker feed: statements available for a scope, newest first, each already carrying the
 * recognised figures so the UI can show what it is about to pull in. Scope is resolved through
 * the owners that hold the listings; pass an empty array for every owner on the account.
 */
export async function listStatements(listingIds: string[], limit = 60): Promise<StatementPick[]> {
  const sb = supabaseAdmin()
  const owners = await ownersForListings(listingIds)
  const ownerIds = owners.map(o => o.id)
  if (!ownerIds.length) return []
  const nameOf: Record<string, string> = {}
  for (const o of owners) nameOf[o.id] = o.name

  let q = sb.from('guesty_owner_statements')
    .select('id, owner_id, owner_name, period_start, period_end, period_month, due_to_owner')
    .in('owner_id', ownerIds)
    .order('period_start', { ascending: false })
    .limit(limit)
  const { data, error } = await q
  if (error) throw new Error('statements read: ' + error.message)
  const stmts = (data || []) as any[]
  if (!stmts.length) return []

  const months = Array.from(new Set(stmts.map(s => String(s.period_month || '')).filter(Boolean)))
  const agg = await ownerMonths({ ownerIds, months })
  const byKey: Record<string, OwnerMonth> = {}
  for (const a of agg) byKey[a.key] = a

  return stmts.map(s => {
    const month = String(s.period_month || '')
    const ownerId = String(s.owner_id || '')
    const a = byKey[ownerId + '|' + month]
    const name = String(s.owner_name || nameOf[ownerId] || '(unnamed)')
    return {
      id: String(s.id),
      ownerId,
      ownerName: name,
      month,
      label: MONTH_LABEL(month) + ' · ' + name,
      periodStart: String(s.period_start || ''),
      periodEnd: String(s.period_end || ''),
      dueToOwner: Number(s.due_to_owner ?? 0) || 0,
      net: a ? a.net : null,
      paid: a ? a.paid : null,
    }
  })
}

// The reservation code lives only inside raw, as an object — raw->>'reservationConfirmationCode'
// hands back the whole JSON blob, so the scalar needs the ->'…'->>'title' path. There is no
// reservation_id column on the table to use instead.
const LEDGER_COLS = 'owner_id, listing_id, entry_month, charge_code, amount, res:raw->reservationConfirmationCode->>title'
const LEDGER_COLS_PLAIN = 'owner_id, listing_id, entry_month, charge_code, amount'

/**
 * Aggregate recognised ledger rows into owner-months. Filters are ANDed; every one is
 * optional. Orphan owner-months (earnings with no statement) come back too, flagged
 * hasStatement: false, because leaving them out understates the account.
 */
export async function ownerMonths(opts: {
  ownerIds?: string[]
  listingIds?: string[]
  months?: string[]
  from?: string          // yyyy-MM inclusive
  to?: string            // yyyy-MM inclusive
}): Promise<OwnerMonth[]> {
  const sb = supabaseAdmin()
  const rows: LedgerRow[] = []
  const PAGE = 1000
  // Reservation code lives only inside raw — the table has no reservation_id column. If the
  // mirror ever refuses the accessor we fall back to a plain select and skip the pass-through
  // correction rather than losing the read: net is identical either way.
  let paired = true
  for (let off = 0; off < 200_000; off += PAGE) {
    const run = (cols: string) => {
      let q = sb.from('guesty_owner_ledger').select(cols)
        .eq('recognized', true)
        .range(off, off + PAGE - 1)
      if (opts.ownerIds?.length) q = q.in('owner_id', opts.ownerIds)
      if (opts.listingIds?.length) q = q.in('listing_id', opts.listingIds)
      if (opts.months?.length) q = q.in('entry_month', opts.months)
      if (opts.from) q = q.gte('entry_month', opts.from)
      if (opts.to) q = q.lte('entry_month', opts.to)
      return q
    }
    let { data, error } = await run(paired ? LEDGER_COLS : LEDGER_COLS_PLAIN)
    if (error && paired) {
      paired = false
      ;({ data, error } = await run(LEDGER_COLS_PLAIN))
    }
    if (error) throw new Error('ledger read: ' + error.message)
    const batch = (data || []) as unknown as LedgerRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }

  const pt = paired ? passthruKeys(rows) : new Set<string>()

  const agg: Record<string, OwnerMonth> = {}
  for (const r of rows) {
    const ownerId = String(r.owner_id || '')
    const month = String(r.entry_month || '')
    if (!ownerId || !month) continue          // rows with a listing but no owner link are
    const key = ownerId + '|' + month         // real but unattributable; excluded by design
    accumulate(
      agg[key] || (agg[key] = blank(ownerId, month)),
      String(r.charge_code || ''), Number(r.amount) || 0, pt.has(pairKey(r)),
    )
  }
  const out = Object.values(agg)
  if (!out.length) return out

  // Names + statement annotation.
  const ownerIds = Array.from(new Set(out.map(o => o.ownerId)))
  const months = Array.from(new Set(out.map(o => o.month)))
  const [{ data: owners }, { data: stmts }] = await Promise.all([
    sb.from('guesty_owners').select('id, full_name').in('id', ownerIds),
    sb.from('guesty_owner_statements').select('id, owner_id, owner_name, period_month, due_to_owner')
      .in('owner_id', ownerIds).in('period_month', months),
  ])
  const nameOf: Record<string, string> = {}
  for (const o of (owners || []) as any[]) nameOf[String(o.id)] = String(o.full_name || '')
  for (const s of (stmts || []) as any[]) {
    const k = String(s.owner_id) + '|' + String(s.period_month)
    const a = agg[k]
    if (!a) continue
    a.statementId = String(s.id)
    a.dueToOwner = Number(s.due_to_owner ?? 0) || 0
    a.hasStatement = true
    if (!a.ownerName) a.ownerName = String(s.owner_name || '')
    // Ties either against the printed balance or against what was actually paid out — the
    // audit showed 40 of 59 apparent failures were simply settled rather than carried.
    a.ties = Math.abs(a.net - (a.dueToOwner || 0)) < 0.02 || Math.abs(a.net - a.paid) < 0.02
  }
  for (const a of out) if (!a.ownerName) a.ownerName = nameOf[a.ownerId] || '(unnamed)'

  return out.sort((x, y) => (y.month + y.ownerName).localeCompare(x.month + x.ownerName))
}

export type StatementRollup = {
  months: Array<{ month: string; label: string; rental: number; commission: number; other: number; net: number; paid: number }>
  owners: Array<{ ownerId: string; ownerName: string; rental: number; commission: number; net: number; paid: number; months: number }>
  totals: {
    rental: number; commission: number; commissionPct: number; other: number
    net: number; paid: number; variance: number
    ownerMonths: number; statements: number; orphans: number; tied: number
  }
  span: { first: string; last: string } | null
}

/** Roll owner-months up into the shape the report section renders from. */
export function rollup(rowsIn: OwnerMonth[]): StatementRollup {
  const rows = rowsIn.slice().sort((a, b) => a.month.localeCompare(b.month))
  const byMonth: Record<string, any> = {}
  const byOwner: Record<string, any> = {}
  const t = { rental: 0, commission: 0, other: 0, net: 0, paid: 0 }

  for (const r of rows) {
    const m = byMonth[r.month] || (byMonth[r.month] = {
      month: r.month, label: MONTH_LABEL(r.month), rental: 0, commission: 0, other: 0, net: 0, paid: 0,
    })
    m.rental = money(m.rental + r.rental); m.commission = money(m.commission + r.commission)
    m.other = money(m.other + r.other); m.net = money(m.net + r.net); m.paid = money(m.paid + r.paid)

    const o = byOwner[r.ownerId] || (byOwner[r.ownerId] = {
      ownerId: r.ownerId, ownerName: r.ownerName, rental: 0, commission: 0, net: 0, paid: 0, months: 0,
    })
    o.rental = money(o.rental + r.rental); o.commission = money(o.commission + r.commission)
    o.net = money(o.net + r.net); o.paid = money(o.paid + r.paid); o.months++

    t.rental = money(t.rental + r.rental); t.commission = money(t.commission + r.commission)
    t.other = money(t.other + r.other); t.net = money(t.net + r.net); t.paid = money(t.paid + r.paid)
  }

  const months = Object.values(byMonth).sort((a: any, b: any) => a.month.localeCompare(b.month)) as any[]
  return {
    months,
    owners: (Object.values(byOwner) as any[]).sort((a, b) => b.net - a.net),
    totals: {
      ...t,
      commissionPct: t.rental ? Math.round((t.commission / t.rental) * 1000) / 10 : 0,
      // Payout minus earnings. Non-zero is normal within a month (settlement lags recognition);
      // it is only worth flagging when it is large relative to net.
      variance: money(t.paid - t.net),
      ownerMonths: rows.length,
      statements: rows.filter(r => r.hasStatement).length,
      orphans: rows.filter(r => !r.hasStatement).length,
      tied: rows.filter(r => r.ties).length,
    },
    span: months.length ? { first: months[0].month, last: months[months.length - 1].month } : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-unit and per-fee detail for the Owner Statement section.
//
// Jon's ask, verbatim: "I need to be able to select an individual report to review on the
// owner thing that shows the key things: Individual unit performance / Expenses / All the
// breakdown of fees / All of that stuff."
//
// Two things make this harder than a GROUP BY and both are handled explicitly rather than
// papered over:
//
//   1. NOT EVERY LINE BELONGS TO A UNIT. AF, CMS, AFE, CF and the blank code are 100%
//      listing-attributed, but 317 rows across the audited span are not — every OCR and FT
//      row, and 250 "Owner charge" rows under OC. Over Dec-2025..Jun-2026 that is $194,976.81
//      of movement. Spreading it across units would invent per-unit figures, and dropping it
//      would stop the column footing to net. It gets its own PORTFOLIO line instead, so the
//      unit column plus that line always equals net exactly.
//
//   2. CHARGE CODE IS NOT THE FEE. OC alone mixes "Owner charge" (-$270,189.30, a real owner
//      expense) with "Airbnb cleaning channel fee" (+$101,934.37, a reimbursement TO the
//      owner) and "Revenue Management Income". Grouping fees by charge_code would net those
//      against each other and show one meaningless number. The real breakdown is Guesty's own
//      line name, read from raw->>name, so the labels on the report are the labels on the
//      statement rather than anything invented here.
// ─────────────────────────────────────────────────────────────────────────────

export type UnitLine = {
  listingId: string
  name: string           // filled in by the caller from the listing mirror
  rental: number         // owner earnings before expenses
  commission: number     // Stay's PM commission
  other: number          // charges and credits; POSITIVE is a credit to the owner
  net: number            // rental - commission + other
  nights: number         // AF lines, a proxy for booked nights
  share: number          // percent of the scope's total net, 1dp
  portfolio?: boolean    // true on the single not-unit-attributed line
}

export type FeeLine = {
  label: string          // Guesty's own line name, or the charge code when names are absent
  code: string
  rows: number
  amount: number         // owner effect: POSITIVE is money to the owner, negative is a cost
  kind: 'rental' | 'commission' | 'charge' | 'credit'
}

export type StatementDetail = {
  units: UnitLine[]      // biggest net first; the portfolio line always sorts last
  fees: FeeLine[]        // biggest absolute owner effect first
  totals: { rental: number; commission: number; other: number; net: number; units: number }
  unattributed: number   // net sitting on the portfolio line
  named: boolean         // false when the mirror would not give us line names
  // Present when pass-through reservations were found and held out of rental/commission.
  // Optional so every existing caller keeps compiling and rendering unchanged.
  passthru?: { reservations: number; rental: number }
}

type DetailRow = {
  listing_id: string | null
  charge_code: string | null
  amount: number | null
  name?: string | null
  res?: string | null
}

const FEE_COLS = 'listing_id, charge_code, amount, raw->>name, res:raw->reservationConfirmationCode->>title'
const FEE_COLS_PLAIN = 'listing_id, charge_code, amount'

/**
 * Ledger lines for a set of owner-months, rolled up by unit and by fee.
 *
 * The name column is a PostgREST JSON accessor. If the mirror ever refuses it this falls back
 * to a plain select and groups fees by charge code — a coarser breakdown, but the unit numbers
 * and the totals are unaffected, and a report is never lost over a label.
 */
export async function statementDetail(opts: { ownerIds: string[]; months: string[] }): Promise<StatementDetail> {
  const sb = supabaseAdmin()
  if (!opts.ownerIds.length || !opts.months.length) {
    return { units: [], fees: [], totals: { rental: 0, commission: 0, other: 0, net: 0, units: 0 }, unattributed: 0, named: true }
  }

  let named = true
  const rows: DetailRow[] = []
  const PAGE = 1000
  for (let off = 0; off < 200_000; off += PAGE) {
    const run = (cols: string) => sb.from('guesty_owner_ledger').select(cols)
      .eq('recognized', true)
      .in('owner_id', opts.ownerIds)
      .in('entry_month', opts.months)
      .range(off, off + PAGE - 1)
    let { data, error } = await run(named ? FEE_COLS : FEE_COLS_PLAIN)
    if (error && named) {
      // Only ever downgrade once, and only for the name column.
      named = false
      ;({ data, error } = await run(FEE_COLS_PLAIN))
    }
    if (error) throw new Error('ledger detail read: ' + error.message)
    const batch = (data || []) as unknown as DetailRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }

  // Same reservation-level rule as ownerMonths, so the unit table and the month rollup can
  // never disagree about what counts as revenue.
  const pt = named ? passthruKeys(rows) : new Set<string>()
  const ptRes = new Set<string>()
  let ptRental = 0

  const PORTFOLIO = '__portfolio__'
  const byUnit: Record<string, UnitLine> = {}
  const byFee: Record<string, FeeLine> = {}
  const t = { rental: 0, commission: 0, other: 0, net: 0 }

  for (const r of rows) {
    const code = String(r.charge_code || '')
    const amt = Number(r.amount) || 0
    // PO is a settlement movement, never earnings. It is excluded here for the same reason
    // accumulate() returns early on it: counting a payout as a fee would double-count the month.
    if (code === 'PO') continue

    const id = String(r.listing_id || '') || PORTFOLIO
    const u = byUnit[id] || (byUnit[id] = {
      listingId: id, name: '', rental: 0, commission: 0, other: 0, net: 0, nights: 0, share: 0,
      portfolio: id === PORTFOLIO || undefined,
    })
    // A pass-through leg is neither rental nor commission. Both legs land in `other`, where
    // they cancel, so net is bit-for-bit what it was and rental - commission + other still
    // holds. Nights are not incremented either: a washed reservation earned no night.
    const isPt = (code === 'AF' || code === 'CMS') && pt.has(pairKey(r))
    if (isPt) {
      ptRes.add(pairKey(r))
      if (code === 'AF') ptRental = money(ptRental - amt)
    }

    if (!isPt && code === 'AF') { u.rental = money(u.rental - amt); u.nights++; t.rental = money(t.rental - amt) }
    else if (!isPt && code === 'CMS') { u.commission = money(u.commission + amt); t.commission = money(t.commission + amt) }
    else { u.other = money(u.other - amt); t.other = money(t.other - amt) }
    u.net = money(u.net - amt)
    t.net = money(t.net - amt)

    const label = isPt ? PASSTHRU_LABEL : named ? String(r.name || '').trim() : ''
    const feeCode = isPt ? 'PT' : code
    const key = (label || feeCode || '(no code)') + '|' + feeCode
    const f = byFee[key] || (byFee[key] = {
      label: label || feeCode || 'Unclassified', code: feeCode, rows: 0, amount: 0,
      kind: feeCode === 'AF' ? 'rental' : feeCode === 'CMS' ? 'commission' : 'charge',
    })
    f.rows++
    f.amount = money(f.amount - amt)
  }

  // Kind is decided on the TOTAL, not per row: a line that nets out as money arriving is a
  // credit even when individual entries swing both ways.
  for (const f of Object.values(byFee)) {
    if (f.code === 'PT') f.kind = 'charge'      // a wash: both legs are already inside it
    else if (f.code === 'AF') f.kind = 'rental'
    else if (f.code === 'CMS') f.kind = 'commission'
    else f.kind = f.amount >= 0 ? 'credit' : 'charge'
  }

  const units = Object.values(byUnit)
  for (const u of units) u.share = t.net ? Math.round((u.net / t.net) * 1000) / 10 : 0
  units.sort((a, b) => (a.portfolio ? 1 : 0) - (b.portfolio ? 1 : 0) || b.net - a.net)

  return {
    units,
    fees: Object.values(byFee).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    totals: { ...t, units: units.filter(u => !u.portfolio).length },
    unattributed: byUnit[PORTFOLIO] ? byUnit[PORTFOLIO].net : 0,
    named,
    passthru: ptRes.size ? { reservations: ptRes.size, rental: ptRental } : undefined,
  }
}

/** True when the mirror has ledger coverage for every month in the range. */
export async function coverageFor(months: string[]): Promise<{ ready: boolean; missing: string[] }> {
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('guesty_ledger_months').select('month, status').in('month', months)
  if (error) throw new Error('ledger months read: ' + error.message)
  const done = new Set(((data || []) as any[]).filter(r => r.status === 'done').map(r => String(r.month)))
  const missing = months.filter(m => !done.has(m))
  return { ready: missing.length === 0, missing }
}

export { MONTH_LABEL, money }

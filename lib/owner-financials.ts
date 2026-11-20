// OWNER FINANCIALS: A P&L FROM THE OWNER STATEMENTS (Jon, 2026-11-20: "a financials owner report … select the
// time period or all owner statements, and it generates a pro forma by listing, by property, by building, kind of
// like a year-end financials report, like a P&L … formatted as an Excel as well, also a way to show cleaning
// values and gross values … and net owner").
//
// THE SOURCE is the owner ledger Lighthouse mirrors from Guesty (guesty_owner_ledger): the recognized lines, the
// same ones the statements are made of and the same ones lib/owner-statements reads. Nothing here is estimated.
//
// THE LINES. Every ledger line lands on exactly one, so the column always foots to net:
//   REVENUE
//     Rental income              AF, the nightly net rental income
//     Cleaning fees              any line named for cleaning: the cleaning fee and its channel-fee reimbursements
//     Guest fees                 AFE: parking, pet, resort, late checkout, less guest refunds
//     Other income               revenue-management income and channel-fee reimbursements under OC
//   = GROSS REVENUE              what the units earned for the owner before Stay's commission and any charges
//   EXPENSES
//     Management commission      CMS
//     Owner charges              everything else charged to the owner (repairs, supplies, adjustments)
//   Pass-through reservations    a stay whose commission is 90 to 110% of its rental is a wash, not revenue with a
//                                fee on it (the rule proved in lib/owner-statements); both legs sit here, net of
//                                each other, so they inflate neither gross nor commission
//   = NET TO OWNER               gross − commission − charges + pass-through
//   Paid out                     PO, the payouts actually sent. A settlement, shown beside net, never inside it.
//
// SIGNS. The ledger is signed from Stay's side (a credit to the owner is negative). Revenue lines are flipped so
// income reads positive; expense lines read positive as a cost.
//
// A line with no unit on it (some owner charges, transfers) cannot be given to a listing or a building, so it is
// reported under its owner as "Not tied to a unit". Spreading it would invent per-unit numbers.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

const money = (n: number) => Math.round(n * 100) / 100
import { type FinCat, type FinVals, type FinRow, type FinDetail, type Financials } from './owner-financials-shared'
export { FIN_LINES } from './owner-financials-shared'
export type { FinCat, FinVals, FinRow, FinDetail, Financials } from './owner-financials-shared'
const zero = (): FinVals => ({ rental: 0, cleaning: 0, fees: 0, other: 0, commission: 0, charges: 0, passthru: 0, paid: 0, gross: 0, expenses: 0, net: 0 })

/** Which line a ledger entry belongs on. */
export function finCat(code: string, name: string, passthru: boolean): FinCat {
  if (code === 'PO') return 'paid'
  if (passthru && (code === 'AF' || code === 'CMS')) return 'passthru'
  if (code === 'AF') return 'rental'
  if (code === 'CMS') return 'commission'
  if (/clean/i.test(name)) return 'cleaning'
  if (code === 'AFE') return 'fees'
  if (/revenue management|channel fee|reimburs/i.test(name)) return 'other'
  return 'charges'
}
/** Add one ledger amount (Stay's sign) to a set of lines. */
function add(v: FinVals, cat: FinCat, amount: number) {
  if (cat === 'paid') v.paid += amount
  else if (cat === 'commission' || cat === 'charges') v[cat] += amount       // a cost, positive
  else v[cat] -= amount                                                       // income, flipped to positive
}
function finish(v: FinVals) {
  for (const k of ['rental', 'cleaning', 'fees', 'other', 'commission', 'charges', 'passthru', 'paid'] as const) v[k] = money(v[k])
  v.gross = money(v.rental + v.cleaning + v.fees + v.other)
  v.expenses = money(v.commission + v.charges)
  v.net = money(v.gross - v.expenses + v.passthru)
  return v
}
export const monthsBetween = (from: string, to: string) => { const out: string[] = []; const [y, m] = from.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1, 1)), end = new Date(to + '-01T00:00:00Z'); while (d <= end && out.length < 120) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1) } return out }

type LRow = { owner_id: string | null; listing_id: string | null; entry_month: string; charge_code: string | null; line_name: string | null; res_code: string | null; amount: number | null }
/** One month's recognized ledger lines, paged to the end. */
async function monthLines(month: string): Promise<LRow[]> {
  const sb = supabaseAdmin(), out: LRow[] = []
  for (let p = 0; p < 80; p++) {
    const { data, error } = await sb.from('guesty_owner_ledger').select('owner_id, listing_id, entry_month, charge_code, line_name, res_code, amount')
      .eq('entry_month', month).eq('recognized', true).order('id').range(p * 1000, p * 1000 + 999)
    if (error) throw new Error('ledger ' + month + ': ' + error.message)
    out.push(...((data || []) as LRow[]))
    if (!data || data.length < 1000) break
  }
  return out
}

const CACHE = new Map<string, { at: number; data: Financials }>()
/** The first and last month with statements on file: what "all owner statements" means. */
export async function statementSpan(): Promise<{ from: string; to: string; months: { m: string; statements: number }[] }> {
  const sb = supabaseAdmin()
  const { data } = await sb.from('guesty_owner_statements').select('period_month').not('period_month', 'is', null).order('period_month').limit(1000)
  const n: Record<string, number> = {}
  for (const r of (data || []) as any[]) n[r.period_month] = (n[r.period_month] || 0) + 1
  const months = Object.keys(n).sort().map(m => ({ m, statements: n[m] }))
  return { from: months[0]?.m || '', to: months[months.length - 1]?.m || '', months }
}

export async function buildFinancials(fromIn: string, toIn: string): Promise<Financials> {
  const ok = (m: string) => /^\d{4}-\d{2}$/.test(m)
  let from = fromIn, to = toIn
  if (!ok(from) || !ok(to)) { const s = await statementSpan(); from = ok(from) ? from : s.from; to = ok(to) ? to : s.to }
  if (!ok(from) || !ok(to)) throw new Error('No owner statements on file yet.')
  if (from > to) [from, to] = [to, from]
  const key = from + '|' + to
  const hot = CACHE.get(key); if (hot && Date.now() - hot.at < 5 * 60_000) return hot.data
  const months = monthsBetween(from, to)
  const sb = supabaseAdmin()

  // the ledger, four months at a time
  const lines: LRow[] = []
  for (let i = 0; i < months.length; i += 4) for (const part of await Promise.all(months.slice(i, i + 4).map(monthLines))) lines.push(...part)

  // pass-through reservations, at reservation grain (see lib/owner-statements)
  const pair: Record<string, { rental: number; cms: number }> = {}
  const pk = (r: LRow) => String(r.listing_id || '') + '|' + String(r.res_code || '')
  for (const r of lines) { const c = String(r.charge_code || ''); if (!r.res_code || (c !== 'AF' && c !== 'CMS')) continue; const a = pair[pk(r)] || (pair[pk(r)] = { rental: 0, cms: 0 }); if (c === 'AF') a.rental -= Number(r.amount) || 0; else a.cms += Number(r.amount) || 0 }
  const pt = new Set(Object.keys(pair).filter(k => pair[k].rental > 1 && pair[k].cms / pair[k].rental >= 0.9 && pair[k].cms / pair[k].rental <= 1.1))

  const [ownersQ, listingsQ, covQ, stmtQ] = await Promise.all([
    sb.from('guesty_owners').select('id, full_name').limit(1000),
    sb.from('guesty_listings').select('id, nickname, title, building, bedrooms').limit(2000),
    sb.from('guesty_ledger_months').select('month, status').in('month', months),
    sb.from('guesty_owner_statements').select('period_month').in('period_month', months).limit(1000),
  ])
  const ownerName: Record<string, string> = {}; for (const o of (ownersQ.data || []) as any[]) ownerName[o.id] = String(o.full_name || '')
  const L: Record<string, { name: string; building: string }> = {}; for (const l of (listingsQ.data || []) as any[]) L[l.id] = { name: String(l.nickname || l.title || ''), building: String(l.building || '') }
  const done = new Set(((covQ.data || []) as any[]).filter(m => m.status === 'done').map(m => m.month))
  const stmtMonths: Record<string, number> = {}; for (const s of (stmtQ.data || []) as any[]) stmtMonths[s.period_month] = (stmtMonths[s.period_month] || 0) + 1

  const total = zero(), monthly: Record<string, FinVals> = {}
  const rows = { b: new Map<string, FinRow>(), l: new Map<string, FinRow>(), o: new Map<string, FinRow>() }
  const mAcc = new Map<string, FinVals>()                 // row key | month → values, for the trend columns
  const detail = new Map<string, FinDetail>()
  const unitsOf = { b: new Map<string, Set<string>>(), o: new Map<string, Set<string>>() }
  const row = (m: Map<string, FinRow>, k: string, init: () => Omit<FinRow, keyof FinVals | 'byMonth'>) => { let r = m.get(k); if (!r) { r = { ...zero(), ...init(), byMonth: {} } as FinRow; m.set(k, r) } return r }
  for (const r of lines) {
    const code = String(r.charge_code || ''), name = String(r.line_name || '').trim() || (code || 'Unnamed line'), amt = Number(r.amount) || 0
    const cat = finCat(code, name, pt.has(pk(r)) && !!r.res_code)
    const oid = String(r.owner_id || ''), lid = String(r.listing_id || '')
    const oName = ownerName[oid] || 'Owner not on file', li = lid ? L[lid] : null
    const bName = li ? (li.building || 'No building set') : 'Not tied to a unit'
    add(total, cat, amt)
    add(monthly[r.entry_month] || (monthly[r.entry_month] = zero()), cat, amt)
    const lk = lid ? lid + '|' + oid : 'none|' + oid
    const targets: [string, FinRow][] = [
      ['b:' + bName, row(rows.b, bName, () => ({ key: bName, name: bName, building: bName, owner: '', units: 0 }))],
      ['l:' + lk, row(rows.l, lk, () => ({ key: lk, name: li ? li.name || 'Unnamed listing' : 'Not tied to a unit', building: bName, owner: oName, units: lid ? 1 : 0 }))],
      ['o:' + oid, row(rows.o, oid, () => ({ key: oid, name: oName, building: '', owner: oName, units: 0 }))],
    ]
    for (const [tk, tr] of targets) { add(tr, cat, amt); const mk = tk + '|' + r.entry_month; add(mAcc.get(mk) || (mAcc.set(mk, zero()), mAcc.get(mk)!), cat, amt) }
    if (lid) { (unitsOf.b.get(bName) || (unitsOf.b.set(bName, new Set()), unitsOf.b.get(bName)!)).add(lid); (unitsOf.o.get(oid) || (unitsOf.o.set(oid, new Set()), unitsOf.o.get(oid)!)).add(lid) }
    const dk = cat + '|' + name.toLowerCase().replace(/\s+/g, ' ')
    const d = detail.get(dk) || (detail.set(dk, { cat, name, amount: 0, lines: 0 }), detail.get(dk)!)
    d.amount += cat === 'paid' || cat === 'commission' || cat === 'charges' ? amt : -amt; d.lines++
  }
  mAcc.forEach((v, mk) => { finish(v); const cut = mk.lastIndexOf('|'), tk = mk.slice(0, cut), mo = mk.slice(cut + 1); const m = tk[0] === 'b' ? rows.b : tk[0] === 'l' ? rows.l : rows.o; const r = m.get(tk.slice(2)); if (r) r.byMonth[mo] = { gross: v.gross, net: v.net } })
  const list = (m: Map<string, FinRow>) => Array.from(m.values()).map(r => finish(r) as FinRow).sort((a, b) => b.net - a.net)
  rows.b.forEach((r, k) => { r.units = unitsOf.b.get(k)?.size || 0 }); rows.o.forEach((r, k) => { r.units = unitsOf.o.get(k)?.size || 0 })
  const data: Financials = {
    from, to, months,
    notSynced: months.filter(m => !done.has(m)), noStatements: months.filter(m => !stmtMonths[m] && monthly[m]),
    statements: Object.values(stmtMonths).reduce((a, b) => a + b, 0), ledgerLines: lines.length,
    total: finish(total), monthly: months.map(m => ({ month: m, ...finish(monthly[m] || zero()) })),
    buildings: list(rows.b), listings: list(rows.l), owners: list(rows.o),
    detail: Array.from(detail.values()).map(d => ({ ...d, amount: money(d.amount) })).sort((a, b) => a.cat.localeCompare(b.cat) || Math.abs(b.amount) - Math.abs(a.amount)),
  }
  CACHE.set(key, { at: Date.now(), data }); if (CACHE.size > 12) CACHE.delete(CACHE.keys().next().value as string)
  return data
}

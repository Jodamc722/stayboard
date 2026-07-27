// Account-wide owner-statement audit. This is the 906 method widened to every owner Guesty
// holds, and it exists because of one finding: a Guesty owner statement is the RECOGNISED
// slice of the Owners journal ledger and nothing else. On 906 the recognised rows for a month
// net to exactly 0.00 once the payout line is included, while the unrecognised rows carry
// forward — which is why summing the raw ledger overstated January by 3,332.42 and every other
// month by more. Six of 906's seven statements tie to the cent under the recognised rule.
//
// So the audit is: for every owner, for every month, does the recognised Owners-ledger net
// equal the dueToOwner printed on that month's statement? Anything that does not tie is a
// number we cannot put in front of an owner.
//
// This route only ever issues GETs against the Guesty API. It writes nothing.
//
// GET /api/guesty/statement-audit-all?mode=index
//   Enumerate every owner and every statement they have ever been issued. No journal work,
//   so it is fast. Use it to find the real date span before sweeping.
//
// GET /api/guesty/statement-audit-all?from=2026-01-01&to=2026-03-31
//   Sweep the Owners ledger across the window for ALL owners at once and tie each
//   owner-month to its statement. Keep windows to about a quarter: the sweep is bounded by
//   Vercel's 300s ceiling, and `truncated` in the response tells you if it ran out of room.
//
// GET ...&owner=<id>     restrict to one owner
// GET ...&problemsOnly=1 return only the owner-months that fail to tie
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'
import { hasEditCookie } from '@/lib/edit-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

const money = (n: number) => Math.round(n * 100) / 100

async function get(token: string, path: string): Promise<{ status: number; ok: boolean; json: any; error?: string }> {
  const r = await fetch(BASE + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    cache: 'no-store',
  })
  const text = await r.text().catch(() => '')
  let json: any = null
  try { json = JSON.parse(text) } catch (_e) { /* non-JSON */ }
  return { status: r.status, ok: r.ok, json, error: r.ok ? undefined : text.slice(0, 300) }
}

// Inclusive [monthStart, monthEnd] chunks covering the window. The journal is swept a month
// at a time so each paginated set stays small and per-month completeness is checkable.
function monthChunks(from: string, to: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const [fy, fm] = from.split('-').map(Number)
  const cur = new Date(Date.UTC(fy, fm - 1, 1))
  const end = new Date(to + 'T00:00:00Z')
  while (cur <= end) {
    const y = cur.getUTCFullYear()
    const m = cur.getUTCMonth()
    const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
    const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
    out.push([first < from ? from : first, last > to ? to : last])
    cur.setUTCMonth(m + 1)
  }
  return out
}

type Agg = {
  rental: number; commission: number; other: number; net: number; paid: number; rows: number
}
const blank = (): Agg => ({ rental: 0, commission: 0, other: 0, net: 0, paid: 0, rows: 0 })

// Owner-ledger amounts are signed from the PM's side, so a credit to the owner is negative.
// Flip on the way in so everything below reads as owner revenue. PO (payout) lines are
// settlement rather than earnings and are tracked separately.
function addTo(m: Agg, chargeCode: string, amount: number) {
  m.rows++
  if (chargeCode === 'PO') { m.paid = money(m.paid + amount); return }
  if (chargeCode === 'AF') m.rental = money(m.rental - amount)
  else if (chargeCode === 'CMS') m.commission = money(m.commission + amount)
  else m.other = money(m.other - amount)
  m.net = money(m.net - amount)
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const qs = new URL(req.url).searchParams
  const mode = qs.get('mode') || 'sweep'
  const from = qs.get('from') || '2026-01-01'
  const to = qs.get('to') || '2026-03-31'
  const onlyOwner = qs.get('owner') || ''
  const problemsOnly = qs.get('problemsOnly') === '1'

  let token = ''
  try { token = await getToken() }
  catch (e: any) { return NextResponse.json({ error: 'guesty auth failed: ' + String(e?.message || e) }, { status: 500 }) }

  // Listing -> building/unit, so journal rows can be attributed to a building without
  // trusting the free-text title Guesty puts on the listing link.
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings').select('id, building, unit, status')
  const listingRows = (ls || []) as any[]
  const buildingOf: Record<string, string> = {}
  const unitOf: Record<string, string> = {}
  for (const l of listingRows) {
    buildingOf[String(l.id)] = String(l.building ?? '(unmapped)')
    unitOf[String(l.id)] = String(l.building ?? '?') + '/' + String(l.unit ?? '?')
  }

  // Every owner on the account.
  const owners: any[] = []
  for (let skip = 0; skip < 2000; skip += 100) {
    const r = await get(token, '/owners?limit=100&skip=' + skip)
    if (!r.ok) {
      if (!skip) return NextResponse.json({ error: 'owners fetch failed', status: r.status, detail: r.error }, { status: 502 })
      break
    }
    const batch = r.json?.results || r.json?.data || (Array.isArray(r.json) ? r.json : [])
    owners.push(...batch)
    if (batch.length < 100) break
  }
  const ownerMeta: Record<string, { name: string; listings: number; buildings: string[] }> = {}
  for (const o of owners) {
    const id = String(o._id || o.id || '')
    if (!id) continue
    const ids = (o.listings || []).map((x: any) => String(typeof x === 'string' ? x : (x._id || x.id || x.listingId)))
    ownerMeta[id] = {
      name: o.fullName || [o.firstName, o.lastName].filter(Boolean).join(' ') || '(unnamed)',
      listings: ids.length,
      buildings: Array.from(new Set(ids.map((x: string) => buildingOf[x] || '(unknown)'))).sort() as string[],
    }
  }
  const ownerIds = Object.keys(ownerMeta).filter(id => !onlyOwner || id === onlyOwner)

  // Every statement those owners have ever been issued.
  const statements: any[] = []
  const statementErrors: any[] = []
  for (const id of ownerIds) {
    for (let skip = 0; skip < 1000; skip += 100) {
      const st = await get(token, '/owner-statement-api/owner-statements?limit=100&skip=' + skip
        + '&ownerId=' + encodeURIComponent(id))
      if (!st.ok) { statementErrors.push({ ownerId: id, status: st.status, error: st.error }); break }
      const batch = st.json?.results || []
      for (const s of batch) {
        statements.push({
          ownerId: id,
          ownerName: ownerMeta[id].name,
          buildings: ownerMeta[id].buildings,
          periodStart: String(s.periodStartDate || '').slice(0, 10),
          periodEnd: String(s.periodEndDate || '').slice(0, 10),
          month: String(s.periodStartDate || '').slice(0, 7),
          statementType: s.statementType,
          endingBalance: Number(s.endingBalance ?? 0) || 0,
          dueToOwner: Number(s.dueToOwner ?? s.endingBalance ?? 0) || 0,
          currency: s.currency,
        })
      }
      if (batch.length < 100) break
    }
  }
  statements.sort((a, b) => (a.periodStart + a.ownerName).localeCompare(b.periodStart + b.ownerName))

  const months = Array.from(new Set(statements.map(s => s.month))).filter(Boolean).sort()
  const byOwnerStmt: Record<string, { name: string; buildings: string[]; count: number; total: number; first: string; last: string }> = {}
  for (const s of statements) {
    const b = byOwnerStmt[s.ownerId] || (byOwnerStmt[s.ownerId] = {
      name: s.ownerName, buildings: s.buildings, count: 0, total: 0, first: s.month, last: s.month,
    })
    b.count++
    b.total = money(b.total + s.dueToOwner)
    if (s.month < b.first) b.first = s.month
    if (s.month > b.last) b.last = s.month
  }

  if (mode === 'index') {
    // Cheap enumeration: what exists, over what span, worth how much. No journal work.
    return NextResponse.json({
      ok: true,
      mode: 'index',
      ownersOnAccount: Object.keys(ownerMeta).length,
      ownersWithStatements: Object.keys(byOwnerStmt).length,
      statementCount: statements.length,
      statementSpan: months.length ? { first: months[0], last: months[months.length - 1], months: months.length } : null,
      allMonths: months,
      totalDueToOwnerAllTime: money(statements.reduce((a, s) => a + s.dueToOwner, 0)),
      statementTypes: Array.from(new Set(statements.map(s => s.statementType))),
      byOwner: Object.entries(byOwnerStmt)
        .map(([id, v]) => ({ ownerId: id, ...v }))
        .sort((a, b) => b.total - a.total),
      ownersWithoutStatements: Object.entries(ownerMeta)
        .filter(([id]) => !byOwnerStmt[id])
        .map(([id, v]) => ({ ownerId: id, name: v.name, listings: v.listings, buildings: v.buildings })),
      statementErrors,
    })
  }

  // --- Journal sweep -------------------------------------------------------------------
  // Sweep the whole account's Owners ledger for the window rather than filtering by owner:
  // 40-odd owners[] values would make the URL enormous, and every row carries its own owner,
  // so grouping after the fact is both cheaper and safer.
  const filterFor = (a: string, b: string) =>
    'transactionDate=' + encodeURIComponent(JSON.stringify({ operator: '@between', value: [a, b] }))

  // Does the gateway accept a ledger filter? If it does the sweep shrinks about fourfold,
  // since we only ever care about the Owners ledger. Verified against the rows that come
  // back, not assumed from a 200.
  let ledgerParam = ''
  {
    const probe = await get(token, '/accounting-api/journal-entries/all?limit=5&' + filterFor(from, to) + '&ledger[]=O')
    const rows = probe.json?.results || probe.json?.data || []
    if (probe.ok && rows.length && rows.every((r: any) => r.ledger === 'Owners')) ledgerParam = '&ledger[]=O'
  }

  const seenIds = new Set<string>()
  const recAgg: Record<string, Agg> = {}
  const unrecAgg: Record<string, Agg> = {}
  const buildingAgg: Record<string, Agg> = {}
  const coverage: Array<{ month: string; expected: number | null; unique: number; ownerRows: number; complete: boolean }> = []
  const unownedRows: Record<string, { count: number; total: number }> = {}
  let truncated = false
  let ownerRowTotal = 0

  const started = Date.now()
  for (const [a, b] of monthChunks(from, to)) {
    const cf = filterFor(a, b)
    let expected: number | null = null
    const before = seenIds.size
    let ownerRowsThisMonth = 0
    for (let skip = 0; skip < 40000; skip += 100) {
      // Leave room to return a partial answer rather than have the platform kill the request.
      if (Date.now() - started > 250000) { truncated = true; break }
      const page = await get(token, '/accounting-api/journal-entries/all?limit=100&sortByDate=ASC&skip='
        + skip + '&' + cf + ledgerParam)
      if (!page.ok) {
        return NextResponse.json({
          ok: false, stage: 'journal page', month: a, skip, status: page.status, error: page.error,
          ownersOnAccount: Object.keys(ownerMeta).length, statementCount: statements.length,
        }, { status: 502 })
      }
      const batch = page.json?.results || page.json?.data || []
      if (typeof page.json?.total === 'number') expected = page.json.total
      for (const r of batch) {
        const id = String(r.id ?? r._id ?? '')
        if (!id || seenIds.has(id)) continue
        seenIds.add(id)
        if (r.ledger !== 'Owners') continue
        ownerRowsThisMonth++
        const amount = Number(r.amount?.value ?? r.amount ?? 0) || 0
        const chargeCode = String(r.chargeCode || '')
        const month = String(r.date || '').slice(0, 7)
        const oid = String(r.owner?.id || r.owner?._id || '')
        if (!oid) {
          const k = (chargeCode || '-') + ' | ' + (r.name || '-')
          unownedRows[k] = unownedRows[k] || { count: 0, total: 0 }
          unownedRows[k].count++
          unownedRows[k].total = money(unownedRows[k].total - amount)
          continue
        }
        const key = oid + '|' + month
        const target = r.recognized === false ? unrecAgg : recAgg
        addTo(target[key] || (target[key] = blank()), chargeCode, amount)
        // Building attribution, recognised rows only — this is the statement-grade view.
        if (r.recognized !== false) {
          const L = r.listing
          const href = typeof L === 'object' && L ? String(L.href || '') : ''
          const lid = typeof L === 'string' ? L : String(L?._id || L?.id || (href.split('/').filter(Boolean).pop() || ''))
          const bk = (buildingOf[lid] || '(no listing)') + '|' + month
          addTo(buildingAgg[bk] || (buildingAgg[bk] = blank()), chargeCode, amount)
        }
      }
      if (batch.length < 100) break
    }
    ownerRowTotal += ownerRowsThisMonth
    const unique = seenIds.size - before
    coverage.push({
      month: a.slice(0, 7), expected, unique, ownerRows: ownerRowsThisMonth,
      complete: !truncated && (expected == null || unique >= expected),
    })
    if (truncated) break
  }

  // Tie every statement in the window to its recognised owner-month.
  const windowStatements = statements.filter(s => s.periodStart >= from && s.periodEnd <= to)
  const checks = windowStatements.map(s => {
    const key = s.ownerId + '|' + s.month
    const rec = recAgg[key]
    const unrec = unrecAgg[key]
    const variance = rec ? money(rec.net - s.dueToOwner) : null
    return {
      ownerId: s.ownerId,
      owner: s.ownerName,
      buildings: s.buildings,
      month: s.month,
      statementDueToOwner: s.dueToOwner,
      recognizedNet: rec ? rec.net : null,
      variance,
      ties: rec ? Math.abs(rec.net - s.dueToOwner) < 0.02 : false,
      rentalBeforeExpenses: rec ? rec.rental : null,
      pmCommission: rec ? rec.commission : null,
      otherAdjustments: rec ? rec.other : null,
      paidOut: rec ? rec.paid : null,
      commissionRate: rec && rec.rental ? Math.round((rec.commission / rec.rental) * 10000) / 100 : null,
      unrecognizedCarry: unrec ? unrec.net : 0,
    }
  })

  // Recognised owner-months with journal activity but no statement covering them. These are
  // the silent failures: revenue that reconciles to nothing.
  const stmtKeys = new Set(windowStatements.map(s => s.ownerId + '|' + s.month))
  const orphans = Object.entries(recAgg)
    .filter(([k, v]) => !stmtKeys.has(k) && Math.abs(v.net) >= 0.02)
    .map(([k, v]) => {
      const [oid, month] = k.split('|')
      return {
        ownerId: oid, owner: ownerMeta[oid]?.name || '(unknown)',
        buildings: ownerMeta[oid]?.buildings || [], month,
        recognizedNet: v.net, rentalBeforeExpenses: v.rental, pmCommission: v.commission, rows: v.rows,
      }
    })
    .sort((a, b) => Math.abs(b.recognizedNet) - Math.abs(a.recognizedNet))

  const failing = checks.filter(c => !c.ties)
  const sum = (xs: number[]) => money(xs.reduce((a, v) => a + v, 0))

  return NextResponse.json({
    ok: true,
    mode: 'sweep',
    window: { from, to },
    ledgerFilterApplied: ledgerParam ? 'ledger[]=O' : 'none (filtered client-side)',
    journal: {
      rowsScanned: seenIds.size,
      ownerLedgerRows: ownerRowTotal,
      coverage,
      incompleteMonths: coverage.filter(c => !c.complete).map(c => c.month),
      truncated,
      elapsedMs: Date.now() - started,
    },
    audit: {
      statementsInWindow: windowStatements.length,
      tied: checks.length - failing.length,
      failed: failing.length,
      allTied: failing.length === 0,
      totalDueToOwner: sum(windowStatements.map(s => s.dueToOwner)),
      totalRecognizedNet: sum(checks.map(c => c.recognizedNet || 0)),
      totalRentalBeforeExpenses: sum(checks.map(c => c.rentalBeforeExpenses || 0)),
      totalPmCommission: sum(checks.map(c => c.pmCommission || 0)),
      totalVariance: sum(checks.map(c => c.variance || 0)),
      worstVariance: failing.slice().sort((a, b) =>
        Math.abs(b.variance || 0) - Math.abs(a.variance || 0))[0] || null,
    },
    failing,
    checks: problemsOnly ? undefined : checks,
    orphanOwnerMonths: orphans.slice(0, 100),
    orphanCount: orphans.length,
    // Owners-ledger rows Guesty returned with no owner attached. On a healthy account this is
    // empty; anything here is revenue that cannot be assigned to a statement at all.
    unownedOwnerLedgerRows: Object.entries(unownedRows)
      .map(([k, v]) => ({ key: k, count: v.count, total: v.total }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 25),
    byBuilding: Object.entries(buildingAgg)
      .map(([k, v]) => {
        const [building, month] = k.split('|')
        return { building, month, rentalBeforeExpenses: v.rental, pmCommission: v.commission, net: v.net, rows: v.rows }
      })
      .sort((a, b) => (a.building + a.month).localeCompare(b.building + b.month)),
    statementErrors,
  })
}

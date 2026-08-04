// OWNER STATEMENT AUDIT ENGINE — the end-of-month statement review, computed live.
//
// This is the monthly "owner statement audit" that used to live in a Google Sheet: before the
// statements go out, every reservation on every generated statement gets checked for the things
// that have burned us before. The checks are the ones the audit skill codified:
//
//   1. NEGATIVE RESERVATIONS   rental income below zero — erroneous refunds, chargebacks,
//                              duplicate reversals, data entry.
//   2. LOW NIGHTLY RATE        effective rate under $60/night — but ONLY on the nights that fall
//                              inside the statement month. A Feb 25 – Mar 3 stay shows a few
//                              hundred dollars on the March statement and that is NORMAL; the
//                              rate is computed on in-month nights before anything is flagged.
//   3. ORPHANED REIMBURSEMENTS reimbursement lines (cleaning fee etc.) on a reservation block
//                              with no rental income — there is no booking to justify them.
//   4. REFUNDS                 any "Guest refund"-looking line, captured with its amount, so it
//                              can be verified as authorized.
//   5. ZERO-REVENUE STAYS      $0 reservations that aren't obviously owner stays.
//
// Data comes from the owner-statement mirror (guesty_owner_statements + guesty_owner_ledger,
// recognized rows only — the recognized slice IS the statement, proven by the account-wide
// audit), joined to guesty_reservations for guest/dates/deep-links. Nothing is stored about the
// numbers; only the human review state persists (owner_audit_reviews).
//
// Sign convention, same as lib/owner-statements: ledger amounts are signed from the PM's side,
// so every figure here is flipped to read as OWNER money — positive = money to the owner.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { MONTH_LABEL, money } from './owner-statements'

export type AuditFlagType =
  | 'negative' | 'low_rate' | 'orphan_reimb' | 'refund' | 'zero_rev'
  | 'passthru' | 'no_reservation'
export type AuditSeverity = 'high' | 'review' | 'info'
export type AuditFlag = { type: AuditFlagType; severity: AuditSeverity; detail: string; amount?: number }

export type AuditLine = { date: string; label: string; code: string; amount: number }
export type AuditComment = { author: string; body: string; at: string }
export type AuditStatus = 'review' | 'action' | 'done'

export type AuditItem = {
  key: string                    // confirmation code, or line:<code>:<label>
  kind: 'reservation' | 'line'
  ownerId: string
  resCode: string                // '' on grouped non-reservation lines
  guest: string
  checkIn: string
  checkOut: string
  totalNights: number            // whole-stay nights; 0 when the reservation is unmatched
  monthNights: number            // nights that fall inside the statement month
  splitMonth: boolean
  listingId: string
  unit: string
  source: string
  reservationId: string          // guesty_reservations.id — powers the "open in Guesty" link
  rental: number
  commission: number
  other: number
  net: number
  rate: number | null            // rental / monthNights, null when nights are unknown
  lines: AuditLine[]
  flags: AuditFlag[]
  status: AuditStatus
  touched: boolean               // true when a human explicitly set the status
  note: string
  comments: AuditComment[]
  updatedBy: string | null
  updatedAt: string | null
}

export type AuditOwner = {
  ownerId: string
  ownerName: string
  hasStatement: boolean
  dueToOwner: number | null
  rental: number
  commission: number
  other: number
  net: number
  paid: number
  ties: boolean
  items: number                  // count; the items themselves live in the flat list
  open: number                   // items still at review/action
}

export type AuditMonthPick = { m: string; label: string; statements: number }

export type AuditData = {
  month: string
  label: string
  owners: AuditOwner[]
  items: AuditItem[]
  totals: {
    owners: number; statements: number; reservations: number
    flagged: number; high: number
    review: number; action: number; done: number
    rental: number; commission: number; net: number; paid: number; dueToOwner: number
  }
  coverage: { ready: boolean; missing: string[] }
}

const REFUND_RE = /refund/i
const REIMB_RE = /reimburs|cleaning/i
const OWNERISH_RE = /owner/i

// Same reservation-level wash rule lib/owner-statements proved out: a reservation whose
// commission total is ~100% of its rental total is a pass-through, not revenue with a fee on it.
const PASSTHRU_LO = 0.9
const PASSTHRU_HI = 1.1

type LedgerRow = {
  owner_id: string | null
  listing_id: string | null
  entry_date: string | null
  charge_code: string | null
  amount: number | null
  name?: string | null
  res?: string | null
}

const LEDGER_COLS = "owner_id, listing_id, entry_date, charge_code, amount, name:raw->>name, res:raw->reservationConfirmationCode->>title"
const LEDGER_COLS_PLAIN = 'owner_id, listing_id, entry_date, charge_code, amount'

function monthWindow(month: string): { start: string; endExcl: string; days: number } {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const endExcl = new Date(Date.UTC(y, m, 1))
  return {
    start: start.toISOString().slice(0, 10),
    endExcl: endExcl.toISOString().slice(0, 10),
    days: Math.round((endExcl.getTime() - start.getTime()) / 86400000),
  }
}

// Nights of [checkIn, checkOut) that fall inside [start, endExcl).
function nightsWithin(checkIn: string, checkOut: string, start: string, endExcl: string): number {
  const a = checkIn > start ? checkIn : start
  const b = checkOut < endExcl ? checkOut : endExcl
  if (a >= b) return 0
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000)
}

/** Months that have generated statements, newest first — the picker feed. */
export async function auditMonths(limit = 24): Promise<AuditMonthPick[]> {
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('guesty_owner_statements')
    .select('period_month')
    .not('period_month', 'is', null)
    .order('period_month', { ascending: false })
    .limit(5000)
  if (error) throw new Error('statement months read: ' + error.message)
  const counts: Record<string, number> = {}
  for (const r of (data || []) as any[]) {
    const m = String(r.period_month || '')
    if (m) counts[m] = (counts[m] || 0) + 1
  }
  return Object.keys(counts).sort().reverse().slice(0, limit)
    .map(m => ({ m, label: MONTH_LABEL(m), statements: counts[m] }))
}

/** Build the whole audit for one statement month. */
export async function buildAudit(month: string): Promise<AuditData> {
  const sb = supabaseAdmin()
  const win = monthWindow(month)

  // 1. The generated statements for this month — the documents being audited.
  const { data: stmtRows, error: stErr } = await sb.from('guesty_owner_statements')
    .select('id, owner_id, owner_name, period_month, due_to_owner')
    .eq('period_month', month)
  if (stErr) throw new Error('statements read: ' + stErr.message)
  const stmts = (stmtRows || []) as any[]
  const stmtByOwner: Record<string, any> = {}
  for (const s of stmts) stmtByOwner[String(s.owner_id || '')] = s

  // 2. Ledger coverage — has the mirror actually swept this month?
  const { data: cov } = await sb.from('guesty_ledger_months').select('month, status').eq('month', month)
  const covered = ((cov || []) as any[]).some(r => r.status === 'done')

  // 3. Every recognized ledger row for the month. Scalar selects only (PERF LAW: never pull
  //    whole raw JSONB over thousands of rows); falls back to a plain select if the mirror
  //    refuses the JSON accessors, so the audit is never lost over a label.
  const rows: LedgerRow[] = []
  const PAGE = 1000
  let named = true
  for (let off = 0; off < 200_000; off += PAGE) {
    const run = (cols: string) => sb.from('guesty_owner_ledger').select(cols)
      .eq('recognized', true)
      .eq('entry_month', month)
      .range(off, off + PAGE - 1)
    let { data, error } = await run(named ? LEDGER_COLS : LEDGER_COLS_PLAIN)
    if (error && named) {
      named = false
      ;({ data, error } = await run(LEDGER_COLS_PLAIN))
    }
    if (error) throw new Error('ledger read: ' + error.message)
    const batch = (data || []) as unknown as LedgerRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }

  // 4. Group by owner, then by reservation code (or grouped line for codeless rows).
  type Group = {
    ownerId: string; resCode: string; lineKey: string
    rental: number; commission: number; other: number; paid: number
    lines: AuditLine[]; afDates: Set<string>; listingIds: Record<string, number>
  }
  const groups: Record<string, Group> = {}
  const owners: Record<string, AuditOwner> = {}

  const ownerOf = (id: string): AuditOwner => owners[id] || (owners[id] = {
    ownerId: id, ownerName: '', hasStatement: !!stmtByOwner[id],
    dueToOwner: stmtByOwner[id] ? (Number(stmtByOwner[id].due_to_owner ?? 0) || 0) : null,
    rental: 0, commission: 0, other: 0, net: 0, paid: 0, ties: false, items: 0, open: 0,
  })

  for (const r of rows) {
    const ownerId = String(r.owner_id || '')
    if (!ownerId) continue                       // unattributable rows can't sit on a statement
    const o = ownerOf(ownerId)
    const code = String(r.charge_code || '')
    const amt = Number(r.amount) || 0
    const eff = money(-amt)                      // owner effect: positive = money to the owner
    if (code === 'PO') { o.paid = money(o.paid + amt); continue }

    const label = String(r.name || '').trim() || code || '(no code)'
    const res = String(r.res || '').trim()
    const lineKey = res ? '' : 'line:' + code + ':' + label.slice(0, 80)
    const gKey = ownerId + '|' + (res || lineKey)
    const g = groups[gKey] || (groups[gKey] = {
      ownerId, resCode: res, lineKey,
      rental: 0, commission: 0, other: 0, paid: 0,
      lines: [], afDates: new Set(), listingIds: {},
    })

    if (code === 'AF') { g.rental = money(g.rental + eff); if (r.entry_date) g.afDates.add(String(r.entry_date)) }
    else if (code === 'CMS') g.commission = money(g.commission - eff)   // positive = fee taken
    else g.other = money(g.other + eff)
    if (r.listing_id) g.listingIds[String(r.listing_id)] = (g.listingIds[String(r.listing_id)] || 0) + 1
    g.lines.push({ date: String(r.entry_date || ''), label, code, amount: eff })

    if (code === 'AF') o.rental = money(o.rental + eff)
    else if (code === 'CMS') o.commission = money(o.commission - eff)
    else o.other = money(o.other + eff)
    o.net = money(o.net + eff)
  }

  // Owners with a statement but no ledger activity still need a section (blank month, or the
  // ledger sweep missed them) — the reviewer should see them rather than not know they exist.
  for (const s of stmts) ownerOf(String(s.owner_id || ''))

  // 5. Names for owners + listings, and the reservation join.
  const ownerIds = Object.keys(owners)
  const codes = Array.from(new Set(Object.values(groups).map(g => g.resCode).filter(Boolean)))
  const listingIds = new Set<string>()
  for (const g of Object.values(groups)) for (const id of Object.keys(g.listingIds)) listingIds.add(id)

  const resByCode: Record<string, any> = {}
  for (let i = 0; i < codes.length; i += 200) {
    const { data } = await sb.from('guesty_reservations')
      .select('id, confirmation_code, guest_name, check_in, check_out, nights, status, source, listing_id')
      .in('confirmation_code', codes.slice(i, i + 200))
    for (const r of (data || []) as any[]) {
      const c = String(r.confirmation_code || '')
      // Prefer a confirmed/completed booking if the code somehow appears twice.
      if (!resByCode[c] || String(r.status || '') === 'confirmed') resByCode[c] = r
      if (r.listing_id) listingIds.add(String(r.listing_id))
    }
  }

  const [{ data: ownerRows }, { data: listingRows }] = await Promise.all([
    ownerIds.length
      ? sb.from('guesty_owners').select('id, full_name').in('id', ownerIds)
      : Promise.resolve({ data: [] } as any),
    listingIds.size
      ? sb.from('guesty_listings').select('id, nickname, title, building, unit').in('id', Array.from(listingIds))
      : Promise.resolve({ data: [] } as any),
  ])
  const ownerName: Record<string, string> = {}
  for (const o of (ownerRows || []) as any[]) ownerName[String(o.id)] = String(o.full_name || '')
  const unitOf: Record<string, string> = {}
  for (const l of (listingRows || []) as any[]) {
    unitOf[String(l.id)] = String(l.nickname || l.title || (l.building ? l.building + '/' + (l.unit ?? '') : '') || l.id)
  }

  for (const o of Object.values(owners)) {
    o.ownerName = String(stmtByOwner[o.ownerId]?.owner_name || ownerName[o.ownerId] || '(unnamed)')
    o.ties = o.dueToOwner == null
      ? false
      : Math.abs(o.net - o.dueToOwner) < 0.02 || Math.abs(o.net - o.paid) < 0.02
  }

  // 6. Reviews already saved for this month.
  const { data: revRows, error: revErr } = await sb.from('owner_audit_reviews')
    .select('owner_id, item_key, status, note, comments, updated_by, updated_at')
    .eq('month', month)
  // A missing table (migration not run yet) degrades to "no reviews saved", never to a 500.
  const reviews: Record<string, any> = {}
  if (!revErr) for (const r of (revRows || []) as any[]) reviews[String(r.owner_id) + '|' + String(r.item_key)] = r

  // 7. Items + flags.
  const items: AuditItem[] = []
  for (const g of Object.values(groups)) {
    const res = g.resCode ? resByCode[g.resCode] : null
    const bestListing = Object.keys(g.listingIds).sort((a, b) => g.listingIds[b] - g.listingIds[a])[0]
      || (res ? String(res.listing_id || '') : '')

    const checkIn = res ? String(res.check_in || '').slice(0, 10) : ''
    const checkOut = res ? String(res.check_out || '').slice(0, 10) : ''
    const totalNights = res ? (Number(res.nights) || 0) : 0
    // In-month nights from the real dates when we have them; distinct AF dates as the proxy
    // when we don't (adjustment rows duplicate dates, so the Set already dedupes).
    const monthNights = (checkIn && checkOut)
      ? nightsWithin(checkIn, checkOut, win.start, win.endExcl)
      : g.afDates.size
    const splitMonth = !!(checkIn && checkOut) && (checkIn < win.start || checkOut > win.endExcl)
    const net = money(g.rental - g.commission + g.other)
    const rate = monthNights > 0 ? money(g.rental / monthNights) : null

    const flags: AuditFlag[] = []
    if (g.resCode) {
      const refundAmt = money(g.lines.filter(l => REFUND_RE.test(l.label)).reduce((a, l) => a + l.amount, 0))
      const reimbAmt = money(g.lines.filter(l => REIMB_RE.test(l.label) && l.amount > 0).reduce((a, l) => a + l.amount, 0))
      const isPassthru = g.rental > 1 && g.commission / g.rental >= PASSTHRU_LO && g.commission / g.rental <= PASSTHRU_HI

      if (g.rental < -0.005) {
        flags.push({ type: 'negative', severity: 'high', amount: g.rental, detail: 'Negative rental income — check for erroneous refund, chargeback or duplicate reversal.' })
      }
      if (g.lines.some(l => REFUND_RE.test(l.label))) {
        flags.push({ type: 'refund', severity: 'review', amount: refundAmt, detail: 'Refund on this reservation — verify it was authorized.' })
      }
      if (Math.abs(g.rental) < 0.005 && reimbAmt > 0.005) {
        flags.push({ type: 'orphan_reimb', severity: 'review', amount: reimbAmt, detail: 'Reimbursement with no rental income on the block — no booking justifies it.' })
      } else if (Math.abs(g.rental) < 0.005 && !flags.length) {
        const ownerish = OWNERISH_RE.test(String(res?.source || '')) || OWNERISH_RE.test(String(res?.guest_name || ''))
        flags.push({ type: 'zero_rev', severity: ownerish ? 'info' : 'review',
          detail: ownerish ? 'Owner stay — $0 revenue by design; note any associated costs.' : '$0 revenue and not obviously an owner stay.' })
      }
      if (g.rental > 0.005 && rate != null && rate < 60 && monthNights > 0) {
        if (!splitMonth) {
          flags.push({ type: 'low_rate', severity: 'review', amount: rate, detail: 'Effective rate $' + rate.toFixed(2) + '/night on ' + monthNights + ' in-month night' + (monthNights === 1 ? '' : 's') + '.' })
        }
        // Split-month with a healthy in-month rate is expected and stays unflagged; a
        // split-month stay that is STILL under $60 on its in-month nights gets flagged too.
        else {
          flags.push({ type: 'low_rate', severity: 'review', amount: rate, detail: 'Split-month stay, but the in-month portion still runs $' + rate.toFixed(2) + '/night over ' + monthNights + ' night' + (monthNights === 1 ? '' : 's') + '.' })
        }
      }
      if (isPassthru) {
        flags.push({ type: 'passthru', severity: 'info', detail: 'Commission fully offsets rental (pass-through wash) — owner nets zero on it by design.' })
      }
      if (!res) {
        flags.push({ type: 'no_reservation', severity: 'info', detail: 'Code not found in the reservations mirror — dates and the Guesty link are unavailable.' })
      }
    } else {
      // Grouped non-reservation lines: informational unless they look like refunds.
      if (g.lines.some(l => REFUND_RE.test(l.label))) {
        const amt = money(g.lines.filter(l => REFUND_RE.test(l.label)).reduce((a, l) => a + l.amount, 0))
        flags.push({ type: 'refund', severity: 'review', amount: amt, detail: 'Refund-looking line outside any reservation — verify.' })
      }
    }

    const worst: AuditSeverity = flags.some(f => f.severity === 'high') ? 'high'
      : flags.some(f => f.severity === 'review') ? 'review' : 'info'
    const key = g.resCode || g.lineKey
    const saved = reviews[g.ownerId + '|' + key]
    const defaultStatus: AuditStatus = worst === 'info' ? 'done' : 'review'
    const comments: AuditComment[] = Array.isArray(saved?.comments) ? saved.comments : []

    items.push({
      key,
      kind: g.resCode ? 'reservation' : 'line',
      ownerId: g.ownerId,
      resCode: g.resCode,
      guest: res ? String(res.guest_name || '') : (g.resCode ? '' : g.lines[0]?.label || ''),
      checkIn, checkOut, totalNights, monthNights, splitMonth,
      listingId: bestListing,
      unit: unitOf[bestListing] || '',
      source: res ? String(res.source || '') : '',
      reservationId: res ? String(res.id || '') : '',
      rental: g.rental, commission: g.commission, other: g.other, net,
      rate,
      lines: g.lines.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 60),
      flags,
      status: saved ? (String(saved.status) as AuditStatus) : defaultStatus,
      touched: !!saved,
      note: saved ? String(saved.note || '') : '',
      comments,
      updatedBy: saved ? (saved.updated_by || null) : null,
      updatedAt: saved ? (saved.updated_at || null) : null,
    })
  }

  // Order: worst first inside each owner, owners by name.
  const sevRank = (it: AuditItem) => it.flags.some(f => f.severity === 'high') ? 0
    : it.flags.some(f => f.severity === 'review') ? 1 : it.kind === 'reservation' ? 2 : 3
  items.sort((a, b) => a.ownerId.localeCompare(b.ownerId) || sevRank(a) - sevRank(b) || b.rental - a.rental)

  for (const it of items) {
    const o = owners[it.ownerId]
    if (!o) continue
    o.items++
    if (it.status !== 'done') o.open++
  }

  const t = {
    owners: Object.keys(owners).length,
    statements: stmts.length,
    reservations: items.filter(i => i.kind === 'reservation').length,
    flagged: items.filter(i => i.flags.some(f => f.severity !== 'info')).length,
    high: items.filter(i => i.flags.some(f => f.severity === 'high')).length,
    review: items.filter(i => i.status === 'review').length,
    action: items.filter(i => i.status === 'action').length,
    done: items.filter(i => i.status === 'done').length,
    rental: money(Object.values(owners).reduce((a, o) => a + o.rental, 0)),
    commission: money(Object.values(owners).reduce((a, o) => a + o.commission, 0)),
    net: money(Object.values(owners).reduce((a, o) => a + o.net, 0)),
    paid: money(Object.values(owners).reduce((a, o) => a + o.paid, 0)),
    dueToOwner: money(stmts.reduce((a, s) => a + (Number(s.due_to_owner ?? 0) || 0), 0)),
  }

  return {
    month,
    label: MONTH_LABEL(month),
    owners: Object.values(owners).sort((a, b) => a.ownerName.localeCompare(b.ownerName)),
    items,
    totals: t,
    coverage: { ready: covered, missing: covered ? [] : [month] },
  }
}

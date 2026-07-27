// Read-only owner-statement audit. Pulls the real Accounting-by-Guesty data for one
// building — the monthly owner statements plus the journal entries that make them up —
// and groups the journal lines so we can see revenue BEFORE expenses, not just the
// dueToOwner figure printed at the bottom of the statement PDF.
//
// This route only ever issues GETs against the Guesty API. It writes nothing, and it
// strips anything that looks like owner PII before returning.
//
// GET /api/guesty/owner-statement-audit?building=906&from=2026-01-01&to=2026-06-30
// GET ...&sample=1   — also include a few redacted raw journal rows, to check semantics
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'
import { hasEditCookie } from '@/lib/edit-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const SECRET = /email|phone|ssn|tax.?id|iban|account.?number|routing|password|secret|token/i

function redact(v: any, depth = 0): any {
  if (v == null || depth > 5) return v
  if (Array.isArray(v)) return v.map(x => redact(x, depth + 1))
  if (typeof v === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(v)) out[k] = SECRET.test(k) ? '<redacted>' : redact(v[k], depth + 1)
    return out
  }
  return v
}

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

const money = (n: number) => Math.round(n * 100) / 100

// Guesty's array filters are not documented consistently across services, so try the
// encodings in order and keep the first one the gateway accepts.
function encodeListings(style: string, ids: string[]): string {
  if (!ids.length) return ''
  if (style === 'bracket') return ids.map(id => '&listings[]=' + encodeURIComponent(id)).join('')
  if (style === 'repeat') return ids.map(id => '&listings=' + encodeURIComponent(id)).join('')
  return '&listings=' + encodeURIComponent(JSON.stringify(ids))
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const qs = new URL(req.url).searchParams
  const building = qs.get('building') || '906'
  const from = qs.get('from') || '2026-01-01'
  const to = qs.get('to') || '2026-06-30'
  const withSample = qs.get('sample') === '1'

  let token = ''
  try { token = await getToken() }
  catch (e: any) { return NextResponse.json({ error: 'guesty auth failed: ' + String(e?.message || e) }, { status: 500 }) }

  // 1. Which listings make up this building?
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings')
    .select('id, building, unit, nickname, status').eq('building', building)
  const listings = (ls || []) as any[]
  const listingIds = listings.map(l => String(l.id))
  const nameOf: Record<string, string> = {}
  for (const l of listings) nameOf[String(l.id)] = building + '/' + (l.unit ?? '?')
  if (!listingIds.length) return NextResponse.json({ error: 'no listings for building ' + building }, { status: 404 })

  // 2. Which Guesty owner holds them?
  const ow = await get(token, '/owners?limit=100')
  const owners = (ow.json?.results || ow.json?.data || ow.json || []) as any[]
  const matched = (Array.isArray(owners) ? owners : []).map(o => {
    const ids = (o.listings || []).map((x: any) => String(typeof x === 'string' ? x : (x._id || x.id || x.listingId)))
    const hit = ids.filter((x: string) => listingIds.includes(x))
    return hit.length ? { ownerId: String(o._id || o.id), ownerName: o.fullName || [o.firstName, o.lastName].filter(Boolean).join(' '), matchedListings: hit.length, totalListings: ids.length } : null
  }).filter(Boolean) as any[]

  // 3. Their monthly owner statements, trimmed to the window.
  const statements: any[] = []
  for (const m of matched) {
    const st = await get(token, '/owner-statement-api/owner-statements?limit=100&ownerId=' + encodeURIComponent(m.ownerId))
    for (const s of (st.json?.results || [])) {
      const start = String(s.periodStartDate || '').slice(0, 10)
      const end = String(s.periodEndDate || '').slice(0, 10)
      if (start >= from && end <= to) {
        statements.push({
          ownerId: m.ownerId, ownerName: s.ownerName, periodStart: start, periodEnd: end,
          statementType: s.statementType, endingBalance: s.endingBalance, dueToOwner: s.dueToOwner,
          currency: s.currency,
        })
      }
    }
  }
  statements.sort((a, b) => a.periodStart.localeCompare(b.periodStart))

  // 4. Journal entries for those listings over the window. This is the line-item source.
  const dateFilter = 'transactionDate=' + encodeURIComponent(JSON.stringify({ operator: '@between', value: [from, to] }))
  let style = ''
  let styleErr: any = null
  for (const s of ['bracket', 'repeat', 'json']) {
    const probe = await get(token, '/accounting-api/journal-entries/all?limit=1&' + dateFilter + encodeListings(s, listingIds.slice(0, 1)))
    if (probe.ok) { style = s; break }
    styleErr = { style: s, status: probe.status, error: probe.error }
  }
  if (!style) {
    return NextResponse.json({ ok: false, stage: 'journal-entries', building, listings: listings.length,
      owners: matched, statements, listingFilterError: styleErr })
  }

  const rows: any[] = []
  let truncated = false
  let total: number | null = null
  for (let skip = 0; skip < 40000; skip += 100) {
    const page = await get(token, '/accounting-api/journal-entries/all?limit=100&sortByDate=ASC&skip=' + skip
      + '&' + dateFilter + encodeListings(style, listingIds))
    if (!page.ok) {
      return NextResponse.json({ ok: false, stage: 'journal-entries page', skip, status: page.status,
        error: page.error, building, owners: matched, statements, rowsSoFar: rows.length })
    }
    const batch = page.json?.results || page.json?.data || []
    if (typeof page.json?.total === 'number') total = page.json.total
    rows.push(...batch)
    if (batch.length < 100) break
    if (rows.length >= 30000) { truncated = true; break }
  }

  // 5. Group. Journal amounts are signed: revenue positive, deductions negative.
  // Guesty returns listing as a UI link object — { href: '/properties/<id>', title: '906/9 - Studio' }
  // — not a bare id, so pull the id out of the href and fall back to the title for labelling.
  const norm = (r: any) => {
    const L = r.listing
    const href = typeof L === 'object' && L ? String(L.href || '') : ''
    const listingId = typeof L === 'string' ? L
      : String(L?._id || L?.id || (href.split('/').filter(Boolean).pop() || ''))
    const title = typeof L === 'object' && L ? String(L.title || '') : ''
    const conf = r.reservationConfirmationCode
    return {
      date: String(r.date || '').slice(0, 10),
      month: String(r.date || '').slice(0, 7),
      ledger: r.ledger || '',
      chargeCode: r.chargeCode || '',
      name: r.name || '',
      chargeType: r.chargeType || '',
      trigger: r.trigger || '',
      amount: Number(r.amount?.value ?? r.amount ?? 0) || 0,
      listingId,
      unit: nameOf[listingId] || title || listingId || '(none)',
      conf: typeof conf === 'string' ? conf : String(conf?.title || ''),
    }
  }
  const n = rows.map(norm)

  const bucket = (keyFn: (x: any) => string) => {
    const m: Record<string, { count: number; total: number }> = {}
    for (const x of n) {
      const k = keyFn(x)
      m[k] = m[k] || { count: 0, total: 0 }
      m[k].count++
      m[k].total += x.amount
    }
    return Object.entries(m)
      .map(([k, v]) => ({ key: k, count: v.count, total: money(v.total) }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
  }

  // The owner's economics live entirely in the "Owners" ledger. Guesty signs it from the
  // property manager's side, so a credit to the owner is negative — flip it to read as revenue.
  const ownerLines = n.filter(x => x.ledger === 'Owners')
  const sumOwner = (pred: (x: any) => boolean) => money(-ownerLines.filter(pred).reduce((a, x) => a + x.amount, 0))
  const ownerByCode: Record<string, { count: number; total: number }> = {}
  for (const x of ownerLines) {
    const k = (x.chargeCode || '-') + ' | ' + (x.name || '-')
    ownerByCode[k] = ownerByCode[k] || { count: 0, total: 0 }
    ownerByCode[k].count++
    ownerByCode[k].total = money(ownerByCode[k].total - x.amount)
  }
  const ownerByMonth: Record<string, { rental: number; commission: number; other: number; net: number }> = {}
  for (const x of ownerLines) {
    const m = ownerByMonth[x.month] || (ownerByMonth[x.month] = { rental: 0, commission: 0, other: 0, net: 0 })
    if (x.chargeCode === 'AF') m.rental = money(m.rental - x.amount)
    else if (x.chargeCode === 'CMS') m.commission = money(m.commission + x.amount)
    else m.other = money(m.other - x.amount)
    m.net = money(m.net - x.amount)
  }

  // Which listings did the filter actually return? If anything outside this building shows up,
  // the listings[] filter silently did nothing and every total below is account-wide.
  const seen: Record<string, number> = {}
  for (const x of n) seen[x.listingId || '(none)'] = (seen[x.listingId || '(none)'] || 0) + 1
  const outsideBuilding = Object.keys(seen).filter(id => id !== '(none)' && !listingIds.includes(id))

  const byMonthLedger: Record<string, Record<string, number>> = {}
  for (const x of n) {
    byMonthLedger[x.month] = byMonthLedger[x.month] || {}
    byMonthLedger[x.month][x.ledger] = money((byMonthLedger[x.month][x.ledger] || 0) + x.amount)
  }

  return NextResponse.json({
    ok: true,
    building,
    window: { from, to },
    listings: listings.map(l => ({ id: l.id, unit: l.unit, status: l.status })),
    owners: matched,
    statements,
    statementsTotalDueToOwner: money(statements.reduce((a, s) => a + (Number(s.dueToOwner) || 0), 0)),
    // The headline answer: revenue credited to the owner before any deduction, the PM
    // commission taken off it, and what the statement therefore owes.
    ownerSummary: {
      rentalIncome: sumOwner(x => x.chargeCode === 'AF'),
      pmCommission: money(ownerLines.filter(x => x.chargeCode === 'CMS').reduce((a, x) => a + x.amount, 0)),
      otherAdjustments: sumOwner(x => x.chargeCode !== 'AF' && x.chargeCode !== 'CMS'),
      netAfterCommission: sumOwner(() => true),
      byChargeCode: Object.entries(ownerByCode).map(([k, v]) => ({ key: k, count: v.count, total: v.total }))
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
      byMonth: ownerByMonth,
    },
    filterCheck: {
      buildingListings: listingIds.length,
      distinctListingsSeen: Object.keys(seen).length,
      outsideBuilding: outsideBuilding.slice(0, 20),
      unattributedRows: seen['(none)'] || 0,
    },
    journal: {
      listingFilterStyle: style,
      rows: rows.length,
      reportedTotal: total,
      truncated,
      grandTotal: money(n.reduce((a, x) => a + x.amount, 0)),
      byLedger: bucket(x => x.ledger || '(none)'),
      byChargeCode: bucket(x => (x.ledger || '-') + ' | ' + (x.chargeCode || '-') + ' | ' + (x.name || '-')),
      byUnit: bucket(x => x.unit),
      byMonthLedger,
      sample: withSample ? redact(rows.slice(0, 3)) : undefined,
    },
  })
}

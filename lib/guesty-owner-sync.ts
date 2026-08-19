// Owner-statement mirror sync: owners, their generated statements, and the Owners-ledger
// journal rows those statements are built from, pulled from Guesty into Supabase.
//
// Why a mirror exists at all: one month of /accounting-api/journal-entries/all takes 78-140s
// and parallel sweeps get 429'd, so this can never run inside a report render. The sync fills
// guesty_owners / guesty_owner_statements / guesty_owner_ledger; the report generator reads
// them instantly through lib/owner-statements.
//
// The ledger is swept ONE MONTH AT A TIME and progress is recorded per month in
// guesty_ledger_months, so the job is resumable across invocations and safe under Vercel's
// 300s ceiling. Rows are upserted on their Guesty id, so re-running a month is idempotent.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getToken } from './guesty'

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

type Res = { status: number; ok: boolean; json: any; error?: string }

// Authed GET with the same 429 backoff lib/guesty's api() uses. Kept local rather than
// importing so the accounting sweep can never be starved by an unrelated change there.
async function gget(path: string, attempt = 1): Promise<Res> {
  const token = await getToken()
  const r = await fetch(BASE + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (r.status === 429 && attempt < 6) {
    await new Promise(res => setTimeout(res, Math.min(1000 * attempt, 8000)))
    return gget(path, attempt + 1)
  }
  if (r.status === 401 && attempt === 1) {
    await getToken(true)
    return gget(path, attempt + 1)
  }
  const text = await r.text().catch(() => '')
  let json: any = null
  try { json = JSON.parse(text) } catch (_e) { /* non-JSON body */ }
  return { status: r.status, ok: r.ok, json, error: r.ok ? undefined : text.slice(0, 300) }
}

const listOf = (j: any): any[] =>
  Array.isArray(j?.results) ? j.results : Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : []

const idsOf = (arr: any): string[] =>
  (Array.isArray(arr) ? arr : [])
    .map((x: any) => String(typeof x === 'string' ? x : (x?._id || x?.id || x?.listingId || '')))
    .filter(Boolean)

async function chunkUpsert(table: string, rows: any[], onConflict: string, size = 500) {
  const sb = supabaseAdmin()
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + size), { onConflict })
    if (error) throw new Error('upsert ' + table + ': ' + error.message)
  }
}

// ─────────────────────────────────────────────────────────────────
// Owners
// ─────────────────────────────────────────────────────────────────
export async function syncOwners(): Promise<number> {
  const rows: any[] = []
  for (let skip = 0; skip < 4000; skip += 100) {
    const r = await gget('/owners?limit=100&skip=' + skip)
    if (!r.ok) {
      if (!skip) throw new Error('owners fetch failed ' + r.status + ': ' + (r.error || ''))
      break
    }
    const batch = listOf(r.json)
    for (const o of batch) {
      const id = String(o._id || o.id || '')
      if (!id) continue
      rows.push({
        id,
        full_name: o.fullName || [o.firstName, o.lastName].filter(Boolean).join(' ') || null,
        email: o.email || null,
        phone: o.phone || null,
        listing_ids: idsOf(o.listings),
        synced_at: new Date().toISOString(),
        raw: o,
      })
    }
    if (batch.length < 100) break
  }
  await chunkUpsert('guesty_owners', rows, 'id')
  return rows.length
}

// ─────────────────────────────────────────────────────────────────
// Statements (header rows; every detail sub-resource 404s)
// ─────────────────────────────────────────────────────────────────
export async function syncOwnerStatements(ownerIds?: string[]): Promise<number> {
  const sb = supabaseAdmin()
  let ids = ownerIds || []
  if (!ids.length) {
    const { data } = await sb.from('guesty_owners').select('id')
    ids = (data || []).map((o: any) => String(o.id))
  }
  const { data: ownerRows } = await sb.from('guesty_owners').select('id, full_name')
  const nameOf: Record<string, string> = {}
  for (const o of ownerRows || []) nameOf[String((o as any).id)] = String((o as any).full_name || '')

  const rows: any[] = []
  for (const id of ids) {
    for (let skip = 0; skip < 2000; skip += 100) {
      const r = await gget('/owner-statement-api/owner-statements?limit=100&skip=' + skip
        + '&ownerId=' + encodeURIComponent(id))
      if (!r.ok) break
      const batch = listOf(r.json)
      for (const s of batch) {
        const sid = String(s._id || s.id || '')
        if (!sid) continue
        const start = String(s.periodStartDate || '').slice(0, 10)
        rows.push({
          id: sid,
          owner_id: id,
          owner_name: s.ownerName || nameOf[id] || null,
          period_start: start || null,
          period_end: String(s.periodEndDate || '').slice(0, 10) || null,
          period_month: start.slice(0, 7) || null,
          statement_type: s.statementType || null,
          ending_balance: Number(s.endingBalance ?? 0) || 0,
          due_to_owner: Number(s.dueToOwner ?? s.endingBalance ?? 0) || 0,
          currency: s.currency || null,
          synced_at: new Date().toISOString(),
          raw: s,
        })
      }
      if (batch.length < 100) break
    }
  }
  await chunkUpsert('guesty_owner_statements', rows, 'id')
  return rows.length
}

// ─────────────────────────────────────────────────────────────────
// Owners-ledger journal rows, one month per call
// ─────────────────────────────────────────────────────────────────
function monthBounds(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10)
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return [first, last]
}

const filterFor = (a: string, b: string) =>
  'transactionDate=' + encodeURIComponent(JSON.stringify({ operator: '@between', value: [a, b] }))

/** Confirm the gateway honours the Owners ledger filter by inspecting rows, not the status. */
async function ledgerParamFor(a: string, b: string): Promise<string> {
  const probe = await gget('/accounting-api/journal-entries/all?limit=5&' + filterFor(a, b) + '&ledger[]=O')
  const rows = listOf(probe.json)
  return (probe.ok && rows.length && rows.every((r: any) => r.ledger === 'Owners')) ? '&ledger[]=O' : ''
}

export type MonthSync = { month: string; rows: number; pages: number; ms: number }

/**
 * Sweep one calendar month of the Owners ledger into guesty_owner_ledger.
 * `deadline` is an epoch ms after which the sweep stops early, recording where it got to so
 * the next call RESUMES from that skip instead of starting over.
 */
export async function syncLedgerMonth(month: string, deadline = Date.now() + 240_000): Promise<MonthSync> {
  const sb = supabaseAdmin()
  const started = Date.now()
  const [a, b] = monthBounds(month)

  // RESUME WHERE THE LAST ATTEMPT STOPPED. A busy month outgrows one invocation's budget —
  // July 2026 crossed 20,000 journal rows and started eating the whole 240s window — and a
  // sweep that restarts from zero every hour never finishes, which starves every month queued
  // behind it (August sat two days stale while July re-swept its first 200 pages hourly).
  // Rows upsert on their Guesty id, so resuming is safe; and after each COMPLETED pass the
  // next re-sweep starts from zero again, which catches late entries that posted into the
  // middle of the ordering between passes.
  const { data: prior } = await sb.from('guesty_ledger_months')
    .select('status, last_error').eq('month', month).maybeSingle()
  const resumed = /deadline reached at skip=(\d+)/.exec(String((prior as any)?.last_error || ''))
  const resumeAt = ((prior as any)?.status !== 'done' && resumed)
    ? Math.max(0, parseInt(resumed[1], 10) - 100)   // one page of overlap, in case a page was mid-write
    : 0

  await sb.from('guesty_ledger_months').upsert({
    month, status: 'running', last_error: null,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  })

  try {
    const ledgerParam = await ledgerParamFor(a, b)
    const cf = filterFor(a, b)
    const seen = new Set<string>()
    let batch: any[] = []
    let total = 0
    let pages = 0

    for (let skip = resumeAt; skip < 60000; skip += 100) {
      if (Date.now() > deadline) throw new Error('deadline reached at skip=' + skip)
      const page = await gget('/accounting-api/journal-entries/all?limit=100&sortByDate=ASC&skip='
        + skip + '&' + cf + ledgerParam)
      if (!page.ok) throw new Error('journal page ' + page.status + ' at skip=' + skip + ': ' + (page.error || ''))
      const results = listOf(page.json)
      pages++
      if (!results.length) break

      for (const r of results) {
        // Rows without their own id are keyed on their content so a re-sweep still upserts
        // onto the same row instead of duplicating.
        const date = String(r.date || '').slice(0, 10)
        const rid = String(r.id || r._id || '')
          || [date, r.chargeCode, r.owner?.id || r.owner?._id, r.amount?.value ?? r.amount].join('|')
        if (seen.has(rid)) continue
        seen.add(rid)
        const L = r.listing
        const href = typeof L === 'object' && L ? String(L.href || '') : ''
        const lid = typeof L === 'string' ? L
          : String(L?._id || L?.id || (href.split('/').filter(Boolean).pop() || ''))
        batch.push({
          id: rid,
          owner_id: String(r.owner?.id || r.owner?._id || '') || null,
          listing_id: lid || null,
          entry_date: date || null,
          entry_month: date.slice(0, 7) || month,
          charge_code: String(r.chargeCode || ''),
          amount: Number(r.amount?.value ?? r.amount ?? 0) || 0,
          recognized: r.recognized !== false,
          ledger: r.ledger || null,
          currency: r.amount?.currency || r.currency || null,
          synced_at: new Date().toISOString(),
          raw: r,
        })
      }
      if (batch.length >= 500) {
        await chunkUpsert('guesty_owner_ledger', batch, 'id')
        total += batch.length
        batch = []
      }
      if (results.length < 100) break
    }
    if (batch.length) { await chunkUpsert('guesty_owner_ledger', batch, 'id'); total += batch.length }

    await sb.from('guesty_ledger_months').upsert({
      month, status: 'done', rows_synced: total, last_error: null,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    return { month, rows: total, pages, ms: Date.now() - started }
  } catch (e: any) {
    await sb.from('guesty_ledger_months').upsert({
      month, status: 'error', last_error: String(e?.message || e).slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    throw e
  }
}

/** Register every month in [from, to] as pending so the sweep has a work queue. */
export async function ensureMonths(from: string, to: string): Promise<string[]> {
  const sb = supabaseAdmin()
  const months: string[] = []
  const [fy, fm] = from.slice(0, 7).split('-').map(Number)
  const cur = new Date(Date.UTC(fy, fm - 1, 1))
  const end = new Date(to.slice(0, 7) + '-01T00:00:00Z')
  while (cur <= end) {
    months.push(cur.toISOString().slice(0, 7))
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  const { data: existing } = await sb.from('guesty_ledger_months').select('month')
  const have = new Set((existing || []).map((r: any) => String(r.month)))
  const fresh = months.filter(m => !have.has(m)).map(m => ({ month: m, status: 'pending' }))
  if (fresh.length) await chunkUpsert('guesty_ledger_months', fresh, 'month')
  return months
}

/**
 * Months still needing work, oldest first: anything not 'done', plus the current and previous
 * month, which are always re-swept because late journal entries and re-recognitions land there.
 */
export async function pendingMonths(nowMonth: string): Promise<string[]> {
  const sb = supabaseAdmin()
  const { data } = await sb.from('guesty_ledger_months').select('month, status').order('month')
  const rows = (data || []) as any[]
  const out = rows.filter(r => r.status !== 'done').map(r => String(r.month))
  const prev = (() => {
    const [y, m] = nowMonth.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 2, 1))
    return d.toISOString().slice(0, 7)
  })()
  for (const m of [prev, nowMonth]) {
    if (rows.some(r => String(r.month) === m) && !out.includes(m)) out.push(m)
  }
  const uniq = Array.from(new Set(out)).sort()
  // CURRENT MONTH FIRST. The team lives in the month that is accruing; a closed month's late
  // journal entries can wait for the leftover budget. Sweeping oldest-first let a heavy July
  // consume every hourly invocation while August starved two days behind.
  return uniq.includes(nowMonth) ? [nowMonth, ...uniq.filter(m => m !== nowMonth)] : uniq
}

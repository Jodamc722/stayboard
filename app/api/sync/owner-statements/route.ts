// Owner-statement mirror sync. Fills guesty_owners / guesty_owner_statements /
// guesty_owner_ledger so the report generator can read real accounting figures instantly
// instead of sweeping Guesty (78-140s per month, and 429s if run in parallel).
//
//   POST/GET /api/sync/owner-statements
//     ?from=2025-12&to=2026-07   register the month range as work (defaults: Dec 2025 → now)
//     ?months=1                  how many pending months to sweep this invocation (default 1)
//     ?month=2026-06             sweep exactly this month, ignoring the queue
//     ?only=owners               owners + statement headers only, no ledger (fast)
//     ?status=1                  read-only: what the mirror currently holds
//
// The ledger sweep is deliberately ONE MONTH AT A TIME. Cron calls this repeatedly and it
// picks up where it left off; the current and previous month are always re-swept because late
// journal entries and re-recognitions land there.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { hasEditCookie } from '@/lib/edit-access'
import { syncOwners, syncOwnerStatements, syncLedgerMonth, ensureMonths, pendingMonths } from '@/lib/guesty-owner-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const etMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7)

// WHY THIS FAILS OPEN WHEN NO SECRET IS SET — the same law as /api/sync/guesty and the cron routes.
// A Vercel cron sends no cookie, so falling through to the signed-in-user check rejected EVERY
// scheduled run: the hourly sweep ('20 * * * *') had never once fired. The owner mirror only moved
// when a human triggered it, and it aged silently — on 2026-08-05 the audit read "no July statements
// generated" while 43 finished statements sat in Guesty, and on 2026-08-11 the board was six days
// stale again. Nothing reports a cron that never ran.
//
// With CRON_SECRET set the bearer token is required (that is the right end state). Without it the
// sync runs open so the schedule works — this route pulls our own accounting data from Guesty into
// our own mirror: it returns no guest information and writes nothing outside the mirror tables.
async function authorize(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET) return true
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user || hasEditCookie()) return true
  return !process.env.CRON_SECRET
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const started = Date.now()
  const qs = new URL(req.url).searchParams
  const sb = supabaseAdmin()

  try {
    // ── PEEK: why doesn't this statement tie? Read-only, signed-in users only.
    //    ?peek=<owner name fragment>&month=YYYY-MM
    // Returns Guesty's own statement object next to OUR ledger arithmetic, split by charge code
    // AND by the recognized flag — because the recognized slice is what the audit reads, so
    // anything sitting outside it is invisible money and the usual reason a statement is "off".
    const peek = qs.get('peek')
    if (peek) {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ error: 'sign in to use peek' }, { status: 403 })
      const month = String(qs.get('month') || etMonth()).slice(0, 7)
      const { data: st } = await sb.from('guesty_owner_statements')
        .select('id, owner_id, owner_name, period_month, ending_balance, due_to_owner, raw')
        .eq('period_month', month).ilike('owner_name', '%' + peek + '%').limit(1)
      const s = (st || [])[0] as any
      if (!s) return NextResponse.json({ ok: false, error: 'no statement for ' + peek + ' in ' + month }, { status: 404 })
      const byCode: Record<string, { recognized: number; unrecognized: number; nRec: number; nUnrec: number }> = {}
      for (let off = 0; off < 60_000; off += 1000) {
        const { data, error } = await sb.from('guesty_owner_ledger')
          .select('charge_code, amount, recognized')
          .eq('entry_month', month).eq('owner_id', s.owner_id)
          .range(off, off + 999)
        if (error) break
        const batch = (data || []) as any[]
        for (const r of batch) {
          const c = String(r.charge_code || '?')
          const b = byCode[c] || (byCode[c] = { recognized: 0, unrecognized: 0, nRec: 0, nUnrec: 0 })
          const eff = Math.round(-(Number(r.amount) || 0) * 100) / 100
          if (r.recognized) { b.recognized = Math.round((b.recognized + eff) * 100) / 100; b.nRec++ }
          else { b.unrecognized = Math.round((b.unrecognized + eff) * 100) / 100; b.nUnrec++ }
        }
        if (batch.length < 1000) break
      }
      return NextResponse.json({
        ok: true, month, owner: s.owner_name,
        statement: { dueToOwner: s.due_to_owner, endingBalance: s.ending_balance, rawKeys: Object.keys(s.raw || {}), raw: s.raw },
        ledgerByCode: byCode,
      })
    }
    if (qs.get('status') === '1') {
      const [owners, stmts, ledger, months] = await Promise.all([
        sb.from('guesty_owners').select('id', { count: 'exact', head: true }),
        sb.from('guesty_owner_statements').select('id', { count: 'exact', head: true }),
        sb.from('guesty_owner_ledger').select('id', { count: 'exact', head: true }),
        sb.from('guesty_ledger_months').select('month, status, rows_synced, last_error, completed_at').order('month'),
      ])
      // A count comes back null on error as well as on an empty table, so report the errors
      // rather than printing a confident row of zeros for a schema that does not exist yet.
      const errs = [owners.error, stmts.error, ledger.error, months.error]
        .map(e => (e ? String(e.message) : ''))
        .filter(Boolean)
      return NextResponse.json({
        ok: errs.length === 0,
        migrated: errs.length === 0,
        owners: owners.count ?? 0,
        statements: stmts.count ?? 0,
        ledgerRows: ledger.count ?? 0,
        months: months.data || [],
        errors: errs,
        hint: errs.length ? 'Run supabase/migrations/014_owner_statements.sql, then sync.' : undefined,
      }, { status: errs.length ? 503 : 200 })
    }

    const out: any = { ok: true }

    // Owners and statement headers are cheap; refresh them on every run.
    out.owners = await syncOwners()
    out.statements = await syncOwnerStatements()
    if (qs.get('only') === 'owners') {
      return NextResponse.json({ ...out, elapsed_ms: Date.now() - started })
    }

    const now = etMonth()
    const from = qs.get('from') || '2025-12'
    const to = qs.get('to') || now
    await ensureMonths(from, to)

    const explicit = qs.get('month')
    const queue = explicit ? [explicit] : await pendingMonths(now)
    const budget = Math.max(1, Math.min(4, Number(qs.get('months') || 1)))
    // Leave headroom under maxDuration so a month that runs long still returns a real answer.
    const hardStop = started + 270_000

    const swept: any[] = []
    for (const m of queue.slice(0, budget)) {
      if (Date.now() > hardStop - 30_000) break
      try {
        swept.push(await syncLedgerMonth(m, hardStop))
      } catch (e: any) {
        swept.push({ month: m, error: String(e?.message || e).slice(0, 300) })
        break
      }
    }
    out.swept = swept
    out.remaining = (await pendingMonths(now)).filter(m => !swept.some(s => s.month === m && !s.error))
    return NextResponse.json({ ...out, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e), elapsed_ms: Date.now() - started }, { status: 500 })
  }
}

export const GET = POST

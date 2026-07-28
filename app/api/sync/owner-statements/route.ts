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

async function authorize(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET) return true
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user || hasEditCookie()
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const started = Date.now()
  const qs = new URL(req.url).searchParams
  const sb = supabaseAdmin()

  try {
    if (qs.get('status') === '1') {
      const [owners, stmts, ledger, months] = await Promise.all([
        sb.from('guesty_owners').select('id', { count: 'exact', head: true }),
        sb.from('guesty_owner_statements').select('id', { count: 'exact', head: true }),
        sb.from('guesty_owner_ledger').select('id', { count: 'exact', head: true }),
        sb.from('guesty_ledger_months').select('month, status, rows_synced, last_error, completed_at').order('month'),
      ])
      return NextResponse.json({
        ok: true,
        owners: owners.count ?? 0,
        statements: stmts.count ?? 0,
        ledgerRows: ledger.count ?? 0,
        months: months.data || [],
      })
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

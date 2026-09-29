// NIGHTLY: judge any routine task (unit check / strip) with a real description that the desk has
// not already sent to the model — this month and last, so a late-finished task still gets its
// verdict before the statement closes. Same bearer rule as every other cron here.
import { NextRequest, NextResponse } from 'next/server'
import { judgeRoutineTasks } from '@/lib/billing-ai'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function shiftMonth(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

// RECEIPT (2026-09-28): one row per night, counting tasks judged.
const receipted = withRouteReceipt<NextRequest>('billing-ai', run, { count: (b) => (typeof b.judged === 'number' ? b.judged : undefined) })
export async function GET(req: NextRequest) { return receipted(req) }

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
  const out: Record<string, any> = {}
  let judged = 0
  for (const m of [month, shiftMonth(month, -1)]) {
    // Up to three batches per month per night; the desk handles the rest on demand.
    for (let i = 0; i < 3; i++) {
      const r = await judgeRoutineTasks(m)
      out[m] = r
      judged += Number(r.judged) || 0
      if (!r.ok || r.pending === 0) break
    }
  }
  // HONEST OK (2026-09-28): this used to answer ok:true even when the model or the save failed.
  const failed = Object.keys(out).filter(m => out[m] && out[m].ok === false)
  return NextResponse.json({
    ok: failed.length === 0, judged, months: out,
    ...(failed.length ? { error: failed.map(m => m + ': ' + String(out[m].error || 'failed')).join('; ').slice(0, 300) } : {}),
  })
}

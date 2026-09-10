// NIGHTLY: judge any routine task (unit check / strip) with a real description that the desk has
// not already sent to the model — this month and last, so a late-finished task still gets its
// verdict before the statement closes. Same bearer rule as every other cron here.
import { NextRequest, NextResponse } from 'next/server'
import { judgeRoutineTasks } from '@/lib/billing-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function shiftMonth(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
  const out: Record<string, any> = {}
  for (const m of [month, shiftMonth(month, -1)]) {
    // Up to three batches per month per night; the desk handles the rest on demand.
    for (let i = 0; i < 3; i++) {
      const r = await judgeRoutineTasks(m)
      out[m] = r
      if (!r.ok || r.pending === 0) break
    }
  }
  return NextResponse.json({ ok: true, months: out })
}

// POST /api/billing/ai-check { month } — judge the month's routine tasks (unit check / strip) that
// carry a real description, once each, and store the verdicts. The review desk calls this when
// its payload says aiPending > 0; the nightly cron (/api/cron/billing-ai) catches whatever is left.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { judgeRoutineTasks } from '@/lib/billing-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const month = String(body?.month || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ ok: false, error: 'month=YYYY-MM required' }, { status: 400 })
  try {
    const r = await judgeRoutineTasks(month)
    return NextResponse.json(r, { status: r.ok ? 200 : 502 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

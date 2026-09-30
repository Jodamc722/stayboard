// THE BILLABLE MODEL (lib/billable-model).
//   GET                              → { trainedAt, kinds }                     (billing view)
//   POST { op: 'train' }             → learn from the last 120 days' decisions   (billing edit)
//   POST { op: 'judge', from, to }   → the model reads up to 40 MAYBEs with a description (billing edit)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { loadModel, trainModel, judgeMaybes } from '@/lib/billable-model'
import { billingRange } from '@/lib/billing'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const isYmd = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

export async function GET() {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const m = await loadModel()
  return NextResponse.json({ ok: true, trainedAt: m.at || null, kinds: Object.keys(m.keys).length, aiRead: Object.keys(m.ai).length })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  try {
    if (b?.op === 'train') return NextResponse.json({ ok: true, ...(await trainModel()) })
    if (b?.op === 'judge') {
      if (!isYmd(b.from) || !isYmd(b.to)) return NextResponse.json({ ok: false, error: 'from/to required' }, { status: 400 })
      const { tasks } = await billingRange(b.from, b.to)
      const maybes = tasks.filter(t => t.billable.verdict === 'maybe' && !t.billable.ai && String(t.description || '').trim().length > 15 && t.reviewState !== 'gm_approved')
        .slice(0, 40).map(t => ({ id: t.id, name: t.name, description: t.description, department: t.department, minutes: t.actualMinutes, lines: t.items.map(i => ({ what: i.description, amount: i.amount })) }))
      return NextResponse.json({ ok: true, ...(await judgeMaybes(maybes)) })
    }
    return NextResponse.json({ ok: false, error: 'unknown op' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}

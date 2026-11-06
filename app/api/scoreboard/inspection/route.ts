// THE INSPECTION READER (Jon, 2026-11-06: "read the inspection"). One stored inspection, every line —
// for the Team scoreboard's reader. GET ?task=<breezeway task id>. Training view.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { inspectionDetail } from '@/lib/inspection-reports'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireLevel('training', 'view')
  if (!gate.ok) return gate.res
  try {
    const r = await inspectionDetail(String(new URL(req.url).searchParams.get('task') || ''))
    return NextResponse.json(r, { status: r.ok ? 200 : r.needsMigration ? 409 : 404 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }) }
}

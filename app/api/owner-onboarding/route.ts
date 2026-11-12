// OWNER ONBOARDING, THE TEAM'S SIDE (lib/owner-onboard).
//   GET                → every onboarding link, newest activity first
//   POST { custom, attach, home?, teamNotes? } → a new link (its code)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listRecords, createRecord } from '@/lib/owner-onboard-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  return NextResponse.json({ ok: true, links: await listRecords() })
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  try { const r = await createRecord(b, String(g.access.email || '')); return NextResponse.json({ ok: true, code: r.code }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}

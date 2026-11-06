// THE LISTING COPY AUDIT (Jon, 2026-11-06) — the Copy audit tab on /admin.
//   GET   every active listing's copy checked: over the channel limits, wrong facts, empty sections,
//         and the last Regenerate push that did not stick in Guesty.
//   POST  { listingId, synced, missing } — recorded after a Regenerate push is read back from Guesty.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildCopyAudit, recordPush } from '@/lib/copy-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const g = await requireLevel('admin-desk', 'view')
  if (!g.ok) return g.res
  try {
    return NextResponse.json({ ok: true, ...(await buildCopyAudit()) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // Whoever can push copy can record how the push went.
  const g = await requireLevel('optimize', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const id = String(b?.listingId || '').trim()
  if (!id) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const r = await recordPush(id, !!b.synced, Array.isArray(b.missing) ? b.missing.map(String) : [], g.access?.email || null)
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}

// CLOUDBEDS AUDIT (lib/garden/audit). GET → the last run; POST → run it now.
import { NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { runAudit, lastAudit, explore } from '@/lib/garden/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await requireGarden('setup', 'view')
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, audit: await lastAudit() })
}
export async function POST(req: Request) {
  const gate = await requireGarden('setup', 'edit')
  if (!gate.ok) return gate.res
  const b: any = await req.json().catch(() => ({}))
  if (b?.op === 'explore' && /^get[A-Za-z]+$/.test(String(b.endpoint || ''))) {
    try { return NextResponse.json({ ok: true, result: await explore(b.endpoint, b.params || {}, b.version || 'v1.2') }) }
    catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
  }
  try { return NextResponse.json({ ok: true, audit: await runAudit() }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

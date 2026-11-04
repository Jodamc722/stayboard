// CLOUDBEDS AUDIT (lib/garden/audit). GET → the last run; POST → run it now.
import { NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { runAudit, lastAudit } from '@/lib/garden/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await requireGarden('setup', 'view')
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, audit: await lastAudit() })
}
export async function POST() {
  const gate = await requireGarden('setup', 'edit')
  if (!gate.ok) return gate.res
  try { return NextResponse.json({ ok: true, audit: await runAudit() }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

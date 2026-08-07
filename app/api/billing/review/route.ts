// PER-OWNER MONTH REVIEW / CLOSE-OUT. Marking an owner "reviewed" for a month moves them into
// the board's "Reviewed — ready to download" section and into the reviewed-only ZIP — the
// operator's sign-off that this owner's billables are checked and statement-ready.
// Stored per month in app_settings ('billing_review:<YYYY-MM>' → { ownerKey: { by, at } }).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

const keyFor = (month: string) => 'billing_review:' + String(month || '').slice(0, 7)

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const month = String(body?.month || '').slice(0, 7)
  const ownerKey = String(body?.ownerId || '').slice(0, 60)
  if (!/^\d{4}-\d{2}$/.test(month) || !ownerKey) return NextResponse.json({ ok: false, error: 'month and ownerId required' }, { status: 400 })
  const cur = await getSetting<Record<string, any>>(keyFor(month), {})
  const next: Record<string, any> = { ...cur }
  if (body?.reviewed) next[ownerKey] = { by: gate.access.email || 'unknown', at: new Date().toISOString() }
  else delete next[ownerKey]
  const r = await setSetting(keyFor(month), next, gate.access.email)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, reviews: next })
}

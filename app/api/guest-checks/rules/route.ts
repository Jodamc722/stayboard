// THE RULES (Jon, 2026-10-03: "allow us to customize the rules"). GET for anyone on the desk; POST admins.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { loadGuestCheckRules, saveGuestCheckRules } from '@/lib/guest-check-rules'
import { CHANNELS, DEFAULT_CHECK_RULES, DEPOSIT_METHODS } from '@/lib/welcome-call-guide'
export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireLevel('welcome-calls', 'view')
  if (!g.ok) return g.res
  return NextResponse.json({ ok: true, channels: CHANNELS, rules: await loadGuestCheckRules(), defaults: DEFAULT_CHECK_RULES, methods: DEPOSIT_METHODS, canEdit: g.access.role === 'admin' })
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'edit')
  if (!g.ok) return g.res
  if (g.access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Admins change the rules.' }, { status: 403 })
  const b = await req.json().catch(() => ({} as any))
  const r = await saveGuestCheckRules(b?.rules || b, String(g.access.email || ''))
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, rules: await loadGuestCheckRules() })
}

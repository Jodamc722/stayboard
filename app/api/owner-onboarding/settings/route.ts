// Who the handoff email goes to (lib/owner-onboard-mail): GET, and POST { to, cc, replyTo } (full access).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readOOSettings, saveOOSettings } from '@/lib/owner-onboard-mail'

export const dynamic = 'force-dynamic'
export async function GET() {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  return NextResponse.json({ ok: true, settings: await readOOSettings() })
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('owner-onboarding', 'full'); if (!g.ok) return g.res
  return NextResponse.json({ ok: true, settings: await saveOOSettings(await req.json().catch(() => ({})), g.access.email || null) })
}

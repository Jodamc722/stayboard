// Email the owner their private onboarding link (a magic link, good for 7 days). Team only.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { emailMagicLink } from '@/lib/owner-onboard-auth'
import { teamView } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const s = await emailMagicLink(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, 'invite')
  await saveRecord(r, g.access.email || null)
  return NextResponse.json({ ok: s.ok, error: s.error, record: teamView(r) }, { status: s.ok ? 200 : 502 })
}

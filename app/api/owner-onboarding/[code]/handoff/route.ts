// Send (or resend) the handoff to accounting for one onboarding (lib/owner-onboard-mail).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { sendHandoff } from '@/lib/owner-onboard-mail'
import { teamView } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const h = await sendHandoff(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin)
  r.handoff = { at: new Date().toISOString(), to: h.to, cc: h.cc, ...(h.ok ? {} : { error: String(h.error || 'not sent').slice(0, 200) }) }
  await saveRecord(r, g.access.email || null)
  return NextResponse.json({ ok: h.ok, error: h.error, record: teamView(r) }, { status: h.ok ? 200 : 502 })
}

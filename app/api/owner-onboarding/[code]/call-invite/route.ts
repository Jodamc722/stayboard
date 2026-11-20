// Send (or send again) the email that asks the owner to book the onboarding call (lib/owner-onboard-callinvite).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { sendCallInvite } from '@/lib/owner-onboard-callinvite'
import { teamView } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const prev = r.callInvite
  const s = await sendCallInvite(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, String(g.access.email || ''))
  if (!s.ok && prev?.at) r.callInvite = prev          // a failed resend does not erase the one that went
  await saveRecord(r, g.access.email || null)
  return NextResponse.json({ ok: s.ok, error: s.error, to: s.to, record: teamView(r) }, { status: s.ok ? 200 : 502 })
}

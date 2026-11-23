// Send (or send again) the pricing email to Pacer for this onboarding's listing (lib/owner-onboard-pricing).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { sendPricingBrief } from '@/lib/owner-onboard-pricing'
import { teamView } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export async function POST(_req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const prev = r.pricingBrief
  const s = await sendPricingBrief(r, String(g.access.email || ''))
  if (!s.ok && prev?.at) r.pricingBrief = { ...prev, error: s.error }   // a failed resend does not erase the one that went
  await saveRecord(r, g.access.email || null)
  return NextResponse.json({ ok: s.ok, error: s.error, to: s.to, record: teamView(r) }, { status: s.ok ? 200 : 502 })
}

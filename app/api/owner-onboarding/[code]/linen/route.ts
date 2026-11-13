// The linen order for one onboarding: POST { action: 'approve' | 'unapprove' | 'send' }. Sending emails the
// approved quantities to the linen vendor (lib/owner-onboard-mail), copying the team.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord, itemsFor } from '@/lib/owner-onboard-server'
import { sendLinenToVendor } from '@/lib/owner-onboard-mail'
import { teamView } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  const by = String(g.access.email || '')
  let error = ''
  if (b.action === 'approve') r.linen = { ...(r.linen || {}), approvedAt: new Date().toISOString(), approvedBy: by }
  else if (b.action === 'unapprove') r.linen = null
  else if (b.action === 'send') {
    if (!r.linen?.approvedAt) return NextResponse.json({ ok: false, error: 'Approve the linen quote first.' }, { status: 400 })
    const s = await sendLinenToVendor(r, await itemsFor(r))
    if (s.ok) r.linen = { ...r.linen, sentAt: new Date().toISOString(), sentTo: [...s.to, ...s.cc], error: undefined }
    else { error = s.error || 'Not sent.'; r.linen = { ...r.linen, error } }
  } else return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  await saveRecord(r, by || null)
  return NextResponse.json({ ok: !error, error: error || undefined, record: teamView(r) }, { status: error ? 502 : 200 })
}

// The linen order for one onboarding: POST { action: 'approve' | 'unapprove' | 'send' | 'save' (rows, note) | 'reset' }.
// Saving the team's own lines (or going back to the standard) clears the approval: what is approved is what is sent. Sending emails the
// approved quantities to the linen vendor (lib/owner-onboard-mail), copying the team.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord, itemsFor, cleanLinenRows } from '@/lib/owner-onboard-server'
import { sendLinenToVendor } from '@/lib/owner-onboard-mail'
import { teamView, unitsOf } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  const by = String(g.access.email || '')
  let error = ''
  if (b.action === 'approve') r.linen = { ...(r.linen || {}), approvedAt: new Date().toISOString(), approvedBy: by }
  else if (b.action === 'unapprove') r.linen = { rows: r.linen?.rows, editedAt: r.linen?.editedAt, editedBy: r.linen?.editedBy, note: r.linen?.note }
  else if (b.action === 'save') { const rows = cleanLinenRows(b.rows, unitsOf(r).length); if (!rows.length) return NextResponse.json({ ok: false, error: 'The quote needs at least one line.' }, { status: 400 }); r.linen = { rows, editedAt: new Date().toISOString(), editedBy: by, note: String(b.note || '').slice(0, 1000) } }
  else if (b.action === 'reset') r.linen = r.linen?.note ? { note: r.linen.note } : null
  else if (b.action === 'send') {
    if (!r.linen?.approvedAt) return NextResponse.json({ ok: false, error: 'Approve the linen quote first.' }, { status: 400 })
    const s = await sendLinenToVendor(r, await itemsFor(r))
    if (s.ok) r.linen = { ...r.linen, sentAt: new Date().toISOString(), sentTo: [...s.to, ...s.cc], error: undefined }
    else { error = s.error || 'Not sent.'; r.linen = { ...r.linen, error } }
  } else return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  await saveRecord(r, by || null)
  return NextResponse.json({ ok: !error, error: error || undefined, record: teamView(r), items: await itemsFor(r) }, { status: error ? 502 : 200 })
}

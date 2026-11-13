// The linen order for one onboarding: POST { action: 'approve' | 'unapprove' | 'send' | 'save' (rows, note) | 'reset' }.
// Saving the team's own lines (or going back to the standard) clears the approval: what is approved is what is sent. Sending emails the
// approved quantities to the linen vendor (lib/owner-onboard-mail), copying the team.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord, itemsFor, cleanLinenRows } from '@/lib/owner-onboard-server'
import { sendLinenToVendor } from '@/lib/owner-onboard-mail'
import { teamView, unitsOf } from '@/lib/owner-onboard'
import { buildQuotePdf } from '@/lib/order-pdf'

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

// GET → the quote request as a PDF, to send to a supplier by hand (Jon, 2026-11-13: "adjust the quote… before
// emailing or downloading it for sending to supplier"). Quantities only, as edited: the supplier prices it.
export async function GET(_: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const linen = (await itemsFor(r)).filter(i => i.linen)
  if (!linen.length) return NextResponse.json({ ok: false, error: 'There is no linen list yet: fill in the home first.' }, { status: 400 })
  const units = Array.from(new Set(linen.map(i => i.unit))).sort((a, b) => a - b)
  const label = (u: number) => linen.find(i => i.unit === u)?.unitLabel || 'Unit ' + (u + 1)
  const keys = Array.from(new Set(linen.map(i => i.name + '|' + (i.size || ''))))
  const qty = (k: string, u: number) => linen.filter(i => i.unit === u && i.name + '|' + (i.size || '') === k).reduce((a, i) => a + i.qty, 0)
  const multi = units.length > 1 && units.length <= 6
  const where = [r.attach.property, r.home?.address].filter(Boolean).join(' - ') || 'New home'
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())
  const total = linen.reduce((a, i) => a + i.qty, 0)
  const pdf = buildQuotePdf({
    title: 'Linen quote request', subtitle: where,
    meta: [{ label: 'Date', value: date }, { label: 'From', value: 'Stay Hospitality' }, { label: units.length === 1 ? 'Unit' : 'Units', value: units.map(label).join(', ') }, { label: 'Pieces', value: total.toLocaleString('en-US') }],
    columns: [{ header: 'Item', width: multi ? 38 : 60, wrap: true }, { header: 'Size', width: multi ? 14 : 22 }, ...(multi ? units.map(u => ({ header: label(u), width: Math.floor(36 / units.length), align: 'r' as const })) : []), { header: 'Total', width: multi ? 12 : 18, align: 'r' as const }],
    sections: [{ heading: 'Quantities at par', rows: keys.map(k => { const [n, z] = k.split('|'); const per = units.map(u => qty(k, u)); return [n, z || '', ...(multi ? per.map(q => (q ? String(q) : '')) : []), String(per.reduce((a, b) => a + b, 0))] }) }],
    totals: [{ label: 'Total pieces', value: total.toLocaleString('en-US'), strong: true }],
    note: [String(r.linen?.note || '').replace(/\s+/g, ' ').trim().replace(/([^.!?])$/, '$1.'), 'Please reply with pricing and lead time.'].filter(Boolean).join(' '),
  })
  const name = (where.replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Linen') + ' - Linen quote request.pdf'
  return new NextResponse(pdf as any, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } })
}

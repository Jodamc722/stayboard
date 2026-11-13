// The order list for one onboarding (lib/owner-onboard OOOrder).
//   POST { action: 'build' }          → a first list from Stay's catalog, sized to the units (replaces a draft)
//   POST { action: 'save', lines, note } → the team's edits
//   POST { action: 'send' }           → shows it on the owner's page for review and emails them a sign-in link to it
//   POST { action: 'unsend' }         → back to a draft
//   POST { action: 'faq' }            → adds what is approved (and the Wi-Fi, parking, laundry) to the attached listing's FAQ
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord, buildOrder, cleanOrderLines } from '@/lib/owner-onboard-server'
import { emailMagicLink, accounts } from '@/lib/owner-onboard-auth'
import { teamView, unitsOf } from '@/lib/owner-onboard'
import { syncFaq } from '@/lib/owner-onboard-faq'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  let note = ''
  if (b.action === 'build') {
    if (!r.home) return NextResponse.json({ ok: false, error: 'Fill in the home first.' }, { status: 400 })
    r.order = buildOrder(r)
  } else if (b.action === 'save' && r.order) {
    r.order = { ...r.order, lines: cleanOrderLines(b.lines, unitsOf(r).length), note: String(b.note || '').slice(0, 1000) }
  } else if (b.action === 'send' && r.order) {
    if (!r.order.lines.length) return NextResponse.json({ ok: false, error: 'The list is empty.' }, { status: 400 })
    r.order = { ...r.order, status: 'sent', sentAt: new Date().toISOString(), review: undefined }
    // every owner on the link with an email gets their own link to the list
    const to = accounts(r).filter(a => a.email)
    if (to.length) { let sent = 0; for (const a of to) { const m = await emailMagicLink(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, 'order', a.id).catch(() => ({ ok: false })); if (m.ok) sent++ } note = sent === to.length ? (to.length > 1 ? `All ${to.length} owners were emailed a link to review it.` : 'The owner was emailed a link to review it.') : sent ? `It is on the owners’ page; ${sent} of ${to.length} emails sent.` : 'It is on the owner’s page, but the email did not send.' }
    else note = 'It is on the owner’s page. There is no owner email, so send them the link yourself.'
  } else if (b.action === 'unsend' && r.order) {
    r.order = { ...r.order, status: 'draft' }
  } else if (b.action === 'faq') {
    const f = await syncFaq(r, g.access.email || null)
    if (!f.ok) return NextResponse.json({ ok: false, error: f.error }, { status: 400 })
    note = f.added ? `${f.added} ${f.added === 1 ? 'entry' : 'entries'} added to the unit’s FAQ.` : 'The FAQ already has everything.'
  } else return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  await saveRecord(r, g.access.email || null)
  return NextResponse.json({ ok: true, note, record: teamView(r) })
}

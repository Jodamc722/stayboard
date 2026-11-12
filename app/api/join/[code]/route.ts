// OWNER ONBOARDING, THE OWNER'S SIDE (lib/owner-onboard), /join/<code>. Public: the code in the link is the key, checked on
// every call. GET → what the owner sees (no team notes) and the item list; PATCH { home?, marks?, ownerNotes?,
// submit? } → saves as they go. The timeline moves on its own: the home saved → "Your home" done; submitted →
// "Supplies check" done, and the team is told.
import { NextRequest, NextResponse } from 'next/server'
import { readRecord, saveRecord, itemsFor } from '@/lib/owner-onboard-server'
import { cleanHome, ownerView, routingOk, OO_TAX_CLASS, type OOPayout } from '@/lib/owner-onboard'
import { encryptSecret, maskHint, vaultKeyReady } from '@/lib/vault'
import { sendHandoff } from '@/lib/owner-onboard-mail'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const hits = new Map<string, number[]>()
const limited = (k: string) => { const now = Date.now(), w = (hits.get(k) || []).filter(t => now - t < 60_000); w.push(now); hits.set(k, w); if (hits.size > 5000) hits.clear(); return w.length > 90 }

export async function GET(_: NextRequest, { params }: { params: { code: string } }) {
  const r = await readRecord(params.code)
  if (!r || r.archived) return NextResponse.json({ ok: false, error: 'This onboarding link is not active. Ask your Stay Hospitality contact for a new one.' }, { status: 404, headers: NO_STORE })
  const items = r.home ? await itemsFor(r.home, { supplies: r.custom.askSupplies, linen: r.custom.askLinen }) : []
  return NextResponse.json({ ok: true, record: ownerView(r), items }, { headers: NO_STORE })
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  if (limited(params.code)) return NextResponse.json({ ok: false, error: 'Too many saves. Wait a moment.' }, { status: 429, headers: NO_STORE })
  const r = await readRecord(params.code)
  if (!r || r.archived) return NextResponse.json({ ok: false, error: 'This onboarding link is not active.' }, { status: 404, headers: NO_STORE })
  const b = await req.json().catch(() => ({} as any))
  const step = (k: string) => r.steps.find(s => s.key === k)!
  const today = new Date().toISOString().slice(0, 10)
  if (b.home) {
    r.home = cleanHome(b.home)
    if (step('details').status !== 'done') { step('details').status = 'done'; step('details').date = today }
    if (step('supplies').status === 'todo') step('supplies').status = 'doing'
  }
  if (b.marks && typeof b.marks === 'object') {
    let n = 0
    for (const [k, v] of Object.entries(b.marks)) { if (++n > 600) break; if (v === 'have' || v === 'need' || v === '') r.marks[String(k).slice(0, 120)] = v as any }
  }
  if (typeof b.ownerNotes === 'string') r.ownerNotes = b.ownerNotes.slice(0, 4000)
  // THE W-9 AND ACH: checked, then the tax ID and bank numbers are encrypted before anything is saved.
  let firstPayout = false
  if (b.payout) {
    if (!vaultKeyReady()) return NextResponse.json({ ok: false, error: 'Secure storage is not set up yet. Please tell your Stay Hospitality contact.' }, { status: 503, headers: NO_STORE })
    const w = b.payout.w9 || {}, a = b.payout.ach || {}, sg = b.payout.sign || {}
    const s = (v: any, n: number) => String(v || '').trim().slice(0, n)
    const tin = String(w.tin || '').replace(/\D/g, ''), routing = String(a.routing || '').replace(/\D/g, ''), account = String(a.account || '').replace(/\D/g, '')
    const keepTin = !tin && r.payout?.w9.tinEnc, keepBank = !routing && !account && r.payout?.ach.routingEnc
    const bad = !s(w.name, 120) ? 'Enter the name as shown on your tax return.' : !keepTin && tin.length !== 9 ? 'The SSN or EIN must be 9 digits.' : !s(w.address, 200) || !s(w.cityStateZip, 120) ? 'Enter the address for the W-9.'
      : !keepBank && !routingOk(routing) ? 'That routing number is not valid. It is the 9 digits at the bottom left of a check.' : !keepBank && (account.length < 4 || account.length > 17) ? 'The account number should be 4 to 17 digits.'
      : !s(a.holder, 120) || !s(a.bank, 120) ? 'Enter the account holder and the bank.' : !s(sg.name, 120) || !sg.agree ? 'Type your full name and confirm, to sign.' : ''
    if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 400, headers: NO_STORE })
    const prev = r.payout
    const p: OOPayout = {
      w9: { name: s(w.name, 120), business: s(w.business, 120), taxClass: OO_TAX_CLASS.some(c => c.key === w.taxClass) ? w.taxClass : 'individual', llcCode: s(w.llcCode, 1).toUpperCase(), other: s(w.other, 80), address: s(w.address, 200), cityStateZip: s(w.cityStateZip, 120),
        tinType: w.tinType === 'ein' ? 'ein' : 'ssn', tinEnc: keepTin ? prev!.w9.tinEnc : encryptSecret(tin), tinHint: keepTin ? prev!.w9.tinHint : maskHint(tin) },
      ach: { holder: s(a.holder, 120), bank: s(a.bank, 120), accountType: a.accountType === 'savings' ? 'savings' : 'checking',
        routingEnc: keepBank ? prev!.ach.routingEnc : encryptSecret(routing), routingHint: keepBank ? prev!.ach.routingHint : maskHint(routing),
        accountEnc: keepBank ? prev!.ach.accountEnc : encryptSecret(account), accountHint: keepBank ? prev!.ach.accountHint : maskHint(account) },
      sign: { name: s(sg.name, 120), at: new Date().toISOString(), ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60) },
    }
    firstPayout = !r.payout
    r.payout = p
    if (step('paperwork')) { step('paperwork').status = 'done'; step('paperwork').date = today }
  }
  const firstSubmit = !!b.submit && !r.submittedAt
  if (b.submit) {
    r.submittedAt = r.submittedAt || new Date().toISOString()
    for (const k of ['details', 'supplies']) { if (step(k).status !== 'done') { step(k).status = 'done'; step(k).date = today } }
    if (step('photos').status === 'todo') step('photos').status = 'doing'
  }
  // Paperwork in → the handoff to accounting, once (the team can resend from the onboarding page).
  if (firstPayout) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
    const h = await sendHandoff(r, origin).catch((e: any) => ({ ok: false, error: String(e?.message || e), to: [] as string[], cc: [] as string[] }))
    r.handoff = { at: new Date().toISOString(), to: h.to, cc: h.cc, ...(h.ok ? {} : { error: String(h.error || 'not sent').slice(0, 200) }) }
  }
  const w = await saveRecord(r, 'owner:' + (r.custom.ownerEmail || r.code))
  if (!w.ok) return NextResponse.json(w, { status: 500, headers: NO_STORE })
  if (firstSubmit) {
    try {
      const who = [r.createdBy, r.custom.gm.email, r.custom.from === 'sales' ? r.custom.sales.email : ''].filter(Boolean)
      await notify(who, { kind: 'owner_onboarding', title: `${r.custom.ownerName || 'An owner'} finished the onboarding form`, body: [r.attach.property, r.attach.unitLabel].filter(Boolean).join(' · ') || 'Their home details and supplies check are in.', link: '/owner-onboarding/' + r.code })
    } catch { /* saved; the bell is a courtesy */ }
  }
  const items = r.home ? await itemsFor(r.home, { supplies: r.custom.askSupplies, linen: r.custom.askLinen }) : []
  return NextResponse.json({ ok: true, record: ownerView(r), items }, { headers: NO_STORE })
}

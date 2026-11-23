// One onboarding link, for the team: the whole record and the item list (GET); the team's changes (PATCH):
// the owner and sender details, attach to a property and unit, the timeline, the onboarding call, team notes,
// the home itself, archive.
import { syncFaq } from '@/lib/owner-onboard-faq'
import { NextRequest, NextResponse } from 'next/server'
import { pinHomes } from '@/lib/geo'
import { requireLevel, requireAdmin, isSuperadmin } from '@/lib/access'
import { readRecord, saveRecord, deleteRecord, itemsFor, cleanCustom, cleanMore, cleanOwners, mergeCounts, ensureWalk, linenCountsChanged } from '@/lib/owner-onboard-server'
import { liveDone, sendPricingBrief } from '@/lib/owner-onboard-pricing'
import { cleanHome, cleanDeal, OO_STEPS, teamView, readyForCall, type OOStep } from '@/lib/owner-onboard'
import { maybeSendCallInvite } from '@/lib/owner-onboard-callinvite'

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const items = await itemsFor(r)
  return NextResponse.json({ ok: true, record: teamView(r), items, canDelete: isSuperadmin(g.access.email) })
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  const wasReady = readyForCall(r)
  const wasLive = liveDone(r)
  if (b.custom) r.custom = cleanCustom(b.custom, r.custom)
  if (Array.isArray(b.owners)) r.owners = cleanOwners(b.owners, r.owners)
  const hadListing = r.attach.listingId
  if (b.attach) r.attach = { property: String(b.attach.property ?? r.attach.property).slice(0, 120), listingId: String(b.attach.listingId ?? r.attach.listingId).slice(0, 60), unitLabel: String(b.attach.unitLabel ?? r.attach.unitLabel).slice(0, 60) }
  if (b.home) r.home = cleanHome(b.home)
  if (Array.isArray(b.more)) r.more = cleanMore(b.more)
  if (b.home || Array.isArray(b.more)) await pinHomes([r.home, ...(r.more || [])])
  if (typeof b.teamNotes === 'string') r.teamNotes = b.teamNotes.slice(0, 4000)
  if (b.marks && typeof b.marks === 'object') for (const [k, v] of Object.entries(b.marks)) if (v === 'have' || v === 'need' || v === '') r.marks[String(k).slice(0, 120)] = v as any
  if (b.counts && typeof b.counts === 'object') r.counts = mergeCounts(r.counts || {}, b.counts)
  if (b.walkCounts && typeof b.walkCounts === 'object') { const w = ensureWalk(r); w.counts = mergeCounts(w.counts || {}, b.walkCounts); linenCountsChanged(r, b.walkCounts) }
  if (b.decisions && typeof b.decisions === 'object') { const d = { ...(r.decisions || {}) }; let n = 0; for (const [k, v] of Object.entries(b.decisions)) { if (++n > 800) break; if (v === 'no-buy' || v === 'owner') d[String(k).slice(0, 120)] = v; else { delete d[String(k).slice(0, 120)]; /* clearing it also clears the owner's own "Don't want" */ if (r.marks[String(k).slice(0, 120)] === 'skip') r.marks[String(k).slice(0, 120)] = '' } } r.decisions = d }
  if (Array.isArray(b.steps)) {
    const keys = OO_STEPS.map(s => s.key)
    r.steps = keys.map(k => { const n: any = b.steps.find((x: any) => x?.key === k) || r.steps.find(x => x.key === k) || {}; return { key: k, status: ['todo', 'doing', 'done'].includes(n.status) ? n.status : 'todo', date: String(n.date || '').slice(0, 30), note: String(n.note || '').slice(0, 300) } as OOStep })
  }
  if (b.call) {
    r.call = { at: String(b.call.at ?? r.call.at).slice(0, 40), link: String(b.call.link ?? r.call.link).slice(0, 300), note: String(b.call.note ?? r.call.note).slice(0, 500) }
    const st = r.steps.find(s => s.key === 'call'); if (st && r.call.at && st.status === 'todo') { st.status = 'doing'; st.date = r.call.at.slice(0, 10) }
  }
  if (typeof b.archived === 'boolean') r.archived = b.archived
  // the live date and the management fee (lib/owner-onboard OODeal)
  if (b.deal && typeof b.deal === 'object') r.deal = cleanDeal(b.deal, r.deal)
  // the introductory email goes from a person's own mailbox, so sending it is recorded by hand (or by pressing Open in my email)
  if (b.intro && typeof b.intro === 'object') r.intro = b.intro.sent === false ? null : { at: new Date().toISOString(), by: String(g.access.email || '').slice(0, 160), from: b.intro.from === 'gm' ? 'gm' : 'sales' }
  // THE UNIT JUST GOT ITS LISTING: what the owner told us and approved goes into that listing's FAQ.
  if (r.attach.listingId && r.attach.listingId !== hadListing) await syncFaq(r, g.access.email || null).catch(() => null)
  // PHOTOS AND LISTING JUST BECAME DONE: the owner gets the link to book the onboarding call, once. Only on the
  // change itself, so an onboarding that was already past this point is never emailed out of the blue.
  const callInvite = Array.isArray(b.steps) && !wasReady && readyForCall(r) ? await maybeSendCallInvite(r, process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin, 'auto, after ' + String(g.access.email || '')).catch(() => 'failed' as const) : ''
  // MARKED LIVE: Kyle at Pacer gets the listing and its fees to set up pricing, once, on the change itself.
  const pricing = Array.isArray(b.steps) && !wasLive && liveDone(r) && !r.pricingBrief?.at ? await sendPricingBrief(r, 'auto, after ' + String(g.access.email || '')).then(x => (x.ok ? 'sent' : 'failed'), () => 'failed') : ''
  const w = await saveRecord(r, g.access.email || null)
  if (!w.ok) return NextResponse.json(w, { status: 500 })
  const items = await itemsFor(r)
  return NextResponse.json({ ok: true, record: teamView(r), items, canDelete: isSuperadmin(g.access.email), callInvite, pricing })
}

// DELETE: for good, and only the GM (Jon, 2026-11-13: "need to be able to delete. only GM - me"). Everyone else archives.
export async function DELETE(_: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireAdmin('owner'); if (!g.ok) return g.res
  const d = await deleteRecord(params.code, g.access.email || null)
  return NextResponse.json(d, { status: d.ok ? 200 : 500 })
}

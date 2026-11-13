// One onboarding link, for the team: the whole record and the item list (GET); the team's changes (PATCH):
// the owner and sender details, attach to a property and unit, the timeline, the onboarding call, team notes,
// the home itself, archive.
import { syncFaq } from '@/lib/owner-onboard-faq'
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord, itemsFor, cleanCustom, cleanMore } from '@/lib/owner-onboard-server'
import { cleanHome, OO_STEPS, teamView, type OOStep } from '@/lib/owner-onboard'

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'view'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const items = await itemsFor(r)
  return NextResponse.json({ ok: true, record: teamView(r), items })
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'edit'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r) return NextResponse.json({ ok: false, error: 'No such onboarding link.' }, { status: 404 })
  const b = await req.json().catch(() => ({} as any))
  if (b.custom) r.custom = cleanCustom(b.custom, r.custom)
  const hadListing = r.attach.listingId
  if (b.attach) r.attach = { property: String(b.attach.property ?? r.attach.property).slice(0, 120), listingId: String(b.attach.listingId ?? r.attach.listingId).slice(0, 60), unitLabel: String(b.attach.unitLabel ?? r.attach.unitLabel).slice(0, 60) }
  if (b.home) r.home = cleanHome(b.home)
  if (Array.isArray(b.more)) r.more = cleanMore(b.more)
  if (typeof b.teamNotes === 'string') r.teamNotes = b.teamNotes.slice(0, 4000)
  if (b.marks && typeof b.marks === 'object') for (const [k, v] of Object.entries(b.marks)) if (v === 'have' || v === 'need' || v === '') r.marks[String(k).slice(0, 120)] = v as any
  if (Array.isArray(b.steps)) {
    const keys = OO_STEPS.map(s => s.key)
    r.steps = keys.map(k => { const n: any = b.steps.find((x: any) => x?.key === k) || r.steps.find(x => x.key === k) || {}; return { key: k, status: ['todo', 'doing', 'done'].includes(n.status) ? n.status : 'todo', date: String(n.date || '').slice(0, 30), note: String(n.note || '').slice(0, 300) } as OOStep })
  }
  if (b.call) {
    r.call = { at: String(b.call.at ?? r.call.at).slice(0, 40), link: String(b.call.link ?? r.call.link).slice(0, 300), note: String(b.call.note ?? r.call.note).slice(0, 500) }
    const st = r.steps.find(s => s.key === 'call'); if (st && r.call.at && st.status === 'todo') { st.status = 'doing'; st.date = r.call.at.slice(0, 10) }
  }
  if (typeof b.archived === 'boolean') r.archived = b.archived
  // THE UNIT JUST GOT ITS LISTING: what the owner told us and approved goes into that listing's FAQ.
  if (r.attach.listingId && r.attach.listingId !== hadListing) await syncFaq(r, g.access.email || null).catch(() => null)
  const w = await saveRecord(r, g.access.email || null)
  if (!w.ok) return NextResponse.json(w, { status: 500 })
  const items = await itemsFor(r)
  return NextResponse.json({ ok: true, record: teamView(r), items })
}

// THE WALKTHROUGH COUNT SHEET (lib/owner-onboard `walk`), for whoever walks the unit. No login: the long random key in
// the emailed link is the pass, checked on every call. It shows only what a person standing in the unit needs: the
// place, the items and how many the home should have. Nothing about the owner beyond what they said is there.
//   GET   ?k=            → the sheet
//   PATCH { k, counts?, note?, by?, done? } → saves as they go; done finishes it and tells the team
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { readRecord, saveRecord, itemsFor, ownerItems, mergeCounts } from '@/lib/owner-onboard-server'
import { stockOf, unitsOf } from '@/lib/owner-onboard'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const hits = new Map<string, number[]>()
const limited = (k: string) => { const now = Date.now(), w = (hits.get(k) || []).filter(t => now - t < 60_000); w.push(now); hits.set(k, w); if (hits.size > 5000) hits.clear(); return w.length > 120 }
const keyOk = (want: string | undefined, got: string) => !!want && want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))
const NOPE = () => NextResponse.json({ ok: false, error: 'This walkthrough link is not active. Ask the office for a new one.' }, { status: 404, headers: NO_STORE })

async function sheet(r: any) {
  const items = ownerItems(await itemsFor(r)).map(i => ({ key: i.key, name: i.name, group: i.group, qty: i.qty, unit: i.unit, unitLabel: i.unitLabel, owner: stockOf(r, i).owner }))
  const units = unitsOf(r).map((h: any, i: number) => ({ label: h.unit ? 'Unit ' + h.unit : 'Unit ' + (i + 1), address: h.address, access: h.access || '', parking: h.parking || '' }))
  return { ok: true, place: r.attach.property || '', units, stock: r.stock || '', items, counts: r.walk?.counts || {}, note: r.walk?.note || '', by: r.walk?.by || '', doneAt: r.walk?.doneAt || '' }
}
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  if (limited(params.code)) return NextResponse.json({ ok: false, error: 'Too many requests. Wait a moment.' }, { status: 429, headers: NO_STORE })
  const r = await readRecord(params.code)
  if (!r || r.archived || !keyOk(r.walk?.key, String(req.nextUrl.searchParams.get('k') || ''))) return NOPE()
  return NextResponse.json(await sheet(r), { headers: NO_STORE })
}
export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  if (limited(params.code)) return NextResponse.json({ ok: false, error: 'Too many saves. Wait a moment.' }, { status: 429, headers: NO_STORE })
  const r = await readRecord(params.code)
  const b = await req.json().catch(() => ({} as any))
  if (!r || r.archived || !r.walk || !keyOk(r.walk.key, String(b?.k || ''))) return NOPE()
  const w = r.walk
  if (!w.startedAt) w.startedAt = new Date().toISOString()
  // only items on this home's list can be counted
  const valid = new Set(ownerItems(await itemsFor(r)).map(i => i.key))
  const clean: Record<string, any> = {}
  if (b.counts && typeof b.counts === 'object') for (const [k, v] of Object.entries(b.counts)) if (valid.has(k)) clean[k] = v
  w.counts = mergeCounts(w.counts || {}, clean)
  if (typeof b.note === 'string') w.note = b.note.slice(0, 2000)
  if (typeof b.by === 'string') w.by = b.by.trim().slice(0, 80)
  const finishing = !!b.done && !w.doneAt
  if (b.done) w.doneAt = w.doneAt || new Date().toISOString()
  const s = await saveRecord(r, 'walk:' + (w.by || r.code))
  if (!s.ok) return NextResponse.json(s, { status: 500, headers: NO_STORE })
  if (finishing) {
    try { await notify([r.createdBy, r.custom.gm.email].filter(Boolean), { kind: 'owner_onboarding', title: `Walkthrough finished: ${[r.attach.property, r.attach.unitLabel].filter(Boolean).join(' · ') || r.custom.ownerName || 'a new home'}`, body: `${w.by || 'The team'} counted ${Object.keys(w.counts).length} items. Review the inventory and build the order list.`, link: '/owner-onboarding/' + r.code }) } catch { /* saved; the bell is a courtesy */ }
  }
  return NextResponse.json(await sheet(r), { headers: NO_STORE })
}

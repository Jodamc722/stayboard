// THE CALENDAR LINK, Guesty ⇄ Cloudbeds (lib/garden/calendar-link). Owner of Cloudbeds & feeds only: every
// write here lands in a live booking system.
//   GET                                         → settings, the room map, the log
//   POST { op: 'status', room, from, to }       → both calendars for one room, read live
//        { op: 'reconcile', room, from, to, dry? } → make each side show what the other holds
//        { op: 'refresh' }                      → reconcile every linked room
//        { op: 'audit', days? }                 → compare every Botanica room across both systems (writes nothing)
//        { op: 'retry' }                        → try the rooms a write failed on again
//        { op: 'link', rooms: [...] }           → which rooms the link runs for
//        { op: 'test_cb_block' | 'test_gy_block', room, from, to } → a block made "by hand" on one side, to test with
//        { op: 'test_cb_unblock', blockId } · { op: 'test_gy_open', room, from, to }
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import * as L from '@/lib/garden/calendar-link'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const gate = await requireGarden('setup', 'view')
  if (!gate.ok) return gate.res
  try { const [settings, map, notifications] = await Promise.all([L.linkSettings(), L.roomMap(), L.notificationState()]); return NextResponse.json({ ok: true, settings: { ...settings, alerted: undefined }, notifications, horizonDays: L.HORIZON_DAYS, rooms: Object.values(map).sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true })) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('setup', 'full')
  if (!gate.ok) return gate.res
  const b: any = await req.json().catch(() => ({}))
  const by = (gate as any).access?.email ? String((gate as any).access.email) : 'someone'
  const op = String(b?.op || ''), room = String(b?.room || ''), from = String(b?.from || ''), to = String(b?.to || '')
  const t0 = Date.now()
  try {
    if (op === 'status') { const r = await L.readRoom(room, from, to); return NextResponse.json({ ok: true, room: r.room, nights: r.nights, blocks: r.blocks, ms: Date.now() - t0 }) }
    if (op === 'reconcile') return NextResponse.json({ ok: true, ...(await L.reconcileRoom(room, from, to, by, !!b?.dry)) })
    if (op === 'refresh') return NextResponse.json({ ok: true, ...(await L.reconcileLinked(by)), ms: Date.now() - t0 })
    if (op === 'audit') return NextResponse.json({ ok: true, audit: await L.auditAll(Math.min(365, Math.max(7, Number(b?.days) || 120))) })
    if (op === 'retry') return NextResponse.json({ ok: true, ...(await L.retryPending()) })
    if (op === 'enable_guesty_events') return NextResponse.json({ ok: true, ...(await L.enableGuestyEvents(by)) })
    if (op === 'test_cb_unblock') { await L.cbUnblock(String(b?.blockId || '')); return NextResponse.json({ ok: true, ms: Date.now() - t0 }) }
    if (op === 'link') return NextResponse.json({ ok: true, settings: await L.setLinkedRooms(Array.isArray(b?.rooms) ? b.rooms : [], by) })
    const map = await L.roomMap(), r = map[room]
    if (!r) return NextResponse.json({ ok: false, error: `Room ${room} has no Botanica listing.` }, { status: 400 })
    if (op === 'test_cb_block') { const id = await L.cbBlockRoom(r.virtualId || r.physicalId!, from, to, 'Test block (made by hand for the link test)'); return NextResponse.json({ ok: true, blockId: id, ms: Date.now() - t0 }) }
    if (op === 'test_gy_block') { await L.gyBlock(r.listingId, from, to, 'Test block (made by hand for the link test)'); return NextResponse.json({ ok: true, ms: Date.now() - t0 }) }
    if (op === 'test_gy_open') { await L.gyOpen(r.listingId, from, to); return NextResponse.json({ ok: true, ms: Date.now() - t0 }) }
    return NextResponse.json({ ok: false, error: 'unknown op' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 400), ms: Date.now() - t0 }) }
}

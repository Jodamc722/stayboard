// PARKING — the tab's API (Jon, 2026-10-26). Feature key `parking`: view reads the calendar, edit
// books / moves / pays / flags / notifies, full changes the lot (price, spots, tow company, link).
//
//   GET  ?lot=<id>&from=&to=            the bundle for one lot (lot=auto opens the first lot in the
//                                       same request; with no lot, just the list of lots)
//   GET  ?lot=<id>&stays=<q>&from=&to=  stays at the building to attach a booking to
//   GET  ?lot=<id>&plate=<p>&spot=<id>  judge a plate (the "check a plate" box)
//   POST { action, ... }                see the switch below
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isYmd, addDays } from '@/lib/plate'
import {
  listLots, lotBundle, lotById, createLot, updateLot, updateSpot, addSpot, buildingsWithoutLot,
  staysForBuilding, inHouseStays, createBooking, updateBooking, deleteBooking, suggestSpot, judgePlate,
  openIncident, incidentById, checkNoticeText, checkGroup, updateIncidentCar, sendNotice, draftTowEmail, closeIncident, noteIncident,
  storePhoto, readPlateFromPhoto, ymdET, lotsOverview, getStaffLink, setStaffLink,
} from '@/lib/parking-lots'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const who = (g: any) => String(g.access.profile?.name || g.access.profile?.full_name || g.access.email || 'someone')
const lvl = (g: any) => String(g.access.levels['parking'] || (g.access.role === 'admin' ? 'full' : 'off'))
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })

// CLEAN-UP (Jon, 2026-11-20: "some data is noisy"). A flag is a same-day job: notice, an hour, tow.
// Nobody closes them afterwards, so the Eden card read "8 flags" for cars last seen 5 to 14 days
// ago and the tab opened on them every morning. A flag nobody has touched for two days (seen, notice
// sent or tow email drafted) is OLD: it stays open in the database and on the Flags tab, under its
// own fold, but it no longer counts as a car to act on. A car that is still there is flagged again
// by the next lot check (the same-car rule in lib/parking-lots only joins sightings 24 hours apart).
// Nothing is written here; the rule for what a flag IS has not changed, only what the count shows.
const FLAG_FRESH_HOURS = 48
const OPEN_FLAG = ['open', 'notified', 'tow_drafted']
type Overview = Awaited<ReturnType<typeof lotsOverview>>
async function currentOverview(today: string, lots: Parameters<typeof lotsOverview>[1]): Promise<{ overview: (Overview[number] & { staleFlags: number })[]; staleFlagIds: string[] }> {
  const ids = (lots || []).map(l => l.id)
  const [overview, inc] = await Promise.all([
    lotsOverview(today, lots),
    ids.length
      ? supabaseAdmin().from('parking_incidents').select('id, lot_id, spot_id, seen_at, notice_sent_at, tow_drafted_at').in('lot_id', ids).in('status', OPEN_FLAG).limit(500)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const cutoff = Date.now() - FLAG_FRESH_HOURS * 3600 * 1000
  const touched = (i: any) => Math.max(...[i.seen_at, i.notice_sent_at, i.tow_drafted_at].map(t => (t ? new Date(t).getTime() : 0)))
  const open = ((inc as any).data || []) as any[]
  const stale = open.filter(i => touched(i) < cutoff)
  const staleIds = new Set(stale.map(i => String(i.id)))
  const fresh = open.filter(i => !staleIds.has(String(i.id)))
  return {
    staleFlagIds: Array.from(staleIds),
    overview: overview.map(o => {
      const mine = fresh.filter(i => String(i.lot_id) === o.lot.id)
      const spots = mine.map(i => (i.spot_id ? String(i.spot_id) : '')).filter(Boolean)
      return { ...o, flags: mine.length, staleFlags: stale.filter(i => String(i.lot_id) === o.lot.id).length, spots: o.spots.map(s => ({ ...s, flagged: spots.indexOf(s.id) >= 0 })) }
    }),
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('parking', 'view')
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const lotId = String(sp.get('lot') || '')
  const level = lvl(gate)
  const can = { edit: level === 'edit' || level === 'full' || gate.access.role === 'admin', full: level === 'full' || gate.access.role === 'admin' }
  try {
    const today = ymdET()
    // The quick questions first — they need one lot and nothing else.
    if (lotId && lotId !== 'auto' && (sp.has('stays') || sp.has('plate') || sp.has('inhouse'))) {
      const one = await lotById(lotId)
      if (!one) return bad('That lot does not exist.', 404)
      if (sp.has('stays')) {
        const sFrom = isYmd(sp.get('from')) ? String(sp.get('from')) : addDays(today, -7)
        const sTo = isYmd(sp.get('to')) ? String(sp.get('to')) : addDays(today, 60)
        const stays = await staysForBuilding(one.building, sFrom, sTo, String(sp.get('stays') || ''))
        return NextResponse.json({ ok: true, stays: stays.slice(0, 60) })
      }
      if (sp.has('plate')) {
        const v = await judgePlate(one.id, String(sp.get('plate') || ''), sp.get('spot') || null, isYmd(sp.get('date')) ? String(sp.get('date')) : today)
        return NextResponse.json({ ok: true, ...v })
      }
      const stays = await inHouseStays(one.building, today)
      return NextResponse.json({ ok: true, stays: stays.map(s => ({ id: s.id, guest: s.guest, unit: s.unit, canMessage: !!s.conversationId })) })
    }
    // ONE READ OF THE LOTS for everything below (it was read three times per open, and the lot a
    // fourth). `lot=auto` opens the first lot in this same request, so the tab loads in one call.
    const [lots, staff] = await Promise.all([listLots(), getStaffLink()])
    const staffLink = staff ? { code: staff.code, hasPasscode: !!staff.passcode, passcode: can.full ? staff.passcode : null, derived: staff.derived } : null
    // The overview is asked for once and shared: `auto` needs it to choose the lot, everything else
    // reads it alongside the bundle exactly as before.
    const overviewP = currentOverview(today, lots)
    overviewP.catch(() => null)   // an early return below must not leave a rejection unhandled
    let lot = lotId && lotId !== 'auto' ? (lots.find(l => l.id === lotId) || await lotById(lotId)) : null
    if (lotId === 'auto') {
      // WHICH LOT OPENS (Jon, 2026-11-20). It was the first by name — the one lot with nothing in
      // it, so the tab opened on an empty grid. Now: the lot with a car flagged, then the lot with
      // the most cars tonight, then the first by name as before.
      const { overview } = await overviewP
      const busy = (o: (typeof overview)[number]) => o.spots.filter(s => s.tonight).length
      const best = overview.slice().sort((a, b) => b.flags - a.flags || busy(b) - busy(a))[0]
      lot = (best && (best.flags > 0 || busy(best) > 0) ? best.lot : lots[0]) || null
    }
    if (!lot) {
      if (lotId && lotId !== 'auto') return bad('That lot does not exist.', 404)
      const { overview, staleFlagIds } = await overviewP
      return NextResponse.json({ ok: true, lots, overview, staleFlagIds, staffLink, can, today, buildings: can.full ? await buildingsWithoutLot(lots) : [] })
    }
    const from = isYmd(sp.get('from')) ? String(sp.get('from')) : addDays(today, -7)
    const to = isYmd(sp.get('to')) ? String(sp.get('to')) : addDays(today, 60)
    const [bundle, { overview, staleFlagIds }, buildings] = await Promise.all([lotBundle(lot, from, to), overviewP, can.full ? buildingsWithoutLot(lots) : Promise.resolve([] as string[])])
    return NextResponse.json({ ok: true, ...bundle, from, to, lots, overview, staleFlagIds, staffLink, can, buildings })
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  const needsFull = ['lot.create', 'lot.update', 'spot.update', 'spot.add', 'booking.delete', 'staff.update'].indexOf(action) >= 0
  const gate = await requireLevel('parking', needsFull ? 'full' : 'edit')
  if (!gate.ok) return gate.res
  const by = who(gate)
  try {
    switch (action) {
      case 'lot.create': {
        const r = await createLot({ building: String(body.building || ''), name: body.name, sell: Number(body.sell), hold: Number(body.hold), rateCents: Number(body.rateCents), by })
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'lot.update': {
        const r = await updateLot(String(body.lotId || ''), body.patch || {}, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'spot.update': {
        const r = await updateSpot(String(body.spotId || ''), body.patch || {})
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'staff.update': {
        // The all-lots link: a new passcode, or a brand-new code (the old link stops working).
        const r = await setStaffLink({ ...('passcode' in body ? { passcode: body.passcode } : {}), regenerate: body.regenerate === true }, by)
        return r ? NextResponse.json({ ok: true, staffLink: { code: r.code, hasPasscode: !!r.passcode, passcode: r.passcode, derived: false } }) : bad('Could not save the staff link.')
      }
      case 'spot.add': {
        const r = await addSpot(String(body.lotId || ''), body.kind === 'hold' ? 'hold' : 'sell', body.label)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'booking.suggest': {
        const s = await suggestSpot(String(body.lotId || ''), String(body.startsOn || ''), String(body.endsOn || ''), body.kind || 'guest', body.exceptId)
        return NextResponse.json({ ok: true, spot: s })
      }
      case 'booking.create': {
        const r = await createBooking({ ...body, lotId: String(body.lotId || '') }, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'booking.update': {
        const r = await updateBooking(String(body.bookingId || ''), body.patch || {}, by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'booking.delete': {
        const r = await deleteBooking(String(body.bookingId || ''))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.open': {
        // A car flagged by hand from the tab (no sweep): plate, car, where.
        const lotId = String(body.lotId || '')
        if (!(await lotById(lotId))) return bad('That lot does not exist.', 404)
        let photoPath: string | null = null
        let photoError: string | null = null
        if (body.photo) { const p = await storePhoto(lotId, String(body.photo), String(body.photoMime || 'image/jpeg')); if (p.ok) photoPath = p.path || null; else photoError = p.error || 'The photo could not be saved.' }
        const kind = ['unregistered', 'wrong_spot', 'staff_in_sell', 'blocking', 'other'].indexOf(body.kind) >= 0 ? body.kind : 'unregistered'
        const inc = await openIncident({ lotId, spotId: body.spotId || null, spotLabel: body.spotLabel || null, kind, bookingId: body.bookingId || null, plate: body.plate, plateState: body.plateState, make: body.make, model: body.model, color: body.color, photoPath, seenBy: by, notes: body.notes })
        return inc ? NextResponse.json({ ok: true, incident: inc, photoError }) : bad('Could not save the flag.')
      }
      case 'incident.car': {
        const out = await updateIncidentCar(String(body.incidentId || ''), { make: body.make, model: body.model, color: body.color, plateState: body.plateState })
        return out ? NextResponse.json({ ok: true, incident: out }) : bad('Could not save the car.')
      }
      case 'incident.noticeText': {
        const inc = await incidentById(String(body.incidentId || ''))
        const lot = inc ? await lotById(inc.lotId) : null
        if (!inc || !lot) return bad('That flag is gone.', 404)
        const stays = await inHouseStays(lot.building, ymdET())
        // One notice for every car flagged in this check (lib/parking-lots checkGroup), deadline from now.
        const group = inc.noticeSentAt ? [inc] : await checkGroup(inc)
        const due = new Date(Date.now() + lot.noticeMinutes * 60000)
        const text = inc.noticeSentAt && inc.noticeText ? inc.noticeText : checkNoticeText(lot, group, due)
        return NextResponse.json({ ok: true, text, group: group.map(g => ({ id: g.id, plate: g.plate, car: [g.color, g.make, g.model].filter(Boolean).join(' ') || 'Vehicle', spot: g.spotLabel })), recipients: stays.filter(s => s.conversationId).length, inHouse: stays.length })
      }
      case 'incident.notify': {
        const r = await sendNotice(String(body.incidentId || ''), String(body.text || ''), by, Array.isArray(body.groupIds) ? body.groupIds.map(String) : [])
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.tow': {
        const r = await draftTowEmail(String(body.incidentId || ''), by)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'incident.close': {
        const how = String(body.how || '')
        if (['towed', 'resolved', 'dismissed', 'reopen'].indexOf(how) < 0) return bad('how?')
        const inc = await closeIncident(String(body.incidentId || ''), how as any, by, body.resolution)
        return inc ? NextResponse.json({ ok: true, incident: inc }) : bad('Could not update the flag.')
      }
      case 'incident.note': {
        const inc = await noteIncident(String(body.incidentId || ''), String(body.notes || ''))
        return inc ? NextResponse.json({ ok: true, incident: inc }) : bad('Could not save the note.')
      }
      case 'plate.read': {
        const r = await readPlateFromPhoto(String(body.photo || ''), String(body.photoMime || 'image/jpeg'))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      default:
        return bad('Unknown action.')
    }
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

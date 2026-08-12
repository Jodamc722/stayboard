// THE OWNER'S VIEW OF A FURNITURE ORDER — one link, read and decide (Jon, 2026-08-12).
//
//   "Should be easy to show owner an order once we pick the furniture replacement links."
//
// GET  ?code=<orderCode>   the order as the owner should see it: grouped by unit and room, with
//                          the product, its code, where it goes, quantity, price and the total
// POST {code, lines:{id:'yes'|'no'}, note}   their decision, in their words
//
// WHAT THE OWNER DOES NOT SEE, and why. No other owner's units, no internal notes beyond the note
// we deliberately wrote for them, no staff names, no margins, no other order. The link is a
// capability for exactly one order — the same trade the walk links make.
//
// AN ORDER THAT IS ALREADY MOVING CANNOT BE RE-DECIDED. Once a line is ordered, delivered or
// installed, the owner's answer to it is history, not a control: money has been spent and a page
// that lets them "un-approve" it would be lying about what happens next.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ffePortfolio } from '@/lib/ffe-portfolio'
import { mergeChecklist, type FfeOverride } from '@/lib/ffe-checklist'
import { orderCode } from '@/lib/ffe-links'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any) => (v == null ? '' : String(v))
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const LOCKED = ['ordered', 'delivered', 'installed']

const isMissingTable = (msg: any) => /schema cache|does not exist/i.test(String(msg || ''))
const fail = (msg: any) => isMissingTable(msg)
  ? NextResponse.json({ ok: false, error: 'This order is not available yet.' }, { status: 503 })
  : NextResponse.json({ ok: false, error: String(msg) }, { status: 500 })

/** Resolve an order share code without loading every order's rows — ids only, then one fetch. */
async function orderByCode(db: any, code: string) {
  const c = str(code).trim().toLowerCase()
  if (!/^[a-f0-9]{16}$/.test(c)) return null
  const { data } = await db.from('ffe_orders').select('id').limit(5000)
  const hit = ((data || []) as any[]).find(o => orderCode(str(o.id)) === c)
  if (!hit) return null
  const { data: full } = await db.from('ffe_orders').select('*').eq('id', hit.id).limit(1)
  return (full || [])[0] || null
}

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  try {
    const order = await orderByCode(db, str(req.nextUrl.searchParams.get('code')))
    if (!order) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
    // A draft has not been sent to anybody. The link existing is not the same as it being shared.
    if (str(order.status) === 'draft') {
      return NextResponse.json({ ok: false, error: 'This order has not been shared yet.' }, { status: 404 })
    }

    const [{ data: lines }, units, ovRes] = await Promise.all([
      db.from('ffe_order_lines').select('*').eq('order_id', order.id).limit(3000),
      ffePortfolio(db),
      // The overlay is a nicety on this page — labels fall back to the built-in list without it.
      Promise.resolve(db.from('ffe_checklist_items').select('room,item_key,en,es,ask,hidden,sort').limit(2000))
        .catch(() => ({ data: [] as any[] })),
    ])
    const ov = ((ovRes as any)?.data || []) as FfeOverride[]

    // Room and item labels, in both languages, from the same checklist the walker used.
    const roomEn: Record<string, string> = {}, roomEs: Record<string, string> = {}
    const itemEn: Record<string, string> = {}, itemEs: Record<string, string> = {}
    for (const bd of [0, 1, 2, 3, 4]) {
      for (const r of mergeChecklist(bd, ov)) {
        roomEn[r.key] = r.en; roomEs[r.key] = r.es
        for (const i of r.items) { itemEn[r.key + '::' + i.key] = i.en; itemEs[r.key + '::' + i.key] = i.es }
      }
    }
    const bedroomsBy: Record<string, number | null> =
      Object.fromEntries(units.map((u: { id: string; bedrooms: number | null }) => [u.id, u.bedrooms]))

    const groups: Record<string, any> = {}
    let total = 0, priced = 0, unpriced = 0
    for (const l of ((lines || []) as any[])) {
      const lid = str(l.listing_id)
      const g = groups[lid] = groups[lid] || {
        listingId: lid, unitName: str(l.unit_name), building: str(l.building),
        bedrooms: bedroomsBy[lid] ?? null, rooms: {} as any, subtotal: 0,
      }
      const rk = str(l.room)
      const r = g.rooms[rk] = g.rooms[rk] || { room: rk, en: roomEn[rk] || rk, es: roomEs[rk] || rk, lines: [] as any[] }
      const qty = Math.max(1, num(l.qty, 1))
      const cost = l.unit_cost == null ? null : num(l.unit_cost)
      const lineTotal = cost == null ? null : Math.round(cost * qty * 100) / 100
      if (lineTotal == null) unpriced += 1
      else if (str(l.stage) !== 'declined') { total += lineTotal; priced += 1; g.subtotal += lineTotal }
      r.lines.push({
        id: str(l.id),
        code: l.code || null,
        product: l.product || null,
        itemEn: itemEn[rk + '::' + str(l.item_key)] || str(l.title) || str(l.item_key),
        itemEs: itemEs[rk + '::' + str(l.item_key)] || str(l.title) || str(l.item_key),
        placement: l.placement || null,
        spec: l.spec || null,
        imageUrl: l.image_url || null,
        url: l.url || null,
        qty, unitCost: cost, lineTotal,
        stage: str(l.stage),
        locked: LOCKED.indexOf(str(l.stage)) >= 0,
        ownerChoice: l.owner_choice || null,
      })
    }

    const unitList = Object.values(groups)
      .map((g: any) => ({ ...g, rooms: Object.values(g.rooms), count: Object.values(g.rooms).reduce((a: number, r: any) => a + r.lines.length, 0) }))
      .sort((a: any, b: any) => String(a.unitName).localeCompare(String(b.unitName), undefined, { numeric: true }))

    return NextResponse.json({
      ok: true,
      order: {
        orderNo: order.order_no, title: order.title, ownerName: order.owner_name,
        status: order.status, note: order.note, ownerNote: order.owner_note,
        decidedAt: order.decided_at, decidedBy: order.decided_by, sentAt: order.sent_at,
      },
      units: unitList,
      totals: {
        units: unitList.length,
        lines: ((lines || []) as any[]).length,
        priced, unpriced, total: Math.round(total * 100) / 100,
      },
      // Decided AND every line locked = nothing left to change; the page goes read-only.
      closed: ((lines || []) as any[]).length > 0 &&
        ((lines || []) as any[]).every(l => LOCKED.indexOf(str(l.stage)) >= 0),
    })
  } catch (e: any) { return fail(e?.message || e) }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  try {
    const order = await orderByCode(db, str(body.code))
    if (!order) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
    if (str(order.status) === 'draft') {
      return NextResponse.json({ ok: false, error: 'This order has not been shared yet.' }, { status: 404 })
    }

    const { data: lines } = await db.from('ffe_order_lines')
      .select('id,stage').eq('order_id', order.id).limit(3000)
    const byId: Record<string, any> = Object.fromEntries(((lines || []) as any[]).map(l => [str(l.id), l]))

    // ---- ONE TAP, SAVED IMMEDIATELY (Jon, 2026-08-12: "make sure if you click something it saves
    // if you refresh... in case loose connection, phone dies etc") ----
    // Every yes/no is written the moment it is tapped, as owner_choice only. The line's STAGE does
    // not move until they submit — so a half-finished review survives a dead battery without us
    // acting on a decision they had not finished making.
    if (str(body.action) === 'draft') {
      const lineId = str(body.lineId)
      const choice = str(body.choice) === 'no' ? 'no' : 'yes'
      const l = byId[lineId]
      if (!l) return NextResponse.json({ ok: false, error: 'line not found' }, { status: 404 })
      if (LOCKED.indexOf(str(l.stage)) >= 0) return NextResponse.json({ ok: true, locked: true })
      const r = await db.from('ffe_order_lines')
        .update({ owner_choice: choice, updated_at: new Date().toISOString() }).eq('id', lineId)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true, choice })
    }
    if (str(body.action) === 'draftNote') {
      const r = await db.from('ffe_orders').update({
        owner_note: str(body.note).trim().slice(0, 2000) || null,
        decided_by: str(body.name).trim().slice(0, 120) || order.decided_by || null,
        updated_at: new Date().toISOString(),
      }).eq('id', order.id)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    const picks: Record<string, string> = (body.lines && typeof body.lines === 'object') ? body.lines : {}
    const now = new Date().toISOString()
    const yes: string[] = [], no: string[] = []
    for (const id of Object.keys(picks).slice(0, 3000)) {
      const l = byId[id]
      if (!l) continue
      if (LOCKED.indexOf(str(l.stage)) >= 0) continue   // already bought — not theirs to reverse
      if (picks[id] === 'no') no.push(id); else yes.push(id)
    }
    // Anything they did not touch counts as yes: the page shows every line pre-approved, so silence
    // on a line is agreement with what is on the screen, not an unanswered question.
    for (const l of ((lines || []) as any[])) {
      const id = str(l.id)
      if (picks[id] != null) continue
      if (LOCKED.indexOf(str(l.stage)) >= 0) continue
      yes.push(id)
    }

    if (yes.length) {
      await db.from('ffe_order_lines')
        .update({ stage: 'approved', owner_choice: 'yes', updated_at: now }).in('id', yes)
    }
    if (no.length) {
      await db.from('ffe_order_lines')
        .update({ stage: 'declined', owner_choice: 'no', updated_at: now }).in('id', no)
    }

    const note = str(body.note).trim().slice(0, 2000) || null
    // "Changes requested" is the honest status when they said no to something or wrote to us; a
    // blanket "approved" would hide the one line they cut.
    const status = (no.length || (note && body.requestChanges)) ? 'changes' : 'approved'
    const r = await db.from('ffe_orders').update({
      status, owner_note: note, decided_at: now,
      decided_by: str(body.name).trim().slice(0, 120) || order.owner_name || null,
      updated_at: now,
    }).eq('id', order.id)
    if (r.error) return fail(r.error.message)

    return NextResponse.json({ ok: true, status, approved: yes.length, declined: no.length })
  } catch (e: any) { return fail(e?.message || e) }
}

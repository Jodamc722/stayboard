// ONBOARDING INVENTORY API (Jon, 2026-09-02). See lib/onboarding.ts for the why.
//
// TWO DOORS, ONE TABLE SET:
//   PUBLIC (the link is the key)  GET  ?code=…                        → unit + rooms + items
//                                 POST { code, action, … }            → saveDetails · addRoom · renameRoom ·
//                                                                       removeRoom · checkRoom · addItem ·
//                                                                       updateItem · removeItem · removePhoto ·
//                                                                       complete · reopen
//   SIGNED IN (feature `onboarding`) GET  ?list=1                    → every onboarding unit with progress
//                                 POST { action:'create', … }         → mints a code
//                                 POST { action:'assign', id, listingId } → links to the live Guesty listing
//                                 POST { action:'archive', id }
//                                 GET  ?standard=1 / POST { action:'saveStandard', standard } → the inventory
//                                   standard (items + per-occupancy rules) that generate() reads (lib/onboarding.ts)
//   EITHER DOOR               POST { code, action:'order' }  → the buy list (counted < expected, worn, missing)
//                                   becomes lines on an ffe_orders draft, so it lands on the FF&E Orders board (/ffe → Orders, detail at /ffe/order/<id>)
//
// Photos go through /api/onboard/photo (multipart). Nothing here touches Breezeway or Guesty; the
// assignment writes listing_id and nothing else — the inventory stays where it is and becomes
// readable by listing from that moment.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel, getAccess } from '@/lib/access'
import { roomsFor, itemsFor, newCode, mergeStandard, STANDARD_KEY, DEFAULT_STANDARD, APPLIANCES, BED_SIZES, TIERS, ROOM_TYPES, type UnitDetails, type RoomDef, type InventoryStandard } from '@/lib/onboarding'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()
const CODE_RE = /^[a-f0-9]{8,32}$/i
const CONDS = ['new', 'good', 'fair', 'worn', 'missing']
const CATS = ['furniture', 'appliance', 'electronics', 'kitchen', 'linen', 'decor', 'safety', 'other']
const KINDS = ['entry', 'living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'balcony', 'laundry', 'office', 'other']

function cleanDetails(d: any): UnitDetails {
  const o: any = d && typeof d === 'object' ? d : {}
  const num = (v: any, max: number) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.min(max, x) : undefined }
  const pick = <T extends string>(v: any, allowed: T[]): T | undefined => allowed.includes(v) ? v : undefined
  return {
    bedrooms: num(o.bedrooms, 8), bathrooms: num(o.bathrooms, 8), occupancy: num(o.occupancy, 30), balconies: num(o.balconies, 4),
    sleeperSofa: num(o.sleeperSofa, 4), kingBeds: num(o.kingBeds, 8), sqft: num(o.sqft, 20000),
    washerDryer: pick(o.washerDryer, ['in_unit', 'shared', 'none']), kitchen: pick(o.kitchen, ['full', 'kitchenette', 'none']),
    parking: pick(o.parking, ['none', 'assigned', 'garage', 'street']),
    floor: str(o.floor).slice(0, 20) || undefined, pool: o.pool === true, gym: o.gym === true, notes: str(o.notes).slice(0, 2000) || undefined,
    appliances: Array.isArray(o.appliances) ? o.appliances.filter((a: any) => APPLIANCES.some(x => x.key === a)).slice(0, 40) : undefined,
    rooms: o.rooms && typeof o.rooms === 'object' ? Object.fromEntries(Object.entries(o.rooms).filter(([k, v]) => ROOM_TYPES.some(t => t.key === k) && Number(v) > 0).map(([k, v]) => [k, Math.max(0, Math.min(6, Math.round(Number(v) || 0)))])) : undefined,
    beds: o.beds && typeof o.beds === 'object' ? Object.fromEntries(Object.entries(o.beds).filter(([k]) => /^(master_bedroom|bedroom_\d+|living)$/.test(k)).map(([k, v]) => [k, (Array.isArray(v) ? v : []).filter((b: any) => BED_SIZES.some(x => x.key === b)).slice(0, 6)])) : undefined,
  }
}

async function loadByCode(db: ReturnType<typeof supabaseAdmin>, code: string) {
  if (!CODE_RE.test(code)) return null
  const { data: unit } = await db.from('onboarding_units').select('*').eq('code', code.toLowerCase()).maybeSingle()
  if (!unit) return null
  const [{ data: rooms }, { data: items }] = await Promise.all([
    db.from('onboarding_rooms').select('*').eq('unit_id', unit.id).order('sort').order('created_at'),
    db.from('onboarding_items').select('*').eq('unit_id', unit.id).order('sort').order('created_at'),
  ])
  return { unit, rooms: rooms || [], items: items || [] }
}

function progressOf(rooms: any[], items: any[]) {
  const confirmed = items.filter(i => i.condition).length
  const photos = rooms.reduce((a, r) => a + (Array.isArray(r.photos) ? r.photos.length : 0), 0)
  const roomsPhotographed = rooms.filter(r => Array.isArray(r.photos) && r.photos.length > 0).length
  const roomsChecked = rooms.filter(r => r.checked_at).length
  return { rooms: rooms.length, roomsChecked, roomsPhotographed, items: items.length, confirmed, photos, pct: items.length ? Math.round((confirmed / items.length) * 100) : 0 }
}

/**
 * THE BUY LIST (Jon, 2026-09-02: "if we count 10 but need 12 it should create an order").
 * For every CONFIRMED item: worn or missing → replace the full expected count (or what was counted,
 * for a custom item with no standard); otherwise the shortfall between the standard and the count.
 * Unconfirmed items are not on it — a blank is not a shortage until someone has stood in the room.
 */
function buyList(items: any[]) {
  const out: { id: string; room_id: string; name: string; category: string; need: number; have: number; expected: number | null; why: 'short' | 'worn' | 'missing' }[] = []
  for (const i of items) {
    if (!i.condition) continue
    const have = Math.max(0, Number(i.qty) || 0)
    const expected = i.expected == null ? null : Math.max(0, Number(i.expected) || 0)
    if (i.condition === 'missing') { const need = expected ?? have ?? 1; if (need > 0) out.push({ id: i.id, room_id: i.room_id, name: i.name, category: i.category, need, have: 0, expected, why: 'missing' }); continue }
    if (i.condition === 'worn') { const need = Math.max(expected ?? 0, have); if (need > 0) out.push({ id: i.id, room_id: i.room_id, name: i.name, category: i.category, need, have, expected, why: 'worn' }); continue }
    if (expected != null && have < expected) out.push({ id: i.id, room_id: i.room_id, name: i.name, category: i.category, need: expected - have, have, expected, why: 'short' })
  }
  return out
}

/**
 * Buy list → Purchasing. One draft ffe_orders row per onboarding unit (remembered in order_id), lines
 * keyed by the onboarding item id so re-running after more counting UPDATES quantities instead of
 * doubling them. A unit that is not live yet has no Guesty listing_id / owner_id — both NOT NULL on
 * the 034 tables — so it borrows 'onboard:<code>' as its id; `assign` re-points the lines to the real
 * listing the day the unit goes live. unit_name and building ride on the line, which is what the
 * board displays, so the placeholder id never reaches a screen.
 */
async function pushOrder(db: ReturnType<typeof supabaseAdmin>, unit: any, rooms: any[], items: any[], who: string | null) {
  const buy = buyList(items)
  if (!buy.length) return { ok: false as const, error: 'Nothing to order — no confirmed item is short, worn or missing.' }
  const now = new Date().toISOString()
  const key = unit.listing_id || ('onboard:' + unit.code)
  let orderId: string | null = unit.order_id || null
  if (orderId) { const { data } = await db.from('ffe_orders').select('id,status').eq('id', orderId).maybeSingle(); if (!data || ['closed'].includes(String(data.status))) orderId = null }
  if (!orderId) {
    const ins = await db.from('ffe_orders').insert({
      owner_id: key, owner_name: unit.owner_name || unit.name, title: unit.name + ' — onboarding inventory',
      note: 'Built from the onboarding walk' + (unit.building ? ' · ' + unit.building : '') + (unit.unit_no ? ' #' + unit.unit_no : ''),
      status: 'draft', created_by: who, updated_at: now,
    }).select('id,order_no').single()
    if (ins.error) return { ok: false as const, error: ins.error.message }
    orderId = ins.data.id
    await db.from('onboarding_units').update({ order_id: orderId, updated_at: now }).eq('id', unit.id)
  }
  const roomName: Record<string, string> = {}; const roomKey: Record<string, string> = {}
  for (const r of rooms) { roomName[r.id] = r.name; roomKey[r.id] = r.key }
  const { data: existing } = await db.from('ffe_order_lines').select('id,item_key,stage').eq('order_id', orderId)
  const byItem: Record<string, any> = {}; for (const l of existing || []) byItem[String(l.item_key)] = l
  let added = 0, updated = 0
  for (const b of buy) {
    const have = byItem['onb:' + b.id]
    const title = b.name + (b.why === 'short' ? ' — short ' + b.need + ' (have ' + b.have + ', need ' + b.expected + ')' : b.why === 'worn' ? ' — worn, replace' : ' — missing')
    if (have) {
      if (['draft', 'sent'].includes(String(have.stage))) { await db.from('ffe_order_lines').update({ qty: b.need, title, updated_at: now }).eq('id', have.id); updated++ }
      continue
    }
    const { error } = await db.from('ffe_order_lines').insert({
      order_id: orderId, listing_id: key, unit_name: unit.name, building: unit.building || null,
      room: roomKey[b.room_id] || 'other', item_key: 'onb:' + b.id, title, qty: b.need, stage: 'draft',
      placement: roomName[b.room_id] || null, updated_at: now,
    })
    if (error) return { ok: false as const, error: error.message }
    added++
  }
  await db.from('ffe_orders').update({ updated_at: now }).eq('id', orderId)
  const { data: ord } = await db.from('ffe_orders').select('id,order_no,status').eq('id', orderId).single()
  return { ok: true as const, order: ord, added, updated, lines: buy.length }
}

/** Create the rooms + starter items the details imply, skipping anything that already exists. */
async function loadStandard(): Promise<InventoryStandard> {
  return mergeStandard(await getSetting<any>(STANDARD_KEY, null))
}

async function generate(db: ReturnType<typeof supabaseAdmin>, unitId: string, details: UnitDetails) {
  const standard = await loadStandard()
  const { data: existing } = await db.from('onboarding_rooms').select('id,key').eq('unit_id', unitId)
  const have = new Set((existing || []).map((r: any) => String(r.key)))
  const defs: RoomDef[] = roomsFor(details).filter(r => !have.has(r.key))
  if (!defs.length) return 0
  const { data: rows, error } = await db.from('onboarding_rooms')
    .insert(defs.map(r => ({ unit_id: unitId, key: r.key, name: r.name, kind: r.kind, sort: r.sort })))
    .select('id,key,kind,name,sort')
  if (error) throw new Error(error.message)
  const items: any[] = []
  for (const r of (rows || []) as any[]) {
    const def = defs.find(d => d.key === r.key)!
    itemsFor(def, details, standard).forEach((it, i) => items.push({ unit_id: unitId, room_id: r.id, name: it.name, category: it.category, qty: it.qty, expected: it.qty, brand: it.brand || null, tier: it.tier, suggested: true, sort: i }))
  }
  if (items.length) { const { error: e2 } = await db.from('onboarding_items').insert(items); if (e2) throw new Error(e2.message) }
  return defs.length
}

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  try {
    if (sp.get('standard')) {
      const gate = await requireLevel('onboarding', 'view')
      if (!gate.ok) return gate.res
      const saved = await getSetting<any>(STANDARD_KEY, null)
      return NextResponse.json({ ok: true, standard: mergeStandard(saved), edited: !!saved, defaults: DEFAULT_STANDARD })
    }
    if (sp.get('list')) {
      const gate = await requireLevel('onboarding', 'view')
      if (!gate.ok) return gate.res
      const { data: units } = await db.from('onboarding_units').select('*').neq('status', 'archived').order('created_at', { ascending: false }).limit(300)
      const ids = (units || []).map((u: any) => u.id)
      const [{ data: rooms }, { data: items }, { data: listings }] = await Promise.all([
        ids.length ? db.from('onboarding_rooms').select('unit_id,photos,checked_at').in('unit_id', ids) : Promise.resolve({ data: [] as any[] }),
        ids.length ? db.from('onboarding_items').select('unit_id,condition,qty,expected').in('unit_id', ids) : Promise.resolve({ data: [] as any[] }),
        db.from('guesty_listings').select('id,nickname,title,building,status').limit(2000),
      ])
      const lname: Record<string, string> = {}
      for (const l of (listings || []) as any[]) lname[String(l.id)] = String(l.nickname || l.title || l.id)
      const out = (units || []).map((u: any) => ({
        ...u,
        listing_name: u.listing_id ? (lname[u.listing_id] || u.listing_id) : null,
        progress: progressOf((rooms || []).filter((r: any) => r.unit_id === u.id), (items || []).filter((i: any) => i.unit_id === u.id)),
        buy: buyList((items || []).filter((i: any) => i.unit_id === u.id)).length,
      }))
      const pick = (listings || []).filter((l: any) => !['inactive', 'disabled', 'archived', 'deleted'].includes(String(l.status || '').toLowerCase()))
        .map((l: any) => ({ id: String(l.id), name: String(l.nickname || l.title || l.id), building: String(l.building || '') }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
      return NextResponse.json({ ok: true, units: out, listings: pick })
    }
    const code = str(sp.get('code')).toLowerCase()
    const found = await loadByCode(db, code)
    if (!found) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
    return NextResponse.json({ ok: true, ...found, progress: progressOf(found.rooms, found.items), buy: buyList(found.items) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const b = await req.json().catch(() => ({} as any))
  const action = str(b.action)
  const now = new Date().toISOString()
  try {
    // ── signed-in actions ──────────────────────────────────────────────────────────────────────
    if (action === 'create' || action === 'assign' || action === 'archive' || action === 'unassign' || action === 'saveStandard') {
      const gate = await requireLevel('onboarding', 'edit')
      if (!gate.ok) return gate.res
      const me = gate.access.email || null
      if (action === 'saveStandard') {
        // null / 'reset' puts the researched defaults back.
        if (b.standard == null || b.standard === 'reset') { const r = await setSetting(STANDARD_KEY, null, me); return NextResponse.json({ ok: r.ok, error: r.error, standard: DEFAULT_STANDARD, edited: false }) }
        const std = mergeStandard(b.standard)
        const r = await setSetting(STANDARD_KEY, std, me)
        return NextResponse.json({ ok: r.ok, error: r.error, standard: std, edited: true })
      }
      if (action === 'create') {
        const name = str(b.name).slice(0, 120)
        if (!name) return NextResponse.json({ ok: false, error: 'A name for the unit is required.' }, { status: 400 })
        const details = cleanDetails(b.details)
        let code = newCode()
        for (let i = 0; i < 3; i++) { const { data } = await db.from('onboarding_units').select('id').eq('code', code).maybeSingle(); if (!data) break; code = newCode() }
        const { data: unit, error } = await db.from('onboarding_units').insert({
          code, name, building: str(b.building).slice(0, 120) || null, unit_no: str(b.unitNo).slice(0, 40) || null, address: str(b.address).slice(0, 300) || null,
          owner_name: str(b.ownerName).slice(0, 120) || null, owner_contact: str(b.ownerContact).slice(0, 200) || null,
          details, status: 'draft', created_by: me, notes: str(b.notes).slice(0, 2000) || null,
        }).select('*').single()
        if (error) throw new Error(error.message)
        // Rooms are generated the moment details exist (a bedroom count is enough); otherwise the
        // form's quick section generates them on first save.
        if (details.bedrooms != null || details.bathrooms != null) await generate(db, unit.id, details)
        return NextResponse.json({ ok: true, unit, url: '/onboard/' + code })
      }
      const id = str(b.id)
      if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
      if (action === 'assign') {
        const listingId = str(b.listingId)
        if (!listingId) return NextResponse.json({ ok: false, error: 'listingId required' }, { status: 400 })
        const { data: l } = await db.from('guesty_listings').select('id').eq('id', listingId).maybeSingle()
        if (!l) return NextResponse.json({ ok: false, error: 'That listing is not in Guesty.' }, { status: 404 })
        const { data: u0 } = await db.from('onboarding_units').select('code,order_id').eq('id', id).maybeSingle()
        const { error } = await db.from('onboarding_units').update({ listing_id: listingId, linked_at: now, linked_by: me, status: 'linked', updated_at: now }).eq('id', id)
        if (error) throw new Error(error.message)
        // The buy list was filed under a placeholder id while the unit was not live; it belongs to the listing now.
        if (u0?.order_id) {
          await db.from('ffe_order_lines').update({ listing_id: listingId }).eq('order_id', u0.order_id).eq('listing_id', 'onboard:' + u0.code)
          await db.from('ffe_orders').update({ owner_id: listingId, updated_at: now }).eq('id', u0.order_id).eq('owner_id', 'onboard:' + u0.code)
        }
        return NextResponse.json({ ok: true })
      }
      if (action === 'unassign') {
        const { error } = await db.from('onboarding_units').update({ listing_id: null, linked_at: null, linked_by: null, status: 'complete', updated_at: now }).eq('id', id)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
      }
      const { error } = await db.from('onboarding_units').update({ status: 'archived', updated_at: now }).eq('id', id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    // ── public actions: the code is the key ────────────────────────────────────────────────────
    const code = str(b.code).toLowerCase()
    const found = await loadByCode(db, code)
    if (!found) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
    const unit = found.unit
    if (unit.status === 'archived') return NextResponse.json({ ok: false, error: 'This link has been closed.' }, { status: 410 })
    const touch = async (extra: Record<string, any> = {}) => { await db.from('onboarding_units').update({ updated_at: now, ...(unit.status === 'draft' ? { status: 'in_progress' } : {}), ...extra }).eq('id', unit.id) }
    // Signed-in users may also act through the public door (the link is often opened while logged in).
    const who = str(b.by).slice(0, 120) || (await getAccess().catch(() => null))?.email || null

    if (action === 'saveDetails') {
      const details = cleanDetails(b.details)
      const patch: Record<string, any> = { details }
      for (const [k, col, max] of [['name', 'name', 120], ['building', 'building', 120], ['unitNo', 'unit_no', 40], ['address', 'address', 300], ['ownerName', 'owner_name', 120], ['ownerContact', 'owner_contact', 200], ['notes', 'notes', 2000]] as const) {
        if (b[k] !== undefined) patch[col] = str(b[k]).slice(0, max) || null
      }
      if (patch.name === null) delete patch.name
      await touch(patch)
      const added = await generate(db, unit.id, details)
      return NextResponse.json({ ok: true, roomsAdded: added })
    }
    if (action === 'addRoom') {
      const name = str(b.name).slice(0, 80); const kind = KINDS.includes(b.kind) ? b.kind : 'other'
      if (!name) return NextResponse.json({ ok: false, error: 'Room name required' }, { status: 400 })
      const key = 'custom_' + Date.now().toString(36)
      const sort = found.rooms.length
      const { data: room, error } = await db.from('onboarding_rooms').insert({ unit_id: unit.id, key, name, kind, sort }).select('*').single()
      if (error) throw new Error(error.message)
      const its = itemsFor({ key, name, kind, sort }, unit.details || {}, await loadStandard())
      if (its.length) await db.from('onboarding_items').insert(its.map((it, i) => ({ unit_id: unit.id, room_id: room.id, name: it.name, category: it.category, qty: it.qty, expected: it.qty, brand: it.brand || null, tier: it.tier, suggested: true, sort: i })))
      await touch()
      return NextResponse.json({ ok: true, room })
    }
    if (action === 'renameRoom' || action === 'removeRoom' || action === 'checkRoom' || action === 'removePhoto' || action === 'roomNotes') {
      const roomId = str(b.roomId)
      const room = found.rooms.find((r: any) => r.id === roomId)
      if (!room) return NextResponse.json({ ok: false, error: 'room not found' }, { status: 404 })
      if (action === 'renameRoom') { const name = str(b.name).slice(0, 80); if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 }); await db.from('onboarding_rooms').update({ name, updated_at: now }).eq('id', roomId) }
      if (action === 'roomNotes') await db.from('onboarding_rooms').update({ notes: str(b.notes).slice(0, 2000) || null, updated_at: now }).eq('id', roomId)
      if (action === 'removeRoom') await db.from('onboarding_rooms').delete().eq('id', roomId)
      if (action === 'checkRoom') await db.from('onboarding_rooms').update({ checked_at: b.checked === false ? null : now, updated_at: now }).eq('id', roomId)
      if (action === 'removePhoto') {
        const url = str(b.url)
        const photos = (Array.isArray(room.photos) ? room.photos : []).filter((p: any) => p?.url !== url)
        await db.from('onboarding_rooms').update({ photos, updated_at: now }).eq('id', roomId)
      }
      await touch()
      return NextResponse.json({ ok: true })
    }
    if (action === 'addItem') {
      const roomId = str(b.roomId)
      if (!found.rooms.some((r: any) => r.id === roomId)) return NextResponse.json({ ok: false, error: 'room not found' }, { status: 404 })
      const name = str(b.name).slice(0, 120)
      if (!name) return NextResponse.json({ ok: false, error: 'Item name required' }, { status: 400 })
      const qty = Math.max(0, Math.min(999, Math.round(Number(b.qty) || 1)))
      const { data: item, error } = await db.from('onboarding_items').insert({
        unit_id: unit.id, room_id: roomId, name, category: CATS.includes(b.category) ? b.category : 'other', qty,
        condition: CONDS.includes(b.condition) ? b.condition : null, brand: str(b.brand).slice(0, 120) || null, notes: str(b.notes).slice(0, 1000) || null,
        expected: b.expected === undefined || b.expected === null || b.expected === '' ? null : Math.max(0, Math.min(999, Math.round(Number(b.expected) || 0))),
        tier: (TIERS as string[]).includes(b.tier) ? b.tier : 'must',
        suggested: false, sort: found.items.filter((i: any) => i.room_id === roomId).length,
      }).select('*').single()
      if (error) throw new Error(error.message)
      await touch()
      return NextResponse.json({ ok: true, item })
    }
    if (action === 'updateItem' || action === 'removeItem') {
      const itemId = str(b.itemId)
      if (!found.items.some((i: any) => i.id === itemId)) return NextResponse.json({ ok: false, error: 'item not found' }, { status: 404 })
      if (action === 'removeItem') await db.from('onboarding_items').delete().eq('id', itemId)
      else {
        const patch: Record<string, any> = { updated_at: now, suggested: false }
        if (b.qty !== undefined) patch.qty = Math.max(0, Math.min(999, Math.round(Number(b.qty) || 0)))
        if (b.condition !== undefined) patch.condition = CONDS.includes(b.condition) ? b.condition : null
        if (b.name !== undefined) { const nm = str(b.name).slice(0, 120); if (nm) patch.name = nm }
        if (b.category !== undefined && CATS.includes(b.category)) patch.category = b.category
        if (b.brand !== undefined) patch.brand = str(b.brand).slice(0, 120) || null
        if (b.notes !== undefined) patch.notes = str(b.notes).slice(0, 1000) || null
        if (b.photoUrl !== undefined) patch.photo_url = str(b.photoUrl) || null
        // "need" — the walker can correct the standard for THIS unit (a 4-top table needs 4 chairs).
        if (b.expected !== undefined) patch.expected = b.expected === null || b.expected === '' ? null : Math.max(0, Math.min(999, Math.round(Number(b.expected) || 0)))
        await db.from('onboarding_items').update(patch).eq('id', itemId)
      }
      await touch()
      return NextResponse.json({ ok: true })
    }
    // AI READ-BACK APPLY (Jon, 2026-09-03: "photo add section and AI should add the details… then allow
    // details to be added"). One round-trip for what the walker approved: counts/conditions on
    // existing rows, new rows for what the photo showed that the list did not have. Nothing here is
    // marked confirmed unless the walker approved a condition for it.
    if (action === 'applyItems') {
      const roomId = str(b.roomId)
      if (!found.rooms.some((r: any) => r.id === roomId)) return NextResponse.json({ ok: false, error: 'room not found' }, { status: 404 })
      const updates: any[] = Array.isArray(b.updates) ? b.updates.slice(0, 200) : []
      const adds: any[] = Array.isArray(b.adds) ? b.adds.slice(0, 100) : []
      let u = 0, a = 0
      for (const x of updates) {
        const id = str(x.itemId); if (!found.items.some((i: any) => i.id === id && i.room_id === roomId)) continue
        const patch: Record<string, any> = { updated_at: now, suggested: false }
        if (x.qty !== undefined) patch.qty = Math.max(0, Math.min(999, Math.round(Number(x.qty) || 0)))
        if (x.condition !== undefined) patch.condition = CONDS.includes(x.condition) ? x.condition : null
        if (x.brand) patch.brand = str(x.brand).slice(0, 120)
        if (x.notes) patch.notes = str(x.notes).slice(0, 1000)
        await db.from('onboarding_items').update(patch).eq('id', id); u++
      }
      let sort = found.items.filter((i: any) => i.room_id === roomId).length
      const rows = adds.map(x => ({
        unit_id: unit.id, room_id: roomId, name: str(x.name).slice(0, 120), category: CATS.includes(x.category) ? x.category : 'other',
        qty: Math.max(0, Math.min(999, Math.round(Number(x.qty) || 1))), condition: CONDS.includes(x.condition) ? x.condition : null,
        brand: str(x.brand).slice(0, 120) || null, notes: str(x.notes).slice(0, 1000) || null, tier: 'must', suggested: false, sort: sort++,
      })).filter(r => r.name)
      if (rows.length) { const { error } = await db.from('onboarding_items').insert(rows); if (error) throw new Error(error.message); a = rows.length }
      if (b.notes !== undefined) await db.from('onboarding_rooms').update({ notes: str(b.notes).slice(0, 2000) || null, updated_at: now }).eq('id', roomId)
      await touch()
      return NextResponse.json({ ok: true, updated: u, added: a })
    }
    if (action === 'order') {
      const r = await pushOrder(db, unit, found.rooms, found.items, who)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
      await touch()
      return NextResponse.json(r)
    }
    if (action === 'complete') {
      await db.from('onboarding_units').update({ status: unit.listing_id ? 'linked' : 'complete', completed_at: now, updated_at: now }).eq('id', unit.id)
      return NextResponse.json({ ok: true, by: who })
    }
    if (action === 'reopen') {
      await db.from('onboarding_units').update({ status: 'in_progress', completed_at: null, updated_at: now }).eq('id', unit.id)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

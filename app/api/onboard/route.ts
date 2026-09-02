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
//
// Photos go through /api/onboard/photo (multipart). Nothing here touches Breezeway or Guesty; the
// assignment writes listing_id and nothing else — the inventory stays where it is and becomes
// readable by listing from that moment.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel, getAccess } from '@/lib/access'
import { roomsFor, itemsFor, newCode, type UnitDetails, type RoomDef } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()
const CODE_RE = /^[a-f0-9]{8,32}$/i
const CONDS = ['new', 'good', 'fair', 'worn', 'missing']
const CATS = ['furniture', 'appliance', 'electronics', 'kitchen', 'linen', 'decor', 'safety', 'other']
const KINDS = ['entry', 'living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'balcony', 'laundry', 'other']

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

/** Create the rooms + starter items the details imply, skipping anything that already exists. */
async function generate(db: ReturnType<typeof supabaseAdmin>, unitId: string, details: UnitDetails) {
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
    itemsFor(def, details).forEach((it, i) => items.push({ unit_id: unitId, room_id: r.id, name: it.name, category: it.category, qty: it.qty, brand: it.brand || null, suggested: true, sort: i }))
  }
  if (items.length) { const { error: e2 } = await db.from('onboarding_items').insert(items); if (e2) throw new Error(e2.message) }
  return defs.length
}

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  try {
    if (sp.get('list')) {
      const gate = await requireLevel('onboarding', 'view')
      if (!gate.ok) return gate.res
      const { data: units } = await db.from('onboarding_units').select('*').neq('status', 'archived').order('created_at', { ascending: false }).limit(300)
      const ids = (units || []).map((u: any) => u.id)
      const [{ data: rooms }, { data: items }, { data: listings }] = await Promise.all([
        ids.length ? db.from('onboarding_rooms').select('unit_id,photos,checked_at').in('unit_id', ids) : Promise.resolve({ data: [] as any[] }),
        ids.length ? db.from('onboarding_items').select('unit_id,condition').in('unit_id', ids) : Promise.resolve({ data: [] as any[] }),
        db.from('guesty_listings').select('id,nickname,title,building,status').limit(2000),
      ])
      const lname: Record<string, string> = {}
      for (const l of (listings || []) as any[]) lname[String(l.id)] = String(l.nickname || l.title || l.id)
      const out = (units || []).map((u: any) => ({
        ...u,
        listing_name: u.listing_id ? (lname[u.listing_id] || u.listing_id) : null,
        progress: progressOf((rooms || []).filter((r: any) => r.unit_id === u.id), (items || []).filter((i: any) => i.unit_id === u.id)),
      }))
      const pick = (listings || []).filter((l: any) => !['inactive', 'disabled', 'archived', 'deleted'].includes(String(l.status || '').toLowerCase()))
        .map((l: any) => ({ id: String(l.id), name: String(l.nickname || l.title || l.id), building: String(l.building || '') }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
      return NextResponse.json({ ok: true, units: out, listings: pick })
    }
    const code = str(sp.get('code')).toLowerCase()
    const found = await loadByCode(db, code)
    if (!found) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
    return NextResponse.json({ ok: true, ...found, progress: progressOf(found.rooms, found.items) })
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
    if (action === 'create' || action === 'assign' || action === 'archive' || action === 'unassign') {
      const gate = await requireLevel('onboarding', 'edit')
      if (!gate.ok) return gate.res
      const me = gate.access.email || null
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
        const { error } = await db.from('onboarding_units').update({ listing_id: listingId, linked_at: now, linked_by: me, status: 'linked', updated_at: now }).eq('id', id)
        if (error) throw new Error(error.message)
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
      const its = itemsFor({ key, name, kind, sort }, unit.details || {})
      if (its.length) await db.from('onboarding_items').insert(its.map((it, i) => ({ unit_id: unit.id, room_id: room.id, name: it.name, category: it.category, qty: it.qty, brand: it.brand || null, suggested: true, sort: i })))
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
        await db.from('onboarding_items').update(patch).eq('id', itemId)
      }
      await touch()
      return NextResponse.json({ ok: true })
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

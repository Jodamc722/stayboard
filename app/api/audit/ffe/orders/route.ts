// FF&E ORDERS API — turning "replace the lamps in 1101" into something a vendor can ship.
//
// Jon, 2026-08-12: "should be easy to show owner an order once we pick the furniture replacement
// links... world class ordering form and then actually managing it. With furniture codes, where
// they go, etc."
//
// GET  ?pending=<ownerId>   every Replace/Add answer for that owner that is not on an order yet,
//                           grouped unit -> room, each with the products that could satisfy it
// GET  ?list=1              the order board: every order, its money and how far along its lines are
// GET  ?id=<orderId>        one order with its lines and the owner share link
//
// POST create | addLines | setLine | removeLine | stage | send | setOrder
//
// STILL NOT A WORK ORDER. Nothing here writes audit_items, property_audits, Breezeway or billing.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ffePortfolio, type FfeUnit } from '@/lib/ffe-portfolio'
import { mergeChecklist, type FfeOverride } from '@/lib/ffe-checklist'
import { categoryForItem, LINE_STAGES, bestSource } from '@/lib/ffe-catalog'
import { BUYS } from '@/lib/ffe-checklist'
import { orderCode } from '@/lib/ffe-links'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const str = (v: any) => (v == null ? '' : String(v))
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const nowISO = () => new Date().toISOString()
const STAGES = new Set<string>(LINE_STAGES as unknown as string[])

const isMissingTable = (msg: any) => /schema cache|does not exist/i.test(String(msg || ''))
const SETUP = 'Ordering is not set up yet — migration 034 has not been run on the database.'
const fail = (msg: any, status = 500) =>
  isMissingTable(msg)
    ? NextResponse.json({ ok: false, setupRequired: true, error: SETUP }, { status: 503 })
    : NextResponse.json({ ok: false, error: String(msg) }, { status })

function priceOf(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}
const clean = (v: any, max: number) => { const s = str(v).trim(); return s ? s.slice(0, max) : null }

/**
 * A catalog product plus WHERE IT IS BOUGHT (Jon, 2026-08-13: "not sure yet where we will purchase
 * from — could be Amazon, HostGPO, Wayfair, City Furniture").
 *
 * The product row carries the code and the name; the supplier, their SKU, their link and their
 * price live on ffe_catalog_sources, one row per place you could buy it. Reading the product alone
 * gave a line with no vendor and no price — which is exactly what a buy list cannot group by. This
 * resolves the chosen source (or the cheapest, if nobody has chosen) and folds it into the product
 * so every caller below gets one object with everything a line needs.
 */
async function productsWithSource(db: any, ids: string[]): Promise<Record<string, any>> {
  if (!ids.length) return {}
  const { data: prods } = await db.from('ffe_catalog').select('*').in('id', ids).limit(2000)
  let srcs: any[] = []
  try {
    const { data } = await db.from('ffe_catalog_sources').select('*').in('catalog_id', ids).limit(5000)
    srcs = (data || []) as any[]
  } catch { /* migration 038 not run — fall back to whatever is on the product itself */ }
  const byProduct: Record<string, any[]> = {}
  for (const x of srcs) (byProduct[str(x.catalog_id)] = byProduct[str(x.catalog_id)] || []).push(x)

  const out: Record<string, any> = {}
  for (const p of ((prods || []) as any[])) {
    const best = bestSource(byProduct[str(p.id)] || [])
    out[str(p.id)] = {
      ...p,
      vendor: best ? best.vendor : p.vendor,
      vendor_sku: best ? (best.vendor_sku || p.vendor_sku) : p.vendor_sku,
      url: best && best.url ? best.url : p.url,
      unit_cost: best && best.unit_cost != null ? Number(best.unit_cost) : p.unit_cost,
    }
  }
  return out
}

async function overrides(db: any): Promise<FfeOverride[]> {
  try {
    const { data } = await db.from('ffe_checklist_items').select('room,item_key,en,es,ask,hidden,sort').limit(2000)
    return (data || []) as FfeOverride[]
  } catch { return [] }
}

/**
 * Room and item labels, so a line reads "Primary bedroom · Nightstands — Order 1" rather than
 * "master::nightstands".
 *
 * KEYED BY BEDROOM COUNT, and that is the whole point. The first version built one flat map across
 * every unit and kept the first label it saw for a key — so master::nightstands got its name from
 * whichever studio happened to be first in the list, came out as plain "Nightstands", and a 3-bed
 * unit showed "Nightstands", "Nightstands — Order 2", "Nightstands — Order 3". The numbering only
 * exists relative to a unit's own bedroom count, so the lookup has to carry it.
 */
function labelIndex(ov: FfeOverride[]) {
  const cache: Record<string, { rooms: Record<string, string>; items: Record<string, string> }> = {}
  return (bedrooms: number | null) => {
    const bd = bedrooms == null ? 1 : bedrooms
    const k = String(bd)
    if (!cache[k]) {
      const rooms: Record<string, string> = {}
      const items: Record<string, string> = {}
      for (const r of mergeChecklist(bedrooms, ov)) {
        rooms[r.key] = r.en
        for (const i of r.items) items[r.key + '::' + i.key] = i.en
      }
      cache[k] = { rooms, items }
    }
    return cache[k]
  }
}

export async function GET(req: NextRequest) {
  const s = createClient()
  const { data: u } = await s.auth.getUser()
  if (!u.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  try {
    // ---- ONE ORDER ----
    const id = str(sp.get('id')).trim()
    if (id) {
      const [{ data: ords, error: oErr }, { data: lines, error: lErr }] = await Promise.all([
        db.from('ffe_orders').select('*').eq('id', id).limit(1),
        db.from('ffe_order_lines').select('*').eq('order_id', id).limit(3000),
      ])
      if (oErr) return fail(oErr.message)
      if (lErr) return fail(lErr.message)
      const order = (ords || [])[0]
      if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
      const [units, ov] = await Promise.all([ffePortfolio(db), overrides(db)])
      const labelsFor = labelIndex(ov)
      const bedroomsBy: Record<string, number | null> = Object.fromEntries(units.map(u => [u.id, u.bedrooms]))
      return NextResponse.json({
        ok: true,
        order,
        shareCode: orderCode(str(order.id)),
        lines: ((lines || []) as any[]).map(l => {
          const L = labelsFor(bedroomsBy[str(l.listing_id)] ?? null)
          return {
            ...l,
            roomLabel: L.rooms[str(l.room)] || str(l.room),
            // The title stored on the line is what the builder showed and what the owner was sent.
            // It wins over a recomputed label so every screen says the same words.
            itemLabel: str(l.title) || L.items[str(l.room) + '::' + str(l.item_key)] || str(l.item_key),
          }
        }),
      })
    }

    // ---- THE BOARD ----
    if (sp.get('list')) {
      const [{ data: ords, error: oErr }, { data: lines, error: lErr }] = await Promise.all([
        db.from('ffe_orders').select('*').order('created_at', { ascending: false }).limit(500),
        db.from('ffe_order_lines').select('order_id,qty,unit_cost,stage').limit(20000),
      ])
      if (oErr) return fail(oErr.message)
      if (lErr) return fail(lErr.message)
      const roll: Record<string, any> = {}
      for (const l of ((lines || []) as any[])) {
        const k = str(l.order_id)
        const r = roll[k] = roll[k] || { lines: 0, value: 0, priced: 0, byStage: {} as Record<string, number> }
        const stage = str(l.stage)
        if (stage === 'declined') { r.byStage.declined = (r.byStage.declined || 0) + 1; continue }
        r.lines += 1
        r.byStage[stage] = (r.byStage[stage] || 0) + 1
        if (l.unit_cost != null) { r.value += num(l.unit_cost) * num(l.qty, 1); r.priced += 1 }
      }
      return NextResponse.json({
        ok: true,
        orders: ((ords || []) as any[]).map(o => ({
          ...o,
          shareCode: orderCode(str(o.id)),
          roll: roll[str(o.id)] || { lines: 0, value: 0, priced: 0, byStage: {} },
        })),
      })
    }

    // ---- WHAT IS WAITING TO BE ORDERED ----
    const ownerId = str(sp.get('pending')).trim()
    const units = await ffePortfolio(db)
    if (!ownerId) {
      // Owners with something to BUY. A Fix answer is deliberately not counted here — it belongs
      // on the Fixes board, not in an owner's order.
      const { data: ans, error } = await db.from('ffe_answers')
        .select('listing_id,answer').in('answer', BUYS).limit(20000)
      if (error) return fail(error.message)
      const byListing: Record<string, number> = {}
      for (const a of ((ans || []) as any[])) byListing[str(a.listing_id)] = (byListing[str(a.listing_id)] || 0) + 1
      const owners: Record<string, any> = {}
      for (const u2 of units) {
        const n = byListing[u2.id] || 0
        if (!n) continue
        const o = owners[u2.ownerId] = owners[u2.ownerId] || { ownerId: u2.ownerId, ownerName: u2.ownerName, flagged: 0, units: 0 }
        o.flagged += n; o.units += 1
      }
      return NextResponse.json({
        ok: true,
        owners: Object.values(owners).sort((a: any, b: any) => b.flagged - a.flagged),
      })
    }

    const mine = units.filter(x => x.ownerId === ownerId)
    const ids = mine.map(x => x.id)
    if (!ids.length) return NextResponse.json({ ok: true, owner: null, groups: [], products: [] })

    const [{ data: ans, error: aErr }, { data: onOrder }, { data: prods }, ov] = await Promise.all([
      db.from('ffe_answers').select('listing_id,room,item_key,title,answer,qty,note,spec,photo_url,replacement_url,replacement_photo,est_cost')
        .in('listing_id', ids).in('answer', BUYS).limit(20000),
      db.from('ffe_order_lines').select('listing_id,room,item_key,order_id').in('listing_id', ids).limit(20000),
      db.from('ffe_catalog').select('id,code,name_en,category,item_keys,vendor,vendor_sku,unit_cost,url,image_url,room_hint')
        .eq('active', true).limit(2000),
      overrides(db),
    ])
    if (aErr) return fail(aErr.message)

    const already = new Set(((onOrder || []) as any[]).map(l => str(l.listing_id) + '|' + str(l.room) + '|' + str(l.item_key)))
    const labelsFor = labelIndex(ov)
    const unitById: Record<string, FfeUnit> = Object.fromEntries(mine.map(x => [x.id, x]))

    const groups: Record<string, any> = {}
    for (const a of ((ans || []) as any[])) {
      const lid = str(a.listing_id)
      const key = lid + '|' + str(a.room) + '|' + str(a.item_key)
      if (already.has(key)) continue
      const unit = unitById[lid]
      if (!unit) continue
      const L = labelsFor(unit.bedrooms)
      const g = groups[lid] = groups[lid] || {
        listingId: lid, unitName: unit.name, building: unit.building, bedrooms: unit.bedrooms, rooms: {} as any,
      }
      const rk = str(a.room)
      const r = g.rooms[rk] = g.rooms[rk] || { room: rk, roomLabel: L.rooms[rk] || rk, items: [] as any[] }
      r.items.push({
        room: rk,
        itemKey: str(a.item_key),
        itemLabel: L.items[rk + '::' + str(a.item_key)] || str(a.title) || str(a.item_key),
        title: str(a.title) || null,
        answer: str(a.answer),
        qty: Math.max(1, num(a.qty, 1)),
        note: a.note || null,
        // The size the walker recorded standing in the room — it has to reach the vendor.
        spec: a.spec || null,
        photoUrl: a.photo_url || null,
        // What the walker said we should buy — link, picture and rough price.
        replacementUrl: a.replacement_url || null,
        replacementPhoto: a.replacement_photo || null,
        estCost: a.est_cost == null ? null : Number(a.est_cost),
        category: categoryForItem(str(a.item_key)),
      })
    }

    const out = Object.values(groups)
      .map((g: any) => ({ ...g, rooms: Object.values(g.rooms) }))
      .sort((a: any, b: any) => String(a.unitName).localeCompare(String(b.unitName), undefined, { numeric: true }))

    // Price the picker from the chosen supplier too, so the number in the builder is the number on
    // the order rather than a blank that fills in later.
    const withSource = await productsWithSource(db, ((prods || []) as any[]).map(p => str(p.id)))
    return NextResponse.json({
      ok: true,
      owner: { ownerId, ownerName: mine[0]?.ownerName || 'Owner', units: mine.length },
      groups: out,
      products: ((prods || []) as any[]).map(p => withSource[str(p.id)] || p),
    })
  } catch (e: any) { return fail(e?.message || e) }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const gate = await requireLevel('ffe', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const action = str(body.action)
  const who = gate.access.email || null
  const now = nowISO()

  try {
    // ---- CREATE an order and its first lines ----
    if (action === 'create') {
      const ownerId = str(body.ownerId).trim()
      if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
      const units = await ffePortfolio(db)
      const mine = units.filter(u => u.ownerId === ownerId)
      if (!mine.length) return NextResponse.json({ error: 'that owner has no units' }, { status: 400 })

      const ins = await db.from('ffe_orders').insert({
        owner_id: ownerId,
        owner_name: mine[0].ownerName,
        title: clean(body.title, 120) || (mine[0].ownerName + ' — FF&E'),
        note: clean(body.note, 2000),
        status: 'draft', created_by: who, updated_at: now,
      }).select('*').limit(1)
      if (ins.error) return fail(ins.error.message)
      const order = (ins.data || [])[0]

      const added = await insertLines(db, order.id, body.lines, units, now)
      if (added.error) return fail(added.error)
      return NextResponse.json({ ok: true, id: order.id, orderNo: order.order_no, added: added.count })
    }

    // ---- ADD more lines to an existing order ----
    if (action === 'addLines') {
      const orderId = str(body.id)
      if (!orderId) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const units = await ffePortfolio(db)
      const added = await insertLines(db, orderId, body.lines, units, now)
      if (added.error) return fail(added.error)
      await db.from('ffe_orders').update({ updated_at: now }).eq('id', orderId)
      return NextResponse.json({ ok: true, added: added.count })
    }

    // ---- EDIT one line: the product, the quantity, the price, where it goes ----
    if (action === 'setLine') {
      const lineId = str(body.lineId)
      if (!lineId) return NextResponse.json({ error: 'lineId required' }, { status: 400 })
      const patch: any = { updated_at: now }

      if ('catalogId' in body) {
        const cid = str(body.catalogId)
        if (!cid) {
          Object.assign(patch, { catalog_id: null, code: null, product: null, image_url: null, url: null, vendor: null, vendor_sku: null })
        } else {
          const prod = (await productsWithSource(db, [cid]))[cid]
          if (!prod) return NextResponse.json({ error: 'product not found' }, { status: 404 })
          // Snapshot, not a join — see migration 034. An approved quote must not re-price itself.
          Object.assign(patch, {
            catalog_id: prod.id, code: prod.code, product: prod.name_en,
            image_url: prod.image_url, url: prod.url, vendor: prod.vendor, vendor_sku: prod.vendor_sku,
          })
          if (body.takePrice !== false && prod.unit_cost != null) patch.unit_cost = prod.unit_cost
        }
      }
      if ('qty' in body) patch.qty = Math.max(1, Math.min(999, Math.round(num(body.qty, 1))))
      if ('unitCost' in body) patch.unit_cost = priceOf(body.unitCost)
      if ('placement' in body) patch.placement = clean(body.placement, 160)
      if ('spec' in body) patch.spec = clean(body.spec, 120)
      if ('note' in body) patch.note = clean(body.note, 500)

      const r = await db.from('ffe_order_lines').update(patch).eq('id', lineId)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    // ---- APPLY one product to many lines at once (the reason this is fast at 53 units) ----
    if (action === 'applyProduct') {
      const ids: string[] = Array.isArray(body.lineIds) ? body.lineIds.map(String).slice(0, 2000) : []
      const cid = str(body.catalogId)
      if (!ids.length || !cid) return NextResponse.json({ error: 'lineIds and catalogId required' }, { status: 400 })
      const prod = (await productsWithSource(db, [cid]))[cid]
      if (!prod) return NextResponse.json({ error: 'product not found' }, { status: 404 })
      const patch: any = {
        catalog_id: prod.id, code: prod.code, product: prod.name_en,
        image_url: prod.image_url, url: prod.url, vendor: prod.vendor, vendor_sku: prod.vendor_sku,
        updated_at: now,
      }
      if (body.takePrice !== false && prod.unit_cost != null) patch.unit_cost = prod.unit_cost
      const r = await db.from('ffe_order_lines').update(patch).in('id', ids)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true, applied: ids.length })
    }

    if (action === 'removeLine') {
      const ids: string[] = Array.isArray(body.lineIds) ? body.lineIds.map(String).slice(0, 2000) : [str(body.lineId)].filter(Boolean)
      if (!ids.length) return NextResponse.json({ error: 'lineId required' }, { status: 400 })
      const r = await db.from('ffe_order_lines').delete().in('id', ids)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true, removed: ids.length })
    }

    // ---- MOVE lines along: ordered (with the PO), delivered, installed ----
    if (action === 'stage') {
      const ids: string[] = Array.isArray(body.lineIds) ? body.lineIds.map(String).slice(0, 2000) : []
      const stage = str(body.stage)
      if (!ids.length) return NextResponse.json({ error: 'lineIds required' }, { status: 400 })
      if (!STAGES.has(stage)) return NextResponse.json({ error: 'unknown stage' }, { status: 400 })
      const patch: any = { stage, updated_at: now }
      if (stage === 'ordered') {
        patch.ordered_at = now
        if ('poNumber' in body) patch.po_number = clean(body.poNumber, 64)
        if ('vendorRef' in body) patch.vendor_ref = clean(body.vendorRef, 64)
      }
      if (stage === 'delivered') {
        patch.delivered_at = now
        patch.received_at = now
        if ('receivedBy' in body) patch.received_by = clean(body.receivedBy, 120)
      }
      if (stage === 'installed') patch.installed_at = now
      const r = await db.from('ffe_order_lines').update(patch).in('id', ids)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true, moved: ids.length })
    }

    // ---- SEND to the owner ----
    if (action === 'send') {
      const orderId = str(body.id)
      if (!orderId) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const { data: unpriced } = await db.from('ffe_order_lines')
        .select('id').eq('order_id', orderId).is('unit_cost', null).limit(1)
      const r = await db.from('ffe_orders')
        .update({ status: 'sent', sent_at: now, updated_at: now }).eq('id', orderId)
      if (r.error) return fail(r.error.message)
      // Only DRAFT lines move. A line already ordered or installed is not "with the owner" again.
      await db.from('ffe_order_lines').update({ stage: 'sent', updated_at: now })
        .eq('order_id', orderId).eq('stage', 'draft')
      return NextResponse.json({
        ok: true,
        shareCode: orderCode(orderId),
        // Said plainly rather than blocked: an owner is allowed to see a quote with a TBC on it,
        // but nobody should send one by accident.
        warning: (unpriced || []).length ? 'Some lines have no price yet — the owner will see them as TBC.' : null,
      })
    }

    if (action === 'setOrder') {
      const orderId = str(body.id)
      if (!orderId) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const patch: any = { updated_at: now }
      if ('title' in body) patch.title = clean(body.title, 120)
      if ('note' in body) patch.note = clean(body.note, 2000)
      if ('status' in body && ['draft', 'sent', 'approved', 'changes', 'closed'].includes(str(body.status))) patch.status = str(body.status)
      const r = await db.from('ffe_orders').update(patch).eq('id', orderId)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    if (action === 'deleteOrder') {
      const orderId = str(body.id)
      if (!orderId) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const { data: live } = await db.from('ffe_order_lines').select('id')
        .eq('order_id', orderId).in('stage', ['ordered', 'delivered', 'installed']).limit(1)
      if ((live || []).length) {
        return NextResponse.json({ error: 'This order has lines already ordered — close it instead of deleting it.' }, { status: 409 })
      }
      const r = await db.from('ffe_orders').delete().eq('id', orderId)
      if (r.error) return fail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: any) { return fail(e?.message || e) }
}

/**
 * Insert order lines from what the builder selected.
 *
 * The unit's name and building are copied onto the line rather than looked up later, so a delivery
 * sheet printed in October still says where the piece was going even if the listing was renamed.
 * Duplicates are dropped silently: the same item cannot be on the same order twice (DB unique), and
 * a second click of Add should not be an error message.
 */
async function insertLines(db: any, orderId: string, raw: any, units: FfeUnit[], now: string) {
  const list: any[] = Array.isArray(raw) ? raw.slice(0, 2000) : []
  if (!list.length) return { count: 0, error: null as any }
  const unitById: Record<string, FfeUnit> = Object.fromEntries(units.map(u => [u.id, u]))

  const { data: existing } = await db.from('ffe_order_lines')
    .select('listing_id,room,item_key').eq('order_id', orderId).limit(5000)
  const have = new Set(((existing || []) as any[]).map(l => str(l.listing_id) + '|' + str(l.room) + '|' + str(l.item_key)))

  const catIds = Array.from(new Set(list.map(l => str(l.catalogId)).filter(Boolean)))
  const prodById: Record<string, any> = catIds.length ? await productsWithSource(db, catIds) : {}

  const rows: any[] = []
  for (const l of list) {
    const lid = str(l.listingId)
    const room = str(l.room)
    const itemKey = str(l.itemKey)
    const u = unitById[lid]
    if (!u || !room || !itemKey) continue
    const key = lid + '|' + room + '|' + itemKey
    if (have.has(key)) continue
    have.add(key)
    const prod = prodById[str(l.catalogId)] || null
    rows.push({
      order_id: orderId,
      listing_id: lid, unit_name: u.name, building: u.building,
      room, item_key: itemKey,
      title: clean(l.title, 160),
      catalog_id: prod ? prod.id : null,
      code: prod ? prod.code : null,
      product: prod ? prod.name_en : null,
      // A CATALOG PRODUCT WINS, BUT THE WALKER'S RESEARCH IS NOT THROWN AWAY. If nobody has picked
      // a product yet, the link, photo and price captured in the unit become the line — so an order
      // built straight off a walk is already something a person could act on.
      image_url: prod ? prod.image_url : (clean(l.replacementPhoto, 500) || null),
      url: prod ? prod.url : (clean(l.replacementUrl, 500) || null),
      vendor: prod ? prod.vendor : null,
      vendor_sku: prod ? prod.vendor_sku : null,
      qty: Math.max(1, Math.min(999, Math.round(num(l.qty, 1)))),
      unit_cost: 'unitCost' in l ? priceOf(l.unitCost)
        : (prod && prod.unit_cost != null ? prod.unit_cost : priceOf(l.estCost)),
      placement: clean(l.placement, 160),
      spec: clean(l.spec, 120),
      stage: 'draft',
      note: clean(l.note, 500),
      updated_at: now,
    })
  }
  if (!rows.length) return { count: 0, error: null as any }
  const r = await db.from('ffe_order_lines').insert(rows)
  return { count: rows.length, error: r.error ? r.error.message : null }
}

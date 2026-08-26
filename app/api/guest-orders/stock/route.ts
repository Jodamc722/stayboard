// INVENTORY — what is on the shelf per hub, what is reserved by paid orders, what is running low.
//   GET  every tracked item × scope, with hubs + low/out flags
//   PUT  { rows:       [{ itemId, scope, onHand, lowAt? }]            stock-take
//         items:      [{ id, name?, description?, price?, cost?, … }]  edit an existing item
//         newItems:   [{ name, scope, price?, … }]                     add one
//         deleteIds:  [id]                                             remove one
//        } — all four in one trip, all at 'edit' access
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getGuestOrdersCfg, loadCatalog, listStock, setStock } from '@/lib/guest-orders'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireLevel('guest-orders', 'view')
  if (!gate.ok) return gate.res
  const [cfg, catalog, stock] = await Promise.all([getGuestOrdersCfg(), loadCatalog({ activeOnly: false }), listStock()])
  const scopes = [{ id: 'global', label: 'Global shelf' }, ...cfg.hubs.map(h => ({ id: 'hub:' + h.id, label: h.label }))]
  // EVERY item, not only the counted ones. Filtering to `track_stock` meant an item you had not
  // started counting was INVISIBLE here — so "edit an item" only worked for some of the menu, with
  // no clue which. An untracked item simply carries no counts and offers to start counting.
  const items = catalog.map(c => {
    const per = scopes.map(sc => {
      const row = stock.find(r => r.item_id === c.id && r.scope === sc.id)
      const onHand = row ? row.on_hand : 0, reserved = row ? row.reserved : 0, lowAt = row ? row.low_at : 3
      const available = Math.max(0, onHand - reserved)
      return { scope: sc.id, label: sc.label, onHand, reserved, lowAt, available, state: !c.track_stock ? 'untracked' : !row ? 'unset' : available <= 0 ? 'out' : available <= lowAt ? 'low' : 'ok', updatedAt: row ? row.updated_at : null, updatedBy: row ? row.updated_by : null }
    })
    return {
      id: c.id, sku: c.sku, name: c.name, category: c.category, image: c.image_url, active: c.active,
      hubs: c.hubs, buildings: c.buildings, per, tracked: c.track_stock,
      description: c.description, unit: c.unit_label, maxQty: c.max_qty,
      price: c.price_usd, cost: c.cost_usd, reorderUrl: c.reorder_url, supplier: c.supplier, packNote: c.pack_note,
    }
  })
  const alerts = items.filter(i => i.tracked).flatMap(i => i.per.filter(p => p.state === 'out' || p.state === 'low').map(p => ({ item: i.name, scope: p.label, state: p.state, available: p.available })))
  return NextResponse.json({ ok: true, scopes, items, alerts, untracked: catalog.filter(c => !c.track_stock && c.active).length })
}

export async function PUT(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 500) : []
  const actor = gate.access.email || 'staff'
  let saved = 0
  const errors: string[] = []
  for (const r of rows) {
    const itemId = String(r?.itemId || ''); const scope = String(r?.scope || 'global')
    if (!/^[0-9a-f-]{36}$/i.test(itemId) || !/^(global|hub:[a-z0-9\-]{1,40})$/.test(scope)) { errors.push('bad row'); continue }
    const res = await setStock(itemId, scope, Number(r?.onHand) || 0, r?.lowAt === undefined || r?.lowAt === null || r?.lowAt === '' ? null : Number(r.lowAt), actor)
    if (res.ok) saved++; else errors.push(res.error || 'failed')
  }
  // THE ITEM ITSELF, saved in the same trip as the count (Jon, 2026-08-25: "we need to be able to
  // update, we need to be able to add descriptions… why can't I add items, or edit items or delete
  // items"). Everything about an item is editable from Inventory — name, the description the guest
  // reads, category, price, cost, photo, the order link — plus creating and removing items.
  //
  // This is 'edit' level, deliberately NOT owner-only. Only the settings card is owner-gated,
  // because that is what switches on automation that charges cards; keeping the menu itself behind
  // the same lock meant the people who actually run the shelf could not correct a typo.
  const db = supabaseAdmin()

  // Guest-facing text is trimmed and bounded; a blank string clears the field rather than storing "".
  const txt = (v: any, max: number) => { const t = String(v ?? '').trim().slice(0, max); return t || null }

  function itemPatch(f: any, errs: string[]): Record<string, any> {
    const patch: Record<string, any> = {}
    if (f.name !== undefined) { const n = txt(f.name, 80); if (n) patch.name = n; else errs.push('an item needs a name') }
    if (f.description !== undefined) patch.description = txt(f.description, 300)
    if (f.category !== undefined) patch.category = txt(f.category, 40)
    if (f.unit !== undefined) patch.unit_label = txt(f.unit, 40)
    if (f.supplier !== undefined) patch.supplier = txt(f.supplier, 120)
    if (f.packNote !== undefined) patch.pack_note = txt(f.packNote, 80)
    if (f.imageUrl !== undefined) patch.image_url = txt(f.imageUrl, 600)
    if (f.active !== undefined) patch.active = f.active === true
    if (f.trackStock !== undefined) patch.track_stock = f.trackStock === true
    if (f.maxQty !== undefined) patch.max_qty = Math.min(99, Math.max(1, Math.round(Number(f.maxQty) || 10)))
    if (f.price !== undefined) patch.price_usd = Math.max(0, Math.round((Number(f.price) || 0) * 100) / 100)
    if (f.cost !== undefined) patch.cost_usd = f.cost === null || f.cost === '' ? null : Math.max(0, Math.round((Number(f.cost) || 0) * 100) / 100)
    if (f.reorderUrl !== undefined) {
      const u = String(f.reorderUrl || '').trim().slice(0, 600)
      // http(s) only — a javascript: or data: URL here would be a one-click trap for whoever is
      // restocking, and this field renders as a link the team is meant to trust.
      patch.reorder_url = u && /^https?:\/\//i.test(u) ? u : null
      if (u && !patch.reorder_url) errs.push(String(f.name || 'item') + ': the order link must start with http:// or https://')
    }
    return patch
  }

  const facts = Array.isArray(body?.items) ? body.items.slice(0, 300) : []
  let itemsSaved = 0
  for (const f of facts) {
    const id = String(f?.id || '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) { errors.push('bad item id'); continue }
    const patch = itemPatch(f, errors)
    if (!Object.keys(patch).length) continue
    const { error } = await db.from('guest_order_catalog').update(patch).eq('id', id)
    if (error) errors.push(String(f.name || id) + ': ' + error.message); else itemsSaved++
  }

  // NEW ITEMS. The sku is derived from the name and made unique, because a duplicate sku is a
  // unique-constraint error the person would otherwise meet as raw Postgres text.
  const created: string[] = []
  for (const n of (Array.isArray(body?.newItems) ? body.newItems.slice(0, 50) : [])) {
    const name = txt(n?.name, 80)
    if (!name) { errors.push('a new item needs a name'); continue }
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item'
    let sku = base
    for (let i = 2; i < 40; i++) {
      const { data } = await db.from('guest_order_catalog').select('id').eq('sku', sku).limit(1)
      if (!data || !data.length) break
      sku = base.slice(0, 26) + '-' + i
    }
    const row = { sku, name, fee_code: 'GUEST_SERVICE', price_usd: 0, sort: 100, active: true, track_stock: true, ...itemPatch(n, errors) }
    const { data, error } = await db.from('guest_order_catalog').insert(row).select('id').limit(1)
    if (error) { errors.push(name + ': ' + error.message); continue }
    const newId = data && data[0] ? String((data[0] as any).id) : ''
    if (newId) {
      created.push(newId)
      // Put it on the shelf it was created from, so it appears where the person is standing
      // instead of silently landing on the global shelf.
      const sc = String(n?.scope || 'global')
      if (/^(global|hub:[a-z0-9\-]{1,40})$/.test(sc)) await setStock(newId, sc, Math.max(0, Math.round(Number(n?.onHand) || 0)), n?.lowAt === undefined || n?.lowAt === '' ? null : Number(n.lowAt), actor)
    }
  }

  // REMOVALS. The stock rows go too — leaving them would resurrect counts against a dead item id
  // if the sku were ever reused. Past ORDERS are untouched: they store their own line snapshot,
  // so deleting an item never rewrites what a guest was charged.
  const deleted: string[] = []
  for (const rawId of (Array.isArray(body?.deleteIds) ? body.deleteIds.slice(0, 100) : [])) {
    const id = String(rawId || '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) { errors.push('bad id to remove'); continue }
    await db.from('guest_order_stock').delete().eq('item_id', id)
    const { error } = await db.from('guest_order_catalog').delete().eq('id', id)
    if (error) errors.push('could not remove an item: ' + error.message); else deleted.push(id)
  }

  return NextResponse.json({ ok: errors.length === 0, saved, itemsSaved, created: created.length, deleted: deleted.length, errors })
}

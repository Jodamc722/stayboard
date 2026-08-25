// INVENTORY — what is on the shelf per hub, what is reserved by paid orders, what is running low.
//   GET  every tracked item × scope, with hubs + low/out flags
//   PUT  { rows: [{ itemId, scope, onHand, lowAt? }] }  stock-take (edit access)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getGuestOrdersCfg, loadCatalog, listStock, setStock } from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireLevel('guest-orders', 'view')
  if (!gate.ok) return gate.res
  const [cfg, catalog, stock] = await Promise.all([getGuestOrdersCfg(), loadCatalog({ activeOnly: false }), listStock()])
  const scopes = [{ id: 'global', label: 'Global shelf' }, ...cfg.hubs.map(h => ({ id: 'hub:' + h.id, label: h.label }))]
  const items = catalog.filter(c => c.track_stock).map(c => {
    const per = scopes.map(sc => {
      const row = stock.find(r => r.item_id === c.id && r.scope === sc.id)
      const onHand = row ? row.on_hand : 0, reserved = row ? row.reserved : 0, lowAt = row ? row.low_at : 3
      const available = Math.max(0, onHand - reserved)
      return { scope: sc.id, label: sc.label, onHand, reserved, lowAt, available, state: !row ? 'unset' : available <= 0 ? 'out' : available <= lowAt ? 'low' : 'ok', updatedAt: row ? row.updated_at : null, updatedBy: row ? row.updated_by : null }
    })
    return { id: c.id, sku: c.sku, name: c.name, category: c.category, image: c.image_url, active: c.active, hubs: c.hubs, buildings: c.buildings, per }
  })
  const alerts = items.flatMap(i => i.per.filter(p => p.state === 'out' || p.state === 'low').map(p => ({ item: i.name, scope: p.label, state: p.state, available: p.available })))
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
  return NextResponse.json({ ok: errors.length === 0, saved, errors })
}

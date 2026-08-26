// Guest Orders settings + catalog. GET: any admin. PUT: owner only — this switches on automation
// that writes to Guesty bookings and charges guests' cards.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getGuestOrdersCfg, saveGuestOrdersCfg, loadCatalog } from '@/lib/guest-orders'
import { getSlackRules } from '@/lib/slack-rules'
import { KNOWN_BUILDINGS, MARKETS, buildingOf, marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  // Listings come along so a hub can be built from individual units, not only whole properties
  // (Jon, 2026-08-25: "hub is a group of listings or properties").
  const [config, catalog, rules, units] = await Promise.all([
    getGuestOrdersCfg(), loadCatalog({ activeOnly: false }), getSlackRules(),
    supabaseAdmin().from('guesty_listings').select('id,nickname,title,building,address_city').limit(500),
  ])
  const listings = ((units.data || []) as any[]).map(l => {
    const name = l.nickname || l.title || 'Unit'
    return { id: String(l.id), name, building: buildingOf(l.building, name) || '', market: marketOf(l.building, l.address_city, name) }
  }).sort((a, b) => (a.building || 'zz').localeCompare(b.building || 'zz') || a.name.localeCompare(b.name))
  return NextResponse.json({ ok: true, config, catalog, slack: rules.events.guest_orders || null, isOwner: isSuperadmin(access.email), buildings: KNOWN_BUILDINGS, markets: MARKETS, listings })
}

const FEE_RE = /^[A-Z_\-]{2,40}$/

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change guest-order settings.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const out: any = { ok: true }
  if (body?.config && typeof body.config === 'object') {
    const r = await saveGuestOrdersCfg(body.config, access.email || 'owner')
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
    out.config = r.config
  }
  if (Array.isArray(body?.catalog)) {
    const db = supabaseAdmin()
    const rows = body.catalog.slice(0, 200).map((c: any, i: number) => ({
      id: /^[0-9a-f-]{36}$/i.test(String(c?.id || '')) ? String(c.id) : undefined,
      sku: String(c?.sku || '').trim().toLowerCase().replace(/[^a-z0-9\-]/g, '-').slice(0, 40) || ('item-' + Date.now().toString(36) + i),
      name: String(c?.name || '').trim().slice(0, 80) || 'Item',
      description: String(c?.description || '').trim().slice(0, 300) || null,
      price_usd: Math.max(0, Math.round((Number(c?.price_usd) || 0) * 100) / 100),
      unit_label: String(c?.unit_label || '').trim().slice(0, 40) || null,
      category: String(c?.category || '').trim().slice(0, 40) || null,
      fee_code: FEE_RE.test(String(c?.fee_code || '')) ? String(c.fee_code) : 'GUEST_SERVICE',
      max_qty: Math.min(Math.max(Math.floor(Number(c?.max_qty) || 10), 1), 99),
      sort: Number.isFinite(Number(c?.sort)) ? Number(c.sort) : (i + 1) * 10,
      active: c?.active !== false,
      buildings: Array.isArray(c?.buildings) && c.buildings.length ? c.buildings.map((b: any) => String(b).trim()).filter(Boolean) : null,
      markets: Array.isArray(c?.markets) && c.markets.length ? c.markets.map((b: any) => String(b).trim()).filter(Boolean) : null,
      hubs: Array.isArray(c?.hubs) && c.hubs.length ? c.hubs.map((b: any) => String(b).trim()).filter(Boolean) : null,
      track_stock: c?.track_stock === true,
      image_url: /^https?:\/\//.test(String(c?.image_url || '')) ? String(c.image_url).slice(0, 400) : null,
      updated_at: new Date().toISOString(),
      // WHAT WE PAY, only when the caller actually sent it.
      //
      // This field was missing from the mapper entirely, so anything that tried to set a cost here
      // had it silently dropped — the save reported success and the number never landed. It is
      // spread conditionally rather than defaulted because `update()` writes every key in the
      // object: a caller that does not mention cost (the design studio) must not have the existing
      // cost overwritten with a zero or a NaN on its way past.
      ...(c?.cost_usd === undefined || c?.cost_usd === null || c?.cost_usd === ''
        ? {}
        : { cost_usd: Math.max(0, Math.round((Number(c.cost_usd) || 0) * 100) / 100) }),
    }))
    const inserts = rows.filter((r: any) => !r.id).map((r: any) => { const { id, ...rest } = r; return rest })
    const updates = rows.filter((r: any) => r.id)
    if (inserts.length) { const r = await db.from('guest_order_catalog').upsert(inserts, { onConflict: 'sku' }); if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 500 }) }
    for (const u of updates) { const r = await db.from('guest_order_catalog').update(u).eq('id', u.id); if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 500 }) }
    const del = Array.isArray(body?.deleteIds) ? body.deleteIds.filter((x: any) => /^[0-9a-f-]{36}$/i.test(String(x))) : []
    if (del.length) await db.from('guest_order_catalog').delete().in('id', del)
    out.catalog = await loadCatalog({ activeOnly: false })
  }
  return NextResponse.json(out)
}

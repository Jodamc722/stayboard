// DESIGN STUDIO PREVIEW — the guest form's data for a chosen building, as a guest would see it
// (catalog scoped + stock-filtered, timing resolved, copy/look applied), on a synthetic stay.
// Also returns the raw catalog + settings so the studio can edit and re-render without saving.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getGuestOrdersCfg, loadCatalog, orderByFor, timingFor, hubOf, fmtDay, fmtTimeET, todayET, addDays, listStock } from '@/lib/guest-orders'
import { KNOWN_BUILDINGS, MARKETS, marketOf, buildingOf } from '@/lib/segments'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/** Any one listing in this building, so a listings-keyed hub can be resolved from a building name. */
async function listingIdForBuilding(building: string): Promise<string | null> {
  const b = String(building || '').trim().toLowerCase()
  if (!b) return null
  try {
    const { data } = await supabaseAdmin().from('guesty_listings').select('id,nickname,title,building').limit(2000)
    for (const l of ((data || []) as any[])) {
      const name = String(l.nickname || l.title || '')
      if (String(buildingOf(l.building, name) || '').toLowerCase() === b) return String(l.id)
    }
  } catch { /* best effort — a failed lookup just means the old building-keyed behaviour */ }
  return null
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const cfg = await getGuestOrdersCfg()
  const building = String(sp.get('building') || '') || (KNOWN_BUILDINGS[0] ? KNOWN_BUILDINGS[0].label : '')
  const known = KNOWN_BUILDINGS.find(b => b.label.toLowerCase() === building.toLowerCase())
  const market = known ? known.market : marketOf(building, null, building)
  const inHouse = sp.get('inHouse') === '1'
  const today = todayET()
  const checkIn = inHouse ? addDays(today, -1) : addDays(today, 5)
  const checkOut = addDays(checkIn, 4)
  const timing = timingFor(cfg, building, market)
  // A hub may be keyed by LISTING ids rather than buildings (which is how a pilot gets pinned to a
  // handful of units). The studio only knows a building, so resolve one of that building's listings
  // first — otherwise the hub reads as null, every tracked item looks out of stock, no cards render
  // and there is nothing to tap to add a photo. That is what "can't upload pics" turned out to be.
  const sampleListingId = await listingIdForBuilding(building)
  const hub = hubOf(cfg, building, sampleListingId)
  const [catalog, full, stock] = await Promise.all([
    loadCatalog({ building, market, hub: hub ? hub.id : null, hideOutOfStock: true }),
    loadCatalog({ activeOnly: false }),
    listStock(),
  ])
  const orderBy = orderByFor(checkIn, '16:00', timing)
  const arrivalDayStillPossible = Date.now() <= orderBy.getTime()
  const data = {
    stay: { guestFirst: 'Sofia', unit: building + ' 406', building, checkIn, checkOut, checkInLabel: fmtDay(checkIn), checkOutLabel: fmtDay(checkOut), inHouse, departed: false },
    copy: { title: cfg.formTitle, intro: cfg.formIntro, taxPct: timing.taxPct, brand: cfg.brandLine, accent: cfg.accentColor, footer: cfg.footerNote },
    deadline: { orderBy: orderBy.toISOString(), orderByLabel: fmtTimeET(orderBy) + ' ET', arrivalDayStillPossible, nextDelivery: arrivalDayStillPossible ? 'on arrival day, ' + fmtDay(checkIn) : 'within 24 hours of payment', hoursBefore: timing.orderByHoursBefore, leadHours: timing.leadHours, offered: timing.enabled, source: timing.source, taxPct: timing.taxPct, taxSource: timing.taxSource },
    catalog: catalog.map(c => ({ sku: c.sku, name: c.name, description: c.description, price: c.price_usd, unit: c.unit_label, category: c.category || 'Extras', maxQty: c.track_stock && c.available != null ? Math.min(c.max_qty, c.available) : c.max_qty, tiers: c.tiers || null, image: c.image_url, fewLeft: c.track_stock && c.available != null && c.available <= 3 ? c.available : null, id: c.id })),
    orders: [],
  }
  return NextResponse.json({ ok: true, data, building, market, hub: hub ? hub.id : null, config: cfg, catalog: full, stock, buildings: KNOWN_BUILDINGS, markets: MARKETS, hiddenOutOfStock: full.filter(f => f.active && f.track_stock && !catalog.some(c => c.id === f.id)).map(f => f.name) })
}

// DESIGN STUDIO PREVIEW — the guest form's data for a chosen building, as a guest would see it
// (catalog scoped + stock-filtered, timing resolved, copy/look applied), on a synthetic stay.
// Also returns the raw catalog + settings so the studio can edit and re-render without saving.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getGuestOrdersCfg, loadCatalog, orderByFor, timingFor, hubOf, fmtDay, fmtTimeET, todayET, addDays, listStock } from '@/lib/guest-orders'
import { KNOWN_BUILDINGS, MARKETS, marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'

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
  const hub = hubOf(cfg, building)
  const [catalog, full, stock] = await Promise.all([
    loadCatalog({ building, market, hub: hub ? hub.id : null, hideOutOfStock: true }),
    loadCatalog({ activeOnly: false }),
    listStock(),
  ])
  const orderBy = orderByFor(checkIn, '16:00', timing)
  const arrivalDayStillPossible = Date.now() <= orderBy.getTime()
  const data = {
    stay: { guestFirst: 'Sofia', unit: building + ' 406', building, checkIn, checkOut, checkInLabel: fmtDay(checkIn), checkOutLabel: fmtDay(checkOut), inHouse, departed: false },
    copy: { title: cfg.formTitle, intro: cfg.formIntro, taxPct: cfg.taxPct, brand: cfg.brandLine, accent: cfg.accentColor, footer: cfg.footerNote },
    deadline: { orderBy: orderBy.toISOString(), orderByLabel: fmtTimeET(orderBy) + ' ET', arrivalDayStillPossible, nextDelivery: arrivalDayStillPossible ? 'on arrival day, ' + fmtDay(checkIn) : 'within 24 hours of payment', hoursBefore: timing.orderByHoursBefore, leadHours: timing.leadHours, offered: timing.enabled, source: timing.source },
    catalog: catalog.map(c => ({ sku: c.sku, name: c.name, description: c.description, price: c.price_usd, unit: c.unit_label, category: c.category || 'Extras', maxQty: c.track_stock && c.available != null ? Math.min(c.max_qty, c.available) : c.max_qty, image: c.image_url, fewLeft: c.track_stock && c.available != null && c.available <= 3 ? c.available : null, id: c.id })),
    orders: [],
  }
  return NextResponse.json({ ok: true, data, building, market, hub: hub ? hub.id : null, config: cfg, catalog: full, stock, buildings: KNOWN_BUILDINGS, markets: MARKETS, hiddenOutOfStock: full.filter(f => f.active && f.track_stock && !catalog.some(c => c.id === f.id)).map(f => f.name) })
}

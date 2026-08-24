// Guest Orders board data — every basket plus the links that exist for upcoming arrivals.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listOrders, listLinks, getGuestOrdersCfg, linkUrl, todayET, addDays } from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'view')
  if (!gate.ok) return gate.res
  const cfg = await getGuestOrdersCfg()
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 60, 1), 365)
  const today = todayET()
  const [orders, links] = await Promise.all([
    listOrders({ days }),
    listLinks({ from: addDays(today, -2), to: addDays(today, cfg.createDaysBefore + 14) }),
  ])
  const ordersByLink: Record<string, number> = {}
  for (const o of orders) ordersByLink[o.link_code] = (ordersByLink[o.link_code] || 0) + 1
  return NextResponse.json({
    ok: true, today, config: { enabled: cfg.enabled, chargeMode: cfg.chargeMode, customFieldName: cfg.customFieldName, createDaysBefore: cfg.createDaysBefore },
    orders,
    links: links.map(l => ({ ...l, url: linkUrl(l.code, cfg, req.nextUrl.origin), orders: ordersByLink[l.code] || 0 })),
  })
}

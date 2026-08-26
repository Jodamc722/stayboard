// /api/partner/<feed> — the READ-ONLY door the Revenue App pulls Lighthouse through.
//
// The mirror image of what we asked him for: one key in a header, one feed per URL, JSON out, and
// nothing that can change a row on this side. He sends us dollars; this sends him the operational
// volumes his P&L has never had a real denominator for.
//
//   GET /api/partner/units
//   GET /api/partner/cleans?month=2026-07
//   GET /api/partner/labor?month=2026-07
//   GET /api/partner/tasks?month=2026-07
//   GET /api/partner/ops-daily?month=2026-07
//   GET /api/partner/status
//   Header: X-API-Key: <PARTNER_API_KEY>      (or Authorization: Bearer <key>)
//
// FAIL-CLOSED, THREE WAYS. No `PARTNER_API_KEY` env → 503, nothing served. `partner_out.enabled`
// false → 503. A feed switched off → 404. Only GET exists; POST/PUT/DELETE are not exported, so
// Next answers 405 without any code of ours running.
//
// A signed-in Lighthouse user with Revenue access can also call it (for the "preview what he sees"
// button on /revenue/reconcile) — same data, no key needed, because they could already read it.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import {
  getPartnerOut, keyMatches, logPartnerAccess, PARTNER_FEEDS,
  feedUnits, feedCleans, feedLabor, feedTasks, feedOpsDaily, feedStatus,
  type PartnerFeed,
} from '@/lib/partner-feed'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function ipOf(req: NextRequest): string | null {
  const h = req.headers.get('x-forwarded-for') || ''
  return h ? h.split(',')[0].trim() : null
}

export async function GET(req: NextRequest, ctx: { params: { feed: string } }) {
  const t0 = Date.now()
  const feed = String((ctx.params && ctx.params.feed) || '') as PartnerFeed
  const ip = ipOf(req)
  const json = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

  if (PARTNER_FEEDS.indexOf(feed) < 0) return json({ error: 'unknown feed', feeds: PARTNER_FEEDS }, 404)

  const expected = String(process.env.PARTNER_API_KEY || '')
  const given = String(req.headers.get('x-api-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''))
  const byKey = !!expected && keyMatches(given, expected)

  // A person, not the partner app: allowed if they can already see the Revenue tab.
  let byUser = false
  if (!byKey) {
    try {
      const a = await getAccess()
      byUser = !!(a.user && a.allowed && a.levels['revenue'] && a.levels['revenue'] !== 'off')
    } catch { byUser = false }
  }

  if (!byKey && !byUser) {
    const why = !expected ? 'partner access is not configured on this server' : 'bad or missing API key'
    await logPartnerAccess(feed, { q: req.nextUrl.search }, 0, Date.now() - t0, 401, ip)
    return json({ error: 'unauthorized', detail: why }, 401)
  }

  const opts = await getPartnerOut()
  // The switch only governs the partner KEY. A signed-in Lighthouse user is not "the partner", and
  // blocking them here would break the preview button that exists to show Jon what is being shared.
  if (byKey && !opts.enabled) {
    await logPartnerAccess(feed, { q: req.nextUrl.search }, 0, Date.now() - t0, 503, ip)
    return json({ error: 'partner access is switched off', detail: 'ask Jon to enable it on /revenue/reconcile' }, 503)
  }
  if (!opts.feeds[feed]) {
    await logPartnerAccess(feed, { q: req.nextUrl.search }, 0, Date.now() - t0, 404, ip)
    return json({ error: 'feed is switched off', feed }, 404)
  }

  const monthParam = String(req.nextUrl.searchParams.get('month') || '')
  const needsMonth = feed === 'cleans' || feed === 'labor' || feed === 'tasks' || feed === 'ops-daily'
  const month = /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
  if (needsMonth && monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
    return json({ error: 'month must be YYYY-MM', got: monthParam }, 400)
  }

  try {
    let rows: any = null
    if (feed === 'units') rows = await feedUnits()
    else if (feed === 'cleans') rows = await feedCleans(month, opts)
    else if (feed === 'labor') rows = await feedLabor(month, opts)
    else if (feed === 'tasks') rows = await feedTasks(month, opts)
    else if (feed === 'ops-daily') rows = await feedOpsDaily(month)
    else rows = await feedStatus(opts)

    const count = Array.isArray(rows) ? rows.length : (rows && Array.isArray(rows.rows) ? rows.rows.length : 1)
    const ms = Date.now() - t0
    await logPartnerAccess(feed, { month: needsMonth ? month : null, via: byKey ? 'key' : 'user' }, count, ms, 200, ip)
    return json({
      app: 'lighthouse', feed, month: needsMonth ? month : null,
      generated_at: new Date().toISOString(), count,
      data: rows,
    })
  } catch (e: any) {
    const msg = String((e && e.message) || e).slice(0, 300)
    await logPartnerAccess(feed, { q: req.nextUrl.search }, 0, Date.now() - t0, 500, ip)
    return json({ error: 'feed failed', detail: msg }, 500)
  }
}

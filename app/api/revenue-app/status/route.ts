// Revenue App integration — status card + the source flag.
//
// GET  (Revenue view): is it configured, what did each feed do last, what columns his feeds carry,
//                      row counts per mirror table, and a live probe so "is the key working" is one click.
// PUT  (Revenue full): { source: 'lighthouse' | 'revenue_app', maxStaleHours } — the cutover flag.
//                      Owner/admin only through the role level; every flip is logged by requireLevel.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { setSetting } from '@/lib/app-settings'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { revenueAppConfig, fetchFeed, parseFeed, FEEDS_LIVE, FEEDS_REQUESTED, REVENUE_APP_FEEDS, type Feed } from '@/lib/revenue-app'
import { getRevenueSourceSetting, REVENUE_SOURCE_KEY, DEFAULT_REVENUE_SOURCE } from '@/lib/revenue-source'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TABLES = ['rev_feed_row', 'rev_unit_month', 'rev_budget_month', 'rev_snapshot_day', 'rev_building_config', 'rev_owner_map', 'rev_pnl_line'] as const

export async function GET(req: NextRequest) {
  const g = await requireLevel('revenue', 'view'); if (!g.ok) return g.res
  const db = supabaseAdmin()
  const cfg = revenueAppConfig()
  const setting = await getRevenueSourceSetting()

  const [{ data: statusRows }, ...counts] = await Promise.all([
    db.from('rev_sync_status').select('*'),
    ...TABLES.map(t => db.from(t).select('*', { count: 'exact', head: true })),
  ])
  const tables: Record<string, number | null> = {}
  TABLES.forEach((t, i) => { tables[t] = (counts[i] as any)?.count ?? null })

  // Which columns each feed actually carries — read from the raw landing rows, one sample per feed.
  const columns: Record<string, string[]> = {}
  for (const f of REVENUE_APP_FEEDS) {
    const { data } = await db.from('rev_feed_row').select('row').eq('feed', f).limit(1)
    if (data?.[0]?.row) columns[f] = Object.keys(data[0].row)
  }

  const byFeed = new Map<string, any>((statusRows || []).map((r: any) => [r.feed, r]))
  const feeds = REVENUE_APP_FEEDS.map(f => ({
    feed: f,
    wired: FEEDS_LIVE.includes(f) ? 'live' : 'requested',
    status: byFeed.get(f)?.status || 'never',
    last_sync_at: byFeed.get(f)?.last_sync_at || null,
    last_ok_at: byFeed.get(f)?.last_ok_at || null,
    items: byFeed.get(f)?.items ?? 0,
    http: byFeed.get(f)?.http_status ?? null,
    error: byFeed.get(f)?.last_error || null,
    columns: columns[f] || [],
  }))

  // Live probe (optional, ?probe=1): the cheapest feed, so the card can say "key works" right now.
  let probe: any = null
  if (req.nextUrl.searchParams.get('probe') === '1' && cfg.configured) {
    const feed = (req.nextUrl.searchParams.get('feed') || 'building-config') as Feed
    const r = await fetchFeed(feed, {}, 10_000)
    probe = r.ok
      ? { ok: true, feed, http: r.status, ms: r.ms, contentType: r.contentType, rows: parseFeed(r).length, sample: parseFeed(r).slice(0, 2) }
      : { ok: false, feed, http: r.status, ms: r.ms, missing: r.missing, error: r.error }
  }

  return NextResponse.json({
    configured: cfg.configured, url: cfg.url || null, authHeader: cfg.header,
    setting, defaults: DEFAULT_REVENUE_SOURCE,
    live: FEEDS_LIVE, requested: FEEDS_REQUESTED,
    feeds, tables, probe,
  })
}

export async function PUT(req: NextRequest) {
  const g = await requireLevel('revenue', 'full'); if (!g.ok) return g.res
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const source = body?.source === 'revenue_app' ? 'revenue_app' : 'lighthouse'
  const maxStaleHours = Number(body?.maxStaleHours) > 0 ? Math.min(168, Number(body.maxStaleHours)) : DEFAULT_REVENUE_SOURCE.maxStaleHours
  const r = await setSetting(REVENUE_SOURCE_KEY, { source, maxStaleHours, changedBy: g.access.email || null, changedAt: new Date().toISOString() }, g.access.email || null)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, setting: { source, maxStaleHours } })
}

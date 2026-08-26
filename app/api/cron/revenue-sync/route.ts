// REVENUE APP SYNC — pulls the boss's revenue app into Lighthouse's rev_* mirror (migration 051).
//
// Runs hourly (vercel.json, minute 38 — his own Guesty sync is hourly, so anything faster would
// only re-read the same numbers). Also callable by a signed-in owner/admin for "Sync now".
//
// It never fails the whole run because one feed is missing: each feed gets its own status row
// (ok | missing | error) so the status card can say exactly which of the eleven feeds he has
// wired and which are still on the request list. A feed he has not built yet is `missing`; a
// wrong key is `error` — those are different problems and are shown differently.
//
// Auth matches the other crons: enforce the bearer token when CRON_SECRET is set, otherwise run
// open so the schedule works without extra configuration. A signed-in user with full access on
// the Revenue tab may also trigger it (the Sync-now button).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'
import {
  fetchFeed, parseFeed, rowKey, pick, num, bool, ym, coverage, monthsBack,
  FEEDS_LIVE, FEEDS_REQUESTED, revenueAppConfig, type Feed, type Row,
} from '@/lib/revenue-app'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type FeedReport = { feed: Feed; month?: string; status: 'ok' | 'missing' | 'error'; items: number; ms: number; http?: number; error?: string; found?: string[]; missing?: string[] }

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

async function landRaw(feed: Feed, month: string, rows: Row[]) {
  if (!rows.length) return
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const recs = rows.map((row, i) => ({ feed, month, row_key: rowKey(row), row_no: i, row, synced_at: now }))
  for (let i = 0; i < recs.length; i += 500) {
    const { error } = await db.from('rev_feed_row').upsert(recs.slice(i, i + 500), { onConflict: 'feed,month,row_key' })
    if (error) throw new Error('rev_feed_row: ' + error.message)
  }
}

async function upsert(table: string, recs: any[], onConflict: string) {
  if (!recs.length) return
  const db = supabaseAdmin()
  for (let i = 0; i < recs.length; i += 500) {
    const { error } = await db.from(table).upsert(recs.slice(i, i + 500), { onConflict })
    if (error) throw new Error(table + ': ' + error.message)
  }
}

// ---- typed mappers (best-effort; the raw row always lands first) ----

function unitMonthRec(r: Row, month: string, kind: 'live' | 'eom' | 'budget', asOf?: string | null) {
  const id = pick(r, 'listing_id'); if (!id) return null
  return {
    guesty_listing_id: id, month, kind,
    unit_name: pick(r, 'unit_name') ?? null, building: pick(r, 'building') ?? null, owner_name: pick(r, 'owner_name') ?? null,
    nights_available: num(pick(r, 'nights_available')), nights_sold: num(pick(r, 'nights_sold')),
    check_ins: num(pick(r, 'check_ins')), check_outs: num(pick(r, 'check_outs')),
    occupancy: num(pick(r, 'occupancy')),
    gross_accom: num(pick(r, 'gross_accom')), net_accom: num(pick(r, 'net_accom')),
    gross_adr: num(pick(r, 'gross_adr')), net_adr: num(pick(r, 'net_adr')),
    gross_cleaning: num(pick(r, 'gross_cleaning')), net_cleaning: num(pick(r, 'net_cleaning')),
    mgmt_fee: num(pick(r, 'mgmt_fee')), other_revenue: num(pick(r, 'other_revenue')), stay_revenue: num(pick(r, 'stay_revenue')),
    fee_basis: pick(r, 'fee_basis') ?? null,
    as_of: asOf ?? ((pick(r, 'as_of') || '').slice(0, 10) || null),
    raw: r, synced_at: new Date().toISOString(),
  }
}

function snapshotRec(r: Row, month: string, scope: string) {
  const d = (pick(r, 'as_of') || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  return {
    month, snapshot_date: d, scope,
    nights_sold: num(pick(r, 'nights_sold')), nights_available: num(pick(r, 'nights_available')),
    occupancy: num(pick(r, 'occupancy')), gross_accom: num(pick(r, 'gross_accom')), net_accom: num(pick(r, 'net_accom')),
    net_cleaning: num(pick(r, 'net_cleaning')), mgmt_fee: num(pick(r, 'mgmt_fee')),
    reservations: num(pick(r, 'reservations')), open_nights: num(pick(r, 'open_nights')),
    forecast_net_accom: num(pick(r, 'forecast_net_accom')),
    raw: r, synced_at: new Date().toISOString(),
  }
}

const UNIT_FIELDS = ['listing_id', 'unit_name', 'building', 'nights_sold', 'nights_available', 'occupancy', 'gross_accom', 'net_accom', 'net_cleaning', 'mgmt_fee'] as const

async function syncFeed(feed: Feed, month: string, today: string): Promise<FeedReport> {
  const res = await fetchFeed(feed, month ? { month } : {})
  if (!res.ok) return { feed, month: month || undefined, status: res.missing ? 'missing' : 'error', items: 0, ms: res.ms, http: res.status, error: res.error }
  const rows = parseFeed(res)
  await landRaw(feed, month, rows)
  const rep: FeedReport = { feed, month: month || undefined, status: 'ok', items: rows.length, ms: res.ms, http: res.status }

  switch (feed) {
    case 'snapshots': {
      // Per-unit rows → rev_unit_month kind=live (newest as_of wins); portfolio rows → rev_snapshot_day.
      const unitRows = rows.filter(r => pick(r, 'listing_id'))
      const portRows = rows.filter(r => !pick(r, 'listing_id'))
      const latest = new Map<string, Row>()
      for (const r of unitRows) {
        const id = pick(r, 'listing_id')!, d = (pick(r, 'as_of') || '').slice(0, 10)
        const prev = latest.get(id)
        if (!prev || d >= (pick(prev, 'as_of') || '').slice(0, 10)) latest.set(id, r)
      }
      await upsert('rev_unit_month', Array.from(latest.values()).map(r => unitMonthRec(r, month, 'live')).filter(Boolean), 'guesty_listing_id,month,kind')
      await upsert('rev_snapshot_day', portRows.map(r => snapshotRec(r, month, 'portfolio')).filter(Boolean), 'month,snapshot_date,scope')
      Object.assign(rep, coverage(rows, [...UNIT_FIELDS, 'as_of']))
      break
    }
    case 'eom':
    case 'official-prior':
    case 'unit-month': {
      const recs: any[] = []
      for (const r of rows) {
        const m = month || ym(pick(r, 'month')); if (!m) continue
        const k = (pick(r, 'kind') || '').toLowerCase()
        const kind: 'live' | 'eom' | 'budget' = k === 'budget' ? 'budget' : k === 'live' ? 'live' : 'eom'
        const rec = unitMonthRec(r, m, kind); if (rec) recs.push(rec)
      }
      await upsert('rev_unit_month', recs, 'guesty_listing_id,month,kind')
      Object.assign(rep, coverage(rows, [...UNIT_FIELDS, 'month']))
      break
    }
    case 'budget': {
      const recs: any[] = []
      for (const r of rows) {
        const m = ym(pick(r, 'month')); if (!m) continue
        const lid = pick(r, 'listing_id'), b = pick(r, 'building')
        const scope = lid ? 'unit:' + lid : b ? 'building:' + b : 'portfolio'
        recs.push({
          month: m, scope, version: pick(r, 'version') || 'current',
          nights_sold: num(pick(r, 'nights_sold')), occupancy: num(pick(r, 'occupancy')), adr: num(pick(r, 'gross_adr')),
          net_accom: num(pick(r, 'net_accom')), mgmt_fee: num(pick(r, 'mgmt_fee')), net_cleaning: num(pick(r, 'net_cleaning')),
          other_revenue: num(pick(r, 'other_revenue')), total: num(pick(r, 'total')),
          raw: r, synced_at: new Date().toISOString(),
        })
        // Unit-level budget also lands beside the actuals so the reconcile page has one join.
        if (lid) { const u = unitMonthRec(r, m, 'budget'); if (u) recs.push(u) }
      }
      await upsert('rev_budget_month', recs.filter(x => 'scope' in x), 'month,scope,version')
      await upsert('rev_unit_month', recs.filter(x => 'kind' in x), 'guesty_listing_id,month,kind')
      Object.assign(rep, coverage(rows, ['month', 'net_accom', 'mgmt_fee', 'net_cleaning', 'other_revenue', 'total', 'building', 'listing_id']))
      break
    }
    case 'owner-map': {
      await upsert('rev_owner_map', rows.map(r => {
        const id = pick(r, 'listing_id'); if (!id) return null
        return { guesty_listing_id: id, unit_name: pick(r, 'unit_name') ?? null, building: pick(r, 'building') ?? null,
          owner_id: pick(r, 'owner_id') ?? null, owner_name: pick(r, 'owner_name') ?? null, commission_pct: num(pick(r, 'fee_basis')),
          raw: r, synced_at: new Date().toISOString() }
      }).filter(Boolean), 'guesty_listing_id')
      Object.assign(rep, coverage(rows, ['listing_id', 'unit_name', 'building', 'owner_id', 'owner_name']))
      break
    }
    case 'building-config': {
      await upsert('rev_building_config', rows.map(r => {
        const b = pick(r, 'building'); if (!b) return null
        return { building: b, fee_pct: num(pick(r, 'fee_basis')), fee_basis: pick(r, 'fee_basis') ?? null,
          owner_clean: bool(pick(r, 'owner_clean')), city: pick(r, 'city') ?? null, notes: null,
          raw: r, synced_at: new Date().toISOString() }
      }).filter(Boolean), 'building')
      Object.assign(rep, coverage(rows, ['building', 'fee_basis', 'owner_clean', 'city']))
      break
    }
    case 'pnl': {
      const recs: any[] = []
      for (const r of rows) {
        const m = ym(pick(r, 'month')), acct = pick(r, 'account'); if (!m || !acct) continue
        const k = (pick(r, 'kind') || 'actual').toLowerCase()
        recs.push({ year: Number(m.slice(0, 4)), month: m, account: acct, account_name: pick(r, 'account_name') ?? null,
          unit: pick(r, 'unit') ?? null, kind: k === 'live' || k === 'forecast' ? k : 'actual',
          amount: num(pick(r, 'amount')), rate: pick(r, 'rate') ?? null, raw: r, synced_at: new Date().toISOString() })
      }
      await upsert('rev_pnl_line', recs, 'month,account,kind')
      Object.assign(rep, coverage(rows, ['month', 'account', 'account_name', 'unit', 'kind', 'amount']))
      break
    }
    case 'projections': {
      // His Bear / Base / Bull month-end forecast. Every vintage is kept (`as_of` is part of the
      // key) because a forecast that overwrites yesterday's cannot be judged later.
      const recs: any[] = []
      for (const r of rows) {
        const m = ym(pick(r, 'month')); if (!m) continue
        const asOf = (pick(r, 'as_of') || today).slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) continue
        const lid = pick(r, 'listing_id'), b = pick(r, 'building')
        recs.push({
          month: m, scenario: (pick(r, 'scenario') || 'base').toLowerCase(), as_of: asOf,
          scope: lid ? 'unit:' + lid : b ? 'building:' + b : 'portfolio',
          nights_sold: num(pick(r, 'nights_sold')), occupancy: num(pick(r, 'occupancy')), adr: num(pick(r, 'gross_adr')),
          net_accom: num(pick(r, 'net_accom')), net_cleaning: num(pick(r, 'net_cleaning')),
          mgmt_fee: num(pick(r, 'mgmt_fee')), other_revenue: num(pick(r, 'other_revenue')), total: num(pick(r, 'total')),
          raw: r, synced_at: new Date().toISOString(),
        })
      }
      await upsert('rev_projection', recs, 'month,scenario,as_of,scope')
      Object.assign(rep, coverage(rows, ['month', 'scenario', 'as_of', 'net_accom', 'total', 'occupancy']))
      break
    }
    default:
      // assumptions · reservations · status — raw landing only until the columns are agreed.
      break
  }
  return rep
}

async function writeStatus(reps: FeedReport[]) {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  // One status row per feed (the month-scoped feeds collapse to their worst status).
  const byFeed = new Map<string, FeedReport[]>()
  for (const r of reps) byFeed.set(r.feed, [...(byFeed.get(r.feed) || []), r])
  for (const [feed, list] of Array.from(byFeed.entries())) {
    const worst = list.find((r: FeedReport) => r.status === 'error') || list.find((r: FeedReport) => r.status === 'missing') || list[0]
    const items = list.reduce((s: number, r: FeedReport) => s + r.items, 0)
    const rec: any = { feed, status: worst.status, last_sync_at: now, items, http_status: worst.http ?? null, last_error: worst.error ?? null, updated_at: now }
    if (worst.status === 'ok') rec.last_ok_at = now
    await db.from('rev_sync_status').upsert(rec, { onConflict: 'feed' })
  }
}

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const viaCron = !!secret && auth === 'Bearer ' + secret
  if (!viaCron) {
    if (secret) {
      // Not the cron — allow a signed-in user with full access on Revenue (the Sync-now button).
      const a = await getAccess()
      const lvl = a.user && a.allowed ? a.levels['revenue'] : undefined
      if (lvl !== 'full') return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const cfg = revenueAppConfig()
  if (!cfg.configured) {
    await writeStatus([{ feed: 'status', status: 'error', items: 0, ms: 0, error: 'REVENUE_APP_URL / REVENUE_APP_API_KEY not set in Vercel' }])
    return NextResponse.json({ ok: false, error: 'Revenue App not configured — set REVENUE_APP_URL and REVENUE_APP_API_KEY' }, { status: 200 })
  }

  const today = todayET()
  const only = (req.nextUrl.searchParams.get('only') || '').split(',').map(s => s.trim()).filter(Boolean) as Feed[]
  const want = (f: Feed) => !only.length || only.includes(f)
  const months = monthsBack(2, today)          // current + previous month for the live snapshot
  const closed = monthsBack(4, today).slice(1) // three closed months for eom

  const jobs: Array<() => Promise<FeedReport>> = []
  if (want('snapshots')) for (const m of months) jobs.push(() => syncFeed('snapshots', m, today))
  if (want('eom')) for (const m of closed) jobs.push(() => syncFeed('eom', m, today))
  for (const f of ['official-prior', 'budget', 'owner-map', 'building-config'] as Feed[]) if (want(f)) jobs.push(() => syncFeed(f, '', today))
  if (want('unit-month')) for (const m of months) jobs.push(() => syncFeed('unit-month', m, today))
  if (want('pnl')) jobs.push(() => syncFeed('pnl', '', today))
  if (want('projections')) jobs.push(() => syncFeed('projections', '', today))
  for (const f of ['assumptions', 'reservations', 'status'] as Feed[]) if (want(f)) jobs.push(() => syncFeed(f, '', today))

  const reps: FeedReport[] = []
  const t0 = Date.now()
  for (const job of jobs) {
    if (Date.now() - t0 > 50_000) { reps.push({ feed: 'status', status: 'error', items: 0, ms: 0, error: 'out of time — remaining feeds skipped this run' }); break }
    try { reps.push(await job()) }
    catch (e: any) { reps.push({ feed: 'status', status: 'error', items: 0, ms: 0, error: String(e?.message || e) }) }
  }
  await writeStatus(reps)

  const okFeeds = Array.from(new Set(reps.filter(r => r.status === 'ok').map(r => r.feed)))
  const missing = Array.from(new Set(reps.filter(r => r.status === 'missing').map(r => r.feed)))
  const errors = reps.filter(r => r.status === 'error')
  return NextResponse.json({
    ok: errors.length === 0, today, ms: Date.now() - t0,
    live: FEEDS_LIVE, requested: FEEDS_REQUESTED,
    okFeeds, missing, errors, reports: reps,
  })
}

export const GET = run
export const POST = run

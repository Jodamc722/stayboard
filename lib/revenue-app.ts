// Revenue App client — Lighthouse's ONLY door into the boss's revenue app (stay-hospitalitydrr.netlify.app).
//
// WHAT THAT APP IS (seen live 2026-08-24): a single-file JS app on Netlify with two functions —
//   /.netlify/functions/auth?action=me                       (passwordless email session, cookie)
//   /.netlify/functions/sync-csv?type=<feed>[&month=YYYY-MM]  (CSV, one feed per type)
// Feeds it serves TODAY: snapshots (daily pickup, per month) · eom (closed month) · official-prior ·
// budget · owner-map · building-config. Feeds we ASKED him to add: unit-month · pnl · assumptions ·
// reservations · status. The cron treats a 404/400 on those as "not provided yet", never as a failure.
//
// RULES THIS FILE ENFORCES
//   • Server-only. The API key never reaches the browser.
//   • Read-only. There is no write helper and there never will be — money flows one way.
//   • Tolerant. We do not control his column names. Every row is landed untouched in rev_feed_row;
//     the typed mapping below is best-effort through ALIASES and says which columns it could not find.
//   • Honest. A feed that is missing is reported missing. Nothing is inferred to fill a gap.
//
// ENV
//   REVENUE_APP_URL          e.g. https://stay-hospitalitydrr.netlify.app   (no trailing slash)
//   REVENUE_APP_API_KEY      the service key he issues to Lighthouse
//   REVENUE_APP_AUTH_HEADER  optional; default 'X-API-Key'. Set to 'Authorization' to send `Bearer <key>`.
import 'server-only'
import { createHash } from 'crypto'

export const REVENUE_APP_FEEDS = [
  'snapshots', 'eom', 'official-prior', 'budget', 'owner-map', 'building-config',
  'unit-month', 'pnl', 'assumptions', 'reservations', 'status',
] as const
export type Feed = typeof REVENUE_APP_FEEDS[number]

/** Feeds his app already serves (verified live 2026-08-24). Everything else is on the request list. */
export const FEEDS_LIVE: Feed[] = ['snapshots', 'eom', 'official-prior', 'budget', 'owner-map', 'building-config']
export const FEEDS_REQUESTED: Feed[] = ['unit-month', 'pnl', 'assumptions', 'reservations', 'status']

export function revenueAppConfig(): { url: string; key: string; header: string; configured: boolean } {
  const url = String(process.env.REVENUE_APP_URL || '').replace(/\/+$/, '')
  const key = String(process.env.REVENUE_APP_API_KEY || '')
  const header = String(process.env.REVENUE_APP_AUTH_HEADER || 'X-API-Key')
  return { url, key, header, configured: !!(url && key) }
}

export type FetchResult =
  | { ok: true; status: number; contentType: string; text: string; ms: number }
  | { ok: false; status: number; error: string; ms: number; missing: boolean }

/**
 * GET one feed. `missing` is true on 400/404/501 — the type isn't offered (yet). A 401/403 means
 * the key is wrong or he hasn't wired it; that is an ERROR, not a missing feed, so it shows red.
 */
export async function fetchFeed(feed: Feed, params: Record<string, string> = {}, timeoutMs = 20_000): Promise<FetchResult> {
  const cfg = revenueAppConfig()
  const t0 = Date.now()
  if (!cfg.configured) return { ok: false, status: 0, error: 'REVENUE_APP_URL / REVENUE_APP_API_KEY not set', ms: 0, missing: false }
  const qs = new URLSearchParams({ type: feed, ...params }).toString()
  const url = `${cfg.url}/.netlify/functions/sync-csv?${qs}`
  const headers: Record<string, string> = { Accept: 'text/csv, application/json;q=0.9, */*;q=0.5' }
  if (cfg.header.toLowerCase() === 'authorization') headers.Authorization = `Bearer ${cfg.key}`
  else headers[cfg.header] = cfg.key
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers, cache: 'no-store', signal: ctrl.signal })
    const text = await r.text()
    const ms = Date.now() - t0
    if (!r.ok) {
      const missing = r.status === 400 || r.status === 404 || r.status === 501
      return { ok: false, status: r.status, error: `${r.status} ${text.slice(0, 200)}`, ms, missing }
    }
    // His app answers a session-less browser with the login page (200 + HTML). Treat that as auth failure.
    const ct = r.headers.get('content-type') || ''
    if (/text\/html/i.test(ct) || /^\s*<!doctype html/i.test(text)) {
      return { ok: false, status: 401, error: 'got the sign-in page — the API key is not being honoured by sync-csv', ms, missing: false }
    }
    return { ok: true, status: r.status, contentType: ct, text, ms }
  } catch (e: any) {
    return { ok: false, status: 0, error: String(e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e?.message || e), ms: Date.now() - t0, missing: false }
  } finally { clearTimeout(timer) }
}

// ---------------------------------------------------------------------------------------------
// Parsing — CSV (RFC 4180, what PapaParse writes) or JSON (array, or {rows|data|results: []})
// ---------------------------------------------------------------------------------------------

export type Row = Record<string, string>

/** Header → snake_case key: "Net Accom ($)" → net_accom, "OCC%" → occ_pct, "Guesty ID" → guesty_id */
export function normKey(h: string): string {
  return String(h || '')
    .trim()
    .replace(/%/g, ' pct ')
    .replace(/\$/g, ' usd ')
    .replace(/#/g, ' num ')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

export function parseCsv(text: string): Row[] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let cur: string[] = [], field = '', q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { cur.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      cur.push(field); field = ''
      if (cur.some(v => v !== '')) rows.push(cur)
      cur = []
    } else field += c
  }
  cur.push(field); if (cur.some(v => v !== '')) rows.push(cur)
  if (rows.length < 2) return []
  const headers = rows[0].map(normKey)
  return rows.slice(1).map(r => {
    const o: Row = {}
    headers.forEach((h, i) => { if (h) o[h] = (r[i] ?? '').trim() })
    return o
  })
}

export function parseFeed(res: Extract<FetchResult, { ok: true }>): Row[] {
  const t = res.text.trim()
  if (!t) return []
  if (/application\/json/i.test(res.contentType) || t[0] === '[' || t[0] === '{') {
    try {
      const j = JSON.parse(t)
      const arr: any[] = Array.isArray(j) ? j : j?.rows ?? j?.data ?? j?.results ?? (j && typeof j === 'object' ? [j] : [])
      return arr.map(o => {
        const r: Row = {}
        for (const [k, v] of Object.entries(o || {})) r[normKey(k)] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
        return r
      })
    } catch { /* fall through to csv */ }
  }
  return parseCsv(t)
}

export function rowKey(row: Row): string {
  const keys = Object.keys(row).sort()
  return createHash('sha1').update(keys.map(k => k + '=' + row[k]).join('')).digest('hex')
}

// ---------------------------------------------------------------------------------------------
// Field mapping — ALIASES, because we do not own his headers. First alias present wins.
// `pick()` returns undefined (not 0) when nothing matches, so a missing column stays visible.
// ---------------------------------------------------------------------------------------------

export const ALIASES: Record<string, string[]> = {
  listing_id:   ['guesty_listing_id', 'listing_id', 'guesty_id', 'listingid', 'unit_id', 'id'],
  unit_name:    ['unit', 'unit_name', 'listing', 'listing_name', 'nickname', 'name', 'title'],
  building:     ['building', 'bldg', 'property', 'building_name'],
  owner_id:     ['owner_id', 'guesty_owner_id', 'ownerid'],
  owner_name:   ['owner', 'owner_name', 'ownername'],
  month:        ['month', 'period', 'ym', 'yyyy_mm'],
  as_of:        ['as_of', 'asof', 'snapshot', 'snapshot_date', 'date', 'day'],
  nights_available: ['nights_available', 'available_nights', 'avail_nights', 'available', 'unit_nights'],
  nights_sold:  ['nights_sold', 'nights', 'sold_nights', 'occupied_nights', 'nights_on_books', 'booked_nights'],
  check_ins:    ['check_ins', 'checkins', 'arrivals', 'stays'],
  check_outs:   ['check_outs', 'checkouts', 'departures'],
  occupancy:    ['occupancy', 'occ', 'occ_pct', 'occupancy_pct', 'occ_pct_'],
  gross_accom:  ['gross_accom', 'gross_accommodation', 'gross_accom_usd', 'gross', 'fare_accommodation'],
  net_accom:    ['net_accom', 'net_accommodation', 'net_accom_usd', 'net', 'fare_accommodation_adjusted'],
  gross_adr:    ['gross_adr', 'adr_gross', 'adr'],
  net_adr:      ['net_adr', 'adr_net'],
  gross_cleaning: ['gross_cleaning', 'cleaning_gross', 'cleaning_billed_gross'],
  net_cleaning: ['net_cleaning', 'cleaning_net', 'cleaning', 'cleaning_fees', 'net_cleaning_usd'],
  mgmt_fee:     ['mgmt_fee', 'management_fee', 'management_fees', 'commission', 'fee'],
  other_revenue: ['other_revenue', 'other', 'other_income', 'fees_to_stay'],
  stay_revenue: ['stay_revenue', 'stay_hospitality_revenue', 'stay_rev'],
  fee_basis:    ['fee_basis', 'basis', 'fee', 'fee_pct', 'commission_pct', 'mgmt_pct'],
  owner_clean:  ['owner_clean', 'ownerclean', 'owner_cleaned', 'vendor_clean'],
  city:         ['city', 'market'],
  reservations: ['reservations', 'bookings', 'res_count'],
  open_nights:  ['open_nights', 'open', 'remaining_nights', 'ceiling_nights'],
  forecast_net_accom: ['forecast', 'forecast_net_accom', 'projection', 'base_projection'],
  total:        ['total', 'net_total', 'total_budget'],
  account:      ['account', 'acct', 'account_no', 'code', 'line'],
  account_name: ['account_name', 'name', 'description', 'line_name'],
  unit:         ['unit', 'business_unit', 'bu', 'group'],
  amount:       ['amount', 'value', 'usd'],
  kind:         ['kind', 'type', 'status', 'basis_kind'],
  rate:         ['rate', 'driver', 'rate_label'],
  version:      ['version', 'budget_version', 'label'],
}

export function pick(row: Row, field: keyof typeof ALIASES): string | undefined {
  for (const a of ALIASES[field]) if (a in row && row[a] !== '') return row[a]
  return undefined
}
export function num(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1'))
  return Number.isFinite(n) ? n : null
}
export function bool(v: string | undefined): boolean | null {
  if (v == null || v === '') return null
  return /^(1|y|yes|true|owner|vendor)$/i.test(v.trim())
}
/** "2026-08", "2026-08-24", "Aug 2026", "8/2026" → "2026-08" */
export function ym(v: string | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{2})/); if (m) return `${m[1]}-${m[2]}`
  m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`
  m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/)
  if (m) {
    const i = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase())
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`
  }
  const d = new Date(s); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 7)
  return null
}

/** Which of the columns we care about a feed's rows actually carry — surfaced on the status card. */
export function coverage(rows: Row[], fields: (keyof typeof ALIASES)[]): { found: string[]; missing: string[] } {
  const sample = rows.slice(0, 50)
  const found: string[] = [], missing: string[] = []
  for (const f of fields) (sample.some(r => pick(r, f) !== undefined) ? found : missing).push(f)
  return { found, missing }
}

export function monthsBack(n: number, todayIso?: string): string[] {
  const t = todayIso ? new Date(todayIso + 'T12:00:00Z') : new Date()
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

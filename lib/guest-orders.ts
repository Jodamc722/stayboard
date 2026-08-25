// GUEST ORDERS — the vending machine (Jon, 2026-08-24). See migration 048 for the brief.
//
// THE PIPELINE, one function per hop, every hop idempotent so the cron can re-run safely:
//
//   ensureLink(reservation)      one unguessable /order/<code> per reservation, written into the
//                                Guesty reservation custom field "Order form" so Guesty's own
//                                pre-arrival automation carries it to the guest
//   submitOrder(code, basket)    guest's basket → guest_orders (status submitted) → CCS told in Slack
//                                (a notice only — approval happens on /guest-orders in the app)
//   approveOrder(id, actor)      folio lines + charge the card Guesty holds → paid, or
//                                awaiting_payment with the exact reason when there is no card
//   pushDue(today)               every paid order whose delivery date has arrived → ONE Breezeway
//                                housekeeping task on the unit, assigned to the cleaner on that
//                                unit's clean (else the market supervisor), Slack to the area HK
//                                channel + supervisor DMs, email digest, live link
//
// TIMING RULE (Jon): "Needs to be completed within 24 to 48 hours minimum in order to receive a
// day of arrival. Once payment is approved, it takes at least 24 hours to receive. Could be same
// day depending on the time." → deliveryDateFor() below; every number is a setting.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { getToken, syncCustomFields } from './guesty'
import { writeCustomFields } from './guesty-custom-fields'
import { buildingOf, marketOf, KNOWN_BUILDINGS, MARKETS } from './segments'
import { listPaymentMethods, pickChargeable, createInvoiceItems, deleteInvoiceItem, chargeSavedCard, recordExternalPayment } from './guesty-payments'
import { createBreezewayTask, updateBreezewayTask, matchBreezewayPerson } from './breezeway'
import { getTaskAutomation } from './auto-inspections'
import { draft } from './slack-queue'
import { getSlackRules, groupForBuilding, channelFor, audienceFor, resolveSlackId } from './slack-rules'
import { getDirectory } from './slack'
import { sendResendEmail } from './resend-send'

// ── Settings ──────────────────────────────────────────────────────────────────────────────────

export const GUEST_ORDERS_KEY = 'guest_orders'

export type GuestOrdersCfg = {
  /** Master switch for the cron: link creation + custom-field write + delivery pushes. */
  enabled: boolean
  /** How many days before check-in the link is created and written to Guesty. */
  createDaysBefore: number
  /** Guesty RESERVATION custom field that carries the link. Jon: "Order form". */
  customFieldName: string
  /** Hours before check-in the guest must order by to get arrival-day delivery (shown on the form). */
  orderByHoursBefore: number
  /** Hours after payment before we can deliver. */
  leadHours: number
  /** Paid before this hour (ET) on a day → can go the same day. */
  sameDayCutoffHour: number
  /** Default check-in hour when the listing has none. */
  checkInHour: number
  /** Sales tax applied to the basket, percent. 0 = prices are all-in. */
  taxPct: number
  /** 'auto' charges the card Guesty holds on approval; 'manual' every order waits for a human to mark it paid. */
  chargeMode: 'auto' | 'manual'
  /** Who gets the email when an order is pushed for delivery. */
  emailRecipients: string[]
  /** Public base URL for the links (falls back to the request origin / Vercel URL). */
  publicBase: string
  /** Guest-facing copy + look. */
  formTitle: string
  formIntro: string
  brandLine: string
  accentColor: string
  footerNote: string
  /** Sources we never create links for (owner stays, blocks). Regex, case-insensitive. */
  skipSourcesRe: string
  /** Per-market overrides (Miami | Broward | North): switch a whole location off or change its timing. */
  marketRules: Record<string, ScopeRule>
  /** Per-building overrides (canonical labels from lib/segments). Building beats hub beats market beats global. */
  buildingRules: Record<string, ScopeRule>
  /** LOCATION HUBS (Jon, 2026-08-24): named groups of buildings — where supplies sit, and a scope for catalog/timing/stock. */
  hubs: Hub[]
  hubRules: Record<string, ScopeRule>
}
/**
 * A HUB IS A GROUP OF LISTINGS OR PROPERTIES (Jon, 2026-08-25) — a shared shelf.
 * `buildings` takes a whole property in one click; `listings` names individual units, for the
 * common case where a shelf serves some units in a building but not all, or spans buildings.
 * A listing named directly BEATS its building, so one unit can be pulled into a different hub.
 */
export type Hub = { id: string; label: string; buildings: string[]; listings: string[] }
/** What can differ by building / location (Jon, 2026-08-24: "customizable by building and by location"). */
export type ScopeRule = { enabled?: boolean; orderByHoursBefore?: number; leadHours?: number; sameDayCutoffHour?: number; taxPct?: number }
export type Timing = { enabled: boolean; orderByHoursBefore: number; leadHours: number; sameDayCutoffHour: number; checkInHour: number; taxPct: number; source: string; taxSource: string }

export const GUEST_ORDERS_DEFAULTS: GuestOrdersCfg = {
  enabled: false,
  createDaysBefore: 7,
  customFieldName: 'Order form',
  orderByHoursBefore: 48,
  leadHours: 24,
  sameDayCutoffHour: 11,
  checkInHour: 16,
  taxPct: 0,
  chargeMode: 'auto',
  emailRecipients: ['jon@stay-hospitality.com'],
  publicBase: 'https://lighthouse-stay.vercel.app',
  formTitle: 'Have it waiting for you',
  formIntro: 'Pick anything you would like stocked in your suite before you walk in — order before the cutoff below and it is waiting for you on arrival day.',
  brandLine: 'Stay Hospitality',
  accentColor: '#1F5C46',
  footerNote: 'Once confirmed, the total is charged to the card on your reservation. Questions? Just reply to your booking message.',
  skipSourcesRe: '^(owner|manual|block|blocked)',
  marketRules: {},
  buildingRules: {},
  hubs: [],
  hubRules: {},
}

const num = (v: any, fb: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : fb }
const str = (v: any, fb: string, max = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fb)
const optNum = (v: any, lo: number, hi: number): number | undefined => { if (v === '' || v === null || v === undefined) return undefined; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined }
function normScope(o: any): ScopeRule | null {
  if (!o || typeof o !== 'object') return null
  const r: ScopeRule = {}
  if (typeof o.enabled === 'boolean') r.enabled = o.enabled
  const a = optNum(o.orderByHoursBefore, 0, 240); if (a !== undefined) r.orderByHoursBefore = a
  const b = optNum(o.leadHours, 0, 168); if (b !== undefined) r.leadHours = b
  const c = optNum(o.sameDayCutoffHour, 0, 23); if (c !== undefined) r.sameDayCutoffHour = c
  const t = optNum(o.taxPct, 0, 30); if (t !== undefined) r.taxPct = t
  return Object.keys(r).length ? r : null
}
function normScopes(m: any, allowed: string[]): Record<string, ScopeRule> {
  const out: Record<string, ScopeRule> = {}
  if (!m || typeof m !== 'object') return out
  for (const k of Object.keys(m)) {
    const key = allowed.find(a => a.toLowerCase() === String(k).toLowerCase())
    if (!key) continue
    const r = normScope(m[k]); if (r) out[key] = r
  }
  return out
}
function safeRe(src: string, fb: string): string { try { new RegExp(src, 'i'); return src } catch { return fb } }
function normHubs(v: any): Hub[] {
  if (!Array.isArray(v)) return []
  const out: Hub[] = []
  const seen: Record<string, boolean> = {}
  for (const h of v) {
    const label = String(h?.label || '').trim().slice(0, 60)
    if (!label) continue
    const id = String(h?.id || '').trim().toLowerCase().replace(/[^a-z0-9\-]/g, '-').slice(0, 40) || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id || seen[id]) continue
    seen[id] = true
    const known = KNOWN_BUILDINGS.map(b => b.label)
    const buildings = Array.isArray(h?.buildings) ? h.buildings.map((b: any) => known.find(k => k.toLowerCase() === String(b).trim().toLowerCase())).filter(Boolean) as string[] : []
    // listing ids are Guesty's own — kept as given, deduped, and capped so one hub cannot bloat
    // the settings row into something PostgREST refuses to write back
    const listings = Array.isArray(h?.listings) ? h.listings.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 400) : []
    out.push({ id, label, buildings: Array.from(new Set(buildings)), listings: Array.from(new Set(listings)) })
  }
  return out
}

export function normalizeCfg(s: any): GuestOrdersCfg {
  const d = GUEST_ORDERS_DEFAULTS
  if (!s || typeof s !== 'object') return { ...d, emailRecipients: d.emailRecipients.slice() }
  const emails = Array.isArray(s.emailRecipients) ? s.emailRecipients.map((x: any) => String(x || '').trim().toLowerCase()).filter((x: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) : d.emailRecipients.slice()
  return {
    enabled: s.enabled === true,
    createDaysBefore: num(s.createDaysBefore, d.createDaysBefore, 1, 60),
    customFieldName: str(s.customFieldName, d.customFieldName, 80),
    orderByHoursBefore: num(s.orderByHoursBefore, d.orderByHoursBefore, 0, 240),
    leadHours: num(s.leadHours, d.leadHours, 0, 168),
    sameDayCutoffHour: num(s.sameDayCutoffHour, d.sameDayCutoffHour, 0, 23),
    checkInHour: num(s.checkInHour, d.checkInHour, 0, 23),
    taxPct: num(s.taxPct, d.taxPct, 0, 30),
    chargeMode: s.chargeMode === 'manual' ? 'manual' : 'auto',
    emailRecipients: emails,
    publicBase: str(s.publicBase, d.publicBase, 200).replace(/\/+$/, ''),
    formTitle: str(s.formTitle, d.formTitle, 80),
    formIntro: str(s.formIntro, d.formIntro, 600),
    brandLine: str(s.brandLine, d.brandLine, 60),
    accentColor: /^#[0-9a-fA-F]{6}$/.test(String(s.accentColor || '')) ? String(s.accentColor) : d.accentColor,
    footerNote: str(s.footerNote, d.footerNote, 400),
    skipSourcesRe: safeRe(str(s.skipSourcesRe, d.skipSourcesRe, 200), d.skipSourcesRe),
    marketRules: normScopes(s.marketRules, MARKETS as string[]),
    buildingRules: normScopes(s.buildingRules, KNOWN_BUILDINGS.map(b => b.label)),
    hubs: normHubs(s.hubs),
    hubRules: normScopes(s.hubRules, normHubs(s.hubs).map(h => h.id)),
  }
}

/** The hub a building belongs to (first match), or null. */
/**
 * The hub a stay belongs to. A LISTING named in a hub wins over the building, so a single unit can
 * be pulled onto a different shelf than the rest of its property without splitting the building.
 */
export function hubOf(cfg: GuestOrdersCfg, building: string | null | undefined, listingId?: string | null): Hub | null {
  const l = String(listingId || '')
  if (l) { const byListing = cfg.hubs.find(h => (h.listings || []).indexOf(l) >= 0); if (byListing) return byListing }
  const b = String(building || '').toLowerCase()
  if (!b) return null
  return cfg.hubs.find(h => h.buildings.some(x => x.toLowerCase() === b)) || null
}
/** Where an order's stock is counted: its hub, else the global shelf. */
export function stockScopeFor(cfg: GuestOrdersCfg, building: string | null | undefined, listingId?: string | null): string {
  const h = hubOf(cfg, building, listingId)
  return h ? 'hub:' + h.id : 'global'
}

/** The timing that applies to one stay: building override → market override → global. */
export function timingFor(cfg: GuestOrdersCfg, building: string | null | undefined, market: string | null | undefined, listingId?: string | null): Timing {
  const b = building ? cfg.buildingRules[building] : undefined
  const hub = hubOf(cfg, building, listingId)
  const h = hub ? cfg.hubRules[hub.id] : undefined
  const m = market ? cfg.marketRules[market] : undefined
  const pick = <K extends keyof ScopeRule>(k: K, fb: NonNullable<ScopeRule[K]>): NonNullable<ScopeRule[K]> =>
    (b && b[k] !== undefined ? b[k] : h && h[k] !== undefined ? h[k] : m && m[k] !== undefined ? m[k] : fb) as NonNullable<ScopeRule[K]>
  // SAME PRECEDENCE FOR EVERY FIELD — building beats hub beats market beats global. `enabled` used
  // to be "any level may veto", which meant a single-building pilot inside a switched-off market
  // was impossible: the building could not switch itself back on.
  const enabled = b && b.enabled !== undefined ? b.enabled : h && h.enabled !== undefined ? h.enabled : m && m.enabled !== undefined ? m.enabled : true
  const taxFrom = b && b.taxPct !== undefined ? 'building' : h && h.taxPct !== undefined ? 'hub (' + (hub ? hub.label : '') + ')' : m && m.taxPct !== undefined ? 'market' : 'default'
  return {
    enabled,
    orderByHoursBefore: pick('orderByHoursBefore', cfg.orderByHoursBefore),
    leadHours: pick('leadHours', cfg.leadHours),
    sameDayCutoffHour: pick('sameDayCutoffHour', cfg.sameDayCutoffHour),
    checkInHour: cfg.checkInHour,
    taxPct: pick('taxPct', cfg.taxPct),
    source: b && Object.keys(b).length ? 'building rule' : h && Object.keys(h).length ? 'hub rule (' + (hub ? hub.label : '') + ')' : m && Object.keys(m).length ? 'market rule' : 'default',
    taxSource: taxFrom,
  }
}

export async function getGuestOrdersCfg(): Promise<GuestOrdersCfg> {
  return normalizeCfg(await getSetting<any>(GUEST_ORDERS_KEY, null))
}
export async function saveGuestOrdersCfg(next: any, actor: string): Promise<{ ok: boolean; error?: string; config: GuestOrdersCfg }> {
  const config = normalizeCfg(next)
  const r = await setSetting(GUEST_ORDERS_KEY, config, actor)
  return { ok: r.ok, error: r.error, config }
}

// ── Time helpers (ET) ─────────────────────────────────────────────────────────────────────────

export function etParts(d: Date): { ymd: string; hour: number; minute: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(d)) p[x.type] = x.value
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour)
  return { ymd: p.year + '-' + p.month + '-' + p.day, hour, minute: Number(p.minute) }
}
export function todayET(): string { return etParts(new Date()).ymd }

/** A wall-clock ET moment (ymd + hour) as a real Date. Handles DST by probing the offset. */
export function etDateTime(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hour + 5, minute)) // ET is UTC-4/-5; start at -5
  const p = etParts(guess)
  const wantMin = hour * 60 + minute
  const gotMin = p.hour * 60 + p.minute
  const dayShift = p.ymd === ymd ? 0 : (p.ymd < ymd ? -1 : 1)
  const diff = (gotMin + dayShift * 24 * 60) - wantMin
  return new Date(guess.getTime() - diff * 60_000)
}
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}
export function fmtDay(ymd: string | null | undefined): string {
  if (!ymd) return ''
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export function fmtTimeET(d: Date): string {
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function parseCheckInHour(t: string | null | undefined, fb: number): number {
  const raw = String(t || '').trim()
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(raw)
  if (!m) return fb
  let h = Number(m[1])
  const ap = (m[3] || '').toLowerCase()
  if (ap.startsWith('p') && h < 12) h += 12
  if (ap.startsWith('a') && h === 12) h = 0
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : fb
}

/** When the guest must order by for arrival-day delivery. */
export function orderByFor(checkIn: string, checkInTime: string | null | undefined, t: Timing): Date {
  const arrival = etDateTime(checkIn, parseCheckInHour(checkInTime, t.checkInHour))
  return new Date(arrival.getTime() - t.orderByHoursBefore * 3_600_000)
}

/**
 * THE DELIVERY RULE. Paid at least `leadHours` before the check-in hour → arrival day. Otherwise
 * the next day after payment, or the same day when paid before the cutoff hour — never before
 * check-in, and flagged when it would land after checkout.
 */
export function deliveryDateFor(paidAt: Date, checkIn: string, checkOut: string | null, checkInTime: string | null | undefined, t: Timing): { date: string | null; note: string } {
  const arrival = etDateTime(checkIn, parseCheckInHour(checkInTime, t.checkInHour))
  if (paidAt.getTime() + t.leadHours * 3_600_000 <= arrival.getTime()) return { date: checkIn, note: 'arrival day' }
  const p = etParts(paidAt)
  const sameDay = p.hour < t.sameDayCutoffHour
  let candidate = sameDay ? p.ymd : addDays(p.ymd, 1)
  let note = sameDay ? 'same day (paid before ' + t.sameDayCutoffHour + ':00)' : 'next day'
  if (candidate <= checkIn) { candidate = checkIn; note = 'arrival day' }
  if (checkOut && candidate >= checkOut) return { date: null, note: 'would land on/after checkout — schedule by hand' }
  return { date: candidate, note }
}

/**
 * THE GUEST'S CHOICE ON TOP OF THE RULE. deliveryDateFor() gives the EARLIEST day we can deliver
 * once paid; the guest's request only ever moves it later (a date inside the stay) or picks the
 * earliest ('asap'). 'arrival' = arrival day when the rule allows, else the earliest with a note.
 */
export function resolveDelivery(paidAt: Date, checkIn: string, checkOut: string | null, checkInTime: string | null | undefined, t: Timing, mode: DeliveryMode, requestedDate: string | null): { date: string | null; note: string } {
  const base = deliveryDateFor(paidAt, checkIn, checkOut, checkInTime, t)
  if (!base.date) return base
  if (mode === 'date' && requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    if (checkOut && requestedDate >= checkOut) return { date: base.date, note: 'guest asked for ' + fmtDay(requestedDate) + ' (after checkout) — earliest instead' }
    if (requestedDate >= base.date) return { date: requestedDate, note: 'guest asked for ' + fmtDay(requestedDate) }
    return { date: base.date, note: 'guest asked for ' + fmtDay(requestedDate) + ' — earliest possible is ' + fmtDay(base.date) }
  }
  if (mode === 'arrival') return base.date === checkIn ? { date: checkIn, note: 'arrival day (guest’s choice)' } : { date: base.date, note: 'guest asked for arrival day — earliest possible is ' + fmtDay(base.date) }
  if (mode === 'asap') return { date: base.date, note: 'ASAP — ' + base.note }
  return base
}

// ── Catalog ───────────────────────────────────────────────────────────────────────────────────

export type CatalogItem = {
  id: string; sku: string; name: string; description: string | null; price_usd: number; unit_label: string | null
  category: string | null; fee_code: string; max_qty: number; sort: number; active: boolean; buildings: string[] | null; markets: string[] | null; hubs: string[] | null; image_url: string | null
  track_stock: boolean
  /** Filled in when loaded for a scope: on_hand − reserved for that scope (null = not tracked). */
  available?: number | null
}
export type StockRow = { item_id: string; scope: string; on_hand: number; reserved: number; low_at: number; updated_at: string; updated_by: string | null }

/**
 * The catalog one stay sees. An item limited to buildings / markets only shows there — and a
 * building-specific item REPLACES a general item with the same name, so "Bottled water · 17West
 * · $18" quietly wins over "Bottled water · $15" in that building. That is how prices differ per
 * building without a second pricing table (Jon, 2026-08-24: "customizable by building and by
 * location").
 */
export async function loadCatalog(opts?: { building?: string | null; market?: string | null; hub?: string | null; activeOnly?: boolean; withStock?: boolean; hideOutOfStock?: boolean }): Promise<CatalogItem[]> {
  const db = supabaseAdmin()
  let q = db.from('guest_order_catalog').select('*').order('sort', { ascending: true }).order('name', { ascending: true })
  if (opts?.activeOnly !== false) q = q.eq('active', true)
  const { data } = await q.limit(500)
  let rows = (data || []).map((r: any) => ({ ...r, price_usd: Number(r.price_usd) || 0, max_qty: Number(r.max_qty) || 10, sort: Number(r.sort) || 100, track_stock: r.track_stock === true, hubs: r.hubs || null, available: null })) as CatalogItem[]
  const b = String(opts?.building || '').toLowerCase()
  const m = String(opts?.market || '').toLowerCase()
  const hb = String(opts?.hub || '').toLowerCase()
  if (b || m || hb) {
    const has = (list: string[] | null | undefined, v: string) => !!list && list.length > 0 && list.some(x => String(x).toLowerCase() === v)
    const scopedItem = (r: CatalogItem) => !!((r.buildings && r.buildings.length) || (r.markets && r.markets.length) || (r.hubs && r.hubs.length))
    const scoped = rows.filter(r => {
      if (r.buildings && r.buildings.length && !has(r.buildings, b)) return false
      if (r.hubs && r.hubs.length && !has(r.hubs, hb)) return false
      if (r.markets && r.markets.length && !has(r.markets, m)) return false
      return true
    })
    // a scoped item REPLACES the general item of the same name (per-building/hub pricing)
    const specificNames: Record<string, boolean> = {}
    for (const r of scoped) if (scopedItem(r)) specificNames[r.name.trim().toLowerCase()] = true
    rows = scoped.filter(r => scopedItem(r) || !specificNames[r.name.trim().toLowerCase()])
  }
  if (opts?.withStock || opts?.hideOutOfStock) {
    const scope = hb ? 'hub:' + hb : 'global'
    const tracked = rows.filter(r => r.track_stock)
    if (tracked.length) {
      const { data: st } = await db.from('guest_order_stock').select('*').in('item_id', tracked.map(r => r.id)).in('scope', [scope, 'global'])
      const byItem: Record<string, StockRow | undefined> = {}
      for (const row of (st || []) as StockRow[]) {
        // the hub row wins; the global row is the fallback shelf when a hub has no row yet
        if (!byItem[row.item_id] || row.scope === scope) byItem[row.item_id] = row
      }
      for (const r of rows) {
        if (!r.track_stock) continue
        const row = byItem[r.id]
        r.available = row ? Math.max(0, Number(row.on_hand) - Number(row.reserved)) : 0
      }
      if (opts.hideOutOfStock) rows = rows.filter(r => !r.track_stock || (r.available || 0) > 0)
    }
  }
  return rows
}

// ── Inventory ─────────────────────────────────────────────────────────────────────────────────

export async function listStock(): Promise<StockRow[]> {
  const { data } = await supabaseAdmin().from('guest_order_stock').select('*').limit(5000)
  return (data || []).map((r: any) => ({ ...r, on_hand: Number(r.on_hand) || 0, reserved: Number(r.reserved) || 0, low_at: Number(r.low_at) || 0 }))
}

async function stockLog(row: { item_id: string; scope: string; delta_on_hand: number; delta_reserved: number; reason: string; order_id?: string | null; actor?: string | null }) {
  try { await supabaseAdmin().from('guest_order_stock_log').insert(row) } catch { /* the count is what matters */ }
}

/** Stock-take: set what is on the shelf (and the low-stock line) for one item in one scope. */
export async function setStock(itemId: string, scope: string, onHand: number, lowAt: number | null, actor: string): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  const { data } = await db.from('guest_order_stock').select('*').eq('item_id', itemId).eq('scope', scope).limit(1)
  const cur: any = (data || [])[0]
  const next = { item_id: itemId, scope, on_hand: Math.max(0, Math.floor(onHand)), reserved: cur ? Number(cur.reserved) || 0 : 0, low_at: lowAt === null || lowAt === undefined ? (cur ? Number(cur.low_at) : 3) : Math.max(0, Math.floor(lowAt)), updated_at: new Date().toISOString(), updated_by: actor }
  const r = await db.from('guest_order_stock').upsert(next, { onConflict: 'item_id,scope' })
  if (r.error) return { ok: false, error: r.error.message }
  await stockLog({ item_id: itemId, scope, delta_on_hand: next.on_hand - (cur ? Number(cur.on_hand) || 0 : 0), delta_reserved: 0, reason: 'stock_take', actor })
  return { ok: true }
}

/** Move reserved/on_hand for every tracked line of an order. Idempotency lives in the callers (status transitions). */
async function moveStock(order: OrderRow, scope: string, kind: 'reserve' | 'release' | 'consume', actor: string): Promise<string> {
  const db = supabaseAdmin()
  const skus = order.items.map(l => l.sku)
  const { data: items } = await db.from('guest_order_catalog').select('id,sku,name,track_stock').in('sku', skus)
  const tracked = ((items || []) as any[]).filter(i => i.track_stock === true)
  if (!tracked.length) return ''
  const notes: string[] = []
  for (const it of tracked) {
    const line = order.items.find(l => l.sku === it.sku)
    if (!line) continue
    const { data } = await db.from('guest_order_stock').select('*').eq('item_id', it.id).eq('scope', scope).limit(1)
    let row: any = (data || [])[0]
    if (!row) {
      // no hub row yet — fall back to the global shelf so a reservation is never silently lost
      const g = await db.from('guest_order_stock').select('*').eq('item_id', it.id).eq('scope', 'global').limit(1)
      row = (g.data || [])[0]
    }
    const useScope = row ? row.scope : scope
    const onHand = row ? Number(row.on_hand) || 0 : 0
    const reserved = row ? Number(row.reserved) || 0 : 0
    let dOn = 0, dRes = 0
    if (kind === 'reserve') dRes = line.qty
    if (kind === 'release') dRes = -Math.min(reserved, line.qty)
    if (kind === 'consume') { dRes = -Math.min(reserved, line.qty); dOn = -Math.min(onHand, line.qty) }
    await db.from('guest_order_stock').upsert({ item_id: it.id, scope: useScope, on_hand: onHand + dOn, reserved: Math.max(0, reserved + dRes), low_at: row ? row.low_at : 3, updated_at: new Date().toISOString(), updated_by: actor }, { onConflict: 'item_id,scope' })
    await stockLog({ item_id: it.id, scope: useScope, delta_on_hand: dOn, delta_reserved: dRes, reason: kind, order_id: order.id, actor })
    if (kind === 'reserve') notes.push(line.qty + '× ' + it.name + (onHand - reserved - line.qty < 0 ? ' (SHORT — only ' + Math.max(0, onHand - reserved) + ' on hand)' : ''))
  }
  return kind === 'reserve' ? 'reserved ' + notes.join(', ') : ''
}
export async function reserveStockFor(order: OrderRow, cfg: GuestOrdersCfg, actor: string): Promise<void> {
  const scope = stockScopeFor(cfg, order.building, order.listing_id)
  const note = await moveStock(order, scope, 'reserve', actor)
  await patch(order.id, { stock_scope: scope, stock_note: note || null })
}
export async function releaseStockFor(order: OrderRow, actor: string): Promise<void> {
  if (!order.stock_scope) return
  await moveStock(order, order.stock_scope, 'release', actor)
  await patch(order.id, { stock_note: (order.stock_note ? order.stock_note + ' · ' : '') + 'released' })
}
export async function consumeStockFor(order: OrderRow, actor: string): Promise<void> {
  if (!order.stock_scope) return
  await moveStock(order, order.stock_scope, 'consume', actor)
}

export type OrderLine = { sku: string; name: string; qty: number; unit_price_usd: number; line_total_usd: number; fee_code: string; unit_label?: string | null }

/** `taxPct` is the rate that APPLIES TO THIS STAY (timingFor().taxPct) — never the global default. */
export function priceBasket(catalog: CatalogItem[], basket: { sku: string; qty: number }[], taxPct: number): { lines: OrderLine[]; subtotal: number; tax: number; total: number; problems: string[] } {
  const lines: OrderLine[] = []
  const problems: string[] = []
  for (const b of basket) {
    const item = catalog.find(c => c.sku === b.sku)
    const qty = Math.floor(Number(b.qty) || 0)
    if (!item) { problems.push('"' + b.sku + '" is no longer available'); continue }
    if (qty <= 0) continue
    if (qty > item.max_qty) { problems.push(item.name + ': max ' + item.max_qty); continue }
    if (item.track_stock && item.available !== null && item.available !== undefined && qty > item.available) { problems.push(item.name + ': only ' + item.available + ' left'); continue }
    const line = Math.round(item.price_usd * qty * 100) / 100
    lines.push({ sku: item.sku, name: item.name, qty, unit_price_usd: item.price_usd, line_total_usd: line, fee_code: item.fee_code || 'GUEST_SERVICE', unit_label: item.unit_label })
  }
  const subtotal = Math.round(lines.reduce((n, l) => n + l.line_total_usd, 0) * 100) / 100
  const tax = Math.round(subtotal * (Number(taxPct) || 0) / 100 * 100) / 100
  const total = Math.round((subtotal + tax) * 100) / 100
  return { lines, subtotal, tax, total, problems }
}

export function summarizeLines(lines: OrderLine[], max = 4): string {
  const parts = lines.map(l => l.qty + '× ' + l.name)
  return parts.length > max ? parts.slice(0, max).join(', ') + ' +' + (parts.length - max) + ' more' : parts.join(', ')
}

// ── Links ─────────────────────────────────────────────────────────────────────────────────────

export function newCode(): string { return randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 14) || randomBytes(8).toString('hex') }

export type LinkRow = {
  code: string; reservation_id: string; listing_id: string | null; unit: string | null; building: string | null; market: string | null
  guest_name: string | null; guest_email: string | null; guest_id: string | null; conversation_id: string | null; source: string | null
  check_in: string | null; check_out: string | null; check_in_time: string | null
  sent_at: string | null; sent_via: string | null; send_error: string | null; opened_at: string | null; created_by: string | null; created_at: string
}

async function listingMeta(listingId: string): Promise<{ unit: string; building: string | null; market: string; checkInTime: string | null }> {
  const db = supabaseAdmin()
  const { data } = await db.from('guesty_listings').select('id,nickname,title,building,address_city,checkIn:raw->>defaultCheckInTime').eq('id', listingId).limit(1)
  const l: any = (data || [])[0] || {}
  const name = l.nickname || l.title || 'Unit'
  const building = buildingOf(l.building, name)
  return { unit: name, building, market: marketOf(building, l.address_city, name), checkInTime: l.checkIn || null }
}

/** Find (or mint) the link for a reservation. Never creates two — reservation_id is unique. */
export async function ensureLink(reservationId: string, createdBy: string): Promise<{ ok: boolean; link?: LinkRow; created?: boolean; error?: string }> {
  const db = supabaseAdmin()
  const { data: ex } = await db.from('guest_order_links').select('*').eq('reservation_id', reservationId).limit(1)
  if (ex && ex[0]) return { ok: true, link: ex[0] as LinkRow, created: false }
  const { data: rs } = await db.from('guesty_reservations').select('id,listing_id,guest_id,guest_name,guest_email,check_in,check_out,source,conversation_id,status').eq('id', reservationId).limit(1)
  const r: any = (rs || [])[0]
  if (!r) return { ok: false, error: 'reservation not found locally — sync first' }
  const meta = r.listing_id ? await listingMeta(String(r.listing_id)) : { unit: 'Unit', building: null, market: 'Miami', checkInTime: null }
  const row = {
    code: newCode(), reservation_id: String(r.id), listing_id: r.listing_id ? String(r.listing_id) : null,
    unit: meta.unit, building: meta.building, market: meta.market,
    guest_name: r.guest_name || null, guest_email: r.guest_email || null, guest_id: r.guest_id ? String(r.guest_id) : null,
    conversation_id: r.conversation_id ? String(r.conversation_id) : null, source: r.source || null,
    check_in: r.check_in || null, check_out: r.check_out || null, check_in_time: meta.checkInTime,
    created_by: createdBy,
  }
  const ins = await db.from('guest_order_links').insert(row).select('*').limit(1)
  if (ins.error) {
    // lost a race with another run — read the winner
    const { data: again } = await db.from('guest_order_links').select('*').eq('reservation_id', reservationId).limit(1)
    if (again && again[0]) return { ok: true, link: again[0] as LinkRow, created: false }
    return { ok: false, error: ins.error.message }
  }
  return { ok: true, link: (ins.data || [])[0] as LinkRow, created: true }
}

export function linkUrl(code: string, cfg: GuestOrdersCfg, origin?: string | null): string {
  const base = (cfg.publicBase || origin || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  return base + '/order/' + code
}

let _fieldCache: { id: string | null; name: string; at: number } | null = null
/** The Guesty RESERVATION custom field id for "Order form" (re-syncs the field list once if missing). */
/**
 * The Guesty custom field the link is written into.
 *
 * TAKES A NAME **OR THE FIELD'S OWN ID**. Resolving by name needs `guesty_custom_fields`, and that
 * mirror is filled from the account custom-fields endpoint — which has been empty before (the
 * definitions are nested in the account payload) and on 2026-08-25 answered **429 Too Many
 * Requests** on every attempt, recording a misleading "shape may have changed" and leaving the
 * whole feature unable to find a field that exists. An id pasted from Guesty skips all of that:
 * no mirror, no lookup, no rate limit. Guesty ids are 24 hex characters.
 */
const FIELD_ID_RE = /^[a-f0-9]{24}$/i
export async function orderFormFieldId(name: string): Promise<string | null> {
  const direct = String(name || '').trim()
  if (FIELD_ID_RE.test(direct)) return direct
  if (_fieldCache && _fieldCache.name === name && Date.now() - _fieldCache.at < 10 * 60_000 && _fieldCache.id) return _fieldCache.id
  const db = supabaseAdmin()
  // Match the LABEL or the MERGE-TAG SLUG, so both "Guest Order Form1" and the tag Jon actually
  // pastes into Guesty templates — {{guest_order_form1}} — find the same field. A reservation-target
  // field always wins: the link belongs on the booking, never on the listing.
  const bare = direct.replace(/^\{\{|\}\}$/g, '').trim()
  const find = async () => {
    const { data } = await db.from('guesty_custom_fields').select('id,name,slug,target').or(
      ['name.ilike.' + bare, 'slug.ilike.' + bare].join(','),
    ).limit(20)
    const rows = (data || []) as any[]
    const res = rows.find(r => /reserv/i.test(String(r.target || ''))) || rows[0]
    return res ? String(res.id) : null
  }
  let id = await find()
  if (!id) { try { await syncCustomFields() } catch { /* offline: stays null */ } id = await find() }
  _fieldCache = { id, name, at: Date.now() }
  return id
}

/** Write the link into the reservation's "Order form" custom field. Idempotent. */
export async function writeLinkToGuesty(link: LinkRow, cfg: GuestOrdersCfg): Promise<{ ok: boolean; note: string }> {
  const fieldId = await orderFormFieldId(cfg.customFieldName)
  if (!fieldId) return { ok: false, note: 'Guesty reservation custom field "' + cfg.customFieldName + '" could not be resolved. Either it does not exist (Guesty → Settings → Custom fields → Reservation), or Guesty is rate-limiting the field list. Fastest fix: paste the field\'s own ID (24 hex characters, from its URL in Guesty) into "Custom field name" — that skips the lookup entirely.' }
  let token = ''
  try { token = await getToken() } catch (e: any) { return { ok: false, note: 'Guesty token: ' + String(e?.message || e).slice(0, 80) } }
  const url = linkUrl(link.code, cfg)
  const r = await writeCustomFields(link.reservation_id, token, [{ fieldId, value: url }])
  const db = supabaseAdmin()
  if (r.ok) {
    await db.from('guest_order_links').update({ sent_at: new Date().toISOString(), sent_via: 'guesty:custom-field', send_error: null, updated_at: new Date().toISOString() }).eq('code', link.code)
    // mirror the merged fields so the reservation drawer shows it without waiting for a sync
    try { await db.from('guesty_reservations').update({ custom_fields: r.fields }).eq('id', link.reservation_id) } catch { /* cosmetic */ }
    return { ok: true, note: 'written to "' + cfg.customFieldName + '"' }
  }
  await db.from('guest_order_links').update({ send_error: r.note || 'write failed', updated_at: new Date().toISOString() }).eq('code', link.code)
  return { ok: false, note: r.note || 'write failed' }
}

/** Cron hop 1: mint + write links for every confirmed arrival inside the window. */
export async function createDueLinks(cfg: GuestOrdersCfg, budgetMs = 40_000): Promise<{ scanned: number; created: number; written: number; errors: string[] }> {
  const started = Date.now()
  const db = supabaseAdmin()
  const today = todayET()
  const until = addDays(today, cfg.createDaysBefore)
  const { data } = await db.from('guesty_reservations')
    .select('id,source,status,check_in,listing_id')
    .gte('check_in', today).lte('check_in', until)
    .in('status', ['confirmed', 'checked_in'])
    .order('check_in', { ascending: true }).limit(600)
  const rows = (data || []) as any[]
  const skip = new RegExp(cfg.skipSourcesRe || '^$', 'i')
  // Buildings / markets switched off in settings never get a link.
  const lids = Array.from(new Set(rows.map(r => String(r.listing_id || '')).filter(Boolean)))
  const { data: ls } = lids.length ? await db.from('guesty_listings').select('id,nickname,title,building,address_city').in('id', lids) : { data: [] as any[] }
  const scopeOk: Record<string, boolean> = {}
  for (const l of (ls || []) as any[]) {
    const name = l.nickname || l.title || 'Unit'
    const building = buildingOf(l.building, name)
    scopeOk[String(l.id)] = timingFor(cfg, building, marketOf(building, l.address_city, name), String(l.id)).enabled
  }
  const ids = rows.filter(r => r.listing_id && !skip.test(String(r.source || '')) && scopeOk[String(r.listing_id)] !== false).map(r => String(r.id))
  const { data: have } = ids.length ? await db.from('guest_order_links').select('code,reservation_id,sent_at,send_error').in('reservation_id', ids) : { data: [] as any[] }
  const byRes: Record<string, any> = {}
  for (const h of (have || [])) byRes[String(h.reservation_id)] = h
  let created = 0, written = 0
  const errors: string[] = []
  for (const id of ids) {
    if (Date.now() - started > budgetMs) { errors.push('budget: stopped after ' + ids.indexOf(id) + ' of ' + ids.length); break }
    const existing = byRes[id]
    if (existing && existing.sent_at) continue
    const r = await ensureLink(id, 'cron')
    if (!r.ok || !r.link) { errors.push(id + ': ' + (r.error || 'no link')); continue }
    if (r.created) created++
    const w = await writeLinkToGuesty(r.link, cfg)
    if (w.ok) written++
    else if (errors.length < 8) errors.push(id + ': ' + w.note)
    // the field-missing case is the same for every reservation — say it once and stop
    if (!w.ok && /custom field .* not found/.test(w.note)) break
  }
  return { scanned: ids.length, created, written, errors }
}

// ── Orders ────────────────────────────────────────────────────────────────────────────────────

export type DeliveryMode = 'auto' | 'asap' | 'arrival' | 'date'
export type CollectMethod = 'card_on_file' | 'payment_link' | 'airbnb_resolution'
export type OrderStatus = 'submitted' | 'approved' | 'paid' | 'awaiting_payment' | 'payment_failed' | 'pushed' | 'delivered' | 'declined' | 'cancelled'

export const STATUS_LABEL: Record<OrderStatus, string> = {
  submitted: 'Needs approval', approved: 'Charging…', paid: 'Paid — scheduled', awaiting_payment: 'Awaiting payment',
  payment_failed: 'Charge failed', pushed: 'With the team', delivered: 'Delivered', declined: 'Declined', cancelled: 'Cancelled',
}

export type OrderRow = {
  id: string; link_code: string; reservation_id: string; listing_id: string | null; unit: string | null; building: string | null; market: string | null
  guest_name: string | null; guest_email: string | null; check_in: string | null; check_out: string | null
  status: OrderStatus; items: OrderLine[]; subtotal_usd: number; tax_usd: number; total_usd: number; currency: string; guest_note: string | null
  submitted_at: string; approve_token: string | null; approved_at: string | null; approved_by: string | null
  declined_at: string | null; declined_by: string | null; decline_reason: string | null
  paid_at: string | null; paid_via: string | null; payment_note: string | null; guesty_payment_id: string | null; guesty_invoice_item_ids: string[]; folio_lines_done: number; folio_note: string | null; charge_error: string | null
  /** How the money is meant to be collected — set on approval so the board can show one clear action. */
  collect_method: CollectMethod | null; collect_card: string | null
  delivery_date: string | null; delivery_note: string | null; requested_delivery: DeliveryMode; requested_date: string | null; stock_scope: string | null; stock_note: string | null; pushed_at: string | null; breezeway_task_id: string | null
  assignee_names: string[]; assignee_ids: number[]; assign_note: string | null; slack_outbox_id: string | null; push_error: string | null
  email_sent_at: string | null; delivered_at: string | null; delivered_by: string | null; cancelled_at: string | null; cancelled_by: string | null
  created_at: string; updated_at: string
}

function normOrder(r: any): OrderRow {
  return { ...r, items: Array.isArray(r.items) ? r.items : [], subtotal_usd: Number(r.subtotal_usd) || 0, tax_usd: Number(r.tax_usd) || 0, total_usd: Number(r.total_usd) || 0,
    guesty_invoice_item_ids: r.guesty_invoice_item_ids || [], folio_lines_done: Number(r.folio_lines_done) || 0, requested_delivery: (['asap','arrival','date'].indexOf(r.requested_delivery) >= 0 ? r.requested_delivery : 'auto') as DeliveryMode, requested_date: r.requested_date || null, stock_scope: r.stock_scope || null, stock_note: r.stock_note || null, collect_method: r.collect_method || null, collect_card: r.collect_card || null, assignee_names: r.assignee_names || [], assignee_ids: r.assignee_ids || [] }
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  const { data } = await supabaseAdmin().from('guest_orders').select('*').eq('id', id).limit(1)
  return data && data[0] ? normOrder(data[0]) : null
}
export async function ordersForLink(code: string): Promise<OrderRow[]> {
  const { data } = await supabaseAdmin().from('guest_orders').select('*').eq('link_code', code).order('submitted_at', { ascending: false }).limit(50)
  return (data || []).map(normOrder)
}

async function patch(id: string, fields: Record<string, any>): Promise<void> {
  await supabaseAdmin().from('guest_orders').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
}

/** Guest hop: basket → order row → approvers told. */
export async function submitOrder(link: LinkRow, basket: { sku: string; qty: number }[], guestNote: string, origin: string | null, delivery?: { mode: DeliveryMode; date?: string | null }): Promise<{ ok: boolean; order?: OrderRow; error?: string }> {
  const cfg = await getGuestOrdersCfg()
  const hub = hubOf(cfg, link.building, link.listing_id)
  const catalog = await loadCatalog({ building: link.building, market: link.market, hub: hub ? hub.id : null, hideOutOfStock: true })
  // Tax is the rate for THIS building's area (Broward ≠ Miami), resolved the same way as timing.
  const priced = priceBasket(catalog, basket, timingFor(cfg, link.building, link.market, link.listing_id).taxPct)
  if (priced.problems.length) return { ok: false, error: priced.problems.join(' · ') }
  if (!priced.lines.length) return { ok: false, error: 'Pick at least one item.' }
  const db = supabaseAdmin()
  const row = {
    link_code: link.code, reservation_id: link.reservation_id, listing_id: link.listing_id, unit: link.unit, building: link.building, market: link.market,
    guest_name: link.guest_name, guest_email: link.guest_email, check_in: link.check_in, check_out: link.check_out,
    status: 'submitted', items: priced.lines, subtotal_usd: priced.subtotal, tax_usd: priced.tax, total_usd: priced.total, currency: 'USD',
    guest_note: guestNote ? guestNote.slice(0, 600) : null, approve_token: null,
    requested_delivery: delivery && ['asap', 'arrival', 'date'].indexOf(delivery.mode) >= 0 ? delivery.mode : 'auto',
    requested_date: delivery && delivery.mode === 'date' && delivery.date && /^\d{4}-\d{2}-\d{2}$/.test(delivery.date) ? delivery.date : null,
  }
  const ins = await db.from('guest_orders').insert(row).select('*').limit(1)
  if (ins.error) return { ok: false, error: ins.error.message }
  const order = normOrder((ins.data || [])[0])
  try { await notifyNewOrder(order, cfg, origin) } catch (e) { console.error('guest-orders: notify failed', e) }
  return { ok: true, order }
}

function money(n: number): string { return '$' + (Math.round(n * 100) / 100).toFixed(2) }

/** The tax rate an order was PRICED at, read back off its own totals — never re-resolved from
 *  settings, so changing the rate tomorrow cannot rewrite an order placed today. */
export function taxRateOf(o: { subtotal_usd: number; tax_usd: number }): number {
  if (!o.subtotal_usd || !o.tax_usd) return 0
  return Math.round((o.tax_usd / o.subtotal_usd) * 1000) / 10
}

/** Guest text goes into Slack mrkdwn — a note of "<!channel>" must not page a channel. */
function slackSafe(s: string): string { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

async function notifyNewOrder(order: OrderRow, cfg: GuestOrdersCfg, origin: string | null): Promise<void> {
  const rules = await getSlackRules()
  const rule = rules.events.guest_orders
  if (!rule || !rule.enabled) return
  const base = (cfg.publicBase || origin || '').replace(/\/+$/, '')
  const boardUrl = base + '/guest-orders'
  const first = String(order.guest_name || 'Guest').split(' ')[0]
  const when = order.requested_delivery === 'asap' ? 'ASAP (in-house)'
    : order.requested_delivery === 'date' && order.requested_date ? fmtDay(order.requested_date)
    : 'arrival day'
  const core = ':shopping_trolley: *New guest order — ' + slackSafe(order.unit || 'unit') + '* · ' + money(order.total_usd) + '\n' +
    slackSafe(first) + ' arrives ' + fmtDay(order.check_in) + (order.check_out ? ' → ' + fmtDay(order.check_out) : '') + ' · wants it ' + when + '\n' +
    order.items.map(l => '• ' + l.qty + '× ' + slackSafe(l.name) + ' — ' + money(l.line_total_usd)).join('\n') +
    (order.guest_note ? '\n_"' + slackSafe(order.guest_note.slice(0, 200)) + '"_' : '')
  // Slack is a NOTICE for the CCS team (Jon, 2026-08-25): "approval should live in the app". No
  // approve link, no token, no DM — the message points at the board, where a signed-in person with
  // FULL on guest-orders approves, marks paid or declines. Nothing in Slack can move money.
  const group = groupForBuilding(rules, order.building)
  const res = await draft({
    eventKey: 'guest_orders',
    groupKey: 'guest_order:' + order.id + ':new',
    building: order.building,
    channelId: rules.opsChannel || rules.defaultChannel || rules.firehose,
    body: core + '\n\n<' + boardUrl + '|Review in Lighthouse → Guest Orders>',
    summary: 'New guest order · ' + (order.unit || '') + ' · ' + money(order.total_usd),
    audience: audienceFor(rules, group, []),
    itemCount: order.items.length,
  }, rules)
  if (res.ok) await patch(order.id, { slack_outbox_id: res.id })
}

/**
 * Approval hop: folio lines + charge. Every outcome lands on the row with its reason.
 *
 * DOUBLE-CHARGE GUARD: the row is CLAIMED with a conditional update before Guesty is touched —
 * only one caller can move it into 'approved', whether the tap came from the Slack link, the
 * board, or two people at once. A row stuck in 'approved' (process died mid-charge) can be
 * re-claimed after 10 minutes only if no Guesty payment id was ever recorded.
 */
export async function approveOrder(id: string, actor: string): Promise<{ ok: boolean; order?: OrderRow; error?: string }> {
  const order = await getOrder(id)
  if (!order) return { ok: false, error: 'order not found' }
  if (['paid', 'pushed', 'delivered'].indexOf(order.status) >= 0) return { ok: true, order }
  if (['declined', 'cancelled'].indexOf(order.status) >= 0) return { ok: false, error: 'order is ' + order.status }
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const staleApproved = order.status === 'approved' && !order.guesty_payment_id && !!order.approved_at && Date.now() - new Date(order.approved_at).getTime() > 10 * 60_000
  const claim = await db.from('guest_orders')
    .update({ status: 'approved', approved_at: order.approved_at || now, approved_by: order.approved_by || actor, charge_error: null, updated_at: now })
    .eq('id', id).in('status', staleApproved ? ['approved'] : ['submitted', 'awaiting_payment', 'payment_failed'])
    .select('id')
  if (claim.error || !claim.data || !claim.data.length) return { ok: false, error: 'This order is being charged by someone else right now — refresh in a moment.', order: await getOrder(id) || undefined }
  const cfg = await getGuestOrdersCfg()

  if (cfg.chargeMode === 'manual') {
    // MANUAL COLLECTION (Jon, 2026-08-25: "we will manually have to charge for now"; "if they don't
    // have card on file, need to send guesty payment link"). Lighthouse never touches the card here.
    // It does the two things that make the human's next move a single click in Guesty: it puts the
    // charge on the folio (both charging a saved card and a payment link bill that balance), and it
    // names which of the two this booking needs.
    const rate = taxRateOf(order)
    const [who, folio] = await Promise.all([cardOnFile(order.reservation_id), postFolio(order, rate)])
    const amount = money(order.total_usd)
    const how = who.card
      ? 'Charge ' + amount + ' to the ' + cardLabel(who.card) + ' on file — Guesty → this reservation → Payments.'
      : who.airbnb
        ? 'No card on file (Airbnb collects payment) — request ' + amount + ' through the Airbnb Resolution Center.'
        : 'No card on file — send the guest a Guesty payment link for ' + amount + '. The charge is already on their folio.'
    const folioNote = folio.ok
      ? null
      : 'Only ' + folio.done + ' of ' + folio.total + ' lines reached the Guesty folio (' + (folio.error || 'unknown error') + ') — add the rest by hand before charging, or the guest is billed short.'
    await patch(id, {
      status: 'awaiting_payment',
      charge_error: who.error || null,
      collect_method: who.card ? 'card_on_file' : who.airbnb ? 'airbnb_resolution' : 'payment_link',
      collect_card: who.card ? cardLabel(who.card) : null,
      payment_note: how,
      folio_note: folioNote,
    })
    return { ok: true, order: await getOrder(id) || undefined }
  }

  try {
    // 1. A card we can charge?
    const who = await cardOnFile(order.reservation_id)
    const card = who.card
    if (!card) {
      const why = who.error || 'No card on file in Guesty for this booking' + (who.airbnb ? ' (Airbnb collects payment — request it through the Resolution Center)' : '') + '.'
      const f = await postFolio(order, taxRateOf(order))
      await patch(id, {
        status: 'awaiting_payment', charge_error: why,
        collect_method: who.airbnb ? 'airbnb_resolution' : 'payment_link', collect_card: null,
        payment_note: who.airbnb ? 'Request ' + money(order.total_usd) + ' through the Airbnb Resolution Center.' : 'Send the guest a Guesty payment link for ' + money(order.total_usd) + '. The charge is already on their folio.',
        folio_note: f.ok ? null : 'Only ' + f.done + ' of ' + f.total + ' lines reached the folio (' + (f.error || 'unknown error') + ').',
      })
      return { ok: true, order: await getOrder(id) || undefined }
    }

    // 2. Folio lines — resumable, so a retry after a failed charge never re-posts a line.
    const folio = await postFolio(order, taxRateOf(order))
    if (!folio.ok) {
      await patch(id, { status: 'payment_failed', charge_error: 'Could not add the order to the Guesty folio: ' + folio.error + ' (' + folio.done + ' of ' + folio.total + ' lines are on it)' })
      return { ok: false, order: await getOrder(id) || undefined, error: folio.error }
    }

    // 3. The charge.
    const ch = await chargeSavedCard(order.reservation_id, card.id, order.total_usd, 'Guest order ' + summarizeLines(order.items) + ' · Lighthouse order ' + order.id.slice(0, 8))
    if (!ch.ok) {
      await patch(id, { status: 'payment_failed', charge_error: ch.error || 'charge failed', charge_raw: ch.raw || null, guesty_payment_id: ch.paymentId || null })
      return { ok: false, order: await getOrder(id) || undefined, error: ch.error }
    }
    const paidAt = new Date()
    const dd = resolveDelivery(paidAt, order.check_in || todayET(), order.check_out, await checkInTimeFor(order.link_code), timingFor(cfg, order.building, order.market, order.listing_id), order.requested_delivery, order.requested_date)
    await patch(id, {
      status: 'paid', paid_at: paidAt.toISOString(), paid_via: 'guesty:' + card.id, charge_error: null, charge_raw: ch.raw || null, guesty_payment_id: ch.paymentId || null,
      payment_note: 'Charged ' + cardLabel(card) + ' via Guesty (' + (ch.status || 'ok') + ')', collect_method: 'card_on_file', collect_card: cardLabel(card),
      delivery_date: dd.date, delivery_note: dd.note, folio_note: null,
    })
    try { const paid = await getOrder(id); if (paid) await reserveStockFor(paid, cfg, actor) } catch (e) { console.error('guest-orders: reserve failed', e) }
    return { ok: true, order: await getOrder(id) || undefined }
  } catch (e: any) {
    // Never leave a row sitting in 'approved' with no reason.
    const msg = String(e?.message || e).slice(0, 240)
    await patch(id, { status: 'payment_failed', charge_error: 'Charge attempt threw: ' + msg })
    return { ok: false, order: await getOrder(id) || undefined, error: msg }
  }
}

/** The order on the Guesty folio, resumable. `folio_lines_done` is how many lines Guesty has
 *  accepted, so a retry never posts a line twice. Both charge modes need this: an auto charge
 *  bills against the balance, and a manual "charge the card" or "send a payment link" in Guesty
 *  needs a balance to bill against in the first place. */
async function postFolio(order: OrderRow, taxPct: number): Promise<{ ok: boolean; error?: string; done: number; total: number; ids: string[] }> {
  const lines = order.items.map(l => ({ title: l.qty + '× ' + l.name, description: 'Guest order · ' + l.qty + ' × ' + money(l.unit_price_usd) + (l.unit_label ? ' (' + l.unit_label + ')' : ''), amount: l.line_total_usd, feeCode: l.fee_code }))
  if (order.tax_usd > 0) lines.push({ title: 'Sales tax on guest order', description: taxPct + '% on ' + money(order.subtotal_usd), amount: order.tax_usd, feeCode: 'GUEST_SERVICE' })
  let done = order.folio_lines_done || 0
  let ids = order.guesty_invoice_item_ids || []
  if (done >= lines.length) return { ok: true, done, total: lines.length, ids }
  const inv = await createInvoiceItems(order.reservation_id, lines.slice(done))
  done += inv.created
  ids = ids.concat(inv.ids)
  await patch(order.id, { guesty_invoice_item_ids: ids, folio_lines_done: done })
  return { ok: inv.ok, error: inv.error, done, total: lines.length, ids }
}

function cardLabel(c: { brand?: string | null; last4?: string | null }): string {
  return (c.brand ? c.brand + ' ' : '') + (c.last4 ? '•••• ' + c.last4 : 'card on file')
}

/** The card Guesty holds for a booking, if any. */
async function cardOnFile(reservationId: string): Promise<{ card: any | null; error: string; airbnb: boolean }> {
  try {
    const { data } = await supabaseAdmin().from('guesty_reservations').select('guest_id,source').eq('id', reservationId).limit(1)
    const row: any = (data || [])[0] || {}
    const pm = await listPaymentMethods(String(row.guest_id || ''), reservationId)
    return { card: pm.ok ? pickChargeable(pm.methods) : null, error: pm.ok ? '' : (pm.error || 'could not read payment methods'), airbnb: /airbnb/i.test(String(row.source || '')) }
  } catch (e: any) { return { card: null, error: String(e?.message || e).slice(0, 200), airbnb: false } }
}

async function checkInTimeFor(code: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from('guest_order_links').select('check_in_time').eq('code', code).limit(1)
  return data && data[0] ? (data[0] as any).check_in_time || null : null
}

/** Folio lines left behind by a declined / cancelled order are removed (best-effort) or flagged. */
async function cleanFolio(order: OrderRow): Promise<string | null> {
  const ids = order.guesty_invoice_item_ids || []
  if (!ids.length) return null
  let removed = 0
  const left: string[] = []
  for (const iid of ids) {
    const r = await deleteInvoiceItem(order.reservation_id, iid)
    if (r.ok) removed++; else left.push(iid)
  }
  const note = left.length ? left.length + ' folio line' + (left.length === 1 ? '' : 's') + ' still on the Guesty reservation — remove by hand (Guesty would otherwise collect it as balance due)' : null
  await patch(order.id, { guesty_invoice_item_ids: left, folio_lines_done: 0, folio_note: note })
  return note
}

/**
 * A human collected the money. WHERE they collected it decides what we write back to Guesty:
 *   'guesty'   — they charged the card / the payment link cleared IN Guesty. Guesty already knows;
 *                writing anything would double-count. The folio lines are settled by that payment.
 *   'external' — taken outside Guesty (cash, terminal, Airbnb resolution) and we record it against
 *                the folio so the reservation balances.
 *   'outside'  — taken outside Guesty and NOT recorded there. Open folio lines are then flagged,
 *                because Guesty would otherwise chase the guest for a balance they already paid.
 */
export type Settle = 'guesty' | 'external' | 'outside'
export async function markPaid(id: string, actor: string, note: string, settle: Settle): Promise<{ ok: boolean; order?: OrderRow; error?: string }> {
  const order = await getOrder(id)
  if (!order) return { ok: false, error: 'order not found' }
  if (['paid', 'pushed', 'delivered'].indexOf(order.status) >= 0) return { ok: true, order }
  if (['declined', 'cancelled'].indexOf(order.status) >= 0) return { ok: false, error: 'order is ' + order.status }
  const cfg = await getGuestOrdersCfg()
  const paidAt = new Date()
  // claim first so two "mark paid" taps cannot record the payment twice
  const claim = await supabaseAdmin().from('guest_orders').update({ status: 'paid', paid_at: paidAt.toISOString(), paid_via: settle === 'guesty' ? 'guesty:manual' : 'manual', updated_at: paidAt.toISOString() })
    .eq('id', id).in('status', ['submitted', 'approved', 'awaiting_payment', 'payment_failed']).select('id')
  if (claim.error || !claim.data || !claim.data.length) return { ok: false, error: 'already handled — refresh', order: await getOrder(id) || undefined }
  let extra = settle === 'guesty' ? ' · taken in Guesty' : ''
  if (settle === 'external') {
    const r = await recordExternalPayment(order.reservation_id, order.total_usd, 'Guest order ' + summarizeLines(order.items) + (note ? ' · ' + note : ''))
    extra = r.ok ? ' · recorded in Guesty' : ' · NOT recorded in Guesty (' + (r.error || 'failed') + ')'
    if (r.ok && r.paymentId) await patch(id, { guesty_payment_id: r.paymentId })
  }
  // Only 'outside' can leave the folio chasing money that is already in hand.
  const folioLeft = settle === 'outside' ? (order.guesty_invoice_item_ids || []).length : 0
  const dd = resolveDelivery(paidAt, order.check_in || todayET(), order.check_out, await checkInTimeFor(order.link_code), timingFor(cfg, order.building, order.market, order.listing_id), order.requested_delivery, order.requested_date)
  await patch(id, {
    approved_at: order.approved_at || paidAt.toISOString(), approved_by: order.approved_by || actor,
    payment_note: 'Marked paid by ' + actor + (note ? ' — ' + note.slice(0, 200) : '') + extra, charge_error: null,
    delivery_date: dd.date, delivery_note: dd.note,
    folio_note: folioLeft ? folioLeft + ' folio line' + (folioLeft === 1 ? '' : 's') + ' on the Guesty reservation are still unpaid there — record the payment or remove them so Guesty does not collect twice' : null,
  })
  try { const paid = await getOrder(id); if (paid) await reserveStockFor(paid, cfg, actor) } catch (e) { console.error('guest-orders: reserve failed', e) }
  return { ok: true, order: await getOrder(id) || undefined }
}

export async function declineOrder(id: string, actor: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const order = await getOrder(id)
  if (!order) return { ok: false, error: 'order not found' }
  if (['paid', 'pushed', 'delivered'].indexOf(order.status) >= 0) return { ok: false, error: 'already paid — cancel and refund in Guesty instead' }
  if (order.status === 'approved') return { ok: false, error: 'a charge is in progress — wait for it to finish' }
  await patch(id, { status: 'declined', declined_at: new Date().toISOString(), declined_by: actor, decline_reason: reason ? reason.slice(0, 300) : null })
  await cleanFolio(order)
  return { ok: true }
}
export async function cancelOrder(id: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const order = await getOrder(id)
  if (!order) return { ok: false, error: 'order not found' }
  if (order.status === 'delivered') return { ok: false, error: 'already delivered' }
  if (order.status === 'approved') return { ok: false, error: 'a charge is in progress — wait for it to finish' }
  await patch(id, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: actor })
  if (!order.paid_at) await cleanFolio(order)
  else await patch(id, { folio_note: 'Paid ' + money(order.total_usd) + ' — refund it in Guesty if the guest is owed the money' })
  if (order.paid_at && ['paid', 'pushed'].indexOf(order.status) >= 0) { try { await releaseStockFor(order, actor) } catch { /* stock-take fixes it */ } }
  return { ok: true }
}
export async function markDelivered(id: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const order = await getOrder(id)
  if (!order) return { ok: false, error: 'order not found' }
  if (['paid', 'pushed'].indexOf(order.status) < 0) return { ok: false, error: 'only a paid order can be delivered (it is ' + order.status.replace('_', ' ') + ')' }
  const claim = await supabaseAdmin().from('guest_orders').update({ status: 'delivered', delivered_at: new Date().toISOString(), delivered_by: actor, updated_at: new Date().toISOString() }).eq('id', id).in('status', ['paid', 'pushed']).select('id')
  if (claim.error || !claim.data || !claim.data.length) return { ok: false, error: 'already handled' }
  try { await consumeStockFor(order, actor) } catch { /* stock-take fixes it */ }
  return { ok: true }
}
export async function setDeliveryDate(id: string, date: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const order = await getOrder(id)
  if (!order) return { ok: false, error: 'order not found' }
  // 'asap' / 'arrival' re-run the rule from now; a real date is taken as given (staff override).
  if (date === 'asap' || date === 'arrival') {
    const cfg = await getGuestOrdersCfg()
    const dd = resolveDelivery(new Date(), order.check_in || todayET(), order.check_out, await checkInTimeFor(order.link_code), timingFor(cfg, order.building, order.market, order.listing_id), date, null)
    await patch(id, { delivery_date: dd.date, delivery_note: dd.note + ' · set by ' + actor })
    return { ok: true }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'bad date' }
  await patch(id, { delivery_date: date, delivery_note: 'set by ' + actor })
  return { ok: true }
}

// ── Delivery-day push ─────────────────────────────────────────────────────────────────────────

type Assignee = { names: string[]; ids: number[]; note: string }

/** Who takes the order: the cleaner on the unit's clean that day, else the market supervisor. */
async function pickAssignee(order: OrderRow, date: string): Promise<Assignee> {
  let names: string[] = []
  let note = ''
  try {
    const mod = await import('./daysheet')
    const sheet: any = await mod.buildDaySheet(date)
    if (sheet && sheet.ok) {
      const lid = String(order.listing_id || '')
      const dep = (sheet.departures || []).find((d: any) => String(d.listingId || '') === lid)
      const fromClean = dep && dep.clean && Array.isArray(dep.clean.assignees) ? dep.clean.assignees.filter(Boolean) : []
      if (fromClean.length) { names = fromClean; note = 'cleaner on the unit’s clean' }
      if (!names.length) {
        const work = (sheet.work || []).filter((w: any) => String(w.listingId || '') === lid && Array.isArray(w.assignees) && w.assignees.length)
        if (work.length) { names = work[0].assignees.filter(Boolean); note = 'assigned to the unit today (' + (work[0].label || work[0].name || 'task') + ')' }
      }
      if (!names.length && order.building) {
        // anyone cleaning in the same building that day
        const b = String(order.building).toLowerCase()
        const same = (sheet.departures || []).filter((d: any) => String(d.building || '').toLowerCase() === b && d.clean && Array.isArray(d.clean.assignees) && d.clean.assignees.length)
        if (same.length) { names = same[0].clean.assignees.filter(Boolean).slice(0, 1); note = 'cleaning in the building today (' + (same[0].unit || '') + ')' }
      }
    }
  } catch { /* fall through to the supervisor */ }
  const auto = await getTaskAutomation()
  const sup = auto.supervisors[order.market || 'Miami'] || auto.supervisors.Miami
  if (!names.length && sup) { names = [sup]; note = 'no clean on the unit that day — market supervisor' }
  // the supervisor rides along on every order, whoever delivers it
  if (sup && names.indexOf(sup) < 0) names.push(sup)
  const ids: number[] = []
  for (const n of names) { try { const id = await matchBreezewayPerson(n); if (id && ids.indexOf(id) < 0) ids.push(id) } catch { /* unmatched name stays a name */ } }
  return { names, ids, note: note || 'no one found — unassigned' }
}

export async function pushOrder(order: OrderRow, cfg: GuestOrdersCfg, opts?: { date?: string; origin?: string | null }): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  const date = opts?.date || order.delivery_date || todayET()
  const db = supabaseAdmin()
  const who = await pickAssignee(order, date)
  const first = String(order.guest_name || 'Guest').split(' ')[0]
  const inHouse = order.check_in ? date > order.check_in : false
  const title = 'Guest order — ' + summarizeLines(order.items, 3)
  const description =
    'GUEST ORDER · deliver ' + (inHouse ? 'today (guest is in-house)' : 'before check-in') + '\n' +
    order.items.map(l => '• ' + l.qty + ' × ' + l.name + (l.unit_label ? ' (' + l.unit_label + ')' : '')).join('\n') +
    (order.guest_note ? '\n\nGuest note: ' + order.guest_note : '') +
    '\n\nGuest: ' + (order.guest_name || 'Guest') + ' · ' + fmtDay(order.check_in) + ' → ' + fmtDay(order.check_out) +
    '\nPaid ' + money(order.total_usd) + ' · order ' + order.id.slice(0, 8) +
    '\nAssigned: ' + (who.names.join(', ') || 'unassigned') + ' (' + who.note + ')'

  let taskId = order.breezeway_task_id || ''
  if (!taskId) {
    const { data: props } = order.listing_id ? await db.from('breezeway_properties').select('home_id').eq('reference_property_id', order.listing_id).limit(1) : { data: [] as any[] }
    const homeId = Number((((props || [])[0]) || {}).home_id)
    const payload: Record<string, any> = { name: title, type_department: 'housekeeping', type_priority: 'high', scheduled_date: date, description }
    if (Number.isFinite(homeId)) payload.home_id = homeId
    else if (order.listing_id) payload.reference_property_id = order.listing_id
    else { await patch(order.id, { push_error: 'no listing on the order' }); return { ok: false, error: 'no listing on the order' } }
    const r = await createBreezewayTask(payload)
    if (!r.ok || !r.data || !r.data.id) {
      const err = 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 160)
      await patch(order.id, { push_error: err, assignee_names: who.names, assignee_ids: who.ids, assign_note: who.note })
      return { ok: false, error: err }
    }
    taskId = String(r.data.id)
    if (who.ids.length) { try { await updateBreezewayTask(taskId, { assignments: who.ids }) } catch { /* names still travel in the description */ } }
    try {
      await db.from('breezeway_tasks_sync').upsert({
        id: taskId, reference_property_id: order.listing_id, name: title, status: 'created', scheduled_date: date, type_department: 'housekeeping',
        assignees: who.names, report_url: r.data.report_url || null, raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    } catch { /* the 15-minute sync catches up */ }
  }
  await patch(order.id, { status: 'pushed', pushed_at: new Date().toISOString(), breezeway_task_id: taskId, assignee_names: who.names, assignee_ids: who.ids, assign_note: who.note, push_error: null, delivery_date: date })

  // Slack — area housekeeping channel, cleaner @-mentioned, supervisors DM'd.
  try {
    const rules = await getSlackRules()
    const rule = rules.events.guest_orders
    if (rule && rule.enabled) {
      const { users } = await getDirectory()
      const group = groupForBuilding(rules, order.building)
      const personIds = who.names.map(n => resolveSlackId(n, users, rules))
      const audience = audienceFor(rules, group, personIds)
      const base = (cfg.publicBase || opts?.origin || '').replace(/\/+$/, '')
      const liveUrl = base + '/orders-live'
      const tags = audience.map(id => '<@' + id + '>').join(' ')
      const body = ':package: *Guest order for ' + slackSafe(order.unit || 'unit') + ' — ' + (inHouse ? 'deliver today' : 'have it in before ' + slackSafe(first) + ' arrives') + '*\n' +
        order.items.map(l => '• ' + l.qty + '× ' + slackSafe(l.name)).join('\n') +
        (order.guest_note ? '\n_"' + slackSafe(order.guest_note.slice(0, 160)) + '"_' : '') +
        '\n' + (who.names.length ? who.names.join(' + ') + ' — ' + who.note : 'nobody assigned yet') +
        '\n<' + liveUrl + '|Today’s orders> · Breezeway task ' + taskId + '\n' + tags
      const threadBody = rules.bilingualFieldChannels
        ? ':package: *Pedido del huésped para ' + slackSafe(order.unit || 'la unidad') + '* — ' + (inHouse ? 'entregar hoy' : 'dejarlo listo antes de la llegada') + '\n' +
          order.items.map(l => '• ' + l.qty + '× ' + slackSafe(l.name)).join('\n') + '\nAsignado: ' + slackSafe(who.names.join(' + ') || 'pendiente')
        : null
      const res = await draft({
        eventKey: 'guest_orders',
        groupKey: 'guest_order:' + order.id + ':push',
        building: order.building,
        channelId: channelFor(rules, group, 'housekeeping'),
        dmUserIds: group ? group.supervisors : [],
        body, threadBody,
        summary: 'Guest order · ' + (order.unit || '') + ' · ' + summarizeLines(order.items, 2),
        audience, itemCount: order.items.length,
      }, rules)
      if (res.ok) await patch(order.id, { slack_outbox_id: res.id })
    }
  } catch (e) { console.error('guest-orders: slack failed', e) }

  // Email — the day's orders to the recipients list.
  try {
    if (cfg.emailRecipients.length) {
      const base = (cfg.publicBase || opts?.origin || '').replace(/\/+$/, '')
      const html =
        '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">' +
        '<p style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#888;margin:0 0 6px">Guest order · ' + esc(order.building || '') + '</p>' +
        '<h2 style="margin:0 0 4px;font-size:22px">' + esc(order.unit || 'Unit') + ' — ' + (inHouse ? 'deliver today' : 'before arrival') + '</h2>' +
        '<p style="margin:0 0 14px;color:#555">' + esc(order.guest_name || 'Guest') + ' · ' + fmtDay(order.check_in) + ' → ' + fmtDay(order.check_out) + ' · paid ' + money(order.total_usd) + '</p>' +
        '<table style="border-collapse:collapse;width:100%;font-size:14px">' + order.items.map(l => '<tr><td style="padding:6px 0;border-bottom:1px solid #eee"><b>' + l.qty + '×</b> ' + esc(l.name) + (l.unit_label ? ' <span style="color:#888">(' + esc(l.unit_label) + ')</span>' : '') + '</td></tr>').join('') + '</table>' +
        (order.guest_note ? '<p style="margin:12px 0;padding:10px 12px;background:#f6f6f6;border-radius:8px;font-style:italic">' + esc(order.guest_note) + '</p>' : '') +
        '<p style="margin:14px 0 0"><b>Assigned:</b> ' + esc(who.names.join(' + ') || 'unassigned') + ' <span style="color:#888">— ' + esc(who.note) + '</span></p>' +
        '<p style="margin:18px 0 0"><a href="' + base + '/orders-live" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:600">Open today’s orders</a></p>' +
        '<p style="margin:14px 0 0;font-size:12px;color:#999">Breezeway task ' + esc(taskId) + ' · order ' + order.id.slice(0, 8) + '</p></div>'
      const m = await sendResendEmail({ to: cfg.emailRecipients, subject: 'Guest order · ' + (order.unit || 'unit') + ' · ' + summarizeLines(order.items, 2), html })
      if (m.ok) await patch(order.id, { email_sent_at: new Date().toISOString() })
    }
  } catch (e) { console.error('guest-orders: email failed', e) }

  return { ok: true, taskId }
}

function esc(s: string): string { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]) }

/** Cron hop 3: every paid order whose delivery date is today or earlier. */
export async function pushDue(cfg: GuestOrdersCfg, budgetMs = 40_000): Promise<{ due: number; pushed: number; errors: string[]; skipped?: string }> {
  const started = Date.now()
  const today = todayET()
  // Crew hours only. An order paid at 11pm becomes "due" at midnight; the task, the Slack @-mention
  // and the email wait for 6am. "Push to team now" on the board bypasses this on purpose.
  const hour = etParts(new Date()).hour
  if (hour < 6 || hour >= 21) return { due: 0, pushed: 0, errors: [], skipped: 'outside crew hours (6:00–21:00 ET) — pushes resume at 6:08' }
  const { data } = await supabaseAdmin().from('guest_orders').select('*').eq('status', 'paid').lte('delivery_date', today).order('delivery_date', { ascending: true }).limit(100)
  const rows = (data || []).map(normOrder)
  let pushed = 0
  const errors: string[] = []
  for (const o of rows) {
    if (Date.now() - started > budgetMs) { errors.push('budget: stopped after ' + pushed); break }
    const r = await pushOrder(o, cfg, { date: today })
    if (r.ok) pushed++
    else errors.push((o.unit || o.id.slice(0, 8)) + ': ' + (r.error || 'failed'))
  }
  return { due: rows.length, pushed, errors }
}

// ── Board reads ───────────────────────────────────────────────────────────────────────────────

export async function listOrders(opts?: { status?: string[]; days?: number; limit?: number }): Promise<OrderRow[]> {
  const db = supabaseAdmin()
  let q = db.from('guest_orders').select('*').order('submitted_at', { ascending: false })
  if (opts?.status && opts.status.length) q = q.in('status', opts.status)
  if (opts?.days) q = q.gte('submitted_at', new Date(Date.now() - opts.days * 86_400_000).toISOString())
  const { data } = await q.limit(opts?.limit || 300)
  return (data || []).map(normOrder)
}

export async function listLinks(opts?: { from?: string; to?: string; limit?: number }): Promise<LinkRow[]> {
  const db = supabaseAdmin()
  let q = db.from('guest_order_links').select('*').order('check_in', { ascending: true })
  if (opts?.from) q = q.gte('check_in', opts.from)
  if (opts?.to) q = q.lte('check_in', opts.to)
  const { data } = await q.limit(opts?.limit || 400)
  return (data || []) as LinkRow[]
}

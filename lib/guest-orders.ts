// GUEST ORDERS — the vending machine (Jon, 2026-08-24). See migration 048 for the brief.
//
// THE PIPELINE, one function per hop, every hop idempotent so the cron can re-run safely:
//
//   ensureLink(reservation)      one unguessable /order/<code> per reservation, written into the
//                                Guesty reservation custom field "Order form" so Guesty's own
//                                pre-arrival automation carries it to the guest
//   submitOrder(code, basket)    guest's basket → guest_orders (status submitted) → approvers told
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
import { getDirectory, dmUser } from './slack'
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
  /** Per-building overrides (canonical labels from lib/segments). Building beats market beats global. */
  buildingRules: Record<string, ScopeRule>
}
/** What can differ by building / location (Jon, 2026-08-24: "customizable by building and by location"). */
export type ScopeRule = { enabled?: boolean; orderByHoursBefore?: number; leadHours?: number; sameDayCutoffHour?: number }
export type Timing = { enabled: boolean; orderByHoursBefore: number; leadHours: number; sameDayCutoffHour: number; checkInHour: number; source: string }

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
}

const num = (v: any, fb: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : fb }
const str = (v: any, fb: string, max = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fb)
const optNum = (v: any, lo: number, hi: number): number | undefined => { if (v === '' || v === null || v === undefined) return undefined; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined }
function normScope(o: any): ScopeRule | null {
  if (!o || typeof o !== 'object') return null
  const r: ScopeRule = {}
  if (o.enabled === false) r.enabled = false
  const a = optNum(o.orderByHoursBefore, 0, 240); if (a !== undefined) r.orderByHoursBefore = a
  const b = optNum(o.leadHours, 0, 168); if (b !== undefined) r.leadHours = b
  const c = optNum(o.sameDayCutoffHour, 0, 23); if (c !== undefined) r.sameDayCutoffHour = c
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
  }
}

/** The timing that applies to one stay: building override → market override → global. */
export function timingFor(cfg: GuestOrdersCfg, building: string | null | undefined, market: string | null | undefined): Timing {
  const b = building ? cfg.buildingRules[building] : undefined
  const m = market ? cfg.marketRules[market] : undefined
  const pick = <K extends keyof ScopeRule>(k: K, fb: NonNullable<ScopeRule[K]>): NonNullable<ScopeRule[K]> =>
    (b && b[k] !== undefined ? b[k] : m && m[k] !== undefined ? m[k] : fb) as NonNullable<ScopeRule[K]>
  const enabled = b && b.enabled === false ? false : m && m.enabled === false ? false : true
  return {
    enabled,
    orderByHoursBefore: pick('orderByHoursBefore', cfg.orderByHoursBefore),
    leadHours: pick('leadHours', cfg.leadHours),
    sameDayCutoffHour: pick('sameDayCutoffHour', cfg.sameDayCutoffHour),
    checkInHour: cfg.checkInHour,
    source: b && Object.keys(b).length ? 'building rule' : m && Object.keys(m).length ? 'market rule' : 'default',
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

// ── Catalog ───────────────────────────────────────────────────────────────────────────────────

export type CatalogItem = {
  id: string; sku: string; name: string; description: string | null; price_usd: number; unit_label: string | null
  category: string | null; fee_code: string; max_qty: number; sort: number; active: boolean; buildings: string[] | null; markets: string[] | null; image_url: string | null
}

/**
 * The catalog one stay sees. An item limited to buildings / markets only shows there — and a
 * building-specific item REPLACES a general item with the same name, so "Bottled water · 17West
 * · $18" quietly wins over "Bottled water · $15" in that building. That is how prices differ per
 * building without a second pricing table (Jon, 2026-08-24: "customizable by building and by
 * location").
 */
export async function loadCatalog(opts?: { building?: string | null; market?: string | null; activeOnly?: boolean }): Promise<CatalogItem[]> {
  const db = supabaseAdmin()
  let q = db.from('guest_order_catalog').select('*').order('sort', { ascending: true }).order('name', { ascending: true })
  if (opts?.activeOnly !== false) q = q.eq('active', true)
  const { data } = await q.limit(500)
  const rows = (data || []).map((r: any) => ({ ...r, price_usd: Number(r.price_usd) || 0, max_qty: Number(r.max_qty) || 10, sort: Number(r.sort) || 100 })) as CatalogItem[]
  if (!opts || (!opts.building && !opts.market)) return rows
  const b = String(opts.building || '').toLowerCase()
  const m = String(opts.market || '').toLowerCase()
  const has = (list: string[] | null | undefined, v: string) => !!list && list.length > 0 && list.some(x => String(x).toLowerCase() === v)
  const scoped = rows.filter(r => {
    if (r.buildings && r.buildings.length && !has(r.buildings, b)) return false
    if (r.markets && r.markets.length && !has(r.markets, m)) return false
    return true
  })
  const specificNames: Record<string, boolean> = {}
  for (const r of scoped) if ((r.buildings && r.buildings.length) || (r.markets && r.markets.length)) specificNames[r.name.trim().toLowerCase()] = true
  return scoped.filter(r => ((r.buildings && r.buildings.length) || (r.markets && r.markets.length)) || !specificNames[r.name.trim().toLowerCase()])
}

export type OrderLine = { sku: string; name: string; qty: number; unit_price_usd: number; line_total_usd: number; fee_code: string; unit_label?: string | null }

export function priceBasket(catalog: CatalogItem[], basket: { sku: string; qty: number }[], cfg: GuestOrdersCfg): { lines: OrderLine[]; subtotal: number; tax: number; total: number; problems: string[] } {
  const lines: OrderLine[] = []
  const problems: string[] = []
  for (const b of basket) {
    const item = catalog.find(c => c.sku === b.sku)
    const qty = Math.floor(Number(b.qty) || 0)
    if (!item) { problems.push('"' + b.sku + '" is no longer available'); continue }
    if (qty <= 0) continue
    if (qty > item.max_qty) { problems.push(item.name + ': max ' + item.max_qty); continue }
    const line = Math.round(item.price_usd * qty * 100) / 100
    lines.push({ sku: item.sku, name: item.name, qty, unit_price_usd: item.price_usd, line_total_usd: line, fee_code: item.fee_code || 'GUEST_SERVICE', unit_label: item.unit_label })
  }
  const subtotal = Math.round(lines.reduce((n, l) => n + l.line_total_usd, 0) * 100) / 100
  const tax = Math.round(subtotal * (cfg.taxPct / 100) * 100) / 100
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
export async function orderFormFieldId(name: string): Promise<string | null> {
  if (_fieldCache && _fieldCache.name === name && Date.now() - _fieldCache.at < 10 * 60_000 && _fieldCache.id) return _fieldCache.id
  const db = supabaseAdmin()
  const find = async () => {
    const { data } = await db.from('guesty_custom_fields').select('id,name,target').ilike('name', name).limit(10)
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
  if (!fieldId) return { ok: false, note: 'Guesty reservation custom field "' + cfg.customFieldName + '" not found — create it in Guesty (Settings → Custom fields → Reservation) and the link fills on the next run' }
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
    scopeOk[String(l.id)] = timingFor(cfg, building, marketOf(building, l.address_city, name)).enabled
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
  delivery_date: string | null; delivery_note: string | null; pushed_at: string | null; breezeway_task_id: string | null
  assignee_names: string[]; assignee_ids: number[]; assign_note: string | null; slack_outbox_id: string | null; push_error: string | null
  email_sent_at: string | null; delivered_at: string | null; delivered_by: string | null; cancelled_at: string | null; cancelled_by: string | null
  created_at: string; updated_at: string
}

function normOrder(r: any): OrderRow {
  return { ...r, items: Array.isArray(r.items) ? r.items : [], subtotal_usd: Number(r.subtotal_usd) || 0, tax_usd: Number(r.tax_usd) || 0, total_usd: Number(r.total_usd) || 0,
    guesty_invoice_item_ids: r.guesty_invoice_item_ids || [], folio_lines_done: Number(r.folio_lines_done) || 0, assignee_names: r.assignee_names || [], assignee_ids: r.assignee_ids || [] }
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  const { data } = await supabaseAdmin().from('guest_orders').select('*').eq('id', id).limit(1)
  return data && data[0] ? normOrder(data[0]) : null
}
export async function getOrderByToken(token: string): Promise<OrderRow | null> {
  if (!token) return null
  const { data } = await supabaseAdmin().from('guest_orders').select('*').eq('approve_token', token).limit(1)
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
export async function submitOrder(link: LinkRow, basket: { sku: string; qty: number }[], guestNote: string, origin: string | null): Promise<{ ok: boolean; order?: OrderRow; error?: string }> {
  const cfg = await getGuestOrdersCfg()
  const catalog = await loadCatalog({ building: link.building, market: link.market })
  const priced = priceBasket(catalog, basket, cfg)
  if (priced.problems.length) return { ok: false, error: priced.problems.join(' · ') }
  if (!priced.lines.length) return { ok: false, error: 'Pick at least one item.' }
  const db = supabaseAdmin()
  const row = {
    link_code: link.code, reservation_id: link.reservation_id, listing_id: link.listing_id, unit: link.unit, building: link.building, market: link.market,
    guest_name: link.guest_name, guest_email: link.guest_email, check_in: link.check_in, check_out: link.check_out,
    status: 'submitted', items: priced.lines, subtotal_usd: priced.subtotal, tax_usd: priced.tax, total_usd: priced.total, currency: 'USD',
    guest_note: guestNote ? guestNote.slice(0, 600) : null, approve_token: randomBytes(24).toString('hex'),
  }
  const ins = await db.from('guest_orders').insert(row).select('*').limit(1)
  if (ins.error) return { ok: false, error: ins.error.message }
  const order = normOrder((ins.data || [])[0])
  try { await notifyNewOrder(order, cfg, origin) } catch (e) { console.error('guest-orders: notify failed', e) }
  return { ok: true, order }
}

function money(n: number): string { return '$' + (Math.round(n * 100) / 100).toFixed(2) }

/** Guest text goes into Slack mrkdwn — a note of "<!channel>" must not page a channel. */
function slackSafe(s: string): string { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

async function notifyNewOrder(order: OrderRow, cfg: GuestOrdersCfg, origin: string | null): Promise<void> {
  const rules = await getSlackRules()
  const rule = rules.events.guest_orders
  if (!rule || !rule.enabled) return
  const base = (cfg.publicBase || origin || '').replace(/\/+$/, '')
  const approveUrl = base + '/approve/order/' + order.approve_token
  const boardUrl = base + '/guest-orders'
  const first = String(order.guest_name || 'Guest').split(' ')[0]
  const core = ':shopping_trolley: *New guest order — ' + slackSafe(order.unit || 'unit') + '* · ' + money(order.total_usd) + '\n' +
    slackSafe(first) + ' arrives ' + fmtDay(order.check_in) + (order.check_out ? ' → ' + fmtDay(order.check_out) : '') + '\n' +
    order.items.map(l => '• ' + l.qty + '× ' + slackSafe(l.name) + ' — ' + money(l.line_total_usd)).join('\n') +
    (order.guest_note ? '\n_"' + slackSafe(order.guest_note.slice(0, 200)) + '"_' : '')
  // THE CHARGE LINK ONLY EVER TRAVELS IN A DM TO AN APPROVER. The outbox copies every message to
  // the firehose, so it cannot carry the token; the approvers are DM'd directly, like the outbox
  // does for its own approve links.
  for (const approver of rules.approvers) {
    try { await dmUser(approver, core + '\n\n<' + approveUrl + '|✅ Approve & charge ' + money(order.total_usd) + '>   ·   <' + boardUrl + '|Open Guest Orders>') } catch { /* board still works */ }
  }
  const group = groupForBuilding(rules, order.building)
  const res = await draft({
    eventKey: 'guest_orders',
    groupKey: 'guest_order:' + order.id + ':new',
    building: order.building,
    channelId: rules.opsChannel || rules.defaultChannel || rules.firehose,
    body: core + '\n\n<' + boardUrl + '|Open Guest Orders to approve>',
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
    await patch(id, { status: 'awaiting_payment', charge_error: null, payment_note: 'Charge mode is manual — collect and mark paid.' })
    return { ok: true, order: await getOrder(id) || undefined }
  }

  try {
    // 1. A card we can charge?
    const { data: rs } = await db.from('guesty_reservations').select('guest_id,source').eq('id', order.reservation_id).limit(1)
    const guestId = String(((rs || [])[0] || {}).guest_id || '')
    const pm = await listPaymentMethods(guestId, order.reservation_id)
    const card = pm.ok ? pickChargeable(pm.methods) : null
    if (!card) {
      const why = !pm.ok ? pm.error : 'No card on file in Guesty for this booking' + (/airbnb/i.test(String(((rs || [])[0] || {}).source || '')) ? ' (Airbnb collects payment — request it through the Resolution Center)' : '') + '.'
      await patch(id, { status: 'awaiting_payment', charge_error: why, payment_note: 'Collect the ' + money(order.total_usd) + ' another way, then mark paid.' })
      return { ok: true, order: await getOrder(id) || undefined }
    }

    // 2. Folio lines — resumable. `folio_lines_done` is the number Guesty has accepted, so a retry
    //    after a failed charge never re-posts a line and a partial failure picks up where it stopped.
    const lines = order.items.map(l => ({ title: l.qty + '× ' + l.name, description: 'Guest order · ' + l.qty + ' × ' + money(l.unit_price_usd) + (l.unit_label ? ' (' + l.unit_label + ')' : ''), amount: l.line_total_usd, feeCode: l.fee_code }))
    if (order.tax_usd > 0) lines.push({ title: 'Sales tax on guest order', description: cfg.taxPct + '% on ' + money(order.subtotal_usd), amount: order.tax_usd, feeCode: 'GUEST_SERVICE' })
    let done = order.folio_lines_done || 0
    let invoiceIds = order.guesty_invoice_item_ids || []
    if (done < lines.length) {
      const inv = await createInvoiceItems(order.reservation_id, lines.slice(done))
      done += inv.created
      invoiceIds = invoiceIds.concat(inv.ids)
      await patch(id, { guesty_invoice_item_ids: invoiceIds, folio_lines_done: done })
      if (!inv.ok) {
        await patch(id, { status: 'payment_failed', charge_error: 'Could not add the order to the Guesty folio: ' + inv.error + ' (' + done + ' of ' + lines.length + ' lines are on it)' })
        return { ok: false, order: await getOrder(id) || undefined, error: inv.error }
      }
    }

    // 3. The charge.
    const ch = await chargeSavedCard(order.reservation_id, card.id, order.total_usd, 'Guest order ' + summarizeLines(order.items) + ' · Lighthouse order ' + order.id.slice(0, 8))
    if (!ch.ok) {
      await patch(id, { status: 'payment_failed', charge_error: ch.error || 'charge failed', charge_raw: ch.raw || null, guesty_payment_id: ch.paymentId || null })
      return { ok: false, order: await getOrder(id) || undefined, error: ch.error }
    }
    const paidAt = new Date()
    const dd = deliveryDateFor(paidAt, order.check_in || todayET(), order.check_out, await checkInTimeFor(order.link_code), timingFor(cfg, order.building, order.market))
    await patch(id, {
      status: 'paid', paid_at: paidAt.toISOString(), paid_via: 'guesty:' + card.id, charge_error: null, charge_raw: ch.raw || null, guesty_payment_id: ch.paymentId || null,
      payment_note: 'Charged ' + (card.brand ? card.brand + ' ' : '') + (card.last4 ? '•••• ' + card.last4 : 'card on file') + ' via Guesty (' + (ch.status || 'ok') + ')',
      delivery_date: dd.date, delivery_note: dd.note, folio_note: null,
    })
    return { ok: true, order: await getOrder(id) || undefined }
  } catch (e: any) {
    // Never leave a row sitting in 'approved' with no reason.
    const msg = String(e?.message || e).slice(0, 240)
    await patch(id, { status: 'payment_failed', charge_error: 'Charge attempt threw: ' + msg })
    return { ok: false, order: await getOrder(id) || undefined, error: msg }
  }
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

/** A human collected the money elsewhere. Optionally records it on the Guesty folio. */
export async function markPaid(id: string, actor: string, note: string, recordInGuesty: boolean): Promise<{ ok: boolean; order?: OrderRow; error?: string }> {
  const order = await getOrder(id)
  if (!order) return { ok: false, error: 'order not found' }
  if (['paid', 'pushed', 'delivered'].indexOf(order.status) >= 0) return { ok: true, order }
  if (['declined', 'cancelled'].indexOf(order.status) >= 0) return { ok: false, error: 'order is ' + order.status }
  const cfg = await getGuestOrdersCfg()
  const paidAt = new Date()
  // claim first so two "mark paid" taps cannot record the payment twice
  const claim = await supabaseAdmin().from('guest_orders').update({ status: 'paid', paid_at: paidAt.toISOString(), paid_via: 'manual', updated_at: paidAt.toISOString() })
    .eq('id', id).in('status', ['submitted', 'approved', 'awaiting_payment', 'payment_failed']).select('id')
  if (claim.error || !claim.data || !claim.data.length) return { ok: false, error: 'already handled — refresh', order: await getOrder(id) || undefined }
  let extra = ''
  if (recordInGuesty) {
    const r = await recordExternalPayment(order.reservation_id, order.total_usd, 'Guest order ' + summarizeLines(order.items) + (note ? ' · ' + note : ''))
    extra = r.ok ? ' · recorded in Guesty' : ' · NOT recorded in Guesty (' + (r.error || 'failed') + ')'
    if (r.ok && r.paymentId) await patch(id, { guesty_payment_id: r.paymentId })
  }
  const folioLeft = (order.guesty_invoice_item_ids || []).length
  const dd = deliveryDateFor(paidAt, order.check_in || todayET(), order.check_out, await checkInTimeFor(order.link_code), timingFor(cfg, order.building, order.market))
  await patch(id, {
    approved_at: order.approved_at || paidAt.toISOString(), approved_by: order.approved_by || actor,
    payment_note: 'Marked paid by ' + actor + (note ? ' — ' + note.slice(0, 200) : '') + extra, charge_error: null,
    delivery_date: dd.date, delivery_note: dd.note,
    folio_note: folioLeft && !recordInGuesty ? folioLeft + ' folio line' + (folioLeft === 1 ? '' : 's') + ' on the Guesty reservation are still unpaid there — record the payment or remove them so Guesty does not collect twice' : null,
  })
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
  return { ok: true }
}
export async function markDelivered(id: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const order = await getOrder(id)
  if (!order) return { ok: false, error: 'order not found' }
  if (['paid', 'pushed'].indexOf(order.status) < 0) return { ok: false, error: 'only a paid order can be delivered (it is ' + order.status.replace('_', ' ') + ')' }
  await patch(id, { status: 'delivered', delivered_at: new Date().toISOString(), delivered_by: actor })
  return { ok: true }
}
export async function setDeliveryDate(id: string, date: string, actor: string): Promise<{ ok: boolean; error?: string }> {
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

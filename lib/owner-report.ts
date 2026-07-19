// Owner Report engine — assembles the content JSON for an owner-facing report
// (modeled on the 17 West Weekly Owner Review deck). Pure data assembly from the
// Supabase mirrors (guesty_reservations / guesty_listings / guesty_reviews /
// breezeway_tasks_sync) plus stored owner_budgets. The AI narrative pass lives in
// the generate route; everything here is deterministic math so numbers are auditable.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { rollupBuilding } from './optimize-score'

const CONFIRMED = ['confirmed', 'checked_in', 'checked_out']

// ---------- date helpers (all ET-naive YYYY-MM-DD strings) ----------
export function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function overlapNights(checkIn: string, checkOut: string, from: string, toExcl: string): number {
  if (!checkIn || !checkOut) return 0
  const s = checkIn > from ? checkIn : from
  const e = checkOut < toExcl ? checkOut : toExcl
  const n = daysBetween(s, e)
  return n > 0 ? n : 0
}
function monthStart(iso: string): string { return iso.slice(0, 7) + '-01' }
function monthEndExcl(iso: string): string {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7))
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1
  return String(ny) + '-' + String(nm).padStart(2, '0') + '-01'
}
function monthLabel(iso: string): string {
  const d = new Date(iso.slice(0, 7) + '-15T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function monthShort(iso: string): string {
  const d = new Date(iso.slice(0, 7) + '-15T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}
function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// ---------- types (content JSON shape) ----------
export type MetricSet = {
  accomRevenue: number; grossRevenue: number; occupiedNights: number; availableNights: number
  occupancyPct: number; adr: number; grossAdr: number; revpar: number; grossRevpar: number
  reservations: number
}
export type ReportListing = { id: string; name: string; unit: string; bedrooms: number | null; building: string }

export type ReportContent = {
  meta: {
    scopeLabel: string; periodStart: string; periodEnd: string; asOf: string
    activeListings: number; daysRemaining: number; generatedAt: string
  }
  hero: { eyebrow: string; title: string; headline: string; preparedFor: string; dateLabel: string; heroImage: string | null }
  snapshot: {
    headline: string; subtitle: string
    cards: { key: string; label: string; value: string; sub: string }[]
    ytd: { text: string; stats: { value: string; label: string }[] } | null
  }
  pacing: { headline: string; subtitle: string; rows: { metric: string; ours: string; comps: string; delta: string }[] } | null
  plan: {
    headline: string; subtitle: string
    months: { label: string; status: string; rows: { metric: string; actual: string; budget: string; delta: string; good: boolean }[]; note: string }[]
  } | null
  statement: { headline: string; items: { title: string; summary: string; url: string | null }[] } | null
  ahead: {
    headline: string; subtitle: string
    months: { label: string; status: string; occPct: number; adr: string; revpar: string; note: string }[]
    strip: { month: string; occPct: number }[]
  }
  voices: {
    headline: string; subtitle: string
    quotes: { text: string; guest: string; unit: string; br: string }[]
    themes: { title: string; body: string; action: string }[]
  }
  projects: {
    headline: string; subtitle: string
    weeks: { label: string; groups: { category: string; items: string[] }[] }[]
    tracking: { title: string; body: string }[]
  }
  omit: string[]
}

// ---------- scope resolution ----------
export async function resolveScope(listingIds: string[], buildings: string[]): Promise<{ listings: ReportListing[]; scopeLabel: string }> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, bedrooms, status')
    .limit(2000)
  const all = (data || []) as any[]
  const wantIds = new Set(listingIds.map(String))
  const wantBuildings = buildings.map(b => b.toLowerCase())
  const picked: ReportListing[] = []
  for (const l of all) {
    const st = String(l.status || '').toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) continue
    const roll = rollupBuilding(String(l.building || '').trim())
    const inIds = wantIds.has(String(l.id))
    const inBld = wantBuildings.length > 0 && wantBuildings.indexOf(roll.toLowerCase()) >= 0
    if (!inIds && !inBld) continue
    const name = String(l.nickname || l.title || l.id)
    if (/\bfull\b/i.test(name)) continue
    picked.push({ id: String(l.id), name, unit: String(l.unit || ''), bedrooms: l.bedrooms ?? null, building: roll })
  }
  const bldSet: string[] = []
  for (const p of picked) if (bldSet.indexOf(p.building) < 0) bldSet.push(p.building)
  const scopeLabel = bldSet.length === 1 ? bldSet[0] : (bldSet.length ? bldSet.join(' + ') : 'Portfolio')
  return { listings: picked, scopeLabel }
}

// ---------- reservations pull + metrics ----------
type Resv = { listing_id: string; check_in: string; check_out: string; nights: number; fare: number; cleaning: number; created_at: string | null }

export async function pullReservations(listingIds: string[], from: string, toExcl: string): Promise<Resv[]> {
  const db = supabaseAdmin()
  let all: any[] = []
  for (let i = 0; i < 20; i++) {
    const { data } = await db
      .from('guesty_reservations')
      .select('listing_id, check_in, check_out, nights, status, created_at, cleaning:raw->money->>fareCleaning, fare:raw->money->>fareAccommodation')
      .in('status', CONFIRMED)
      .in('listing_id', listingIds)
      .gt('check_out', from)
      .lt('check_in', toExcl)
      .range(i * 1000, i * 1000 + 999)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < 1000) break
  }
  return all
    .filter((r: any) => r.check_in && r.check_out)
    .map((r: any) => ({
      listing_id: String(r.listing_id || ''),
      check_in: String(r.check_in), check_out: String(r.check_out),
      nights: Math.max(1, num(r.nights) || daysBetween(String(r.check_in), String(r.check_out))),
      fare: num(r.fare), cleaning: num(r.cleaning),
      created_at: r.created_at ? String(r.created_at).slice(0, 10) : null,
    }))
}

// Per-night proration: a stay contributes fare/nights for each night inside the window,
// so month boundaries and partial ranges attribute revenue correctly. Cleaning fees are
// whole-stay and attributed when the CHECKOUT falls inside the window.
export function metricsFor(resv: Resv[], units: number, from: string, toExcl: string): MetricSet {
  let accom = 0, cleaning = 0, occNights = 0, resCount = 0
  for (const r of resv) {
    const on = overlapNights(r.check_in, r.check_out, from, toExcl)
    if (on <= 0) continue
    resCount++
    occNights += on
    accom += (r.fare / r.nights) * on
    if (r.check_out > from && r.check_out <= toExcl) cleaning += r.cleaning
  }
  const days = daysBetween(from, toExcl)
  const avail = Math.max(0, units * days)
  const gross = accom + cleaning
  return {
    accomRevenue: Math.round(accom), grossRevenue: Math.round(gross),
    occupiedNights: occNights, availableNights: avail,
    occupancyPct: avail > 0 ? Math.round((occNights / avail) * 100) : 0,
    adr: occNights > 0 ? Math.round(accom / occNights) : 0,
    grossAdr: occNights > 0 ? Math.round(gross / occNights) : 0,
    revpar: avail > 0 ? Math.round(accom / avail) : 0,
    grossRevpar: avail > 0 ? Math.round(gross / avail) : 0,
    reservations: resCount,
  }
}

export function fmtK(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1000) return '$' + Math.round(n / 1000) + 'K'
  return '$' + Math.round(n).toLocaleString()
}

// ---------- YTD ----------
export async function ytdStats(listingIds: string[], asOf: string, units: number) {
  const jan1 = asOf.slice(0, 4) + '-01-01'
  const toExcl = addDays(asOf, 1)
  const resv = await pullReservations(listingIds, jan1, toExcl)
  const m = metricsFor(resv, units, jan1, toExcl)
  let stayNights = 0, windows = 0, windowCount = 0
  for (const r of resv) {
    stayNights += r.nights
    if (r.created_at && r.created_at <= r.check_in) {
      windows += daysBetween(r.created_at, r.check_in)
      windowCount++
    }
  }
  const avgStay = resv.length ? Math.round((stayNights / resv.length) * 100) / 100 : 0
  const avgWindow = windowCount ? Math.round((windows / windowCount) * 100) / 100 : 0
  return { reservations: resv.length, avgStay, avgWindow, occupancyPct: m.occupancyPct }
}

// ---------- months-ahead (OTB by stay month) ----------
export async function monthsAhead(listingIds: string[], asOf: string, units: number, count: number) {
  const first = monthStart(asOf)
  const months: { iso: string; label: string; short: string; m: MetricSet }[] = []
  // one pull covering the whole horizon
  let horizonEnd = first
  for (let i = 0; i < count; i++) horizonEnd = monthEndExcl(horizonEnd)
  const prevStart = monthStart(addDays(first, -1)) // include the just-closed month for the strip
  const resv = await pullReservations(listingIds, prevStart, horizonEnd)
  let cur = prevStart
  for (let i = 0; i < count + 1; i++) {
    const end = monthEndExcl(cur)
    months.push({ iso: cur, label: monthLabel(cur), short: monthShort(cur), m: metricsFor(resv, units, cur, end) })
    cur = end
  }
  return months // [prev month, current, +1, ...]
}

// ---------- budgets ----------
export type BudgetRow = { building_key: string; year: number; month: number; occupancy_pct: number | null; adr: number | null; revpar: number | null; gross_revenue: number | null }

export async function pullBudgets(buildings: string[], monthIsos: string[]): Promise<Record<string, BudgetRow>> {
  const db = supabaseAdmin()
  if (!buildings.length || !monthIsos.length) return {}
  const { data } = await db.from('owner_budgets').select('*').in('building_key', buildings)
  const out: Record<string, BudgetRow> = {}
  for (const r of (data || []) as any[]) {
    const iso = String(r.year) + '-' + String(r.month).padStart(2, '0') + '-01'
    if (monthIsos.indexOf(iso) >= 0) out[iso] = r as BudgetRow
  }
  return out
}

// ---------- reviews ----------
export type ReviewRow = { rating: number | null; content: string; guest_name: string | null; listing_id: string | null; created_at: string | null; channel: string | null }

export async function pullReviews(listingIds: string[], from: string, asOf: string): Promise<ReviewRow[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('guesty_reviews')
    .select('rating, content, guest_name, listing_id, created_at, channel')
    .in('listing_id', listingIds)
    .gte('created_at', from + 'T00:00:00Z')
    .lte('created_at', asOf + 'T23:59:59Z')
    .order('created_at', { ascending: false })
    .limit(200)
  return ((data || []) as any[]).map(r => ({
    rating: r.rating != null ? Number(r.rating) : null,
    content: String(r.content || ''),
    guest_name: r.guest_name ? String(r.guest_name) : null,
    listing_id: r.listing_id ? String(r.listing_id) : null,
    created_at: r.created_at ? String(r.created_at) : null,
    channel: r.channel ? String(r.channel) : null,
  }))
}

// ---------- breezeway tasks ----------
export type TaskRow = { name: string; department: string | null; status: string | null; date: string; assignee: string | null; unit: string }

export async function pullTasks(listingIds: string[], listingById: Record<string, ReportListing>, from: string, to: string): Promise<{ completed: TaskRow[]; open: TaskRow[] }> {
  const db = supabaseAdmin()
  let all: any[] = []
  for (let i = 0; i < 10; i++) {
    const { data } = await db
      .from('breezeway_tasks_sync')
      .select('name, type_department, status, scheduled_date, finished_at, assignee_name, reference_property_id')
      .in('reference_property_id', listingIds)
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .range(i * 1000, i * 1000 + 999)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < 1000) break
  }
  const completed: TaskRow[] = []
  const open: TaskRow[] = []
  for (const t of all) {
    const st = String(t.status || '').toLowerCase()
    const lid = String(t.reference_property_id || '')
    const unit = listingById[lid] ? (listingById[lid].unit || listingById[lid].name) : ''
    const row: TaskRow = {
      name: String(t.name || ''), department: t.type_department ? String(t.type_department) : null,
      status: st || null, date: String(t.scheduled_date || '').slice(0, 10),
      assignee: t.assignee_name ? String(t.assignee_name) : null, unit,
    }
    if (!row.name) continue
    if (st === 'done' || st === 'completed' || st === 'finished' || !!t.finished_at) completed.push(row)
    else open.push(row)
  }
  return { completed, open }
}

export function weekBuckets(from: string, to: string): { start: string; endIncl: string; label: string }[] {
  // Split the period into up to 3 trailing 7-day buckets ending at `to` (deck shows "last three weeks").
  const buckets: { start: string; endIncl: string; label: string }[] = []
  let end = to
  for (let i = 0; i < 3; i++) {
    const start = addDays(end, -6)
    const s = start < from ? from : start
    const fmt = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase()
    buckets.unshift({ start: s, endIncl: end, label: fmt(s) + ' – ' + fmt(end) })
    if (s <= from) break
    end = addDays(s, -1)
  }
  return buckets
}

export function makeCode(): string {
  const c: any = (globalThis as any).crypto
  const uuid = c && c.randomUUID ? c.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
  return String(uuid).replace(/-/g, '').slice(0, 16)
}

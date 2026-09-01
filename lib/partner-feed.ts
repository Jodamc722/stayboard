// PARTNER FEED — what Lighthouse gives the Revenue App, read-only.
//
// THE SYMMETRY (Jon, 2026-08-24): "get him integrated to my app view only and do the same on his
// end." He hands us dollars; we hand him the operational volumes his P&L has never had a
// denominator for. His CFO sheet already computes cost-per-clean as QuickBooks 5100 ÷ GUESTY
// CHECK-INS — a check-in is not a clean, and a clean that a maintenance tech covered is not free.
// We know how many departure cleans actually COMPLETED and how many hours were actually CLOCKED,
// so that is what we send.
//
// WHAT THIS IS NOT: a second copy of Guesty. He has his own Guesty connection. Everything here is
// something only the ops app knows — completed work, real hours, task mix, per-day rhythm.
//
// RULES
//   • Read-only. Every export is a SELECT; there is no write path in this file.
//   • Off by default. `app_settings.partner_out.enabled` must be turned on, and each feed can be
//     switched off individually.
//   • Dollars are a switch (`includeDollars`). Staff NAMES are off by default and stay off unless
//     Jon turns them on — he needs volumes and cost, not who cleaned what.
//   • Every call is logged to `partner_access_log` (metadata only, never the payload).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { marketOf, buildingOf } from '@/lib/segments'
import { isDepartureCleanName } from '@/lib/breezeway'

export const PARTNER_OUT_KEY = 'partner_out'
export const PARTNER_FEEDS = ['units', 'cleans', 'labor', 'tasks', 'ops-daily', 'status'] as const
export type PartnerFeed = typeof PARTNER_FEEDS[number]

export type PartnerOut = {
  enabled: boolean
  feeds: Record<string, boolean>
  includeDollars: boolean
  includeNames: boolean
}
export const DEFAULT_PARTNER_OUT: PartnerOut = {
  enabled: false,
  feeds: { units: true, cleans: true, labor: true, tasks: true, 'ops-daily': true, status: true },
  includeDollars: true,
  includeNames: false,
}

export async function getPartnerOut(): Promise<PartnerOut> {
  const s = await getSetting<any>(PARTNER_OUT_KEY, null)
  if (!s || typeof s !== 'object') return DEFAULT_PARTNER_OUT
  const feeds: Record<string, boolean> = {}
  for (const f of PARTNER_FEEDS) {
    const v = s.feeds && s.feeds[f]
    feeds[f] = v === undefined ? DEFAULT_PARTNER_OUT.feeds[f] : v === true || v === 'true'
  }
  return {
    enabled: s.enabled === true || s.enabled === 'true',
    feeds,
    includeDollars: s.includeDollars !== false && s.includeDollars !== 'false',
    includeNames: s.includeNames === true || s.includeNames === 'true',
  }
}

/** Timing-safe compare so a wrong key cannot be discovered one character at a time. */
export function keyMatches(given: string, expected: string): boolean {
  if (!given || !expected || given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number => { const x = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : 0 }
const d10 = (v: any): string => str(v).slice(0, 10)
const isDone = (t: any): boolean => /complete|finish|close|approv|done/i.test(str(t && t.status)) || !!(t && t.finished_at)
const isDead = (t: any): boolean => /delete|cancel/i.test(str(t && t.status))
function deptOf(v: any): string {
  const s = str(v).toLowerCase()
  if (/housekeep|clean/.test(s)) return 'housekeeping'
  if (/maint|repair/.test(s)) return 'maintenance'
  if (/inspect/.test(s)) return 'inspection'
  return s || 'other'
}

/** Month → [first, last] ISO dates. */
export function monthRange(month: string): { from: string; to: string } {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7))
  return { from: month + '-01', to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
}

async function pageAll(build: (from: number, to: number) => any, maxPages = 14): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await build(i * 1000, i * 1000 + 999)
    if (error) break
    const rows = (data || []) as any[]
    out.push.apply(out, rows)
    if (rows.length < 1000) break
  }
  return out
}

type Unit = { id: string; name: string; building: string; market: string; city: string; bedrooms: number | null; active: boolean }

async function loadUnits(): Promise<Unit[]> {
  const db = supabaseAdmin()
  const rows = await pageAll((a, b) => db.from('guesty_listings')
    .select('id,nickname,title,building,address_city,bedrooms,status').order('id', { ascending: true }).range(a, b))
  return rows.map((l: any) => {
    const name = str(l.nickname) || str(l.title) || str(l.id)
    // CANONICAL building label, not the raw column — 233 listings carry 78 distinct raw values
    // ("Botanica" AND "Botanica 6209"), and sending him those would poison his grouping the way it
    // already poisoned two of our own screens.
    const building = buildingOf(l.building, name) || str(l.building) || 'Unassigned'
    return {
      id: str(l.id), name, building,
      market: marketOf(l.building, l.address_city, name),
      city: str(l.address_city),
      bedrooms: l.bedrooms == null ? null : Number(l.bedrooms),
      active: !/inactive|disabled|archived|deleted/i.test(str(l.status)),
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------------------------

export async function feedUnits(): Promise<any[]> {
  const units = await loadUnits()
  return units.map(u => ({
    guesty_listing_id: u.id, unit: u.name, building: u.building,
    market: u.market, city: u.city, bedrooms: u.bedrooms, active: u.active,
  }))
}

/**
 * DEPARTURE CLEANS COMPLETED, per unit per month — the number his cost-per-clean actually wants.
 * Completed, not scheduled (feedback: completed vs actual hours is the measure). `vendor` marks the
 * buildings an outside company turns, because blending those into an in-house cost per clean is
 * exactly the mistake this feed exists to prevent.
 */
export async function feedCleans(month: string, opts: PartnerOut): Promise<any[]> {
  const { from, to } = monthRange(month)
  const db = supabaseAdmin()
  const [units, tasks] = await Promise.all([
    loadUnits(),
    pageAll((a, b) => db.from('breezeway_tasks_sync')
      .select('id,name,type_department,status,reference_property_id,scheduled_date,finished_at,total_minutes,rate_paid')
      .gte('scheduled_date', from).lte('scheduled_date', to).order('id', { ascending: true }).range(a, b)),
  ])
  const umap: Record<string, Unit> = {}
  for (const u of units) umap[u.id] = u

  const acc: Record<string, any> = {}
  for (const t of tasks) {
    if (isDead(t)) continue
    const id = str(t.reference_property_id); if (!id) continue
    const u = umap[id]
    const dep = deptOf(t.type_department)
    const clean = dep === 'housekeeping' && isDepartureCleanName(t.name)
    const k = id
    const row = acc[k] || (acc[k] = {
      guesty_listing_id: id, unit: u ? u.name : id, building: u ? u.building : 'Unassigned',
      market: u ? u.market : 'unknown', month,
      departure_cleans_scheduled: 0, departure_cleans_completed: 0,
      other_housekeeping_tasks: 0, maintenance_tasks: 0, inspections: 0,
      clean_minutes: 0, breezeway_pay: 0,
    })
    if (clean) {
      row.departure_cleans_scheduled++
      if (isDone(t)) {
        row.departure_cleans_completed++
        row.clean_minutes += num(t.total_minutes)
        row.breezeway_pay += num(t.rate_paid)
      }
    } else if (dep === 'housekeeping') { if (isDone(t)) row.other_housekeeping_tasks++ }
    else if (dep === 'maintenance') { if (isDone(t)) row.maintenance_tasks++ }
    else if (dep === 'inspection') { if (isDone(t)) row.inspections++ }
  }

  const out: any[] = []
  for (const k of Object.keys(acc)) {
    const r = acc[k]
    r.clean_minutes = Math.round(r.clean_minutes)
    r.avg_clean_minutes = r.departure_cleans_completed ? Math.round(r.clean_minutes / r.departure_cleans_completed) : null
    if (opts.includeDollars) r.breezeway_pay = Math.round(r.breezeway_pay)
    else { delete r.breezeway_pay }
    out.push(r)
  }
  out.sort((a, b) => b.departure_cleans_completed - a.departure_cleans_completed)
  return out
}

/**
 * CLOCKED HOURS AND PAYROLL from Homebase, by market and department — the truth source for labour
 * on our side (feedback-labor-truth-source). Sent so his QuickBooks payroll has something to
 * reconcile against; per-person rows only if `includeNames` is on, which it is not by default.
 */
export async function feedLabor(month: string, opts: PartnerOut): Promise<any> {
  const { from, to } = monthRange(month)
  const { getCrew } = await import('@/lib/crew')
  const { timecardsRangeAudited } = await import('@/lib/labor-report')
  // LIVE PUNCHES, NOT THE CSV LEDGER (Jon, 2026-09-01: one source). This feed used to serve the
  // hand-uploaded labor_timesheets table — a month nobody uploaded read as "no data", and a month
  // somebody uploaded could disagree with every board in the app. It now serves the same audited
  // Homebase punches everything else reads, and refuses to serve a month with holes in it rather
  // than hand a partner an understated payroll.
  const [tcA, crew] = await Promise.all([
    timecardsRangeAudited(from, to).catch(() => null),
    getCrew().catch(() => null),
  ])
  if (!tcA) return { month, available: false, reason: 'Homebase read failed', rows: [] }
  if (!tcA.complete) return { month, available: false, reason: 'Homebase did not return every week (' + tcA.failedSpans.join(', ') + ') — retry shortly', rows: [] }
  const rows = tcA.cards.map(t => ({ employee: t.name, work_date: t.date, hours: t.hours, wage: t.wageRate, cost: t.laborCost }))
  if (!rows.length) return { month, available: false, reason: 'no punches recorded for this month', rows: [] }

  // A person's crew comes from the DECLARED roster, never from what they happened to be assigned
  // (feedback-labor-truth-source). Anyone nobody has placed is reported as `unrostered` with their
  // hours visible, rather than being quietly folded into a department and distorting his ratios.
  const acc: Record<string, any> = {}
  const people: Record<string, any> = {}
  let hours = 0, cost = 0, unrosteredHours = 0
  const unrosteredNames: Record<string, true> = {}
  for (const r of rows) {
    const name = str(r.employee)
    let dept = 'unrostered'
    if (crew) {
      const d = crew.deptOfDetailed(name, null, null)
      dept = d.source === 'unrostered' || d.source === 'inferred' ? 'unrostered' : String(d.dept)
    }
    const h = num(r.hours), c = num(r.cost)
    hours += h; cost += c
    if (dept === 'unrostered') { unrosteredHours += h; unrosteredNames[name] = true }
    const o = acc[dept] || (acc[dept] = { month, department: dept, hours: 0, payroll: 0, people: 0 })
    o.hours += h
    if (opts.includeDollars) o.payroll += c
    const pk = dept + '|' + name
    if (!people[pk]) { people[pk] = { dept, hours: 0, cost: 0, employee: name }; o.people++ }
    people[pk].hours += h; people[pk].cost += c
  }
  const groups: any[] = []
  for (const k of Object.keys(acc)) {
    const o = acc[k]
    o.hours = Math.round(o.hours * 10) / 10
    if (opts.includeDollars) o.payroll = Math.round(o.payroll); else delete o.payroll
    groups.push(o)
  }
  groups.sort((a, b) => b.hours - a.hours)

  const out: any = {
    month, available: true,
    source: 'Homebase timesheets — actual clocked hours, not scheduled',
    crew_basis: 'declared roster (Lighthouse /users → Crew & roles); anyone unplaced is reported as "unrostered" rather than guessed',
    total_hours: Math.round(hours * 10) / 10,
    unrostered_hours: Math.round(unrosteredHours * 10) / 10,
    unrostered_people: Object.keys(unrosteredNames).length,
    rows: groups,
  }
  if (opts.includeDollars) out.total_payroll = Math.round(cost)
  if (opts.includeNames) {
    const pr: any[] = []
    for (const k of Object.keys(people)) {
      const p = people[k]
      const rec: any = { employee: p.employee, department: p.dept, hours: Math.round(p.hours * 10) / 10 }
      if (opts.includeDollars) rec.payroll = Math.round(p.cost)
      pr.push(rec)
    }
    out.people = pr.sort((a, b) => b.hours - a.hours)
  }
  return out
}

/** Task mix + what was billed to owners — the maintenance side of his 5200 group. */
export async function feedTasks(month: string, opts: PartnerOut): Promise<any[]> {
  const { from, to } = monthRange(month)
  const db = supabaseAdmin()
  const [units, tasks] = await Promise.all([
    loadUnits(),
    pageAll((a, b) => db.from('breezeway_tasks_sync')
      .select('id,name,type_department,status,reference_property_id,scheduled_date,finished_at,total_minutes,rate_paid,costs')
      .gte('scheduled_date', from).lte('scheduled_date', to).order('id', { ascending: true }).range(a, b)),
  ])
  const umap: Record<string, Unit> = {}
  for (const u of units) umap[u.id] = u
  const acc: Record<string, any> = {}
  for (const t of tasks) {
    if (isDead(t)) continue
    const u = umap[str(t.reference_property_id)]
    const bld = u ? u.building : 'Unassigned'
    const dep = deptOf(t.type_department)
    const k = bld + '|' + dep
    const o = acc[k] || (acc[k] = { month, building: bld, market: u ? u.market : 'unknown', department: dep, scheduled: 0, completed: 0, minutes: 0, charged: 0, completed_with_no_charge: 0 })
    o.scheduled++
    if (isDone(t)) {
      o.completed++
      o.minutes += num(t.total_minutes)
      const charge = num(t.costs) || num(t.rate_paid)
      o.charged += charge
      if (dep === 'maintenance' && !(charge > 0)) o.completed_with_no_charge++
    }
  }
  const out: any[] = []
  for (const k of Object.keys(acc)) {
    const o = acc[k]
    o.minutes = Math.round(o.minutes)
    if (opts.includeDollars) o.charged = Math.round(o.charged); else delete o.charged
    out.push(o)
  }
  out.sort((a, b) => b.completed - a.completed)
  return out
}

/** Per-day rhythm: completed cleans, arrivals, departures — the shape behind a month's cost. */
export async function feedOpsDaily(month: string): Promise<any[]> {
  const { from, to } = monthRange(month)
  const db = supabaseAdmin()
  const [tasks, resv] = await Promise.all([
    pageAll((a, b) => db.from('breezeway_tasks_sync')
      .select('id,name,type_department,status,finished_at,scheduled_date')
      .gte('scheduled_date', from).lte('scheduled_date', to).order('id', { ascending: true }).range(a, b)),
    pageAll((a, b) => db.from('guesty_reservations')
      .select('id,check_in,check_out,status')
      .gte('check_out', from).lte('check_in', to).order('id', { ascending: true }).range(a, b)),
  ])
  const days: Record<string, any> = {}
  const dayOf = (d: string) => days[d] || (days[d] = { date: d, departure_cleans_completed: 0, housekeeping_tasks_completed: 0, arrivals: 0, departures: 0 })
  for (let t = new Date(from + 'T12:00:00Z'); t.toISOString().slice(0, 10) <= to; t.setUTCDate(t.getUTCDate() + 1)) dayOf(t.toISOString().slice(0, 10))
  for (const t of tasks) {
    if (isDead(t) || !isDone(t)) continue
    const d = d10(t.finished_at || t.scheduled_date); if (!days[d]) continue
    if (deptOf(t.type_department) !== 'housekeeping') continue
    if (isDepartureCleanName(t.name)) days[d].departure_cleans_completed++
    else days[d].housekeeping_tasks_completed++
  }
  for (const r of resv) {
    if (/cancel|declin|expir|denied|inquiry/i.test(str(r.status))) continue
    const ci = d10(r.check_in), co = d10(r.check_out)
    if (days[ci]) days[ci].arrivals++
    if (days[co]) days[co].departures++
  }
  const out: any[] = []
  for (const k of Object.keys(days)) out.push(days[k])
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

/** What we hold and how fresh it is — the mirror of the `status` feed we asked him for. */
export async function feedStatus(opts: PartnerOut): Promise<any> {
  const db = supabaseAdmin()
  const [sync, ts, units] = await Promise.all([
    db.from('guesty_sync_status').select('entity,last_sync_at').limit(50),
    db.from('labor_timesheets').select('work_date').order('work_date', { ascending: false }).limit(1),
    db.from('guesty_listings').select('id', { count: 'exact', head: true }),
  ])
  const feeds: Record<string, string | null> = {}
  for (const r of (sync.data || []) as any[]) feeds[str(r.entity)] = r.last_sync_at || null
  return {
    app: 'lighthouse',
    version: '1',
    units: (units as any).count == null ? null : (units as any).count,
    guesty_sync: feeds,
    labor_timesheets_through: ts.data && ts.data[0] ? str((ts.data[0] as any).work_date) : null,
    feeds_available: PARTNER_FEEDS.filter(f => opts.feeds[f]),
    includes_dollars: opts.includeDollars,
    includes_names: opts.includeNames,
    notes: 'Volumes are COMPLETED work, not scheduled. Hours are actual clocked hours from Homebase. Vendor-cleaned buildings are flagged so they are not blended into an in-house cost per clean.',
  }
}

/** Metadata-only audit row. Never blocks or fails the request. */
export async function logPartnerAccess(feed: string, params: any, rows: number, ms: number, status: number, ip: string | null) {
  try {
    await supabaseAdmin().from('partner_access_log').insert({
      partner: 'revenue_app', feed, params: params || {}, rows, ms, status, ip: ip || null,
    })
  } catch { /* logging never blocks a read */ }
}

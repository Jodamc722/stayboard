// BILLABLE HOURS — the money math for /billing (Money → Billable Hours).
//
// Source of truth for WHAT WORK HAPPENED is the Breezeway mirror (breezeway_tasks_sync):
// department, assignee, actual time on task (total_minutes, from the crew's Start/Complete taps),
// the rate on the task (rate_paid) and when it was scheduled/finished. The billing payload the
// list mirror does not carry — costs[], supplies[], bill_to, rate_type — comes from
// breezeway_billing_details (per-task retrieve, see /api/billing/detail). Our own review overlay
// (exclusions, notes, overrides, extra line items) lives in billing_adjustments and NEVER goes to
// Breezeway — their API can't edit cost/supply line items, so the overlay is merged at read time
// and into exports instead.
//
// "Billing owner" = the unit's statement owner from guesty_owners (listing_ids), the same map the
// owner statements/audit use — so a task bills to the person who gets the statement. bill_to on
// the Breezeway side ('owner' | 'guest') flags WHETHER a line is owner-billable.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

// key identifies a line item across pulls ('cost:<breezewayId>' / 'supply:<id>' / 'extra:<idx>').
// originalAmount is set when OUR override replaced the Breezeway amount (the override wins in
// totals + exports; the original stays visible for the audit trail).
export type BillingLineItem = { key: string; description: string; amount: number; originalAmount: number | null; bill_to: string | null; kind: 'cost' | 'supply' | 'extra' }

export type BillingTask = {
  id: string
  listingId: string | null
  unit: string
  building: string | null
  ownerId: string | null
  ownerName: string
  department: string
  name: string
  description: string | null
  status: string
  assignees: { id: number | null; name: string | null }[]
  finishedBy: string | null
  scheduledDate: string | null
  finishedAt: string | null
  actualMinutes: number | null
  ratePaid: number | null
  rateType: string | null          // 'hourly' | 'piece' | null (unknown until detail pull)
  billTo: string | null            // task-level bill_to
  items: BillingLineItem[]         // costs + billable supplies + our extra items
  hasDetail: boolean               // billing detail pulled for this task?
  detailSyncedAt: string | null
  // Our overlay
  excluded: boolean
  note: string | null
  overrideAmount: number | null
  billedHours: number | null
  // Computed
  laborAmount: number              // rate math only (before items/override)
  billedAmount: number             // what the owner is billed for this task (0 when excluded)
  reportUrl: string | null
}

export type OwnerGroup = {
  ownerId: string | null
  ownerName: string
  units: number
  tasks: number
  billed: number
  labor: number
  items: number
  actualMinutes: number
}

const num = (v: any): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function monthRange(month: string): { from: string; to: string } {
  // month = 'YYYY-MM' (ET calendar month; scheduled_date/finished dates are date strings already)
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!m) {
    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    return monthRange(now.slice(0, 7))
  }
  const y = Number(m[1]); const mo = Number(m[2])
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` }
}

// Paginated select — the PostgREST 1000-row cap silently truncates a naive select.
async function pageAll(build: (a: number, b: number) => any, cap = 12000): Promise<any[]> {
  const out: any[] = []
  const page = 1000
  for (let a = 0; a < cap; a += page) {
    const { data, error } = await build(a, a + page - 1)
    if (error) throw new Error(error.message)
    const arr = (data || []) as any[]
    out.push(...arr)
    if (arr.length < page) break
  }
  return out
}

// descr is the one raw->> scalar we pull (a single jsonb ->> extraction — never whole raw over
// thousands of rows). It feeds the editable description on the billing row.
const MIRROR_COLS = 'id, home_id, reference_property_id, type_department, name, status, assignees, assignee_name, finished_by_name, finished_at, total_minutes, rate_paid, scheduled_date, report_url, descr:raw->>description'

/** All mirror tasks that belong to a month: scheduled in it, or (undated) finished in it. */
export async function monthTasks(month: string): Promise<any[]> {
  const db = supabaseAdmin()
  const { from, to } = monthRange(month)
  const scheduled = await pageAll((a, b) => db.from('breezeway_tasks_sync')
    .select(MIRROR_COLS)
    .gte('scheduled_date', from).lte('scheduled_date', to)
    .order('id').range(a, b))
  const undated = await pageAll((a, b) => db.from('breezeway_tasks_sync')
    .select(MIRROR_COLS)
    .is('scheduled_date', null)
    .gte('finished_at', from + 'T00:00:00').lte('finished_at', to + 'T23:59:59')
    .order('id').range(a, b))
  const seen: Record<string, boolean> = {}
  const out: any[] = []
  for (const t of scheduled.concat(undated)) {
    const id = String(t.id || '')
    if (!id || seen[id]) continue
    seen[id] = true
    out.push(t)
  }
  return out
}

export type OwnerMap = { byListing: Record<string, { ownerId: string; ownerName: string }> }

export async function ownerMap(): Promise<OwnerMap> {
  const db = supabaseAdmin()
  const byListing: Record<string, { ownerId: string; ownerName: string }> = {}
  try {
    const { data } = await db.from('guesty_owners').select('id, full_name, listing_ids').limit(2000)
    for (const o of (data || []) as any[]) {
      const ids = Array.isArray(o.listing_ids) ? o.listing_ids : []
      for (const lid of ids) {
        const k = String(lid || '')
        if (k && !byListing[k]) byListing[k] = { ownerId: String(o.id), ownerName: String(o.full_name || 'Owner ' + o.id) }
      }
    }
  } catch { /* fail-open: everything groups under Unassigned */ }
  return { byListing }
}

export async function listingNames(ids: string[]): Promise<Record<string, { unit: string; building: string | null }>> {
  const db = supabaseAdmin()
  const out: Record<string, { unit: string; building: string | null }> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    if (!chunk.length) break
    try {
      const { data } = await db.from('guesty_listings').select('id, nickname, title, building').in('id', chunk)
      for (const l of (data || []) as any[]) {
        out[String(l.id)] = { unit: String(l.nickname || l.title || l.id), building: l.building ? String(l.building) : null }
      }
    } catch { /* names fall back to the raw id */ }
  }
  return out
}

function detailItems(costs: any, supplies: any, extras: any, overrides: any): BillingLineItem[] {
  const ov: Record<string, any> = overrides && typeof overrides === 'object' ? overrides : {}
  const items: BillingLineItem[] = []
  const push = (key: string, description: string, amount: number, bill_to: string | null, kind: 'cost' | 'supply' | 'extra') => {
    const o = num(ov[key])
    const adjusted = kind !== 'extra' && o != null && o !== amount
    items.push({ key, description, amount: adjusted ? (o as number) : amount, originalAmount: adjusted ? amount : null, bill_to, kind })
  }
  const cArr = Array.isArray(costs) ? costs : []
  for (let i = 0; i < cArr.length; i++) {
    const c = cArr[i]
    const amt = num(c?.cost)
    if (amt == null) continue
    push('cost:' + (c?.id ?? i), String(c?.description || (c?.type_cost && c.type_cost.name) || 'Cost'), amt, c?.bill_to ? String(c.bill_to) : null, 'cost')
  }
  const sArr = Array.isArray(supplies) ? supplies : []
  for (let i = 0; i < sArr.length; i++) {
    const s = sArr[i]
    const amt = num(s?.total_price != null ? s.total_price : s?.unit_cost)
    if (amt == null) continue
    if (s?.billable === false) continue
    push('supply:' + (s?.id ?? i), String(s?.name || s?.description || 'Supply') + (s?.quantity && Number(s.quantity) > 1 ? ' ×' + Number(s.quantity) : ''), amt, s?.bill_to ? String(s.bill_to) : null, 'supply')
  }
  const eArr = Array.isArray(extras) ? extras : []
  for (let i = 0; i < eArr.length; i++) {
    const e = eArr[i]
    const amt = num(e?.amount)
    if (amt == null) continue
    push('extra:' + i, String(e?.description || 'Adjustment'), amt, e?.bill_to ? String(e.bill_to) : 'owner', 'extra')
  }
  return items
}

/** The rate side of the bill: hourly rate × hours, or the flat piece rate. */
export function laborAmount(ratePaid: number | null, rateType: string | null, actualMinutes: number | null, billedHours: number | null): number {
  const rate = ratePaid == null ? 0 : ratePaid
  if (!rate) return 0
  if (String(rateType || '').toLowerCase() === 'hourly') {
    const hours = billedHours != null ? billedHours : (actualMinutes != null ? actualMinutes / 60 : 0)
    return Math.round(rate * hours * 100) / 100
  }
  return rate // 'piece' (Breezeway's default) — the rate IS the price of the job
}

// ── Building-level (exterior/common-area) owner attribution ─────────────────
// Breezeway carries building properties with no Guesty listing — "Eden Exterior", "Rustic
// Exterior", trash/common-area routes. Jon: those belong to the BUILDING's owner (Rustic
// exterior → Rustic's owner, Eden exterior → Eden's owner). We resolve the Breezeway property
// NAME via home_id, parse the building token out of it, and assign the owner who owns that
// building's units — only when one owner clearly dominates the building (≥60% of its owned
// units), so a shared building can never quietly misbill.
type TokenOwner = Record<string, { ownerId: string; ownerName: string }>

async function buildingOwnerTokens(owners: OwnerMap): Promise<TokenOwner> {
  const db = supabaseAdmin()
  const tally: Record<string, Record<string, number>> = {}
  try {
    const { data } = await db.from('guesty_listings').select('id, building, nickname').limit(1000)
    for (const l of (data || []) as any[]) {
      const own = owners.byListing[String(l.id)]
      if (!own) continue
      const tokens: string[] = []
      if (l.building) tokens.push(String(l.building))
      const first = String(l.nickname || '').trim().split(/\s+/)[0]
      if (first) tokens.push(first)
      for (const raw of tokens) {
        const tok = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (tok.length < 3 || /^\d+$/.test(tok)) continue
        if (!tally[tok]) tally[tok] = {}
        tally[tok][own.ownerId] = (tally[tok][own.ownerId] || 0) + 1
      }
    }
  } catch { /* attribution just stays off */ }
  const out: TokenOwner = {}
  for (const tok of Object.keys(tally)) {
    const counts = tally[tok]
    const ids = Object.keys(counts)
    let total = 0; let best = ''; let bestN = 0
    for (const id of ids) { total += counts[id]; if (counts[id] > bestN) { bestN = counts[id]; best = id } }
    if (best && total > 0 && bestN / total >= 0.6) {
      const name = ownerNameFor(owners, best)
      if (name) out[tok] = { ownerId: best, ownerName: name }
    }
  }
  return out
}
function ownerNameFor(owners: OwnerMap, ownerId: string): string | null {
  const keys = Object.keys(owners.byListing)
  for (const k of keys) if (owners.byListing[k].ownerId === ownerId) return owners.byListing[k].ownerName
  return null
}
/** Match a building property name ("Eden Exterior") to a building token owner. Longest token wins. */
function ownerFromName(name: string, tokens: TokenOwner): { ownerId: string; ownerName: string } | null {
  const hay = ' ' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' '
  let hit: { ownerId: string; ownerName: string } | null = null
  let hitLen = 0
  for (const tok of Object.keys(tokens)) {
    if (tok.length > hitLen && hay.indexOf(' ' + tok + ' ') >= 0) { hit = tokens[tok]; hitLen = tok.length }
  }
  return hit
}

/** Assemble the month's billing view: mirror ⋈ details ⋈ adjustments ⋈ owners ⋈ listing names. */
export async function billingMonth(month: string): Promise<{ tasks: BillingTask[]; owners: OwnerGroup[]; missingDetail: number }> {
  const db = supabaseAdmin()
  const [raw, owners] = await Promise.all([monthTasks(month), ownerMap()])
  const ids = raw.map(t => String(t.id))
  const details: Record<string, any> = {}
  const adjs: Record<string, any> = {}
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400)
    if (!chunk.length) break
    try {
      const { data } = await db.from('breezeway_billing_details').select('task_id, bill_to, rate_type, costs, supplies, synced_at').in('task_id', chunk)
      for (const d of (data || []) as any[]) details[String(d.task_id)] = d
    } catch { /* detail-less rows still render */ }
    try {
      const { data } = await db.from('billing_adjustments').select('*').in('task_id', chunk)
      for (const a of (data || []) as any[]) adjs[String(a.task_id)] = a
    } catch { /* overlay optional */ }
  }
  const listingIds: string[] = []
  const seenL: Record<string, boolean> = {}
  for (const t of raw) {
    const lid = String(t.reference_property_id || '')
    if (lid && !seenL[lid]) { seenL[lid] = true; listingIds.push(lid) }
  }
  const names = await listingNames(listingIds)

  // Building/exterior tasks: no Guesty listing (or one no owner claims) — resolve the Breezeway
  // property name via home_id and prepare building→owner tokens so "Eden Exterior" bills Eden's
  // owner and "Rustic Exterior" bills Rustic's.
  const orphanHomes: number[] = []
  const seenH: Record<string, boolean> = {}
  for (const t of raw) {
    const lid = String(t.reference_property_id || '')
    const hid = Number(t.home_id)
    if ((!lid || !owners.byListing[lid]) && Number.isFinite(hid) && !seenH[String(hid)]) { seenH[String(hid)] = true; orphanHomes.push(hid) }
  }
  const propName: Record<string, { name: string; ref: string | null }> = {}
  for (let i = 0; i < orphanHomes.length; i += 200) {
    const chunk = orphanHomes.slice(i, i + 200)
    if (!chunk.length) break
    try {
      const { data } = await db.from('breezeway_properties').select('home_id, name, reference_property_id').in('home_id', chunk)
      for (const p of (data || []) as any[]) propName[String(p.home_id)] = { name: String(p.name || ''), ref: p.reference_property_id ? String(p.reference_property_id) : null }
    } catch { /* those tasks just stay unattributed */ }
  }
  const tokens = orphanHomes.length ? await buildingOwnerTokens(owners) : {}

  const tasks: BillingTask[] = raw.map(t => {
    const id = String(t.id)
    const lid = String(t.reference_property_id || '') || null
    const d = details[id] || null
    const a = adjs[id] || null
    const hid = t.home_id != null ? String(t.home_id) : ''
    const prop = hid ? propName[hid] : undefined
    let own = lid ? owners.byListing[lid] : undefined
    if (!own && prop && prop.ref) own = owners.byListing[prop.ref]
    if (!own && prop && prop.name) { const hit = ownerFromName(prop.name, tokens); if (hit) own = hit }
    const items = detailItems(d && d.costs, d && d.supplies, a && a.extra_items, a && a.item_overrides)
    const ratePaid = num(t.rate_paid)
    const rateType = d && d.rate_type ? String(d.rate_type) : null
    const billedHours = a && a.billed_hours != null ? Number(a.billed_hours) : null
    const labor = laborAmount(ratePaid, rateType, t.total_minutes != null ? Number(t.total_minutes) : null, billedHours)
    const itemsTotal = items.reduce((s, x) => s + (String(x.bill_to || 'owner') === 'guest' ? 0 : x.amount), 0)
    const excluded = !!(a && a.excluded)
    const override = a && a.override_amount != null ? Number(a.override_amount) : null
    const billed = excluded ? 0 : (override != null ? override : Math.round((labor + itemsTotal) * 100) / 100)
    return {
      id, listingId: lid,
      unit: lid && names[lid] ? names[lid].unit : (prop && prop.name ? prop.name : (lid || '—')),
      building: lid ? ((names[lid] && names[lid].building) || null) : null,
      ownerId: own ? own.ownerId : null,
      ownerName: own ? own.ownerName : 'Unassigned owner',
      department: String(t.type_department || 'other'),
      name: String(t.name || 'Task ' + id),
      description: t.descr ? String(t.descr) : null,
      status: String(t.status || ''),
      assignees: Array.isArray(t.assignees) ? t.assignees : (t.assignee_name ? [{ id: null, name: String(t.assignee_name) }] : []),
      finishedBy: t.finished_by_name ? String(t.finished_by_name) : null,
      scheduledDate: t.scheduled_date ? String(t.scheduled_date).slice(0, 10) : null,
      finishedAt: t.finished_at ? String(t.finished_at) : null,
      actualMinutes: t.total_minutes != null ? Number(t.total_minutes) : null,
      ratePaid, rateType,
      billTo: d && d.bill_to ? String(d.bill_to) : null,
      items,
      hasDetail: !!d,
      detailSyncedAt: d && d.synced_at ? String(d.synced_at) : null,
      excluded,
      note: a && a.note ? String(a.note) : null,
      overrideAmount: override,
      billedHours,
      laborAmount: labor,
      billedAmount: billed,
      reportUrl: t.report_url ? String(t.report_url) : null,
    }
  })

  const groups: Record<string, OwnerGroup> = {}
  const unitsSeen: Record<string, Record<string, boolean>> = {}
  for (const t of tasks) {
    const k = t.ownerId || '—'
    if (!groups[k]) { groups[k] = { ownerId: t.ownerId, ownerName: t.ownerName, units: 0, tasks: 0, billed: 0, labor: 0, items: 0, actualMinutes: 0 }; unitsSeen[k] = {} }
    const g = groups[k]
    g.tasks += 1
    g.billed = Math.round((g.billed + t.billedAmount) * 100) / 100
    if (!t.excluded) {
      g.labor = Math.round((g.labor + t.laborAmount) * 100) / 100
      g.items = Math.round((g.items + t.items.reduce((s, x) => s + (String(x.bill_to || 'owner') === 'guest' ? 0 : x.amount), 0)) * 100) / 100
    }
    g.actualMinutes += t.actualMinutes || 0
    const lid = t.listingId || '—'
    if (!unitsSeen[k][lid]) { unitsSeen[k][lid] = true; g.units += 1 }
  }
  const ownerGroups = Object.keys(groups).map(k => groups[k]).sort((x, y) => y.billed - x.billed)
  const missingDetail = tasks.filter(t => !t.hasDetail).length
  return { tasks, owners: ownerGroups, missingDetail }
}

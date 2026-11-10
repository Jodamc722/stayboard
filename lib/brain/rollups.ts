// owner_month and vendor_month — the two thin roll-ups (migration 178).
//
// BOTH ARE MARKED partial = true IN v1, ON PURPOSE. They add up what the brain already holds
// (fact_unit_day, fact_maintenance_event) and nothing more:
//   owner_month   nights, occupancy, net / gross accommodation, cleaning, refunds, guest issues,
//                 repeat failures, upkeep BILLED to the owner's units, review average, and the
//                 management fee when the Revenue App mirror carries the unit-month.
//                 NOT YET: labour cost on their units, claims recovered, statement lines, owner
//                 terms — so there is no margin and no churn-risk figure here, and none is implied.
//   vendor_month  a vendor's JOBS in the month (2026-11-10, lib/brain/vendors):
//                   • maintenance events carrying the vendor — picked on the glitch / work order, or
//                     a Breezeway task whose assignee is the vendor's crew (vendor_xref, unconfirmed
//                     matches included)
//                   • project vendor jobs (project_steps.vendor_key), by visit day; a step pushed to
//                     Breezeway that is already an event is not counted twice
//                   • DEPARTURE CLEANS in vendor-cleaned buildings (lib/ops-presets vendorBuildings:
//                     Park Towers → Probol, Capri / Lucerne / Amrit → Opal Works, Botanica → Garden),
//                     one job per check-out day in fact_unit_day; closed = the clean was finished
//                 how many closed, median hours to close (maintenance and project jobs — a clean has
//                 no open time), repeat visits, billed lines, and INVOICES: project_invoices (not void
//                 / quoted) plus cleaning-vendor invoices from app_settings (lib/clean-invoices; not
//                 disputed), by invoice date.
//                 NOT YET: reviews in vendor-cleaned buildings.
//
// owner_month counts AVAILABLE NIGHTS per sellable part: a whole-unit "Full" listing adds no
// available nights of its own (its halves already do), and a night it is sold counts as occupied
// once per half it takes offline — so a 4BR sold whole reads 100%, not 33%.
//
// A unit's owner is the CURRENT statement owner (guesty_owners.listing_ids has no dates), so a unit
// that changed hands carries its whole history under today's owner.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import type { DimUnit } from './spine'
import { loadVendorMap } from './vendors'
import { str, num, numOrNull, todayET, addDays, round2, median, pageRead, upsertBatches, type BuildResult } from './shared'

/** The last `n` months as yyyy-MM, newest first, ending with the current Eastern month. */
export function recentMonths(n: number): string[] {
  const out: string[] = []
  let y = Number(todayET().slice(0, 4)), m = Number(todayET().slice(5, 7))
  for (let i = 0; i < Math.max(1, n); i++) {
    out.push(y + '-' + (m < 10 ? '0' + m : String(m)))
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
  }
  return out
}
function monthEdges(month: string): { from: string; next: string } {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7))
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
  return { from: month + '-01', next: ny + '-' + (nm < 10 ? '0' + nm : String(nm)) + '-01' }
}

type OwnerAcc = {
  listings: Record<string, boolean>
  avail: number; occ: number; own: number
  net: number; gross: number; clean: number; refunds: number; glitches: number; billed: number
  events: number; repeats: number; ratingSum: number; ratingN: number
  fee: number; feeN: number
}

export async function buildOwnerMonths(months: string[], byId: Record<string, DimUnit>, deadline: number): Promise<BuildResult> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const today = todayET()
  let written = 0, shortRead = false, stopped = false
  let error: string | undefined

  const ownerName: Record<string, string> = {}
  try {
    const { rows } = await pageRows<any>((a, b) => db.from('guesty_owners').select('id,full_name').order('id').range(a, b), 3)
    for (const o of rows) ownerName[str(o.id)] = str(o.full_name)
  } catch { /* names stay blank */ }

  // Halves per whole-unit listing: a parent's sold night stands for each half it takes offline.
  const kids: Record<string, number> = {}
  for (const id of Object.keys(byId)) { const p = byId[id].parent_listing_id; if (p) kids[p] = (kids[p] || 0) + 1 }

  for (const month of months) {
    if (Date.now() > deadline) { stopped = true; break }
    const { from, next } = monthEdges(month)
    const lastDayExcl = next < addDays(today, 1) ? next : addDays(today, 1)    // never count nights that have not happened
    const acc: Record<string, OwnerAcc> = {}
    const slot = (ownerId: string): OwnerAcc => (acc[ownerId] = acc[ownerId] || {
      listings: {}, avail: 0, occ: 0, own: 0, net: 0, gross: 0, clean: 0, refunds: 0, glitches: 0, billed: 0,
      events: 0, repeats: 0, ratingSum: 0, ratingN: 0, fee: 0, feeN: 0,
    })

    const ud = await pageRows<any>((a, b) => db.from('fact_unit_day')
      .select('day,listing_id,owner_id,state,net_accom,gross_accom,cleaning_rev,refunds,glitches_opened,maint_cost_billed')
      .gte('day', from).lt('day', lastDayExcl).not('owner_id', 'is', null)
      .order('day').order('listing_id').range(a, b), 14)
    if (ud.truncated) shortRead = true
    for (const r of ud.rows) {
      const a = slot(str(r.owner_id))
      const lid = str(r.listing_id)
      const u = byId[lid]
      const parent = !!u && u.is_parent
      const weight = parent ? Math.max(1, kids[lid] || 0) : 1
      if (!parent) { a.listings[lid] = true; a.avail += 1 }
      if (str(r.state) === 'occupied') a.occ += weight
      else if (str(r.state) === 'owner_stay') a.own += weight
      a.net += num(r.net_accom); a.gross += num(r.gross_accom); a.clean += num(r.cleaning_rev)
      a.refunds += num(r.refunds); a.glitches += num(r.glitches_opened); a.billed += num(r.maint_cost_billed)
    }
    if (!Object.keys(acc).length) continue

    const ev = await pageRows<any>((a, b) => db.from('fact_maintenance_event').select('event_id,listing_id,is_repeat')
      .gte('opened_at', from + 'T00:00:00Z').lt('opened_at', next + 'T00:00:00Z').not('listing_id', 'is', null)
      .order('opened_at').order('event_id').range(a, b), 6)
    if (ev.truncated) shortRead = true
    for (const e of ev.rows) {
      const u = byId[str(e.listing_id)]
      if (!u || !u.owner_id || !acc[u.owner_id]) continue
      acc[u.owner_id].events += 1
      if (e.is_repeat === true) acc[u.owner_id].repeats += 1
    }

    try {
      const rv = await pageRows<any>((a, b) => db.from('guesty_reviews').select('id,listing_id,rating')
        .gte('created_at', from + 'T00:00:00Z').lt('created_at', next + 'T00:00:00Z')
        .order('created_at').order('id').range(a, b), 4)
      if (rv.truncated) shortRead = true
      for (const r of rv.rows) {
        const u = byId[str(r.listing_id)]
        const rating = numOrNull(r.rating)
        if (!u || !u.owner_id || !acc[u.owner_id] || rating == null) continue
        acc[u.owner_id].ratingSum += rating; acc[u.owner_id].ratingN += 1
      }
    } catch { shortRead = true }

    // Management fee: only when the Revenue App mirror carries this unit-month (closed month first).
    try {
      const { data } = await db.from('rev_unit_month').select('guesty_listing_id,kind,mgmt_fee')
        .eq('month', month).in('kind', ['eom', 'live']).limit(1000) // deliberate cap: one row per unit per kind (~600)
      const best: Record<string, { kind: string; fee: number }> = {}
      for (const r of ((data || []) as any[])) {
        const fee = numOrNull(r.mgmt_fee); const lid = str(r.guesty_listing_id)
        if (fee == null || !lid) continue
        if (!best[lid] || (best[lid].kind !== 'eom' && str(r.kind) === 'eom')) best[lid] = { kind: str(r.kind), fee }
      }
      for (const lid of Object.keys(best)) {
        const u = byId[lid]
        if (!u || !u.owner_id || !acc[u.owner_id]) continue
        acc[u.owner_id].fee += best[lid].fee; acc[u.owner_id].feeN += 1
      }
    } catch { /* the mirror is optional */ }

    const rows: Record<string, any>[] = Object.keys(acc).map(ownerId => {
      const a = acc[ownerId]
      const sellable = a.avail - a.own
      return {
        month, owner_id: ownerId, owner_name: ownerName[ownerId] || null,
        units: Object.keys(a.listings).length,
        available_nights: a.avail, occupied_nights: a.occ, owner_nights: a.own,
        occupancy: sellable > 0 ? round2((a.occ / sellable) * 100) : null,
        net_accom: round2(a.net), gross_accom: round2(a.gross), cleaning_rev: round2(a.clean),
        revpar: a.avail > 0 ? round2(a.net / a.avail) : null,
        mgmt_fee: a.feeN > 0 ? round2(a.fee) : null,
        billed_owner: round2(a.billed), refunds: round2(a.refunds),
        glitches: Math.round(a.glitches), repeat_events: a.repeats, maint_events: a.events,
        review_avg: a.ratingN ? round2(a.ratingSum / a.ratingN) : null, review_n: a.ratingN,
        built_at: now, partial: true,
      }
    })
    const w = await upsertBatches('owner_month', rows, 'month,owner_id', { deadline })
    written += w.written
    if (w.error) { error = w.error; break }
    if (w.stoppedEarly) { stopped = true; break }
  }
  return {
    rows: written, partial: true, ...(error ? { error } : {}),
    note: 'thin by design in v1 (no labour cost, claims or statement lines)' + (shortRead ? '; a read came back short' : '') + (stopped ? '; stopped at the time limit' : ''),
  }
}

export async function buildVendorMonths(months: string[], byId: Record<string, DimUnit>, deadline: number): Promise<BuildResult> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  if (!months.length) return { rows: 0, partial: true }
  const sorted = months.slice().sort()
  const oldest = sorted[0]
  const fromIso = oldest + '-01T00:00:00Z'
  const lastNext = monthEdges(sorted[sorted.length - 1]).next
  const want: Record<string, boolean> = {}
  for (const m of months) want[m] = true
  let shortRead = false
  const counts = { events: 0, steps: 0, cleans: 0, projInv: 0, cleanInv: 0, cleanInvUnmatched: 0 }

  const vmap = await loadVendorMap()
  if (vmap.partial) shortRead = true

  type V = { jobs: number; closed: number; hours: number[]; repeats: number; billed: number; inv: number; invN: number }
  const acc: Record<string, V> = {}
  const slot = (month: string, key: string): V => (acc[month + '|' + key] = acc[month + '|' + key] || { jobs: 0, closed: 0, hours: [], repeats: 0, billed: 0, inv: 0, invN: 0 })

  // 1. Maintenance events carrying a vendor.
  const evTasks: Record<string, boolean> = {}               // vendor|bz task id already counted
  const ev = await pageRead<any>((a, b) => db.from('fact_maintenance_event')
    .select('event_id,vendor_key,bz_task_id,opened_at,closed_at,hours_to_close,is_repeat,billed_owner')
    .not('vendor_key', 'is', null).gte('opened_at', fromIso)
    .order('opened_at').order('event_id').range(a, b), 8)
  if (ev.truncated) shortRead = true
  for (const e of ev.rows) {
    const month = str(e.opened_at).slice(0, 7), key = str(e.vendor_key)
    if (!key || !want[month]) continue
    const v = slot(month, key)
    v.jobs += 1; counts.events++
    if (e.closed_at) v.closed += 1
    const h = numOrNull(e.hours_to_close)
    if (h != null) v.hours.push(h)
    if (e.is_repeat === true) v.repeats += 1
    v.billed += num(e.billed_owner)
    if (e.bz_task_id) evTasks[key + '|' + str(e.bz_task_id)] = true
  }

  // 2. Project vendor jobs (migration 088), by the day the vendor comes out.
  {
    const st = await pageRead<any>((a, b) => db.from('project_steps')
      .select('id,vendor_key,visit_on,due_on,status,done,done_at,created_at,breezeway_task_id')
      .not('vendor_key', 'is', null).gte('created_at', addDays(oldest + '-01', -120) + 'T00:00:00Z')
      .order('created_at').order('id').range(a, b), 5)
    if (st.truncated) shortRead = true
    for (const r of st.rows) {
      const key = str(r.vendor_key)
      if (!key || (r.breezeway_task_id && evTasks[key + '|' + str(r.breezeway_task_id)])) continue
      const month = (str(r.visit_on) || str(r.due_on) || str(r.created_at)).slice(0, 7)
      if (!want[month]) continue
      const v = slot(month, key)
      v.jobs += 1; counts.steps++
      const done = r.done === true || /done/i.test(str(r.status))
      if (done) {
        v.closed += 1
        const a = Date.parse(str(r.created_at)), b = Date.parse(str(r.done_at))
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a) v.hours.push(Math.round((b - a) / 360_000) / 10)
      }
    }
  }

  // 3. Departure cleans in vendor-cleaned buildings — one job per check-out day.
  {
    const cleanerOf: Record<string, string> = {}
    for (const id of Object.keys(byId)) {
      const u = byId[id]
      if (!u.vendor_cleaned) continue
      const key = vmap.cleanerOf(str(u.nickname) + ' ' + str(u.building_id).replace(/-/g, ' '))
      if (key) cleanerOf[id] = key
    }
    const ids = Object.keys(cleanerOf)
    for (let i = 0; i < ids.length && Date.now() < deadline; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const cd = await pageRead<any>((a, b) => db.from('fact_unit_day').select('day,listing_id,clean_late')
        .eq('is_departure', true).in('listing_id', chunk).gte('day', oldest + '-01').lt('day', lastNext)
        .order('day').order('listing_id').range(a, b), 20)
      if (cd.truncated) shortRead = true
      for (const r of cd.rows) {
        const month = str(r.day).slice(0, 7), key = cleanerOf[str(r.listing_id)]
        if (!key || !want[month]) continue
        const v = slot(month, key)
        v.jobs += 1; counts.cleans++
        if (r.clean_late != null) v.closed += 1
      }
    }
  }

  // 4. Invoices: project invoices, then cleaning-vendor invoices.
  {
    const inv = await pageRead<any>((a, b) => db.from('project_invoices').select('id,vendor_key,amount_cents,status,issued_on,created_at')
      .not('vendor_key', 'is', null).gte('created_at', addDays(oldest + '-01', -62) + 'T00:00:00Z')
      .order('created_at').order('id').range(a, b), 5)
    if (inv.truncated) shortRead = true
    for (const i of inv.rows) {
      if (/void|quoted/i.test(str(i.status))) continue
      const month = (str(i.issued_on) || str(i.created_at)).slice(0, 7), key = str(i.vendor_key)
      if (!key || !want[month]) continue
      const v = slot(month, key)
      v.inv += num(i.amount_cents) / 100; v.invN += 1; counts.projInv++
    }
  }
  try {
    const { listInvoices } = await import('@/lib/clean-invoices')
    for (const r of await listInvoices()) {
      if (r.status === 'disputed' || r.total == null) continue
      const month = (str(r.invoiceDate) || str(r.periodTo) || str(r.uploadedAt)).slice(0, 7)
      if (!want[month]) continue
      const key = vmap.keyForName(r.vendor)
      if (!key) { counts.cleanInvUnmatched++; continue }
      const v = slot(month, key)
      v.inv += num(r.total); v.invN += 1; counts.cleanInv++
    }
  } catch { shortRead = true }

  const rows: Record<string, any>[] = Object.keys(acc).map(k => {
    const cut = k.indexOf('|')
    const month = k.slice(0, cut), key = k.slice(cut + 1)
    const v = acc[k]
    const med = median(v.hours)
    return {
      month, vendor_key: key, vendor_label: vmap.label[key] || null,
      jobs: v.jobs, jobs_closed: v.closed,
      median_hours_to_close: med == null ? null : round2(med),
      repeat_visits: v.repeats, billed_owner: round2(v.billed),
      invoices_total: v.invN ? round2(v.inv) : null, invoices_n: v.invN,
      built_at: now, partial: true,
    }
  })
  const w = await upsertBatches('vendor_month', rows, 'month,vendor_key', { deadline })
  return {
    rows: w.written, partial: true, ...(w.error ? { error: w.error } : {}),
    note: counts.events + ' maintenance job(s), ' + counts.steps + ' project job(s), ' + counts.cleans + ' departure clean(s); '
      + counts.projInv + ' project + ' + counts.cleanInv + ' cleaning invoice(s)'
      + (counts.cleanInvUnmatched ? ' (' + counts.cleanInvUnmatched + ' cleaning invoice(s) name no known vendor)' : '')
      + '; vendor matches by name are unconfirmed' + (shortRead ? '; a read came back short' : ''),
  }
}

// fact_unit_day — one row per listing per night (migration 178).
//
// THE DEFINITIONS, stated once (they are the ones Revenue Center uses — lib/basis):
//   • a stay counts when its status is in LIVE_STAY_STATUSES (confirmed / checked in / checked out)
//   • a stay holds the nights check-in ≤ day < check-out; the row for `day` is the night that starts
//     on it
//   • money is the stay's own money spread evenly over its nights:
//       gross_accom = raw.money.fareAccommodationAdjusted ÷ nights
//       channel_fee = channelFeeOf(hostServiceFeeIncTax, hostServiceFee) ÷ nights   (THE ONE NET)
//       net_accom   = gross_accom − channel_fee
//     `money_total` is never used: it is a payout figure with four possible meanings.
//   • cleaning_rev sits on the CHECK-OUT day (the day the clean is earned), not spread over nights
//   • owner_stay = the shared owner / friends-and-family test (lib/owner-audit) — inventory
//     decisions, kept apart from guest nights
//   • the day's departure clean is the Breezeway task that says it is one (lib/breezeway
//     isDepartureCleanName), scheduled that day; late = finished at/after 4pm Eastern or on a later day
//
// NOT IN v1: 'blocked' nights (the Guesty calendar is not stored, so a blocked night reads vacant)
// and days a listing was not active (before active_from / after active_to — not written at all).
//
// RECONCILED WITH REVENUE CENTER (2026-11-10, /api/brain/reconcile). Four things made a month here
// differ from the same month on Revenue Center, and all four now follow the page (lib/brain/rc-rules):
//   • accommodation falls back to fareAccommodation when fareAccommodationAdjusted is missing / 0
//   • the Expedia cleaning split — computed per WINDOW, so the builder runs in calendar months
//     (lib/brain/run) and a month here uses the same modal fee as that month on the page
//   • two live stays on one night: both stays' money is kept on the night (the first stay read
//     keeps the reservation id). Revenue Center counts the night twice; one row cannot, so the
//     nights differ by exactly the double-booked nights, which the reconcile lists by name
//   • per-night money is kept to 4 decimal places, so a month adds back to the stays to the cent
// What still differs, by design: Revenue Center leaves out stays on dead listings and on "Full"
// whole-unit listings; the brain keeps every listing (the money is real) and the reconcile reports
// that part separately. A stay cancelled after it was built is cleared on the next rebuild of its
// month — including on days the listing is no longer active, where the stale row is deleted.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { LIVE_STAY_STATUSES, channelFeeOf } from '@/lib/basis'
import { isOwnerOrFriendsFamily } from '@/lib/owner-audit'
import { isDepartureCleanName } from '@/lib/breezeway'
import { isTaskDone, isTaskGone } from '@/lib/task-categories'
import type { DimUnit } from './spine'
import { rcExpediaSplit, rcGrossAccom, type RcStay } from './rc-rules'
import { str, num, dOf, etDay, etHour, addDays, daysBetween, round2, round4, readIn, pageRead, upsertBatches, type BuildResult } from './shared'

const RES_COLS = 'id,listing_id,check_in,check_out,nights,status,source,guest_name,'
  + 'cleaning:raw->money->>fareCleaning,fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,'
  + 'channelFee:raw->money->>hostServiceFee,channelFeeInc:raw->money->>hostServiceFeeIncTax,tags:raw->tags'
const TASK_COLS = 'id,reference_property_id,name,type_department,status,scheduled_date,finished_at,total_minutes,assignee_name,finished_by_name'

/** Cost + billable supply lines on a Breezeway billing-detail row — what was billed, not what it cost. */
export function billedOf(costs: any, supplies: any): number {
  let total = 0
  for (const c of (Array.isArray(costs) ? costs : [])) {
    const a = Number(c && c.cost)
    if (Number.isFinite(a)) total += a
  }
  for (const s of (Array.isArray(supplies) ? supplies : [])) {
    if (!s || s.billable === false) continue
    const qty = Number(s.quantity) > 0 ? Number(s.quantity) : 1
    const a = s.total_price != null ? Number(s.total_price) : (s.unit_cost != null ? Number(s.unit_cost) * qty : NaN)
    if (Number.isFinite(a)) total += a
  }
  return round2(total)
}

type Night = { resId: string; channel: string; owner: boolean; gross: number; net: number; stays: number }
type BStay = RcStay & { id: string; ci: string; co: string; total: number; owner: boolean; channel: string }

/** Build (upsert) every listing-night in [from, to], inclusive Eastern dates. */
export async function buildUnitDays(from: string, to: string, units: DimUnit[], deadline: number): Promise<BuildResult> {
  if (!units.length) return { rows: 0, partial: true, error: 'dim_unit is empty' }
  if (to < from) return { rows: 0, partial: false }
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const span = daysBetween(from, to) + 1
  let partial = false
  const notes: string[] = []

  // 1. Stays touching the window (a stay checking out on `from` still carries its cleaning into it).
  const resRead = await pageRows<any>((a, b) => db.from('guesty_reservations').select(RES_COLS)
    .in('status', LIVE_STAY_STATUSES).gte('check_out', from).lte('check_in', to)
    .order('check_out').order('id').range(a, b), Math.ceil(((span + 30) * 60) / 1000) + 2)
  if (resRead.truncated) partial = true

  const stays: BStay[] = []
  for (const r of resRead.rows) {
    const lid = str(r.listing_id), ci = dOf(r.check_in), co = dOf(r.check_out)
    if (!lid || !ci || !co || co < ci) continue
    if (LIVE_STAY_STATUSES.indexOf(str(r.status).toLowerCase()) < 0) continue
    const total = Number(r.nights) > 0 ? Number(r.nights) : daysBetween(ci, co)
    const tagBlob = Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)).join(' ') : ''
    const grossAccom = rcGrossAccom(r.fare, r.fareBase)
    const cleaning = Number(r.cleaning)
    stays.push({
      id: str(r.id), listingId: lid, ci, co, total,
      owner: isOwnerOrFriendsFamily(str(r.source), tagBlob, str(r.guest_name)),
      channel: str(r.source) || 'unknown', source: str(r.source) || 'other',
      grossAccom, netAccom: grossAccom - channelFeeOf(r.channelFeeInc, r.channelFee),
      cleaning: Number.isFinite(cleaning) ? cleaning : 0,
    })
  }
  // Revenue Center's Expedia cleaning split, over the stays Revenue Center would read for this same
  // window (check-out after `from`): a stay that only checks out on `from` is not in its pull.
  rcExpediaSplit(stays.filter(x => x.co > from))

  const nights: Record<string, Night> = {}                 // listing|day -> the stay(s) holding that night
  const arrivals: Record<string, boolean> = {}
  const departures: Record<string, number> = {}            // listing|day -> cleaning fee earned (0 is a departure too)
  let doubled = 0
  for (const x of stays) {
    const lid = x.listingId
    if (x.ci >= from && x.ci <= to) arrivals[lid + '|' + x.ci] = true
    if (x.co >= from && x.co <= to) departures[lid + '|' + x.co] = (departures[lid + '|' + x.co] || 0) + x.cleaning
    if (x.total <= 0) continue
    const gross = x.grossAccom / x.total
    const net = x.netAccom / x.total
    const s = x.ci > from ? x.ci : from
    const lastNight = addDays(x.co, -1)
    const e = lastNight < to ? lastNight : to
    for (let d = s; d <= e; d = addDays(d, 1)) {
      const k = lid + '|' + d
      const n = nights[k]
      if (!n) { nights[k] = { resId: x.id, channel: x.channel, owner: x.owner, gross, net, stays: 1 }; continue }
      // Two live stays on one night is a data problem (a double booking, or a stay that should
      // have been cancelled). The first stay read keeps the night; the money of both stays is
      // kept so the month still adds up to the stays Revenue Center counts.
      n.gross += gross; n.net += net; n.stays += 1
      if (!x.owner) n.owner = false
      doubled++
    }
  }
  if (doubled) notes.push(doubled + ' double-booked night(s): money of both stays kept, night counted once')

  // 2. Field work. Tasks are read by scheduled date with a two-week lead so work finished inside the
  //    window but scheduled a little before it is still counted.
  const taskRead = await pageRows<any>((a, b) => db.from('breezeway_tasks_sync').select(TASK_COLS)
    .gte('scheduled_date', addDays(from, -14)).lte('scheduled_date', to)
    .order('scheduled_date').order('id').range(a, b), Math.ceil(((span + 14) * 130) / 1000) + 2)
  if (taskRead.truncated) partial = true
  const clean: Record<string, { minutes: number | null; by: string | null; late: boolean | null }> = {}
  const maintDone: Record<string, string[]> = {}           // listing|day -> finished maintenance task ids
  for (const t of taskRead.rows) {
    const lid = str(t.reference_property_id)
    if (!lid || isTaskGone(t.status)) continue
    const sched = dOf(t.scheduled_date)
    const done = isTaskDone(t.status, t.finished_at)
    if (isDepartureCleanName(t.name)) {
      if (!sched || sched < from || sched > to) continue
      const k = lid + '|' + sched
      const finDay = t.finished_at ? etDay(t.finished_at) : ''
      const hr = t.finished_at ? etHour(t.finished_at) : null
      const late = !done || !finDay ? null : (finDay > sched || (finDay === sched && hr != null && hr >= 16))
      const mins = Number(t.total_minutes)
      // A finished clean beats an unfinished twin on the same day.
      if (!clean[k] || (done && clean[k].late == null)) {
        clean[k] = { minutes: Number.isFinite(mins) && mins > 0 ? Math.round(mins) : null, by: str(t.finished_by_name) || str(t.assignee_name) || null, late }
      }
      continue
    }
    if (!/maint|repair/i.test(str(t.type_department)) || !done) continue
    const day = t.finished_at ? etDay(t.finished_at) : sched
    if (!day || day < from || day > to) continue
    const k = lid + '|' + day
    ;(maintDone[k] = maintDone[k] || []).push(str(t.id))
  }
  const allMaintIds: string[] = []
  for (const k of Object.keys(maintDone)) for (const id of maintDone[k]) allMaintIds.push(id)
  const billedByTask: Record<string, number> = {}
  if (allMaintIds.length) {
    const bd = await readIn<any>('breezeway_billing_details', 'task_id,costs,supplies', 'task_id', allMaintIds)
    if (bd.truncated) partial = true
    for (const d of bd.rows) billedByTask[str(d.task_id)] = billedOf(d.costs, d.supplies)
  }

  // 3. Guest issues filed, by the Eastern day they were filed.
  const glitchN: Record<string, number> = {}
  const refunds: Record<string, number> = {}
  const gRead = await pageRows<any>((a, b) => db.from('glitches').select('id,listing_id,created_at,refund_approved')
    .gte('created_at', addDays(from, -1) + 'T00:00:00Z').lt('created_at', addDays(to, 2) + 'T00:00:00Z')
    .order('created_at').order('id').range(a, b), Math.ceil((span * 20) / 1000) + 2)
  if (gRead.truncated) partial = true
  for (const g of gRead.rows) {
    const lid = str(g.listing_id), day = etDay(g.created_at)
    if (!lid || !day || day < from || day > to) continue
    const k = lid + '|' + day
    glitchN[k] = (glitchN[k] || 0) + 1
    refunds[k] = (refunds[k] || 0) + num(g.refund_approved)
  }

  // 4. One row per listing per day it was active (or held a stay).
  const rows: Record<string, any>[] = []
  for (const u of units) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const k = u.listing_id + '|' + d
      const n = nights[k]
      const hasActivity = !!n || arrivals[k] === true || departures[k] != null || !!clean[k] || !!maintDone[k] || !!glitchN[k]
      const before = !!u.active_from && d < u.active_from
      const after = u.status === 'inactive' && (!u.active_to || d > u.active_to)
      if ((before || after) && !hasActivity) continue
      const c = clean[k]
      const mt = maintDone[k] || []
      let billed = 0
      for (const id of mt) billed += billedByTask[id] || 0
      rows.push({
        day: d,
        listing_id: u.listing_id,
        physical_unit_id: u.physical_unit_id,
        building_id: u.building_id,
        market: u.market,
        owner_id: u.owner_id,
        state: n ? (n.owner ? 'owner_stay' : 'occupied') : 'vacant',
        reservation_id: n ? n.resId : null,
        channel: n ? n.channel : null,
        gross_accom: n ? round4(n.gross) : null,
        channel_fee: n ? round4(n.gross - n.net) : null,
        net_accom: n ? round4(n.net) : null,
        cleaning_rev: departures[k] != null ? round2(departures[k]) : null,
        is_arrival: arrivals[k] === true,
        is_departure: departures[k] != null,
        clean_minutes: c ? c.minutes : null,
        clean_done_by: c ? c.by : null,
        clean_late: c ? c.late : null,
        glitches_opened: glitchN[k] || 0,
        refunds: round2(refunds[k] || 0),
        maint_tasks_done: mt.length,
        maint_cost_billed: round2(billed),
        built_at: now,
        partial,
      })
    }
  }
  const w = await upsertBatches('fact_unit_day', rows, 'day,listing_id', { deadline, batch: 500 })

  // Rows this window holds that this build did not write: a stay cancelled since, on a day the
  // listing is no longer active (so no vacant row replaced it), or a listing gone from the mirror.
  // Only after a whole write and a whole read — never on a guess.
  if (!w.stoppedEarly && !w.error && !resRead.truncated && Date.now() < deadline) {
    const wrote: Record<string, boolean> = {}
    for (const r of rows) wrote[r.listing_id + '|' + r.day] = true
    const have = await pageRead<any>((a, b) => db.from('fact_unit_day').select('day,listing_id')
      .gte('day', from).lte('day', to).order('listing_id').order('day').range(a, b), Math.ceil((span * 330) / 1000) + 2)
    if (!have.truncated && !have.missing) {
      const stale: Record<string, string[]> = {}
      for (const r of have.rows) {
        const lid = str(r.listing_id), d = dOf(r.day)
        if (lid && d && !wrote[lid + '|' + d]) (stale[lid] = stale[lid] || []).push(d)
      }
      let removed = 0
      for (const lid of Object.keys(stale)) {
        if (Date.now() > deadline) break
        try {
          const { error } = await db.from('fact_unit_day').delete().eq('listing_id', lid).in('day', stale[lid])
          if (!error) removed += stale[lid].length
        } catch { /* left for the next rebuild */ }
      }
      if (removed) notes.push(removed + ' stale row(s) removed')
    }
  }
  return {
    rows: w.written, partial: partial || w.stoppedEarly, incomplete: w.stoppedEarly,
    ...(w.error ? { error: w.error } : {}), ...(notes.length ? { note: notes.join('; ') } : {}),
  }
}

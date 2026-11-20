// SIGNAL (Jon, 2026-11-20: "the most important things that need to be completed vs busy work"; "delineate a low-income property versus a high-income property, priority bookings versus non-priority").
//
// THE FACTS BEHIND A PRIORITY BOOKING, READ ONCE. lib/signal.ts holds the rule (owner stay,
// Sensitive or VIP, big, long, repeat guest; "at risk" adds a same-day turn, an open glitch on the
// unit, a 2-star-or-lower review in the unit's last five). This file is the server half: it turns
// reservation rows into those facts, so the Glitches board, the briefs, the inbox and the calls desk
// ask one question the same way.
//
//   · Sensitive / VIP   the reservation's Guesty custom fields. The mirror stores them as
//                       { fieldId, value } with NO name, so the two field ids are looked up by name
//                       in guesty_custom_fields (a name test alone never matches the mirror).
//   · repeat guest      the same Guesty guest has an earlier confirmed stay that is not an owner stay.
//   · the thresholds    bigBookingUsd and longStayNights from lib/slack-rules — the same two numbers
//                       the briefs already read. One source.
//
// Every read here is best-effort: a failed lookup leaves that one ingredient false, it never takes
// the page down and never invents a priority.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { isLiveStay } from './stay-status'
import { arrivalFlag, hasLowReview, priorityOf, OWNER_SOURCE, PRIORITY_DEFAULTS, type ArrivalFlag, type BookingFacts, type PriorityRules, type RiskFacts } from './signal'

/** The columns a reservation read needs for the facts below. */
export const PRIORITY_RES_COLS = 'id,listing_id,guest_id,source,money_total,nights,check_in,check_out,status,custom_fields'
/** How far back "the unit's last five reviews" looks. */
export const LOW_REVIEW_WINDOW_DAYS = 180
const GLITCH_CLOSED = ['closed', 'done', 'resolved']

export type PriorityRes = {
  id?: any; listing_id?: any; guest_id?: any; source?: any; money_total?: any; nights?: any
  check_in?: any; check_out?: any; status?: any; custom_fields?: any
}

const str = (v: any) => (v == null ? '' : String(v)).trim()
const day = (v: any) => str(v).slice(0, 10)
const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out }
const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|1)$/i.test(v.trim()))

/** The big-booking and long-stay thresholds, from the one setting that holds them. */
export async function getPriorityRules(): Promise<PriorityRules> {
  try {
    const R: any = await (await import('./slack-rules')).getSlackRules()
    return { bigBookingUsd: Number(R.bigBookingUsd) || PRIORITY_DEFAULTS.bigBookingUsd, longStayNights: Number(R.longStayNights) || PRIORITY_DEFAULTS.longStayNights }
  } catch { return { ...PRIORITY_DEFAULTS } }
}

let FIELD_IDS: { at: number; sensitive: string[]; vip: string[] } | null = null
/** The Guesty field ids of the reservation's Sensitive and VIP boxes (looked up by name, kept ten minutes). */
export async function priorityFieldIds(): Promise<{ sensitive: string[]; vip: string[] }> {
  if (FIELD_IDS && Date.now() - FIELD_IDS.at < 10 * 60_000) return FIELD_IDS
  const out = { at: Date.now(), sensitive: [] as string[], vip: [] as string[] }
  try {
    const { data } = await supabaseAdmin().from('guesty_custom_fields').select('id,name,slug').limit(500) // deliberate cap: Guesty's field definitions (~40)
    for (const f of (data || []) as any[]) {
      const n = str(f.name), s = str(f.slug)
      if (/^sensitive([ _]guest)?$/i.test(n) || /^sensitive(_guest)?$/i.test(s)) out.sensitive.push(str(f.id))
      else if (/^vip([ _]guest)?$/i.test(n) || /^vip(_guest)?$/i.test(s)) out.vip.push(str(f.id))
    }
    if (out.sensitive.length || out.vip.length) FIELD_IDS = out
  } catch { /* neither box reads as ticked */ }
  return out
}

/** Is one of these fields ticked on a reservation's custom-field array (mirror shape or Guesty's own)? */
export function fieldTicked(fields: any, ids: string[], name: RegExp): boolean {
  if (!Array.isArray(fields)) return false
  for (const f of fields) {
    const id = typeof f?.fieldId === 'string' ? f.fieldId : str(f?.fieldId?._id || f?.fieldId?.id)
    const nm = str(f?.fieldName || f?.name || f?.key || f?.fieldId?.name || f?.fieldId?.displayName || f?.field?.name)
    if ((id && ids.indexOf(id) >= 0) || (nm && name.test(nm))) { if (truthy(f?.value)) return true }
  }
  return false
}

/** Reservation rows → the booking facts the priority rule reads. Keyed by reservation id. */
export async function bookingFacts(rows: PriorityRes[]): Promise<Record<string, BookingFacts>> {
  const out: Record<string, BookingFacts> = {}
  if (!rows.length) return out
  const ids = await priorityFieldIds()
  // REPEAT GUESTS: one read of every confirmed stay by these guests, oldest first.
  const guestIds = Array.from(new Set(rows.map(r => str(r.guest_id)).filter(Boolean)))
  const prior: Record<string, { id: string; out: string }[]> = {}
  try {
    for (const part of chunk(guestIds, 150)) {
      const { rows: got } = await pageRows<any>((a, b) => supabaseAdmin().from('guesty_reservations')
        .select('id,guest_id,check_out,source').in('guest_id', part).eq('status', 'confirmed').order('id').range(a, b), 6)
      for (const p of got) {
        if (OWNER_SOURCE.test(str(p.source))) continue
        const g = str(p.guest_id);
        (prior[g] || (prior[g] = [])).push({ id: str(p.id), out: day(p.check_out) })
      }
    }
  } catch { /* nobody reads as a repeat guest */ }
  for (const r of rows) {
    const id = str(r.id)
    if (!id) continue
    const ci = day(r.check_in)
    out[id] = {
      source: str(r.source) || null,
      total: r.money_total == null ? null : Number(r.money_total),
      nights: r.nights == null ? null : Number(r.nights),
      sensitive: fieldTicked(r.custom_fields, ids.sensitive, /^sensitive( guest)?$/i),
      vip: fieldTicked(r.custom_fields, ids.vip, /^vip( guest)?$/i),
      repeat: !!ci && (prior[str(r.guest_id)] || []).some(p => p.id !== id && !!p.out && p.out <= ci),
    }
  }
  return out
}

/**
 * What could go wrong on arrival, per reservation id: another stay checks out of the unit that
 * morning, the unit has an open glitch, or one of its last five reviews (180 days) is 2 stars or lower.
 */
export async function arrivalRisks(rows: PriorityRes[]): Promise<Record<string, RiskFacts>> {
  const out: Record<string, RiskFacts> = {}
  const arr = rows.filter(r => str(r.id) && str(r.listing_id) && day(r.check_in))
  if (!arr.length) return out
  const db = supabaseAdmin()
  const lids = Array.from(new Set(arr.map(r => str(r.listing_id))))
  const dates = Array.from(new Set(arr.map(r => day(r.check_in)))).sort()
  const turns = new Set<string>(), glitchy = new Set<string>(), lowRev = new Set<string>()
  await Promise.all([
    (async () => {
      try {
        for (const part of chunk(lids, 150)) {
          const { rows: got } = await pageRows<any>((a, b) => db.from('guesty_reservations')
            .select('id,listing_id,check_out,status').in('listing_id', part)
            .gte('check_out', dates[0]).lte('check_out', dates[dates.length - 1]).order('id').range(a, b), 6)
          for (const p of got) if (isLiveStay(p.status)) turns.add(str(p.listing_id) + '|' + day(p.check_out) + '|' + str(p.id))
        }
      } catch { /* no same-day turns read */ }
    })(),
    (async () => {
      try {
        const { data } = await db.from('glitches').select('listing_id,status').not('listing_id', 'is', null)
          .not('status', 'in', '(' + GLITCH_CLOSED.join(',') + ')').limit(1000) // deliberate cap: cards in play (tens, not hundreds)
        for (const g of (data || []) as any[]) glitchy.add(str(g.listing_id))
      } catch { /* no open glitches read */ }
    })(),
    (async () => {
      try {
        const since = new Date(Date.now() - LOW_REVIEW_WINDOW_DAYS * 86400000).toISOString()
        const byUnit: Record<string, any[]> = {}
        for (const part of chunk(lids, 150)) {
          const { rows: got } = await pageRows<any>((a, b) => db.from('guesty_reviews')
            .select('id,listing_id,rating,created_at').in('listing_id', part).gte('created_at', since).is('removed_at', null)
            .order('created_at', { ascending: false }).order('id').range(a, b), 6)
          for (const v of got) (byUnit[str(v.listing_id)] || (byUnit[str(v.listing_id)] = [])).push(v.rating)
        }
        for (const lid of Object.keys(byUnit)) if (hasLowReview(byUnit[lid])) lowRev.add(lid)
      } catch { /* no reviews read */ }
    })(),
  ])
  // A same-day turn is ANOTHER stay leaving the unit on the arrival date.
  const turnDays: Record<string, string[]> = {}
  turns.forEach(k => { const [lid, d, id] = k.split('|'); (turnDays[lid + '|' + d] || (turnDays[lid + '|' + d] = [])).push(id) })
  for (const r of arr) {
    const lid = str(r.listing_id), id = str(r.id)
    out[id] = {
      sameDayTurn: (turnDays[lid + '|' + day(r.check_in)] || []).some(x => x !== id),
      openGlitch: glitchy.has(lid),
      lowReview: lowRev.has(lid),
    }
  }
  return out
}

/** Arrivals → Priority / Priority at risk, with the reason. Keyed by reservation id. */
export async function flagArrivals(rows: PriorityRes[], rules?: PriorityRules | null): Promise<Record<string, ArrivalFlag>> {
  const out: Record<string, ArrivalFlag> = {}
  const live = rows.filter(r => str(r.id) && (r.status == null || isLiveStay(r.status)))
  if (!live.length) return out
  const R = rules || await getPriorityRules()
  const facts = await bookingFacts(live)
  // Risks only matter for a priority booking, so only those are looked up.
  const pri = live.filter(r => arrivalFlag(facts[str(r.id)] || {}, null, R).priority)
  const risks = pri.length ? await arrivalRisks(pri) : {}
  for (const r of live) out[str(r.id)] = arrivalFlag(facts[str(r.id)] || {}, risks[str(r.id)] || null, R)
  return out
}

// ── ONE RESERVATION AT A TIME, REMEMBERED (the inbox) ───────────────────────────────────────────
// The inbox list is read every ten seconds by every open inbox. A booking's priority changes a few
// times in its life, so each answer is kept in this instance for fifteen minutes and only the
// reservations not seen yet are read. No risk lookup here: the inbox only tags the row.
const PRIORITY_TTL_MS = 15 * 60_000
const priorityCache = new Map<string, { at: number; priority: boolean; why: string }>()

/** reservation id → is it a priority booking, and why. Best-effort: an id that could not be read is simply absent. */
export async function priorityByReservation(ids: string[]): Promise<Record<string, { priority: boolean; why: string }>> {
  const out: Record<string, { priority: boolean; why: string }> = {}
  const now = Date.now()
  const need: string[] = []
  for (const id of Array.from(new Set(ids.map(str).filter(Boolean)))) {
    const hit = priorityCache.get(id)
    // A stale answer still stands until the fresh one lands, so a tag never blinks off for a poll.
    if (hit) out[id] = { priority: hit.priority, why: hit.why }
    if (!hit || now - hit.at >= PRIORITY_TTL_MS) need.push(id)
  }
  if (!need.length) return out
  try {
    const rules = await getPriorityRules()
    const rows: PriorityRes[] = []
    for (const part of chunk(need, 150)) {
      const { data } = await supabaseAdmin().from('guesty_reservations').select(PRIORITY_RES_COLS).in('id', part)
      rows.push(...((data || []) as any[]))
    }
    const facts = await bookingFacts(rows)
    for (const r of rows) {
      const id = str(r.id)
      const p = priorityOf(facts[id] || {}, rules)
      priorityCache.set(id, { at: now, priority: p.priority, why: p.label })
      out[id] = { priority: p.priority, why: p.label }
    }
    if (priorityCache.size > 6000) for (const k of Array.from(priorityCache.keys()).slice(0, 2000)) priorityCache.delete(k)
  } catch { /* the rows read without the tag */ }
  return out
}

/** What this instance already knows, without a read — the fallback when the lookup above is slow. */
export function priorityFromCache(ids: string[]): Record<string, { priority: boolean; why: string }> {
  const out: Record<string, { priority: boolean; why: string }> = {}
  for (const id of ids) { const hit = priorityCache.get(str(id)); if (hit) out[str(id)] = { priority: hit.priority, why: hit.why } }
  return out
}

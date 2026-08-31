// WHEN CAN SOMEBODY ACTUALLY GET INTO THIS UNIT?
//
// Jon, 2026-08-31: maintenance moves to "the day of a checkout for a unit that already has assigned
// tasks for maintenance", and then: "if unit is vacant it can be moved to that day, that's fine."
//
// The second sentence is the real rule and it is better than the first. The binding constraint on
// maintenance is ACCESS — you cannot fix a water heater around a sleeping guest. A checkout day with
// a technician already booked is the ideal, because the trip is already paid for; but any vacant day
// is workable, and a job parked on a workable day is infinitely more useful than one parked on a day
// the unit is full.
//
// So this returns both, ranked: the free-trip days first, then the merely-empty ones.
//
// ── WHY A CHECKOUT DAY WITH A SAME-DAY ARRIVAL IS NOT VACANT ───────────────────────────────────
// It looks empty on a calendar and is not. The guest leaves at 11 and the next lands at 4, and the
// housekeeping turn owns every minute in between. Falling out of `staySpans` naturally: a day is
// vacant only when NO live stay covers that night, so a same-day turn is correctly excluded.
import { supabaseAdmin } from './supabase-admin'
import { staySpans } from './stay-status'

const str = (v: any) => String(v ?? '').trim()
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const plus = (date: string, n: number) => ymd(new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000))

export type WorkableDay = { date: string; vacant: true; hasTrade: boolean; who: string[] }
export type UnitWindow = {
  listingId: string
  days: WorkableDay[]
  /** The one to use: earliest day that already has a technician, else earliest vacant day. */
  best: WorkableDay | null
}

/**
 * For each unit, which of the next `horizon` days are workable, and which of those already have
 * maintenance booked. Two reads for the whole batch, never one per unit.
 */
export async function workableDays(
  listingIds: string[],
  today: string,
  horizon = 21,
): Promise<Record<string, UnitWindow>> {
  const out: Record<string, UnitWindow> = {}
  if (!listingIds.length) return out
  const ids = Array.from(new Set(listingIds.map(String))).slice(0, 400)
  const last = plus(today, Math.max(1, horizon))

  try {
    const db = supabaseAdmin()
    const [resRes, taskRes] = await Promise.all([
      // Any stay that could overlap the window. `check_out > today` and `check_in <= last` is the
      // cheapest overlap test that cannot miss a stay straddling the edges.
      db.from('guesty_reservations').select('listing_id,check_in,check_out,status')
        .in('listing_id', ids).gt('check_out', today).lte('check_in', last).limit(4000),
      // Maintenance already scheduled in the window, so we know which days come with a body.
      db.from('breezeway_tasks_sync')
        .select('reference_property_id,scheduled_date,status,finished_at,assignees,type_department')
        .in('reference_property_id', ids)
        .gte('scheduled_date', today).lte('scheduled_date', last)
        .order('scheduled_date', { ascending: true }).order('id', { ascending: true })
        .limit(4000),
    ])

    const staysOf: Record<string, any[]> = {}
    for (const r of ((resRes.data || []) as any[])) {
      ;(staysOf[str(r.listing_id)] = staysOf[str(r.listing_id)] || []).push(r)
    }

    // day -> the people with maintenance booked there
    const tradeOf: Record<string, Record<string, Set<string>>> = {}
    for (const t of ((taskRes.data || []) as any[])) {
      const dep = str(t.type_department).toLowerCase()
      if (!/maint/.test(dep)) continue
      if (t.finished_at) continue
      if (/\b(cancel|delet|void)/i.test(str(t.status))) continue
      const lid = str(t.reference_property_id); const d = str(t.scheduled_date).slice(0, 10)
      if (!lid || !d) continue
      const names = Array.isArray(t.assignees)
        ? t.assignees.map((p: any) => str(p && typeof p === 'object' ? p.name : p)).filter(Boolean)
        : []
      if (!names.length) continue          // a job with nobody on it is not "a body going there"
      tradeOf[lid] = tradeOf[lid] || {}
      ;(tradeOf[lid][d] = tradeOf[lid][d] || new Set()).add(names[0])
    }

    for (const lid of ids) {
      const stays = staysOf[lid] || []
      const days: WorkableDay[] = []
      for (let i = 0; i <= horizon; i++) {
        const d = plus(today, i)
        if (stays.some(s => staySpans(s, d))) continue      // somebody is in it that night
        const who = Array.from(tradeOf[lid]?.[d] || [])
        days.push({ date: d, vacant: true, hasTrade: who.length > 0, who })
      }
      // Free trip first, then simply empty. Earliest within each tier — a job that has already
      // waited does not benefit from waiting for a prettier day.
      const withTrade = days.find(d => d.hasTrade) || null
      out[lid] = { listingId: lid, days, best: withTrade || days[0] || null }
    }
  } catch { /* an empty window means "do not move it", which is the safe answer */ }
  return out
}

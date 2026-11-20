// SIGNAL (Jon, 2026-11-20: "the most important things that need to be completed vs busy work"; "delineate a low-income property versus a high-income property, priority bookings versus non-priority").
//
// THE GLITCHES BOARD, RANKED. Each card still in play gets a signal: the score (lib/signal.ts), the
// one line that says why, its building's tier and whether the booking is a priority one. The board
// orders the cards inside each lane by it, highest first. Before this the lanes were newest first,
// so a 17WEST guest sitting in a unit six days past the due date sat under whatever was filed last.
//
// WHO IS AFFECTED, in this order:
//   1. the card's own guest is in the unit today          → in house, and they told us (35)
//   2. somebody else is in the unit today                 → in house, field-noted (20)
//   3. a guest lands in the unit today / within 3 days    → arrival (30 / 15)
// MONEY is that booking's nightly accommodation fare × the nights exposed (seven at most), or the
// refund on the table if that is more. THE CLOCK is the card's own due date and its Urgent mark.
//
// SENSITIVE IS LEFT OUT OF "PRIORITY" HERE. Filing a glitch ticks the reservation's Sensitive box
// (app/api/glitches POST), so on this board it would mark every card with a stay as priority.
// Owner stay, VIP, big, long and repeat guest still count.
//
// Botanica cards (a partner hotel) are not ranked: they keep their place under the ranked cards,
// newest first, with no score.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { isLiveStay } from './stay-status'
import { getTiers, tierOfBuilding, tierOfListing } from './property-tier'
import { bookingFacts, getPriorityRules, PRIORITY_RES_COLS } from './booking-priority'
import { priorityOf, signalScore, SOON_DAYS, type GuestState, type Tier } from './signal'

export type CardSignal = {
  score: number
  reason: string
  tier: Tier | null
  ranked: boolean
  priority: boolean
  /** "big booking, repeat guest" — the hover on the Priority tag. */
  priorityWhy: string
  stake: number
  rate: number | null
}

const CLOSED = ['closed', 'done', 'resolved']
const str = (v: any) => (v == null ? '' : String(v)).trim()
const day = (v: any) => str(v).slice(0, 10)
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000)
const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out }

const RES_COLS = PRIORITY_RES_COLS + ',fare:raw->money->>fareAccommodation'

/** The signal of every card still in play, keyed by glitch id. Best-effort: on any failure, {}. */
export async function glitchSignals(cards: any[]): Promise<Record<string, CardSignal>> {
  const out: Record<string, CardSignal> = {}
  const live = cards.filter(g => g && str(g.id) && CLOSED.indexOf(str(g.status)) < 0)
  if (!live.length) return out
  try {
    const db = supabaseAdmin()
    const today = etToday(), soon = addDays(today, SOON_DAYS)
    const resIds = Array.from(new Set(live.map(g => str(g.reservation_id)).filter(Boolean)))
    const lids = Array.from(new Set(live.map(g => str(g.listing_id)).filter(Boolean)))
    const [tiers, rules, own, unit, refunds] = await Promise.all([
      getTiers(),
      getPriorityRules(),
      // The cards' own bookings.
      (async () => {
        const rows: any[] = []
        for (const part of chunk(resIds, 150)) { const { data } = await db.from('guesty_reservations').select(RES_COLS).in('id', part); rows.push(...((data || []) as any[])) }
        return rows
      })(),
      // Who is in each unit now, and who lands in it inside three days.
      (async () => {
        const rows: any[] = []
        for (const part of chunk(lids, 150)) {
          const { data } = await db.from('guesty_reservations').select(RES_COLS).in('listing_id', part)
            .gte('check_out', today).lte('check_in', soon).order('check_in').limit(1000) // deliberate cap: stays touching a four-day window at the units with a card (a handful each)
          rows.push(...((data || []) as any[]))
        }
        return rows.filter(r => isLiveStay(r.status))
      })(),
      // The advisor's refund figure is not a card column; read it apart so the board list stays slim.
      (async () => {
        const m: Record<string, number> = {}
        try {
          for (const part of chunk(live.map(g => str(g.id)), 150)) {
            const { data } = await db.from('glitches').select('id,refund_recommended').in('id', part)
            for (const r of (data || []) as any[]) if (Number(r.refund_recommended) > 0) m[str(r.id)] = Number(r.refund_recommended)
          }
        } catch { /* a database without the column: no refund in the stake */ }
        return m
      })(),
    ])
    const byId: Record<string, any> = {}
    for (const r of own) byId[str(r.id)] = r
    const byUnit: Record<string, any[]> = {}
    for (const r of unit) { byId[str(r.id)] = byId[str(r.id)] || r; (byUnit[str(r.listing_id)] || (byUnit[str(r.listing_id)] = [])).push(r) }
    const facts = await bookingFacts(Object.values(byId))
    const spans = (r: any) => !!r && isLiveStay(r.status) && day(r.check_in) <= today && today < day(r.check_out)
    const fareOf = (r: any) => { const f = Number(r?.fare), n = Number(r?.nights); return Number.isFinite(f) && n > 0 ? f / n : 0 }

    for (const g of live) {
      const id = str(g.id), lid = str(g.listing_id)
      const t = lid ? tierOfListing(tiers, lid, null, str(g.unit)) : tierOfBuilding(tiers, null, str(g.unit))
      const mine = byId[str(g.reservation_id)]
      const stays = byUnit[lid] || []
      let guest: GuestState = 'none', booking: any = null, reported = false, nights = 0, arrivesIn: number | null = null
      if (spans(mine)) { guest = 'in_house'; booking = mine; reported = true; nights = dayDiff(today, day(mine.check_out)) }
      else {
        const inNow = stays.find(spans)
        const next = stays.filter(r => day(r.check_in) >= today && day(r.check_in) <= soon).sort((a, b) => day(a.check_in).localeCompare(day(b.check_in)))[0]
          || (mine && isLiveStay(mine.status) && day(mine.check_in) >= today && day(mine.check_in) <= soon ? mine : null)
        if (inNow) { guest = 'in_house'; booking = inNow; nights = dayDiff(today, day(inNow.check_out)) }
        else if (next) {
          arrivesIn = dayDiff(today, day(next.check_in))
          guest = arrivesIn <= 0 ? 'arriving_today' : 'arriving_soon'
          booking = next; nights = Number(next.nights) || 0
        }
      }
      const pr = booking ? priorityOf(facts[str(booking.id)] || {}, rules, { ignoreSensitive: true }) : { priority: false, why: [], label: '' }
      const due = /^\d{4}-\d{2}-\d{2}/.test(str(g.due_date)) ? dayDiff(today, day(g.due_date)) : null
      const s = signalScore({
        building: t.building, tier: t.tier, rate: t.rate,
        guest, guestReported: reported, arrivesInDays: arrivesIn,
        nightlyFare: fareOf(booking), nightsExposed: nights,
        stakeUsd: refunds[id] || 0,
        dueInDays: due, urgent: str(g.priority).toLowerCase() === 'urgent',
        priority: pr.priority,
      })
      out[id] = { score: s.score, reason: s.reason, tier: s.tier, ranked: s.ranked, priority: s.ranked && pr.priority, priorityWhy: pr.label, stake: s.stakeUsd, rate: s.rate }
    }
  } catch (e: any) {
    console.error('[glitch-signal] ' + String(e?.message || e).slice(0, 160))
    return {}
  }
  return out
}

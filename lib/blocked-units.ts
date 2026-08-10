// BLOCKED UNITS — every unit that cannot be sold right now, and why.
//
// Jon, 2026-08-10: "we need to show all blocked units, that way we can identify what needs to be
// done and stay on top. That would be urgent. Need to pull that data from Guesty multi cal."
//
// A blocked night is revenue that is already gone, and nothing announces it. A unit goes down for
// a repair, an owner stay or a "do not sell" and the block routinely outlives the reason — the
// tech finished last Tuesday and the calendar is still shut. Live data on the day this was built:
// 16 units down, 239 blocked nights in 30 days, with reasons like "AC issues reported by Jean
// Leger" and "Building manager using it" sitting in the note field where nobody ever looked.
//
// This lives in lib rather than in the API route because the morning briefs need exactly the same
// answer as the board does, and two implementations of "what counts as blocked" would drift.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getMultiCalendar, isOpsBlock } from './guesty'
import { marketOf, buildingOf } from './segments'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const str = (v: any) => (v == null ? '' : String(v))
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }

export type BlockedRun = {
  listingId: string
  unit: string
  building: string
  market: string
  from: string
  to: string
  nights: number
  startsInDays: number
  live: boolean        // out of service TODAY
  openEnded: boolean   // still blocked on the last day we looked at — the end date is unknown
  reason: string
  note: string | null
  keys: string[]       // raw Guesty flags, so our labels never hide the truth
  // LINKED INVENTORY (Jon, 2026-08-10: "some are parent listing, meaning if one is booked can
  // take some offline"). A unit sold as a whole AND as its parts — "3316 Full - 4BR" alongside
  // "3316/1" and "3316/2", or "Capri 115/116" alongside "Capri 115" — goes unavailable the moment
  // a sibling sells. That is the system working, not a unit out of service, and mixing the two
  // buries the blocks that actually need chasing.
  linked: boolean          // Guesty blocked this automatically because a linked listing sold
  alsoBlocks: string[]     // other listings on the same room that this block also takes offline
}

export type BlockedReport = {
  from: string; to: string; days: number
  listingsChecked: number; calendarDays: number
  liveNow: number; upcoming: number; nightsBlocked: number
  linkedCount: number      // Guesty auto-blocks, reported separately from work to chase
  byMarket: Record<string, { units: number; nights: number }>
  runs: BlockedRun[]       // out-of-service only
  linkedRuns: BlockedRun[] // blocked by a booked sibling
}

// Guesty's block flags. Unrecognised keys are passed through verbatim rather than swallowed — a
// reason the team can see and question beats a tidy label that is wrong.
const REASON: Record<string, string> = {
  m: 'Manual block', o: 'Owner stay', ow: 'Owner stay', b: 'Blocked',
  bd: 'Blocked by another listing', sr: 'Same-unit reservation', mt: 'Maintenance',
  cl: 'Cleaning hold', abl: 'Auto-block', pt: 'Pending transaction',
  bw: 'Beyond booking window', a: 'Advance notice',
}
export function reasonLabel(keys: string[]): string {
  const named = keys.map(k => REASON[k]).filter(Boolean)
  if (named.length) return Array.from(new Set(named)).join(' + ')
  return keys.length ? 'Blocked (' + keys.join(', ') + ')' : 'Blocked'
}

export async function blockedUnits(days = 30): Promise<BlockedReport> {
  const win = Math.min(Math.max(days, 1), 120)
  const today = ymd(new Date())
  const end = addDays(today, win)

  const db = supabaseAdmin()
  const { data: rows } = await db.from('guesty_listings')
    .select('id,nickname,title,building,address_city,status').limit(2000)
  const listings = ((rows || []) as any[]).filter(l => !DEAD.includes(str(l.status).toLowerCase()))
  const meta: Record<string, { unit: string; building: string; market: string }> = {}
  for (const l of listings) {
    const nm = l.nickname || l.title || String(l.id)
    meta[String(l.id)] = {
      unit: nm,
      building: buildingOf(str(l.building), nm) || 'Other',
      market: String(marketOf(l.building, l.address_city, nm) || 'Miami'),
    }
  }

  // LINKED SETS. A unit listed both whole and in parts shares a room number across its listings:
  // "3316 Full - 4 BR" / "3316/1 - 2BR" / "3316/2 - 2BR", or "Capri 115/116" / "Capri 115 - 1BR".
  // Grouping on <canonical building>#<first 3-4 digit number> finds them without needing Guesty to
  // model the relationship — which it does not: complexId is building-level (all 32 Elser units
  // share one), so it cannot answer this.
  const roomKeyOf = (building: string, name: string): string | null => {
    const m = String(name || '').match(/(\d{3,4})/)
    return m ? building.toLowerCase() + '#' + m[1] : null
  }
  const roomSets: Record<string, string[]> = {}
  for (const lid of Object.keys(meta)) {
    const k = roomKeyOf(meta[lid].building, meta[lid].unit)
    if (k) (roomSets[k] = roomSets[k] || []).push(lid)
  }

  const cal = await getMultiCalendar(Object.keys(meta), today, end)
  const blocked = cal.filter(isOpsBlock)
  const byUnit: Record<string, typeof blocked> = {}
  for (const d of blocked) (byUnit[d.listingId] = byUnit[d.listingId] || []).push(d)

  // One row per unbroken run of blocked nights. A unit shut from the 4th to the 9th is ONE thing
  // to chase, not six — the brief has to read like a worklist, not a log.
  const runs: BlockedRun[] = []
  for (const lid of Object.keys(byUnit)) {
    const m = meta[lid]
    if (!m) continue
    const sorted = byUnit[lid].slice().sort((a, b) => a.date.localeCompare(b.date))
    let cur: { from: string; to: string; keys: Set<string>; note: string | null } | null = null
    const flush = () => {
      if (!cur) return
      const nights = Math.round((new Date(cur.to + 'T12:00:00').getTime() - new Date(cur.from + 'T12:00:00').getTime()) / 86400000) + 1
      const keys = Array.from(cur.keys)
      runs.push({
        listingId: lid, unit: m.unit, building: m.building, market: m.market,
        from: cur.from, to: cur.to, nights,
        startsInDays: Math.round((new Date(cur.from + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000),
        live: cur.from <= today && cur.to >= today,
        openEnded: cur.to >= end,
        reason: reasonLabel(keys), note: cur.note, keys,
        linked: false, alsoBlocks: [],
      })
      cur = null
    }
    for (const d of sorted) {
      const on = Object.keys(d.blocks || {}).filter(k => {
        const v = (d.blocks as any)[k]; return v === true || (v && typeof v === 'object')
      })
      if (cur && addDays(cur.to, 1) === d.date) {
        cur.to = d.date
        on.forEach(k => cur!.keys.add(k))
        if (!cur.note && d.note) cur.note = d.note
      } else {
        flush()
        cur = { from: d.date, to: d.date, keys: new Set(on), note: d.note }
      }
    }
    flush()
  }
  // WHY THIS IS NOT INFERRED FROM SIBLING BOOKINGS. The first version marked a block as
  // "linked" whenever any sibling listing happened to be booked over the same dates, and it
  // immediately hid the wrong things: "3316/1 - 2BR" carries the note "ac issue" and was pulled
  // off the actionable list purely because 3316/2 was sold that week. A genuine automatic block
  // is flagged BY GUESTY (bd = blocked by another listing, sr = same-unit reservation) — it never
  // arrives as a manual block with a human-typed note. So only Guesty's own flags reclassify a
  // row, and a person typing "ac issue" is always something to chase.
  for (const r of runs) {
    r.linked = r.keys.some(k => k === 'bd' || k === 'sr')
    const k = roomKeyOf(r.building, r.unit)
    // WHAT ELSE THIS BLOCK COSTS US. A room sold both whole and in parts — "3316 Full - 4 BR"
    // beside "3316/1" and "3316/2", "Capri 115/116" beside "Capri 115" — cannot sell the whole
    // while a part is down. Naming the collateral makes the true cost of leaving a block up
    // visible: one AC repair can be holding three listings off the market.
    r.alsoBlocks = k
      ? (roomSets[k] || []).filter(id => id !== r.listingId).map(id => (meta[id] || {}).unit).filter(Boolean)
      : []
  }

  const outOfService = runs.filter(r => !r.linked)
  const linkedRuns = runs.filter(r => r.linked)
  // Down now first, then longest. The unit that has been shut the longest is the one most likely
  // to be a block nobody remembers creating.
  const bySeverity = (a: BlockedRun, b: BlockedRun) =>
    Number(b.live) - Number(a.live) || b.nights - a.nights || a.from.localeCompare(b.from)
  outOfService.sort(bySeverity)
  linkedRuns.sort(bySeverity)

  const byMarket: Record<string, { units: number; nights: number }> = {}
  for (const r of outOfService) {
    const e = byMarket[r.market] = byMarket[r.market] || { units: 0, nights: 0 }
    e.units += 1; e.nights += r.nights
  }
  return {
    from: today, to: end, days: win,
    listingsChecked: Object.keys(meta).length,
    calendarDays: cal.length,
    liveNow: outOfService.filter(r => r.live).length,
    upcoming: outOfService.filter(r => !r.live).length,
    nightsBlocked: outOfService.reduce((a, r) => a + r.nights, 0),
    linkedCount: linkedRuns.length,
    byMarket, runs: outOfService, linkedRuns,
  }
}

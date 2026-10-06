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
import { getMultiCalendar, isOpsBlock, type BlockRef } from './guesty'
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
  // AS GUESTY SHOWS IT (Jon, 2026-10-06: "see how the block is labeled in Guesty"). The block
  // reason the team picked in Guesty ("Offboarded", "Owner stay"), who created it and when, and
  // the block's real last night — which is often months past the window, so "no end date" can
  // say the date instead of a shrug.
  guestyLabel: string | null
  createdBy: string | null
  createdAt: string | null
  blockEnd: string | null   // Guesty's own end date for the block (last blocked night), when it has one
  blockStart: string | null // Guesty's own start date — often before today, which our window clips
  // LINKED INVENTORY (Jon, 2026-08-10: "some are parent listing, meaning if one is booked can
  // take some offline"). A unit sold as a whole AND as its parts — "3316 Full - 4BR" alongside
  // "3316/1" and "3316/2", or "Capri 115/116" alongside "Capri 115" — goes unavailable the moment
  // a sibling sells. That is the system working, not a unit out of service, and mixing the two
  // buries the blocks that actually need chasing.
  linked: boolean          // Guesty blocked this automatically because a linked listing sold
  alsoBlocks: string[]     // other listings on the same room that this block also takes offline
}

// MULTI-CALENDAR (Jon, 2026-10-06: "a multi calendar view"). One row per unit with a block in the
// window, one character per day: B out of service · L auto-closed by Guesty (linked listing sold)
// · R reserved · . open · ? no calendar data. Compact enough to send for 120 days × every unit.
export type CalendarRow = { listingId: string; unit: string; building: string; market: string; cells: string }

export type BlockedReport = {
  from: string; to: string; days: number
  calendar: { days: string[]; rows: CalendarRow[] }
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
    .select('id,nickname,title,building,address_city,status').limit(1000) // deliberate cap: one row per listing, ~290 in the portfolio
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
    let cur: { from: string; to: string; keys: Set<string>; note: string | null; refs: Map<string, BlockRef> } | null = null
    const flush = () => {
      if (!cur) return
      const nights = Math.round((new Date(cur.to + 'T12:00:00').getTime() - new Date(cur.from + 'T12:00:00').getTime()) / 86400000) + 1
      const keys = Array.from(cur.keys)
      // The block that covers the most of this run speaks for it: its Guesty reason, author and end.
      const refs = Array.from(cur.refs.values()).sort((a, b) => (b.end || '').localeCompare(a.end || ''))
      const lead = refs[0]
      const blockEnd = refs.reduce<string | null>((acc, r) => (r.end && (!acc || r.end > acc) ? r.end : acc), null)
      const blockStart = refs.reduce<string | null>((acc, r) => (r.start && (!acc || r.start < acc) ? r.start : acc), null)
      runs.push({
        listingId: lid, unit: m.unit, building: m.building, market: m.market,
        from: cur.from, to: cur.to, nights,
        startsInDays: Math.round((new Date(cur.from + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000),
        live: cur.from <= today && cur.to >= today,
        openEnded: cur.to >= end,
        reason: reasonLabel(keys), note: cur.note || lead?.note || null, keys,
        guestyLabel: refs.map(r => r.reason).filter(Boolean)[0] || null,
        createdBy: lead?.createdBy || null, createdAt: lead?.createdAt || null, blockEnd, blockStart,
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
        for (const r of d.refs || []) if (r.id && !cur.refs.has(r.id)) cur.refs.set(r.id, r)
      } else {
        flush()
        cur = { from: d.date, to: d.date, keys: new Set(on), note: d.note, refs: new Map((d.refs || []).filter(r => r.id).map(r => [r.id, r])) }
      }
    }
    flush()
  }
  // WHAT ELSE A BLOCK COSTS US — but ONLY where the listings genuinely overlap in space.
  //
  // A shared room number is NOT enough. "906/2" through "906/9" are eight separate studios in one
  // building; blocking one has no effect on the others, and an earlier version of this claimed a
  // single block took seven other units offline. A real parent/child set has a WHOLE-UNIT listing
  // in it: "Arya 1418 Full - 2BR" beside "Arya 1418/1" and "/2", or "Capri 115/116" beside
  // "Capri 115". So a set only counts when it contains a parent, and then:
  //   • blocking the PARENT takes every child offline
  //   • blocking a CHILD takes the parent offline — but not its sibling children
  const isParentName = (n: string) =>
    /\bfull\b/i.test(n) || /\b\d{3,4}\s*\/\s*\d{3,4}\b/.test(n)
  const collateralFor = (lid: string): string[] => {
    const me = meta[lid]
    if (!me) return []
    const k = roomKeyOf(me.building, me.unit)
    if (!k) return []
    const set = (roomSets[k] || []).filter(id => meta[id])
    if (set.length < 2) return []
    const parents = set.filter(id => isParentName(meta[id].unit))
    if (!parents.length) return []                       // just unit numbering, not a shared space
    const iAmParent = parents.includes(lid)
    const affected = iAmParent
      ? set.filter(id => id !== lid)                     // the whole unit is down: every part is
      : parents.filter(id => id !== lid)                 // a part is down: only the whole unit is
    return affected.map(id => meta[id].unit).filter(Boolean)
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
    r.alsoBlocks = collateralFor(r.listingId)
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
  // THE MULTI-CALENDAR. Every unit that has any block in the window, every day of the window, one
  // character each — so the board can draw the same picture Guesty's multi-calendar does, with the
  // blocked nights in context of the bookings around them.
  const dayList: string[] = []
  for (let d = today; d < end; d = addDays(d, 1)) dayList.push(d)
  const dayIdx: Record<string, number> = {}
  dayList.forEach((d, i) => { dayIdx[d] = i })
  const linkedIds = new Set(linkedRuns.map(r => r.listingId))
  const outIds = new Set(outOfService.map(r => r.listingId))
  const grid: Record<string, string[]> = {}
  for (const d of cal) {
    const i = dayIdx[d.date]
    if (i == null || !meta[d.listingId]) continue
    if (!(outIds.has(d.listingId) || linkedIds.has(d.listingId))) continue
    const row = grid[d.listingId] = grid[d.listingId] || new Array(dayList.length).fill('?')
    const on = Object.keys(d.blocks || {}).filter(k => { const v = (d.blocks as any)[k]; return v === true || (v && typeof v === 'object') })
    if (isOpsBlock(d)) row[i] = on.some(k => k === 'bd' || k === 'sr') ? 'L' : 'B'
    else if (d.reservationId || on.some(k => k === 'r')) row[i] = 'R'
    else row[i] = '.'
  }
  const order = new Map<string, number>()
  outOfService.concat(linkedRuns).forEach((r, i) => { if (!order.has(r.listingId)) order.set(r.listingId, i) })
  const calendarRows: CalendarRow[] = Object.keys(grid)
    .sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9))
    .map(lid => ({ listingId: lid, unit: meta[lid].unit, building: meta[lid].building, market: meta[lid].market, cells: grid[lid].join('') }))

  return {
    from: today, to: end, days: win,
    calendar: { days: dayList, rows: calendarRows },
    listingsChecked: Object.keys(meta).length,
    calendarDays: cal.length,
    liveNow: outOfService.filter(r => r.live).length,
    upcoming: outOfService.filter(r => !r.live).length,
    nightsBlocked: outOfService.reduce((a, r) => a + r.nights, 0),
    linkedCount: linkedRuns.length,
    byMarket, runs: outOfService, linkedRuns,
  }
}

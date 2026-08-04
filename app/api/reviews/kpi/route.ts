// REVIEW KPIs — reputation as an operating metric, not a vanity number.
//
// Design notes, because the choices here are not obvious:
//
// 1. THE AVERAGE IS A WEAK HEADLINE. On Airbnb the working range is roughly 4.6 to 4.9: a listing
//    at 4.6 is in trouble and one at 4.9 is fine, so a single bad month moves the average about
//    0.05 and nobody notices until the ranking drops. FIVE-STAR SHARE moves visibly and early, so
//    it leads; the average sits next to it.
// 2. SMALL SAMPLES LIE. A unit with two 3-star reviews is not the worst unit in the portfolio. Every
//    ranked average is shrunk toward the portfolio mean (score = (C*m + sum) / (C + n), C = 5), and
//    anything under MIN_N is listed separately as "not enough yet" rather than ranked.
// 3. CHANNELS ARE NOT THE SAME SCALE. Booking.com scores 1-10 (halved on ingest) and its guests
//    rate harder than Airbnb's. Blended numbers are shown, but the channel split is always there so
//    a unit that is only sold on Booking.com is not mistaken for a problem unit.
// 4. NOT EVERY STAR IS OPS. Airbnb category ratings split cleanly: cleanliness and check-in are the
//    field team's, accuracy and value belong to the listing and the price, location nobody can fix.
//    Ops-controllable is separated from the rest so the sheet points at someone who can act.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { buildingOf } from '@/lib/geo-areas'
import { setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_N = 5           // reviews needed before a unit is ranked
const SHRINK = 5          // strength of the pull toward the portfolio mean
const MIN_TURNS = 10      // cleans needed before a cleaner appears in the coaching view

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)
}
function round(n: number, p = 2) { const f = Math.pow(10, p); return Math.round(n * f) / f }

type Agg = { n: number; sum: number; five: number; low: number }
const emptyAgg = (): Agg => ({ n: 0, sum: 0, five: 0, low: 0 })
function push(a: Agg, rating: number) {
  a.n++; a.sum += rating
  if (rating >= 4.9) a.five++
  if (rating <= 3) a.low++
}
function summarise(a: Agg, mean: number) {
  if (!a.n) return { n: 0, avg: null, fiveShare: null, lowCount: 0, score: null }
  return {
    n: a.n,
    avg: round(a.sum / a.n),
    fiveShare: round((a.five / a.n) * 100, 1),
    lowCount: a.low,
    // shrunk toward the portfolio mean so a 2-review unit cannot top or bottom a league table
    score: round((SHRINK * mean + a.sum) / (SHRINK + a.n)),
  }
}

// Airbnb hands us per-category ratings with the guest's own comment and machine-readable tags.
// Everything the field team can actually act on lives here.
const OPS_CATEGORIES = new Set(['cleanliness', 'checkin', 'check_in', 'communication'])
function categoriesOf(raw: any): { key: string; rating: number; comment: string; tags: string[] }[] {
  const rr = (raw && (raw.rawReview || raw.raw)) || {}
  const arr = rr.category_ratings || rr.categoryRatings || rr.categories
  if (!Array.isArray(arr)) return []
  const out: any[] = []
  for (const c of arr) {
    const key = str(c && (c.category || c.name)).toLowerCase().replace(/\s+/g, '_')
    const rating = Number(c && (c.rating ?? c.value))
    if (!key || !Number.isFinite(rating)) continue
    out.push({
      key, rating,
      comment: str(c && c.comment).slice(0, 200),
      tags: Array.isArray(c && c.review_category_tags) ? c.review_category_tags.map((t: any) => str(t)) : [],
    })
  }
  return out
}
// A tag reads like GUEST_REVIEW_HOST_NEGATIVE_UNEXPECTED_FEES; nobody should have to decode that.
function humanTag(t: string): string {
  return str(t)
    .replace(/^GUEST_REVIEW_HOST_(NEGATIVE|POSITIVE)_/, '')
    .replace(/^CLEANLINESS_/, 'Cleanliness: ')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^(.)/, (m) => m.toUpperCase())
}
function replyMinutes(raw: any): number | null {
  const rr = (raw && (raw.rawReview || raw.raw)) || {}
  const a = new Date(str(rr.submitted_at || rr.submittedAt || (raw && raw.createdAt))).getTime()
  const b = new Date(str(rr.responded_at || rr.respondedAt)).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.round((b - a) / 60000)
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Cleanliness by cleaner is a coaching tool, not a leaderboard: owner + GM workspaces only.
  const canSeeCleaners = access.role === 'admin' || access.workspace === 'gm' || access.workspace === 'admin'

  const sp = req.nextUrl.searchParams
  const market = str(sp.get('market')) || 'all'
  const building = str(sp.get('building')) || 'all'
  const channel = str(sp.get('channel')) || 'all'
  const today = ymd(new Date())
  // Either a rolling window (days) or an explicit from/to. The comparison period is always the same
  // length immediately before, so "vs prior" means something whichever way the dates were chosen.
  const isRange = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('from'))) && /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('to')))
  const to = isRange ? str(sp.get('to')) : today
  const from = isRange ? str(sp.get('from')) : addDays(today, -Math.min(Math.max(Number(sp.get('days') || 90), 7), 1095))
  const days = Math.max(1, daysBetween(from, to))
  const prevFrom = addDays(from, -days)
  const db = supabaseAdmin()

  // PostgREST caps ANY single request at 1000 rows regardless of .limit(), so both of these are
  // paged. The first version of this route reported exactly 1000 reviews and a 149% review rate —
  // the classic symptom, and the same truncation bug that made the day sheet lie.
  async function page(table: string, select: string, apply: (q: any) => any): Promise<any[]> {
    const out: any[] = []
    for (let i = 0; i < 12; i++) {
      const q = apply(db.from(table).select(select)).range(i * 1000, i * 1000 + 999)
      const { data, error } = await q
      if (error) break
      const rows = (data || []) as any[]
      out.push(...rows)
      if (rows.length < 1000) break
    }
    return out
  }
  const [reviewRows, lRes, stayRows] = await Promise.all([
    page('guesty_reviews', 'id,listing_id,rating,content,channel,guest_name,created_at,has_reply,dismissed,excluded_from_score,raw',
      q => q.gte('created_at', prevFrom + 'T00:00:00Z').order('created_at', { ascending: false })),
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status'),
    // Review RATE needs a denominator: stays that ENDED early enough to have been reviewed. Guests
    // take up to a fortnight to write one, so the window is shifted back rather than matched exactly.
    page('guesty_reservations', 'id,listing_id,check_out,status',
      q => q.gte('check_out', addDays(from, -14)).lte('check_out', addDays(to, -3)).order('check_out', { ascending: false })),
  ])
  const rRes = { data: reviewRows }
  const resRes = { data: stayRows }

  const lmap: Record<string, any> = {}
  for (const l of ((lRes.data || []) as any[])) {
    const name = l.nickname || l.title || 'Unit'
    // The raw Guesty `building` field is per-listing text and produced 65 "buildings" — unusable as
    // a grouping. buildingOf() is the same rollup the areas and glitch boards use.
    lmap[String(l.id)] = {
      name, building: buildingOf(str(l.building)) || buildingOf(name) || str(l.building) || 'Other',
      market: marketOf(l.building, l.address_city, name),
      active: str(l.status).trim().toLowerCase() === 'active',
    }
  }
  // Can a human actually reply to this review? Mirrors app/api/reviews/route.ts exactly:
  // an inactive/dead listing, a Waves unit, or a review the channel will not accept a response on
  // is not "awaiting" anything — counting it just manufactures phantom work.
  const replyable = (lid: string, r: any) => {
    if (r && r.excluded_from_score) return false
    const li = lmap[lid]
    if (!li) return false
    if (!li.active) return false
    if (str(li.building).toLowerCase() === 'waves') return false
    return true
  }

  const inScope = (lid: string) => {
    const li = lmap[lid]
    if (!li) return market === 'all' && building === 'all'
    if (market !== 'all' && li.market !== market) return false
    if (building !== 'all' && li.building !== building) return false
    return true
  }

  const all = ((rRes.data || []) as any[])
    .filter(r => Number.isFinite(Number(r.rating)) && inScope(String(r.listing_id)))
    .filter(r => channel === 'all' || str(r.channel) === channel)
  const cur = all.filter(r => { const d = str(r.created_at).slice(0, 10); return d >= from && d <= to })
  const prev = all.filter(r => { const d = str(r.created_at).slice(0, 10); return d >= prevFrom && d < from })

  // Portfolio mean drives the shrinkage for every ranked list below.
  const mean = cur.length ? cur.reduce((s, r) => s + Number(r.rating), 0) / cur.length : 4.7

  const overall = emptyAgg(), overallPrev = emptyAgg()
  const byUnit: Record<string, Agg> = {}, byBuilding: Record<string, Agg> = {}
  const byUnitPrev: Record<string, Agg> = {}, byBuildingPrev: Record<string, Agg> = {}
  const byChannel: Record<string, Agg> = {}
  const byMonth: Record<string, Agg> = {}
  const cat: Record<string, { n: number; sum: number }> = {}
  const tagCount: Record<string, number> = {}
  // DRILL-DOWN DETAIL. A count on its own ("needs maintenance 7") tells nobody where to go. For every
  // theme and every category we also keep WHICH units it came from and a few of the guests' own words,
  // so clicking the number lands on the listings that caused it.
  const tagDetail: Record<string, { byUnit: Record<string, number>; samples: any[] }> = {}
  const catByUnit: Record<string, Record<string, { n: number; sum: number }>> = {}
  const replyTimes: number[] = []
  let replied = 0

  for (const r of cur) {
    const rating = Number(r.rating)
    const lid = String(r.listing_id)
    const li = lmap[lid] || { name: 'Unknown unit', building: 'Other' }
    push(overall, rating)
    push(byUnit[lid] = byUnit[lid] || emptyAgg(), rating)
    push(byBuilding[li.building] = byBuilding[li.building] || emptyAgg(), rating)
    push(byChannel[str(r.channel) || 'Other'] = byChannel[str(r.channel) || 'Other'] || emptyAgg(), rating)
    push(byMonth[str(r.created_at).slice(0, 7)] = byMonth[str(r.created_at).slice(0, 7)] || emptyAgg(), rating)
    if (r.has_reply) { replied++; const m = replyMinutes(r.raw); if (m != null) replyTimes.push(m) }
    for (const c of categoriesOf(r.raw)) {
      const k = c.key === 'check_in' ? 'checkin' : c.key
      const e = cat[k] = cat[k] || { n: 0, sum: 0 }
      e.n++; e.sum += c.rating
      const cu = catByUnit[k] = catByUnit[k] || {}
      const cue = cu[lid] = cu[lid] || { n: 0, sum: 0 }
      cue.n++; cue.sum += c.rating
      // only NEGATIVE experiences are worth counting as themes
      if (c.rating <= 4) for (const t of c.tags) {
        const h = humanTag(t)
        tagCount[h] = (tagCount[h] || 0) + 1
        const td = tagDetail[h] = tagDetail[h] || { byUnit: {}, samples: [] }
        td.byUnit[lid] = (td.byUnit[lid] || 0) + 1
        if (td.samples.length < 6) td.samples.push({
          listingId: lid, unit: li.name, at: str(r.created_at).slice(0, 10),
          rating, catRating: c.rating, channel: str(r.channel),
          comment: (c.comment || str(r.content)).slice(0, 220),
        })
      }
    }
  }
  for (const r of prev) {
    const rating = Number(r.rating)
    const lid = String(r.listing_id)
    const li = lmap[lid] || { building: 'Other' }
    push(overallPrev, rating)
    push(byUnitPrev[lid] = byUnitPrev[lid] || emptyAgg(), rating)
    push(byBuildingPrev[li.building] = byBuildingPrev[li.building] || emptyAgg(), rating)
  }

  const delta = (a: Agg, b: Agg) => (a.n && b.n ? round(a.sum / a.n - b.sum / b.n) : null)

  const units = Object.keys(byUnit).map(lid => {
    const li = lmap[lid] || { name: 'Unknown unit', building: 'Other', market: '' }
    const s = summarise(byUnit[lid], mean)
    return {
      listingId: lid, unit: li.name, building: li.building, market: li.market,
      ...s, change: delta(byUnit[lid], byUnitPrev[lid] || emptyAgg()), ranked: byUnit[lid].n >= MIN_N,
    }
  })
  const buildings = Object.keys(byBuilding).map(b => ({
    building: b, ...summarise(byBuilding[b], mean),
    change: delta(byBuilding[b], byBuildingPrev[b] || emptyAgg()),
  })).sort((a, b) => (a.score ?? 9) - (b.score ?? 9))

  // ---- CLEANLINESS BY CLEANER (gated). review -> reservation -> that day's clean -> assignees.
  let cleaners: any[] = []
  if (canSeeCleaners) {
    try {
      const link: { resId: string; rating: number; unit: string; listingId: string; at: string; comment: string }[] = []
      for (const r of cur) {
        const c = categoriesOf(r.raw).find(x => x.key === 'cleanliness')
        if (!c) continue
        const rid = str((r.raw && (r.raw.reservationId || r.raw.reservation_id)) || '')
        if (!rid) continue
        link.push({
          resId: rid, rating: c.rating, listingId: String(r.listing_id),
          unit: (lmap[String(r.listing_id)] || {}).name || 'Unit',
          at: str(r.created_at).slice(0, 10),
          comment: (c.comment || str(r.content)).slice(0, 220),
        })
      }
      const ids = Array.from(new Set(link.map(l => l.resId)))
      const resById: Record<string, any> = {}
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from('guesty_reservations').select('id,listing_id,check_out').in('id', ids.slice(i, i + 200))
        for (const x of ((data || []) as any[])) resById[String(x.id)] = x
      }
      const pairs = link.map(l => resById[l.resId]).filter(Boolean)
      const listingIds = Array.from(new Set(pairs.map((p: any) => String(p.listing_id))))
      // The clean is usually scheduled ON the checkout date, but a moved clean lands a day either
      // side. Matching only the exact date found almost nothing, so the window is +/- 1 day and the
      // closest one wins.
      const dateSet = new Set<string>()
      for (const p of pairs as any[]) {
        const d0 = str(p.check_out).slice(0, 10); if (!d0) continue
        dateSet.add(d0); dateSet.add(addDays(d0, -1)); dateSet.add(addDays(d0, 1))
      }
      const dates = Array.from(dateSet)
      const taskByKey: Record<string, any> = {}
      if (listingIds.length && dates.length) {
        for (let i = 0; i < listingIds.length; i += 40) {
          const { data } = await db.from('breezeway_tasks_sync')
            .select('reference_property_id,scheduled_date,name,assignees,status')
            .in('reference_property_id', listingIds.slice(i, i + 40))
            .in('scheduled_date', dates.slice(0, 400))
            .limit(1000)
          for (const t of ((data || []) as any[])) {
            const nm = str(t.name)
            if (!/clean/i.test(nm) || /strip|walk-?through|inspect/i.test(nm)) continue
            taskByKey[String(t.reference_property_id) + '|' + str(t.scheduled_date).slice(0, 10)] = t
          }
        }
      }
      // Per person we keep not just the average but the UNIT BREAKDOWN — the coaching conversation is
      // "you score 4.9 everywhere except 1201, where you're 4.2 across six departures", which needs
      // the per-unit split, not a single number.
      type Person = { n: number; sum: number; worst: any[]; units: Record<string, { n: number; sum: number; low: number; last: string }> }
      const byPerson: Record<string, Person> = {}
      for (const l of link) {
        const res = resById[l.resId]; if (!res) continue
        const d0 = str(res.check_out).slice(0, 10)
        const t = taskByKey[String(res.listing_id) + '|' + d0]
          || taskByKey[String(res.listing_id) + '|' + addDays(d0, 1)]
          || taskByKey[String(res.listing_id) + '|' + addDays(d0, -1)]
        if (!t) continue
        const who = (Array.isArray(t.assignees) ? t.assignees : []).map((p: any) => str(p.name)).filter(Boolean)
        for (const person of who) {
          const e = byPerson[person] = byPerson[person] || { n: 0, sum: 0, worst: [], units: {} }
          e.n++; e.sum += l.rating
          const u = e.units[l.listingId] = e.units[l.listingId] || { n: 0, sum: 0, low: 0, last: '' }
          u.n++; u.sum += l.rating
          if (l.rating <= 4) u.low++
          if (l.at > u.last) u.last = l.at
          if (l.rating <= 4) e.worst.push({ unit: l.unit, listingId: l.listingId, at: l.at, rating: l.rating, comment: l.comment })
        }
      }
      const cMean = Object.values(byPerson).reduce((s, e) => s + e.sum, 0) / Math.max(1, Object.values(byPerson).reduce((s, e) => s + e.n, 0))
      cleaners = Object.keys(byPerson).map(name => {
        const e = byPerson[name]
        const avg = round(e.sum / e.n)
        // Worst units first: that is the order you coach in. `gap` is this person's average on that
        // unit against their own overall — it separates "this unit is hard" from "this person slipped".
        const unitRows = Object.keys(e.units).map(lid => {
          const u = e.units[lid]
          const uAvg = round(u.sum / u.n)
          return {
            listingId: lid, unit: (lmap[lid] || {}).name || 'Unit', building: (lmap[lid] || {}).building || 'Other',
            turns: u.n, avg: uAvg, low: u.low, last: u.last, gap: round(uAvg - avg),
          }
        }).sort((a, b) => a.avg - b.avg)
        return {
          name, turns: e.n, avg,
          score: round((SHRINK * (cMean || 4.7) + e.sum) / (SHRINK + e.n)),
          ranked: e.n >= MIN_TURNS,
          units: unitRows,
          unitCount: unitRows.length,
          lowCount: e.worst.length,
          flagged: e.worst.sort((a, b) => (a.rating - b.rating) || (a.at < b.at ? 1 : -1)).slice(0, 6),
        }
      }).sort((a, b) => a.score - b.score)
    } catch { cleaners = [] }
  }

  // ---- DID THE INSPECTION ACTUALLY WORK? (gated)
  //
  // An inspection is only worth its hour if the next guest does not complain. So each inspection is
  // scored against what happened AFTER it: reviews for that unit in the following AFTER_DAYS.
  //   held   - the unit got reviews and none of them were bad. The walk did its job.
  //   missed - a guest still left a 3-or-below. Something was there and it was not caught.
  //   lift   - the unit's review average after the walk minus the average before it.
  // Inspections too recent to have collected a review yet are counted but NOT judged (covered), so
  // nobody's rate is dragged down by work the guests have not reacted to.
  //
  // RUBBER-STAMP is the sharp one: an inspector whose own scores are near-perfect while guests
  // score the same units below the portfolio is passing units that are not passing.
  let inspectors: any[] = []
  if (canSeeCleaners) {
    try {
      const AFTER = 45, BEFORE = 45, MIN_INSP = 5
      const { data: inspRows } = await db.from('unit_inspections')
        .select('id,unit,inspector,rating,inspected_on,follow_up')
        .gte('inspected_on', addDays(from, -BEFORE)).lte('inspected_on', to)
        .order('inspected_on', { ascending: false }).limit(2000)

      // unit_inspections is keyed by the unit NAME the coordinator typed, not by listing id.
      const byName: Record<string, string> = {}
      for (const id of Object.keys(lmap)) byName[str(lmap[id].name).trim().toLowerCase()] = id

      const revByListing: Record<string, any[]> = {}
      for (const r of all) { const k = str(r.listing_id); (revByListing[k] = revByListing[k] || []).push(r) }
      for (const k of Object.keys(revByListing)) revByListing[k].sort((a, b) => (str(a.created_at) < str(b.created_at) ? -1 : 1))

      type Insp = { n: number; given: number[]; covered: number; held: number; missed: number; followUps: number; afterSum: number; afterN: number; liftSum: number; liftN: number; misses: any[] }
      const byInspector: Record<string, Insp> = {}

      for (const ins of ((inspRows || []) as any[])) {
        const who = str(ins.inspector).trim()
        if (!who) continue
        const lid = byName[str(ins.unit).trim().toLowerCase()]
        if (!lid || !inScope(lid)) continue
        const d0 = str(ins.inspected_on).slice(0, 10)
        if (!d0) continue

        const e = byInspector[who] = byInspector[who] || { n: 0, given: [], covered: 0, held: 0, missed: 0, followUps: 0, afterSum: 0, afterN: 0, liftSum: 0, liftN: 0, misses: [] }
        e.n++
        const given = Number(ins.rating)
        if (Number.isFinite(given)) e.given.push(given)
        if (ins.follow_up) e.followUps++

        const revs = revByListing[lid] || []
        const afterEnd = addDays(d0, AFTER), beforeStart = addDays(d0, -BEFORE)
        const after = revs.filter(r => { const d = str(r.created_at).slice(0, 10); return d > d0 && d <= afterEnd })
        if (!after.length) continue                 // no guest verdict yet — counted, not judged
        e.covered++
        const aAvg = after.reduce((s, r) => s + Number(r.rating), 0) / after.length
        e.afterSum += aAvg; e.afterN++

        const bad = after.filter(r => Number(r.rating) <= 3).sort((a, b) => Number(a.rating) - Number(b.rating))[0]
        if (bad) {
          e.missed++
          e.misses.push({
            unit: (lmap[lid] || {}).name || 'Unit', listingId: lid, inspected: d0,
            at: str(bad.created_at).slice(0, 10), rating: Number(bad.rating),
            given: Number.isFinite(given) ? given : null,
            comment: str(bad.content).replace(/\s+/g, ' ').trim().slice(0, 200),
          })
        } else e.held++

        const before = revs.filter(r => { const d = str(r.created_at).slice(0, 10); return d >= beforeStart && d < d0 })
        if (before.length) {
          const bAvg = before.reduce((s, r) => s + Number(r.rating), 0) / before.length
          e.liftSum += (aAvg - bAvg); e.liftN++
        }
      }

      inspectors = Object.keys(byInspector).map(name => {
        const e = byInspector[name]
        const avgGiven = e.given.length ? round(e.given.reduce((s, x) => s + x, 0) / e.given.length) : null
        const guestAfter = e.afterN ? round(e.afterSum / e.afterN) : null
        return {
          name, inspections: e.n, covered: e.covered, held: e.held, missed: e.missed, followUps: e.followUps,
          holdRate: e.covered ? round((e.held / e.covered) * 100, 1) : null,
          lift: e.liftN ? round(e.liftSum / e.liftN) : null,
          avgGiven, guestAfter,
          rubberStamp: !!(avgGiven != null && guestAfter != null && avgGiven >= 4.8 && guestAfter < mean - 0.15 && e.covered >= 3),
          ranked: e.n >= MIN_INSP,
          misses: e.misses.sort((a, b) => a.rating - b.rating).slice(0, 6),
        }
      }).sort((a, b) => {
        if (a.ranked !== b.ranked) return a.ranked ? -1 : 1
        return (a.holdRate == null ? 101 : a.holdRate) - (b.holdRate == null ? 101 : b.holdRate)
      })
      // Portfolio hold rate, so an individual number has something to be compared against.
      const cov = inspectors.reduce((s, i) => s + i.covered, 0)
      const hel = inspectors.reduce((s, i) => s + i.held, 0)
      ;(inspectors as any).portfolioHoldRate = cov ? round((hel / cov) * 100, 1) : null
    } catch { inspectors = [] }
  }

  // PORTFOLIO CATEGORY BENCHMARK, saved for the field.
  // The intel block a cleaner or inspector gets names the ONE category a unit is behind the
  // portfolio on — which needs a portfolio number, and computing that inside a push would mean
  // sweeping every review in the account while somebody waits. This page already has it, so it
  // writes it down. Only from the unfiltered view: a benchmark taken from one building is not a
  // benchmark. Fire-and-forget — a failed write must never affect the dashboard.
  if (market === 'all' && building === 'all' && channel === 'all' && overall.n >= 100) {
    const bench: Record<string, number> = {}
    for (const k of Object.keys(cat)) if (cat[k].n >= 20) bench[k] = round(cat[k].sum / cat[k].n)
    if (Object.keys(bench).length) {
      try { await setSetting('review_category_benchmark', bench, 'reviews-kpi') } catch (e) { console.error('kpi: benchmark save failed', e) }
    }
  }

  // Review RATE — a quiet unit is not a happy unit, it is an unmeasured one.
  const stays = ((resRes.data || []) as any[]).filter(r => !/cancel|declin|inquir|expire/i.test(str(r.status)) && inScope(String(r.listing_id)))
  const months = Object.keys(byMonth).sort().slice(-13).map(m => ({ month: m, ...summarise(byMonth[m], mean) }))

  return NextResponse.json({
    ok: true, days, from, to, market, building, channel,
    channelList: Array.from(new Set(((rRes.data || []) as any[]).map(r => str(r.channel)).filter(Boolean))).sort(),
    markets: Array.from(new Set(Object.values(lmap).map((l: any) => l.market).filter(Boolean))).sort(),
    buildingList: Array.from(new Set(Object.values(lmap).map((l: any) => l.building).filter(Boolean))).sort(),
    headline: {
      ...summarise(overall, mean),
      prevAvg: overallPrev.n ? round(overallPrev.sum / overallPrev.n) : null,
      prevFiveShare: overallPrev.n ? round((overallPrev.five / overallPrev.n) * 100, 1) : null,
      change: delta(overall, overallPrev),
      replyCoverage: overall.n ? round((replied / overall.n) * 100, 1) : null,
      medianReplyHours: replyTimes.length ? round(replyTimes.sort((a, b) => a - b)[Math.floor(replyTimes.length / 2)] / 60, 1) : null,
      // Still waiting excludes reviews the team dismissed ('no reply needed') so this number
      // agrees with the Mission Control tile instead of quietly counting closed-out reviews.
      // AWAITING = work someone can actually do (same rule as the /reviews feed): skip dismissed,
      // skip inactive/unsynced listings, skip Waves, skip channel-unreplyable. Re-applied 2026-08-04
      // after a parallel edit reverted it — if you touch this line, keep the replyable() filter.
      awaitingReply: cur.filter(r => !r.has_reply && !r.dismissed && replyable(String(r.listing_id), r)).length,
      staysEnded: stays.length,
      reviewRate: stays.length ? round((overall.n / stays.length) * 100, 1) : null,
      reviewRateNote: 'reviews received in this window against stays that ended in time to be reviewed',
    },
    months,
    buildings,
    units: units.filter(u => u.ranked).sort((a, b) => (a.score ?? 9) - (b.score ?? 9)),
    unranked: units.filter(u => !u.ranked).sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9)),
    channels: Object.keys(byChannel).map(c => ({ channel: c, ...summarise(byChannel[c], mean) })).sort((a, b) => b.n - a.n),
    categories: Object.keys(cat).map(k => {
      const uRows = Object.keys(catByUnit[k] || {}).map(lid => {
        const u = catByUnit[k][lid]
        return {
          listingId: lid, unit: (lmap[lid] || {}).name || 'Unknown unit',
          building: (lmap[lid] || {}).building || 'Other', n: u.n, avg: round(u.sum / u.n),
        }
      }).sort((a, b) => a.avg - b.avg)
      return {
        key: k, label: k.charAt(0).toUpperCase() + k.slice(1),
        avg: round(cat[k].sum / cat[k].n), n: cat[k].n, ops: OPS_CATEGORIES.has(k),
        units: uRows.slice(0, 10), unitCount: uRows.length,
      }
    }).sort((a, b) => a.avg - b.avg),
    themes: Object.keys(tagCount).map(t => {
      const td = tagDetail[t] || { byUnit: {}, samples: [] }
      const uRows = Object.keys(td.byUnit).map(lid => ({
        listingId: lid, unit: (lmap[lid] || {}).name || 'Unknown unit',
        building: (lmap[lid] || {}).building || 'Other', n: td.byUnit[lid],
      })).sort((a, b) => b.n - a.n)
      return { tag: t, n: tagCount[t], units: uRows.slice(0, 10), unitCount: uRows.length, samples: td.samples.slice(0, 4) }
    }).sort((a, b) => b.n - a.n).slice(0, 12),
    cleaners: canSeeCleaners ? cleaners : null,
    inspectors: canSeeCleaners ? inspectors : null,
    inspectorHoldRate: canSeeCleaners ? ((inspectors as any).portfolioHoldRate ?? null) : null,
    minReviews: MIN_N, minTurns: MIN_TURNS, minInspections: 5, inspectionWindow: 45,
  })
}

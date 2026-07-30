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

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_N = 5           // reviews needed before a unit is ranked
const SHRINK = 5          // strength of the pull toward the portfolio mean
const MIN_TURNS = 10      // cleans needed before a cleaner appears in the coaching view

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
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
  const days = Math.min(Math.max(Number(sp.get('days') || 90), 7), 1095)
  const market = str(sp.get('market')) || 'all'
  const building = str(sp.get('building')) || 'all'
  const today = ymd(new Date())
  const from = addDays(today, -days)
  const prevFrom = addDays(today, -days * 2)
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
    page('guesty_reviews', 'id,listing_id,rating,content,channel,guest_name,created_at,has_reply,raw',
      q => q.gte('created_at', prevFrom + 'T00:00:00Z').order('created_at', { ascending: false })),
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status'),
    // Review RATE needs a denominator: stays that ENDED early enough to have been reviewed. Guests
    // take up to a fortnight to write one, so the window is shifted back rather than matched exactly.
    page('guesty_reservations', 'id,listing_id,check_out,status',
      q => q.gte('check_out', addDays(from, -14)).lte('check_out', addDays(today, -3)).order('check_out', { ascending: false })),
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
  const inScope = (lid: string) => {
    const li = lmap[lid]
    if (!li) return market === 'all' && building === 'all'
    if (market !== 'all' && li.market !== market) return false
    if (building !== 'all' && li.building !== building) return false
    return true
  }

  const all = ((rRes.data || []) as any[]).filter(r => Number.isFinite(Number(r.rating)) && inScope(String(r.listing_id)))
  const cur = all.filter(r => str(r.created_at).slice(0, 10) >= from)
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
      // only NEGATIVE experiences are worth counting as themes
      if (c.rating <= 4) for (const t of c.tags) { const h = humanTag(t); tagCount[h] = (tagCount[h] || 0) + 1 }
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
      const link: { resId: string; rating: number; unit: string; at: string; comment: string }[] = []
      for (const r of cur) {
        const c = categoriesOf(r.raw).find(x => x.key === 'cleanliness')
        if (!c) continue
        const rid = str((r.raw && (r.raw.reservationId || r.raw.reservation_id)) || '')
        if (!rid) continue
        link.push({ resId: rid, rating: c.rating, unit: (lmap[String(r.listing_id)] || {}).name || 'Unit', at: str(r.created_at).slice(0, 10), comment: c.comment })
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
      const byPerson: Record<string, { n: number; sum: number; worst: any[] }> = {}
      for (const l of link) {
        const res = resById[l.resId]; if (!res) continue
        const d0 = str(res.check_out).slice(0, 10)
        const t = taskByKey[String(res.listing_id) + '|' + d0]
          || taskByKey[String(res.listing_id) + '|' + addDays(d0, 1)]
          || taskByKey[String(res.listing_id) + '|' + addDays(d0, -1)]
        if (!t) continue
        const who = (Array.isArray(t.assignees) ? t.assignees : []).map((p: any) => str(p.name)).filter(Boolean)
        for (const person of who) {
          const e = byPerson[person] = byPerson[person] || { n: 0, sum: 0, worst: [] }
          e.n++; e.sum += l.rating
          if (l.rating <= 4) e.worst.push({ unit: l.unit, at: l.at, rating: l.rating, comment: l.comment })
        }
      }
      const cMean = Object.values(byPerson).reduce((s, e) => s + e.sum, 0) / Math.max(1, Object.values(byPerson).reduce((s, e) => s + e.n, 0))
      cleaners = Object.keys(byPerson).map(name => {
        const e = byPerson[name]
        return {
          name, turns: e.n, avg: round(e.sum / e.n),
          score: round((SHRINK * (cMean || 4.7) + e.sum) / (SHRINK + e.n)),
          ranked: e.n >= MIN_TURNS,
          flagged: e.worst.sort((a, b) => a.rating - b.rating).slice(0, 4),
        }
      }).sort((a, b) => a.score - b.score)
    } catch { cleaners = [] }
  }

  // Review RATE — a quiet unit is not a happy unit, it is an unmeasured one.
  const stays = ((resRes.data || []) as any[]).filter(r => !/cancel|declin|inquir|expire/i.test(str(r.status)) && inScope(String(r.listing_id)))
  const months = Object.keys(byMonth).sort().slice(-13).map(m => ({ month: m, ...summarise(byMonth[m], mean) }))

  return NextResponse.json({
    ok: true, days, from, to: today, market, building,
    markets: Array.from(new Set(Object.values(lmap).map((l: any) => l.market).filter(Boolean))).sort(),
    buildingList: Array.from(new Set(Object.values(lmap).map((l: any) => l.building).filter(Boolean))).sort(),
    headline: {
      ...summarise(overall, mean),
      prevAvg: overallPrev.n ? round(overallPrev.sum / overallPrev.n) : null,
      prevFiveShare: overallPrev.n ? round((overallPrev.five / overallPrev.n) * 100, 1) : null,
      change: delta(overall, overallPrev),
      replyCoverage: overall.n ? round((replied / overall.n) * 100, 1) : null,
      medianReplyHours: replyTimes.length ? round(replyTimes.sort((a, b) => a - b)[Math.floor(replyTimes.length / 2)] / 60, 1) : null,
      awaitingReply: cur.filter(r => !r.has_reply).length,
      staysEnded: stays.length,
      reviewRate: stays.length ? round((overall.n / stays.length) * 100, 1) : null,
      reviewRateNote: 'reviews received in this window against stays that ended in time to be reviewed',
    },
    months,
    buildings,
    units: units.filter(u => u.ranked).sort((a, b) => (a.score ?? 9) - (b.score ?? 9)),
    unranked: units.filter(u => !u.ranked).sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9)),
    channels: Object.keys(byChannel).map(c => ({ channel: c, ...summarise(byChannel[c], mean) })).sort((a, b) => b.n - a.n),
    categories: Object.keys(cat).map(k => ({
      key: k, label: k.charAt(0).toUpperCase() + k.slice(1),
      avg: round(cat[k].sum / cat[k].n), n: cat[k].n, ops: OPS_CATEGORIES.has(k),
    })).sort((a, b) => a.avg - b.avg),
    themes: Object.keys(tagCount).map(t => ({ tag: t, n: tagCount[t] })).sort((a, b) => b.n - a.n).slice(0, 12),
    cleaners: canSeeCleaners ? cleaners : null,
    minReviews: MIN_N, minTurns: MIN_TURNS,
  })
}

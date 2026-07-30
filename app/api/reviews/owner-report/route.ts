// OWNER COMPLAINT REPORT — the case for spending money on a unit, made out of the guests' own words.
//
// Jon's rule: an owner never sees a single review. One bad night reads as blame and proves nothing.
// What moves an owner is the PATTERN — "nine of your last forty-one guests mentioned the sofa bed"
// — with their words attached and a specific fix named. So this aggregates, quotes, and recommends.
//
// Everything here is countable. No invented dollar figures: the argument is the guest count, the
// rating gap against the rest of the portfolio, and what it takes to close it.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
function round(n: number, p = 2) { const f = Math.pow(10, p); return Math.round(n * f) / f }

// Guest complaints cluster into a handful of things an owner can actually buy their way out of.
// Each theme carries the fix, because "guests mention the bed" without "replace the mattress" is
// just a complaint forwarded.
const THEMES: { key: string; label: string; re: RegExp; fix: string; owner: boolean }[] = [
  { key: 'bed', label: 'Bed & mattress comfort', re: /mattress|bed was|beds were|uncomfortable bed|sofa ?bed|pull-?out|springs|saggy|sagging/i,
    fix: 'Replace the mattress or sofa bed. This is the single most common reason a guest drops a star and it cannot be cleaned away.', owner: true },
  { key: 'noise', label: 'Noise', re: /noise|noisy|loud|thin walls|street sound|construction|traffic|barking/i,
    fix: 'Acoustic curtains, door sweeps and a white-noise machine. Where the noise is structural, say so in the listing so guests self-select.', owner: true },
  { key: 'ac', label: 'Air conditioning & temperature', re: /a\/?c\b|air con|aircon|hot in|too warm|too hot|cooling|humid|stuffy|heater|freezing/i,
    fix: 'Service or replace the unit and add a smart thermostat. Temperature complaints correlate with the lowest scores of any category.', owner: true },
  { key: 'wifi', label: 'Wi-Fi & connectivity', re: /wi-?fi|internet|connection|streaming|router|signal/i,
    fix: 'Upgrade the plan and add a mesh access point. Remote workers rate on this alone.', owner: true },
  { key: 'kitchen', label: 'Kitchen & appliances', re: /kitchen|stove|oven|fridge|refrigerator|microwave|dishwasher|cookware|pans|utensils|coffee/i,
    fix: 'Replace failing appliances and restock cookware to a full set.', owner: true },
  { key: 'bathroom', label: 'Bathroom & water', re: /shower|water pressure|hot water|toilet|drain|sink|leak|mold|mould|grout/i,
    fix: 'Plumbing pass: pressure, hot-water recovery, re-grout and re-seal.', owner: true },
  { key: 'furniture', label: 'Furniture & finishes', re: /furniture|sofa|couch|chair|table|worn|scuff|stain|paint|dated|tired|old/i,
    fix: 'Refresh the tired pieces and repaint. Guests read "dated" as "not worth the price".', owner: true },
  { key: 'smell', label: 'Smell & damp', re: /smell|odou?r|musty|damp|mildew|cigarette|smoke/i,
    fix: 'Deep clean, replace soft furnishings that hold odour, and add a dehumidifier.', owner: true },
  { key: 'cleanliness', label: 'Cleanliness', re: /dirty|not clean|unclean|dust|hair|grimy|filthy|stained/i,
    fix: 'Ours to fix, not yours — we are addressing this with the cleaning team and inspections.', owner: false },
  { key: 'checkin', label: 'Check-in & access', re: /check-?in|lockbox|key|code|access|entry|door lock|couldn.?t get in/i,
    fix: 'Ours to fix, not yours — access process and lock hardware.', owner: false },
]

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const listingId = str(sp.get('listingId'))
  const building = str(sp.get('building'))
  const days = Math.min(Math.max(Number(sp.get('days') || 365), 30), 1460)
  const today = ymd(new Date())
  const from = addDays(today, -days)
  const prevFrom = addDays(from, -days)
  const db = supabaseAdmin()

  const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,address_city,status')
  const lmap: Record<string, any> = {}
  for (const l of ((lRows || []) as any[])) {
    lmap[String(l.id)] = { name: l.nickname || l.title || 'Unit', building: str(l.building), active: str(l.status).toLowerCase() === 'active' }
  }
  // Which units are we reporting on? One listing, or every listing in a building.
  const ids = listingId ? [listingId]
    : Object.keys(lmap).filter(id => building && str(lmap[id].building).toLowerCase().includes(building.toLowerCase()))
  if (!ids.length) return NextResponse.json({ ok: false, error: 'Pick a unit or a building.' }, { status: 400 })

  // PostgREST caps at 1000 rows per request — page it, same as everywhere else.
  const page = async (apply: (q: any) => any) => {
    const out: any[] = []
    for (let i = 0; i < 8; i++) {
      const { data, error } = await apply(db.from('guesty_reviews').select('listing_id,rating,content,channel,guest_name,created_at,raw')).range(i * 1000, i * 1000 + 999)
      if (error) break
      const rows = (data || []) as any[]
      out.push(...rows)
      if (rows.length < 1000) break
    }
    return out
  }
  const mine = await page(q => q.in('listing_id', ids).gte('created_at', prevFrom + 'T00:00:00Z').order('created_at', { ascending: false }))
  // The portfolio is the benchmark: "4.4 against 4.7 across the rest of the portfolio" is the line
  // that lands, and it is fair because it is the same team cleaning both.
  const all = await page(q => q.gte('created_at', from + 'T00:00:00Z').order('created_at', { ascending: false }))

  const rated = (r: any) => Number.isFinite(Number(r.rating))
  const cur = mine.filter(r => rated(r) && str(r.created_at).slice(0, 10) >= from)
  const prev = mine.filter(r => rated(r) && str(r.created_at).slice(0, 10) < from)
  const portfolio = all.filter(rated)

  const avg = (a: any[]) => a.length ? round(a.reduce((s, r) => s + Number(r.rating), 0) / a.length) : null
  const fiveShare = (a: any[]) => a.length ? round((a.filter(r => Number(r.rating) >= 4.9).length / a.length) * 100, 1) : null

  // Category scores straight from Airbnb, so the weak spot is named rather than guessed.
  const cats: Record<string, { n: number; sum: number }> = {}
  const catsAll: Record<string, { n: number; sum: number }> = {}
  const eat = (bag: Record<string, { n: number; sum: number }>, r: any) => {
    const rr = (r.raw && (r.raw.rawReview || r.raw.raw)) || {}
    const arr = rr.category_ratings || rr.categoryRatings
    if (!Array.isArray(arr)) return
    for (const c of arr) {
      const k = str(c && c.category).toLowerCase().replace(/\s+/g, '_')
      const v = Number(c && c.rating)
      if (!k || !Number.isFinite(v)) continue
      const e = bag[k] = bag[k] || { n: 0, sum: 0 }
      e.n++; e.sum += v
    }
  }
  for (const r of cur) eat(cats, r)
  for (const r of portfolio) eat(catsAll, r)

  // THE HEART OF IT: how many guests raised each theme, in their own words.
  const themes = THEMES.map(t => {
    const hits = cur.filter(r => t.re.test(str(r.content)))
    const prevHits = prev.filter(r => t.re.test(str(r.content)))
    const quotes = hits
      .sort((a, b) => Number(a.rating) - Number(b.rating))
      .slice(0, 3)
      .map(r => ({
        rating: Number(r.rating), at: str(r.created_at).slice(0, 10), channel: str(r.channel),
        // just the sentence that mentions it — an owner should not have to read a paragraph
        text: (str(r.content).split(/(?<=[.!?])\s+/).find(x => t.re.test(x)) || str(r.content)).trim().slice(0, 220),
      }))
    return {
      key: t.key, label: t.label, fix: t.fix, ownerAction: t.owner,
      guests: hits.length,
      share: cur.length ? round((hits.length / cur.length) * 100, 1) : 0,
      avgWhenMentioned: avg(hits),
      prevGuests: prevHits.length,
      worsening: hits.length > prevHits.length,
      quotes,
    }
  }).filter(t => t.guests > 0).sort((a, b) => b.guests - a.guests)

  const unitAvg = avg(cur), portAvg = avg(portfolio)
  return NextResponse.json({
    ok: true, from, to: today, days,
    scope: listingId ? { unit: (lmap[listingId] || {}).name || 'Unit', building: (lmap[listingId] || {}).building || '' } : { unit: null, building },
    units: ids.map(id => (lmap[id] || {}).name).filter(Boolean),
    reviews: cur.length, prevReviews: prev.length,
    avg: unitAvg, fiveShare: fiveShare(cur),
    prevAvg: avg(prev), portfolioAvg: portAvg, portfolioFiveShare: fiveShare(portfolio),
    gap: unitAvg != null && portAvg != null ? round(unitAvg - portAvg) : null,
    categories: Object.keys(cats).map(k => ({
      key: k, label: k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '),
      avg: round(cats[k].sum / cats[k].n),
      portfolio: catsAll[k] ? round(catsAll[k].sum / catsAll[k].n) : null,
    })).sort((a, b) => a.avg - b.avg),
    themes,
    ownerThemes: themes.filter(t => t.ownerAction),
    oursThemes: themes.filter(t => !t.ownerAction),
  })
}

// BUILDING PATTERN TRACKER — Jon's ask (2026-08-06): "help us identify patterns at buildings."
//
// The unit-level machinery (care panel, intel blocks, review actions) answers "what is wrong with
// THIS unit". This answers the question above it: is the same thing wrong across a BUILDING —
// because three units with A/C complaints in one building is not three repairs, it is one chiller,
// one water heater, one pest treatment, one capex conversation with the owner.
//
// For every building, over a window (default 90 days) COMPARED AGAINST the window before it:
//   - negative review mentions per complaint theme (same taxonomy as everything else)
//   - guest-reported glitches per theme (open AND resolved — a fixed glitch still counts as history)
//   - open fix-jobs from the review-actions board
//   - how many DISTINCT UNITS each theme touches — 3+ units = building-level, not unit-level
//   - rising / falling vs the prior window, and the low-star trend by channel
// Read-only, signed-in users. Nothing is created here.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { THEMES, looksNegative, sentenceAbout } from '@/lib/review-themes'
import { marketOf, buildingOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymdET(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number): string { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymdET(d) }

// PostgREST caps every request at 1000 rows regardless of .limit() — page anything that can exceed it.
async function page(build: () => any, pages: number): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < pages; i++) {
    const { data, error } = await build().range(i * 1000, i * 1000 + 999)
    if (error) break
    const rows = (data || []) as any[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const sp = req.nextUrl.searchParams
    const days = Math.min(180, Math.max(14, Number(sp.get('days')) || 90))
    const today = ymdET(new Date())
    const recentFrom = addDays(today, -days)
    const priorFrom = addDays(today, -2 * days)
    const db = supabaseAdmin()

    const [listings, reviews, glitches, actsR] = await Promise.all([
      page(() => db.from('guesty_listings').select('id,nickname,title,building,unit,status,address_city'), 3),
      page(() => db.from('guesty_reviews')
        .select('listing_id,rating,content,guest_name,channel,created_at')
        .eq('excluded_from_score', false).gte('created_at', priorFrom)
        .order('created_at', { ascending: false }), 6),
      page(() => db.from('glitches').select('listing_id,unit,overview,status,created_at').gte('created_at', priorFrom), 2),
      db.from('review_actions').select('listing_id,theme_key,severity,status').in('status', ['open', 'doing']).limit(1000),
    ])

    // listing → building/market/name; dead listings keep their history attributed (reviews on a
    // delisted unit still describe the building) but do not count toward the unit total.
    const L: Record<string, { building: string; market: string; name: string; active: boolean }> = {}
    const unitsByBuilding: Record<string, number> = {}
    for (const l of listings) {
      const name = str(l.nickname || l.title || l.unit || l.id)
      const building = buildingOf(str(l.building), name) || 'Unassigned'
      const active = !DEAD.includes(str(l.status).toLowerCase())
      L[str(l.id)] = { building, market: marketOf(building, l.address_city, name), name, active }
      if (active) unitsByBuilding[building] = (unitsByBuilding[building] || 0) + 1
    }

    type Pat = {
      key: string; label: string; action: string
      revRecent: number; revPrior: number
      glRecent: number; glPrior: number
      actionsOpen: number; urgentOpen: number
      units: Set<string>
      worst: { rating: number; at: string; unit: string; quote: string } | null
    }
    type Bld = {
      building: string; market: string; units: number
      revRecent: number; revPrior: number
      sumRecent: number; sumPrior: number; ratedRecent: number; ratedPrior: number
      lowRecent: number; lowPrior: number
      lowByChannel: Record<string, number>
      patterns: Record<string, Pat>
    }
    const B: Record<string, Bld> = {}
    const bld = (building: string, market: string): Bld => B[building] = B[building] || {
      building, market, units: unitsByBuilding[building] || 0,
      revRecent: 0, revPrior: 0, sumRecent: 0, sumPrior: 0, ratedRecent: 0, ratedPrior: 0,
      lowRecent: 0, lowPrior: 0, lowByChannel: {}, patterns: {},
    }
    const pat = (b: Bld, t: (typeof THEMES)[number]): Pat => b.patterns[t.key] = b.patterns[t.key] || {
      key: t.key, label: t.label, action: t.action,
      revRecent: 0, revPrior: 0, glRecent: 0, glPrior: 0, actionsOpen: 0, urgentOpen: 0,
      units: new Set<string>(), worst: null,
    }

    // ---- reviews: rating trend + NEGATIVE theme mentions (praise must not count as a pattern) ----
    for (const r of reviews) {
      const li = L[str(r.listing_id)]
      if (!li) continue
      const b = bld(li.building, li.market)
      const at = str(r.created_at).slice(0, 10)
      const recent = at >= recentFrom
      const rating = Number(r.rating)
      if (recent) b.revRecent++; else b.revPrior++
      if (Number.isFinite(rating) && rating > 0) {
        if (recent) { b.sumRecent += rating; b.ratedRecent++ } else { b.sumPrior += rating; b.ratedPrior++ }
        if (rating <= 2) {
          if (recent) { b.lowRecent++; b.lowByChannel[str(r.channel) || '?'] = (b.lowByChannel[str(r.channel) || '?'] || 0) + 1 }
          else b.lowPrior++
        }
      }
      const content = str(r.content)
      if (!content.trim()) continue
      for (const t of THEMES) {
        if (!t.re.test(content)) continue
        const sentence = sentenceAbout(content, t.re)
        if (!looksNegative(sentence, rating)) continue
        const p = pat(b, t)
        if (recent) {
          p.revRecent++
          p.units.add(li.name)
          if (!p.worst || (Number.isFinite(rating) && rating < p.worst.rating)) {
            p.worst = { rating: Number.isFinite(rating) ? rating : 0, at, unit: li.name, quote: sentence.slice(0, 180) }
          }
        } else p.revPrior++
      }
    }

    // ---- glitches: guest-reported problems, resolved ones still count as history ----
    for (const g of glitches) {
      const li = L[str(g.listing_id)]
      if (!li) continue
      const b = bld(li.building, li.market)
      const at = str(g.created_at).slice(0, 10)
      const recent = at >= recentFrom
      const overview = str(g.overview)
      for (const t of THEMES) {
        if (!t.re.test(overview)) continue
        const p = pat(b, t)
        if (recent) { p.glRecent++; p.units.add(li.name) } else p.glPrior++
      }
    }

    // ---- open fix-jobs from the action board ----
    for (const a of (((actsR as any).data || []) as any[])) {
      const li = L[str(a.listing_id)]
      if (!li) continue
      const t = THEMES.find(x => x.key === str(a.theme_key))
      if (!t) continue
      const p = pat(bld(li.building, li.market), t)
      p.actionsOpen++
      if (str(a.severity) === 'urgent') p.urgentOpen++
    }

    // ---- shape + rank. A pattern must clear an evidence bar; a building ranks by its worst. ----
    const buildings = Object.values(B).map(b => {
      const patterns = Object.values(b.patterns)
        .map(p => {
          const recentN = p.revRecent + p.glRecent
          const priorN = p.revPrior + p.glPrior
          if (recentN < 2 && p.actionsOpen === 0) return null   // one mention is noise, not a pattern
          const unitsAffected = p.units.size
          const buildingLevel = unitsAffected >= 3
          const rising = recentN > priorN
          // severity: volume + spread + direction + urgency, weighted so building-level rises to the top
          const score = recentN + p.glRecent * 0.5 + (buildingLevel ? 4 : 0) + (rising ? 2 : 0) + p.urgentOpen * 2
          return {
            key: p.key, label: p.label, action: p.action,
            revRecent: p.revRecent, revPrior: p.revPrior, glRecent: p.glRecent, glPrior: p.glPrior,
            actionsOpen: p.actionsOpen, urgentOpen: p.urgentOpen,
            unitsAffected, unitNames: Array.from(p.units).slice(0, 5),
            rising, buildingLevel, score: Math.round(score * 10) / 10,
            worst: p.worst,
          }
        })
        .filter(Boolean)
        .sort((a: any, b2: any) => b2.score - a.score)
        .slice(0, 6)
      const avgRecent = b.ratedRecent ? Math.round((b.sumRecent / b.ratedRecent) * 100) / 100 : null
      const avgPrior = b.ratedPrior ? Math.round((b.sumPrior / b.ratedPrior) * 100) / 100 : null
      return {
        building: b.building, market: b.market, units: b.units,
        reviews: { recent: b.revRecent, prior: b.revPrior, avgRecent, avgPrior },
        lowStars: { recent: b.lowRecent, prior: b.lowPrior, byChannel: b.lowByChannel },
        patterns,
        topScore: patterns.length ? (patterns[0] as any).score : 0,
      }
    })
      .filter(b => b.patterns.length > 0 && b.building !== 'Unassigned')
      .sort((a, b2) => b2.topScore - a.topScore)

    // ---- channel watch: where are the low stars coming from portfolio-wide, last 14 days ----
    const watchFrom = addDays(today, -14)
    const channelWatch: Record<string, number> = {}
    for (const r of reviews) {
      const rating = Number(r.rating)
      if (!Number.isFinite(rating) || rating > 2) continue
      if (str(r.created_at).slice(0, 10) < watchFrom) continue
      const ch = str(r.channel) || '?'
      channelWatch[ch] = (channelWatch[ch] || 0) + 1
    }

    return NextResponse.json({ ok: true, days, from: recentFrom, priorFrom, today, buildings, channelWatch })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
